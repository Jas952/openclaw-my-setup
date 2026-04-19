"use strict";

/**
 * One-time Google OAuth2 setup.
 * Run: node auth-setup.js
 * Paste the REFRESH_TOKEN into your .env file.
 */

const readline = require("readline");
const { google } = require("googleapis");

loadEnv(require("path").join(__dirname, ".env"));

function loadEnv(envPath) {
  try {
    const fs = require("fs");
    const content = fs.readFileSync(envPath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx < 0) continue;
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
      if (key && !process.env[key]) process.env[key] = val;
    }
  } catch { }
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

async function main() {
  const clientId = process.env.GDRIVE_CLIENT_ID;
  const clientSecret = process.env.GDRIVE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.log(`
ERROR: GDRIVE_CLIENT_ID and GDRIVE_CLIENT_SECRET must be set in .env

Steps to get them:
1. Go to https://console.cloud.google.com/
2. Create a project (or select existing)
3. Enable "Google Drive API"
4. Go to APIs & Services → Credentials
5. Create OAuth 2.0 Client ID → Desktop app
6. Copy Client ID and Client Secret to your .env file
`);
    process.exit(1);
  }

  const auth = new google.auth.OAuth2(
    clientId,
    clientSecret,
    "urn:ietf:wg:oauth:2.0:oob"  // Out-of-band (copy/paste flow)
  );

  const authUrl = auth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/drive.file"]
  });

  console.log("\n=== Google Drive Authorization ===\n");
  console.log("1. Open this URL in your browser:\n");
  console.log(authUrl);
  console.log("\n2. Sign in and grant access.");
  console.log("3. Copy the authorization code shown.\n");

  const code = await ask("Paste the authorization code here: ");
  if (!code) {
    console.error("No code entered. Aborting.");
    process.exit(1);
  }

  const { tokens } = await auth.getToken(code);
  auth.setCredentials(tokens);

  console.log("\n=== SUCCESS ===\n");
  console.log("Add this to your .env file:\n");
  console.log(`GDRIVE_REFRESH_TOKEN=${tokens.refresh_token}`);
  console.log("\nThen run: node backup.js");
}

main().catch(err => {
  console.error("Auth setup failed:", err.message);
  process.exit(1);
});
