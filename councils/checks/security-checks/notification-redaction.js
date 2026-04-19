"use strict";

const { redactSecrets } = require("./secret-redaction");

function redactNotificationMessage(input, options = {}) {
  const maxLength = options.maxLength || 3500;
  const preserveNewlines = options.preserveNewlines !== false;

  const normalized = normalizeInput(input, preserveNewlines);
  const { redactedText, redactions } = redactSecrets(normalized, {
    replacement: "[REDACTED]",
    includeTypeInReplacement: false
  });

  return {
    text: truncate(redactedText, maxLength),
    redactions
  };
}

function normalizeInput(input, preserveNewlines) {
  if (input === null || input === undefined) return "";
  const text = String(input);
  if (preserveNewlines) return text;
  return text.replace(/\s+/g, " ").trim();
}

function truncate(text, maxLength) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 16))}\n[TRUNCATED]`;
}

module.exports = {
  redactNotificationMessage
};

