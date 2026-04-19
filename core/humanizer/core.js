"use strict";

const DEFAULTS = {
  enabled: true,
  channels: ["telegram"],
  targetPeerIds: [],
  minChars: 900,
  minWords: 140,
  minSentences: 4,
  skipWhenCodeBlocks: true,
  skipWhenMostlyStructured: true,
  structuredRatioThreshold: 0.45,
  maxEditRatio: 0.35,
  normalizeEmDash: true,
  removeStockPhrases: true,
  reduceHedging: true,
  rewriteRuleOfThree: true,
  dryRun: false,
  debug: false
};

const STOCK_RULES = [
  // Remove reflexive apology at the start when it adds no value.
  {
    id: "stock_leading_apology_en",
    pattern: /^\s*(?:sorry|my apologies)[^.!?\n]*[.!?]\s*/i,
    replace: ""
  },
  {
    id: "stock_leading_apology_ru",
    pattern: /^\s*(?:извини(?:те)?|прошу прощения)[^.!?\n]*[.!?]\s*/i,
    replace: ""
  },
  // Drop promise-only lead-ins that stall the answer.
  {
    id: "stock_leading_promise_en",
    pattern:
      /^\s*(?:i(?:\s+will|'ll)|let me)\s+(?:check|verify|look(?:\s+into)?|take a look)[^.!?\n]*[.!?]\s*/i,
    replace: ""
  },
  {
    id: "stock_leading_promise_ru",
    pattern:
      /^\s*(?:сейчас|щас)\s+(?:проверю|посмотрю|гляну|проверим|посмотрим|глянем)[^.!?\n]*[.!?]\s*/i,
    replace: ""
  },
  // Remove generic trailing filler options.
  {
    id: "stock_trailing_if_you_want_en",
    pattern: /(?:\n|^)\s*if you want[^.!?\n]*[.!?]?\s*$/i,
    replace: ""
  },
  {
    id: "stock_trailing_if_you_want_ru",
    pattern: /(?:\n|^)\s*если хоч(?:ешь|ете)[^.!?\n]*[.!?]?\s*$/i,
    replace: ""
  },
  { id: "stock_end_of_day", pattern: /\bat the end of the day\b/gi, replace: "ultimately" },
  { id: "stock_worth_noting", pattern: /\bit'?s worth noting(?: that)?\b[:,]?\s*/gi, replace: "" },
  { id: "stock_important_to_note", pattern: /\bit is important to note(?: that)?\b[:,]?\s*/gi, replace: "" },
  { id: "stock_should_be_noted", pattern: /\bit should be noted(?: that)?\b[:,]?\s*/gi, replace: "" },
  { id: "stock_in_conclusion", pattern: /\bin conclusion\b[:,]?\s*/gi, replace: "in short, " },
  { id: "stock_to_be_honest", pattern: /\bto be honest\b[:,]?\s*/gi, replace: "" },
  { id: "stock_transparent", pattern: /\bto be completely transparent\b[:,]?\s*/gi, replace: "" },
  { id: "stock_delve", pattern: /\bdelve into\b/gi, replace: "look into" },
  { id: "stock_leverage", pattern: /\bleverage\b/gi, replace: "use" },
  { id: "stock_tapestry", pattern: /\b(?:rich )?tapestry\b/gi, replace: "mix" }
];

const HEDGING_RULES = [
  { id: "hedge_may_potentially", pattern: /\bmay potentially\b/gi, replace: "may" },
  { id: "hedge_might_potentially", pattern: /\bmight potentially\b/gi, replace: "might" },
  { id: "hedge_often_can", pattern: /\boften can\b/gi, replace: "can" },
  { id: "hedge_can_often", pattern: /\bcan often\b/gi, replace: "can" },
  { id: "hedge_it_appears", pattern: /\bit appears that\b/gi, replace: "it seems" },
  { id: "hedge_somewhat", pattern: /\bsomewhat\s+/gi, replace: "" }
];

const RULE_OF_THREE_PATTERN =
  /\b([A-Za-z][A-Za-z-]*(?:\s+[A-Za-z][A-Za-z-]*){0,2}),\s+([A-Za-z][A-Za-z-]*(?:\s+[A-Za-z][A-Za-z-]*){0,2}),\s+and\s+([A-Za-z][A-Za-z-]*(?:\s+[A-Za-z][A-Za-z-]*){0,2})\b/g;

function normalizeList(value, fallback = []) {
  return Array.isArray(value)
    ? value
        .map((x) => String(x || "").trim())
        .filter(Boolean)
    : fallback.slice();
}

function mergeConfig(raw) {
  const cfg = { ...DEFAULTS, ...(raw && typeof raw === "object" ? raw : {}) };
  cfg.channels = normalizeList(cfg.channels, DEFAULTS.channels);
  cfg.targetPeerIds = normalizeList(cfg.targetPeerIds, DEFAULTS.targetPeerIds);
  cfg.minChars = toPositiveNumber(cfg.minChars, DEFAULTS.minChars);
  cfg.minWords = toPositiveNumber(cfg.minWords, DEFAULTS.minWords);
  cfg.minSentences = toPositiveNumber(cfg.minSentences, DEFAULTS.minSentences);
  cfg.structuredRatioThreshold = clampNumber(cfg.structuredRatioThreshold, 0, 1, DEFAULTS.structuredRatioThreshold);
  cfg.maxEditRatio = clampNumber(cfg.maxEditRatio, 0, 1, DEFAULTS.maxEditRatio);
  cfg.enabled = cfg.enabled !== false;
  cfg.skipWhenCodeBlocks = cfg.skipWhenCodeBlocks !== false;
  cfg.skipWhenMostlyStructured = cfg.skipWhenMostlyStructured !== false;
  cfg.normalizeEmDash = cfg.normalizeEmDash !== false;
  cfg.removeStockPhrases = cfg.removeStockPhrases !== false;
  cfg.reduceHedging = cfg.reduceHedging !== false;
  cfg.rewriteRuleOfThree = cfg.rewriteRuleOfThree !== false;
  cfg.dryRun = cfg.dryRun === true;
  cfg.debug = cfg.debug === true;
  return cfg;
}

function toPositiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function countWords(text) {
  const matches = String(text).match(/[A-Za-z0-9_\u0400-\u04FF]+/g);
  return matches ? matches.length : 0;
}

function countSentences(text) {
  const matches = String(text).match(/[.!?]+(?:\s|$)/g);
  return matches ? matches.length : 0;
}

function hasCodeBlocks(text) {
  return /```/.test(String(text));
}

function structuredLineRatio(text) {
  const lines = String(text)
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

  if (lines.length === 0) return 0;

  let structured = 0;
  for (const line of lines) {
    if (/^[-*+]\s+/.test(line)) {
      structured += 1;
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      structured += 1;
      continue;
    }
    if (/^\|.*\|$/.test(line)) {
      structured += 1;
      continue;
    }
    if (/^#{1,6}\s+/.test(line)) {
      structured += 1;
      continue;
    }
  }

  return structured / lines.length;
}

function peerVariants(peerId) {
  const raw = String(peerId || "").trim();
  if (!raw) return [];

  const variants = new Set([raw]);
  const topicMarker = ":topic:";
  const markerIdx = raw.indexOf(topicMarker);
  if (markerIdx > 0) {
    variants.add(raw.slice(0, markerIdx));
  }

  return Array.from(variants);
}

function peerAllowed(to, allowedPeerIds) {
  if (!allowedPeerIds.length) return true;

  const targetVariants = peerVariants(to);
  if (targetVariants.length === 0) return false;

  const allowed = new Set();
  for (const peerId of allowedPeerIds) {
    for (const v of peerVariants(peerId)) {
      allowed.add(v);
    }
  }

  return targetVariants.some((v) => allowed.has(v));
}

function shouldProcess(text, cfg, context = {}) {
  if (!cfg.enabled) return { ok: false, reason: "disabled" };

  const channelId = String(context.channelId || "").trim();
  if (cfg.channels.length > 0 && channelId && !cfg.channels.includes(channelId)) {
    return { ok: false, reason: "channel_filtered" };
  }

  const to = String(context.to || "").trim();
  if (!peerAllowed(to, cfg.targetPeerIds)) {
    return { ok: false, reason: cfg.targetPeerIds.length > 0 ? "target_filtered" : "target_missing" };
  }

  const words = countWords(text);
  const sentences = countSentences(text);
  const longEnough = text.length >= cfg.minChars || words >= cfg.minWords;

  if (!longEnough) return { ok: false, reason: "too_short", words, sentences };
  if (sentences < cfg.minSentences) return { ok: false, reason: "not_prose", words, sentences };

  if (cfg.skipWhenCodeBlocks && hasCodeBlocks(text)) {
    return { ok: false, reason: "code_block" };
  }

  const ratio = structuredLineRatio(text);
  if (cfg.skipWhenMostlyStructured && ratio >= cfg.structuredRatioThreshold) {
    return { ok: false, reason: "structured", structuredRatio: ratio };
  }

  return { ok: true, reason: "eligible", words, sentences, structuredRatio: ratio };
}

function replaceWithStats(input, rule) {
  let count = 0;
  let changedChars = 0;

  const next = String(input).replace(rule.pattern, (...args) => {
    const match = String(args[0] || "");
    const replacement = typeof rule.replace === "function" ? String(rule.replace(...args)) : String(rule.replace);
    if (replacement !== match) {
      count += 1;
      changedChars += Math.abs(replacement.length - match.length) + Math.min(match.length, replacement.length);
    }
    return replacement;
  });

  return { text: next, count, changedChars };
}

function cleanupText(text) {
  return String(text)
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+([,.;!?])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .trim();
}

function humanizeText(input, config) {
  const cfg = mergeConfig(config);
  const original = String(input || "");
  let text = original;
  let changedChars = 0;
  const operations = [];

  if (cfg.normalizeEmDash) {
    const before = text;
    text = text
      .replace(/([\S])\s*[—–]\s*([\S])/g, "$1 - $2")
      .replace(/[—–]/g, "-");

    if (text !== before) {
      operations.push({ id: "normalize_em_dash", count: 1 });
      changedChars += Math.max(1, Math.abs(before.length - text.length));
    }
  }

  if (cfg.removeStockPhrases) {
    for (const rule of STOCK_RULES) {
      const out = replaceWithStats(text, rule);
      text = out.text;
      if (out.count > 0) {
        operations.push({ id: rule.id, count: out.count });
        changedChars += out.changedChars;
      }
    }
  }

  if (cfg.reduceHedging) {
    for (const rule of HEDGING_RULES) {
      const out = replaceWithStats(text, rule);
      text = out.text;
      if (out.count > 0) {
        operations.push({ id: rule.id, count: out.count });
        changedChars += out.changedChars;
      }
    }
  }

  if (cfg.rewriteRuleOfThree) {
    const out = replaceWithStats(text, {
      pattern: RULE_OF_THREE_PATTERN,
      replace: (_m, a, b, c) => `${a} and ${b}, plus ${c}`
    });
    text = out.text;
    if (out.count > 0) {
      operations.push({ id: "rule_of_three", count: out.count });
      changedChars += out.changedChars;
    }
  }

  const cleaned = cleanupText(text);
  if (cleaned !== text) {
    changedChars += Math.max(1, Math.abs(cleaned.length - text.length));
    text = cleaned;
  }

  const editRatio = original.length > 0 ? changedChars / original.length : 0;
  const blockedByEditRatio = editRatio > cfg.maxEditRatio;

  if (blockedByEditRatio || cfg.dryRun) {
    return {
      text: original,
      changed: false,
      blocked: blockedByEditRatio ? "max_edit_ratio" : "dry_run",
      editRatio,
      operations,
      source: "rules"
    };
  }

  return {
    text,
    changed: text !== original,
    blocked: null,
    editRatio,
    operations,
    source: "rules"
  };
}

async function runAdaptiveHumanizer(input, config) {
  return humanizeText(input, config);
}

module.exports = {
  DEFAULTS,
  mergeConfig,
  shouldProcess,
  humanizeText,
  runAdaptiveHumanizer,
  countWords,
  countSentences,
  structuredLineRatio,
  peerVariants
};
