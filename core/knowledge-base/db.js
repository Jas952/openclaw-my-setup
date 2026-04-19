"use strict";

const fs   = require("fs");
const path = require("path");
const os   = require("os");
const Database = require("better-sqlite3");

const {
  ZVecCollectionSchema,
  ZVecCreateAndOpen,
  ZVecOpen,
  ZVecDataType,
  ZVecIndexType,
  ZVecMetricType,
  ZVecInitialize,
} = require("@zvec/zvec");

function loadConfig() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "kb.config.json"), "utf8"));
}

function expandHome(p) {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

let _db              = null;
let _collection      = null;
let _dataDir         = null;

const ZVEC_LOCK_STALE_MS = 5 * 60 * 1000;
const LEGACY_DATA_DIR = path.join(os.homedir(), "clawd/core/knowledge-base/data");

function dirHasKbData(dir) {
  if (!dir || !fs.existsSync(dir)) return false;
  return (
    fs.existsSync(path.join(dir, "knowledge.db")) ||
    fs.existsSync(path.join(dir, "zvec"))
  );
}

function resolveDataDir(cfg) {
  if (_dataDir) return _dataDir;

  const preferredDir = expandHome(cfg.dataDir);
  const preferredHasData = dirHasKbData(preferredDir);
  const legacyHasData = preferredDir !== LEGACY_DATA_DIR && dirHasKbData(LEGACY_DATA_DIR);

  if (!preferredHasData && legacyHasData) {
    fs.mkdirSync(path.dirname(preferredDir), { recursive: true });
    fs.cpSync(LEGACY_DATA_DIR, preferredDir, { recursive: true, force: true });
  }

  fs.mkdirSync(preferredDir, { recursive: true });
  _dataDir = preferredDir;
  return _dataDir;
}

function openWithStaleLockRecovery(zvecPath, openFn) {
  try {
    return openFn();
  } catch (err) {
    const msg = String((err && err.message) || err || "");
    const lockPath = path.join(zvecPath, "LOCK");

    if (!msg.includes("Can't open lock file") || !fs.existsSync(lockPath)) {
      throw err;
    }

    const ageMs = Date.now() - fs.statSync(lockPath).mtimeMs;
    if (ageMs < ZVEC_LOCK_STALE_MS) throw err;

    fs.unlinkSync(lockPath);
    return openFn();
  }
}

function getSqliteDb() {
  if (_db) return _db;

  const cfg     = loadConfig();
  const dataDir = resolveDataDir(cfg);
  fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = path.join(dataDir, "knowledge.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS entries (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      source      TEXT NOT NULL,
      type        TEXT NOT NULL DEFAULT 'url',
      tags        TEXT NOT NULL DEFAULT '[]',
      chunk_count INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id          TEXT PRIMARY KEY,
      entry_id    TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      text        TEXT NOT NULL,
      FOREIGN KEY (entry_id) REFERENCES entries(id)
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_entry_id ON chunks(entry_id);
  `);

  _db = db;
  return db;
}

function getZvecCollection() {
  if (_collection) return _collection;

  const cfg      = loadConfig();
  const dataDir  = resolveDataDir(cfg);
  const zvecPath = path.join(dataDir, "zvec");

  ZVecInitialize({ logLevel: 3 }); // WARN only

  if (fs.existsSync(zvecPath)) {
    _collection = openWithStaleLockRecovery(zvecPath, () => ZVecOpen(zvecPath));
  } else {
    const schema = new ZVecCollectionSchema({
      name: "knowledge",
      vectors: [{
        name:       "embedding",
        dataType:   ZVecDataType.VECTOR_FP32,
        dimension:  cfg.embeddingDim,
        indexParams: {
          indexType:  ZVecIndexType.FLAT,
          metricType: ZVecMetricType.COSINE,
        },
      }],
      fields: [
        { name: "entry_id",   dataType: ZVecDataType.STRING },
        { name: "title",      dataType: ZVecDataType.STRING },
        { name: "source",     dataType: ZVecDataType.STRING },
        { name: "chunk_text", dataType: ZVecDataType.STRING },
        { name: "tags",       dataType: ZVecDataType.STRING },
      ],
    });
    _collection = ZVecCreateAndOpen(zvecPath, schema);
  }

  return _collection;
}

// Open zvec read-only, run fn(col), then close immediately.
// This ensures the lock is never held between requests, so ingest (RW) can
// always acquire the lock without conflict.
async function withZvecReadOnly(fn) {
  const cfg      = loadConfig();
  const dataDir  = resolveDataDir(cfg);
  const zvecPath = path.join(dataDir, "zvec");

  ZVecInitialize({ logLevel: 3 });

  if (!fs.existsSync(zvecPath)) return null; // collection not created yet

  const col = openWithStaleLockRecovery(zvecPath, () => ZVecOpen(zvecPath, { readOnly: true }));
  try {
    return await fn(col);
  } finally {
    col.closeSync();
  }
}

module.exports = { getSqliteDb, getZvecCollection, withZvecReadOnly, loadConfig, expandHome, resolveDataDir };
