#!/usr/bin/env node
"use strict";

/**
 * critical-callback-server.js
 *
 * Lightweight HTTP server (127.0.0.1:9876) that handles Telegram
 * inline-button URL clicks for critical alerts — NO AI involved.
 *
 * Routes:
 *   GET /critical-fixed?id=ALERT_ID   → delete critical alert message + clear state
 *   GET /critical-remove?id=ALERT_ID  → same (remove without confirmation)
 *   GET /health                        → 200 OK
 *
 * Telegram "url" buttons open this URL in the user's browser when
 * clicked in Telegram Desktop on the same machine.
 */

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

const PORT = Number(process.env.CRITICAL_CB_PORT || 9876);
const HOST = "127.0.0.1";

const OPENCLAW_ROOT = "/Users/dmitriy/openclaw";
const CONFIG_PATH = path.join(process.env.HOME || "", ".openclaw", "openclaw.json");
const CRITICAL_STATE = path.join(OPENCLAW_ROOT, "councils", "data", "state", "telegram-security-critical.json");
const PID_FILE = path.join(OPENCLAW_ROOT, "councils", "data", "state", "critical-callback-server.pid");

// ── HTML response that immediately closes the browser tab ────────────────────
const SUCCESS_HTML = `<!DOCTYPE html>
<html><head><title>OK</title>
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0f0f0f;color:#aaa}</style>
</head><body><p>Resolved. This tab will close.</p>
<script>setTimeout(()=>window.close(),800)</script></body></html>`;

const ERROR_HTML = (msg) => `<!DOCTYPE html>
<html><head><title>Error</title></head>
<body><p>${msg}</p><script>setTimeout(()=>window.close(),2000)</script></body></html>`;

// ── Main server ───────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  let parsed;
  try {
    parsed = new URL(req.url, `http://${HOST}:${PORT}`);
  } catch {
    res.writeHead(400);
    res.end("Bad request");
    return;
  }

  if (parsed.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }

  if (parsed.pathname === "/critical-fixed" || parsed.pathname === "/critical-remove") {
    const alertId = (parsed.searchParams.get("id") || "").trim();

    if (!alertId) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end(ERROR_HTML("Missing alert ID."));
      return;
    }

    try {
      const result = await handleDelete(alertId);
      if (result.ok) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(SUCCESS_HTML);
      } else {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(ERROR_HTML(result.reason));
      }
    } catch (err) {
      process.stderr.write(`[critical-callback-server] Error: ${err.message}\n`);
      res.writeHead(500, { "Content-Type": "text/html" });
      res.end(ERROR_HTML("Internal error. Check server logs."));
    }
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

// ── Core deletion logic ───────────────────────────────────────────────────────
async function handleDelete(alertId) {
  const state = readJson(CRITICAL_STATE, null);

  if (!state) {
    return { ok: false, reason: "No critical alert state found." };
  }

  if (state.alertId !== alertId) {
    return { ok: false, reason: `Alert ID mismatch (expected ${state.alertId}).` };
  }

  if (state.resolvedAt) {
    return { ok: true };
  }

  const token = loadBotToken();
  const chatId = state.chatId;
  const messageId = state.messageId;

  if (!token || !chatId || !messageId) {
    return { ok: false, reason: "Missing token, chatId or messageId in state." };
  }

  const url = `https://api.telegram.org/bot${token}/deleteMessage`;
  const tgRes = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: Number(messageId) })
  });

  const body = await tgRes.json().catch(() => ({ ok: false, description: "invalid_json" }));

  if (!body.ok && !/message to delete not found/i.test(String(body.description || ""))) {
    process.stderr.write(`[critical-callback-server] deleteMessage failed: ${body.description}\n`);
  }

  saveJson(CRITICAL_STATE, {
    ...state,
    resolvedAt: new Date().toISOString(),
    messageId: null
  });

  process.stdout.write(`[critical-callback-server] Deleted message ${messageId} for alert ${alertId}\n`);
  return { ok: true };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function loadBotToken() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    return cfg.channels?.telegram?.botToken || "";
  } catch {
    return "";
  }
}

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

function saveJson(p, value) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(value, null, 2) + "\n");
}

// ── Start ─────────────────────────────────────────────────────────────────────
server.listen(PORT, HOST, () => {
  process.stdout.write(`[critical-callback-server] Listening on http://${HOST}:${PORT}\n`);
  try {
    fs.writeFileSync(PID_FILE, String(process.pid));
  } catch {}
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    process.stdout.write(`[critical-callback-server] Port ${PORT} already in use — another instance is running.\n`);
    process.exit(0);
  }
  process.stderr.write(`[critical-callback-server] ${err.message}\n`);
  process.exit(1);
});

process.on("SIGTERM", () => {
  server.close(() => {
    try { fs.unlinkSync(PID_FILE); } catch {}
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  server.close(() => {
    try { fs.unlinkSync(PID_FILE); } catch {}
    process.exit(0);
  });
});
