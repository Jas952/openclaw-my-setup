# Humanizer Plugin

Automatically post-processes outgoing bot messages to remove AI-style writing patterns.
Works without an LLM - rule-based only, using deterministic rules.

## Layout

| File | Purpose |
|---|---|
| `humanizer.config.json` | **Edit here** - all plugin parameters |
| `core.js` | Rule logic: stock phrases, hedging, rule-of-three, em dash |
| `index.ts` | OpenClaw entry point - listens to `message_sending` |
| `openclaw.plugin.json` | Plugin metadata and config JSON Schema |
| `humanizer.test.js` | Automated tests: `node humanizer.test.js` |

Installed version: `~/.openclaw/extensions/humanizer/`

## Running Tests

```bash
node /Users/dmitriy/openclaw/tools/humanizer/humanizer.test.js
```

## All Configurable Parameters

### Basic

| Parameter | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `true` | Enable or disable the plugin entirely |
| `dryRun` | boolean | `false` | Simulation mode - rules are applied but the text is not changed. Useful for testing |
| `debug` | boolean | `false` | Log skip reasons and triggered rules |

### Where It Applies

| Parameter | Type | Default | Description |
|---|---|---|---|
| `channels` | string[] | `["telegram"]` | Apply only in these channels. Known values: `"telegram"`, `"slack"`. Empty array = all channels |
| `targetPeerIds` | string[] | `[]` | Telegram peer ID allowlist: direct chats, groups, topics. Empty array = all peers in the allowed channels. Topic format: `"-1001774997176:topic:1"` |

**Current targetPeerIds:**
- `455103738` - direct chat (Dima)
- `-1001774997176` - full group
- `-1001774997176:topic:1` - a specific group topic

### Activation Conditions (when to apply)

| Parameter | Type | Default | Description |
|---|---|---|---|
| `minChars` | number | `900` | Minimum number of characters. Short messages are skipped |
| `minWords` | number | `140` | Alternative word-based trigger. If the word count is >= this value, the plugin activates even if `minChars` is not reached |
| `minSentences` | number | `4` | Minimum number of sentences. Very short replies are skipped |

> **Tip:** Lower `minChars` to 300-400 if you want coverage for medium-length replies.

### Skip Conditions (when NOT to apply)

| Parameter | Type | Default | Description |
|---|---|---|---|
| `skipWhenCodeBlocks` | boolean | `true` | Skip messages containing code blocks (``` ```) |
| `skipWhenMostlyStructured` | boolean | `true` | Skip messages where most lines are lists, tables, or headings |
| `structuredRatioThreshold` | number (0-1) | `0.45` | Structured-content threshold. If the share of structured lines is above this value, the message is skipped |

### What It Changes

| Parameter | Type | Default | Description |
|---|---|---|---|
| `normalizeEmDash` | boolean | `true` | Replaces em dash characters (—, –) with a regular hyphen (`-`) |
| `removeStockPhrases` | boolean | `true` | Removes AI cliches (see list below) |
| `reduceHedging` | boolean | `true` | Reduces excessive hedging language (see list below) |
| `rewriteRuleOfThree` | boolean | `true` | Rewrites "A, B, and C" into a less formulaic structure |

### Protection Against Overediting

| Parameter | Type | Default | Description |
|---|---|---|---|
| `maxEditRatio` | number (0-1) | `0.35` | If the amount of change exceeds 35% of the text length, edits are blocked and the original text is preserved. This protects against overly aggressive rewrites |

---

## Stock Phrase List (`removeStockPhrases`)

| ID | Pattern | Replacement |
|---|---|---|
| `stock_end_of_day` | "at the end of the day" | "ultimately" |
| `stock_worth_noting` | "it's worth noting that" | *(removed)* |
| `stock_important_to_note` | "it is important to note" | *(removed)* |
| `stock_should_be_noted` | "it should be noted" | *(removed)* |
| `stock_in_conclusion` | "in conclusion" | "in short," |
| `stock_to_be_honest` | "to be honest" | *(removed)* |
| `stock_transparent` | "to be completely transparent" | *(removed)* |
| `stock_delve` | "delve into" | "look into" |
| `stock_leverage` | "leverage" | "use" |
| `stock_tapestry` | "tapestry" / "rich tapestry" | "mix" |

## Hedging Rule List (`reduceHedging`)

| ID | Pattern | Replacement |
|---|---|---|
| `hedge_may_potentially` | "may potentially" | "may" |
| `hedge_might_potentially` | "might potentially" | "might" |
| `hedge_often_can` | "often can" | "can" |
| `hedge_can_often` | "can often" | "can" |
| `hedge_it_appears` | "it appears that" | "it seems" |
| `hedge_somewhat` | "somewhat " | *(removed)* |

---
