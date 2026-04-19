"use strict";

const SECRET_PATTERNS = [
  { type: "skillsmp_api_key", regex: /\bsk_(?:live|test)_[A-Za-z0-9]{20,}\b/g },
  { type: "openai_api_key", regex: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { type: "anthropic_api_key", regex: /\bsk-ant-[A-Za-z0-9\-]{20,}\b/g },
  { type: "github_token", regex: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { type: "slack_token", regex: /\bxox(?:a|b|p|o|s|r)-[A-Za-z0-9\-]{10,}\b/g },
  { type: "aws_access_key", regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { type: "bearer_token", regex: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi },
  { type: "private_key_block", regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g }
];

function redactSecrets(input, options = {}) {
  const replacement = options.replacement || "[REDACTED]";
  const includeTypeInReplacement = options.includeTypeInReplacement !== false;
  const patterns = options.patterns || SECRET_PATTERNS;

  if (input === null || input === undefined) {
    return { redactedText: "", redactions: [] };
  }

  let redactedText = String(input);
  const redactions = [];

  for (const pattern of patterns) {
    redactedText = redactedText.replace(pattern.regex, (match) => {
      redactions.push({ type: pattern.type, preview: previewMatch(match) });
      if (includeTypeInReplacement) {
        return `${replacement}:${pattern.type}`;
      }
      return replacement;
    });
  }

  return { redactedText, redactions };
}

function previewMatch(value) {
  if (!value || value.length < 9) return "***";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

module.exports = {
  SECRET_PATTERNS,
  redactSecrets
};

