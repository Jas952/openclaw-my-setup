"use strict";

const parser          = require("./parser");
const { aggregate }   = require("./aggregator");
const { report }      = require("./reporter");
const localReporter   = require("./local-reporter");

// ── cron-log integration (non-fatal if unavailable) ────────────────────────────
let cronLog = null;
try {
  cronLog = require("../cron-log/db");
} catch { /* cron-log not installed yet */ }

function cronStart(jobId) {
  if (!cronLog) return null;
  try {
    const crypto = require("crypto");
    const os     = require("os");
    const db     = cronLog.getDb();
    const runId  = crypto.randomUUID();
    db.prepare(
      "INSERT INTO runs (run_id, job_id, started_at, hostname) VALUES (?, ?, ?, ?)"
    ).run(runId, jobId, new Date().toISOString(), os.hostname());
    return runId;
  } catch (e) { console.warn("[cron-log] start failed:", e.message); return null; }
}

function cronEnd(runId, status, summary, errorMsg) {
  if (!cronLog || !runId) return;
  try {
    const db  = cronLog.getDb();
    const row = db.prepare("SELECT started_at FROM runs WHERE run_id = ?").get(runId);
    const dur = row ? Date.now() - new Date(row.started_at).getTime() : null;
    db.prepare(
      "UPDATE runs SET finished_at=?, status=?, summary=?, error_msg=?, duration_ms=? WHERE run_id=?"
    ).run(new Date().toISOString(), status, summary || null, errorMsg || null, dur, runId);
  } catch (e) { console.warn("[cron-log] end failed:", e.message); }
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const ts = new Date().toISOString();
  console.log(`[run] ${ts}`);

  const runId = cronStart("model-usage-tracker");

  try {
    // 1. Parse new records from openclaw logs
    const newRecords = parser.run();
    console.log(`[parser] +${newRecords} new records`);

    // 2. Aggregate daily + weekly stats
    const data = aggregate();
    console.log(`[aggregator] today=${data.todayStr} weekStart=${data.weekStartStr} daily=${data.daily.totals.calls} calls weekly=${data.weekly.totals.calls} calls`);

    // 3. Save detailed local reports (reports/daily/ + reports/summary.json)
    localReporter.run(data);

    // 4. Send/edit 3 Telegram photo messages
    await report(data);

    cronEnd(runId, "ok", `daily=${data.daily.totals.calls} weekly=${data.weekly.totals.calls} calls`);
    console.log("[run] done");

  } catch (err) {
    cronEnd(runId, "error", null, err.message);
    throw err;
  }
}

main().catch(err => {
  console.error("[run] ERROR:", err.message);
  process.exit(1);
});
