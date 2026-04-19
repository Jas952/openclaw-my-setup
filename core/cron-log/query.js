#!/usr/bin/env node
"use strict";

/**
 * Query cron-log history.
 *
 * node query.js                         — last 10 runs per job (all jobs)
 * node query.js --job <name>            — last 20 runs for specific job
 * node query.js --job <name> --last N   — last N runs
 * node query.js --failures              — jobs with 2+ consecutive errors
 * node query.js --today                 — all runs from today
 */

const { getDb } = require("./db");

function parseArgs(argv) {
  const args = { last: 10 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--job"      && argv[i + 1]) { args.job = argv[++i]; }
    if (argv[i] === "--last"     && argv[i + 1]) { args.last = Number(argv[++i]); }
    if (argv[i] === "--failures")                { args.failures = true; }
    if (argv[i] === "--today")                   { args.today = true; }
    if (argv[i] === "--json")                    { args.json = true; }
  }
  return args;
}

function fmtDuration(ms) {
  if (!ms) return "-";
  if (ms < 1000)   return `${ms}ms`;
  if (ms < 60000)  return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s`;
}

function fmtStatus(s) {
  if (!s) return "running";
  return s;
}

function printRuns(runs, args) {
  if (args.json) { console.log(JSON.stringify(runs, null, 2)); return; }

  if (runs.length === 0) { console.log("No runs found."); return; }

  const cols = ["job_id", "status", "duration", "started_at", "summary"];
  const rows = runs.map(r => [
    r.job_id,
    fmtStatus(r.status),
    fmtDuration(r.duration_ms),
    r.started_at.replace("T", " ").slice(0, 19),
    (r.summary || r.error_msg || "").slice(0, 50)
  ]);

  const widths = cols.map((c, i) => Math.max(c.length, ...rows.map(r => r[i].length)));
  const sep = widths.map(w => "-".repeat(w)).join("  ");
  const fmt = row => row.map((v, i) => v.padEnd(widths[i])).join("  ");

  console.log(fmt(cols));
  console.log(sep);
  for (const row of rows) console.log(fmt(row));
  console.log(`\n${runs.length} run(s)`);
}

const args = parseArgs(process.argv);
const db   = getDb();

if (args.failures) {
  // For each job, check if last N runs are all errors
  const { persistentFailureThreshold: threshold } = JSON.parse(
    require("fs").readFileSync(require("path").join(__dirname, "cron-log.config.json"), "utf8")
  );
  const n = threshold || 2;
  const jobs = db.prepare("SELECT DISTINCT job_id FROM runs").all().map(r => r.job_id);
  const failing = [];

  for (const jobId of jobs) {
    const recent = db.prepare(
      "SELECT status FROM runs WHERE job_id = ? AND finished_at IS NOT NULL ORDER BY started_at DESC LIMIT ?"
    ).all(jobId, n);
    if (recent.length === n && recent.every(r => r.status === "error")) {
      failing.push(jobId);
    }
  }

  if (failing.length === 0) {
    console.log("No persistent failures detected.");
  } else {
    console.log(`Persistent failures (${n}+ consecutive errors):`);
    failing.forEach(j => console.log(`  - ${j}`));
    process.exit(1);
  }
  process.exit(0);
}

if (args.today) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const runs = db.prepare(
    "SELECT * FROM runs WHERE started_at >= ? ORDER BY started_at DESC"
  ).all(todayStr + "T00:00:00.000Z");
  printRuns(runs, args);
  process.exit(0);
}

if (args.job) {
  const runs = db.prepare(
    "SELECT * FROM runs WHERE job_id = ? ORDER BY started_at DESC LIMIT ?"
  ).all(args.job, args.last);
  printRuns(runs.reverse(), args);
  process.exit(0);
}

// All jobs: last N runs each, grouped
const jobs = db.prepare("SELECT DISTINCT job_id FROM runs ORDER BY job_id").all().map(r => r.job_id);
if (jobs.length === 0) { console.log("No runs recorded yet."); process.exit(0); }

for (const jobId of jobs) {
  const runs = db.prepare(
    "SELECT * FROM runs WHERE job_id = ? ORDER BY started_at DESC LIMIT ?"
  ).all(jobId, args.last);
  console.log(`\n── ${jobId} ─────────────────────────`);
  printRuns(runs.reverse(), args);
}
