# OpenClaw Workspace

This repository shows my practical workspace around OpenClaw: how I used the agent system in real work, how Telegram delivery was organized, what the UI layer looked like, and which application modules I built on top of the base infrastructure.

This repo captures my user-facing and engineering layer: environment organization, interface work, internal services, research workflows, automation, and documentation describing how the system was actually used.

Important: the project's infrastructure foundation relied on the OpenClaw architecture, while the rest of this workspace, the UI shell, application scenarios, and a significant part of the documentation and automation logic were assembled by me directly together with language models. Roughly 70% of the code was written by a language model that I orchestrated.

## What This Repository Is

What this working environment includes:

- Telegram as the main interaction channel;
- a local UI shell for working with the bot;
- a local knowledge base for collecting and reusing materials;
- service modules for usage tracking, backup, cron logging, and internal checks;
- remote browser work with full control over tabs and the active page;
- a set of tools and scenarios that extend the base OpenClaw capabilities.

## Telegram Workflow

Telegram was one of the main ways I worked with the bot. The primary live interaction loop happened in direct messages under the `Jas` name: tasking, quick conversations, manual commands, and everyday agent work all happened there.

Alongside that, I used dedicated topic branches for development, summaries, knowledge-base flows, usage statistics, trading scenarios, and research tasks.


<img src="./assets-github/telegram-titlebar.svg" alt="Telegram Workflow title bar" />

```text
Telegram
├── Jas (direct messages)
│   └── the main interaction loop with the bot: conversations, commands, manual tasks, and quick checks
├── llm.hub
│   ├── chunks          — adding and controlling materials in the knowledge base
│   ├── dev             — dev messages, critical alerts, and technical events
│   ├── *-openai        — dedicated working branch for OpenAI scenarios
│   ├── token-balance   — token, usage, and model statistics summaries
│   ├── *-anthropic     — dedicated working branch for Anthropic scenarios
│   ├── ai-summary      — short AI summaries and overview messages (custom Go implementation)
│   └── General         — shared operational layer and baseline communication
└── llm.trading (custom Go implementation)
    ├── macro              — macro calendar and upcoming economic releases
    ├── agent-trading      — market analysis and trading interpretation
    ├── token-optimization — optimization scenarios
    ├── updates            — operational updates and structure changes
    ├── 6551               — news/data feed and signal-style updates
    ├── etc                — additional materials and supporting posts
    ├── links              — quick links and connecting items
    ├── x-search           — search workflows over X/Twitter
    └── General            — shared channel/topic for the baseline structure
```

Example Telegram channel structure:

- [Telegram channel structure](assets-github/tg.png)

## UI Layer

The internal UI architecture, directory structure, and technical details are documented separately in [UI/README.md](UI/README.md).

![OpenClaw UI Main](assets-github/ui/main.jpg)

- [UI main view](assets-github/ui/ui_main.jpg)
- [UI secondary view](assets-github/ui/ui_main2.jpg)
- [UI logs panel](assets-github/ui/logs.jpg)
- [UI Library / knowledge-base tab](assets-github/ui/knowledge-base.jpg)

## Access And Permissions

This workspace made it possible to control what the bot could access on the device. In practice, that meant enabling or disabling specific tool groups through `tools.allow` / `tools.deny`, while the UI also exposed system permissions such as microphone access and `media/audio capture`.


## What Lives In This Repository

- `UI/` contains the local visual shell, desktop layer, and main user interface for working with the agent. Details: [UI/README.md](UI/README.md)
- `core/` groups the internal application modules of the workspace: knowledge base, backup, usage tracking, cron logging, and other service components. Details: [core/README.md](core/README.md)
- `councils/` handles checks, quality-control flows, security-review scenarios, and internal system-state validation. Details: [councils/README.md](councils/README.md)
- `tools/` stores helper tools and separate automation scenarios around the main workspace. Details: [tools/README.md](tools/README.md)
- `infrastructure/` is kept as a pointer to the external infrastructure layer used as the project's base, but it is not fully published here. Details: [infrastructure/README.md](infrastructure/README.md)
- `skills/` stores local skill extensions and instructions for specialized workflows.
- `workspaces/` contains agent workspaces, personal and thematic configurations, and real usage setups.
- `extracted/` serves as a support zone for extracted materials and external local artifacts.
- `logs/` stores local runtime logs and execution traces.

Details for individual subsystems are split into dedicated README files so the project overview does not get mixed with lower-level technical documentation:

- [UI/README.md](UI/README.md)
- [core/README.md](core/README.md)
- [councils/README.md](councils/README.md)
- [tools/README.md](tools/README.md)
- [tts-jarvis/README.md](tts-jarvis/README.md)
- [infrastructure/README.md](infrastructure/README.md)

## Summary

This repository shows not only code, but also a concrete way of organizing a personal agent environment around OpenClaw: how the interface was designed, how the bot was used in Telegram, and how real operational workflows were built around the agent.

Important: this repository does not include a significant part of the larger internal codebase and related work. If you want a fuller walkthrough or a demo of the closed parts, please contact me directly:

<p>
  <img src="./assets-github/n1.gif" alt="Project Demo" width="92" height="92" align="left"/>
</p>
<pre hspace="12">
  <img src="./assets-github/contacts/tg.jpg" alt="Telegram" height="14" /> Telegram ······ <a href="https://t.me/Jas953/">t.me/Jas953</a>
  <img src="./assets-github/contacts/lnk.jpg" alt="LinkedIn" height="14" /> LinkedIn ······ <a href="https://www.linkedin.com/in/jas952/">linkedin.com/in/jas952</a>
  <img src="./assets-github/contacts/x.jpg" alt="X" height="14" /> X        ······ <a href="https://x.com/not__jas">x.com/not__jas</a>
</pre>
<br clear="left" />
