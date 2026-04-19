#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/.runtime"
UPSTREAM_DIR="$RUNTIME_DIR/upstream"
UPSTREAM_REPO="https://github.com/openai/symphony.git"

mkdir -p "$RUNTIME_DIR/logs" "$RUNTIME_DIR/workspaces"

if ! command -v git >/dev/null 2>&1; then
  echo "[error] git is required"
  exit 1
fi

if [ -d "$UPSTREAM_DIR/.git" ]; then
  echo "[info] Updating upstream clone..."
  git -C "$UPSTREAM_DIR" pull --ff-only
else
  echo "[info] Cloning upstream Symphony..."
  git clone --depth 1 "$UPSTREAM_REPO" "$UPSTREAM_DIR"
fi

if [ ! -f "$RUNTIME_DIR/WORKFLOW.md" ]; then
  cp "$ROOT_DIR/WORKFLOW.openclaw.example.md" "$RUNTIME_DIR/WORKFLOW.md"
  echo "[info] Created $RUNTIME_DIR/WORKFLOW.md from template"
fi

echo "[ok] Bootstrap complete"
echo "[next] Edit: $RUNTIME_DIR/WORKFLOW.md"
echo "[next] Run:  $ROOT_DIR/scripts/doctor.sh"
