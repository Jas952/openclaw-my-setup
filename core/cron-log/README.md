# Cron Log

`core/cron-log/` handles local cron task logging and helps answer what ran, when it finished, and where a failure occurred.

## Why This Matters In OpenClaw

In OpenClaw and related automation workflows, scheduled jobs quickly become an important part of the infrastructure: publishing, updates, checks, and data synchronization. This module exists to make those processes observable.

## What's Inside

```text
core/cron-log/
├── log-start.js                 — records job start
├── log-end.js                   — records job completion
├── cleanup-stale.js             — removes stale entries
├── check-persistent-failures.js — finds repeated failures
├── query.js                     — log querying and inspection
├── db.js                        — local log database access
└── cron-log.config.json         — module configuration
```
