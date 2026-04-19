#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_ROOT = "/Users/dmitriy/openclaw";
const CODE_EXT = new Set([".js", ".ts", ".mjs", ".cjs", ".sh", ".py", ".json", ".yaml", ".yml", ".md"]);
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "coverage", ".next", ".cache", "logs"]);
const MAX_FILES = 4000;
const MAX_MATCHES = 1200;

const PATTERNS = [
  { id: "prompt_injection_marker", re: /ignore\s+(all|any|previous|prior)\s+instructions|\bsystem:\b|\bdeveloper:\b/i, risk: "prompt-injection" },
  { id: "hardcoded_secret", re: /sk_(live|test)_[A-Za-z0-9]{12,}|sk-ant-[A-Za-z0-9\-]{12,}|AKIA[0-9A-Z]{16}|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/, risk: "secret" },
  { id: "dangerous_exec", re: /child_process\.(exec|execSync|spawn|spawnSync)\(|\beval\(|new Function\(/, risk: "rce" },
  { id: "unsafe_delete", re: /\brm\s+-rf\b|fs\.(rm|rmSync|unlink|unlinkSync)\(/, risk: "delete" },
  { id: "auth_or_token", re: /\bauth\b|\btoken\b|\bapikey\b|\bapi[_-]?key\b/i, risk: "auth" },
  { id: "financial_data", re: /\bwallet\b|\bprivate key\b|\bseed phrase\b|\bpayment\b/i, risk: "privacy" }
];

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(args.root || DEFAULT_ROOT);
  const scopeRoots = [path.join(root, "workspaces"), path.join(root, "councils"), path.join(root, "security-and-safety")]
    .filter((p) => fs.existsSync(p));

  const files = [];
  for (const scope of scopeRoots) walk(scope, files);

  const refs = [];
  for (const file of files) {
    if (refs.length >= MAX_MATCHES) break;

    let source = "";
    try {
      source = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }

    const lines = source.split(/\r?\n/);
    const rel = path.relative(root, file);
    const riskTags = new Set();
    const matches = [];

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      for (const p of PATTERNS) {
        if (!p.re.test(line)) continue;
        riskTags.add(p.risk);
        matches.push({ line: i + 1, patternId: p.id, excerpt: line.trim().slice(0, 300) });
        refs.push({ path: rel, line: i + 1, patternId: p.id, risk: p.risk, excerpt: line.trim().slice(0, 300) });
        if (refs.length >= MAX_MATCHES) break;
      }
      if (refs.length >= MAX_MATCHES) break;
    }

    if (matches.length > 0) {
      // Keep compact per-file summary for AI context.
      refs.push({
        type: "file_summary",
        path: rel,
        riskTags: [...riskTags],
        sampleMatches: matches.slice(0, 10)
      });
    }
  }

  const out = {
    formatVersion: "code-read-ai.v1",
    generatedAt: new Date().toISOString(),
    root,
    scannedFiles: files.length,
    matchCount: refs.filter((x) => x.type !== "file_summary").length,
    references: refs.slice(0, MAX_MATCHES)
  };

  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--root") out.root = argv[i + 1];
  }
  return out;
}

function walk(root, acc) {
  const stack = [root];
  while (stack.length > 0 && acc.length < MAX_FILES) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        stack.push(full);
      } else if (e.isFile()) {
        const ext = path.extname(e.name);
        if (!CODE_EXT.has(ext)) continue;
        let st;
        try {
          st = fs.statSync(full);
        } catch {
          continue;
        }
        if (st.size > 500_000) continue;
        acc.push(full);
        if (acc.length >= MAX_FILES) break;
      }
    }
  }
}

main();
