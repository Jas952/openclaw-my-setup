"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");
const { google } = require("googleapis");

// ── Config & env ──────────────────────────────────────────────────────────────

const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, "backup.config.json"), "utf8"));
loadEnv(path.join(__dirname, ".env"));

const BACKUP_PASSWORD    = required("BACKUP_PASSWORD");
const GDRIVE_CLIENT_ID   = required("GDRIVE_CLIENT_ID");
const GDRIVE_CLIENT_SECRET = required("GDRIVE_CLIENT_SECRET");
const GDRIVE_REFRESH_TOKEN = required("GDRIVE_REFRESH_TOKEN");

function required(key) {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var: ${key}. See .env.example`);
  return v;
}

function loadEnv(envPath) {
  try {
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
  } catch { /* .env is optional if vars set in environment */ }
}

// ── Telegram alert ────────────────────────────────────────────────────────────

function getBotToken() {
  if (process.env.TELEGRAM_BOT_TOKEN) return process.env.TELEGRAM_BOT_TOKEN;
  try {
    const clawdbot = JSON.parse(
      fs.readFileSync(path.join(os.homedir(), ".openclaw/clawdbot.json"), "utf8")
    );
    return clawdbot?.channels?.telegram?.botToken;
  } catch { return null; }
}

async function sendTelegramAlert(message) {
  const token = getBotToken();
  const chatId = CFG.telegramChatId || process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.error("Telegram not configured, skipping alert");
    return;
  }
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "HTML" })
    });
  } catch (e) {
    console.error("Telegram alert failed:", e.message);
  }
}

// ── DB auto-discovery ─────────────────────────────────────────────────────────

function expandHome(p) {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

function isExcluded(filePath) {
  return CFG.excludePatterns.some(pat => filePath.includes(pat));
}

function findDatabases() {
  const results = [];
  const extensions = [".db", ".sqlite", ".sqlite3"];

  for (const rawPath of CFG.scanPaths) {
    const scanDir = expandHome(rawPath);
    if (!fs.existsSync(scanDir)) continue;

    try {
      const output = execSync(
        `find "${scanDir}" -type f \\( ${extensions.map(e => `-name "*${e}"`).join(" -o ")} \\) 2>/dev/null`,
        { encoding: "utf8", timeout: 30000 }
      );
      for (const line of output.trim().split("\n")) {
        const f = line.trim();
        if (f && !isExcluded(f)) results.push(f);
      }
    } catch { /* directory may be inaccessible */ }
  }

  return [...new Set(results)];
}

// ── Encryption ────────────────────────────────────────────────────────────────

function encryptFile(inputPath, outputPath) {
  execSync(
    `openssl enc -aes-256-cbc -pbkdf2 -iter 100000 ` +
    `-in "${inputPath}" -out "${outputPath}" ` +
    `-pass pass:${BACKUP_PASSWORD}`,
    { stdio: "pipe" }
  );
}

// ── Google Drive ──────────────────────────────────────────────────────────────

function buildDriveClient() {
  const auth = new google.auth.OAuth2(GDRIVE_CLIENT_ID, GDRIVE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: GDRIVE_REFRESH_TOKEN });
  return google.drive({ version: "v3", auth });
}

async function getOrCreateFolder(drive, folderName) {
  const res = await drive.files.list({
    q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id,name)",
    spaces: "drive"
  });

  if (res.data.files.length > 0) return res.data.files[0].id;

  const created = await drive.files.create({
    requestBody: { name: folderName, mimeType: "application/vnd.google-apps.folder" },
    fields: "id"
  });
  return created.data.id;
}

async function uploadFile(drive, localPath, fileName, folderId) {
  const res = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: {
      mimeType: "application/octet-stream",
      body: fs.createReadStream(localPath)
    },
    fields: "id,name,size,createdTime"
  });
  return res.data;
}

async function listBackups(drive, folderId) {
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false and name contains 'backup-'`,
    fields: "files(id,name,size,createdTime)",
    orderBy: "createdTime asc",
    spaces: "drive"
  });
  return res.data.files;
}

async function deleteFile(drive, fileId) {
  await drive.files.delete({ fileId });
}

async function uploadIndex(drive, folderId, indexData) {
  // Remove existing index.json
  const existing = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false and name='index.json'`,
    fields: "files(id)"
  });
  for (const f of existing.data.files) {
    await drive.files.delete({ fileId: f.id });
  }

  const { Readable } = require("stream");
  const content = JSON.stringify(indexData, null, 2);
  await drive.files.create({
    requestBody: { name: "index.json", parents: [folderId] },
    media: {
      mimeType: "application/json",
      body: Readable.from([content])
    }
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + "Z";
  const tempDir = path.join(CFG.tempDir, timestamp);
  const archiveName = `backup-${timestamp}.tar.gz`;
  const encryptedName = `${archiveName}.enc`;
  const archivePath = path.join(tempDir, archiveName);
  const encryptedPath = path.join(tempDir, encryptedName);

  console.log(`[backup] Starting backup ${timestamp}`);

  try {
    // 1. Discover databases
    const databases = findDatabases();
    if (databases.length === 0) {
      console.log("[backup] No databases found, skipping");
      return;
    }
    console.log(`[backup] Found ${databases.length} database(s):`);
    databases.forEach(d => console.log(`  ${d}`));

    // 2. Create temp dir
    fs.mkdirSync(tempDir, { recursive: true });

    // 3. Write manifest
    const manifest = {
      timestamp,
      databases,
      host: os.hostname(),
      createdAt: new Date().toISOString()
    };
    fs.writeFileSync(
      path.join(tempDir, "manifest.json"),
      JSON.stringify(manifest, null, 2)
    );

    // 4. Create tar archive (manifest + all DBs)
    const fileList = [path.join(tempDir, "manifest.json"), ...databases]
      .map(f => `"${f}"`)
      .join(" ");
    // -P = preserve absolute paths (BSD tar / macOS equivalent of GNU --absolute-names)
    execSync(`tar czf "${archivePath}" -P ${fileList}`, { stdio: "pipe" });
    console.log(`[backup] Archive created: ${(fs.statSync(archivePath).size / 1024).toFixed(1)} KB`);

    // 5. Encrypt
    encryptFile(archivePath, encryptedPath);
    console.log(`[backup] Encrypted: ${encryptedName}`);

    // 6. Upload to Google Drive
    const drive = buildDriveClient();
    const folderId = await getOrCreateFolder(drive, CFG.gDriveFolderName);
    const uploaded = await uploadFile(drive, encryptedPath, encryptedName, folderId);
    console.log(`[backup] Uploaded to Drive: ${uploaded.id}`);

    // 7. Rotate old backups (keep last N)
    const backups = await listBackups(drive, folderId);
    if (backups.length > CFG.retentionCount) {
      const toDelete = backups.slice(0, backups.length - CFG.retentionCount);
      for (const old of toDelete) {
        await deleteFile(drive, old.id);
        console.log(`[backup] Deleted old backup: ${old.name}`);
      }
    }

    // 8. Update index.json on Drive
    const remaining = await listBackups(drive, folderId);
    await uploadIndex(drive, folderId, {
      updatedAt: new Date().toISOString(),
      retentionCount: CFG.retentionCount,
      backups: remaining.map(f => ({
        id: f.id,
        name: f.name,
        size: f.size,
        createdTime: f.createdTime
      }))
    });

    console.log(`[backup] Done. ${remaining.length} backup(s) on Drive.`);

  } catch (err) {
    const msg = `🔴 <b>OpenClaw Backup FAILED</b>\n\n<code>${err.message}</code>\n\nTimestamp: ${timestamp}`;
    console.error("[backup] ERROR:", err.message);
    await sendTelegramAlert(msg);
    process.exit(1);

  } finally {
    // Cleanup temp
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
}

main().catch(async (err) => {
  console.error(err);
  await sendTelegramAlert(`🔴 <b>OpenClaw Backup CRASHED</b>\n\n<code>${err.message}</code>`);
  process.exit(1);
});
