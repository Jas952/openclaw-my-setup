# Core

`core/` is the internal service layer. It contains the modules that make the bot useful in real work: memory, backups, usage reports, logging, and response post-processing.

## What It Provides

It is responsible for:

- storing and searching knowledge;
- backing up local data;
- tracking model usage;
- logging background jobs;
- rule-based text post-processing;
- separate UI and office-style experiments.

## Structure

```text
core/
├── backup/              — encrypted backups for local databases and data
├── cron-log/            — cron task logging and audit
├── humanizer/           — rule-based humanization of outgoing responses
├── knowledge-base/      — local RAG knowledge base with vector search
├── model-usage-tracker/ — usage/cost/volume tracking across models and agents
└── office-ui/           — a separate office/presence UI project
```

## How It Works

- `backup/` takes local databases, encrypts archives, and uploads them to storage.
- `cron-log/` records starts, completions, and failures of scheduled jobs.
- `humanizer/` removes stock AI writing patterns from outgoing text without using an LLM.
- `knowledge-base/` stores articles, links, and documents in a local chunk and embedding database. It lets you return to any saved article and quickly recover the needed context.
- `model-usage-tracker/` measures usage by model and agent and builds summaries. It shows which models were actually used and at what scale.
- `office-ui/` provides a separate visual layer for presence and agent status.
