#!/usr/bin/env node
"use strict";

/**
 * handle-critical-callback.js ALERT_ID
 *
 * Called by the tests agent when it receives a critical_fixed: or
 * critical_remove: Telegram callback. Deletes the critical alert
 * message from Telegram and clears the state file.
 *
 * Usage: node handle-critical-callback.js CRIT-2026-02-20-abc123
 */

const fs = require("node:fs");
const path = require("node:path");

const OPENCLAW_ROOT = "/Users/dmitriy/openclaw";
const CONFIG_PATH = path.join(process.env.HOME || "", ".openclaw", "openclaw.json");
const CRITICAL_STATE = path.join(OPENCLAW_ROOT, "councils", "data", "state", "telegram-security-critical.json");

async function main() {
  const alertId = (process.argv[2] || "").trim();

  if (!alertId) {
    process.stderr.write("Usage: node handle-critical-callback.js ALERT_ID\n");
    process.exit(1);
  }

  const state = readJson(CRITICAL_STATE, null);

  if (!state) {
    process.stderr.write("No critical state file found — nothing to delete.\n");
    process.exit(0);
  }

  if (state.alertId !== alertId) {
    process.stderr.write(
      `Alert ID mismatch: state has '${state.alertId}', got '${alertId}'. Skipping.\n`
    );
    process.exit(0);
  }

  if (state.resolvedAt) {
    process.stderr.write(`Alert ${alertId} already resolved at ${state.resolvedAt}.\n`);
    process.exit(0);
  }

  const token = loadBotToken();
  const chatId = state.chatId;
  const messageId = state.messageId;

  if (!token || !chatId || !messageId) {
    process.stderr.write(`Missing data: token=${!!token} chatId=${chatId} messageId=${messageId}\n`);
    process.exit(1);
  }

  const url = `https://api.telegram.org/bot${token}/deleteMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: Number(messageId) })
  });

  const body = await res.json().catch(() => ({ ok: false, description: "invalid_json" }));

  if (body.ok) {
    process.stdout.write(`Deleted critical alert message ${messageId} in chat ${chatId}\n`);
  } else if (/message to delete not found/i.test(String(body.description || ""))) {
    process.stdout.write(`Message ${messageId} already deleted.\n`);
  } else {
    process.stderr.write(`deleteMessage failed: ${body.description || "unknown"}\n`);
  }

  saveJson(CRITICAL_STATE, {
    ...state,
    resolvedAt: new Date().toISOString(),
    messageId: null
  });

  process.exit(0);
}

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

main().catch((err) => {
  process.stderr.write(`handle-critical-callback failed: ${err.message}\n`);
  process.exit(1);
});
