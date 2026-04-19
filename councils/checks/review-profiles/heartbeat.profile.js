"use strict";

module.exports = {
  id: "heartbeat",
  title: "Health Monitoring Heartbeat",
  cadence: "daily",
  policy: "silent_if_healthy",
  checks: [
    "security-review",
    "code-read-ai"
  ],
  periodic: {
    daily: ["repo-size", "cron-health"],
    weekly: ["gateway-localhost-auth"],
    monthly: ["prompt-injection-defense"]
  }
};
