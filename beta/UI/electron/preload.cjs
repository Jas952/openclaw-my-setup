const { contextBridge, ipcRenderer } = require("electron");
const crypto = require("crypto");
const { execFile, execFileSync, spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");
const nodePty = require("node-pty");

const GATEWAY_PROTOCOL_VERSION = 3;
const configPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
const betaStateDir = path.join(os.homedir(), ".openclaw", "beta-ui");
const deviceIdentityPath = path.join(betaStateDir, "device.json");
const deviceTokenPath = path.join(betaStateDir, "device-token.json");
const gatewayLogsDir = path.join(os.homedir(), ".openclaw", "logs");
const gatewayLogPath = path.join(gatewayLogsDir, "gateway.log");
const gatewayErrLogPath = path.join(gatewayLogsDir, "gateway.err.log");
const tmpOpenclawDir = path.join("/tmp", "openclaw");
const personalAuthProfilesPath = path.join(os.homedir(), ".openclaw", "agents", "personal", "agent", "auth-profiles.json");
const repoRootPath = path.resolve(__dirname, "..", "..", "..");
const llmHubDevWorkspacePath = path.join(repoRootPath, "workspaces", "llm.hub", "dev");
const knowledgeBaseDir = path.join(repoRootPath, "core", "knowledge-base");
const knowledgeBaseConfigPath = path.join(knowledgeBaseDir, "kb.config.json");
const knowledgeBaseQueryScriptPath = path.join(knowledgeBaseDir, "query.js");
const knowledgeBaseIngestScriptPath = path.join(knowledgeBaseDir, "ingest.js");
const kbTestSessionsDir = path.join(os.homedir(), ".openclaw", "agents", "kb-test", "sessions");
const topicLibraryMarker = "topic-286";
const topicConversationMarker = "id:-1003713665447 topic:286";
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const LOG_TAIL_BYTES = 256 * 1024;
const DOWNLOADABLE_SOURCE_EXTENSIONS = new Set([
  ".pdf",
  ".epub",
  ".djvu",
  ".txt",
  ".md",
  ".doc",
  ".docx",
  ".rtf",
  ".odt",
  ".csv",
  ".tsv",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".json",
  ".zip",
  ".7z",
  ".tar",
  ".gz",
]);

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJson(filePath, fallbackValue) {
  try {
    if (!fs.existsSync(filePath)) return fallbackValue;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallbackValue;
  }
}

function writeJson(filePath, data) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {}
}

function tailFileLines(filePath, maxLines) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const stats = fs.statSync(filePath);
    if (!stats.isFile() || stats.size <= 0) return [];

    const length = Math.min(stats.size, LOG_TAIL_BYTES);
    const start = Math.max(0, stats.size - length);
    const buffer = Buffer.alloc(length);
    const fd = fs.openSync(filePath, "r");
    try {
      fs.readSync(fd, buffer, 0, length, start);
    } finally {
      fs.closeSync(fd);
    }

    const raw = buffer.toString("utf8");
    const normalized = start > 0 ? raw.slice(raw.indexOf("\n") + 1) : raw;
    return normalized
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => line.trim().length > 0)
      .slice(-maxLines);
  } catch {
    return [];
  }
}

function statMtimeMs(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}

function compactJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function resolveProviderFromModel(modelId) {
  if (typeof modelId !== "string") return "";
  return modelId.split("/")[0] || "";
}

function resolveModelSuffix(modelId) {
  if (typeof modelId !== "string") return "";
  return modelId.split("/")[1] || modelId;
}

function maskSensitiveValue(value, options = {}) {
  const raw = typeof value === "string" ? value : String(value ?? "");
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const visibleStart = Math.max(1, Number(options.visibleStart) || 6);
  const visibleEnd = Math.max(1, Number(options.visibleEnd) || 4);
  if (trimmed.length <= visibleStart + visibleEnd + 3) return trimmed;
  return `${trimmed.slice(0, visibleStart)}...${trimmed.slice(-visibleEnd)}`;
}

function buildAuthAccountsSummary(config) {
  const fromConfigProfiles =
    config && typeof config === "object" && config?.auth?.profiles && typeof config.auth.profiles === "object"
      ? config.auth.profiles
      : {};
  const fromAgentAuthStore = readJson(personalAuthProfilesPath, {});
  const agentProfiles =
    fromAgentAuthStore && typeof fromAgentAuthStore === "object" && fromAgentAuthStore?.profiles && typeof fromAgentAuthStore.profiles === "object"
      ? fromAgentAuthStore.profiles
      : {};

  const profileIds = [...new Set([...Object.keys(fromConfigProfiles), ...Object.keys(agentProfiles)])];
  const accounts = profileIds.map((profileId) => {
    const configProfile = fromConfigProfiles[profileId] || {};
    const agentProfile = agentProfiles[profileId] || {};
    const provider =
      (typeof agentProfile.provider === "string" && agentProfile.provider) ||
      (typeof configProfile.provider === "string" && configProfile.provider) ||
      "unknown";
    const mode = typeof configProfile.mode === "string" ? configProfile.mode : undefined;
    const type = typeof agentProfile.type === "string" ? agentProfile.type : undefined;

    const fields = [];
    const pushField = (key, value, options) => {
      if (value === undefined || value === null || value === "") return;
      const text = typeof value === "string" ? value : String(value);
      const shouldMask = /token|access|refresh|secret|key|id/i.test(key);
      fields.push({
        key,
        value: shouldMask ? maskSensitiveValue(text, options) : text,
      });
    };

    if (provider === "anthropic") {
      pushField("token", agentProfile.token, { visibleStart: 10, visibleEnd: 6 });
      pushField("type", type);
    } else if (provider === "openai-codex") {
      pushField("access", agentProfile.access, { visibleStart: 10, visibleEnd: 6 });
      pushField("expires", agentProfile.expires);
      pushField("accountId", agentProfile.accountId, { visibleStart: 6, visibleEnd: 4 });
      pushField("type", type);
    } else {
      for (const [key, value] of Object.entries(agentProfile)) {
        if (key === "provider" || key === "type") continue;
        if (typeof value === "object") continue;
        pushField(key, value);
      }
      pushField("type", type);
    }

    return {
      profileId,
      provider,
      mode,
      type,
      fields,
    };
  });

  return {
    authProfilesPath: personalAuthProfilesPath,
    accounts,
  };
}

function parseSubsystemFromField(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed.subsystem === "string" && parsed.subsystem.trim()) {
        return parsed.subsystem.trim();
      }
    } catch {}
  }

  return null;
}

function normalizeGatewayJsonLine(line) {
  if (typeof line !== "string") return null;
  const trimmed = line.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const isoTime =
    (typeof parsed.time === "string" && parsed.time) ||
    (typeof parsed?.timestamp === "string" && parsed.timestamp) ||
    (typeof parsed?._meta?.date === "string" && parsed._meta.date) ||
    null;
  const timestampMs = Number.isFinite(Date.parse(isoTime || "")) ? Date.parse(isoTime) : null;

  const subsystem =
    parseSubsystemFromField(parsed["0"]) ||
    (typeof parsed?.subsystem === "string" && parsed.subsystem.trim()) ||
    null;

  let message = "";
  if (typeof parsed["2"] === "string" && parsed["2"].trim()) {
    message = parsed["2"].trim();
  } else if (typeof parsed["1"] === "string" && parsed["1"].trim()) {
    message = parsed["1"].trim();
  } else if (parsed["1"] !== undefined) {
    const candidate =
      (typeof parsed?.["1"]?.message === "string" && parsed["1"].message) ||
      (typeof parsed?.["1"]?.event === "string" && parsed["1"].event) ||
      compactJson(parsed["1"]);
    message = String(candidate || "").trim();
  } else if (typeof parsed?.message === "string" && parsed.message.trim()) {
    message = parsed.message.trim();
  } else {
    message = trimmed;
  }

  const body = subsystem ? `[${subsystem}] ${message}` : message;
  const text = isoTime ? `${isoTime} ${body}` : body;

  const levelName = String(parsed?._meta?.logLevelName || "").toUpperCase();
  const levelId = Number(parsed?._meta?.logLevelId);
  const isError = levelName === "ERROR" || levelName === "FATAL" || Number.isFinite(levelId) && levelId >= 5;

  return {
    text,
    timestampMs,
    isError,
  };
}

function listTmpGatewayMainCandidates() {
  if (!fs.existsSync(tmpOpenclawDir)) return [];
  let names = [];
  try {
    names = fs.readdirSync(tmpOpenclawDir);
  } catch {
    return [];
  }

  const files = names
    .filter((name) => /^openclaw-gateway(?:\.\w+)?\.log$/.test(name))
    .map((name) => path.join(tmpOpenclawDir, name))
    .filter((filePath) => {
      try {
        return fs.statSync(filePath).isFile();
      } catch {
        return false;
      }
    })
    .sort((left, right) => (statMtimeMs(right) || 0) - (statMtimeMs(left) || 0));

  return files.slice(0, 3);
}

function collectMainLogCandidates() {
  const candidateSet = new Set([gatewayLogPath, ...listTmpGatewayMainCandidates()]);
  return [...candidateSet];
}

function collectErrorLogCandidates() {
  const candidates = [gatewayErrLogPath];
  const tmpErrPath = path.join(tmpOpenclawDir, "openclaw-gateway.err.log");
  if (fs.existsSync(tmpErrPath)) candidates.push(tmpErrPath);
  return candidates;
}

function sortEntriesByTime(entries) {
  return entries.sort((left, right) => {
    const leftTs = Number.isFinite(left.timestampMs) ? left.timestampMs : 0;
    const rightTs = Number.isFinite(right.timestampMs) ? right.timestampMs : 0;
    return leftTs - rightTs;
  });
}

function isGatewayLogLineCandidate(text) {
  if (typeof text !== "string") return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.includes("\n")) return false;
  if (trimmed.length > 360) return false;
  if (/^\d{4}-\d{2}-\d{2}T[^\s]+\s+\[[^\]]+\]\s+/.test(trimmed)) return true;
  if (/^\[[^\]]+\]\s+/.test(trimmed)) return true;
  return false;
}

function getGatewayLogSnapshot() {
  const mainCandidates = collectMainLogCandidates();
  const mainEntries = [];

  for (const filePath of mainCandidates) {
    for (const line of tailFileLines(filePath, 320)) {
      const normalized = normalizeGatewayJsonLine(line);
      if (normalized) {
        if (!isGatewayLogLineCandidate(normalized.text)) continue;
        mainEntries.push(normalized);
      } else if (isGatewayLogLineCandidate(line)) {
        mainEntries.push({
          text: line,
          timestampMs: null,
          isError: /\berror\b/i.test(line),
        });
      }
    }
  }

  const mergedMain = sortEntriesByTime(mainEntries)
    .map((entry) => entry.text)
    .slice(-240);

  const errorCandidates = collectErrorLogCandidates();
  const fileErrorLines = [];
  for (const filePath of errorCandidates) {
    fileErrorLines.push(...tailFileLines(filePath, 80));
  }

  const derivedErrorLines = mainEntries.filter((entry) => entry.isError).map((entry) => entry.text);
  const mergedErrorLines = [...fileErrorLines, ...derivedErrorLines];
  const dedupedErrorLines = [];
  const seen = new Set();
  for (let index = mergedErrorLines.length - 1; index >= 0; index -= 1) {
    const line = mergedErrorLines[index];
    if (seen.has(line)) continue;
    seen.add(line);
    dedupedErrorLines.push(line);
    if (dedupedErrorLines.length >= 60) break;
  }
  dedupedErrorLines.reverse();

  const mainUpdatedAtMs = mainCandidates
    .map((candidate) => statMtimeMs(candidate))
    .reduce((acc, value) => (value && (!acc || value > acc) ? value : acc), null);
  const errorUpdatedFromFiles = errorCandidates
    .map((candidate) => statMtimeMs(candidate))
    .reduce((acc, value) => (value && (!acc || value > acc) ? value : acc), null);
  const errorUpdatedFromEntries = mainEntries
    .filter((entry) => entry.isError && Number.isFinite(entry.timestampMs))
    .map((entry) => entry.timestampMs)
    .reduce((acc, value) => (value && (!acc || value > acc) ? value : acc), null);
  const errorUpdatedAtMs =
    (errorUpdatedFromEntries && errorUpdatedFromEntries > (errorUpdatedFromFiles || 0) && errorUpdatedFromEntries) ||
    errorUpdatedFromFiles;

  return {
    mainLines: mergedMain,
    errorLines: dedupedErrorLines,
    mainUpdatedAtMs,
    errorUpdatedAtMs,
  };
}

function normalizeGatewayLaunchStatus(payload, fallbackError = null) {
  const listeners = Array.isArray(payload?.port?.listeners) ? payload.port.listeners : [];
  const firstListener = listeners[0] || null;
  const pidValue = Number(firstListener?.pid);
  const pid = Number.isFinite(pidValue) && pidValue > 0 ? pidValue : null;
  const url =
    (typeof payload?.rpc?.url === "string" && payload.rpc.url) ||
    (typeof payload?.gateway?.probeUrl === "string" && payload.gateway.probeUrl) ||
    "";

  return {
    checkedAt: Date.now(),
    running: Boolean(payload?.rpc?.ok) || String(payload?.port?.status || "").toLowerCase() === "busy",
    rpcOk: payload?.rpc?.ok === true,
    pid,
    url,
    listenerLabel:
      (typeof firstListener?.commandLine === "string" && firstListener.commandLine) ||
      (typeof firstListener?.command === "string" && firstListener.command) ||
      "",
    error: fallbackError,
  };
}

async function getGatewayLaunchStatus() {
  const outcome = await runOpenclawJsonCommand(["gateway", "status", "--json", "--timeout", "2000"], { timeoutMs: 12_000 });
  if (!outcome.parsed || typeof outcome.parsed !== "object") {
    return normalizeGatewayLaunchStatus(null, outcome.error || "Unable to resolve gateway status.");
  }
  return normalizeGatewayLaunchStatus(outcome.parsed, outcome.exitCode === 0 ? null : outcome.error || null);
}

async function startGatewayRun() {
  const existingStatus = await getGatewayLaunchStatus();
  if (existingStatus.rpcOk) {
    return {
      ok: true,
      alreadyRunning: true,
      started: false,
      pid: existingStatus.pid,
      error: null,
      status: existingStatus,
    };
  }

  let child = null;
  try {
    child = spawn("openclaw", ["gateway", "run"], {
      cwd: repoRootPath,
      env: {
        ...process.env,
        FORCE_COLOR: "0",
        CLICOLOR_FORCE: "0",
      },
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } catch (error) {
    return {
      ok: false,
      alreadyRunning: false,
      started: false,
      pid: null,
      error: error instanceof Error ? error.message : String(error),
      status: null,
    };
  }

  let lastStatus = existingStatus;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    lastStatus = await getGatewayLaunchStatus();
    if (lastStatus.rpcOk) {
      return {
        ok: true,
        alreadyRunning: false,
        started: true,
        pid: lastStatus.pid || child.pid || null,
        error: null,
        status: lastStatus,
      };
    }
  }

  return {
    ok: false,
    alreadyRunning: false,
    started: true,
    pid: child.pid || null,
    error: lastStatus.error || "Gateway started but did not become reachable in time.",
    status: lastStatus,
  };
}

async function stopGatewayRun() {
  const beforeStatus = await getGatewayLaunchStatus();
  if (!beforeStatus.running) {
    return {
      ok: true,
      stopped: false,
      error: null,
      status: beforeStatus,
    };
  }

  const stopOutcome = await runOpenclawCommand(["gateway", "stop"], { timeoutMs: 20_000 });
  let lastStatus = beforeStatus;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    lastStatus = await getGatewayLaunchStatus();
    if (!lastStatus.running) {
      return {
        ok: true,
        stopped: true,
        error: null,
        status: lastStatus,
      };
    }
  }

  return {
    ok: false,
    stopped: false,
    error: stopOutcome.error || "Gateway stop command completed but listener is still active.",
    status: lastStatus,
  };
}

function decodeHtmlEntities(value) {
  if (typeof value !== "string" || !value) return "";
  return value
    .replaceAll("&quot;", "\"")
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function normalizeTitleForMatch(value) {
  if (typeof value !== "string") return "";
  return decodeHtmlEntities(value)
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[“”«»"'`]/g, "")
    .replace(/[^\p{L}\p{N}\s:/._-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDescription(value, fallbackTitle) {
  const raw = typeof value === "string" ? value : "";
  const compact = raw.replace(/\s+/g, " ").trim();
  if (compact) {
    return compact.length > 260 ? `${compact.slice(0, 257)}...` : compact;
  }
  const title = typeof fallbackTitle === "string" ? fallbackTitle.trim() : "";
  return title || "No description available.";
}

function expandHomePath(filePath) {
  if (typeof filePath !== "string") return "";
  if (!filePath.startsWith("~")) return filePath;
  return path.join(os.homedir(), filePath.slice(1));
}

function normalizeSourceForMatch(source) {
  if (typeof source !== "string") return "";
  let value = decodeHtmlEntities(source).trim();
  if (!value) return "";

  if (value.startsWith("file://")) {
    try {
      value = decodeURIComponent(new URL(value).pathname);
    } catch {}
  }

  value = expandHomePath(value);
  return value.trim();
}

function sourceMatchCandidates(source) {
  const normalized = normalizeSourceForMatch(source);
  if (!normalized) return [];

  const candidates = new Set([normalized]);
  if (/^https?:\/\//i.test(normalized)) {
    const withoutHash = normalized.split("#")[0];
    const withoutQuery = withoutHash.split("?")[0];
    candidates.add(withoutHash);
    candidates.add(withoutQuery);
    if (withoutQuery.endsWith("/")) candidates.add(withoutQuery.slice(0, -1));
    else candidates.add(`${withoutQuery}/`);
  }
  return [...candidates];
}

function extractKbIngestTitles(text) {
  if (typeof text !== "string" || !text) return [];
  const titles = [];
  const pattern = /✓\s*Добавлено в базу знаний:\s*(.+?)\s*\((\d+)\s*chunks\)/g;
  for (const match of text.matchAll(pattern)) {
    const title = decodeHtmlEntities(String(match[1] || "")).trim();
    if (title) titles.push(title);
  }
  return titles;
}

function parseFrameTimestampMs(frame) {
  const direct = Date.parse(typeof frame?.timestamp === "string" ? frame.timestamp : "");
  if (Number.isFinite(direct)) return direct;
  const nested = Number(frame?.message?.timestamp);
  if (Number.isFinite(nested) && nested > 0) return nested;
  return Date.now();
}

function listTopicSessionFiles() {
  if (!fs.existsSync(kbTestSessionsDir)) return [];
  try {
    const candidates = fs
      .readdirSync(kbTestSessionsDir)
      .filter((name) => name.includes(topicLibraryMarker))
      .map((name) => path.join(kbTestSessionsDir, name))
      .filter((filePath) => fs.statSync(filePath).isFile())
      .sort((left, right) => {
        const leftTime = fs.statSync(left).mtimeMs;
        const rightTime = fs.statSync(right).mtimeMs;
        return leftTime - rightTime;
      });

    const scoped = candidates.filter((filePath) => {
      try {
        const raw = fs.readFileSync(filePath, "utf8");
        return (
          raw.includes(topicConversationMarker) ||
          raw.includes("-1003713665447:topic:286") ||
          raw.includes("\"threadId\":286")
        );
      } catch {
        return false;
      }
    });

    return scoped.length > 0 ? scoped : candidates;
  } catch {
    return [];
  }
}

function collectTopicIngestSignals() {
  const files = listTopicSessionFiles();
  if (files.length === 0) return [];

  const signals = [];
  const callsById = new Map();

  for (const filePath of files) {
    let lines = [];
    try {
      lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
    } catch {
      continue;
    }

    for (const line of lines) {
      let frame;
      try {
        frame = JSON.parse(line);
      } catch {
        continue;
      }

      const message = frame?.message;
      if (!message) continue;
      const timestampMs = parseFrameTimestampMs(frame);

      if (message.role === "assistant" && Array.isArray(message.content)) {
        for (const part of message.content) {
          if (part?.type === "toolCall" && part?.name === "kb_ingest") {
            const source = normalizeSourceForMatch(part?.arguments?.source);
            const title = decodeHtmlEntities(String(part?.arguments?.title || "")).trim();
            const tags = Array.isArray(part?.arguments?.tags)
              ? part.arguments.tags.filter((tag) => typeof tag === "string" && tag.trim())
              : [];
            if (!source && !title) continue;

            const signal = {
              source,
              title,
              tags,
              createdAt: timestampMs,
            };
            signals.push(signal);
            if (typeof part.id === "string" && part.id) {
              callsById.set(part.id, signal);
            }
            continue;
          }

          if (part?.type === "text" && typeof part.text === "string") {
            for (const title of extractKbIngestTitles(part.text)) {
              signals.push({
                source: "",
                title,
                tags: [],
                createdAt: timestampMs,
              });
            }
          }
        }
      }

      if (message.role === "toolResult" && message.toolName === "kb_ingest") {
        const linkedCall =
          typeof message.toolCallId === "string" && message.toolCallId ? callsById.get(message.toolCallId) : null;
        const textBlobs = Array.isArray(message.content)
          ? message.content.filter((part) => part?.type === "text" && typeof part.text === "string").map((part) => part.text)
          : [];
        const titles = textBlobs.flatMap((text) => extractKbIngestTitles(text));

        if (titles.length === 0 && linkedCall) {
          signals.push({
            source: linkedCall.source,
            title: linkedCall.title,
            tags: linkedCall.tags,
            createdAt: timestampMs,
          });
          continue;
        }

        for (const title of titles) {
          signals.push({
            source: linkedCall?.source || "",
            title: title || linkedCall?.title || "",
            tags: linkedCall?.tags || [],
            createdAt: timestampMs,
          });
        }
      }
    }
  }

  return signals;
}

function matchTopicLibraryRows(allRows, topicSignals) {
  if (!Array.isArray(allRows) || allRows.length === 0 || !Array.isArray(topicSignals) || topicSignals.length === 0) {
    return [];
  }

  const rowsBySource = new Map();
  const rowsByTitle = new Map();

  for (const row of allRows) {
    const rowId = String(row.id || "");
    if (!rowId) continue;

    for (const candidate of sourceMatchCandidates(String(row.source || ""))) {
      if (!rowsBySource.has(candidate)) rowsBySource.set(candidate, []);
      rowsBySource.get(candidate).push(rowId);
    }

    const normalizedTitle = normalizeTitleForMatch(String(row.title || ""));
    if (!normalizedTitle) continue;
    if (!rowsByTitle.has(normalizedTitle)) rowsByTitle.set(normalizedTitle, []);
    rowsByTitle.get(normalizedTitle).push(rowId);
  }

  const matchedIds = new Set();
  for (const signal of topicSignals) {
    for (const candidate of sourceMatchCandidates(signal.source)) {
      const ids = rowsBySource.get(candidate);
      if (!ids) continue;
      for (const id of ids) matchedIds.add(id);
    }

    const normalizedTitle = normalizeTitleForMatch(signal.title);
    if (!normalizedTitle) continue;

    const exact = rowsByTitle.get(normalizedTitle);
    if (exact) {
      for (const id of exact) matchedIds.add(id);
      continue;
    }

    if (normalizedTitle.length < 14) continue;
    for (const [rowTitle, ids] of rowsByTitle.entries()) {
      if (!rowTitle) continue;
      if (rowTitle.includes(normalizedTitle) || normalizedTitle.includes(rowTitle)) {
        for (const id of ids) matchedIds.add(id);
      }
    }
  }

  if (matchedIds.size === 0) return [];
  return allRows
    .filter((row) => matchedIds.has(String(row.id || "")))
    .sort((left, right) => (Number(right.created_at) || 0) - (Number(left.created_at) || 0));
}

function resolveActionHref(source) {
  const normalized = normalizeSourceForMatch(source);
  if (!normalized) return "";
  if (/^https?:\/\//i.test(normalized)) return normalized;
  if (path.isAbsolute(normalized)) {
    try {
      return pathToFileURL(normalized).toString();
    } catch {
      return "";
    }
  }
  return "";
}

function isDownloadableSource(source, type) {
  const normalized = normalizeSourceForMatch(source);
  if (!normalized) return false;
  if (type === "pdf" || type === "file") return true;
  if (path.isAbsolute(normalized)) return fs.existsSync(normalized);
  if (!/^https?:\/\//i.test(normalized)) return false;
  try {
    const extension = path.extname(new URL(normalized).pathname || "").toLowerCase();
    return DOWNLOADABLE_SOURCE_EXTENSIONS.has(extension);
  } catch {
    return false;
  }
}

function buildLiteratureAction(source, type) {
  const href = resolveActionHref(source);
  if (!href) return null;

  if (isDownloadableSource(source, type)) {
    return {
      kind: "download",
      href,
    };
  }

  if (/^https?:\/\//i.test(normalizeSourceForMatch(source))) {
    return {
      kind: "link",
      href,
    };
  }

  return null;
}

function resolveKnowledgeBaseDataDir() {
  const fallback = path.join(os.homedir(), ".openclaw", "knowledge-base", "data");
  if (!fs.existsSync(knowledgeBaseConfigPath)) return fallback;
  try {
    const config = JSON.parse(fs.readFileSync(knowledgeBaseConfigPath, "utf8"));
    const configured = expandHomePath(config?.dataDir || "").trim();
    return configured || fallback;
  } catch {
    return fallback;
  }
}

function runSqliteJson(dbPath, sql) {
  const dbUri = `file:${encodeURI(dbPath)}?mode=ro&immutable=1`;
  const raw = execFileSync("sqlite3", ["-json", dbUri, sql], {
    encoding: "utf8",
    timeout: 8000,
    maxBuffer: 2 * 1024 * 1024,
  });
  return JSON.parse(raw || "[]");
}

function normalizeLibrarySearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s:/._-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeLibrarySearch(value) {
  return normalizeLibrarySearchText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function buildLibrarySearchVariants(rawQuery) {
  const variants = new Set();
  const normalized = normalizeLibrarySearchText(rawQuery);
  if (!normalized) return [];

  variants.add(rawQuery.trim());
  variants.add(normalized);

  const stopwords = new Set([
    "обсуждали",
    "обсуждение",
    "ли",
    "мы",
    "что",
    "что-то",
    "чтонибудь",
    "что-нибудь",
    "что-то",
    "то",
    "про",
    "о",
    "об",
    "либо",
    "нибудь",
    "какое",
    "какой",
    "какую",
    "какие",
    "тема",
    "темы",
    "теме",
    "литература",
    "литературе",
    "сохраняли",
    "сохраненное",
    "сохранённое",
    "ранее",
    "раньше",
    "найди",
    "найти",
    "было",
    "были",
    "есть",
  ]);

  const topicalTokens = tokenizeLibrarySearch(normalized).filter((token) => !stopwords.has(token));
  const topicalQuery = topicalTokens.join(" ").trim();
  if (topicalQuery) variants.add(topicalQuery);

  const hasRag = /\brag\b/i.test(normalized);
  const hasVectorSignal =
    /\bvector\b/i.test(normalized) ||
    /(вектор|вектро|эмбед|embedding|retriev|search)/i.test(normalized);
  const hasAnalysisSignal = /(анализ|поиск|retrieval|database|база|db)/i.test(normalized);

  if (hasRag) {
    variants.add("rag");
    variants.add("retrieval augmented generation");
    variants.add("rag vector database");
    variants.add("rag vector search");
  }

  if (hasVectorSignal) {
    variants.add("vector database");
    variants.add("vector search");
    variants.add("embedded vector database");
    variants.add("zvec vector database");
  }

  if (hasVectorSignal && hasAnalysisSignal) {
    variants.add("vector database");
    variants.add("vector search database");
  }

  if (hasRag && hasVectorSignal) {
    variants.add("rag vector database");
    variants.add("vector database for rag");
  }

  return [...variants]
    .map((entry) => entry.trim())
    .filter((entry) => entry.length >= 2)
    .slice(0, 8);
}

function runKnowledgeBaseQuery(query, limit) {
  const raw = execFileSync(
    "node",
    [knowledgeBaseQueryScriptPath, query, "--json", "--limit", String(limit)],
    {
      encoding: "utf8",
      timeout: 45_000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );

  const parsed = JSON.parse(String(raw || "[]"));
  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((entry) => ({
      title: decodeHtmlEntities(String(entry?.title || "")).trim(),
      source: normalizeSourceForMatch(String(entry?.source || "")),
      similarity: Number(entry?.similarity) || 0,
      chunkText: decodeHtmlEntities(String(entry?.chunk_text || "")).trim(),
    }))
    .filter((entry) => entry.title || entry.source);
}

function runKnowledgeBaseQueryAsync(query, limit) {
  return new Promise((resolve, reject) => {
    execFile(
      "node",
      [knowledgeBaseQueryScriptPath, query, "--json", "--limit", String(limit)],
      {
        encoding: "utf8",
        timeout: 45_000,
        maxBuffer: 4 * 1024 * 1024,
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }

        try {
          const parsed = JSON.parse(String(stdout || "[]"));
          if (!Array.isArray(parsed)) {
            resolve([]);
            return;
          }

          resolve(
            parsed
              .map((entry) => ({
                title: decodeHtmlEntities(String(entry?.title || "")).trim(),
                source: normalizeSourceForMatch(String(entry?.source || "")),
                similarity: Number(entry?.similarity) || 0,
                chunkText: decodeHtmlEntities(String(entry?.chunk_text || "")).trim(),
              }))
              .filter((entry) => entry.title || entry.source),
          );
        } catch (parseError) {
          reject(parseError);
        }
      },
    );
  });
}

async function searchLibrary(input = {}) {
  const query = typeof input.query === "string" ? input.query.trim() : "";
  const limit = Math.max(1, Math.min(Number(input.limit) || 8, 20));
  if (!query) return { matches: [] };

  if (!fs.existsSync(knowledgeBaseQueryScriptPath)) {
    return {
      matches: [],
      error: "knowledge-base/query.js not found.",
    };
  }

  try {
    const variants = buildLibrarySearchVariants(query);
    const mergedByKey = new Map();

    for (const variant of variants) {
      const variantMatches = await runKnowledgeBaseQueryAsync(variant, limit);
      for (const match of variantMatches) {
        const key = `${normalizeLibrarySearchText(match.title)}::${normalizeLibrarySearchText(match.source)}`;
        const existing = mergedByKey.get(key);
        if (!existing || match.similarity > existing.similarity) {
          mergedByKey.set(key, match);
        }
      }
    }

    const matches = [...mergedByKey.values()]
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, limit);

    return { matches };
  } catch (error) {
    return {
      matches: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function ingestLiterature(input = {}) {
  const source = typeof input.source === "string" ? input.source.trim() : "";
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (!source) {
    return {
      ok: false,
      error: "Literature source is required.",
      id: null,
      title: null,
      chunks: 0,
      type: null,
    };
  }

  if (!fs.existsSync(knowledgeBaseIngestScriptPath)) {
    return {
      ok: false,
      error: "knowledge-base/ingest.js not found.",
      id: null,
      title: null,
      chunks: 0,
      type: null,
    };
  }

  const args = [knowledgeBaseIngestScriptPath, source, "--json"];
  if (note) {
    args.push("--title", note);
  }

  try {
    const outcome = await new Promise((resolve) => {
      execFile(
        "node",
        args,
        {
          cwd: knowledgeBaseDir,
          env: {
            ...process.env,
            FORCE_COLOR: "0",
            CLICOLOR_FORCE: "0",
          },
          encoding: "utf8",
          timeout: 120_000,
          maxBuffer: 8 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          resolve({
            error: error || null,
            stdout: typeof stdout === "string" ? stdout : "",
            stderr: typeof stderr === "string" ? stderr : "",
          });
        },
      );
    });

    const parsed = extractJsonPayloadFromMixedOutput(outcome.stdout) || extractJsonPayloadFromMixedOutput(outcome.stderr);
    if (outcome.error && !parsed) {
      return {
        ok: false,
        error: (outcome.stderr || outcome.stdout || String(outcome.error)).trim() || "Knowledge-base ingest failed.",
        id: null,
        title: null,
        chunks: 0,
        type: null,
      };
    }

    return {
      ok: true,
      error: null,
      id: typeof parsed?.id === "string" ? parsed.id : null,
      title: typeof parsed?.title === "string" ? parsed.title : note || source,
      chunks: Number(parsed?.chunks) || 0,
      type: typeof parsed?.type === "string" ? parsed.type : null,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      id: null,
      title: null,
      chunks: 0,
      type: null,
    };
  }
}

function getLibrarySnapshot(input = {}) {
  const entryLimit = Math.max(1, Math.min(Number(input.entryLimit) || 16, 60));
  const dataDir = resolveKnowledgeBaseDataDir();
  const dbPath = path.join(dataDir, "knowledge.db");
  if (!fs.existsSync(dbPath)) {
    return {
      literature: [],
      totalLiterature: 0,
      dataDir,
      loadedAt: Date.now(),
    };
  }

  try {
    const topicSignals = collectTopicIngestSignals();
    const totals = runSqliteJson(dbPath, "SELECT COUNT(*) AS total_literature FROM entries");
    const entryRows = runSqliteJson(
      dbPath,
      `SELECT
         e.id,
         e.title,
         e.source,
         e.type,
         e.created_at,
         c.text AS first_chunk_text
       FROM entries e
       LEFT JOIN chunks c
         ON c.entry_id = e.id
        AND c.chunk_index = 0
       ORDER BY e.created_at DESC
       LIMIT 1200`,
    );

    const scopedRows =
      topicSignals.length > 0
        ? matchTopicLibraryRows(entryRows, topicSignals).slice(0, entryLimit)
        : entryRows.slice(0, entryLimit);

    const literature = scopedRows.map((entry) => {
      const source = String(entry.source || "");
      const type = String(entry.type || "unknown");
      return {
        id: String(entry.id),
        title: decodeHtmlEntities(String(entry.title || "Untitled")),
        source,
        description: normalizeDescription(entry.first_chunk_text, entry.title),
        type,
        createdAt: Number(entry.created_at) || 0,
        action: buildLiteratureAction(source, type),
      };
    });

    return {
      literature,
      totalLiterature: Number(totals?.[0]?.total_literature) || 0,
      dataDir,
      loadedAt: Date.now(),
      scope: topicSignals.length > 0 ? "telegram-topic-286" : "knowledge-base-global",
    };
  } catch (error) {
    return {
      literature: [],
      totalLiterature: 0,
      dataDir: "",
      loadedAt: Date.now(),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function base64UrlEncode(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

function derivePublicKeyRaw(publicKeyPem) {
  const spki = crypto.createPublicKey(publicKeyPem).export({
    type: "spki",
    format: "der",
  });

  if (
    spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }

  return spki;
}

function publicKeyRawBase64UrlFromPem(publicKeyPem) {
  return base64UrlEncode(derivePublicKeyRaw(publicKeyPem));
}

function fingerprintPublicKey(publicKeyPem) {
  return crypto.createHash("sha256").update(derivePublicKeyRaw(publicKeyPem)).digest("hex");
}

function generateIdentity() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  return {
    deviceId: fingerprintPublicKey(publicKeyPem),
    publicKeyPem,
    privateKeyPem,
  };
}

function loadOrCreateDeviceIdentity() {
  const existing = readJson(deviceIdentityPath, null);
  if (
    existing &&
    existing.version === 1 &&
    typeof existing.deviceId === "string" &&
    typeof existing.publicKeyPem === "string" &&
    typeof existing.privateKeyPem === "string"
  ) {
    const derivedId = fingerprintPublicKey(existing.publicKeyPem);
    if (derivedId !== existing.deviceId) {
      const updated = {
        ...existing,
        deviceId: derivedId,
      };
      writeJson(deviceIdentityPath, updated);
      return {
        deviceId: derivedId,
        publicKeyPem: existing.publicKeyPem,
        privateKeyPem: existing.privateKeyPem,
      };
    }

    return {
      deviceId: existing.deviceId,
      publicKeyPem: existing.publicKeyPem,
      privateKeyPem: existing.privateKeyPem,
    };
  }

  const identity = generateIdentity();
  writeJson(deviceIdentityPath, {
    version: 1,
    createdAt: new Date().toISOString(),
    ...identity,
  });
  return identity;
}

function normalizeTrimmedMetadata(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed || "";
}

function toLowerAscii(value) {
  return value.replace(/[A-Z]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 32));
}

function normalizeDeviceMetadataForAuth(value) {
  const trimmed = normalizeTrimmedMetadata(value);
  if (!trimmed) return "";
  return toLowerAscii(trimmed);
}

function buildDeviceAuthPayloadV3(params) {
  return [
    "v3",
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    params.scopes.join(","),
    String(params.signedAtMs),
    params.token ?? "",
    params.nonce,
    normalizeDeviceMetadataForAuth(params.platform),
    normalizeDeviceMetadataForAuth(params.deviceFamily),
  ].join("|");
}

function resolveGatewayUrl(config) {
  const port = Number(config?.gateway?.port) || 18789;
  const bind = typeof config?.gateway?.bind === "string" ? config.gateway.bind : "loopback";
  const customBindHost =
    typeof config?.gateway?.customBindHost === "string" && config.gateway.customBindHost.trim()
      ? config.gateway.customBindHost.trim()
      : "";

  let host = "127.0.0.1";
  if (bind === "custom" && customBindHost) host = customBindHost;
  else if (bind === "tailnet" || bind === "lan" || bind === "auto") host = "127.0.0.1";

  return `ws://${host}:${port}`;
}

async function getRuntimeConfig() {
  const config = readJson(configPath, {});
  const gatewayUrl = resolveGatewayUrl(config);
  const sessionMainKey =
    typeof config?.session?.mainKey === "string" && config.session.mainKey.trim()
      ? config.session.mainKey.trim()
      : "main";
  const token =
    typeof config?.gateway?.auth?.token === "string" && config.gateway.auth.token.trim()
      ? config.gateway.auth.token.trim()
      : "";

  return {
    gatewayUrl,
    token,
    sessionKey: `agent:personal:${sessionMainKey}`,
    agentId: "personal",
  };
}

function getAppMeta() {
  return {
    platform: process.platform,
    version: process.versions.electron,
    protocolVersion: GATEWAY_PROTOCOL_VERSION,
  };
}

function splitOutputLines(value) {
  if (typeof value !== "string" || !value) return [];
  return value
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}

const liveCommandSessions = new Map();
let liveCommandSequence = 0;
const interactiveTerminalSessions = new Map();
let interactiveTerminalSequence = 0;

function ensureNodePtySpawnHelperExecutable() {
  try {
    const helperPath = path.join(repoRootPath, "beta", "UI", "node_modules", "node-pty", "prebuilds", `darwin-${process.arch}`, "spawn-helper");
    if (fs.existsSync(helperPath)) fs.chmodSync(helperPath, 0o755);
  } catch {}
}

function createLiveSession(command, childProcess) {
  const sessionId = `cmd-${Date.now()}-${++liveCommandSequence}`;
  const session = {
    sessionId,
    command,
    childProcess,
    startedAt: Date.now(),
    finishedAt: null,
    exitCode: null,
    done: false,
    error: null,
    lines: [],
    stdoutBuffer: "",
    stderrBuffer: "",
    parsedJson: null,
  };
  liveCommandSessions.set(sessionId, session);
  return session;
}

function flushLiveBuffer(session, stream, force = false) {
  const key = stream === "stderr" ? "stderrBuffer" : "stdoutBuffer";
  const source = session[key];
  if (!source) return;
  const chunks = source.split(/\r?\n/);
  const remainder = force ? "" : chunks.pop() || "";
  for (const item of chunks) {
    const line = item.replace(/\r/g, "").trimEnd();
    if (!line) continue;
    session.lines.push({
      stream,
      text: line,
    });
  }
  session[key] = remainder;
}

function finalizeLiveSession(session, exitCode, error) {
  if (!session || session.done) return;
  flushLiveBuffer(session, "stdout", true);
  flushLiveBuffer(session, "stderr", true);
  session.done = true;
  session.exitCode = Number.isInteger(exitCode) ? exitCode : session.exitCode ?? 0;
  session.error = error ? String(error) : session.error;
  session.finishedAt = Date.now();
  const mixed = session.lines.map((entry) => entry.text).join("\n");
  session.parsedJson = extractJsonPayloadFromMixedOutput(mixed);
  if (session.lines.length > 1200) {
    session.lines = session.lines.slice(-1200);
  }
}

function sanitizeLiveChunk(input) {
  if (typeof input !== "string" || input.length === 0) return "";
  return input.replace(/[\u0004\u0008]/g, "");
}

function normalizeInteractiveChunk(input) {
  if (typeof input !== "string" || input.length === 0) return "";
  return input.replace(/\u0004/g, "");
}

function createInteractiveTerminalSession(kind, ptyProcess, cwd, title) {
  const sessionId = `term-${Date.now()}-${++interactiveTerminalSequence}`;
  const session = {
    sessionId,
    kind,
    title,
    cwd,
    ptyProcess,
    startedAt: Date.now(),
    finishedAt: null,
    exitCode: null,
    done: false,
    error: null,
    chunks: [],
  };
  interactiveTerminalSessions.set(sessionId, session);
  return session;
}

function finalizeInteractiveTerminalSession(session, exitCode, error) {
  if (!session || session.done) return;
  session.done = true;
  session.exitCode = Number.isInteger(exitCode) ? exitCode : session.exitCode ?? 0;
  session.error = error ? String(error) : session.error;
  session.finishedAt = Date.now();
}

function resolveInteractiveShellPath() {
  const preferred = typeof process.env.SHELL === "string" ? process.env.SHELL.trim() : "";
  if (preferred && fs.existsSync(preferred)) return preferred;
  if (fs.existsSync("/bin/zsh")) return "/bin/zsh";
  return "/bin/bash";
}

async function createEmbeddedTerminalSession(input = {}) {
  const kind = input?.kind === "codex" ? "codex" : "shell";
  const requestedCwd = typeof input?.cwd === "string" ? input.cwd.trim() : "";
  const cwd = requestedCwd && fs.existsSync(requestedCwd) ? requestedCwd : os.homedir();
  const shellPath = resolveInteractiveShellPath();
  const shellName = path.basename(shellPath);
  const title =
    typeof input?.title === "string" && input.title.trim()
      ? input.title.trim()
      : kind === "codex"
        ? "codex-cli"
        : `${shellName}-${interactiveTerminalSequence + 1}`;

  ensureNodePtySpawnHelperExecutable();
  let ptyProcess;
  try {
    ptyProcess = nodePty.spawn(shellPath, ["-i"], {
      name: "xterm-256color",
      cols: 100,
      rows: 30,
      cwd,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        FORCE_COLOR: "1",
        CLICOLOR_FORCE: "1",
      },
    });
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }

  const session = createInteractiveTerminalSession(kind, ptyProcess, cwd, title);
  session.chunks.push(
    kind === "codex"
      ? `\u001b[90mcodex-cli ready at ${cwd}\u001b[0m\r\n`
      : `\u001b[90mshell ready at ${cwd}\u001b[0m\r\n`,
  );

  ptyProcess.onData((chunk) => {
    const normalized = normalizeInteractiveChunk(typeof chunk === "string" ? chunk : String(chunk));
    if (!normalized) return;
    session.chunks.push(normalized);
    if (session.chunks.length > 3200) {
      session.chunks = session.chunks.slice(-3200);
    }
  });
  ptyProcess.onExit(({ exitCode }) => {
    finalizeInteractiveTerminalSession(session, exitCode, null);
  });
  if (kind === "codex") {
    setTimeout(() => {
      try {
        if (!session.done) session.ptyProcess.write("codex --no-alt-screen\r");
      } catch {}
    }, 220);
  }

  return {
    sessionId: session.sessionId,
    kind: session.kind,
    title: session.title,
    cwd: session.cwd,
    startedAt: session.startedAt,
  };
}

async function pollEmbeddedTerminalSession(input = {}) {
  const sessionId = typeof input.sessionId === "string" ? input.sessionId.trim() : "";
  const cursor = Number.isInteger(input.cursor) ? Number(input.cursor) : 0;
  const session = interactiveTerminalSessions.get(sessionId);
  if (!session) {
    return {
      sessionId,
      kind: "shell",
      title: "shell",
      cwd: os.homedir(),
      startedAt: Date.now(),
      finishedAt: Date.now(),
      exitCode: 1,
      done: true,
      error: "Terminal session not found.",
      chunks: [],
      cursor,
    };
  }

  const safeCursor = Math.max(0, Math.min(cursor, session.chunks.length));
  return {
    sessionId: session.sessionId,
    kind: session.kind,
    title: session.title,
    cwd: session.cwd,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    exitCode: session.exitCode,
    done: session.done,
    error: session.error,
    chunks: session.chunks.slice(safeCursor),
    cursor: session.chunks.length,
  };
}

async function sendEmbeddedTerminalInput(input = {}) {
  const sessionId = typeof input.sessionId === "string" ? input.sessionId.trim() : "";
  const text = typeof input.text === "string" ? input.text : "";
  const appendNewline = input.appendNewline !== false;
  const session = interactiveTerminalSessions.get(sessionId);
  if (!session) {
    return { ok: false, error: "Terminal session not found." };
  }
  if (session.done) {
    return { ok: false, error: "Terminal session already closed." };
  }
  try {
    session.ptyProcess.write(`${text}${appendNewline ? "\r" : ""}`);
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function resizeEmbeddedTerminalSession(input = {}) {
  const sessionId = typeof input.sessionId === "string" ? input.sessionId.trim() : "";
  const cols = Math.max(20, Number(input.cols) || 80);
  const rows = Math.max(8, Number(input.rows) || 24);
  const session = interactiveTerminalSessions.get(sessionId);
  if (!session) {
    return { ok: false, error: "Terminal session not found." };
  }
  if (session.done) {
    return { ok: false, error: "Terminal session already closed." };
  }
  try {
    session.ptyProcess.resize(cols, rows);
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function closeEmbeddedTerminalSession(input = {}) {
  const sessionId = typeof input.sessionId === "string" ? input.sessionId.trim() : "";
  const session = interactiveTerminalSessions.get(sessionId);
  if (!session) {
    return { ok: true, error: null };
  }
  try {
    if (!session.done) {
      session.ptyProcess.kill("SIGTERM");
      setTimeout(() => {
        try {
          if (!session.done) session.ptyProcess.kill("SIGKILL");
        } catch {}
      }, 800);
    }
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function startLiveOpenclawSession(commandArgs, options = {}) {
  const args = Array.isArray(commandArgs) ? commandArgs.filter((entry) => typeof entry === "string" && entry.trim().length > 0) : [];
  const cwd = typeof options.workdir === "string" && options.workdir.trim() ? options.workdir : repoRootPath;
  const pseudoTty = options.pseudoTty === true;
  const command = `openclaw ${args.join(" ")}`.trim();
  const child = pseudoTty
    ? spawn("script", ["-q", "/dev/null", "openclaw", ...args], {
        cwd,
        env: {
          ...process.env,
          FORCE_COLOR: "1",
          CLICOLOR_FORCE: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      })
    : spawn("openclaw", args, {
        cwd,
        env: {
          ...process.env,
          FORCE_COLOR: "1",
          CLICOLOR_FORCE: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
  const session = createLiveSession(command, child);

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    session.stdoutBuffer += sanitizeLiveChunk(typeof chunk === "string" ? chunk : String(chunk));
    flushLiveBuffer(session, "stdout", false);
  });
  child.stderr.on("data", (chunk) => {
    session.stderrBuffer += sanitizeLiveChunk(typeof chunk === "string" ? chunk : String(chunk));
    flushLiveBuffer(session, "stderr", false);
  });
  child.on("error", (error) => {
    finalizeLiveSession(session, 1, error instanceof Error ? error.message : String(error));
  });
  child.on("close", (code) => {
    finalizeLiveSession(session, code, null);
  });

  return {
    sessionId: session.sessionId,
    command: session.command,
    startedAt: session.startedAt,
  };
}

function pollLiveOpenclawSession(input = {}) {
  const sessionId = typeof input.sessionId === "string" ? input.sessionId.trim() : "";
  const cursor = Number.isInteger(input.cursor) ? Number(input.cursor) : 0;
  const session = liveCommandSessions.get(sessionId);
  if (!session) {
    return {
      sessionId,
      command: "",
      startedAt: Date.now(),
      finishedAt: Date.now(),
      exitCode: 1,
      done: true,
      error: "Session not found.",
      lines: [],
      cursor,
      parsedJson: null,
    };
  }

  const safeCursor = Math.max(0, Math.min(cursor, session.lines.length));
  return {
    sessionId: session.sessionId,
    command: session.command,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    exitCode: session.exitCode,
    done: session.done,
    error: session.error,
    lines: session.lines.slice(safeCursor),
    cursor: session.lines.length,
    parsedJson: session.done ? session.parsedJson : null,
  };
}

function normalizeOpenclawCommandText(input) {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) return [];
  const stripped = raw.replace(/^\/?openclaw\s+/i, "").trim();
  const normalized = stripped
    .replace(/^show\s+models\s+-all$/i, "models list --all")
    .replace(/^show\s+models\s+--all$/i, "models list --all")
    .replace(/^show\s+skills$/i, "skills list")
    .replace(/^show\s+plugins$/i, "plugins list --verbose");
  return normalized.split(/\s+/).filter(Boolean);
}

function findBalancedJsonSlice(value, startIndex) {
  if (typeof value !== "string" || startIndex < 0 || startIndex >= value.length) return null;
  const first = value[startIndex];
  if (first !== "{" && first !== "[") return null;

  const stack = [];
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < value.length; index += 1) {
    const char = value[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{" || char === "[") {
      stack.push(char);
      continue;
    }

    if (char === "}" || char === "]") {
      const opening = stack.at(-1);
      if (!opening) return null;
      if (opening === "{" && char !== "}") return null;
      if (opening === "[" && char !== "]") return null;
      stack.pop();
      if (stack.length === 0) {
        return value.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function extractJsonPayloadFromMixedOutput(value) {
  if (typeof value !== "string" || !value.trim()) return null;

  let best = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char !== "{" && char !== "[") continue;
    const candidate = findBalancedJsonSlice(value, index);
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (!best || candidate.length > best.raw.length) {
        best = {
          raw: candidate,
          parsed,
        };
      }
    } catch {}
  }

  return best?.parsed ?? null;
}

async function runOpenclawCommand(commandArgs, options = {}) {
  const args = Array.isArray(commandArgs) ? commandArgs : [];
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 45_000);
  const startedAt = Date.now();

  const result = await new Promise((resolve) => {
    execFile(
      "openclaw",
      args,
      {
        cwd: typeof options.workdir === "string" && options.workdir.trim() ? options.workdir : repoRootPath,
        env: {
          ...process.env,
          FORCE_COLOR: "1",
          CLICOLOR_FORCE: "1",
        },
        encoding: "utf8",
        timeout: timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        resolve({
          error: error || null,
          stdout: typeof stdout === "string" ? stdout : "",
          stderr: typeof stderr === "string" ? stderr : "",
        });
      },
    );
  });

  const finishedAt = Date.now();
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  const exitCode =
    result.error && Number.isInteger(result.error.code)
      ? Number(result.error.code)
      : result.error
        ? 1
        : 0;
  const command = `openclaw ${args.join(" ")}`.trim();
  const errorText =
    result.error && result.error.message
      ? result.error.message
      : result.error
        ? String(result.error)
        : "";

  return {
    command,
    args,
    startedAt,
    finishedAt,
    durationMs: Math.max(0, finishedAt - startedAt),
    exitCode,
    stdout,
    stderr,
    error: errorText || null,
  };
}

async function runOpenclawJsonCommand(commandArgs, options = {}) {
  const outcome = await runOpenclawCommand(commandArgs, options);
  const mixed = [outcome.stdout, outcome.stderr].filter(Boolean).join("\n");
  return {
    ...outcome,
    parsed: extractJsonPayloadFromMixedOutput(mixed),
  };
}

function resolvePersonalAgent(config) {
  if (!config || typeof config !== "object") return null;
  const list = Array.isArray(config?.agents?.list) ? config.agents.list : [];
  const personal = list.find((entry) => entry && entry.id === "personal");
  if (!personal || typeof personal !== "object") return null;
  return personal;
}

function normalizeToolListInput(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const values = [];
  for (const entry of input) {
    if (typeof entry !== "string") continue;
    const value = entry.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    values.push(value);
  }
  return values;
}

function extractPersonalToolsConfig(personal) {
  return {
    allow: normalizeToolListInput(personal?.tools?.allow),
    deny: normalizeToolListInput(personal?.tools?.deny),
  };
}

function collectKnownModelIds(config, personal) {
  const modelSet = new Set();
  const configuredModels =
    config && typeof config === "object" && config?.agents?.defaults?.models && typeof config.agents.defaults.models === "object"
      ? Object.keys(config.agents.defaults.models)
      : [];

  for (const key of configuredModels) {
    if (typeof key === "string" && key.trim()) modelSet.add(key.trim());
  }

  const primary = typeof personal?.model?.primary === "string" ? personal.model.primary.trim() : "";
  if (primary) modelSet.add(primary);

  const fallbacks = Array.isArray(personal?.model?.fallbacks) ? personal.model.fallbacks : [];
  for (const fallback of fallbacks) {
    if (typeof fallback === "string" && fallback.trim()) modelSet.add(fallback.trim());
  }

  return [...modelSet];
}

async function getConfigSnapshot() {
  const config = readJson(configPath, {});
  const authSummary = buildAuthAccountsSummary(config);
  let personal = resolvePersonalAgent(config);
  let gateway = {
    mode: typeof config?.gateway?.mode === "string" ? config.gateway.mode : "",
    bind: typeof config?.gateway?.bind === "string" ? config.gateway.bind : "",
    port: Number(config?.gateway?.port) || 18789,
    token: typeof config?.gateway?.auth?.token === "string" ? config.gateway.auth.token : "",
  };
  let knownModelIds = personal ? collectKnownModelIds(config, personal) : [];

  if (!personal) {
    const [listOutcome, modeOutcome, bindOutcome, portOutcome, tokenOutcome, defaultsModelsOutcome] = await Promise.all([
      runOpenclawJsonCommand(["config", "get", "agents.list", "--json"], { timeoutMs: 12_000 }),
      runOpenclawJsonCommand(["config", "get", "gateway.mode", "--json"], { timeoutMs: 12_000 }),
      runOpenclawJsonCommand(["config", "get", "gateway.bind", "--json"], { timeoutMs: 12_000 }),
      runOpenclawJsonCommand(["config", "get", "gateway.port", "--json"], { timeoutMs: 12_000 }),
      runOpenclawJsonCommand(["config", "get", "gateway.auth.token", "--json"], { timeoutMs: 12_000 }),
      runOpenclawJsonCommand(["config", "get", "agents.defaults.models", "--json"], { timeoutMs: 12_000 }),
    ]);
    const listFromCli = listOutcome.parsed;
    if (Array.isArray(listFromCli)) {
      personal = listFromCli.find((entry) => entry && entry.id === "personal") || null;
    }

    const modeFromCli = modeOutcome.parsed;
    const bindFromCli = bindOutcome.parsed;
    const portFromCli = portOutcome.parsed;
    const tokenFromCli = tokenOutcome.parsed;
    gateway = {
      mode: typeof modeFromCli === "string" ? modeFromCli : gateway.mode,
      bind: typeof bindFromCli === "string" ? bindFromCli : gateway.bind,
      port: Number(portFromCli) || gateway.port,
      token: typeof tokenFromCli === "string" ? tokenFromCli : gateway.token,
    };

    const defaultsModelsFromCli = defaultsModelsOutcome.parsed;
    const defaultsModelIds =
      defaultsModelsFromCli && typeof defaultsModelsFromCli === "object"
        ? Object.keys(defaultsModelsFromCli).filter((entry) => typeof entry === "string" && entry.trim())
        : [];

    if (personal) {
      const primary = typeof personal?.model?.primary === "string" ? personal.model.primary.trim() : "";
      const fallbacks = Array.isArray(personal?.model?.fallbacks)
        ? personal.model.fallbacks.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim())
        : [];
      knownModelIds = [...new Set([...defaultsModelIds, primary, ...fallbacks].filter(Boolean))];
    } else {
      knownModelIds = [...new Set(defaultsModelIds)];
    }
  }

  if (!personal) {
    return {
      loadedAt: Date.now(),
      configPath,
      authProfilesPath: authSummary.authProfilesPath,
      error: "Agent `personal` is missing in ~/.openclaw/openclaw.json.",
      personal: null,
      gateway,
      knownModelIds,
      authAccounts: authSummary.accounts,
    };
  }

  return {
    loadedAt: Date.now(),
    configPath,
    personal: {
      id: typeof personal.id === "string" ? personal.id : "personal",
      name: typeof personal.name === "string" ? personal.name : "Personal",
      workspace: typeof personal.workspace === "string" ? personal.workspace : "",
      model: {
        primary: typeof personal?.model?.primary === "string" ? personal.model.primary : "",
        fallbacks: Array.isArray(personal?.model?.fallbacks)
          ? personal.model.fallbacks.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim())
          : [],
      },
      tools: extractPersonalToolsConfig(personal),
    },
    gateway,
    knownModelIds: knownModelIds.length > 0 ? knownModelIds : collectKnownModelIds(config, personal),
    authProfilesPath: authSummary.authProfilesPath,
    authAccounts: authSummary.accounts,
  };
}

async function getRuntimeModelState() {
  const [modelStatusOutcome, usageOutcome, modelsCatalogOutcome] = await Promise.all([
    runOpenclawJsonCommand(["models", "status", "--agent", "personal", "--json"], { timeoutMs: 15_000 }),
    runOpenclawJsonCommand(["status", "--usage", "--json"], { timeoutMs: 15_000 }),
    runOpenclawJsonCommand(["models", "list", "--all", "--json"], { timeoutMs: 15_000 }),
  ]);

  const errors = [];
  for (const outcome of [modelStatusOutcome, usageOutcome, modelsCatalogOutcome]) {
    if (outcome.exitCode !== 0) {
      errors.push(`${outcome.command} exited with code ${outcome.exitCode}`);
    } else if (!outcome.parsed) {
      errors.push(`${outcome.command} did not produce JSON payload.`);
    }
  }

  return {
    loadedAt: Date.now(),
    modelStatus: modelStatusOutcome.parsed,
    usage: usageOutcome.parsed,
    modelsCatalog: modelsCatalogOutcome.parsed,
    commands: {
      modelStatus: modelStatusOutcome,
      usage: usageOutcome,
      modelsCatalog: modelsCatalogOutcome,
    },
    errors,
  };
}

const ALLOWED_RUNTIME_COMMANDS = {
  models_all: ["models", "list", "--all"],
  skills_list: ["skills", "list"],
  plugins_list: ["plugins", "list", "--verbose"],
};

async function getProviderRuntimeDetails(input = {}) {
  const provider = typeof input.provider === "string" ? input.provider.trim() : "";
  const modelId = typeof input.modelId === "string" ? input.modelId.trim() : "";
  if (!provider) {
    return {
      ok: false,
      provider,
      modelId,
      paidStatus: "unknown",
      error: "Provider is required.",
      probe: null,
      usageWindows: [],
      context: null,
    };
  }

  const [probeOutcome, usageOutcome] = await Promise.all([
    runOpenclawJsonCommand(
      ["models", "status", "--agent", "personal", "--json", "--probe", "--probe-provider", provider, "--probe-timeout", "5000"],
      { timeoutMs: 25_000 },
    ),
    runOpenclawJsonCommand(["status", "--usage", "--json"], { timeoutMs: 25_000 }),
  ]);

  const probeResults = Array.isArray(probeOutcome.parsed?.auth?.probes?.results)
    ? probeOutcome.parsed.auth.probes.results
    : [];
  const probe = probeResults.find((entry) => String(entry?.provider || "") === provider) || null;
  const unusableProfiles = Array.isArray(probeOutcome.parsed?.auth?.unusableProfiles)
    ? probeOutcome.parsed.auth.unusableProfiles
    : [];
  const unusable = unusableProfiles.find((entry) => String(entry?.provider || "") === provider) || null;

  let paidStatus = "unknown";
  let error = null;
  if (probe?.status === "ok") {
    paidStatus = "paid";
  } else if (unusable || probe?.error) {
    paidStatus = "not_paid";
    error = String(probe?.error || unusable?.reason || "Provider probe failed.");
  } else if (probeOutcome.exitCode !== 0) {
    paidStatus = "not_paid";
    const probeErrorText =
      [probeOutcome.error, probeOutcome.stderr, probeOutcome.stdout]
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .find(Boolean) || `${probeOutcome.command} exited with code ${probeOutcome.exitCode}`;
    error = probeErrorText;
  }

  const usageProviders = Array.isArray(usageOutcome.parsed?.usage?.providers) ? usageOutcome.parsed.usage.providers : [];
  const usageProvider = usageProviders.find((entry) => String(entry?.provider || "") === provider) || null;
  const usageWindows = Array.isArray(usageProvider?.windows) ? usageProvider.windows : [];
  const hasUsageSignal = usageWindows.length > 0 || Boolean(usageProvider?.plan);
  if (paidStatus === "unknown" && !usageProvider?.error && hasUsageSignal) {
    paidStatus = "paid";
  }

  const sessionRows = Array.isArray(usageOutcome.parsed?.sessions?.recent) ? usageOutcome.parsed.sessions.recent : [];
  const matchingSession = sessionRows.find((entry) => {
    if (String(entry?.agentId || "") !== "personal") return false;
    const currentModel = String(entry?.model || "");
    if (modelId && currentModel === modelId) return true;
    if (modelId && currentModel === resolveModelSuffix(modelId)) return true;
    if (modelId) return false;
    return resolveProviderFromModel(currentModel) === provider;
  }) || null;

  return {
    ok: paidStatus === "paid",
    provider,
    modelId,
    paidStatus,
    error,
    probe,
    usageWindows,
    context: matchingSession
      ? {
          model: String(matchingSession.model || modelId || ""),
          percentUsed: Number.isFinite(Number(matchingSession.percentUsed)) ? Number(matchingSession.percentUsed) : null,
          remainingTokens: Number.isFinite(Number(matchingSession.remainingTokens)) ? Number(matchingSession.remainingTokens) : null,
          contextTokens: Number.isFinite(Number(matchingSession.contextTokens)) ? Number(matchingSession.contextTokens) : null,
          totalTokens: Number.isFinite(Number(matchingSession.totalTokens)) ? Number(matchingSession.totalTokens) : null,
        }
      : null,
  };
}

async function runCliCommand(commandId) {
  const args = ALLOWED_RUNTIME_COMMANDS[commandId];
  if (!args) {
    return {
      commandId,
      ok: false,
      error: `Unsupported command id: ${String(commandId)}`,
      exitCode: 1,
      command: "",
      lines: [],
      startedAt: Date.now(),
      finishedAt: Date.now(),
      durationMs: 0,
      stdout: "",
      stderr: "",
      parsedJson: null,
    };
  }

  const outcome = await runOpenclawCommand(args, { timeoutMs: 30_000 });
  const lines = [
    ...splitOutputLines(outcome.stdout).map((text) => ({ stream: "stdout", text })),
    ...splitOutputLines(outcome.stderr).map((text) => ({ stream: "stderr", text })),
  ];

  return {
    commandId,
    ok: outcome.exitCode === 0,
    error: outcome.error,
    exitCode: outcome.exitCode,
    command: outcome.command,
    startedAt: outcome.startedAt,
    finishedAt: outcome.finishedAt,
    durationMs: outcome.durationMs,
    stdout: outcome.stdout,
    stderr: outcome.stderr,
    lines,
    parsedJson: null,
  };
}

async function startOpenclawCommandSession(input = {}) {
  const args = normalizeOpenclawCommandText(input.commandText);
  if (args.length === 0) {
    return {
      sessionId: "",
      command: "",
      startedAt: Date.now(),
    };
  }
  return startLiveOpenclawSession(args, {
    workdir: typeof input.workdir === "string" ? input.workdir : repoRootPath,
    pseudoTty: input.pseudoTty === true,
  });
}

async function pollOpenclawCommandSession(input = {}) {
  return pollLiveOpenclawSession(input);
}

async function startTechChatSession(input = {}) {
  const message = typeof input.message === "string" ? input.message.trim() : "";
  if (!message) {
    return {
      sessionId: "",
      command: "",
      startedAt: Date.now(),
    };
  }
  return startLiveOpenclawSession(
    ["agent", "--local", "--json", "--message", message],
    { workdir: llmHubDevWorkspacePath },
  );
}

function normalizeModelInput(input) {
  return typeof input === "string" ? input.trim() : "";
}

function normalizeFallbacksInput(input) {
  if (!Array.isArray(input)) return [];
  const values = [];
  const seen = new Set();
  for (const item of input) {
    const value = normalizeModelInput(item);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    values.push(value);
  }
  return values;
}

async function savePersonalModelConfig(input = {}) {
  const primary = normalizeModelInput(input.primary);
  const fallbacks = normalizeFallbacksInput(input.fallbacks);
  const startedAt = Date.now();

  if (!primary) {
    return {
      ok: false,
      error: "Primary model is required.",
      startedAt,
      finishedAt: Date.now(),
      stopGateway: null,
      restartGateway: null,
      validateConfig: null,
      savedModel: null,
    };
  }

  const stopGateway = await runOpenclawCommand(["gateway", "stop"], { timeoutMs: 20_000 });
  if (stopGateway.exitCode !== 0) {
    return {
      ok: false,
      error: stopGateway.error || "Failed to stop gateway before config edit.",
      startedAt,
      finishedAt: Date.now(),
      stopGateway,
      restartGateway: null,
      validateConfig: null,
      savedModel: null,
    };
  }

  const listOutcome = await runOpenclawJsonCommand(["config", "get", "agents.list", "--json"], { timeoutMs: 12_000 });
  const list = Array.isArray(listOutcome.parsed) ? listOutcome.parsed : null;
  if (!list) {
    return {
      ok: false,
      error: "Unable to read agents.list from config.",
      startedAt,
      finishedAt: Date.now(),
      stopGateway,
      restartGateway: null,
      validateConfig: null,
      savedModel: null,
    };
  }
  const personalIndex = list.findIndex((entry) => entry && entry.id === "personal");
  if (personalIndex < 0) {
    return {
      ok: false,
      error: "Agent `personal` not found in config.",
      startedAt,
      finishedAt: Date.now(),
      stopGateway,
      restartGateway: null,
      validateConfig: null,
      savedModel: null,
    };
  }
  const primarySet = await runOpenclawCommand(
    ["config", "set", "--strict-json", `agents.list[${personalIndex}].model.primary`, JSON.stringify(primary)],
    { timeoutMs: 12_000 },
  );
  if (primarySet.exitCode !== 0) {
    return {
      ok: false,
      error: primarySet.error || "Failed to set personal primary model.",
      startedAt,
      finishedAt: Date.now(),
      stopGateway,
      restartGateway: null,
      validateConfig: null,
      savedModel: null,
    };
  }

  const fallbacksSet = await runOpenclawCommand(
    ["config", "set", "--strict-json", `agents.list[${personalIndex}].model.fallbacks`, JSON.stringify(fallbacks)],
    { timeoutMs: 12_000 },
  );
  if (fallbacksSet.exitCode !== 0) {
    return {
      ok: false,
      error: fallbacksSet.error || "Failed to set personal fallback models.",
      startedAt,
      finishedAt: Date.now(),
      stopGateway,
      restartGateway: null,
      validateConfig: null,
      savedModel: null,
    };
  }

  const restartGateway = await runOpenclawCommand(["gateway", "restart"], { timeoutMs: 20_000 });
  const validateConfig = await runOpenclawCommand(["config", "validate"], { timeoutMs: 20_000 });
  const finishedAt = Date.now();

  return {
    ok: restartGateway.exitCode === 0 && validateConfig.exitCode === 0,
    error:
      restartGateway.exitCode !== 0
        ? restartGateway.error || "Gateway restart failed after config save."
        : validateConfig.exitCode !== 0
          ? validateConfig.error || "Config validation failed after save."
          : null,
    startedAt,
    finishedAt,
    stopGateway,
    restartGateway,
    validateConfig,
    savedModel: {
      primary,
      fallbacks,
    },
  };
}

async function savePersonalToolPermission(input = {}) {
  const toolId = typeof input.toolId === "string" ? input.toolId.trim() : "";
  const enabled = input.enabled !== false;
  const startedAt = Date.now();

  if (!toolId) {
    return {
      ok: false,
      error: "Tool id is required.",
      startedAt,
      finishedAt: Date.now(),
      durationMs: 0,
      stopGateway: null,
      validateConfig: null,
      savedTools: null,
    };
  }

  const stopGateway = await runOpenclawCommand(["gateway", "stop"], { timeoutMs: 20_000 });
  if (stopGateway.exitCode !== 0) {
    const finishedAt = Date.now();
    return {
      ok: false,
      error: stopGateway.error || "Failed to stop gateway before config edit.",
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      stopGateway,
      validateConfig: null,
      savedTools: null,
    };
  }

  const listOutcome = await runOpenclawJsonCommand(["config", "get", "agents.list", "--json"], { timeoutMs: 12_000 });
  const list = Array.isArray(listOutcome.parsed) ? listOutcome.parsed : null;
  if (!list) {
    const finishedAt = Date.now();
    return {
      ok: false,
      error: "Unable to read agents.list from config.",
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      stopGateway,
      validateConfig: null,
      savedTools: null,
    };
  }

  const personalIndex = list.findIndex((entry) => entry && entry.id === "personal");
  if (personalIndex < 0) {
    const finishedAt = Date.now();
    return {
      ok: false,
      error: "Agent `personal` not found in config.",
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      stopGateway,
      validateConfig: null,
      savedTools: null,
    };
  }

  const currentTools = extractPersonalToolsConfig(list[personalIndex]);
  const allowSet = new Set(currentTools.allow);
  const denySet = new Set(currentTools.deny);

  if (allowSet.has("*")) {
    if (enabled) {
      denySet.delete(toolId);
    } else {
      denySet.add(toolId);
    }
  } else if (enabled) {
    allowSet.add(toolId);
    denySet.delete(toolId);
  } else {
    allowSet.delete(toolId);
    denySet.add(toolId);
  }

  const nextAllow = [...allowSet];
  const nextDeny = [...denySet];

  const allowSetOutcome = await runOpenclawCommand(
    ["config", "set", "--strict-json", `agents.list[${personalIndex}].tools.allow`, JSON.stringify(nextAllow)],
    { timeoutMs: 12_000 },
  );
  if (allowSetOutcome.exitCode !== 0) {
    const finishedAt = Date.now();
    return {
      ok: false,
      error: allowSetOutcome.error || "Failed to update personal tool allow list.",
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      stopGateway,
      validateConfig: null,
      savedTools: null,
    };
  }

  const denySetOutcome = await runOpenclawCommand(
    ["config", "set", "--strict-json", `agents.list[${personalIndex}].tools.deny`, JSON.stringify(nextDeny)],
    { timeoutMs: 12_000 },
  );
  if (denySetOutcome.exitCode !== 0) {
    const finishedAt = Date.now();
    return {
      ok: false,
      error: denySetOutcome.error || "Failed to update personal tool deny list.",
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      stopGateway,
      validateConfig: null,
      savedTools: null,
    };
  }

  const validateConfig = await runOpenclawCommand(["config", "validate"], { timeoutMs: 20_000 });
  const finishedAt = Date.now();

  return {
    ok: validateConfig.exitCode === 0,
    error: validateConfig.exitCode !== 0 ? validateConfig.error || "Config validation failed after save." : null,
    startedAt,
    finishedAt,
    durationMs: finishedAt - startedAt,
    stopGateway,
    validateConfig,
    savedTools: {
      allow: nextAllow,
      deny: nextDeny,
    },
  };
}

function loadDeviceToken() {
  const cached = readJson(deviceTokenPath, null);
  if (!cached || typeof cached.token !== "string" || !cached.token.trim()) return null;
  return cached;
}

function saveDeviceToken(record) {
  if (!record || typeof record.token !== "string" || !record.token.trim()) return;
  writeJson(deviceTokenPath, {
    version: 1,
    savedAt: new Date().toISOString(),
    ...record,
  });
}

function buildSignedDeviceAuth(params) {
  const identity = loadOrCreateDeviceIdentity();
  const signedAtMs = Date.now();
  const payload = buildDeviceAuthPayloadV3({
    deviceId: identity.deviceId,
    clientId: params.clientId,
    clientMode: params.clientMode,
    role: params.role,
    scopes: Array.isArray(params.scopes) ? params.scopes : [],
    signedAtMs,
    token: params.signatureToken ?? "",
    nonce: params.nonce,
    platform: params.platform,
    deviceFamily: params.deviceFamily ?? "",
  });
  const privateKey = crypto.createPrivateKey(identity.privateKeyPem);
  const signature = crypto.sign(null, Buffer.from(payload, "utf8"), privateKey);

  return {
    id: identity.deviceId,
    publicKey: publicKeyRawBase64UrlFromPem(identity.publicKeyPem),
    signature: base64UrlEncode(signature),
    signedAt: signedAtMs,
    nonce: params.nonce,
  };
}

contextBridge.exposeInMainWorld("openclawBootstrap", {
  getRuntimeConfig,
  getAppMeta,
});

contextBridge.exposeInMainWorld("openclawSecureBridge", {
  buildSignedDeviceAuth,
  loadDeviceToken,
  saveDeviceToken,
});

contextBridge.exposeInMainWorld("openclawLogBridge", {
  getGatewayLogSnapshot,
  getGatewayLaunchStatus,
  startGatewayRun,
  stopGatewayRun,
});

contextBridge.exposeInMainWorld("openclawLibraryBridge", {
  getLibrarySnapshot,
  searchLibrary,
  ingestLiterature,
});

contextBridge.exposeInMainWorld("openclawConfigBridge", {
  getConfigSnapshot,
  getRuntimeModelState,
  getProviderRuntimeDetails,
  runCliCommand,
  startOpenclawCommandSession,
  pollOpenclawCommandSession,
  startTechChatSession,
  savePersonalModelConfig,
  savePersonalToolPermission,
});

contextBridge.exposeInMainWorld("openclawAppBridge", {
  hideApp: () => ipcRenderer.invoke("openclaw-app:hide"),
  showApp: () => ipcRenderer.invoke("openclaw-app:show"),
  requestQuit: () => ipcRenderer.invoke("openclaw-app:request-quit"),
});

contextBridge.exposeInMainWorld("openclawTerminalBridge", {
  createSession: createEmbeddedTerminalSession,
  pollSession: pollEmbeddedTerminalSession,
  sendInput: sendEmbeddedTerminalInput,
  resizeSession: resizeEmbeddedTerminalSession,
  closeSession: closeEmbeddedTerminalSession,
});
