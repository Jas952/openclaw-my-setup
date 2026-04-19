#!/usr/bin/env node
"use strict";

/**
 * Mark runs that started but never finished (no finished_at) as 'error'.
 * Threshold: staleAfterMs from config (default 2h).
 * Run daily via cron.
 */

const fs   = require("fs");
const path = require("path");
const { getDb } = require("./db");

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "cron-log.config.json"), "utf8"));
const staleAfterMs = cfg.staleAfterMs || 7_200_000; // 2h default

const db         = getDb();
const cutoff     = new Date(Date.now() - staleAfterMs).toISOString();

const result = db.prepare(`
  UPDATE runs
  SET finished_at = ?, status = 'error', error_msg = 'marked stale by cleanup'
  WHERE finished_at IS NULL AND started_at < ?
`).run(new Date().toISOString(), cutoff);

console.log(`[cleanup-stale] marked ${result.changes} stale run(s) as error (cutoff: ${cutoff})`);
