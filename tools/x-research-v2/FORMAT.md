# FORMAT.md

## Scope

- Read this file on every `x-research-v2` request, even if the user did not explicitly ask for formatting rules.
- If the request is not about X/Twitter research, this file is not required.
- For X/Twitter requests, the LLM must follow these rules strictly.

## Source-of-truth for content

- Final text must be based on data returned by the script (`scripts/analyze.js --json`).
- Do not invent posts, facts, quotes, or links that are not present in script output.
- Use post text from script output as primary input for explanations and summaries.
- If script output is empty or contains an error, report that state clearly in the final response.

## Response style policy

- Do not respond in default assistant tone.
- No generic filler, no "as an AI" language.
- Communicate in a conversational way: clear, natural, and human.
- If user's assumption is weak, challenge it politely and concretely.

## Output format (strict, text-first)

- Keep output compact: 8-16 lines by default.
- Enforce `MUST` rules below. If any is violated, regenerate the final answer before sending.

### MUST rules

- Intro/summary block must be one coherent paragraph (2-4 sentences), not bullet list.
- Do not use bullet markers (`-`, `•`) for the summary paragraph.
- Add one empty line after: `Провожу серч для последних N постов от @username`.
- Before numbered posts, always add heading: `Ключевые темы N постов:`.
- Add one empty line after heading `Ключевые темы N постов:`.
- Post list must be numbered (`1.`, `2.`, ...).
- Each post line must contain exactly one inline link in format: `... | [*](https://...)`.
- Do not append a separate `Ссылки на посты` section at the end.
- English market terms must be immediately rewritten into simple Russian phrasing.
Example:
`Sub-60k — вопрос времени` -> `Цена ниже 60k — вопрос времени`.
`green delta` -> `положительная дельта`.
`flip 67.5k` -> `закрепление выше 67.5k`.
`short` -> `шорт` or `ставка на снижение`.
- Final answer language: Russian (unless user explicitly asks another language).
- Keep post description concise by default (about 1 short sentence per post).
- If shortening removes key meaning, keep the longer version.
- Target length per post line: roughly 8-18 words; if meaning is lost, allow a longer line.
- Abbreviations are allowed only when they improve readability and do not lose meaning (indicators, price moves, common terms).
- If abbreviation may confuse, use full plain wording instead.
- Optional emphasis: highlight only 1-2 key words in a line using `**bold**`; do not overuse.

### Profile analysis template

```md
Провожу серч для последних N постов от @username

<2-4 коротких строки по сути выборки, без префикса "Overall summary">
<если встречаются англоязычные термины: объясняй простыми русскими словами>

Ключевые темы N постов:

1. <русский тезис по посту #1> | [*](https://x.com/.../status/...)
2. <русский тезис по посту #2> | [*](https://x.com/.../status/...)
3. <русский тезис по посту #3> | [*](https://x.com/.../status/...)
...
N. <русский тезис по посту #N> | [*](https://x.com/.../status/...)
```

For keyword analysis:

```text
Провожу серч по ключевым словам: <ключ1, ключ2>. Нашел N последних совпадений.
<2-3 коротких строки по сути того, как используются ключевые слова>

Ключевые темы N постов:

1. @username: <русский тезис по посту #1> | [*](https://x.com/.../status/...)
2. @username: <русский тезис по посту #2> | [*](https://x.com/.../status/...)
...
```

- If keyword fetch returns `fetch_meta.retry_exhausted=true`, skip post list and use `Error response template (X unavailable)`.

For tracked accounts:

```text
Отслеживаемые аккаунты: всего X | включено Y | выключено Z
- Охват: <какой сегмент покрывают>
- Перекос: <нет / где концентрация>
- Что поправить: <1 конкретный следующий шаг>
```

### Error response template (X unavailable)

- Trigger this block only when script JSON indicates retry exhaustion (`fetch_meta.retry_exhausted=true`).
- Keep it short: 1-2 lines, no post list, no extra advice.
- Preferred wording:

```text
Сейчас X временно отвечает с ошибкой после N попыток. Попробуй позже.
<краткая причина, если есть: например `HTTP 429` или `network/dns error while reaching x.com`>
```

## Exclusions (how NOT to write)

- Do not use old headers/sections: `[X PROFILE]`, `Overall summary`, `What this feed feels like`, `Posts (latest ...)`.
- Do not add advisory tails like `Что делать дальше`, `If you want`, or similar filler endings.
- Do not switch to mixed English structure when Russian format is requested.
- Do not print raw long URLs on separate lines; always use short markdown label `[*](...)`.
- Do not use `[пост N]` labels in links; use only `[*](url)`.
- Do not rewrite script output into a new template; keep final chat output aligned with this format.
- Do not use business/corporate tone, generic disclaimers, or “as an AI” phrasing.
- Do not output a trailing dump of links (e.g., `Ссылки на посты:` + list of URLs).
- Do not keep English phrasing when a plain Russian equivalent is available.

## Avoid numeric analysis

- Do not analyze likes, reposts, impressions, medians, counts, ratios, or trends based on metrics.
- Focus on narrative meaning: topic, position, tone, and message progression.
- If numbers appear in source posts, mention only when they are central to the author's message itself.

## Telegram formatting rules

- Never print raw long URL lines in response body.
- Use Telegram Markdown hyperlink format with minimal anchor: `[*](https://...)`.
- Keep one concise linked label per post (`[*]` only).
- The visible text should be the takeaway, not the URL.
- For thread replies, avoid generic "short reply" wording: explain the counterpart message and the author response.
- For photo posts, include one short note from image OCR/vision output when available.
