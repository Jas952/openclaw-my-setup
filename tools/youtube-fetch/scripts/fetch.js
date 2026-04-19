#!/usr/bin/env node
"use strict";

/**
 * YouTube Video Content Fetcher
 *
 * Extracts metadata + transcript from a YouTube video so the bot can
 * understand what the video is about, summarize it, answer questions, etc.
 *
 * Usage:
 *   node fetch.js <youtube-url>              # full output (metadata + transcript)
 *   node fetch.js <youtube-url> --meta-only  # metadata only (no transcript)
 *   node fetch.js <youtube-url> --json       # raw JSON output
 *   node fetch.js <youtube-url> --lang ru    # prefer language (default: en,ru)
 *   node fetch.js <youtube-url> --no-ingest  # skip KB ingest even if configured
 *
 * Requires: yt-dlp  (brew install yt-dlp)
 */

const { execFileSync, spawnSync } = require("child_process");
const fs   = require("fs");
const path = require("path");
const os   = require("os");

// ── CLI ───────────────────────────────────────────────────────────────────────
function parseArgs() {
  const argv = process.argv.slice(2);
  const args = { url: null, metaOnly: false, json: false, lang: "en,ru,en-US,en-GB" };
  for (let i = 0; i < argv.length; i++) {
    if      (argv[i] === "--meta-only")            { args.metaOnly = true; }
    else if (argv[i] === "--json")                 { args.json     = true; }
    else if (argv[i] === "--lang" && argv[i + 1]) { args.lang     = argv[++i]; }
    else if (!argv[i].startsWith("--"))            { args.url      = argv[i]; }
  }
  return args;
}

// ── yt-dlp helpers ────────────────────────────────────────────────────────────
function ytdlp(args) {
  const result = spawnSync("yt-dlp", args, { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
  if (result.error) throw new Error(`yt-dlp not found. Install with: brew install yt-dlp`);
  return { stdout: result.stdout || "", stderr: result.stderr || "", code: result.status };
}

function getMetadata(url) {
  const { stdout, code } = ytdlp(["--dump-json", "--no-playlist", url]);
  if (code !== 0 || !stdout.trim()) throw new Error("Could not fetch video metadata. Is the URL valid?");
  return JSON.parse(stdout.trim());
}

function getTranscript(url, lang, tmpDir) {
  const outTemplate = path.join(tmpDir, "%(id)s");

  // Try auto-subtitles first, then manual subtitles
  for (const flag of ["--write-auto-subs", "--write-subs"]) {
    const { code } = ytdlp([
      "--skip-download",
      flag,
      "--sub-lang", lang,
      "--sub-format", "json3",
      "-o", outTemplate,
      "--no-playlist",
      "--quiet",
      url,
    ]);
    if (code === 0) break;
  }

  // Find the generated .json3 file
  const files = fs.readdirSync(tmpDir).filter(f => f.endsWith(".json3"));
  if (files.length === 0) return null;

  // Prefer the requested language
  const preferred = files.find(f => lang.split(",").some(l => f.includes(`.${l}.`)));
  const chosen    = preferred || files[0];
  return { file: path.join(tmpDir, chosen), lang: chosen.match(/\.([^.]+)\.json3$/)?.[1] || "?" };
}

// ── Transcript parsing ────────────────────────────────────────────────────────
function parseJson3(filePath) {
  const raw    = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const events = raw.events || [];
  const parts  = [];

  for (const ev of events) {
    if (!ev.segs) continue;
    const text = ev.segs.map(s => s.utf8 || "").join("").trim();
    if (text && text !== "\n") parts.push(text);
  }

  // Deduplicate consecutive identical lines (auto-captions overlap)
  const deduped = [];
  for (const p of parts) {
    if (deduped[deduped.length - 1] !== p) deduped.push(p);
  }

  return deduped.join(" ").replace(/\s+/g, " ").trim();
}

// ── Formatting helpers ────────────────────────────────────────────────────────
function fmtDuration(secs) {
  if (!secs) return "?";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function fmtNum(n) {
  if (!n) return "?";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000)     return Math.round(n / 1_000) + "k";
  return String(n);
}

function stripHtml(s) {
  return (s || "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs();

  if (!args.url) {
    console.error("Usage: node fetch.js <youtube-url> [--meta-only] [--json] [--lang ru]");
    console.error("  Example: node fetch.js https://youtu.be/dQw4w9WgXcQ");
    process.exit(1);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ytfetch-"));

  try {
    // 1. Fetch metadata
    process.stderr.write("Fetching video metadata...\n");
    const meta = getMetadata(args.url);

    const info = {
      id:          meta.id,
      url:         `https://www.youtube.com/watch?v=${meta.id}`,
      title:       meta.title,
      channel:     meta.channel || meta.uploader,
      channelUrl:  meta.channel_url || meta.uploader_url,
      duration:    meta.duration,
      viewCount:   meta.view_count,
      likeCount:   meta.like_count,
      uploadDate:  meta.upload_date
        ? `${meta.upload_date.slice(0,4)}-${meta.upload_date.slice(4,6)}-${meta.upload_date.slice(6,8)}`
        : null,
      description: stripHtml(meta.description || "").slice(0, 1000),
      tags:        (meta.tags || []).slice(0, 20),
      categories:  meta.categories || [],
      thumbnail:   meta.thumbnail,
      transcript:  null,
      transcriptLang: null,
    };

    // 2. Fetch transcript (unless --meta-only)
    if (!args.metaOnly) {
      process.stderr.write("Fetching transcript...\n");
      const result = getTranscript(args.url, args.lang, tmpDir);

      if (result) {
        info.transcript     = parseJson3(result.file);
        info.transcriptLang = result.lang;
        process.stderr.write(`Transcript: ${info.transcript.length} chars (${result.lang})\n`);
      } else {
        process.stderr.write("No transcript available for this video.\n");
      }
    }

    // 3. Output
    if (args.json) {
      console.log(JSON.stringify(info, null, 2));
      return;
    }

    // Human-readable output for the bot to process
    const lines = [];
    lines.push(`━━━ YouTube Video ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    lines.push(`Title:    ${info.title}`);
    lines.push(`Channel:  ${info.channel}`);
    lines.push(`URL:      ${info.url}`);
    lines.push(`Duration: ${fmtDuration(info.duration)}`);
    lines.push(`Views:    ${fmtNum(info.viewCount)}`);
    if (info.likeCount) lines.push(`Likes:    ${fmtNum(info.likeCount)}`);
    if (info.uploadDate) lines.push(`Date:     ${info.uploadDate}`);
    if (info.categories?.length) lines.push(`Category: ${info.categories.join(", ")}`);
    if (info.tags?.length) lines.push(`Tags:     ${info.tags.slice(0, 8).join(", ")}`);

    if (info.description) {
      lines.push(``);
      lines.push(`Description:`);
      lines.push(info.description.slice(0, 500) + (info.description.length > 500 ? "…" : ""));
    }

    if (info.transcript) {
      lines.push(``);
      lines.push(`━━━ Transcript (${info.transcriptLang}) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      // Truncate very long transcripts — keep first 12000 chars for context window
      const MAX = 12000;
      const t   = info.transcript;
      lines.push(t.length > MAX ? t.slice(0, MAX) + `\n\n[... transcript truncated at ${MAX} chars, total ${t.length} chars]` : t);
    } else {
      lines.push(``);
      lines.push(`[No transcript available — summarize based on title and description]`);
    }

    lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(lines.join("\n"));

  } finally {
    // Cleanup temp files
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

main().catch(err => {
  console.error("[youtube-fetch]", err.message);
  process.exit(1);
});
