---
name: scrapling-fetch
description: "Universal web scraping via Scrapling (HTTP, Stealthy, Dynamic). Use when web_fetch is not enough or pages are anti-bot/JS-heavy."
homepage: https://github.com/D4Vinci/Scrapling
metadata:
  {
    "openclaw":
      {
        "emoji": "🕸️",
        "requires": { "bins": ["python3"], "env": [] }
      }
  }
---

# scrapling-fetch

Unified scraping skill powered by Scrapling.

Use this skill for:
- normal HTTP scraping (`http` mode)
- anti-bot aware scraping (`stealth` mode)
- JS-heavy dynamic pages (`dynamic` mode)

Script:
- `/Users/dmitriy/openclaw/tools/scrapling-fetch/scripts/fetch.py`

## Install

```bash
# Create isolated env for this skill
python3 -m venv /Users/dmitriy/openclaw/tools/scrapling-fetch/.venv
/Users/dmitriy/openclaw/tools/scrapling-fetch/.venv/bin/pip install -U pip
/Users/dmitriy/openclaw/tools/scrapling-fetch/.venv/bin/pip install "scrapling[fetchers]"

# Optional: browser binaries for dynamic/stealth modes
# Keep browsers inside workspace path:
PLAYWRIGHT_BROWSERS_PATH=/Users/dmitriy/openclaw/tools/scrapling-fetch/.playwright \
/Users/dmitriy/openclaw/tools/scrapling-fetch/.venv/bin/python -m playwright install chromium
```

## Commands

```bash
# Plain HTTP scraping
/Users/dmitriy/openclaw/tools/scrapling-fetch/.venv/bin/python \
  /Users/dmitriy/openclaw/tools/scrapling-fetch/scripts/fetch.py \
  --url "https://example.com" \
  --mode http \
  --selector "title::text" \
  --json

# Stealth mode (anti-bot)
/Users/dmitriy/openclaw/tools/scrapling-fetch/.venv/bin/python \
  /Users/dmitriy/openclaw/tools/scrapling-fetch/scripts/fetch.py \
  --url "https://example.com" \
  --mode stealth \
  --selector "h1::text" \
  --headless \
  --json

# Dynamic mode for JS-heavy pages
PLAYWRIGHT_BROWSERS_PATH=/Users/dmitriy/openclaw/tools/scrapling-fetch/.playwright \
/Users/dmitriy/openclaw/tools/scrapling-fetch/.venv/bin/python \
  /Users/dmitriy/openclaw/tools/scrapling-fetch/scripts/fetch.py \
  --url "https://example.com" \
  --mode dynamic \
  --selector "//h1/text()" \
  --selector-type xpath \
  --network-idle \
  --json
```

## Notes

- If `--selector` is omitted, script returns page title + compact body text sample.
- `--selector` accepts Scrapy-style CSS pseudo selectors (`::text`, `::attr(...)`) or XPath.
- `--all` returns all matches; otherwise only first match.
- Output is JSON by default when `--json` is set, suitable for downstream tool chaining.
