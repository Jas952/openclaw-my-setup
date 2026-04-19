"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * Parses OpenClaw daily logs, extracts agent usage records, deduplicates,
 * and appends new records to model-usage.jsonl.
 *
 * Sources:
 * 1) Legacy gateway logs (/tmp/openclaw/openclaw-YYYY-MM-DD.log)
 * 2) Current session logs (~/.openclaw/agents/<agent>/sessions/*.jsonl)
 */

function loadConfig() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "tracker.config.json"), "utf8"));
}

function expandHome(p) {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

function normalizeTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

function parseDateFromTimestamp(ts) {
  const normalized = normalizeTimestamp(ts) || new Date().toISOString();
  // Returns YYYY-MM-DD in UTC (logs use UTC timestamps)
  return normalized.slice(0, 10);
}

function usageSignature(rec) {
  const normalizedTs = normalizeTimestamp(rec.ts);
  const minuteBucket = normalizedTs ? Math.floor(new Date(normalizedTs).getTime() / 60000) : "na";
  return [
    rec.sessionId || "nosession",
    rec.provider || "unknown",
    rec.model || "unknown",
    Number(rec.input || 0),
    Number(rec.output || 0),
    Number(rec.cacheRead || 0),
    minuteBucket
  ].join("|");
}

function loadSeenIndexes(storagePath) {
  const seenRunIds = new Set();
  const seenUsageSignatures = new Set();
  if (!fs.existsSync(storagePath)) return { seenRunIds, seenUsageSignatures };
  const content = fs.readFileSync(storagePath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const rec = JSON.parse(trimmed);
      if (rec.runId) seenRunIds.add(rec.runId);
      seenUsageSignatures.add(usageSignature(rec));
    } catch { /* skip malformed lines */ }
  }
  return { seenRunIds, seenUsageSignatures };
}

function extractAgentId(workspaceDir, workspacesBase) {
  if (!workspaceDir) return null;
  const base = workspacesBase.replace(/\/$/, "") + "/";
  if (workspaceDir.startsWith(base)) {
    return workspaceDir.slice(base.length);
  }
  // Fallback: last 2 path segments
  const parts = workspaceDir.replace(/\/$/, "").split("/");
  return parts.slice(-2).join("/");
}

function shouldAcceptRecord(rec, seenRunIds, seenUsageSignatures) {
  if (rec.runId && seenRunIds.has(rec.runId)) return false;

  const sig = usageSignature(rec);
  if (seenUsageSignatures.has(sig)) return false;

  if (rec.runId) seenRunIds.add(rec.runId);
  seenUsageSignatures.add(sig);
  return true;
}

function parseLegacyLogFile(filePath, seenRunIds, seenUsageSignatures, workspacesBase) {
  const records = [];
  let content;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return records;
  }

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let outer;
    try { outer = JSON.parse(trimmed); } catch { continue; }

    const rawInner = outer["0"];
    if (!rawInner || typeof rawInner !== "string") continue;

    let inner;
    try { inner = JSON.parse(rawInner); } catch { continue; }

    const runId = inner.runId || null;
    if (!runId) continue;

    const meta = inner?.result?.meta;
    if (!meta) continue;

    const agentMeta = meta.agentMeta;
    if (!agentMeta?.usage) continue;

    const usage = agentMeta.usage;
    const input = Number(usage.input || 0);
    const output = Number(usage.output || 0);
    const cacheRead = Number(usage.cacheRead || 0);

    if (input === 0 && output === 0 && cacheRead === 0) continue;

    const workspaceDir = meta.systemPromptReport?.workspaceDir || null;
    const ts = normalizeTimestamp(outer.time) || new Date().toISOString();

    const rec = {
      ts,
      date: parseDateFromTimestamp(ts),
      runId,
      sessionId: agentMeta.sessionId || null,
      agentId: extractAgentId(workspaceDir, workspacesBase),
      provider: agentMeta.provider || "unknown",
      model: agentMeta.model || "unknown",
      input,
      output,
      cacheRead,
      durationMs: Number(meta.durationMs || 0)
    };

    if (shouldAcceptRecord(rec, seenRunIds, seenUsageSignatures)) {
      records.push(rec);
    }
  }

  return records;
}

function getLogFilePaths(logDir, scanDays) {
  const paths = [];
  const now = new Date();
  for (let i = 0; i < scanDays; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const filePath = path.join(logDir, `openclaw-${dateStr}.log`);
    paths.push(filePath);
  }
  return paths;
}

function inferSessionIdFromFilename(filePath) {
  const base = path.basename(filePath, ".jsonl");
  const topicIndex = base.indexOf("-topic-");
  if (topicIndex > 0) return base.slice(0, topicIndex);
  return base;
}

function extractWorkspaceFromTelegramText(text) {
  if (!text || typeof text !== "string") return null;
  const m = text.match(/\[Telegram\s+([^\s\]]+)\s+id:/);
  return m ? m[1] : null;
}

function resolveAgentId(agentSlug, workspaceHint) {
  if (!workspaceHint) return agentSlug;
  if (agentSlug.includes("/")) return agentSlug;
  return `${workspaceHint}/${agentSlug}`;
}

function parseSessionFile(filePath, seenRunIds, seenUsageSignatures) {
  const records = [];
  let content;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return records;
  }

  const agentSlug = path.basename(path.dirname(path.dirname(filePath))) || "unknown";
  let sessionId = inferSessionIdFromFilename(filePath);
  let workspaceHint = null;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let row;
    try { row = JSON.parse(trimmed); } catch { continue; }

    if (row.type === "session" && row.id && typeof row.id === "string") {
      sessionId = row.id;
      continue;
    }

    if (row.type !== "message" || !row.message) continue;
    const msg = row.message;

    // Capture workspace prefix from Telegram envelope in user text.
    if (msg.role === "user" && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part?.type !== "text" || typeof part.text !== "string") continue;
        const ws = extractWorkspaceFromTelegramText(part.text);
        if (ws) {
          workspaceHint = ws;
          break;
        }
      }
      continue;
    }

    if (msg.role !== "assistant" || !msg.usage) continue;

    const usage = msg.usage;
    const input = Number(usage.input || 0);
    const output = Number(usage.output || 0);
    const cacheRead = Number(usage.cacheRead || 0);
    if (input === 0 && output === 0 && cacheRead === 0) continue;

    const ts = normalizeTimestamp(row.timestamp)
      || normalizeTimestamp(msg.timestamp)
      || new Date().toISOString();

    const localId = row.id || msg.id || `${ts}:${input}:${output}:${cacheRead}`;
    const runId = `session:${sessionId}:${localId}`;

    const rec = {
      ts,
      date: parseDateFromTimestamp(ts),
      runId,
      sessionId: sessionId || null,
      agentId: resolveAgentId(agentSlug, workspaceHint),
      provider: msg.provider || "unknown",
      model: msg.model || "unknown",
      input,
      output,
      cacheRead,
      durationMs: 0
    };

    if (shouldAcceptRecord(rec, seenRunIds, seenUsageSignatures)) {
      records.push(rec);
    }
  }

  return records;
}

function getSessionFilePaths(sessionsRoot, _scanDays) {
  const paths = [];
  if (!fs.existsSync(sessionsRoot)) return paths;

  let agentDirs = [];
  try {
    agentDirs = fs.readdirSync(sessionsRoot, { withFileTypes: true });
  } catch {
    return paths;
  }

  for (const ent of agentDirs) {
    if (!ent.isDirectory()) continue;
    const sessionsDir = path.join(sessionsRoot, ent.name, "sessions");
    if (!fs.existsSync(sessionsDir)) continue;

    let files = [];
    try {
      files = fs.readdirSync(sessionsDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const f of files) {
      if (!f.isFile() || !f.name.endsWith(".jsonl")) continue;
      const fullPath = path.join(sessionsDir, f.name);
      paths.push(fullPath);
    }
  }

  return paths;
}

function run() {
  const cfg = loadConfig();
  const storagePath = expandHome(cfg.storagePath);
  const storageDir = path.dirname(storagePath);

  fs.mkdirSync(storageDir, { recursive: true });

  const { seenRunIds, seenUsageSignatures } = loadSeenIndexes(storagePath);
  const logFiles = getLogFilePaths(cfg.logDir, cfg.scanDays);
  const sessionsRoot = expandHome(cfg.sessionsRoot || "~/.openclaw/agents");
  const sessionFiles = getSessionFilePaths(sessionsRoot, cfg.scanDays);

  let totalNew = 0;
  const fd = fs.openSync(storagePath, "a");

  for (const logFile of logFiles) {
    if (!fs.existsSync(logFile)) continue;
    const records = parseLegacyLogFile(logFile, seenRunIds, seenUsageSignatures, cfg.workspacesBase);
    for (const rec of records) {
      fs.writeSync(fd, JSON.stringify(rec) + "\n");
      totalNew++;
    }
  }

  for (const filePath of sessionFiles) {
    const records = parseSessionFile(filePath, seenRunIds, seenUsageSignatures);
    for (const rec of records) {
      fs.writeSync(fd, JSON.stringify(rec) + "\n");
      totalNew++;
    }
  }

  fs.closeSync(fd);
  return totalNew;
}

module.exports = {
  run,
  parseLegacyLogFile,
  parseSessionFile,
  loadSeenIndexes,
  extractAgentId
};

if (require.main === module) {
  const n = run();
  console.log(`[parser] ${n} new record(s) appended`);
}
