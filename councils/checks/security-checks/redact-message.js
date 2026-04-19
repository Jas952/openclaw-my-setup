#!/usr/bin/env node
"use strict";

const { redactNotificationMessage } = require("./notification-redaction");

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

async function main() {
  const args = process.argv.slice(2);
  let input = "";

  if (args.length > 0) {
    input = args.join(" ");
  } else if (!process.stdin.isTTY) {
    input = await readStdin();
  } else {
    console.error("Usage: echo \"...\" | node councils/checks/security-checks/redact-message.js");
    console.error("   or: node councils/checks/security-checks/redact-message.js \"message text\"");
    process.exitCode = 1;
    return;
  }

  const { text } = redactNotificationMessage(input, {
    preserveNewlines: true
  });

  process.stdout.write(text);
  if (!text.endsWith("\n")) process.stdout.write("\n");
}

main().catch((err) => {
  console.error(`[redact-message] ERROR: ${err.message}`);
  process.exitCode = 1;
});
