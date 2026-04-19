#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/.runtime"
UPSTREAM_ELIXIR_DIR="$RUNTIME_DIR/upstream/elixir"
DEFAULT_WORKFLOW="$RUNTIME_DIR/WORKFLOW.md"

# shellcheck disable=SC1091
. "$ROOT_DIR/scripts/load_env.sh"

if [ ! -d "$UPSTREAM_ELIXIR_DIR" ]; then
  echo "[error] Symphony upstream is not bootstrapped"
  echo "[hint]  Run: $ROOT_DIR/scripts/bootstrap.sh"
  exit 1
fi

WORKFLOW_PATH="$DEFAULT_WORKFLOW"
if [ $# -gt 0 ] && [[ "${1}" != "--" ]] && [[ "${1#-}" == "$1" ]]; then
  WORKFLOW_PATH="$1"
  shift
fi

EXTRA_ARGS=()
if [ $# -gt 0 ] && [ "$1" = "--" ]; then
  shift
fi
if [ $# -gt 0 ]; then
  EXTRA_ARGS=("$@")
fi

if [ ! -f "$WORKFLOW_PATH" ]; then
  cp "$ROOT_DIR/WORKFLOW.openclaw.example.md" "$WORKFLOW_PATH"
  echo "[error] Workflow file was missing; template copied to: $WORKFLOW_PATH"
  echo "[hint]  Edit the file and run again"
  exit 1
fi

if [ -z "${SYMPHONY_WORKSPACE_ROOT:-}" ]; then
  export SYMPHONY_WORKSPACE_ROOT="$RUNTIME_DIR/workspaces"
fi

if [ -z "${CODEX_BIN:-}" ] || [ ! -x "${CODEX_BIN:-}" ]; then
  echo "[error] codex binary is unavailable"
  echo "[hint]  Ensure codex is on PATH or set executable CODEX_BIN (also supports .runtime/.env)"
  exit 1
fi

COMMON_ARGS=(
  "--i-understand-that-this-will-be-running-without-the-usual-guardrails"
  "--logs-root" "$RUNTIME_DIR/logs"
)

cd "$UPSTREAM_ELIXIR_DIR"

if command -v mise >/dev/null 2>&1; then
  mise trust >/dev/null 2>&1 || true
  mise install
  mise exec -- mix setup
  mise exec -- mix build
  exec mise exec -- ./bin/symphony "${COMMON_ARGS[@]}" "${EXTRA_ARGS[@]}" "$WORKFLOW_PATH"
elif command -v mix >/dev/null 2>&1; then
  mix setup
  mix build
  exec ./bin/symphony "${COMMON_ARGS[@]}" "${EXTRA_ARGS[@]}" "$WORKFLOW_PATH"
else
  echo "[error] No Elixir runtime found (mise or mix is required)"
  echo "[hint]  Install mise (recommended) or Elixir/OTP + mix"
  exit 1
fi
