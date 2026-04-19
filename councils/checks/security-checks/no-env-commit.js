#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

function main() {
  const args = parseArgs(process.argv.slice(2));
  const workspaceRoot = path.resolve(args.workspaceRoot || process.cwd());

  const out = spawnSync("git", ["-C", workspaceRoot, "ls-files"], { encoding: "utf8" });
  if (out.error || out.status !== 0) {
    print({ ok: true, skipped: true, reason: "git_not_available_or_not_repo", findings: [] });
    return;
  }

  const tracked = String(out.stdout || "").split("\n").map((x) => x.trim()).filter(Boolean);
  const findings = [];

  for (const rel of tracked) {
    const base = path.basename(rel);
    if (!base.startsWith(".env")) continue;
    if ([".env.example", ".env.sample", ".env.template", ".env.dist"].includes(base)) continue;

    findings.push({
      id: "no_env_commit",
      severity: "critical",
      title: "Tracked .env file detected",
      details: "Environment files must not be committed to git.",
      evidence: rel
    });
  }

  print({ ok: findings.length === 0, skipped: false, findings });
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--workspace-root") out.workspaceRoot = argv[i + 1];
  }
  return out;
}

function print(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
}

main();
