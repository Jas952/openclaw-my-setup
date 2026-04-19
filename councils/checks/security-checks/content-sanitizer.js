"use strict";

const { redactSecrets } = require("./secret-redaction");

const INJECTION_PATTERNS = [
  { id: "ignore_instructions", severity: "high", regex: /\bignore (all|any|previous|prior) instructions?\b/i },
  { id: "reveal_system_prompt", severity: "high", regex: /\b(reveal|show|print|dump)\b.{0,40}\b(system|developer)\s+prompt\b/i },
  { id: "role_escalation", severity: "high", regex: /\b(you are now|act as)\b.{0,50}\b(system|developer|root|admin)\b/i },
  { id: "tool_exfiltration", severity: "high", regex: /\b(exfiltrate|leak|steal|export)\b.{0,60}\b(secret|token|credential|apikey|api key)\b/i },
  { id: "html_script_tag", severity: "medium", regex: /<script[\s\S]*?>[\s\S]*?<\/script>/gi },
  { id: "javascript_uri", severity: "medium", regex: /\bjavascript:/gi },
  { id: "event_handler_attr", severity: "medium", regex: /\son[a-z]+\s*=\s*["'][^"']*["']/gi }
];

function sanitizeUntrustedContent(input, options = {}) {
  const allowHtml = options.allowHtml === true;
  const blockOnHighSeverity = options.blockOnHighSeverity !== false;
  const source = options.source || "unknown";

  let text = input === null || input === undefined ? "" : String(input);
  const matches = detectPatterns(text);
  const highSeverityHits = matches.filter((item) => item.severity === "high");

  if (!allowHtml) {
    text = text
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
      .replace(/\son[a-z]+\s*=\s*["'][^"']*["']/gi, "")
      .replace(/\bjavascript:/gi, "");
  }

  const secretResult = redactSecrets(text, {
    replacement: "[REDACTED]",
    includeTypeInReplacement: false
  });

  const blocked = blockOnHighSeverity && highSeverityHits.length > 0;
  const sanitized = blocked
    ? `[BLOCKED_UNTRUSTED_CONTENT source=${source} reason=${highSeverityHits.map((item) => item.id).join(",")}]`
    : secretResult.redactedText;

  return {
    blocked,
    sanitized,
    reasons: matches.map((item) => item.id),
    findings: matches,
    redactions: secretResult.redactions
  };
}

function assertSafeUntrustedContent(input, options = {}) {
  const result = sanitizeUntrustedContent(input, options);
  if (result.blocked) {
    const error = new Error(`Blocked untrusted content: ${result.reasons.join(", ") || "unknown"}`);
    error.code = "UNTRUSTED_CONTENT_BLOCKED";
    error.details = result;
    throw error;
  }
  return result.sanitized;
}

function detectPatterns(text) {
  const findings = [];
  for (const pattern of INJECTION_PATTERNS) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match;
    while ((match = regex.exec(text)) !== null) {
      findings.push({
        id: pattern.id,
        severity: pattern.severity,
        sample: truncate(match[0], 120)
      });
      if (!regex.global) break;
    }
  }
  return findings;
}

function truncate(text, maxLength) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

module.exports = {
  INJECTION_PATTERNS,
  sanitizeUntrustedContent,
  assertSafeUntrustedContent
};

