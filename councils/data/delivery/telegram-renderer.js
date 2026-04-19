#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const OPENCLAW_ROOT = "/Users/dmitriy/openclaw";
const CONFIG_PATH = path.join(process.env.HOME || "", ".openclaw", "openclaw.json");
const STATE_DIR = path.join(OPENCLAW_ROOT, "councils", "data", "state");
const MESSAGE_STATE = path.join(STATE_DIR, "telegram-security-message.json");
const CRITICAL_STATE = path.join(STATE_DIR, "telegram-security-critical.json");
const REPORT_TEXT_PATH = path.join(OPENCLAW_ROOT, "councils", "data", "telegram", "security-report-last.txt");

const REPORT_AGENT_ID = (process.env.SECURITY_REPORT_AGENT_ID || "tests").trim();

async function publishReport(report, opts = {}) {
  ensureDir(STATE_DIR);
  ensureDir(path.dirname(REPORT_TEXT_PATH));

  const target = loadTelegramTarget();
  const text = String(opts.text || "");
  const res = await upsertMainMessage(target, text);
  fs.writeFileSync(REPORT_TEXT_PATH, text + "\n");

  let criticalRes = { sent: false };
  if (opts.criticalImmediateAlert && Array.isArray(report.recommendations)) {
    criticalRes = await maybeSendCriticalAlert(target, report);
  }

  return {
    main: res,
    critical: criticalRes,
    target: {
      chatId: target.chatId,
      threadId: target.threadId
    }
  };
}

function loadTelegramTarget() {
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  const bindings = cfg.bindings || [];
  const binding = bindings.find((b) => b.agentId === REPORT_AGENT_ID && b.match?.channel === "telegram");
  if (!binding) throw new Error(`Telegram binding for agent '${REPORT_AGENT_ID}' not found`);

  const peerId = String(binding.match?.peer?.id || "");
  const m = peerId.match(/^(-?\d+):topic:(\d+)$/);
  if (!m) throw new Error(`Unsupported telegram peer id format: ${peerId}`);

  const token = cfg.channels?.telegram?.botToken;
  if (!token) throw new Error("Telegram bot token missing");

  return {
    token,
    chatId: m[1],
    threadId: Number(m[2])
  };
}

async function upsertMainMessage(target, text) {
  const state = loadJson(MESSAGE_STATE, null);
  const messageId = state?.messageId;

  if (messageId) {
    let edited = await tg(target.token, "editMessageText", {
      chat_id: target.chatId,
      message_id: Number(messageId),
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true
    });
    if (!edited.ok && isHtmlParseError(edited)) {
      edited = await tg(target.token, "editMessageText", {
        chat_id: target.chatId,
        message_id: Number(messageId),
        text: stripHtml(text),
        disable_web_page_preview: true
      });
    }

    if (edited.ok) {
      saveJson(MESSAGE_STATE, {
        chatId: target.chatId,
        threadId: target.threadId,
        messageId: Number(messageId),
        updatedAt: new Date().toISOString()
      });
      return { mode: "edited", messageId: Number(messageId) };
    }

    if (/message is not modified/i.test(String(edited.description || ""))) {
      return { mode: "unchanged", messageId: Number(messageId) };
    }
  }

  let sent = await tg(target.token, "sendMessage", {
    chat_id: target.chatId,
    message_thread_id: target.threadId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true
  });
  if (!sent.ok && isHtmlParseError(sent)) {
    sent = await tg(target.token, "sendMessage", {
      chat_id: target.chatId,
      message_thread_id: target.threadId,
      text: stripHtml(text),
      disable_web_page_preview: true
    });
  }

  if (!sent.ok) throw new Error(`Telegram sendMessage failed: ${sent.description || "unknown"}`);
  const newId = Number(sent.result?.message_id);

  saveJson(MESSAGE_STATE, {
    chatId: target.chatId,
    threadId: target.threadId,
    messageId: newId,
    updatedAt: new Date().toISOString()
  });

  return { mode: "sent", messageId: newId };
}

async function maybeSendCriticalAlert(target, report) {
  const critical = (report.recommendations || []).filter((x) => String(x.severity || "").toLowerCase() === "critical");
  if (critical.length === 0) return { sent: false, reason: "no_critical" };

  const fingerprint = sha(
    JSON.stringify(
      critical.map((x) => ({
        id: x.id,
        title: x.title,
        scope: x.scope,
        refs: x.references || []
      }))
    )
  );

  const prev = loadJson(CRITICAL_STATE, null);
  if (prev && prev.fingerprint === fingerprint) {
    return { sent: false, reason: "dedup" };
  }

  const alertId = `CRIT-${new Date().toISOString().slice(0, 10)}-${fingerprint.slice(0, 8)}`;
  const text = buildCriticalText(alertId, report, critical);

  let sent = await tg(target.token, "sendMessage", {
    chat_id: target.chatId,
    message_thread_id: target.threadId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [
        [
          { text: "Fixed", callback_data: `critical_fixed:${alertId}`, style: "danger" },
          { text: "Remove Message", callback_data: `critical_remove:${alertId}` }
        ]
      ]
    }
  });
  if (!sent.ok && isHtmlParseError(sent)) {
    sent = await tg(target.token, "sendMessage", {
      chat_id: target.chatId,
      message_thread_id: target.threadId,
      text: stripHtml(text),
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Fixed", callback_data: `critical_fixed:${alertId}`, style: "danger" },
            { text: "Remove Message", callback_data: `critical_remove:${alertId}` }
          ]
        ]
      }
    });
  }

  if (!sent.ok) throw new Error(`Telegram critical alert failed: ${sent.description || "unknown"}`);

  saveJson(CRITICAL_STATE, {
    alertId,
    fingerprint,
    sentAt: new Date().toISOString(),
    chatId: target.chatId,
    threadId: target.threadId,
    messageId: Number(sent.result?.message_id || 0),
    count: critical.length
  });

  return {
    sent: true,
    alertId,
    messageId: Number(sent.result?.message_id || 0),
    criticalCount: critical.length
  };
}

function buildCriticalText(alertId, report, critical) {
  const lines = [];

  lines.push(`<b>CRITICAL ALERT</b> — ${escapeHtml(report.generatedAtMsk || new Date().toISOString())}`);
  lines.push("");
  lines.push(`<b>Council:</b> ${escapeHtml(report.profile?.title || "Security Council")}`);
  lines.push(`<b>ID:</b> <code>${escapeHtml(alertId)}</code>`);
  lines.push("");
  lines.push("<b>Immediate action required.</b>");

  for (const [idx, x] of critical.slice(0, 6).entries()) {
    const details = shortText(String(x.details || ""), 150);
    lines.push("");
    lines.push(`<b>${idx + 1}. [CRITICAL] ${escapeHtml(String(x.id || "critical_issue"))}</b>`);
    lines.push(`   ${escapeHtml(String(x.title || "Критическая проблема"))}`);
    if (details) lines.push(`   <i>${escapeHtml(details)}</i>`);
  }

  return lines.join("\n");
}

async function tg(token, method, payload) {
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  return res.json().catch(() => ({ ok: false, description: "invalid_json" }));
}

function loadJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

function saveJson(p, value) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(value, null, 2) + "\n");
}

function sha(x) {
  return crypto.createHash("sha256").update(x).digest("hex");
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function stripHtml(str) {
  return String(str || "").replace(/<[^>]+>/g, "");
}

function isHtmlParseError(resp) {
  return /can't parse entities|can't find end tag/i.test(String(resp?.description || ""));
}

function shortText(text, maxLen) {
  const v = String(text || "").replace(/\s+/g, " ").trim();
  if (v.length <= maxLen) return v;
  return `${v.slice(0, Math.max(0, maxLen - 1))}…`;
}

module.exports = {
  publishReport,
  loadTelegramTarget,
  escapeHtml
};
