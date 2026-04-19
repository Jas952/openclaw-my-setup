"use strict";

module.exports = {
  id: "platform-health",
  title: "Platform Health Council",
  cadence: "nightly",
  zones: [
    "cron_health",
    "code_quality",
    "test_coverage",
    "prompt_quality",
    "dependencies",
    "storage",
    "skill_integrity",
    "config_consistency",
    "data_integrity"
  ],
  checks: [
    "platform-health",
    "code-read-ai"
  ]
};
