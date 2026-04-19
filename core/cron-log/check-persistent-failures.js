#!/usr/bin/env node
"use strict";

/**
 * Detect jobs with N consecutive errors (default: 2 from config).
 * Exit 0 = all good, Exit 1 = persistent failures found (for cron-health-check).
 * Prints failing jobs to stdout (one per line).
 *
 * Usage: node check-persistent-failures.js [--threshold N] [--json]
 */

const fs   = require("fs");
const path = require("path");
const { getDb } = require("./db");

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--threshold" && argv[i + 1]) { args.threshold = Number(argv[++i]); }
    if (argv[i] === "--json") { args.json = true; }
  }
  return args;
}

const args = parseArgs(process.argv);
const cfg  = JSON.parse(fs.readFileSync(path.join(__dirname, "cron-log.config.json"), "utf8"));
const n    = args.threshold || cfg.persistentFailureThreshold || 2;

const db   = getDb();
const jobs = db.prepare("SELECT DISTINCT job_id FROM runs").all().map(r => r.job_id);

const failing = [];
for (const jobId of jobs) {
  const recent = db.prepare(`
    SELECT status, started_at FROM runs
    WHERE job_id = ? AND finished_at IS NOT NULL
    ORDER BY started_at DESC LIMIT ?
  `).all(jobId, n);

  if (recent.length === n && recent.every(r => r.status === "error")) {
    failing.push({ jobId, lastRun: recent[0].started_at });
  }
}

if (args.json) {
  console.log(JSON.stringify({ threshold: n, failing }));
  process.exit(failing.length > 0 ? 1 : 0);
}

if (failing.length === 0) {
  console.log(`[check-persistent-failures] all jobs ok (threshold: ${n})`);
} else {
  console.log(`[check-persistent-failures] ${failing.length} job(s) with ${n}+ consecutive errors:`);
  for (const { jobId, lastRun } of failing) {
    console.log(`  - ${jobId}  (last: ${lastRun})`);
  }
  process.exit(1);
}
