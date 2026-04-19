"use strict";

module.exports = {
  id: "security",
  title: "Security Council",
  cadence: "nightly",
  checks: [
    "security-review",
    "code-read-ai"
  ],
  perspectives: ["offensive", "defensive", "data_privacy", "operational_realism"],
  criticalImmediateAlert: true
};
