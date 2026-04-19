"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");
const { google } = require("googleapis");
const readline = require("readline");

// ── Config & env ──────────────────────────────────────────────────────────────

const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, "backup.config.json"), "utf8"));
loadEnv(path.join(__dirname, ".env"));

const BACKUP_PASSWORD      = required("BACKUP_PASSWORD");
const GDRIVE_CLIENT_ID     = required("GDRIVE_CLIENT_ID");
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
  } catch { }
}

// ── Google Drive ──────────────────────────────────────────────────────────────

function buildDriveClient() {
  const auth = new google.auth.OAuth2(GDRIVE_CLIENT_ID, GDRIVE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: GDRIVE_REFRESH_TOKEN });
  return google.drive({ version: "v3", auth });
}

async function getFolder(drive, folderName) {
  const res = await drive.files.list({
    q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id,name)"
  });
  if (!res.data.files.length) throw new Error(`Folder "${folderName}" not found on Drive`);
  return res.data.files[0].id;
}

async function downloadFile(drive, fileId, destPath) {
  const dest = fs.createWriteStream(destPath);
  const res = await drive.files.get({ fileId, alt: "media" }, { responseType: "stream" });
  await new Promise((resolve, reject) => {
    res.data.on("end", resolve).on("error", reject).pipe(dest);
  });
}

async function readIndex(drive, folderId) {
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false and name='index.json'`,
    fields: "files(id,name)"
  });
  if (!res.data.files.length) throw new Error("index.json not found on Drive");
  const tmp = path.join(os.tmpdir(), "openclaw-index.json");
  await downloadFile(drive, res.data.files[0].id, tmp);
  const data = JSON.parse(fs.readFileSync(tmp, "utf8"));
  fs.unlinkSync(tmp);
  return data;
}

// ── Restore ───────────────────────────────────────────────────────────────────

function decryptFile(inputPath, outputPath) {
  execSync(
    `openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 ` +
    `-in "${inputPath}" -out "${outputPath}" ` +
    `-pass pass:${BACKUP_PASSWORD}`,
    { stdio: "pipe" }
  );
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

async function main() {
  const args = process.argv.slice(2);
  const listOnly = args.includes("--list");
  const force = args.includes("--force");
  const restoreDir = args.find(a => a.startsWith("--to="))?.slice(5) || os.tmpdir();

  console.log("[restore] Connecting to Google Drive...");
  const drive = buildDriveClient();
  const folderId = await getFolder(drive, CFG.gDriveFolderName);
  const index = await readIndex(drive, folderId);

  console.log(`\nAvailable backups (${index.backups.length}):`);
  index.backups.forEach((b, i) => {
    const size = b.size ? `${(Number(b.size) / 1024).toFixed(1)} KB` : "?";
    console.log(`  ${i + 1}. ${b.name}  [${size}]  ${b.createdTime}`);
  });

  if (listOnly) return;

  if (!index.backups.length) {
    console.log("No backups available.");
    return;
  }

  // Select backup
  let selected;
  const targetArg = args.find(a => a.startsWith("--backup="))?.slice(9);
  if (targetArg) {
    selected = index.backups.find(b => b.name.includes(targetArg));
    if (!selected) throw new Error(`No backup matching: ${targetArg}`);
  } else {
    const answer = await ask(`\nSelect backup number (1-${index.backups.length}, default=latest): `);
    const num = answer ? parseInt(answer, 10) - 1 : index.backups.length - 1;
    if (num < 0 || num >= index.backups.length) throw new Error("Invalid selection");
    selected = index.backups[num];
  }

  console.log(`\n[restore] Selected: ${selected.name}`);

  if (!force) {
    const confirm = await ask(
      `This will restore databases to their original paths. Continue? (yes/no): `
    );
    if (confirm.toLowerCase() !== "yes") {
      console.log("Aborted.");
      return;
    }
  }

  // Download
  const tempDir = path.join(os.tmpdir(), `openclaw-restore-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  const encPath = path.join(tempDir, selected.name);
  const tarPath = path.join(tempDir, selected.name.replace(".enc", ""));
  const extractDir = path.join(tempDir, "extracted");
  fs.mkdirSync(extractDir, { recursive: true });

  try {
    console.log("[restore] Downloading...");
    await downloadFile(drive, selected.id, encPath);

    console.log("[restore] Decrypting...");
    decryptFile(encPath, tarPath);

    console.log("[restore] Extracting...");
    execSync(`tar xzf "${tarPath}" -P -C "${extractDir}"`, { stdio: "pipe" });

    // Read manifest
    const manifestPath = path.join(extractDir, extractDir, "tmp", "openclaw-backup", "*/manifest.json");
    const manifests = execSync(
      `find "${extractDir}" -name "manifest.json" 2>/dev/null`,
      { encoding: "utf8" }
    ).trim().split("\n").filter(Boolean);

    if (!manifests.length) throw new Error("manifest.json not found in archive");

    const manifest = JSON.parse(fs.readFileSync(manifests[0], "utf8"));
    console.log(`\n[restore] Backup from: ${manifest.timestamp}`);
    console.log(`[restore] Databases in archive:`);
    manifest.databases.forEach(d => console.log(`  ${d}`));

    // Restore each DB to original path
    let restored = 0;
    for (const dbOrigPath of manifest.databases) {
      // In tar with --absolute-names, files are stored with full paths
      const inArchive = path.join(extractDir, dbOrigPath);
      if (!fs.existsSync(inArchive)) {
        console.warn(`  [skip] Not found in archive: ${dbOrigPath}`);
        continue;
      }

      // Backup existing file before overwriting
      if (fs.existsSync(dbOrigPath)) {
        fs.copyFileSync(dbOrigPath, `${dbOrigPath}.pre-restore`);
      }

      fs.mkdirSync(path.dirname(dbOrigPath), { recursive: true });
      fs.copyFileSync(inArchive, dbOrigPath);
      console.log(`  [ok] Restored: ${dbOrigPath}`);
      restored++;
    }

    console.log(`\n[restore] Done. ${restored}/${manifest.databases.length} databases restored.`);
    if (restored < manifest.databases.length) {
      console.log("Note: .pre-restore backups created for any overwritten files.");
    }

  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error("[restore] ERROR:", err.message);
  process.exit(1);
});
