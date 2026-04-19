#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DEFAULT_ROOT = "~/openclaw";
const CODE_EXT = new Set([".js", ".ts", ".mjs", ".cjs", ".sh", ".py"]);
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "coverage", ".next", ".cache"]);

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(args.root || DEFAULT_ROOT);
  const now = new Date();

  const ctx = {
    root,
    now,
    findings: [],
    zones: {}
  };

  runZone(ctx, "cron_health", checkCronHealth);
  runZone(ctx, "code_quality", checkCodeQuality);
  runZone(ctx, "test_coverage", checkTestCoverage);
  runZone(ctx, "prompt_quality", checkPromptQuality);
  runZone(ctx, "dependencies", checkDependencies);
  runZone(ctx, "storage", checkStorage);
  runZone(ctx, "skill_integrity", checkSkillIntegrity);
  runZone(ctx, "config_consistency", checkConfigConsistency);
  runZone(ctx, "data_integrity", checkDataIntegrity);

  const counts = summarizeCounts(ctx.findings);

  process.stdout.write(
    JSON.stringify(
      {
        reportFormatVersion: "platform-health-checks.v1",
        generatedAtUtc: now.toISOString(),
        root,
        counts,
        zones: ctx.zones,
        findings: ctx.findings
      },
      null,
      2
    ) + "\n"
  );
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--root") out.root = argv[i + 1];
  }
  return out;
}

function runZone(ctx, zone, fn) {
  const before = ctx.findings.length;
  let metrics = {};
  let error = null;
  try {
    metrics = fn(ctx) || {};
  } catch (e) {
    error = String(e && e.message ? e.message : e);
    addFinding(ctx, {
      zone,
      severity: "high",
      id: `${zone}_check_error`,
      title: `Zone check failed: ${zone}`,
      details: `Check execution failed: ${error}`,
      evidence: "",
      recommendation: "Fix check implementation/runtime and rerun platform-health council.",
      scope: "global"
    });
  }

  const zoneFindings = ctx.findings.length - before;
  ctx.zones[zone] = {
    status: zoneFindings > 0 ? "issues" : "ok",
    findings: zoneFindings,
    metrics,
    error
  };
}

function addFinding(ctx, finding) {
  const ev = String(finding.evidence || "").trim();
  const details = String(finding.details || "").replace(/\s+/g, " ").trim();
  const recommendation = String(finding.recommendation || "").replace(/\s+/g, " ").trim();

  ctx.findings.push({
    zone: String(finding.zone || "unknown"),
    severity: normalizeSeverity(finding.severity),
    id: String(finding.id || "unknown_issue"),
    title: String(finding.title || "Issue detected"),
    details,
    evidence: ev,
    recommendation,
    scope: String(finding.scope || "global")
  });
}

function checkCronHealth(ctx) {
  const logPath = path.join(ctx.root, "councils", "data", "cron", "dev-security-report.log");
  if (!fs.existsSync(logPath)) {
    addFinding(ctx, {
      zone: "cron_health",
      severity: "high",
      id: "cron_log_missing",
      title: "Cron log file missing",
      details: "Platform health cannot verify cron reliability because log file is missing.",
      evidence: `${logPath}:1`,
      recommendation: "Restore cron logging for councils/scripts/run-dev-security-report.sh and rerun checks."
    });
    return { logPath, staleHours: null, failedLines: null };
  }

  const stat = fs.statSync(logPath);
  const staleHours = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60);

  const raw = fs.readFileSync(logPath, "utf8");
  const lines = raw.split(/\r?\n/);
  const failedLines = lines.filter((l) => /\bfailed\b|\berror\b/i.test(l)).length;
  const starts = lines.filter((l) => /run-dev-security-report start/i.test(l)).length;
  const dones = lines.filter((l) => /run-dev-security-report done/i.test(l)).length;

  if (staleHours > 36) {
    addFinding(ctx, {
      zone: "cron_health",
      severity: "high",
      id: "cron_stale",
      title: "Cron heartbeat looks stale",
      details: `Cron log was not updated for ${staleHours.toFixed(1)} hours.`,
      evidence: `${logPath}:1`,
      recommendation: "Check cron daemon, script path, and lock behavior; restore successful nightly execution."
    });
  }

  if (failedLines > 0) {
    addFinding(ctx, {
      zone: "cron_health",
      severity: failedLines >= 10 ? "high" : "medium",
      id: "cron_failures_detected",
      title: "Cron log contains execution failures",
      details: `Detected ${failedLines} error/failure lines in council cron log.`,
      evidence: `${logPath}:1`,
      recommendation: "Review failing runs, remove recurring error causes, and verify clean execution."
    });
  }

  if (starts > dones) {
    addFinding(ctx, {
      zone: "cron_health",
      severity: "medium",
      id: "cron_incomplete_runs",
      title: "Incomplete cron run detected",
      details: `Start markers exceed done markers (${starts} vs ${dones}).`,
      evidence: `${logPath}:1`,
      recommendation: "Investigate interrupted runs and ensure script exits cleanly with done marker."
    });
  }

  return { logPath, staleHours: Number(staleHours.toFixed(2)), failedLines, starts, dones };
}

function checkCodeQuality(ctx) {
  const roots = [path.join(ctx.root, "councils"), path.join(ctx.root, "workspaces")].filter((x) => fs.existsSync(x));
  const files = collectCodeFiles(roots, 5000);

  let todoCount = 0;
  const todoRefs = [];
  const largeFiles = [];

  for (const file of files) {
    let src = "";
    try {
      src = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }

    const lines = src.split(/\r?\n/);
    if (lines.length > 1200) {
      largeFiles.push({ file, lines: lines.length });
    }

    for (let i = 0; i < lines.length; i += 1) {
      if (/\bTODO\b|\bFIXME\b|\bHACK\b|\bXXX\b/.test(lines[i])) {
        todoCount += 1;
        if (todoRefs.length < 8) todoRefs.push(`${file}:${i + 1}`);
      }
    }
  }

  if (todoCount > 80) {
    addFinding(ctx, {
      zone: "code_quality",
      severity: "high",
      id: "code_quality_todo_backlog",
      title: "Technical debt markers are accumulating",
      details: `Found ${todoCount} TODO/FIXME/HACK markers in code.`,
      evidence: todoRefs.join(";"),
      recommendation: "Create debt burn-down plan and enforce review rules for unresolved TODO/FIXME markers."
    });
  } else if (todoCount > 25) {
    addFinding(ctx, {
      zone: "code_quality",
      severity: "medium",
      id: "code_quality_todo_backlog",
      title: "Technical debt markers detected",
      details: `Found ${todoCount} TODO/FIXME/HACK markers in code.`,
      evidence: todoRefs.join(";"),
      recommendation: "Prioritize cleanup of high-impact TODO/FIXME areas and track closure in sprint tasks."
    });
  }

  if (largeFiles.length > 12) {
    addFinding(ctx, {
      zone: "code_quality",
      severity: "medium",
      id: "code_quality_large_files",
      title: "Large files reduce maintainability",
      details: `Detected ${largeFiles.length} large source files (>1200 lines).`,
      evidence: largeFiles.slice(0, 8).map((x) => `${x.file}:1`).join(";"),
      recommendation: "Split oversized files into smaller modules with explicit boundaries and ownership."
    });
  }

  return { scannedFiles: files.length, todoCount, largeFileCount: largeFiles.length };
}

function checkTestCoverage(ctx) {
  const roots = [path.join(ctx.root, "councils"), path.join(ctx.root, "workspaces")].filter((x) => fs.existsSync(x));
  const files = collectCodeFiles(roots, 7000);

  const source = [];
  const tests = [];

  for (const file of files) {
    const rel = path.relative(ctx.root, file);
    const isTest = /(^|\/)(test|tests|__tests__)\//i.test(rel) || /\.test\.|\.spec\./i.test(rel);
    if (isTest) tests.push(file);
    else source.push(file);
  }

  const ratio = source.length > 0 ? tests.length / source.length : 0;
  if (source.length > 80 && tests.length === 0) {
    addFinding(ctx, {
      zone: "test_coverage",
      severity: "high",
      id: "test_coverage_zero",
      title: "No tests detected for active code",
      details: `Found ${source.length} source files and 0 test files.`,
      evidence: source.slice(0, 5).map((x) => `${x}:1`).join(";"),
      recommendation: "Add baseline tests for core flows and block merges without minimum test coverage."
    });
  } else if (source.length > 120 && ratio < 0.03) {
    addFinding(ctx, {
      zone: "test_coverage",
      severity: "medium",
      id: "test_coverage_low",
      title: "Test coverage appears low",
      details: `Test-to-source ratio is ${(ratio * 100).toFixed(1)}% (${tests.length}/${source.length}).`,
      evidence: tests.slice(0, 5).map((x) => `${x}:1`).join(";"),
      recommendation: "Increase coverage on critical scripts and parsers; prioritize regression tests for incidents."
    });
  }

  return { sourceFiles: source.length, testFiles: tests.length, ratio: Number(ratio.toFixed(4)) };
}

function checkPromptQuality(ctx) {
  const docFiles = [];
  const wsRoots = discoverWorkspaces(ctx.root);
  for (const ws of wsRoots) {
    for (const name of ["AGENTS.md", "SOUL.md", "USER.md"]) {
      const p = path.join(ws, name);
      if (fs.existsSync(p)) docFiles.push(p);
    }
  }

  let suspicious = 0;
  const suspiciousRefs = [];
  let oversized = 0;

  for (const file of docFiles) {
    let text = "";
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }

    if (text.length > 120_000) {
      oversized += 1;
      if (suspiciousRefs.length < 8) suspiciousRefs.push(`${file}:1`);
    }

    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      if (/ignore\s+previous\s+instruction|^system:\s*/i.test(lines[i])) {
        suspicious += 1;
        if (suspiciousRefs.length < 8) suspiciousRefs.push(`${file}:${i + 1}`);
      }
    }
  }

  if (suspicious > 0) {
    addFinding(ctx, {
      zone: "prompt_quality",
      severity: "medium",
      id: "prompt_quality_injection_markers",
      title: "Prompt docs include injection-like markers",
      details: `Detected ${suspicious} lines containing potentially unsafe prompt override markers.`,
      evidence: suspiciousRefs.join(";"),
      recommendation: "Remove unsafe markers, keep instruction hierarchy explicit, and sanitize imported prompt fragments."
    });
  }

  if (oversized > 0) {
    addFinding(ctx, {
      zone: "prompt_quality",
      severity: "low",
      id: "prompt_quality_oversized_docs",
      title: "Prompt documents are very large",
      details: `Detected ${oversized} oversized prompt docs that may reduce model focus.`,
      evidence: suspiciousRefs.join(";"),
      recommendation: "Split prompt docs into focused sections and keep run-critical instructions concise."
    });
  }

  return { promptDocs: docFiles.length, suspiciousMarkers: suspicious, oversizedDocs: oversized };
}

function checkDependencies(ctx) {
  const packageJsons = findFiles(ctx.root, (f) => path.basename(f) === "package.json", 600);
  let missingLocks = 0;
  const missingLockRefs = [];
  let floatingVersions = 0;
  const floatingRefs = [];

  for (const pkgPath of packageJsons) {
    const dir = path.dirname(pkgPath);
    const lockExists = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb"].some((f) => fs.existsSync(path.join(dir, f)));
    if (!lockExists) {
      missingLocks += 1;
      if (missingLockRefs.length < 8) missingLockRefs.push(`${pkgPath}:1`);
    }

    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    } catch {
      continue;
    }

    for (const sec of ["dependencies", "devDependencies", "optionalDependencies"]) {
      const dep = pkg[sec] || {};
      for (const [name, ver] of Object.entries(dep)) {
        if (String(ver).trim() === "*" || String(ver).trim().toLowerCase() === "latest") {
          floatingVersions += 1;
          if (floatingRefs.length < 8) floatingRefs.push(`${pkgPath}:1`);
        }
      }
    }
  }

  if (missingLocks > 0) {
    addFinding(ctx, {
      zone: "dependencies",
      severity: "medium",
      id: "dependencies_lockfile_missing",
      title: "Dependency lockfile missing",
      details: `Detected ${missingLocks} package manifests without lockfiles.`,
      evidence: missingLockRefs.join(";"),
      recommendation: "Commit lockfiles for deterministic installs and safer dependency updates."
    });
  }

  if (floatingVersions > 0) {
    addFinding(ctx, {
      zone: "dependencies",
      severity: "medium",
      id: "dependencies_floating_versions",
      title: "Floating dependency versions detected",
      details: `Detected ${floatingVersions} dependencies pinned to '*' or 'latest'.`,
      evidence: floatingRefs.join(";"),
      recommendation: "Pin dependency versions and adopt scheduled update windows with changelog review."
    });
  }

  return { packageJsonCount: packageJsons.length, missingLocks, floatingVersions };
}

function checkStorage(ctx) {
  const dbFiles = findFiles(ctx.root, (f) => /\.(db|sqlite)$/i.test(f), 5000);
  let totalBytes = 0;
  let largest = { path: "", bytes: 0 };

  for (const file of dbFiles) {
    let st;
    try {
      st = fs.statSync(file);
    } catch {
      continue;
    }
    totalBytes += st.size;
    if (st.size > largest.bytes) largest = { path: file, bytes: st.size };
  }

  const totalGb = totalBytes / (1024 ** 3);
  const largestGb = largest.bytes / (1024 ** 3);

  if (totalGb > 5) {
    addFinding(ctx, {
      zone: "storage",
      severity: "high",
      id: "storage_db_total_high",
      title: "Total database size is high",
      details: `Total DB footprint is ${totalGb.toFixed(2)} GB.`,
      evidence: largest.path ? `${largest.path}:1` : "",
      recommendation: "Archive historical records, rotate logs, and enforce retention policies."
    });
  } else if (totalGb > 2) {
    addFinding(ctx, {
      zone: "storage",
      severity: "medium",
      id: "storage_db_total_growth",
      title: "Database footprint is growing",
      details: `Total DB footprint is ${totalGb.toFixed(2)} GB.`,
      evidence: largest.path ? `${largest.path}:1` : "",
      recommendation: "Add growth alerts and schedule archive/cleanup before storage pressure causes failures."
    });
  }

  if (largest.bytes > 1 * 1024 ** 3) {
    addFinding(ctx, {
      zone: "storage",
      severity: "medium",
      id: "storage_largest_db_big",
      title: "Single database file is large",
      details: `Largest DB is ${largestGb.toFixed(2)} GB.`,
      evidence: largest.path ? `${largest.path}:1` : "",
      recommendation: "Partition high-growth tables and compact/optimize large DB files."
    });
  }

  return {
    dbFiles: dbFiles.length,
    totalDbGb: Number(totalGb.toFixed(3)),
    largestDbGb: Number(largestGb.toFixed(3))
  };
}

function checkSkillIntegrity(ctx) {
  const cfgPath = path.join(process.env.HOME || "", ".openclaw", "openclaw.json");
  if (!fs.existsSync(cfgPath)) {
    addFinding(ctx, {
      zone: "skill_integrity",
      severity: "medium",
      id: "skill_integrity_config_missing",
      title: "OpenClaw config missing",
      details: "Cannot validate skill references because openclaw.json is missing.",
      evidence: `${cfgPath}:1`,
      recommendation: "Restore config and rerun platform health checks."
    });
    return { checkedSkills: 0, missingSkills: 0 };
  }

  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  const skillNames = new Set();
  for (const agent of cfg.agents?.list || []) {
    for (const skill of agent.skills || []) skillNames.add(String(skill));
  }

  const roots = [
    path.join(process.env.HOME || "", ".codex", "skills"),
    path.join(process.env.HOME || "", ".codex", "skills", ".system"),
    path.join(ctx.root, "skills")
  ];

  const missing = [];
  for (const s of skillNames) {
    const ok = roots.some((r) => fs.existsSync(path.join(r, s, "SKILL.md")));
    if (!ok) missing.push(s);
  }

  if (missing.length > 0) {
    addFinding(ctx, {
      zone: "skill_integrity",
      severity: "medium",
      id: "skill_integrity_missing_skills",
      title: "Some configured skills are unresolved",
      details: `Detected ${missing.length} skill references without local SKILL.md.`,
      evidence: `${cfgPath}:1`,
      recommendation: "Install missing skills or remove stale references from agent configs."
    });
  }

  return { checkedSkills: skillNames.size, missingSkills: missing.length };
}

function checkConfigConsistency(ctx) {
  const cfgPath = path.join(process.env.HOME || "", ".openclaw", "openclaw.json");
  if (!fs.existsSync(cfgPath)) {
    addFinding(ctx, {
      zone: "config_consistency",
      severity: "high",
      id: "config_consistency_missing_config",
      title: "OpenClaw config missing",
      details: "Config consistency cannot be validated because openclaw.json is missing.",
      evidence: `${cfgPath}:1`,
      recommendation: "Restore openclaw.json and rerun consistency checks."
    });
    return { agents: 0, bindings: 0, mismatches: 1 };
  }

  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  const agents = cfg.agents?.list || [];
  const bindings = cfg.bindings || [];
  const agentIds = new Set(agents.map((a) => String(a.id)));

  let mismatch = 0;
  for (const b of bindings) {
    const id = String(b.agentId || "");
    if (!agentIds.has(id)) {
      mismatch += 1;
      addFinding(ctx, {
        zone: "config_consistency",
        severity: "high",
        id: "config_binding_agent_missing",
        title: "Binding references unknown agent",
        details: `Binding references missing agent '${id}'.`,
        evidence: `${cfgPath}:1`,
        recommendation: "Fix binding-to-agent mapping so every binding points to an existing agent."
      });
    }
  }

  let missingWorkspace = 0;
  for (const a of agents) {
    const ws = String(a.workspace || "");
    if (!ws || !fs.existsSync(ws)) {
      missingWorkspace += 1;
      addFinding(ctx, {
        zone: "config_consistency",
        severity: "high",
        id: "config_agent_workspace_missing",
        title: "Agent workspace path does not exist",
        details: `Workspace path is missing for agent '${a.id}'.`,
        evidence: `${cfgPath}:1`,
        recommendation: "Correct workspace paths in agent config and verify required files exist."
      });
    }
  }

  return { agents: agents.length, bindings: bindings.length, mismatches: mismatch + missingWorkspace };
}

function checkDataIntegrity(ctx) {
  const stateDir = path.join(ctx.root, "councils", "data", "state");
  const stateFiles = fs.existsSync(stateDir)
    ? fs.readdirSync(stateDir).filter((x) => x.endsWith(".json")).map((x) => path.join(stateDir, x))
    : [];

  let invalidState = 0;
  for (const file of stateFiles) {
    try {
      JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      invalidState += 1;
    }
  }

  if (invalidState > 0) {
    addFinding(ctx, {
      zone: "data_integrity",
      severity: "high",
      id: "data_integrity_state_invalid",
      title: "State files contain invalid JSON",
      details: `Detected ${invalidState} invalid state files.`,
      evidence: `${stateDir}:1`,
      recommendation: "Repair invalid state JSON files and add write-atomicity checks."
    });
  }

  const contactDb = findFiles(ctx.root, (f) => /contact/i.test(path.basename(f)) && /\.(db|sqlite)$/i.test(f), 50);
  if (contactDb.length === 0) {
    addFinding(ctx, {
      zone: "data_integrity",
      severity: "low",
      id: "data_integrity_contact_db_missing",
      title: "Contact database not found",
      details: "No contact database file detected for integrity validation.",
      evidence: `${ctx.root}:1`,
      recommendation: "Define canonical contact DB path or disable this check if not used."
    });
  }

  let dbErrors = 0;
  const badRefs = [];
  if (hasCommand("sqlite3")) {
    for (const db of contactDb) {
      const out = spawnSync("sqlite3", [db, "PRAGMA quick_check;"], { encoding: "utf8" });
      const text = String(out.stdout || "").trim().toLowerCase();
      if (out.status !== 0 || (text && text !== "ok")) {
        dbErrors += 1;
        if (badRefs.length < 5) badRefs.push(`${db}:1`);
      }
    }
  }

  if (dbErrors > 0) {
    addFinding(ctx, {
      zone: "data_integrity",
      severity: "high",
      id: "data_integrity_contact_db_corrupt",
      title: "Contact database integrity check failed",
      details: `quick_check failed for ${dbErrors} contact DB files.`,
      evidence: badRefs.join(";"),
      recommendation: "Restore from backup and run DB integrity validation in scheduled maintenance."
    });
  }

  return { stateFiles: stateFiles.length, invalidState, contactDb: contactDb.length, contactDbErrors: dbErrors };
}

function discoverWorkspaces(root) {
  const out = [];
  for (const base of [path.join(root, "workspaces", "llm.hub"), path.join(root, "workspaces", "llm.trading")]) {
    if (!fs.existsSync(base)) continue;
    for (const e of fs.readdirSync(base, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const ws = path.join(base, e.name);
      if (fs.existsSync(path.join(ws, "AGENTS.md"))) out.push(ws);
    }
  }
  return out;
}

function collectCodeFiles(roots, limit) {
  const files = [];
  const stack = [...roots];

  while (stack.length > 0 && files.length < limit) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        stack.push(p);
      } else if (e.isFile()) {
        if (!CODE_EXT.has(path.extname(e.name))) continue;
        files.push(p);
        if (files.length >= limit) break;
      }
    }
  }

  return files;
}

function findFiles(root, predicate, limit) {
  const out = [];
  const stack = [root];

  while (stack.length > 0 && out.length < limit) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        stack.push(p);
      } else if (e.isFile()) {
        if (predicate(p)) out.push(p);
        if (out.length >= limit) break;
      }
    }
  }

  return out;
}

function summarizeCounts(findings) {
  return {
    total: findings.length,
    critical: findings.filter((f) => f.severity === "critical").length,
    high: findings.filter((f) => f.severity === "high").length,
    medium: findings.filter((f) => f.severity === "medium").length,
    low: findings.filter((f) => f.severity === "low").length
  };
}

function normalizeSeverity(v) {
  const x = String(v || "").toLowerCase();
  if (x === "critical" || x === "high" || x === "medium" || x === "low") return x;
  return "low";
}

function hasCommand(cmd) {
  const out = spawnSync("sh", ["-lc", `command -v ${cmd}`], { encoding: "utf8" });
  return out.status === 0;
}

main();
