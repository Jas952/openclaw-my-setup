"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { generateWeeklyChart, generateDailyChart, generateAgentChart } = require("./chart-generator");

function loadConfig() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "tracker.config.json"), "utf8"));
}

function loadCosts() {
  const p = path.join(__dirname, "costs.json");
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return {}; }
}

function loadJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

function saveJson(p, value) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(value, null, 2) + "\n");
}

function getBotToken() {
  if (process.env.TELEGRAM_BOT_TOKEN) return process.env.TELEGRAM_BOT_TOKEN;
  try {
    const cfg = JSON.parse(
      fs.readFileSync(path.join(os.homedir(), ".openclaw/clawdbot.json"), "utf8")
    );
    return cfg?.channels?.telegram?.botToken;
  } catch { return null; }
}

// ── Telegram helpers ────────────────────────────────────────────────────────────

/**
 * Send or edit a photo message with caption.
 *
 * msgId=null  → sendPhoto (first run only, stores new message ID in state.json)
 * msgId set   → editMessageMedia only, NEVER creates a new message.
 *               Throws on failure so state.json is not overwritten with bad data.
 *               To reset (e.g. message deleted from chat): clear IDs in state.json.
 */
async function upsertPhoto(token, chatId, threadId, msgId, imageBuffer, caption) {
  if (msgId) {
    // Edit existing message in-place — no new messages ever
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("message_id", String(msgId));
    form.append("media", JSON.stringify({
      type: "photo",
      media: "attach://photo",
      caption,
      parse_mode: "HTML"
    }));
    form.append("photo", new Blob([imageBuffer], { type: "image/png" }), "chart.png");

    const res = await fetch(`https://api.telegram.org/bot${token}/editMessageMedia`, {
      method: "POST",
      body: form
    });
    const data = await res.json().catch(() => ({ ok: false, description: "invalid_json" }));
    if (data.ok) return { mode: "edited", messageId: msgId };
    if (/message is not modified/i.test(data.description || "")) return { mode: "unchanged", messageId: msgId };
    throw new Error(`editMessageMedia(${msgId}) failed: ${data.description}`);
  }

  // First run: send new photo message and store its ID
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (threadId) form.append("message_thread_id", String(threadId));
  form.append("photo", new Blob([imageBuffer], { type: "image/png" }), "chart.png");
  form.append("caption", caption);
  form.append("parse_mode", "HTML");

  const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: "POST",
    body: form
  });
  const data = await res.json().catch(() => ({ ok: false, description: "invalid_json" }));
  if (!data.ok) throw new Error(`sendPhoto failed: ${data.description}`);
  return { mode: "sent", messageId: Number(data.result.message_id) };
}

// ── Formatting ─────────────────────────────────────────────────────────────────

/** Format token count: ≥1M → "1.8M", ≥1000 → "14.2k", else plain number */
function fmtTokens(n) {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return (m < 10 ? m.toFixed(1) : Math.round(m)) + "M";
  }
  if (n >= 1000) {
    const k = n / 1000;
    return (k < 100 ? k.toFixed(1) : Math.round(k)) + "k";
  }
  return String(Math.round(n));
}

function fmtDate(dateStr, opts = {}) {
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...opts });
}

function fmtTime(tz) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit", minute: "2-digit", hour12: false
  }).format(new Date());
}

function fmtWeekRange(weekStartStr) {
  const start = fmtDate(weekStartStr);
  const endDate = new Date(weekStartStr + "T00:00:00Z");
  endDate.setDate(endDate.getDate() + 6);
  const end = fmtDate(endDate.toISOString().slice(0, 10));
  return `${start} – ${end} MSK`;
}

/**
 * Shorten model name for caption (target ≤10 chars).
 * Strips vendor prefixes and known suffixes to keep names compact.
 * Examples: "gpt-5.3-codex" → "5.3"
 *           "gpt-5.1-codex-mini" → "5.1-mini"
 *           "claude-sonnet-4-6" → "sonnet-4.6"
 */
function fmtModel(model, maxLen = 10) {
  let s = model
    .replace(/^gpt-/, "")
    .replace(/^claude-/, "")
    .replace(/^o\d+-/, "o-")
    .replace(/-codex-mini$/, "-mini")
    .replace(/-codex$/, "");
  if (s.length > maxLen) s = s.slice(0, maxLen - 1) + "…";
  return s;
}

/** Truncate agent path for display (target ≤10 chars) */
function fmtAgent(agentId, maxLen = 10) {
  if (!agentId || agentId === "unknown") return "unknown";
  if (agentId.length > maxLen) return agentId.slice(0, maxLen - 1) + "…";
  return agentId;
}

/** Build aligned table rows: first column left-aligned, rest right-aligned */
function buildTable(headers, rows, colWidths, sep = " ") {
  const pad = (s, w, i) => i === 0 ? String(s).padEnd(w) : String(s).padStart(w);
  const header = headers.map((h, i) => pad(h, colWidths[i], i)).join(sep);
  const lines = [header];
  for (const row of rows) {
    lines.push(row.map((cell, i) => pad(cell, colWidths[i], i)).join(sep));
  }
  return lines.join("\n");
}

function calcCost(groups, costs) {
  let total = 0;
  let hasPrice = false;
  let unknownModels = 0;
  for (const g of groups) {
    const key = `${g.provider}/${g.model}`;
    const price = costs[key];
    if (!price || (price.input === 0 && price.output === 0 && (price.cache || 0) === 0)) {
      unknownModels++;
      continue;
    }
    if (price.input > 0 || price.output > 0) hasPrice = true;
    total += (g.input * price.input + g.output * price.output + g.cacheRead * (price.cache || 0)) / 1_000_000;
  }
  if (!hasPrice) return "~$N/A";
  const suffix = unknownModels > 0 ? " (partial)" : "";
  return `~$${total.toFixed(2)}${suffix}`;
}

// ── Caption builders ────────────────────────────────────────────────────────────

function buildWeeklyCaption(data, costs, cfg) {
  const { weekly, weekStartStr } = data;
  const range = fmtWeekRange(weekStartStr);

  const headers = ["Model", "N", "In", "Out", "Cache"];
  const rows = weekly.byModel.map(g => [
    fmtModel(g.model), String(g.calls), fmtTokens(g.input), fmtTokens(g.output), fmtTokens(g.cacheRead)
  ]);
  rows.push([
    "Total",
    String(weekly.totals.calls),
    fmtTokens(weekly.totals.input),
    fmtTokens(weekly.totals.output),
    fmtTokens(weekly.totals.cacheRead)
  ]);

  const allRows = [headers, ...rows];
  const widths = headers.map((_, i) => Math.max(...allRows.map(r => String(r[i]).length)));
  const table = buildTable(headers, rows, widths);
  const cost = calcCost(weekly.byModel, costs);

  return [
    `<b>Weekly Usage</b>  ·  ${range}`,
    "",
    `<code>${table}</code>`,
    "",
    `Est. API cost: <b>${cost}</b>  ·  <i>Reset Sun 00:00 MSK</i>`
  ].join("\n");
}

function buildDailyCaption(data, costs, cfg) {
  const { daily, todayStr } = data;
  const dateLabel = fmtDate(todayStr, { year: "numeric" }) + " MSK";
  const timeLabel = fmtTime(cfg.timezone);

  const headers = ["Model", "N", "In", "Out", "Cache"];
  const rows = daily.byModel.map(g => [
    fmtModel(g.model), String(g.calls), fmtTokens(g.input), fmtTokens(g.output), fmtTokens(g.cacheRead)
  ]);
  rows.push([
    "Total",
    String(daily.totals.calls),
    fmtTokens(daily.totals.input),
    fmtTokens(daily.totals.output),
    fmtTokens(daily.totals.cacheRead)
  ]);

  const allRows = [headers, ...rows];
  const widths = headers.map((_, i) => Math.max(...allRows.map(r => String(r[i]).length)));
  const table = buildTable(headers, rows, widths);
  const cost = calcCost(daily.byModel, costs);

  return [
    `<b>Daily Usage</b>  ·  ${dateLabel}`,
    "",
    `<code>${table}</code>`,
    "",
    `Est. API cost: <b>${cost}</b>  ·  <i>${timeLabel} MSK</i>`
  ].join("\n");
}

function buildAgentCaption(data, cfg) {
  const { byAgent, todayStr } = data;
  const dateLabel = fmtDate(todayStr, { year: "numeric" }) + " MSK";
  const timeLabel = fmtTime(cfg.timezone);

  const headers = ["Agent", "N", "In", "Out", "Cache"];
  const rows = byAgent.map(g => [
    fmtAgent(g.agentId), String(g.calls), fmtTokens(g.input), fmtTokens(g.output), fmtTokens(g.cacheRead)
  ]);

  if (rows.length === 0) {
    rows.push(["—", "0", "0", "0", "0"]);
  }

  const allRows = [headers, ...rows];
  const widths = headers.map((_, i) => Math.max(...allRows.map(r => String(r[i]).length)));
  const table = buildTable(headers, rows, widths);

  return [
    `<b>By Agent</b>  ·  ${dateLabel}`,
    "",
    `<code>${table}</code>`,
    "",
    `<i>${timeLabel} MSK</i>`
  ].join("\n");
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function report(data) {
  const cfg = loadConfig();
  const costs = loadCosts();
  const statePath = path.resolve(__dirname, cfg.statePath);
  const state = loadJson(statePath, {});

  const token = getBotToken();
  if (!token) throw new Error("Telegram bot token not found in clawdbot.json");

  const chatId   = cfg.telegramChatId;
  const threadId = cfg.telegramThreadId;

  // Generate chart PNGs and build captions in parallel
  const [chartWeekly, chartDaily, chartAgent] = await Promise.all([
    generateWeeklyChart(data),
    generateDailyChart(data),
    generateAgentChart(data)
  ]);
  console.log("[reporter] charts generated");

  const weeklyCaption = buildWeeklyCaption(data, costs, cfg);
  const dailyCaption  = buildDailyCaption(data, costs, cfg);
  const agentCaption  = buildAgentCaption(data, cfg);

  const [r1, r2, r3] = await Promise.all([
    upsertPhoto(token, chatId, threadId, state.weeklyMsgId || null, chartWeekly, weeklyCaption),
    upsertPhoto(token, chatId, threadId, state.dailyMsgId  || null, chartDaily,  dailyCaption),
    upsertPhoto(token, chatId, threadId, state.agentMsgId  || null, chartAgent,  agentCaption)
  ]);

  saveJson(statePath, {
    chatId,
    threadId,
    weeklyMsgId: r1.messageId,
    dailyMsgId:  r2.messageId,
    agentMsgId:  r3.messageId,
    updatedAt:   new Date().toISOString()
  });

  console.log(`[reporter] weekly=${r1.mode}(${r1.messageId}) daily=${r2.mode}(${r2.messageId}) agent=${r3.mode}(${r3.messageId})`);
  return { r1, r2, r3 };
}

module.exports = { report, buildWeeklyCaption, buildDailyCaption, buildAgentCaption, fmtTokens };
