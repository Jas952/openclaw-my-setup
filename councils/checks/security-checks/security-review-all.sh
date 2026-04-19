#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
OPENCLAW_ROOT="${OPENCLAW_ROOT:-$(cd "$SCRIPT_DIR/../../.." && pwd -P)}"
WORKSPACES_ROOT="${WORKSPACES_ROOT:-$OPENCLAW_ROOT/workspaces}"
OUTPUT_JSON=true

if [ "${1:-}" = "--text" ]; then
  OUTPUT_JSON=false
fi

targets=()
for base in "$WORKSPACES_ROOT/llm.hub" "$WORKSPACES_ROOT/llm.trading"; do
  [ -d "$base" ] || continue
  for ws in "$base"/*; do
    [ -d "$ws" ] || continue
    [ -f "$ws/AGENTS.md" ] || continue
    targets+=("$ws")
  done
done

if [ "${#targets[@]}" -eq 0 ]; then
  echo "No workspaces found under $WORKSPACES_ROOT" >&2
  exit 2
fi

results="[]"
failures=0
for ws in "${targets[@]}"; do
  if out="$(WORKSPACE_ROOT="$ws" "$SCRIPT_DIR/security-review.sh" --no-save 2>/dev/null)"; then
    status="passed"
  else
    status="findings"
    failures=$((failures + 1))
    out="${out:-$(WORKSPACE_ROOT="$ws" "$SCRIPT_DIR/security-review.sh" --no-save || true)}"
  fi

  row="$(node - "$ws" "$status" <<'NODE'
const ws = process.argv[2];
const status = process.argv[3];
process.stdout.write(JSON.stringify({ workspace: ws, status }));
NODE
)"

  results="$(node - "$results" "$row" <<'NODE'
const arr = JSON.parse(process.argv[2]);
const row = JSON.parse(process.argv[3]);
arr.push(row);
process.stdout.write(JSON.stringify(arr));
NODE
)"
done

if [ "$OUTPUT_JSON" = true ]; then
  echo "$results" | node -e 'const fs=require("node:fs");const s=fs.readFileSync(0,"utf8");console.log(JSON.stringify(JSON.parse(s),null,2));'
else
  echo "Security review all workspaces"
  for ws in "${targets[@]}"; do
    if WORKSPACE_ROOT="$ws" "$SCRIPT_DIR/security-review.sh" --text; then
      :
    else
      :
    fi
    echo
  done
fi

if [ "$failures" -gt 0 ]; then
  exit 1
fi

exit 0
