#!/usr/bin/env node
"use strict";

/**
 * Record the completion of a cron job run.
 * Usage: node log-end.js --run-id <uuid> --status ok|error|skipped [--summary "..."] [--error "..."]
 */

const { getDb } = require("./db");

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--run-id"  && argv[i + 1]) { args.runId   = argv[++i]; }
    if (argv[i] === "--status"  && argv[i + 1]) { args.status  = argv[++i]; }
    if (argv[i] === "--summary" && argv[i + 1]) { args.summary = argv[++i]; }
    if (argv[i] === "--error"   && argv[i + 1]) { args.error   = argv[++i]; }
  }
  return args;
}

const args = parseArgs(process.argv);
if (!args.runId || !args.status) {
  console.error("Usage: node log-end.js --run-id <uuid> --status ok|error|skipped [--summary \"...\"] [--error \"...\"]");
  process.exit(1);
}

const db  = getDb();
const now = new Date().toISOString();

// Calculate duration from started_at
const row = db.prepare("SELECT started_at FROM runs WHERE run_id = ?").get(args.runId);
const durationMs = row ? Date.now() - new Date(row.started_at).getTime() : null;

db.prepare(`
  UPDATE runs
  SET finished_at = ?, status = ?, summary = ?, error_msg = ?, duration_ms = ?
  WHERE run_id = ?
`).run(now, args.status, args.summary || null, args.error || null, durationMs, args.runId);

if (!db.prepare("SELECT id FROM runs WHERE run_id = ?").get(args.runId)) {
  console.error(`[cron-log] run_id not found: ${args.runId}`);
  process.exit(1);
}
