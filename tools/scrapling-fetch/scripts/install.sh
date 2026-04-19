#!/usr/bin/env bash
set -euo pipefail

ROOT="/Users/dmitriy/openclaw/tools/scrapling-fetch"
VENV="$ROOT/.venv"
PW="$ROOT/.playwright"

python3 -m venv "$VENV"
"$VENV/bin/pip" install -U pip
"$VENV/bin/pip" install "scrapling[fetchers]"

# Dynamic/stealth browser binaries are optional.
PLAYWRIGHT_BROWSERS_PATH="$PW" "$VENV/bin/python" -m playwright install chromium

echo "Installed Scrapling skill environment:"
echo "  venv: $VENV"
echo "  browsers: $PW"
