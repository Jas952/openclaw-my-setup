#!/usr/bin/env bash

set -euo pipefail

ROOT="/Users/dmitriy/openclaw"
SCRIPT="$ROOT/councils/engine/run-council.js"
CB_SERVER="$ROOT/councils/data/delivery/critical-callback-server.js"
LOG_DIR="$ROOT/councils/data/cron"
LOG_FILE="$LOG_DIR/dev-security-report.log"
CB_LOG="$LOG_DIR/critical-callback-server.log"
LOCK_DIR="/tmp/openclaw-dev-security-report.lock"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export SECURITY_REPORT_AGENT_ID="${SECURITY_REPORT_AGENT_ID:-tests}"
export COUNCIL_PROFILE="${COUNCIL_PROFILE:-security}"

mkdir -p "$LOG_DIR"

# Ensure critical-callback-server is running (idempotent — exits 0 if port already in use)
/opt/homebrew/bin/node "$CB_SERVER" >>"$CB_LOG" 2>&1 &
disown

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  exit 0
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

{
  echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] run-dev-security-report start"
  cd "$ROOT"
  /opt/homebrew/bin/node "$SCRIPT" --profile "${COUNCIL_PROFILE}" --send --json
  echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] run-dev-security-report done"
} >>"$LOG_FILE" 2>&1
