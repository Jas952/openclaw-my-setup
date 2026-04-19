"use strict";

const fs      = require("fs");
const path    = require("path");
const os      = require("os");
const Database = require("better-sqlite3");

function loadConfig() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "cron-log.config.json"), "utf8"));
}

function expandHome(p) {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

let _db = null;

function getDb() {
  if (_db) return _db;

  const cfg    = loadConfig();
  const dbPath = expandHome(cfg.dbPath);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id           INTEGER PRIMARY KEY,
      run_id       TEXT UNIQUE NOT NULL,
      job_id       TEXT NOT NULL,
      started_at   TEXT NOT NULL,
      finished_at  TEXT,
      status       TEXT CHECK(status IN ('ok','error','skipped')),
      summary      TEXT,
      error_msg    TEXT,
      duration_ms  INTEGER,
      hostname     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_runs_job_id     ON runs(job_id);
    CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at);
  `);

  _db = db;
  return db;
}

module.exports = { getDb };
