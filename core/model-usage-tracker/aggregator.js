"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

function loadConfig() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "tracker.config.json"), "utf8"));
}

function expandHome(p) {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

/** Returns current date string YYYY-MM-DD in the given IANA timezone */
function todayInTz(tz) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
}

/** Returns date string of the most recent Sunday (weeklyResetDay=0) in the given timezone */
function weekStartInTz(tz, resetDay = 0) {
  const now = new Date();
  // Get current day-of-week in target tz
  const dayOfWeek = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short"
  }).format(now).slice(0, 2) === "Su" ? 0 :
    ["Su","Mo","Tu","We","Th","Fr","Sa"].indexOf(
      new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(now).slice(0, 2)
    ));

  // Days since last resetDay
  const diff = (dayOfWeek - resetDay + 7) % 7;
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - diff);

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit"
  }).format(weekStart);
}

function loadRecords(storagePath) {
  if (!fs.existsSync(storagePath)) return [];
  const content = fs.readFileSync(storagePath, "utf8");
  const records = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { records.push(JSON.parse(trimmed)); } catch { /* skip */ }
  }
  return records;
}

function groupByModel(records) {
  const map = new Map();
  for (const r of records) {
    const key = `${r.provider}/${r.model}`;
    if (!map.has(key)) map.set(key, { model: r.model, provider: r.provider, calls: 0, input: 0, output: 0, cacheRead: 0 });
    const g = map.get(key);
    g.calls++;
    g.input += r.input;
    g.output += r.output;
    g.cacheRead += r.cacheRead;
  }
  return Array.from(map.values()).sort((a, b) => b.input - a.input);
}

function groupByAgent(records) {
  const map = new Map();
  for (const r of records) {
    const key = r.agentId || "unknown";
    if (!map.has(key)) map.set(key, { agentId: key, calls: 0, input: 0, output: 0, cacheRead: 0 });
    const g = map.get(key);
    g.calls++;
    g.input += r.input;
    g.output += r.output;
    g.cacheRead += r.cacheRead;
  }
  return Array.from(map.values()).sort((a, b) => b.input - a.input);
}

function sumTotals(groups) {
  return groups.reduce(
    (acc, g) => ({
      calls: acc.calls + g.calls,
      input: acc.input + g.input,
      output: acc.output + g.output,
      cacheRead: acc.cacheRead + g.cacheRead
    }),
    { calls: 0, input: 0, output: 0, cacheRead: 0 }
  );
}

/** Returns { daily, weekly, byAgent, todayStr, weekStartStr } */
function aggregate() {
  const cfg = loadConfig();
  const storagePath = expandHome(cfg.storagePath);
  const tz = cfg.timezone || "Europe/Moscow";
  const resetDay = cfg.weeklyResetDay ?? 0;

  const todayStr = todayInTz(tz);
  const weekStartStr = weekStartInTz(tz, resetDay);

  const all = loadRecords(storagePath);

  const dailyRecords  = all.filter(r => r.date === todayStr);
  const weeklyRecords = all.filter(r => r.date >= weekStartStr);

  const dailyByModel  = groupByModel(dailyRecords);
  const weeklyByModel = groupByModel(weeklyRecords);
  const byAgent       = groupByAgent(dailyRecords);

  return {
    todayStr,
    weekStartStr,
    daily:   { byModel: dailyByModel,  totals: sumTotals(dailyByModel)  },
    weekly:  { byModel: weeklyByModel, totals: sumTotals(weeklyByModel) },
    byAgent
  };
}

module.exports = { aggregate, todayInTz, weekStartInTz };

if (require.main === module) {
  const result = aggregate();
  console.log(JSON.stringify(result, null, 2));
}
