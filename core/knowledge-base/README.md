# Knowledge Base

`core/knowledge-base/` — это локальная база знаний для бота. Она работает как долговременная исследовательская память: сохраняет материалы, разбивает их на части, индексирует и потом помогает быстро находить нужный контекст.

## Что она делает

Модуль позволяет:

- сохранять статьи, ссылки, PDF и текстовые материалы;
- резать их на chunks;
- строить для них embeddings;
- потом находить релевантные фрагменты по обычному запросу на естественном языке.

## Как я использую это на практике

- в Telegram отправляю боту ссылку, статью или документ;
- материал автоматически или вручную сохраняется в knowledge base;
- текст режется на чанки и индексируется;
- позже я в любой момент могу спросить бота по этой теме, и он быстро поднимает нужный контекст из локальной памяти.

Эта возможность выведена и в UI через вкладку `Library`, где можно видеть сохранённые материалы и работать с ними как с личной исследовательской библиотекой.

![Knowledge Base Library View](../../assets-github/ui/knowledge-base.jpg)

## Какая модель используется

Здесь используется локальная embedding-модель:

| Параметр | Значение |
|---|---|
| Модель | `Xenova/multilingual-e5-small` |
| Тип | multilingual embedding model |
| Размер вектора | `384` |
| Языки | RU + EN и другие multilingual-сценарии |
| Режим работы | полностью локально, без API-ключей |

## Где хранятся данные

Векторный слой и база устроены так:
- `zvec` используется как локальный vector store;
- SQLite хранит записи, метаданные и чанки;
- векторы и метаданные используются вместе для последующего retrieval.

## Технические параметры

| Параметр | Значение |
|---|---|
| `embeddingDim` | `384` |
| `chunkSize` | `500` |
| `chunkOverlap` | `50` |
| `database path` | `~/.openclaw/knowledge-base/data/knowledge.db` |
| `collection metric` | `cosine similarity` |
| `index type` | `flat` |

## Как это работает

```text
URL / PDF / текст / локальный файл
        │
        ▼
  ingest.js
        │
        ├── извлекает текст
        ├── режет на chunks
        ├── строит embeddings
        ├── сохраняет metadata в SQLite
        └── сохраняет vectors в zvec
                 │
                 ▼
            query.js
                 │
                 ├── строит embedding запроса
                 ├── делает semantic search
                 └── возвращает лучшие chunks
```

## Структура

```text
core/knowledge-base/
├── ingest.js      — добавление URL, PDF, текста и файлов в базу знаний
├── query.js       — semantic query по knowledge base
├── list.js        — список сохраненных материалов
├── delete.js      — удаление записи из базы
├── embed.js       — локальная embedding-логика
├── db.js          — SQLite + zvec слой
├── kb.config.json — параметры модели, chunking и dataDir
└── SKILL.md       — правила использования knowledge-base внутри OpenClaw
```

## Примеры

### После сохранения

```text
✓ Добавлено в базу знаний: Title of Article (12 chunks)
```

### При поиске

```text
1. [84.4% match] Article Title
   Source: https://example.com
   Tags:   finance, notes
   ---
   Excerpt from the matched chunk...
```

### При просмотре библиотеки

```text
Knowledge Base — 18 entries, 146 total chunks
```
