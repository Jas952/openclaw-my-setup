"use strict";

const path = require("node:path");

const ROOT = "/Users/dmitriy/openclaw";

const profiles = {
  security: require(path.join(ROOT, "councils", "checks", "review-profiles", "security-council.profile.js")),
  "platform-health": require(path.join(ROOT, "councils", "checks", "review-profiles", "platform-health.profile.js")),
  heartbeat: require(path.join(ROOT, "councils", "checks", "review-profiles", "heartbeat.profile.js"))
};

const checks = {
  "security-review": path.join(ROOT, "councils", "checks", "security-checks", "security-review.sh"),
  "security-review-all": path.join(ROOT, "councils", "checks", "security-checks", "security-review-all.sh"),
  "code-read-ai": path.join(ROOT, "councils", "checks", "security-checks", "code-read-ai.js"),
  "platform-health": path.join(ROOT, "councils", "checks", "security-checks", "platform-health-checks.js")
};

function getProfile(id) {
  return profiles[id] || null;
}

function getCheckPath(id) {
  return checks[id] || null;
}

module.exports = {
  ROOT,
  profiles,
  checks,
  getProfile,
  getCheckPath
};
