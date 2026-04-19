#!/usr/bin/env bash
# shellcheck shell=bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNTIME_ENV_FILE="$ROOT_DIR/.runtime/.env"

# Load optional persisted overrides.
if [ -f "$RUNTIME_ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a
  . "$RUNTIME_ENV_FILE"
  set +a
fi

if [ -z "${CODEX_BIN:-}" ]; then
  if command -v codex >/dev/null 2>&1; then
    CODEX_BIN="$(command -v codex)"
  else
    for candidate in \
      "$HOME/.vscode-server/extensions/openai.chatgpt-"*/bin/macos-aarch64/codex \
      "$HOME/.codex/bin/codex"; do
      if [ -x "$candidate" ]; then
        CODEX_BIN="$candidate"
        break
      fi
    done
  fi
fi

if [ -n "${CODEX_BIN:-}" ]; then
  export CODEX_BIN
fi

if [ -n "${SOURCE_REPO_PATH:-}" ]; then
  export SOURCE_REPO_PATH
fi

if [ -z "${SOURCE_REPO_URL:-}" ] && [ -z "${SOURCE_REPO_PATH:-}" ]; then
  for candidate in \
    "$ROOT_DIR/../../openclaw_x" \
    "$ROOT_DIR/../../beta/openclaw_x"; do
    if [ -d "$candidate/.git" ]; then
      SOURCE_REPO_URL="$(cd "$candidate" && pwd)"
      break
    fi
  done
fi

if [ -n "${SOURCE_REPO_URL:-}" ]; then
  export SOURCE_REPO_URL
fi
