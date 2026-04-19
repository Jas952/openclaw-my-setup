# Humanizer Plugin

Автоматически обрабатывает исходящие сообщения бота, убирая AI-паттерны письма.
Работает без LLM — только rule-based (детерминированные правила).

## Расположение

| Файл | Назначение |
|---|---|
| `humanizer.config.json` | **Редактировать здесь** — все параметры плагина |
| `core.js` | Логика правил (stock phrases, hedging, rule-of-three, em dash) |
| `index.ts` | Entry point для OpenClaw — слушает `message_sending` |
| `openclaw.plugin.json` | Метаданные плагина и JSON Schema конфига |
| `humanizer.test.js` | Авто-тесты: `node humanizer.test.js` |

Установленная версия: `~/.openclaw/extensions/humanizer/`

## Запуск тестов

```bash
node /Users/dmitriy/openclaw/tools/humanizer/humanizer.test.js
```

## Все настраиваемые параметры

### Базовые

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `enabled` | boolean | `true` | Включить/выключить плагин целиком |
| `dryRun` | boolean | `false` | Режим симуляции — правила применяются, но текст не меняется. Включай для тестирования |
| `debug` | boolean | `false` | Логировать причины пропуска и сработавшие правила |

### Где применяется

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `channels` | string[] | `["telegram"]` | Применять только в этих каналах. Известные значения: `"telegram"`, `"slack"`. Пустой массив = все каналы |
| `targetPeerIds` | string[] | `[]` | Белый список Telegram peer ID (личные, группы, топики). Пустой массив = все пиры в разрешённых каналах. Формат топика: `"-1001774997176:topic:1"` |

**Текущие targetPeerIds:**
- `455103738` — личный чат (Дима)
- `-1001774997176` — группа целиком
- `-1001774997176:topic:1` — конкретный топик группы

### Условия активации (когда применять)

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `minChars` | number | `900` | Минимальное число символов. Короткие сообщения пропускаются |
| `minWords` | number | `140` | Альтернативный триггер по словам. Если слов >= этого — активируется (даже если minChars не достигнут) |
| `minSentences` | number | `4` | Минимальное число предложений. Очень короткие ответы пропускаются |

> **Совет:** Снизи `minChars` до 300–400, если нужно покрытие для средних по длине ответов.

### Условия пропуска (когда НЕ применять)

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `skipWhenCodeBlocks` | boolean | `true` | Пропускать сообщения с блоками кода (``` ```) |
| `skipWhenMostlyStructured` | boolean | `true` | Пропускать если большинство строк — списки/таблицы/заголовки |
| `structuredRatioThreshold` | number (0–1) | `0.45` | Порог "структурированности". Если доля структурных строк > этого значения → пропуск |

### Что именно исправляет

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `normalizeEmDash` | boolean | `true` | Заменяет em dash (— –) на обычный дефис ( - ) |
| `removeStockPhrases` | boolean | `true` | Удаляет AI-клише (см. список ниже) |
| `reduceHedging` | boolean | `true` | Убирает избыточные хеджирования (см. список ниже) |
| `rewriteRuleOfThree` | boolean | `true` | Переписывает "A, B, и C" → "A и B, плюс C" |

### Защита от чрезмерных правок

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `maxEditRatio` | number (0–1) | `0.35` | Если объём изменений > 35% от длины текста → изменения блокируются (текст остаётся оригинальным). Защита от агрессивных правок |

---

## Список stock phrases (removeStockPhrases)

| ID | Паттерн | Замена |
|---|---|---|
| `stock_end_of_day` | "at the end of the day" | "ultimately" |
| `stock_worth_noting` | "it's worth noting that" | *(удаляется)* |
| `stock_important_to_note` | "it is important to note" | *(удаляется)* |
| `stock_should_be_noted` | "it should be noted" | *(удаляется)* |
| `stock_in_conclusion` | "in conclusion" | "in short," |
| `stock_to_be_honest` | "to be honest" | *(удаляется)* |
| `stock_transparent` | "to be completely transparent" | *(удаляется)* |
| `stock_delve` | "delve into" | "look into" |
| `stock_leverage` | "leverage" | "use" |
| `stock_tapestry` | "tapestry" / "rich tapestry" | "mix" |

## Список hedging rules (reduceHedging)

| ID | Паттерн | Замена |
|---|---|---|
| `hedge_may_potentially` | "may potentially" | "may" |
| `hedge_might_potentially` | "might potentially" | "might" |
| `hedge_often_can` | "often can" | "can" |
| `hedge_can_often` | "can often" | "can" |
| `hedge_it_appears` | "it appears that" | "it seems" |
| `hedge_somewhat` | "somewhat " | *(удаляется)* |

---

## Как синхронизировать изменения

После редактирования конфига или кода — скопировать изменённые файлы:

```bash
# Обновить установленный плагин из рабочей директории
cp /Users/dmitriy/openclaw/tools/humanizer/core.js ~/.openclaw/extensions/humanizer/
cp /Users/dmitriy/openclaw/tools/humanizer/humanizer.config.json ~/.openclaw/extensions/humanizer/

# Обновить конфиг openclaw.json (если меняешь параметры через humanizer.config.json)
# openclaw plugin config set humanizer <параметр> <значение>
```

> **Или** можно заменить `~/.openclaw/extensions/humanizer` симлинком на эту папку:
> ```bash
> rm -rf ~/.openclaw/extensions/humanizer
> ln -s /Users/dmitriy/openclaw/tools/humanizer ~/.openclaw/extensions/humanizer
> ```
