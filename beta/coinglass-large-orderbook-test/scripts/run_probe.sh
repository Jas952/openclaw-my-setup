#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

URL="https://www.coinglass.com/large-orderbook-statistics"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
SESSION="cg_probe_${STAMP}"
OUT_DIR="$ROOT_DIR/output/probe-${STAMP}"
REPORT="$OUT_DIR/report.txt"

mkdir -p "$OUT_DIR"

if ! command -v npx >/dev/null 2>&1; then
  echo "npx not found. Install Node.js/npm first." >&2
  exit 1
fi

export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
export PWCLI="$CODEX_HOME/skills/playwright/scripts/playwright_cli.sh"

if [[ ! -x "$PWCLI" ]]; then
  echo "playwright wrapper not found: $PWCLI" >&2
  exit 1
fi

run() {
  {
    echo
    echo "### $*"
    "$@"
  } >>"$REPORT" 2>&1
}

{
  echo "Coinglass probe report"
  echo "UTC: $(date -u '+%Y-%m-%d %H:%M:%S')"
  echo "Target: $URL"
  echo "Session: $SESSION"
} >"$REPORT"

run "$PWCLI" --session "$SESSION" open "$URL"
run "$PWCLI" --session "$SESSION" snapshot
run "$PWCLI" --session "$SESSION" eval "() => document.body.innerText.includes('Whale Orders & Large Trades')"
run "$PWCLI" --session "$SESSION" eval "() => performance.getEntriesByType('resource').map(r => r.name).filter(n => n.includes('capi.coinglass.com')).slice(-50)"
run "$PWCLI" --session "$SESSION" network
run "$PWCLI" --session "$SESSION" console
run "$PWCLI" --session "$SESSION" screenshot

read -r -d '' PROBE_CODE <<'JS' || true
async (page) => {
  const targets = ['/api/largeOrder', '/api/largeTakerOrder', '/api/v2/kline'];
  const out = [];
  page.on('request', (req) => {
    const url = req.url();
    if (targets.some((t) => url.includes(t))) {
      out.push({
        kind: 'request',
        url,
        headers: req.headers()
      });
    }
  });
  page.on('response', async (resp) => {
    const url = resp.url();
    if (targets.some((t) => url.includes(t))) {
      try {
        const text = await resp.text();
        out.push({
          kind: 'response',
          url,
          status: resp.status(),
          length: text.length,
          head: text.slice(0, 180)
        });
      } catch (error) {
        out.push({
          kind: 'response',
          url,
          status: resp.status(),
          error: String(error)
        });
      }
    }
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  return out;
}
JS

run "$PWCLI" --session "$SESSION" run-code "$PROBE_CODE"
run "$PWCLI" --session "$SESSION" close

if [[ -d "$ROOT_DIR/.playwright-cli" ]]; then
  cp -R "$ROOT_DIR/.playwright-cli" "$OUT_DIR/playwright-cli"
fi

echo "Probe finished. Report: $REPORT"
