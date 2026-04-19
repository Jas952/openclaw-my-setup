#!/usr/bin/env node
"use strict";

/**
 * Record the start of a cron job run.
 * Usage: node log-start.js --job <job_id>
 * Prints run_id to stdout — capture it for use with log-end.js
 */

const os      = require("os");
const crypto  = require("crypto");
const { getDb } = require("./db");

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--job" && argv[i + 1]) { args.job = argv[++i]; }
  }
  return args;
}

const args = parseArgs(process.argv);
if (!args.job) {
  console.error("Usage: node log-start.js --job <job_id>");
  process.exit(1);
}

const runId = crypto.randomUUID();
const db    = getDb();

db.prepare(`
  INSERT INTO runs (run_id, job_id, started_at, hostname)
  VALUES (?, ?, ?, ?)
`).run(runId, args.job, new Date().toISOString(), os.hostname());

// Print run_id for shell capture: RUN_ID=$(node log-start.js --job foo)
process.stdout.write(runId + "\n");
