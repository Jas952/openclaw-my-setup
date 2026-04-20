# Councils

`councils/` is the automated control layer around my workspace. It helps show what is happening in the system, where risks exist, and which problems need attention.

## What It Does

This folder includes:

- check profiles;
- the review execution engine;
- an evidence layer;
- structured security and platform-health reports.

## Structure

```text
councils/
├── checks/
│   ├── review-profiles/   — review profiles and check types
│   └── security-checks/   — reusable security-check scenarios
├── data/
│   ├── delivery/          — report and notification delivery
│   ├── evidence/          — normalized evidence artifacts
│   ├── reports/           — final reports by profile
│   ├── state/             — runtime state and service markers
│   └── telegram/          — Telegram-oriented delivery state
├── engine/                — orchestration engine for council checks
└── scripts/               — supporting run scripts
```

## How It Works

1. A review profile defines what needs to be analyzed.
2. The engine collects evidence and normalizes the input data.
3. The security or platform-health logic produces findings and recommendations.
4. The result is saved as a machine-readable report.
5. When needed, the report is forwarded to Telegram or another operational layer.

Reports are stored in the following form:

- `councils/data/reports/<profile>/latest.json`
- `councils/data/reports/<profile>/<profile>-<timestamp>.json`

