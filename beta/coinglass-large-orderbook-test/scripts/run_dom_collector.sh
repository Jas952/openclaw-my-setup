#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

URL="https://www.coinglass.com/large-orderbook-statistics"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
SESSION="cg_dom_${STAMP}"
OUT_DIR="$ROOT_DIR/output/dom-collector-${STAMP}"
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

read -r -d '' COLLECT_JS <<'JS' || true
() => {
  const text = document.body.innerText || '';
  const allLines = text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const whaleLineIdx = allLines.findIndex((s) => s === 'Whale Orders');
  if (whaleLineIdx < 0) {
    return { ok: false, reason: 'Whale Orders block not found' };
  }

  const largeTradesLineIdx = allLines.findIndex((s, idx) => idx > whaleLineIdx && s === 'Large Trades');
  const lines = largeTradesLineIdx > whaleLineIdx
    ? allLines.slice(whaleLineIdx, largeTradesLineIdx)
    : allLines.slice(whaleLineIdx);

  const amountToUsd = (amountText) => {
    const m = amountText.match(/^\$([\d,.]+)\s*([KMB])?$/i);
    if (!m) return null;
    const n = Number(m[1].replace(/,/g, ''));
    if (!Number.isFinite(n)) return null;
    const u = (m[2] || '').toUpperCase();
    const mult = u === 'B' ? 1_000_000_000 : u === 'M' ? 1_000_000 : u === 'K' ? 1_000 : 1;
    return n * mult;
  };

  const isSide = (s) => s === 'B' || s === 'S';
  const isPrice = (s) => /^\d{4,6}(?:\.\d+)?$/.test(s);
  const isAmount = (s) => /^\$[\d,.]+(?:[KMB])?$/i.test(s);
  const isAge = (s) => /[0-9]/.test(s) && /[DHms]/.test(s);

  const rows = [];
  for (let i = 0; i < lines.length; i += 1) {
    const side = lines[i];
    const priceText = lines[i + 1];
    const amountText = lines[i + 2];
    const ageText = lines[i + 3];
    if (!isSide(side) || !isPrice(priceText || '') || !isAmount(amountText || '')) {
      continue;
    }
    rows.push({
      side,
      price: Number(priceText),
      amount_text: amountText,
      amount_usd: amountToUsd(amountText),
      age_text: isAge(ageText || '') ? ageText : null
    });
  }

  const instrumentFromLine = allLines.find((s) => /Perpetual/i.test(s) && s.includes('/')) || null;
  const instrumentMatch = text.match(/\b([A-Za-z0-9]+\s+[A-Z0-9]+\/[A-Z0-9]+\s+Perpetual)\b/);
  const intervalMatch = text.match(/\b(\d+\s+(?:minute|hour|day|week|month))\b/i);

  return {
    ok: true,
    source: 'coinglass_dom_text',
    page: location.href,
    collected_at_utc: new Date().toISOString(),
    instrument: instrumentFromLine || (instrumentMatch ? instrumentMatch[1] : null),
    interval: intervalMatch ? intervalMatch[1] : null,
    row_count: rows.length,
    rows
  };
}
JS

echo "Opening page..."
"$PWCLI" --session "$SESSION" open "$URL" >"$OUT_DIR/open.log" 2>&1

read -r -d '' WAIT_JS <<'JS' || true
async (page) => {
  const maxAttempts = 8;
  for (let i = 0; i < maxAttempts; i += 1) {
    const ready = await page.evaluate(() => {
      const t = document.body.innerText || '';
      return t.includes('Whale Orders') && /\$[0-9]/.test(t);
    });
    if (ready) return { ready: true, attempts: i + 1 };
    await page.waitForTimeout(1000);
  }
  return { ready: false, attempts: maxAttempts };
}
JS

"$PWCLI" --session "$SESSION" run-code "$WAIT_JS" >"$OUT_DIR/wait.log" 2>&1 || true

echo "Collecting rendered text data..."
RAW_RESULT="$("$PWCLI" --session "$SESSION" eval "$COLLECT_JS" 2>&1 || true)"
printf '%s\n' "$RAW_RESULT" >"$OUT_DIR/eval.log"

JSON_RESULT="$(printf '%s\n' "$RAW_RESULT" | awk '/^### Result/{flag=1;next}/^### Ran Playwright code/{flag=0}flag')"
if [[ -z "${JSON_RESULT// }" ]]; then
  echo "Failed to extract JSON from playwright output. See $OUT_DIR/eval.log" >&2
  "$PWCLI" --session "$SESSION" close >/dev/null 2>&1 || true
  exit 1
fi

printf '%s\n' "$JSON_RESULT" >"$OUT_DIR/orders.json"

echo "Saving visual artifact..."
"$PWCLI" --session "$SESSION" screenshot >"$OUT_DIR/screenshot.log" 2>&1 || true

"$PWCLI" --session "$SESSION" close >/dev/null 2>&1 || true

ROWS="$(printf '%s\n' "$JSON_RESULT" | awk -F': ' '/"row_count"/ {gsub(/,/, "", $2); print $2; exit}')"
echo "Done. row_count=${ROWS:-unknown}"
echo "Output: $OUT_DIR/orders.json"
