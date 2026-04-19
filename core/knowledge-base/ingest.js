#!/usr/bin/env node
"use strict";

/**
 * Ingest content into the knowledge base.
 *
 * node ingest.js <url-or-text> [--title "My Title"] [--tags tag1,tag2]
 * node ingest.js "https://example.com/article"
 * node ingest.js "https://example.com/doc.pdf" --tags finance,report
 * node ingest.js "/absolute/or/relative/path/to/file.md" --tags note
 * node ingest.js "some plain text content" --title "My Note"
 *
 * Output (--json): { id, title, chunks, tags, type }
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { getSqliteDb, getZvecCollection, loadConfig } = require("./db");
const { embedPassage } = require("./embed");

const BINARY_EXTENSIONS = new Set([
  ".zip", ".gz", ".tar", ".7z", ".rar",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".svg",
  ".mp3", ".wav", ".ogg", ".flac", ".mp4", ".mov", ".avi", ".mkv",
  ".exe", ".bin", ".dmg", ".iso", ".class",
  ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx",
]);
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

function parseArgs(argv) {
  const args = { source: null, tags: [], title: null, json: false };
  for (let i = 2; i < argv.length; i++) {
    if      (argv[i] === "--tags"  && argv[i + 1]) { args.tags  = argv[++i].split(",").map(s => s.trim()); }
    else if (argv[i] === "--title" && argv[i + 1]) { args.title = argv[++i]; }
    else if (argv[i] === "--json")                 { args.json  = true; }
    else if (!argv[i].startsWith("--"))            { args.source = argv[i]; }
  }
  return args;
}

function stripHtml(html) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function chunkText(text, size, overlap) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, Math.min(i + size, text.length)));
    if (i + size >= text.length) break;
    i += size - overlap;
  }
  return chunks;
}

async function fetchContent(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; OpenClaw-KB/1.0)" },
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);

  const contentType = res.headers.get("content-type") || "";

  if (contentType.includes("pdf") || url.toLowerCase().endsWith(".pdf")) {
    const buf     = Buffer.from(await res.arrayBuffer());
    const pdfParse = require("pdf-parse");
    const data    = await pdfParse(buf);
    const title   = (data.info && data.info.Title) ? data.info.Title.trim() : url;
    return { title, text: data.text, type: "pdf" };
  }

  const html       = await res.text();
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title      = titleMatch ? titleMatch[1].trim() : url;
  return { title, text: stripHtml(html), type: "url" };
}

function resolveLocalFilePath(raw) {
  if (!raw || raw.startsWith("http://") || raw.startsWith("https://")) return null;

  let candidate = raw;
  if (raw.startsWith("file://")) {
    try {
      candidate = decodeURIComponent(new URL(raw).pathname);
    } catch {
      return null;
    }
  }

  const abs = path.resolve(candidate);
  if (!fs.existsSync(abs)) return null;

  const stat = fs.statSync(abs);
  if (!stat.isFile()) return null;

  return abs;
}

async function readLocalFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const stat = fs.statSync(filePath);

  if (stat.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(`file is too large (${stat.size} bytes > ${MAX_FILE_SIZE_BYTES} bytes)`);
  }

  if (ext === ".pdf") {
    const buf = fs.readFileSync(filePath);
    const pdfParse = require("pdf-parse");
    const data = await pdfParse(buf);
    const title = (data.info && data.info.Title) ? data.info.Title.trim() : path.basename(filePath);
    return {
      text: data.text,
      title,
      type: "file_pdf",
      source: filePath,
    };
  }

  if (BINARY_EXTENSIONS.has(ext)) {
    throw new Error(`unsupported file type for ingest: ${ext}`);
  }

  const text = fs.readFileSync(filePath, "utf8");
  return {
    text,
    title: path.basename(filePath),
    type: "file",
    source: filePath,
  };
}

async function main() {
  const args = parseArgs(process.argv);

  if (!args.source) {
    console.error("Usage: node ingest.js <url-or-text> [--title X] [--tags tag1,tag2] [--json]");
    process.exit(1);
  }

  const cfg = loadConfig();
  let text, title, type, source;

  const isUrl = args.source.startsWith("http://") || args.source.startsWith("https://");
  const localFilePath = resolveLocalFilePath(args.source);

  if (isUrl) {
    if (!args.json) console.log(`Fetching: ${args.source}`);
    const fetched = await fetchContent(args.source);
    text          = fetched.text;
    title         = args.title || fetched.title;
    type          = fetched.type;
    source        = args.source;
  } else if (localFilePath) {
    if (!args.json) console.log(`Reading file: ${localFilePath}`);
    const loaded = await readLocalFile(localFilePath);
    text         = loaded.text;
    title        = args.title || loaded.title;
    type         = loaded.type;
    source       = loaded.source;
  } else {
    text  = args.source;
    title = args.title || text.slice(0, 80).replace(/\n/g, " ").trim();
    type  = "text";
    source = "text";
  }

  if (!text || text.length < 20) {
    console.error("Error: content too short to ingest.");
    process.exit(1);
  }

  const entryId  = crypto.randomUUID();
  const chunks   = chunkText(text, cfg.chunkSize, cfg.chunkOverlap);
  const tagsJson = JSON.stringify(args.tags);

  if (!args.json) console.log(`Embedding ${chunks.length} chunk(s)...`);

  const db  = getSqliteDb();
  const col = getZvecCollection();

  // Insert entry FIRST so FK constraint on chunks is satisfied
  db.prepare(
    "INSERT OR REPLACE INTO entries (id, title, source, type, tags, chunk_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(entryId, title, source, type, tagsJson, chunks.length, Date.now());

  const insertChunk = db.prepare(
    "INSERT OR REPLACE INTO chunks (id, entry_id, chunk_index, text) VALUES (?, ?, ?, ?)"
  );

  const zvecDocs = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunkId = `${entryId}_${i}`;

    if (!args.json) process.stdout.write(`\r  chunk ${i + 1}/${chunks.length}   `);

    const embedding = await embedPassage(chunks[i]);

    zvecDocs.push({
      id:      chunkId,
      vectors: { embedding },
      fields:  {
        entry_id:   entryId,
        title,
        source,
        chunk_text: chunks[i],
        tags:       tagsJson,
      },
    });

    insertChunk.run(chunkId, entryId, i, chunks[i]);
  }

  col.upsertSync(zvecDocs);

  if (args.json) {
    console.log(JSON.stringify({ id: entryId, title, chunks: chunks.length, tags: args.tags, type }));
  } else {
    console.log(`\n✓ Ingested: "${title}"`);
    console.log(`  ID:     ${entryId}`);
    console.log(`  Chunks: ${chunks.length}`);
    console.log(`  Type:   ${type}`);
    console.log(`  Tags:   ${args.tags.join(", ") || "none"}`);
  }
}

main().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
