# Tools

`tools/` is a collection of supporting utilities around the OpenClaw workspace. It includes standalone helpers, skill packages, research assistants, and automation modules for specific tasks.

## What It Provides

This is not the upstream OpenClaw core. It is an application-focused toolbox that extends the bot for concrete scenarios:

- scraping and browser verification;
- visualization and diagrams;
- X / YouTube research;
- orchestration and operational automation flows.

## Structure

```text
tools/
├── excalidraw/            — generation and rendering of Excalidraw diagrams
├── memory-check/          — quick checks and memory-oriented scenarios
├── peekaboo/              — system/desktop checks and permission diagnostics
├── scrapling-fetch/       — fetch/scraping pipeline for static and dynamic web content
├── session-logs/          — session log tooling
├── spotify-player/        — dedicated skill/tool for Spotify scenarios
├── symphony/              — orchestration toolkit and workflow structure
├── trading/               — trading block published as a separate repository
├── verify-on-browser/     — browser-based page and interface verification
├── x-research-v2/         — research and data collection for X/Twitter
├── youtube-fetch/         — collection of YouTube materials
└── youtube-sub-ratio/     — analysis of YouTube channels and their metrics
```

## How It Is Used

- some tools are connected as skills inside OpenClaw;
- some run as standalone local utilities;
- some are used for data collection and analysis;
- some bridge the bot, the browser, content, and external sources.

## Example Outcomes

- `scrapling-fetch` can extract and normalize the contents of a web page;
- `verify-on-browser` makes it possible to check how a page actually opens and looks;
- `x-research-v2` and `youtube-*` help collect and analyze data from external platforms;
- `excalidraw` provides a fast way to build diagrams and visual explanations around bot tasks.
