---
name: x-research-v2
description: Analyze Twitter/X content by direct request-time fetch: profile analysis, keyword search over latest posts, and review tracked accounts from JSON config. Use when user asks to analyze an X profile, find latest posts by keywords, or inspect preconfigured tracked accounts.
metadata:
  {
    "openclaw":
      {
        "emoji": "X",
        "requires": { "bins": ["node", "python3"] }
      }
  }
---

# X Research v2

Formatting rules are in `FORMAT.md` (read it before composing final chat output).

Use this skill when the user asks about Twitter/X analysis in chat.

Core chat use-cases:
1. Analyze a specific profile.
2. Search latest posts by keywords.
3. Inspect accounts pre-added in root JSON config.

Script:
- `workspaces/personal/skills/x-research-v2/scripts/analyze.js`

Default data sources:
- Direct request-time X fetch (inside script execution)
- Tracked accounts config: `/Users/dmitriy/openclaw/openclaw_x/modules/accounts/accounts.json`

## Commands

Profile analysis:
```bash
node /Users/dmitriy/openclaw/workspaces/personal/skills/x-research-v2/scripts/analyze.js --profile ZordXBT --limit 12
```

Keyword search in latest posts:
```bash
node /Users/dmitriy/openclaw/workspaces/personal/skills/x-research-v2/scripts/analyze.js --keywords "btc,etf,solana" --limit 20
```

Tracked accounts from JSON:
```bash
node /Users/dmitriy/openclaw/workspaces/personal/skills/x-research-v2/scripts/analyze.js --tracked
```

JSON output for further processing:
```bash
node /Users/dmitriy/openclaw/workspaces/personal/skills/x-research-v2/scripts/analyze.js --profile ZordXBT --json
```

## Analysis protocol (Olympiad level)

Treat every request as a high-signal analytical task, not routine lookup.

1. Validate data freshness:
- Always use results fetched during current script run.
- If fetch fails/empty, report exact cause from script output.

2. Profile analysis (`--profile`):
- Detect dominant themes in latest posts.
- Detect directional bias (bullish/bearish/neutral) from wording and repeated signals.
- Surface behavioral pattern: reactive/news-driven vs thesis-driven posting.
- Keep it domain-agnostic: topic can be crypto, politics, AI, sports, product, personal blog, etc.
- If post is part of a thread/reply, include thread context: what was said before and what exactly the author replied to.
- If post has photo media with available local path, read image and include visual context in the post line.

3. Keyword analysis (`--keywords`):
- Count where keywords actually appear (not just one accidental mention).
- Prioritize latest and high-engagement matches.
- Identify whether keywords cluster around one account or are market-wide.

4. Tracked accounts (`--tracked`):
- Report enabled/disabled split.
- Point out concentration risk (too many similar accounts, one-side bias).

5. Always include uncertainty:
- If signal is weak, say it directly.
- Do not invent confidence where data is thin.

## Execution policy (strict)

- For standard X/Twitter requests, always run local script `scripts/analyze.js` first.
- Run script in JSON mode for generation input (`--json`) whenever final answer needs narration/formatting.
- Script output must be treated as source data (full post text), not as final user-facing prose.
- LLM must compose the final message using `FORMAT.md`.
- If JSON has `fetch_meta.retry_exhausted=true`, send short failure response from `FORMAT.md` error template.
- Never paste full raw post text dump into final answer.
- Never use `Overall summary` label in final answer.
- Final answer language for this skill: Russian, unless user explicitly requests another language.
- Do not add mode switching logic; use one direct-fetch path for profile/keywords.
- Never output old template sections: `[X PROFILE]`, `Overall summary`, `What this feed feels like`.
- Before sending final reply, enforce `FORMAT.md` checks:
  - summary is paragraph (no bullets),
  - no trailing `Ссылки на посты` section,
  - links are inline per post line (`... | [*](...)`),
  - obvious English trading terms are rewritten to simple Russian.
- If any check fails, regenerate final answer once before sending.

## Formatting

- Read `FORMAT.md` and follow it strictly for final output formatting.
