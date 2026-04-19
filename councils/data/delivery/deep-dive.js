#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { loadTelegramTarget } = require("./telegram-renderer");

const OPENCLAW_ROOT = "/Users/dmitriy/openclaw";
const REPORTS_DIR = path.join(OPENCLAW_ROOT, "councils", "data", "reports", "security");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.number || Number.isNaN(args.number)) {
    throw new Error("Usage: node councils/data/delivery/deep-dive.js --number <N> [--send]");
  }

  const report = loadLatest();
  const rec = (report.recommendations || []).find((r) => Number(r.number) === Number(args.number));
  if (!rec) throw new Error(`Recommendation #${args.number} not found`);

  const text = formatDetail(report, rec);
  if (args.send) await sendTelegram(text);
  process.stdout.write(text + "\n");
}

function parseArgs(argv) {
  const out = { send: false, number: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--send") out.send = true;
    if (argv[i] === "--number") out.number = Number(argv[i + 1]);
  }
  return out;
}

function loadLatest() {
  const latest = path.join(REPORTS_DIR, "latest.json");
  if (fs.existsSync(latest)) return JSON.parse(fs.readFileSync(latest, "utf8"));

  const files = fs.readdirSync(REPORTS_DIR).filter((x) => x.endsWith(".json")).sort().reverse();
  if (files.length === 0) throw new Error("No reports found");
  return JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, files[0]), "utf8"));
}

function formatDetail(report, rec) {
  const refs = (rec.references || []).map((r) => `${r.path}:${r.line}`).join(", ") || "n/a";
  return [
    `Security Council Deep Dive #${rec.number}`,
    `Severity: ${String(rec.severity || "").toUpperCase()}`,
    `ID: ${rec.id}`,
    `Title: ${rec.title}`,
    `Perspective: ${rec.perspective || "n/a"}`,
    `Scope: ${rec.scope || "global"}`,
    `Reason: ${rec.details || "n/a"}`,
    `Evidence: ${refs}`,
    `Recommendation: ${rec.recommendation || "n/a"}`
  ].join("\n");
}

async function sendTelegram(text) {
  const tg = loadTelegramTarget();
  const res = await fetch(`https://api.telegram.org/bot${tg.token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: tg.chatId,
      message_thread_id: tg.threadId,
      text
    })
  });
  const body = await res.json().catch(() => ({ ok: false }));
  if (!body.ok) throw new Error(`Telegram send failed: ${body.description || "unknown"}`);
}

main().catch((error) => {
  process.stderr.write(`deep-dive failed: ${error.message}\n`);
  process.exit(1);
});
