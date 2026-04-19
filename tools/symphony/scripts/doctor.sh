#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/.runtime"
UPSTREAM_DIR="$RUNTIME_DIR/upstream"
WORKFLOW_PATH="${1:-$RUNTIME_DIR/WORKFLOW.md}"

# shellcheck disable=SC1091
. "$ROOT_DIR/scripts/load_env.sh"

pass() { echo "[ok] $*"; }
warn() { echo "[warn] $*"; }
fail() { echo "[fail] $*"; }

if [ -d "$UPSTREAM_DIR/.git" ]; then
  pass "Upstream clone exists: $UPSTREAM_DIR"
else
  fail "Missing upstream clone. Run ./scripts/bootstrap.sh"
fi

for bin in git; do
  if command -v "$bin" >/dev/null 2>&1; then
    pass "Binary found: $bin"
  else
    fail "Binary missing: $bin"
  fi
done

if [ -n "${CODEX_BIN:-}" ] && [ -x "${CODEX_BIN:-}" ]; then
  pass "Codex binary resolved: $CODEX_BIN"
else
  warn "Codex binary unresolved (set CODEX_BIN in shell or .runtime/.env)"
fi

if command -v screen >/dev/null 2>&1; then
  pass "Detached runner found: screen"
else
  warn "screen is missing (required for ./scripts/service.sh detached mode)"
fi

if command -v mise >/dev/null 2>&1; then
  pass "Runtime manager found: mise"
elif command -v mix >/dev/null 2>&1; then
  pass "Elixir tooling found: mix"
else
  warn "No mise/mix. Install Elixir toolchain to run Symphony Elixir reference."
fi

if [ -f "$WORKFLOW_PATH" ]; then
  pass "Workflow file exists: $WORKFLOW_PATH"
else
  fail "Workflow file missing: $WORKFLOW_PATH"
fi

if [ -n "${LINEAR_API_KEY:-}" ]; then
  pass "LINEAR_API_KEY is set"
else
  warn "LINEAR_API_KEY is not set"
fi

if [ -n "${SOURCE_REPO_PATH:-}" ]; then
  if [ -d "${SOURCE_REPO_PATH:-}" ]; then
    pass "SOURCE_REPO_PATH is set: $SOURCE_REPO_PATH"
  else
    warn "SOURCE_REPO_PATH does not exist: $SOURCE_REPO_PATH"
  fi
elif [ -n "${SOURCE_REPO_URL:-}" ]; then
  pass "SOURCE_REPO_URL is set: $SOURCE_REPO_URL"
else
  warn "SOURCE_REPO_PATH/SOURCE_REPO_URL is not set (set in shell or .runtime/.env)"
fi
