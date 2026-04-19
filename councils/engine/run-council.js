#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { ROOT, getProfile, getCheckPath } = require("./registry");
const { shouldRunByCadence } = require("./scheduler");
const { normalizeEvidenceList } = require("./evidence");
const { redactNotificationMessage } = require(path.join(ROOT, "councils", "checks", "security-checks", "notification-redaction.js"));
const { publishReport, escapeHtml } = require(path.join(ROOT, "councils", "data", "delivery", "telegram-renderer.js"));

const REPORT_AGENT_ID = (process.env.SECURITY_REPORT_AGENT_ID || "tests").trim();
const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 };
const LOCAL_OPENCLAW_ENTRY = path.join(ROOT, "infrastructure", "openclaw-2026.3.2", "openclaw.mjs");

function resolveOpenClawInvocation() {
  const explicitBin = String(process.env.OPENCLAW_BIN || "").trim();
  if (explicitBin) {
    return { command: explicitBin, prefixArgs: [] };
  }
  if (fs.existsSync(LOCAL_OPENCLAW_ENTRY)) {
    return { command: process.execPath || "node", prefixArgs: [LOCAL_OPENCLAW_ENTRY] };
  }
  return { command: "openclaw", prefixArgs: [] };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const profile = getProfile(args.profile);
  if (!profile) throw new Error(`Unknown council profile: ${args.profile}`);

  const expectedWorkspaces = discoverExpectedWorkspaces();
  if (!shouldRunByCadence(profile.cadence, new Date())) {
    process.stderr.write(`Running profile '${profile.id}' outside preferred cadence window\n`);
  }

  const refreshed = profile.id === "platform-health" ? { skipped: true, runs: [] } : refreshSecurityReports(expectedWorkspaces);
  const summary = profile.id === "platform-health"
    ? collectPlatformHealthSummary(expectedWorkspaces)
    : collectSummary(expectedWorkspaces);
  const codeRead = runCodeReadAi();

  const aiAnalysis = args.skipAi ? { recommendations: [], error: "skip_ai" } : buildAiCouncilAnalysis(profile, summary, codeRead);
  const recommendations = mergeRecommendations(summary.topIssues, aiAnalysis.recommendations || []);

  const report = buildReport(profile, summary, codeRead, recommendations, refreshed, aiAnalysis.error || null);
  const saveInfo = saveReport(profile.id, report);

  let publishInfo = null;
  if (args.send) {
    const text = buildTelegramReport(report);
    const safeText = redactNotificationMessage(text, { maxLength: 3900, preserveNewlines: true }).text;
    publishInfo = await publishReport(report, {
      text: safeText,
      criticalImmediateAlert: Boolean(profile.criticalImmediateAlert)
    });
  }

  const out = {
    ok: true,
    profile: profile.id,
    status: report.status,
    generatedAtUtc: report.generatedAtUtc,
    generatedAtMsk: report.generatedAtMsk,
    recommendations: report.recommendations.length,
    critical: report.counts.critical,
    save: saveInfo,
    publish: publishInfo,
    ai: {
      used: !args.skipAi,
      error: aiAnalysis.error || null,
      modelAgent: REPORT_AGENT_ID
    }
  };

  if (args.json) {
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  } else {
    process.stdout.write(`${profile.title}: ${report.status} | rec=${report.recommendations.length} | critical=${report.counts.critical}\n`);
    process.stdout.write(`Report: ${saveInfo.latestPath}\n`);
  }
}

function parseArgs(argv) {
  const out = {
    profile: "security",
    send: false,
    json: false,
    skipAi: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--profile") out.profile = String(argv[i + 1] || out.profile);
    if (a === "--send") out.send = true;
    if (a === "--json") out.json = true;
    if (a === "--skip-ai") out.skipAi = true;
  }

  return out;
}

function discoverExpectedWorkspaces() {
  const out = [];
  const bases = [path.join(ROOT, "workspaces", "llm.hub"), path.join(ROOT, "workspaces", "llm.trading")];

  for (const base of bases) {
    if (!fs.existsSync(base)) continue;
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const wsPath = path.join(base, entry.name);
      if (!fs.existsSync(path.join(wsPath, "AGENTS.md"))) continue;
      out.push(path.relative(path.join(ROOT, "workspaces"), wsPath));
    }
  }

  return out.sort();
}

function refreshSecurityReports(expectedWorkspaces) {
  if (process.env.RUN_SECURITY_REVIEW === "0") return { skipped: true, runs: [] };

  const script = getCheckPath("security-review");
  const runs = [];
  for (const ws of expectedWorkspaces) {
    const workspacePath = path.join(ROOT, "workspaces", ws);
    const out = spawnSync(script, ["--workspace-root", workspacePath], {
      cwd: ROOT,
      encoding: "utf8"
    });

    runs.push({ workspace: ws, status: Number(out.status || 0), stderr: String(out.stderr || "").trim().slice(0, 400) });
  }

  return { skipped: false, runs };
}

function collectSummary(expectedWorkspaces) {
  const dataRoot = path.join(ROOT, "councils", "data", "workspaces");
  const byWorkspace = [];
  const missingReports = [];
  const issueMap = new Map();
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };

  for (const ws of expectedWorkspaces) {
    const latestPath = path.join(dataRoot, ws, "security", "latest.json");
    if (!fs.existsSync(latestPath)) {
      missingReports.push(ws);
      continue;
    }

    const report = readJson(latestPath, {});
    const findings = Array.isArray(report.findings) ? report.findings : [];

    byWorkspace.push({
      workspace: ws,
      status: String(report.status || (findings.length ? "findings" : "passed")),
      counts: report.counts || {
        total: findings.length,
        critical: findings.filter((f) => f.severity === "critical").length,
        high: findings.filter((f) => f.severity === "high").length,
        medium: findings.filter((f) => f.severity === "medium").length,
        low: findings.filter((f) => f.severity === "low").length
      }
    });

    for (const f of findings) {
      const sev = normalizeSeverity(f.severity);
      counts[sev] += 1;

      const id = String(f.id || "unknown");
      const title = String(f.title || id);
      const key = `${id}::${title}`;

      if (!issueMap.has(key)) {
        issueMap.set(key, {
          id,
          title,
          severity: sev,
          occurrences: 0,
          workspaces: new Set(),
          details: String(f.details || ""),
          references: []
        });
      }

      const row = issueMap.get(key);
      row.occurrences += 1;
      row.workspaces.add(ws);
      for (const ref of normalizeEvidenceList(f.evidence || "")) row.references.push(ref);

      if ((SEVERITY_RANK[sev] || 0) > (SEVERITY_RANK[row.severity] || 0)) row.severity = sev;
    }
  }

  const topIssues = [...issueMap.values()]
    .map((x) => ({
      ...x,
      workspaces: [...x.workspaces].sort(),
      references: dedupeRefs(x.references).slice(0, 12),
      perspective: mapPerspective(`${x.id} ${x.title}`),
      details: defaultDetailsRu(x.id) || x.details,
      recommendation: defaultRecommendation(x.id)
    }))
    .sort((a, b) => {
      const sr = (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0);
      if (sr !== 0) return sr;
      return b.occurrences - a.occurrences;
    });

  const totalFindings = counts.critical + counts.high + counts.medium + counts.low;
  const status = totalFindings === 0 && missingReports.length === 0 ? "OK" : "ISSUES";

  return {
    generatedAtUtc: new Date().toISOString(),
    generatedAtMsk: formatMoscowDate(new Date()),
    status,
    scannedWorkspaces: byWorkspace.length,
    expectedWorkspaces: expectedWorkspaces.length,
    missingReports,
    byWorkspace: byWorkspace.sort((a, b) => a.workspace.localeCompare(b.workspace)),
    counts,
    totalFindings,
    topIssues
  };
}

function collectPlatformHealthSummary(expectedWorkspaces) {
  const script = getCheckPath("platform-health");
  const out = spawnSync("node", [script, "--root", ROOT], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024
  });

  if (out.error) {
    return buildHealthSummaryFromFindings(expectedWorkspaces, [
      {
        zone: "platform_health",
        severity: "high",
        id: "platform_health_check_runtime_error",
        title: "Platform health checks runtime error",
        details: String(out.error.message || "unknown runtime error"),
        evidence: `${script}:1`,
        recommendation: "Fix platform-health-checks runtime error and rerun council.",
        scope: "global"
      }
    ], {});
  }

  const parsed = tryParseJson(out.stdout || "");
  if (!parsed || !Array.isArray(parsed.findings)) {
    return buildHealthSummaryFromFindings(expectedWorkspaces, [
      {
        zone: "platform_health",
        severity: "high",
        id: "platform_health_check_invalid_output",
        title: "Platform health checks returned invalid output",
        details: "Expected JSON payload with findings[] was not returned.",
        evidence: `${script}:1`,
        recommendation: "Fix output contract of platform-health-checks and rerun council.",
        scope: "global"
      }
    ], {});
  }

  return buildHealthSummaryFromFindings(expectedWorkspaces, parsed.findings, parsed.zones || {});
}

function buildHealthSummaryFromFindings(expectedWorkspaces, findings, zones) {
  const issueMap = new Map();
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };

  for (const f of findings || []) {
    const sev = normalizeSeverity(f.severity);
    counts[sev] += 1;

    const id = String(f.id || "unknown");
    const title = String(f.title || id);
    const key = `${id}::${title}`;

    if (!issueMap.has(key)) {
      issueMap.set(key, {
        id,
        title,
        severity: sev,
        occurrences: 0,
        workspaces: new Set(),
        details: String(f.details || ""),
        references: [],
        perspective: mapPerspective(`${f.zone || ""} ${id} ${title}`),
        recommendation: String(f.recommendation || defaultRecommendation(id)),
        zone: String(f.zone || "platform_health")
      });
    }

    const row = issueMap.get(key);
    row.occurrences += 1;
    if (String(f.scope || "global").startsWith("workspace:")) {
      row.workspaces.add(String(f.scope).replace(/^workspace:/, ""));
    } else {
      for (const ws of expectedWorkspaces) row.workspaces.add(ws);
    }
    for (const ref of normalizeEvidenceList(f.evidence || "")) row.references.push(ref);
  }

  const topIssues = [...issueMap.values()]
    .map((x) => ({
      ...x,
      workspaces: [...x.workspaces].sort(),
      references: dedupeRefs(x.references).slice(0, 12)
    }))
    .sort((a, b) => {
      const sr = (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0);
      if (sr !== 0) return sr;
      return b.occurrences - a.occurrences;
    });

  const totalFindings = counts.critical + counts.high + counts.medium + counts.low;
  const status = totalFindings === 0 ? "OK" : "ISSUES";

  return {
    generatedAtUtc: new Date().toISOString(),
    generatedAtMsk: formatMoscowDate(new Date()),
    status,
    scannedWorkspaces: expectedWorkspaces.length,
    expectedWorkspaces: expectedWorkspaces.length,
    missingReports: [],
    byWorkspace: expectedWorkspaces.map((ws) => ({ workspace: ws, status: "checked", counts: {} })),
    counts,
    totalFindings,
    topIssues,
    zones
  };
}

function runCodeReadAi() {
  const script = getCheckPath("code-read-ai");
  const out = spawnSync("node", [script, "--root", ROOT], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024
  });

  if (out.error) return { formatVersion: "code-read-ai.v1", scannedFiles: 0, matchCount: 0, references: [], error: out.error.message };

  const parsed = tryParseJson(out.stdout || "");
  if (!parsed) return { formatVersion: "code-read-ai.v1", scannedFiles: 0, matchCount: 0, references: [], error: "invalid_json" };
  return parsed;
}

function buildAiCouncilAnalysis(profile, summary, codeRead) {
  const isPlatformHealth = profile.id === "platform-health";
  const payload = {
    profile: {
      id: profile.id,
      title: profile.title,
      perspectives: profile.perspectives || ["offensive", "defensive", "data_privacy", "operational_realism"]
    },
    report_format: {
      objective: "Machine-readable recommendations with exact code evidence links.",
      required_headers: [
        "SECURITY_CONTEXT",
        "PERSPECTIVE_ANALYSIS",
        "NUMBERED_RECOMMENDATIONS",
        "EVIDENCE_INDEX"
      ],
      evidence_link_format: "relative/path/to/file:line"
    },
    baseline_summary: {
      status: summary.status,
      counts: summary.counts,
      missingReports: summary.missingReports,
      zones: summary.zones || {},
      topIssues: summary.topIssues.slice(0, 25).map((x) => ({
        id: x.id,
        severity: x.severity,
        title: x.title,
        details: x.details,
        workspaces: x.workspaces,
        references: x.references,
        zone: x.zone || ""
      }))
    },
    code_read: {
      scannedFiles: codeRead.scannedFiles || 0,
      matchCount: codeRead.matchCount || 0,
      references: (codeRead.references || []).slice(0, 450)
    }
  };

  const prompt = [
    isPlatformHealth
      ? "You are Platform Health Council. Analyze platform health across nine operational zones."
      : "You are Security Council. Analyze actual code evidence and baseline security findings.",
    "Rules:",
    "1) Return STRICT JSON only.",
    "2) Analyze in 4 perspectives: offensive, defensive, data_privacy, operational_realism.",
    "3) Every recommendation must include at least one evidence reference path:line when possible.",
    "4) Prioritize critical issues that require immediate action.",
    "5) Avoid vague advice. Keep recommendations implementation-ready.",
    "6) Keep title <= 90 chars, details <= 160 chars, recommendation <= 180 chars.",
    "7) Do NOT include long file path lists in details/recommendation text. Mention the problem concisely.",
    "8) Use concrete short wording suitable for Telegram message limits.",
    "9) Write 'title' in English. Write 'details' and 'recommendation' in Russian.",
    isPlatformHealth
      ? "10) For platform-health, prioritize these zones: cron_health, code_quality, test_coverage, prompt_quality, dependencies, storage, skill_integrity, config_consistency, data_integrity."
      : "10) For security, prioritize exploitable and immediate-risk issues first.",
    "",
    "JSON schema:",
    "{",
    '  "recommendations": [',
    "    {",
    '      "id": "string",',
    '      "severity": "critical|high|medium|low",',
    '      "title": "string",',
    '      "perspective": "offensive|defensive|data_privacy|operational_realism",',
    '      "details": "string",',
    '      "scope": "global|workspace:<name>",',
    '      "zone": "string",',
    '      "recommendation": "string",',
    '      "references": [{"path":"string","line":number}]',
    "    }",
    "  ]",
    "}",
    "",
    "Input payload:",
    JSON.stringify(payload)
  ].join("\n");

  const sessionId = `council-${profile.id}-${summary.generatedAtUtc.slice(0, 10)}`;
  const openclaw = resolveOpenClawInvocation();
  const out = spawnSync(
    openclaw.command,
    [...openclaw.prefixArgs, "agent", "--agent", REPORT_AGENT_ID, "--json", "--session-id", sessionId, "--message", prompt],
    {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 30 * 1024 * 1024
    }
  );

  if (out.error) return { recommendations: [], error: out.error.message };

  const parsed = extractAgentJson(out.stdout || "");
  if (!parsed || !Array.isArray(parsed.recommendations)) {
    return { recommendations: [], error: "llm_non_json_or_schema_mismatch" };
  }

  const recommendations = parsed.recommendations
    .map((x) => normalizeRecommendation(x))
    .filter(Boolean)
    .slice(0, 40);

  return { recommendations, error: null };
}

function normalizeRecommendation(x) {
  if (!x || typeof x !== "object") return null;

  const severity = normalizeSeverity(x.severity);
  const perspective = ["offensive", "defensive", "data_privacy", "operational_realism"].includes(String(x.perspective || ""))
    ? String(x.perspective)
    : "defensive";

  const refs = Array.isArray(x.references)
    ? x.references
        .map((r) => ({ path: String(r.path || "").trim(), line: Number(r.line || 1) || 1, column: 1 }))
        .filter((r) => r.path)
        .slice(0, 8)
    : [];

  return {
    id: String(x.id || `ai_${perspective}`).trim() || "ai_recommendation",
    severity,
    title: sanitizeForTelegram(String(x.title || "AI recommendation").trim(), 90),
    perspective,
    details: sanitizeForTelegram(String(x.details || "").trim(), 160),
    scope: String(x.scope || "global").trim(),
    zone: String(x.zone || "").trim(),
    recommendation: sanitizeForTelegram(String(x.recommendation || "").trim(), 180),
    references: refs
  };
}

function mergeRecommendations(baseIssues, aiRecommendations) {
  const out = [];
  const seen = new Set();

  for (const issue of baseIssues.slice(0, 25)) {
    const key = `base:${issue.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: issue.id,
      severity: issue.severity,
      title: issue.title,
      perspective: issue.perspective,
      details: issue.details,
      scope: issue.workspaces.length === 1 ? `workspace:${issue.workspaces[0]}` : "global",
      zone: issue.zone || "",
      recommendation: issue.recommendation,
      references: issue.references
    });
  }

  for (const rec of aiRecommendations) {
    const key = `ai:${rec.id}:${rec.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rec);
  }

  out.sort((a, b) => (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0));
  return out.map((r, idx) => ({ ...r, number: idx + 1 }));
}

function buildReport(profile, summary, codeRead, recommendations, refreshed, aiError) {
  const counts = {
    critical: recommendations.filter((x) => x.severity === "critical").length,
    high: recommendations.filter((x) => x.severity === "high").length,
    medium: recommendations.filter((x) => x.severity === "medium").length,
    low: recommendations.filter((x) => x.severity === "low").length
  };

  const status = counts.critical + counts.high + counts.medium + counts.low === 0 ? "OK" : "ISSUES";
  const contextHeading = profile.id === "platform-health" ? "PLATFORM_HEALTH_CONTEXT" : "SECURITY_CONTEXT";

  return {
    reportFormatVersion: "council-report.v2",
    profile,
    generatedAtUtc: summary.generatedAtUtc,
    generatedAtMsk: summary.generatedAtMsk,
    status,
    headings: {
      context: contextHeading,
      perspectives: "PERSPECTIVE_ANALYSIS",
      recommendations: "NUMBERED_RECOMMENDATIONS",
      evidence: "EVIDENCE_INDEX"
    },
    coverage: {
      expectedWorkspaces: summary.expectedWorkspaces,
      scannedWorkspaces: summary.scannedWorkspaces,
      missingReports: summary.missingReports
    },
    counts,
    baseline: {
      ruleEngineCounts: summary.counts,
      ruleEngineZones: summary.zones || {},
      topIssues: summary.topIssues,
      refresh: refreshed
    },
    codeRead: {
      formatVersion: codeRead.formatVersion,
      scannedFiles: codeRead.scannedFiles || 0,
      matchCount: codeRead.matchCount || 0,
      references: (codeRead.references || []).slice(0, 500)
    },
    ai: {
      agentId: REPORT_AGENT_ID,
      error: aiError
    },
    recommendations,
    evidenceIndex: buildEvidenceIndex(recommendations)
  };
}

function saveReport(profileId, report) {
  const dir = path.join(ROOT, "councils", "data", "reports", profileId);
  fs.mkdirSync(dir, { recursive: true });

  const stamp = report.generatedAtUtc.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const file = path.join(dir, `${profileId}-${stamp}.json`);
  const latest = path.join(dir, "latest.json");

  fs.writeFileSync(file, JSON.stringify(report, null, 2) + "\n");
  fs.writeFileSync(latest, JSON.stringify(report, null, 2) + "\n");

  return { filePath: file, latestPath: latest };
}

function buildTelegramReport(report) {
  const lines = [];
  const recs = report.recommendations.slice(0, 6);
  const wsTotal = report.coverage.expectedWorkspaces;

  lines.push(`<b>${escapeHtml(report.profile.title)}</b> — ${escapeHtml(report.generatedAtMsk)}`);
  lines.push("");
  lines.push(`<b>Status:</b> ${report.status}`);
  lines.push(`<b>Coverage:</b> ${report.coverage.scannedWorkspaces}/${wsTotal} workspace`);
  if ((report.coverage.missingReports || []).length > 0) {
    lines.push(`<b>Missing:</b> <code>${escapeHtml(report.coverage.missingReports.join(", "))}</code>`);
  }

  lines.push("");
  lines.push(`<b>Findings: ${report.recommendations.length}</b>`);
  lines.push(`  · critical: ${report.counts.critical}`);
  lines.push(`  · high:     ${report.counts.high}`);
  lines.push(`  · medium:   ${report.counts.medium}`);
  lines.push(`  · low:      ${report.counts.low}`);

  if (report.recommendations.length === 0) {
    lines.push("");
    lines.push("All clear.");
    return lines.join("\n");
  }

  lines.push("");
  lines.push("<b>─── Issues ───</b>");

  for (const rec of recs) {
    const scopeLabel = rec.scope === "global" ? `×${wsTotal}` : escapeHtml(String(rec.scope || "global"));
    lines.push("");
    lines.push(`<b>${rec.number}. [${rec.severity.toUpperCase()}] ${escapeHtml(rec.id)}</b>`);
    lines.push(`   ${escapeHtml(shortText(rec.title, 100))} · <b>${scopeLabel}</b>`);
    lines.push(`   <i>${escapeHtml(shortText(rec.details || "No details.", 190))}</i>`);
  }

  lines.push("");
  lines.push("<b>─── Solutions ───</b>");
  for (const rec of recs) {
    lines.push("");
    lines.push(`<b>${rec.number}. ${escapeHtml(rec.id)}</b>`);
    lines.push(`   ${escapeHtml(shortText(rec.recommendation || "Apply remediation and verify in next run.", 210))}`);
  }

  return lines.join("\n");
}

function buildEvidenceIndex(recommendations) {
  const refs = [];
  for (const rec of recommendations) {
    for (const r of rec.references || []) {
      refs.push({
        rec: rec.number,
        id: rec.id,
        severity: rec.severity,
        path: r.path,
        line: Number(r.line || 1)
      });
    }
  }
  return dedupeRefs(refs);
}

function defaultDetailsRu(id) {
  const map = {
    security_modules_not_wired: "Модули присутствуют, но точки интеграции в scripts/tools не обнаружены.",
    backup_script_missing: "Файл backup-databases.sh отсутствует; шифрование резервных копий не подтверждено.",
    gitignore_missing: "Без .gitignore нельзя применить правила исключения security-чувствительных файлов.",
    auth_failures_in_logs: "Auth-ошибки в gateway error log — необходим разбор источника и ротация учётных данных.",
    prompt_injection_patterns_weak: "content-sanitizer.js не содержит ожидаемых паттернов prompt-injection.",
    gateway_non_loopback: "Gateway принимает соединения не только от loopback — потенциальное раскрытие сервиса.",
    gateway_auth_disabled: "Аутентификация gateway отключена — несанкционированный доступ возможен.",
    secrets_in_git: "Паттерны секретов обнаружены в git-истории или индексе.",
    no_env_commit: "Файл .env отслеживается git — риск утечки конфигурации.",
    safe_delete_policy: "Отсутствует политика безопасного удаления с предварительным подтверждением."
  };
  return map[id] || "";
}

function defaultRecommendation(id) {
  const map = {
    gateway_non_loopback: "Привязать gateway только к loopback и проверить экспозицию через firewall.",
    gateway_auth_disabled: "Включить аутентификацию gateway и немедленно ротировать учётные данные.",
    secrets_in_git: "Удалить секреты из git, ротировать все учётные данные, добавить pre-commit хуки.",
    prompt_injection_sanitizer_missing: "Интегрировать sanitizer перед передачей недоверенного контента в модели/инструменты.",
    no_env_commit: "Удалить отслеживаемые .env-файлы, ввести блокировку через pre-commit.",
    safe_delete_policy: "Требовать явного подтверждения и использовать trash-first (обратимое удаление).",
    backup_script_missing: "Создать scripts/backup-databases.sh с шифрованием (age/gpg/openssl), ротацией резервных копий и проверкой восстановления.",
    gitignore_missing: "Добавить .gitignore во все workspace: .env*, *.db, *.sqlite, .openclaw/; запустить git rm --cached для уже отслеживаемых файлов.",
    auth_failures_in_logs: "Разобрать источники auth-ошибок, ротировать токены/учётные данные, ужесточить ACL и настроить алертинг.",
    security_modules_not_wired: "Встроить sanitizer/redaction в каждый pipeline обработки недоверенного ввода; добавить тесты и CI-gate.",
    prompt_injection_patterns_weak: "Расширить content-sanitizer паттернами jailbreak, tool-override, exfil; добавить тесты на encoding/obfuscation."
  };
  return map[id] || "Исправить в коде/конфигурации и верифицировать в следующем запуске.";
}

function mapPerspective(text) {
  const s = String(text || "").toLowerCase();
  if (s.includes("secret") || s.includes("token") || s.includes("privacy") || s.includes("key")) return "data_privacy";
  if (s.includes("auth") || s.includes("permission") || s.includes("sanitizer") || s.includes("injection")) return "defensive";
  if (s.includes("backup") || s.includes("gitignore") || s.includes("delete") || s.includes("cron")) return "operational_realism";
  return "offensive";
}

function normalizeSeverity(x) {
  const s = String(x || "").toLowerCase();
  if (s === "critical" || s === "high" || s === "medium" || s === "low") return s;
  return "low";
}

function dedupeRefs(refs) {
  const out = [];
  const seen = new Set();
  for (const r of refs || []) {
    if (!r || !r.path) continue;
    const key = `${r.path}:${r.line || 1}:${r.id || ""}:${r.rec || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function sanitizeForTelegram(text, maxLen) {
  const noPaths = String(text || "")
    .replace(/\/Users\/[^\s,;]+/g, "[path]")
    .replace(/[A-Za-z]:\\[^\s,;]+/g, "[path]");
  return shortText(noPaths, maxLen);
}

function shortText(text, maxLen) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLen - 1))}…`;
}

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

function tryParseJson(text) {
  try {
    return JSON.parse(String(text || ""));
  } catch {
    return null;
  }
}

function extractAgentJson(raw) {
  const parsed = tryParseJson(raw);
  if (parsed && parsed.status === "ok") {
    const text = (parsed.result?.payloads || [])
      .map((p) => (typeof p.text === "string" ? p.text.trim() : ""))
      .filter(Boolean)
      .join("\n");
    return extractJsonFragment(text);
  }

  return extractJsonFragment(String(raw || ""));
}

function extractJsonFragment(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function formatMoscowDate(date) {
  const fmt = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  return `${fmt.format(date)} MSK`;
}

main().catch((error) => {
  process.stderr.write(`run-council failed: ${error.message}\n`);
  process.exit(1);
});
