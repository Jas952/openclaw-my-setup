# Model Usage Tracker

`core/model-usage-tracker/` handles local accounting for how models are used inside the workspace: which providers and agents are active, how many calls were made, how much input/output volume was consumed, and how that changed over time.

When the bot operates across multiple channels and agents, this layer becomes important because otherwise it is easy to lose track of:

- which model is actually used most often;
- where most tokens are spent;
- which agent creates the main workload;
- how usage changes by day and by hour.

## What's Inside

```text
core/model-usage-tracker/
├── parser.js          — parse runtime usage data
├── aggregator.js      — aggregate statistics
├── reporter.js        — build final reports
├── local-reporter.js  — local report rendering/output
├── chart-generator.js — generate charts
├── run.js             — pipeline entry point
├── tracker.config.json— source and logic configuration
└── costs.json         — cost/estimate table per model
```

## Example Output

The tracker can produce:

- daily call summaries;
- agent-level breakdowns;
- model-level breakdowns;
- token usage estimates and approximate cost.

This is useful both as monitoring and as a way to optimize the bot configuration.

Below is an example of how that output can look in practice:

![Model Usage Tracker Example](../../assets-github/tokens.png)
