---
name: knowledge-base
description: "RAG knowledge base for semantic search over ingested articles, notes, PDFs and URLs. Use when: user asks to search knowledge base, find information from previously saved content, ingest a URL/article/note, or list/delete KB entries. Supports Russian and English. No API key required — runs fully locally."
homepage: https://github.com/xenova/transformers.js
metadata:
  {
    "openclaw":
      {
        "emoji": "🧠",
        "requires": { "bins": ["node"] },
      },
  }
---

# Knowledge Base (RAG)

Local semantic search over ingested content. Uses `Xenova/multilingual-e5-small` embeddings (384-dim, RU+EN) and `zvec` vector store — fully offline, no API keys needed.

**Database:** `~/.openclaw/knowledge-base/data/knowledge.db`
**Code:** `/Users/dmitriy/openclaw/core/knowledge-base/`

## Auto-Ingest Links (Proactive)

**When someone shares a URL or link to readable content — ingest it automatically, without being asked.**

This applies to: articles, blog posts, docs, research papers, PDFs, news pages.

```bash
node /Users/dmitriy/openclaw/core/knowledge-base/ingest.js "<url>" [--title "..."] [--tags tag1,tag2]
```

After ingestion confirm briefly: `✓ Добавлено в базу знаний: <title> (<N> chunks)`

**Skip auto-ingest for:**
- Social media profiles (twitter.com/user, etc.)
- YouTube links (use youtube-fetch instead)
- Empty/redirect/search result pages
- Links explicitly marked as "не сохранять" / "don't save"

## Save File Signals (IMPORTANT)

When the user explicitly asks to save a file, always ingest the file content:

- Russian triggers: `сохрани файл`, `запомни файл`, `добавь файл в базу`
- English triggers: `save this file`, `remember this file`, `add this file to kb`

If a file path is available, run:

```bash
node /Users/dmitriy/openclaw/core/knowledge-base/ingest.js "<file-path>" [--title "..."] [--tags ...]
```

`ingest.js` supports:
- local text/code/markdown/json files
- local PDF files
- URL and plain text (previous behavior)

## Auto-Recall Behaviour (IMPORTANT)

When the system automatically injects `<knowledge-base-recall>` context before your reply, it means relevant saved articles were found. **Do NOT reproduce or summarize their full content unprompted.**

Instead:
- Answer the user's actual question directly and concisely
- Reference KB content only briefly if directly relevant: *"кстати, мы это разбирали — [тема]"*
- If the user's question IS about the KB content, give a short focused answer — not a full dump
- Only expand on KB content if the user explicitly asks for details

The `<knowledge-base-recall>` block is background context for you, not content to recite.

## When to Use

✅ **USE this skill when:**

- User shares a URL, PDF, or link → **auto-ingest immediately**
- User asks to save/remember a local file path → **ingest immediately**
- "Найди в базе знаний что-нибудь про X"
- "Search the knowledge base for information about Y"
- "не помнишь я сохранял что-то про X?" → run query first, then answer
- "помнишь что-то про X", "что я сохранял о Y" → always query KB
- "Add this article/URL to the knowledge base"
- "Ingest this text/note"
- "Show me what's in the knowledge base"
- "Delete entry X from KB"
- Any question about a topic where previously saved articles might be relevant

## When NOT to Use

❌ **DON'T use this skill when:**

- User asks for real-time info (use web search instead)
- KB is empty and user doesn't intend to ingest content first

## Commands

### Search / Query
```bash
node /Users/dmitriy/openclaw/core/knowledge-base/query.js "your question here"
node /Users/dmitriy/openclaw/core/knowledge-base/query.js "your question" --limit 10
node /Users/dmitriy/openclaw/core/knowledge-base/query.js "your question" --tags tag1,tag2
node /Users/dmitriy/openclaw/core/knowledge-base/query.js "question" --json
```

### Ingest Content
```bash
# From URL (fetches and strips HTML automatically)
node /Users/dmitriy/openclaw/core/knowledge-base/ingest.js "https://example.com/article"

# From URL with tags and title
node /Users/dmitriy/openclaw/core/knowledge-base/ingest.js "https://example.com/doc" --tags finance,report --title "Q4 Report"

# From PDF URL
node /Users/dmitriy/openclaw/core/knowledge-base/ingest.js "https://example.com/file.pdf" --tags docs

# From plain text
node /Users/dmitriy/openclaw/core/knowledge-base/ingest.js "some text content here" --title "My Note" --tags notes

# From local file path
node /Users/dmitriy/openclaw/core/knowledge-base/ingest.js "/path/to/file.md" --tags notes

# Dry run output as JSON
node /Users/dmitriy/openclaw/core/knowledge-base/ingest.js "https://example.com" --json
```

### List Entries
```bash
node /Users/dmitriy/openclaw/core/knowledge-base/list.js
node /Users/dmitriy/openclaw/core/knowledge-base/list.js --tags finance
node /Users/dmitriy/openclaw/core/knowledge-base/list.js --json
```

### Delete Entry
```bash
node /Users/dmitriy/openclaw/core/knowledge-base/delete.js <entry-id>
```

## Output Format

**Query results** show similarity score (%), title, source URL, tags, and a text excerpt (400 chars):
```
1. [84.4% match] Article Title
   Source: https://...
   Tags:   finance, q4
   ---
   Excerpt from the matched chunk...
```

**List** shows all entries with chunk count, type, and creation date.

## Notes

- First run downloads the embedding model (~120 MB) and caches it in `~/.cache/huggingface/`
- Subsequent runs use the cached model — fast startup
- Supports multilingual content: Russian and English in the same KB
- Content is chunked at 500 chars with 50-char overlap for better retrieval
- PDFs require the `pdf-parse` npm package (already installed)
- Tags enable filtered search: `--tags finance` returns only finance-tagged chunks
