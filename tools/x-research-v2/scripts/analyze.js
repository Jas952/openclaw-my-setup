#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = "/Users/dmitriy/openclaw";
const OPENCLAW_X_ROOT = path.join(ROOT, "openclaw_x");
const DEFAULT_ACCOUNTS = path.join(OPENCLAW_X_ROOT, "modules", "accounts", "accounts.json");
const IMAGE_INSIGHT_SWIFT = path.join(__dirname, "image_insight.swift");
const IMAGE_INSIGHT_BIN = path.join(__dirname, ".image_insight_bin");
const FETCH_X_PY = path.join(__dirname, "fetch_x.py");

function parseArgs(argv) {
  const out = {
    profile: "",
    keywords: "",
    tracked: false,
    limit: 10,
    json: false,
    accounts: DEFAULT_ACCOUNTS,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--profile" && argv[i + 1]) out.profile = argv[++i];
    else if (a === "--keywords" && argv[i + 1]) out.keywords = argv[++i];
    else if (a === "--tracked") out.tracked = true;
    else if (a === "--limit" && argv[i + 1]) out.limit = Math.max(1, Number(argv[++i]) || 10);
    else if (a === "--json") out.json = true;
    else if (a === "--accounts" && argv[i + 1]) out.accounts = argv[++i];
  }

  return out;
}

function readAccounts(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(raw);
  const accounts = Array.isArray(data.accounts) ? data.accounts : [];
  return accounts
    .filter((a) => a && a.username)
    .map((a) => ({
      username: String(a.username),
      label: String(a.label || ""),
      enabled: Boolean(a.enabled),
    }));
}


function runProfileFetch(username, limit) {
  try {
    const out = execFileSync("python3", [FETCH_X_PY, "--profile", username, "--limit", String(limit), "--pages", "2", "--attempts", "3"], {
      cwd: ROOT,
      timeout: 60000,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      encoding: "utf8",
    });
    const data = JSON.parse(out);
    const posts = Array.isArray(data.posts) ? data.posts : [];
    const meta = data.meta && typeof data.meta === "object" ? data.meta : {};
    const exhausted = Boolean(meta.retry_exhausted);
    const maxAttempts = Number(meta.max_attempts_per_page || 0);
    const rawErr = String(data.error || meta.error || "");
    const shortErr = compactFetchError(rawErr);
    const error = exhausted
      ? `X сейчас отвечает с ошибкой после ${maxAttempts || 3} попыток. Попробуй позже.${shortErr ? ` (${shortErr})` : ""}`
      : shortErr;
    return { posts: sortLatest(posts).slice(0, limit), error, meta };
  } catch (err) {
    const stderr = compactFetchError(String(err?.stderr || err?.message || ""));
    return { posts: [], error: stderr || "x fetch failed", meta: { retry_exhausted: true, max_attempts_per_page: 3 } };
  }
}

function runKeywordFetch(keywords, limit) {
  const query = keywords
    .map((k) => String(k || "").trim())
    .filter(Boolean)
    .join(" OR ");
  if (!query) return { posts: [], error: "пустой запрос по ключевым словам" };

  try {
    const out = execFileSync("python3", [FETCH_X_PY, "--query", query, "--limit", String(limit), "--pages", "2", "--attempts", "3"], {
      cwd: ROOT,
      timeout: 60000,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      encoding: "utf8",
    });
    const data = JSON.parse(out);
    const posts = Array.isArray(data.posts) ? data.posts : [];
    const meta = data.meta && typeof data.meta === "object" ? data.meta : {};
    const exhausted = Boolean(meta.retry_exhausted);
    const maxAttempts = Number(meta.max_attempts_per_page || 0);
    const rawErr = String(data.error || meta.error || "");
    const shortErr = compactFetchError(rawErr);
    const error = exhausted
      ? `X сейчас отвечает с ошибкой после ${maxAttempts || 3} попыток. Попробуй позже.${shortErr ? ` (${shortErr})` : ""}`
      : shortErr;
    return { posts: sortLatest(posts).slice(0, limit), error, meta };
  } catch (err) {
    const stderr = compactFetchError(String(err?.stderr || err?.message || ""));
    return { posts: [], error: stderr || "x fetch failed", meta: { retry_exhausted: true, max_attempts_per_page: 3 } };
  }
}

function toTs(post) {
  const d1 = Date.parse(post.fetched_at || "");
  if (!Number.isNaN(d1)) return d1;
  const d2 = Date.parse(post.created_at || "");
  if (!Number.isNaN(d2)) return d2;
  return 0;
}

function sortLatest(posts) {
  return posts.sort((a, b) => toTs(b) - toTs(a));
}

function normalizeUser(v) {
  return String(v || "").trim().replace(/^@/, "").toLowerCase();
}

function displayUser(v) {
  return String(v || "").trim().replace(/^@/, "");
}

function cleanupText(v) {
  return String(v || "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function compactFetchError(rawErr) {
  const text = cleanupText(rawErr);
  if (!text) return "x fetch failed";
  if (text.includes("X сейчас отвечает с ошибкой после")) return text;
  if (text.includes("twitter fetch failed after")) return text;
  if (text.includes("all SearchTimeline methods failed")) return "all SearchTimeline methods failed";
  if (text.includes("missing X auth config")) return "missing X auth config (cookies/headers)";
  if (text.includes("HTTP Error 401")) return "ошибка авторизации X API (401)";
  if (text.includes("HTTP Error 403")) return "доступ к X API отклонен (403)";
  if (text.includes("HTTP Error 429")) return "лимит запросов X API (429)";
  if (text.includes("URLError") || text.includes("nodename nor servname") || text.includes("lookup x.com: no such host")) {
    return "network/dns error while reaching x.com";
  }
  if (text.length > 220) return `${text.slice(0, 219)}…`;
  return text;
}

function detectTone(posts) {
  const pos = ["bull", "long", "growth", "up", "buy", "strong", "recover", "positive", "optim", "рост", "сильн", "позитив", "лонг"];
  const neg = ["bear", "short", "drop", "down", "sell", "risk", "weak", "negative", "crash", "паден", "риск", "слаб", "шорт"];
  let score = 0;

  posts.forEach((p) => {
    const t = cleanupText(p.text).toLowerCase();
    pos.forEach((k) => {
      if (t.includes(k)) score += 1;
    });
    neg.forEach((k) => {
      if (t.includes(k)) score -= 1;
    });
  });

  if (score >= 2) return "в целом осторожно-позитивный";
  if (score <= -2) return "скорее напряженно-осторожный";
  return "смешанный";
}

function markdownPostLink(idx, post) {
  const url = String(post.tweet_url || "").trim();
  if (!url) return "*";
  return `[*](${url})`;
}

function inferIsReply(post) {
  const text = String(post.text || "").trim();
  const explicitType = String(post.type || "").toLowerCase();
  if (explicitType === "reply") return true;
  if (text.startsWith("@") && post.conversation_id && String(post.conversation_id) !== String(post.id)) return true;
  return false;
}

function buildConversationIndex(allPosts) {
  const map = new Map();
  for (const p of allPosts) {
    const cid = String(p.conversation_id || p.id || "").trim();
    if (!cid) continue;
    if (!map.has(cid)) map.set(cid, []);
    map.get(cid).push(p);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => toTs(a) - toTs(b));
  }
  return map;
}

function summarizeSimpleRu(text) {
  const clean = cleanupText(text);
  const t = clean.toLowerCase();

  if (!clean) return "без текста";
  if (t.includes("orderbook") || (t.includes("sell pressure") && t.includes("price"))) {
    return "про давление продавцов и риск слабого роста";
  }
  if ((t.includes("friday") && t.includes("weekend")) || t.includes("weekend weakness")) {
    return "про недельный ритм: пятница сильнее, выходные слабее";
  }
  if (t.includes("pivot") || ((t.includes("monday") || t.includes("mon")) && (t.includes("thursday") || t.includes("thu")))) {
    return "про смещение опорного дня недели";
  }
  if (t.includes("$btc") || t.includes(" btc") || t.startsWith("btc")) {
    return "про текущий сценарий по BTC";
  }
  if (t.includes("$eth") || t.includes(" eth") || t.startsWith("eth")) {
    return "про текущий сценарий по ETH";
  }

  return clean.length > 90 ? `${clean.slice(0, 89)}…` : clean;
}

function deriveTextSummaryRu(clean) {
  if (!clean) return "без явного текста";

  const parts = clean
    .split(/[\n.!?]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  let lead = parts[0] || clean;
  if (lead.length < 28 && parts[1]) {
    lead = `${lead}. ${parts[1]}`;
  }

  lead = lead
    .replace(/\$([A-Za-z0-9_]+)/g, "$1")
    .replace(/\bLTF\b/gi, "коротком таймфрейме")
    .replace(/\bHTF\b/gi, "старшем таймфрейме")
    .replace(/\blongs?\b/gi, "лонги")
    .replace(/\bshorts?\b/gi, "шорты")
    .replace(/\breversal\b/gi, "разворот")
    .replace(/\bflip\b/gi, "закрепление")
    .replace(/\s+/g, " ")
    .trim();

  if (lead.length > 170) {
    lead = `${lead.slice(0, 169)}…`;
  }
  return lead;
}

function getThreadContext(post, convIndex) {
  const cid = String(post.conversation_id || post.id || "").trim();
  if (!cid || !convIndex.has(cid)) return null;

  const chain = convIndex.get(cid);
  const myUser = normalizeUser(post.username);
  const ts = toTs(post);
  const mentionMatch = String(post.text || "").trim().match(/^@([A-Za-z0-9_]+)/);
  const mentionedUser = mentionMatch ? displayUser(mentionMatch[1]) : "";

  const foreignBefore = chain
    .filter((x) => normalizeUser(x.username) !== myUser && toTs(x) <= ts)
    .sort((a, b) => toTs(b) - toTs(a))[0];

  if (foreignBefore) {
    return {
      hasContext: true,
      otherUser: displayUser(foreignBefore.username),
      otherSummary: summarizeSimpleRu(foreignBefore.text),
    };
  }

  if (mentionedUser && normalizeUser(mentionedUser) !== myUser) {
    return {
      hasContext: true,
      otherUser: mentionedUser,
      otherSummary: "короткий комментарий в треде",
    };
  }

  const root = chain.find((x) => String(x.id) === String(post.conversation_id));
  if (root && normalizeUser(root.username) !== myUser) {
    return {
      hasContext: true,
      otherUser: displayUser(root.username),
      otherSummary: summarizeSimpleRu(root.text),
    };
  }

  return null;
}

const imageInsightCache = new Map();
let imageInsightExecutable = "";

function ensureImageInsightBinary() {
  if (imageInsightExecutable) return imageInsightExecutable;
  if (!fs.existsSync(IMAGE_INSIGHT_SWIFT)) return "";

  const needBuild =
    !fs.existsSync(IMAGE_INSIGHT_BIN) ||
    fs.statSync(IMAGE_INSIGHT_BIN).mtimeMs < fs.statSync(IMAGE_INSIGHT_SWIFT).mtimeMs;

  if (needBuild) {
    try {
      execFileSync("swiftc", [IMAGE_INSIGHT_SWIFT, "-O", "-o", IMAGE_INSIGHT_BIN], {
        timeout: 120000,
        maxBuffer: 4 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      return "";
    }
  }

  imageInsightExecutable = fs.existsSync(IMAGE_INSIGHT_BIN) ? IMAGE_INSIGHT_BIN : "";
  return imageInsightExecutable;
}

function resolveLocalMediaPath(localPath) {
  const raw = String(localPath || "").trim();
  if (!raw) return "";
  if (path.isAbsolute(raw)) return raw;
  return path.join(OPENCLAW_X_ROOT, raw);
}

function readImageInsight(absPath) {
  if (!absPath || !fs.existsSync(absPath)) return null;
  if (imageInsightCache.has(absPath)) return imageInsightCache.get(absPath);

  const bin = ensureImageInsightBinary();
  if (!bin) {
    imageInsightCache.set(absPath, null);
    return null;
  }

  try {
    const out = execFileSync(bin, [absPath], {
      encoding: "utf8",
      timeout: 10000,
      maxBuffer: 2 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const data = JSON.parse(out);
    imageInsightCache.set(absPath, data);
    return data;
  } catch {
    imageInsightCache.set(absPath, null);
    return null;
  }
}

function imageNoteRu(post) {
  const media = Array.isArray(post.media) ? post.media : [];
  const photo = media.find((m) => String(m.type || "").toLowerCase() === "photo" && m.local_path);
  if (!photo) return "";

  const abs = resolveLocalMediaPath(photo.local_path);
  const insight = readImageInsight(abs);
  if (!insight) {
    return "На изображении есть доп.контекст, но локальный OCR сейчас недоступен.";
  }

  const ocr = cleanupText(String(insight.ocr || ""));
  const labels = Array.isArray(insight.labels) ? insight.labels : [];

  if (ocr) {
    const trimmed = ocr.length > 100 ? `${ocr.slice(0, 99)}…` : ocr;
    return `По изображению читается текст: «${trimmed}».`;
  }

  if (labels.length > 0) {
    const hint = labels.slice(0, 2).join(", ");
    return `По изображению: вероятно ${hint}.`;
  }

  return "В посте есть изображение, но без явного распознанного текста.";
}

function rawPostText(post) {
  const src = String(post.text || "").replace(/\s+/g, " ").trim();
  if (!src) return "без текста";
  return src;
}

function postSummaryRu(post, threadCtx) {
  let base = rawPostText(post);
  if (inferIsReply(post) && threadCtx && threadCtx.hasContext) {
    base = `Ответ @${threadCtx.otherUser}: ${base}`;
  }

  const img = imageNoteRu(post);
  if (img) return `${base} ${img}`;
  return base;
}

function printProfile(displayUsername, posts, convIndex, fetchError) {
  console.log(`Провожу серч для последних ${posts.length} постов от @${displayUsername}`);
  console.log("");

  if (posts.length === 0) {
    if (fetchError) {
      console.log(`Поиск по X завершился с ошибкой: ${fetchError}`);
    } else {
      console.log("Поиск по X не вернул посты для этого профиля.");
    }
    if (!fetchError) {
      console.log("Проверь auth-переменные openclaw_x (cookies/headers) и повтори запрос.");
    }
    return;
  }

  console.log(`Ключевые темы ${posts.length} постов:`);
  console.log("");

  posts.forEach((p, idx) => {
    const tctx = getThreadContext(p, convIndex);
    console.log(`${idx + 1}. ${postSummaryRu(p, tctx)} | ${markdownPostLink(idx, p)}`);
  });
}

function printKeywords(keywords, posts, convIndex, fetchError) {
  const list = keywords.join(", ");
  console.log(`Провожу серч по ключевым словам: ${list}. Нашел ${posts.length} последних совпадений.`);
  console.log("");

  if (posts.length === 0) {
    if (fetchError) {
      console.log(`Поиск по этим ключам завершился с ошибкой: ${fetchError}`);
    } else {
      console.log("Поиск по этим ключам не вернул посты.");
    }
    if (!fetchError) {
      console.log("Проверь auth-переменные openclaw_x (cookies/headers) и повтори запрос.");
    }
    return;
  }

  console.log(`Ключевые темы ${posts.length} постов:`);
  console.log("");

  posts.forEach((p, idx) => {
    const user = normalizeUser(p.username) || "unknown";
    const tctx = getThreadContext(p, convIndex);
    console.log(`${idx + 1}. @${user}: ${postSummaryRu(p, tctx)} | ${markdownPostLink(idx, p)}`);
  });
}

function run() {
  const args = parseArgs(process.argv.slice(2));
  const forceJsonForResearch = process.env.X_RESEARCH_TEXT_MODE !== "1";
  if (forceJsonForResearch && (args.profile || args.keywords)) {
    args.json = true;
  }

  if (args.tracked) {
    if (!fs.existsSync(args.accounts)) {
      throw new Error(`accounts JSON not found: ${args.accounts}`);
    }

    const tracked = readAccounts(args.accounts);
    const enabled = tracked.filter((a) => a.enabled);

    if (args.json) {
      console.log(JSON.stringify({ total: tracked.length, enabled: enabled.length, accounts: tracked }, null, 2));
      return;
    }

    console.log(`Отслеживаемые аккаунты: всего ${tracked.length} | включено ${enabled.length} | выключено ${tracked.length - enabled.length}`);
    tracked.forEach((a, i) => {
      const suffix = a.label ? ` (${a.label})` : "";
      const state = a.enabled ? "включен" : "выключен";
      console.log(`${i + 1}. @${a.username}${suffix} - ${state}`);
    });
    return;
  }

  if (args.profile) {
    const username = normalizeUser(args.profile);
    const displayUsername = displayUser(args.profile);
    const fetch = runProfileFetch(displayUsername, args.limit);
    const filtered = fetch.posts;
    const convIndex = buildConversationIndex(filtered);

    if (args.json) {
      console.log(JSON.stringify({ mode: "profile", profile: username, count: filtered.length, posts: filtered, fetch_error: fetch.error || "", fetch_meta: fetch.meta || {} }, null, 2));
      return;
    }

    printProfile(displayUsername, filtered, convIndex, fetch.error);
    return;
  }

  if (args.keywords) {
    const keywords = args.keywords
      .split(",")
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);
    const fetch = runKeywordFetch(keywords, args.limit);
    const filtered = fetch.posts;
    const convIndex = buildConversationIndex(filtered);

    if (args.json) {
      console.log(JSON.stringify({ mode: "keywords", keywords, count: filtered.length, posts: filtered, fetch_error: fetch.error || "", fetch_meta: fetch.meta || {} }, null, 2));
      return;
    }

    printKeywords(keywords, filtered, convIndex, fetch.error);
    return;
  }

  console.error("Usage:");
  console.error("  --profile <username> [--limit N] [--json]");
  console.error("  --keywords \"btc,etf\" [--limit N] [--json]");
  console.error("  --tracked [--json]");
  console.error("Options:");
  console.error("  --accounts <accounts.json path>");
  process.exit(1);
}

try {
  run();
} catch (err) {
  console.error(`[x-research-v2] ${err.message}`);
  process.exit(2);
}
