"use strict";

/**
 * Generates detailed local JSON reports in ./reports/ for decision-making.
 *
 * reports/
 *   summary.json          ← current snapshot: today + week + 14-day trend
 *   daily/YYYY-MM-DD.json ← per-day: by model, by agent, by hour, sessions
 *
 * Key metrics beyond Telegram view:
 *   - cacheHitRate  = cacheRead / (input + cacheRead) — higher = better prompt caching
 *   - estimatedCostUsd — per model/agent/session (null if price unknown)
 *   - avgInputPerCall — avg context size; growth = accumulating context
 *   - avgDurationMs  — latency per run
 *   - byHour         — when agents are active (UTC hours)
 *   - sessions       — individual runs sorted by input desc for debugging expensive calls
 */

const fs   = require("fs");
const path = require("path");
const os   = require("os");

function loadConfig() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "tracker.config.json"), "utf8"));
}

function loadCosts() {
  const p = path.join(__dirname, "costs.json");
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return {}; }
}

function expandHome(p) {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

function loadAllRecords(storagePath) {
  if (!fs.existsSync(storagePath)) return [];
  const records = [];
  for (const line of fs.readFileSync(storagePath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try { records.push(JSON.parse(t)); } catch { /* skip malformed */ }
  }
  return records;
}

// ── Metrics helpers ─────────────────────────────────────────────────────────────

function cacheHitRate(input, cacheRead) {
  const total = input + cacheRead;
  return total > 0 ? Math.round((cacheRead / total) * 1000) / 1000 : 0;
}

function estimateCost(input, output, cacheRead, provider, model, costs) {
  const price = costs[`${provider}/${model}`];
  if (!price || (price.input === 0 && price.output === 0)) return null;
  const usd = (input * price.input + output * price.output + cacheRead * (price.cache || 0)) / 1_000_000;
  return Math.round(usd * 100000) / 100000; // 5 decimal places
}

function sumTotals(records, costs) {
  let input = 0, output = 0, cacheRead = 0, cost = 0, hasCost = false;
  for (const r of records) {
    input     += r.input;
    output    += r.output;
    cacheRead += r.cacheRead;
    const c = estimateCost(r.input, r.output, r.cacheRead, r.provider, r.model, costs);
    if (c !== null) { cost += c; hasCost = true; }
  }
  return {
    calls:            records.length,
    input,
    output,
    cacheRead,
    cacheHitRate:     cacheHitRate(input, cacheRead),
    estimatedCostUsd: hasCost ? Math.round(cost * 100000) / 100000 : null
  };
}

// ── Grouping ────────────────────────────────────────────────────────────────────

function byModelDetail(records, costs) {
  const map = new Map();
  for (const r of records) {
    const key = `${r.provider}/${r.model}`;
    if (!map.has(key)) {
      map.set(key, { model: r.model, provider: r.provider, calls: 0, input: 0, output: 0, cacheRead: 0, durationMs: 0 });
    }
    const g = map.get(key);
    g.calls++;
    g.input     += r.input;
    g.output    += r.output;
    g.cacheRead += r.cacheRead;
    g.durationMs += r.durationMs || 0;
  }
  return Array.from(map.values())
    .sort((a, b) => b.input - a.input)
    .map(g => ({
      model:             g.model,
      provider:          g.provider,
      calls:             g.calls,
      input:             g.input,
      output:            g.output,
      cacheRead:         g.cacheRead,
      cacheHitRate:      cacheHitRate(g.input, g.cacheRead),
      avgInputPerCall:   Math.round(g.input  / g.calls),
      avgOutputPerCall:  Math.round(g.output / g.calls),
      avgDurationMs:     Math.round(g.durationMs / g.calls),
      estimatedCostUsd:  estimateCost(g.input, g.output, g.cacheRead, g.provider, g.model, costs)
    }));
}

function byAgentDetail(records, costs) {
  const map = new Map();
  for (const r of records) {
    const key = r.agentId || "unknown";
    if (!map.has(key)) {
      map.set(key, { agentId: key, calls: 0, input: 0, output: 0, cacheRead: 0, durationMs: 0, models: new Set(), providers: new Set() });
    }
    const g = map.get(key);
    g.calls++;
    g.input     += r.input;
    g.output    += r.output;
    g.cacheRead += r.cacheRead;
    g.durationMs += r.durationMs || 0;
    if (r.model)    g.models.add(r.model);
    if (r.provider) g.providers.add(r.provider);
  }
  return Array.from(map.values())
    .sort((a, b) => b.input - a.input)
    .map(g => {
      const agentRecs = records.filter(r => (r.agentId || "unknown") === g.agentId);
      let cost = 0; let hasCost = false;
      for (const r of agentRecs) {
        const c = estimateCost(r.input, r.output, r.cacheRead, r.provider, r.model, costs);
        if (c !== null) { cost += c; hasCost = true; }
      }
      return {
        agentId:           g.agentId,
        calls:             g.calls,
        input:             g.input,
        output:            g.output,
        cacheRead:         g.cacheRead,
        cacheHitRate:      cacheHitRate(g.input, g.cacheRead),
        avgInputPerCall:   Math.round(g.input / g.calls),
        avgDurationMs:     Math.round(g.durationMs / g.calls),
        estimatedCostUsd:  hasCost ? Math.round(cost * 100000) / 100000 : null,
        models:            Array.from(g.models),
        providers:         Array.from(g.providers)
      };
    });
}

function byHourDetail(records) {
  const map = new Map();
  for (const r of records) {
    const h = String(new Date(r.ts).getUTCHours()).padStart(2, "0");
    if (!map.has(h)) map.set(h, { calls: 0, input: 0, output: 0, cacheRead: 0 });
    const g = map.get(h);
    g.calls++; g.input += r.input; g.output += r.output; g.cacheRead += r.cacheRead;
  }
  const out = {};
  for (const [h, v] of [...map.entries()].sort()) out[h] = v;
  return out;
}

// ── Report builders ─────────────────────────────────────────────────────────────

function buildDailyReport(date, records, costs) {
  const day = records.filter(r => r.date === date);

  const sessions = day
    .slice()
    .sort((a, b) => b.input - a.input)
    .map(r => ({
      ts:               r.ts,
      runId:            r.runId,
      agentId:          r.agentId || "unknown",
      model:            r.model,
      provider:         r.provider,
      input:            r.input,
      output:           r.output,
      cacheRead:        r.cacheRead,
      cacheHitRate:     cacheHitRate(r.input, r.cacheRead),
      durationMs:       r.durationMs || 0,
      estimatedCostUsd: estimateCost(r.input, r.output, r.cacheRead, r.provider, r.model, costs)
    }));

  return {
    date,
    generatedAt: new Date().toISOString(),
    totals:  sumTotals(day, costs),
    byModel: byModelDetail(day, costs),
    byAgent: byAgentDetail(day, costs),   // ALL workspaces, no filtering
    byHour:  byHourDetail(day),
    sessions
  };
}

function buildSummary(data, allRecords, costs) {
  const { todayStr, weekStartStr } = data;

  // 14-day daily trend (skip days with no data)
  const trend = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const recs = allRecords.filter(r => r.date === dateStr);
    if (recs.length > 0) trend.push({ date: dateStr, ...sumTotals(recs, costs) });
  }

  const todayRecs  = allRecords.filter(r => r.date === todayStr);
  const weekRecs   = allRecords.filter(r => r.date >= weekStartStr);

  return {
    generatedAt: new Date().toISOString(),
    today: {
      date: todayStr,
      ...sumTotals(todayRecs, costs),
      topAgents: byAgentDetail(todayRecs, costs).slice(0, 5),
      topModels: byModelDetail(todayRecs, costs).slice(0, 5)
    },
    thisWeek: {
      start: weekStartStr,
      ...sumTotals(weekRecs, costs),
      topAgents: byAgentDetail(weekRecs, costs).slice(0, 5),
      topModels: byModelDetail(weekRecs, costs).slice(0, 5)
    },
    trend14d: trend
  };
}

// ── Entry point ─────────────────────────────────────────────────────────────────

function run(data) {
  const cfg    = loadConfig();
  const costs  = loadCosts();
  const all    = loadAllRecords(expandHome(cfg.storagePath));

  const reportsDir = path.join(__dirname, "reports");
  const dailyDir   = path.join(reportsDir, "daily");
  fs.mkdirSync(dailyDir, { recursive: true });

  // Today's detailed report
  const daily = buildDailyReport(data.todayStr, all, costs);
  fs.writeFileSync(
    path.join(dailyDir, `${data.todayStr}.json`),
    JSON.stringify(daily, null, 2) + "\n"
  );

  // Overall summary
  const summary = buildSummary(data, all, costs);
  fs.writeFileSync(
    path.join(reportsDir, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n"
  );

  console.log(`[local-reporter] ${daily.sessions.length} sessions today | reports/daily/${data.todayStr}.json + reports/summary.json`);
  return { daily, summary };
}

function rebuildAll(data) {
  const cfg    = loadConfig();
  const costs  = loadCosts();
  const all    = loadAllRecords(expandHome(cfg.storagePath));

  const reportsDir = path.join(__dirname, "reports");
  const dailyDir   = path.join(reportsDir, "daily");
  fs.mkdirSync(dailyDir, { recursive: true });

  const dates = Array.from(new Set(all.map(r => r.date).filter(Boolean))).sort();
  let rebuilt = 0;
  for (const date of dates) {
    const daily = buildDailyReport(date, all, costs);
    fs.writeFileSync(
      path.join(dailyDir, `${date}.json`),
      JSON.stringify(daily, null, 2) + "\n"
    );
    rebuilt++;
  }

  const summary = buildSummary(data, all, costs);
  fs.writeFileSync(
    path.join(reportsDir, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n"
  );

  console.log(`[local-reporter] rebuilt all daily reports: ${rebuilt} day(s) | reports/summary.json updated`);
  return { rebuiltDays: rebuilt, summary };
}

module.exports = { run, rebuildAll };
