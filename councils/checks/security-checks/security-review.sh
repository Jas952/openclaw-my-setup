#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
OPENCLAW_ROOT="${OPENCLAW_ROOT:-$(cd "$SCRIPT_DIR/../../.." && pwd -P)}"
WORKSPACE_ROOT="${WORKSPACE_ROOT:-$(pwd)}"
OUTPUT_JSON=true
SAVE_REPORT=true

while [ "$#" -gt 0 ]; do
  case "$1" in
    --text)
      OUTPUT_JSON=false
      shift
      ;;
    --no-save)
      SAVE_REPORT=false
      shift
      ;;
    --workspace-root)
      WORKSPACE_ROOT="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Usage: security-review.sh [--text] [--no-save] [--workspace-root <path>]" >&2
      exit 2
      ;;
  esac
done

if [ ! -d "$WORKSPACE_ROOT" ]; then
  echo "Workspace root does not exist: $WORKSPACE_ROOT" >&2
  exit 2
fi
WORKSPACE_ROOT="$(cd "$WORKSPACE_ROOT" && pwd -P)"

FINDINGS_FILE="$(mktemp)"
trap 'rm -f "$FINDINGS_FILE"' EXIT

export WORKSPACE_ROOT
export FINDINGS_FILE
export OPENCLAW_ROOT

source "$SCRIPT_DIR/lib/security-review-checks.sh"

run_all_security_checks

now_utc="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
report_stamp="$(date -u +"%Y%m%dT%H%M%SZ")"
finding_count="$(wc -l <"$FINDINGS_FILE" | tr -d ' ')"

report_json="$(
node - "$FINDINGS_FILE" "$WORKSPACE_ROOT" "$now_utc" <<'NODE'
const fs = require("node:fs");

const file = process.argv[2];
const workspace = process.argv[3];
const timestamp = process.argv[4];
const findings = [];

const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
for (const line of lines) {
  const [severity, id, title, details, evidence] = line.split("\t");
  const refs = String(evidence || "")
    .split(";")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((ref) => {
      const m = ref.match(/^(.*?):(\d+)(?::(\d+))?$/);
      if (m) {
        return { path: m[1], line: Number(m[2]), column: m[3] ? Number(m[3]) : 1 };
      }
      return { path: ref, line: 1, column: 1 };
    });

  findings.push({
    severity,
    id,
    title,
    details,
    evidence: evidence || "",
    references: refs
  });
}

const severityRank = { critical: 4, high: 3, medium: 2, low: 1 };
findings.sort((a, b) => (severityRank[b.severity] || 0) - (severityRank[a.severity] || 0));

const report = {
  reportFormatVersion: "security-review.v2",
  headings: {
    summary: "Summary",
    findings: "Findings",
    references: "References (path:line)"
  },
  generatedAt: timestamp,
  workspace,
  status: findings.length === 0 ? "passed" : "findings",
  counts: {
    total: findings.length,
    critical: findings.filter((f) => f.severity === "critical").length,
    high: findings.filter((f) => f.severity === "high").length,
    medium: findings.filter((f) => f.severity === "medium").length,
    low: findings.filter((f) => f.severity === "low").length
  },
  findings
};

process.stdout.write(JSON.stringify(report, null, 2));
NODE
)"

report_path=""
latest_path=""
log_path=""
if [ "$SAVE_REPORT" = true ]; then
  workspace_key="$(node - "$OPENCLAW_ROOT" "$WORKSPACE_ROOT" <<'NODE'
const path = require("node:path");
const openclawRoot = process.argv[2];
const workspaceRoot = process.argv[3];
const wsRoot = path.join(openclawRoot, "workspaces");
let key = "";

if (workspaceRoot.startsWith(wsRoot + path.sep)) {
  key = path.relative(wsRoot, workspaceRoot);
} else {
  key = workspaceRoot.replace(/^\/+/, "");
}

const safe = key
  .split(path.sep)
  .filter(Boolean)
  .map((part) => part.replace(/[^a-zA-Z0-9._-]/g, "_"))
  .join("/");

process.stdout.write(safe || "unknown-workspace");
NODE
)"
  data_dir="$OPENCLAW_ROOT/councils/data/workspaces/$workspace_key/security"
  reports_dir="$data_dir/reports"
  mkdir -p "$reports_dir"

  report_path="$reports_dir/security-review-$report_stamp.json"
  latest_path="$data_dir/latest.json"
  log_path="$data_dir/security-review-log.md"

  printf '%s\n' "$report_json" >"$report_path"
  printf '%s\n' "$report_json" >"$latest_path"

  if [ ! -f "$log_path" ]; then
    cat >"$log_path" <<'LOGHEADER'
# security-review-log.md

- format: `timestamp | status | counts | report`
LOGHEADER
  fi

  log_line="$(node - "$report_path" <<'NODE'
const fs = require("node:fs");
const reportPath = process.argv[2];
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const c = report.counts || {};
process.stdout.write(`- ${report.generatedAt} | status=${report.status} | total=${c.total || 0} critical=${c.critical || 0} high=${c.high || 0} medium=${c.medium || 0} low=${c.low || 0} | report=${reportPath}`);
NODE
)"
  printf '%s\n' "$log_line" >>"$log_path"
fi

if [ "$OUTPUT_JSON" = true ]; then
  echo "$report_json"
else
  echo "Security Review @ $now_utc"
  echo "Workspace: $WORKSPACE_ROOT"
  echo "Findings: $finding_count"
  if [ "$SAVE_REPORT" = true ]; then
    echo "Report: $report_path"
    echo "Latest: $latest_path"
    echo "Log: $log_path"
  fi
  echo
  node -e '
const report = JSON.parse(process.argv[1]);
for (const f of report.findings) {
  console.log(`[${f.severity.toUpperCase()}] ${f.id} - ${f.title}`);
  console.log(`  ${f.details}`);
  if (f.evidence) console.log(`  evidence: ${f.evidence}`);
}
' "$report_json"
fi

if [ "$finding_count" -eq 0 ]; then
  exit 0
fi

exit 1
