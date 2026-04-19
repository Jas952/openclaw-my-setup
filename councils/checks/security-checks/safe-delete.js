#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const FILE_EXT = new Set([".sh", ".js", ".ts", ".py", ".mjs", ".cjs"]);
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "coverage", "logs", "data"]);

function main() {
  const args = parseArgs(process.argv.slice(2));
  const workspaceRoot = path.resolve(args.workspaceRoot || process.cwd());

  const findings = [];
  walk(workspaceRoot, (file) => {
    const ext = path.extname(file);
    if (!FILE_EXT.has(ext)) return;

    let src = "";
    try {
      src = fs.readFileSync(file, "utf8");
    } catch {
      return;
    }

    const rel = path.relative(workspaceRoot, file);
    const lower = src.toLowerCase();

    const hasDangerousDelete =
      /\brm\s+-rf\b/.test(src) ||
      /\brm\s+-f\b/.test(src) ||
      /\bfs\.(rm|rmSync|unlink|unlinkSync)\(/.test(src) ||
      /\bdelete\s+from\b/.test(lower);

    if (!hasDangerousDelete) return;

    const hasSafetyGuard =
      /trash|\.trash|recycle|soft[-_ ]delete|confirm|approval|--confirm/.test(lower);

    if (!hasSafetyGuard) {
      findings.push({
        id: "safe_delete_policy",
        severity: "high",
        title: "Potential hard delete path without safety gate",
        details: "Delete operation found without visible trash-first or approval guard.",
        evidence: rel
      });
    }
  });

  process.stdout.write(JSON.stringify({ ok: findings.length === 0, findings }, null, 2) + "\n");
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--workspace-root") out.workspaceRoot = argv[i + 1];
  }
  return out;
}

function walk(root, onFile) {
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        stack.push(full);
      } else if (entry.isFile()) {
        onFile(full);
      }
    }
  }
}

main();
