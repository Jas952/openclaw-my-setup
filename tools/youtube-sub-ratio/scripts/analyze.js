#!/usr/bin/env node
"use strict";

/**
 * YouTube Subscriber-to-View Ratio Analyzer
 *
 * Shows which videos over-performed relative to subscriber count.
 * ratio = views / subscribers × 100  (e.g. 2.5 means video got 2.5× views per sub)
 *
 * Usage:
 *   node analyze.js <channel>              # @handle, channel URL, or UCxxx ID
 *   node analyze.js <channel> --days 30    # only last 30 days
 *   node analyze.js <channel> --min 5000   # min view threshold
 *   node analyze.js <channel> --top 20     # show top N (default 15)
 *   node analyze.js <channel> --json       # output JSON
 *   node analyze.js <channel> --all        # all videos (no days limit)
 *
 * Requires: YOUTUBE_API_KEY env variable
 *   export YOUTUBE_API_KEY="AIza..."
 */

const API_KEY = process.env.YOUTUBE_API_KEY;
const BASE    = "https://www.googleapis.com/youtube/v3";

// ── CLI args ──────────────────────────────────────────────────────────────────
function parseArgs() {
  const argv = process.argv.slice(2);
  const args = { channel: null, days: 90, minViews: 0, top: 15, json: false, all: false };

  for (let i = 0; i < argv.length; i++) {
    if      (argv[i] === "--days"  && argv[i+1]) { args.days    = parseInt(argv[++i], 10); }
    else if (argv[i] === "--min"   && argv[i+1]) { args.minViews= parseInt(argv[++i], 10); }
    else if (argv[i] === "--top"   && argv[i+1]) { args.top     = parseInt(argv[++i], 10); }
    else if (argv[i] === "--json")               { args.json    = true; }
    else if (argv[i] === "--all")                { args.all     = true; }
    else if (!argv[i].startsWith("--"))          { args.channel = argv[i]; }
  }

  if (args.all) args.days = 0;
  return args;
}

// ── YouTube API helper ────────────────────────────────────────────────────────
async function ytGet(endpoint, params) {
  if (!API_KEY) {
    console.error("[youtube-sub-ratio] YOUTUBE_API_KEY not set.");
    console.error("  Get a free key at: https://console.cloud.google.com");
    console.error("  Then: export YOUTUBE_API_KEY=\"AIza...\"");
    process.exit(1);
  }

  const url = new URL(`${BASE}/${endpoint}`);
  url.searchParams.set("key", API_KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`YouTube API ${res.status}: ${body.error?.message || res.statusText}`);
  }
  return res.json();
}

// ── Channel resolution ────────────────────────────────────────────────────────
function extractChannelInput(raw) {
  // https://www.youtube.com/@handle  →  @handle
  // https://www.youtube.com/channel/UCxxx  →  UCxxx
  // https://www.youtube.com/c/name  →  @name (fallback)
  try {
    const u = new URL(raw);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts[0] === "channel" && parts[1]) return { kind: "id",     value: parts[1] };
    if (parts[0]?.startsWith("@"))          return { kind: "handle", value: parts[0] };
    if (parts[0] === "c" && parts[1])       return { kind: "handle", value: "@" + parts[1] };
  } catch { /* not a URL */ }

  if (raw.startsWith("UC"))   return { kind: "id",     value: raw };
  if (raw.startsWith("@"))    return { kind: "handle", value: raw };
  return                             { kind: "handle", value: "@" + raw };
}

async function resolveChannel(raw) {
  const { kind, value } = extractChannelInput(raw);
  const params = { part: "snippet,statistics,contentDetails", maxResults: 1 };

  if (kind === "id") {
    params.id = value;
  } else {
    // forHandle accepts "@handle" format
    params.forHandle = value.replace(/^@/, "");
  }

  const data = await ytGet("channels", params);
  if (!data.items?.length) throw new Error(`Channel not found: ${raw}`);

  const ch = data.items[0];
  const subs = parseInt(ch.statistics.subscriberCount || "0", 10);

  return {
    id:          ch.id,
    title:       ch.snippet.title,
    subscribers: subs,
    uploadsId:   ch.contentDetails.relatedPlaylists.uploads,
  };
}

// ── Fetch video list from uploads playlist ────────────────────────────────────
async function fetchVideoList(uploadsId, cutoffMs) {
  const videos  = [];
  let pageToken = null;

  do {
    const params = { playlistId: uploadsId, part: "snippet", maxResults: 50 };
    if (pageToken) params.pageToken = pageToken;

    const data = await ytGet("playlistItems", params);

    for (const item of data.items || []) {
      const pub = new Date(item.snippet.publishedAt).getTime();
      if (cutoffMs && pub < cutoffMs) return videos;   // playlist is newest-first

      const videoId = item.snippet.resourceId?.videoId;
      if (!videoId || videoId === "Private video" || videoId === "Deleted video") continue;

      videos.push({
        id:          videoId,
        title:       item.snippet.title,
        publishedAt: item.snippet.publishedAt,
      });
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  return videos;
}

// ── Batch fetch video statistics ──────────────────────────────────────────────
async function fetchVideoStats(videoIds) {
  const stats = {};

  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const data  = await ytGet("videos", { id: batch.join(","), part: "statistics" });

    for (const item of data.items || []) {
      stats[item.id] = {
        views: parseInt(item.statistics.viewCount  || "0", 10),
        likes: parseInt(item.statistics.likeCount  || "0", 10),
      };
    }
  }

  return stats;
}

// ── Formatting helpers ────────────────────────────────────────────────────────
function fmtNum(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtRatio(ratio) {
  // ratio = views/subs*100; show as e.g. "2.50×" relative to average sub
  if (ratio >= 10) return ratio.toFixed(1) + "×";
  return ratio.toFixed(2) + "×";
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs();

  if (!args.channel) {
    console.error("Usage: node analyze.js <channel> [--days 90] [--min 1000] [--top 15] [--all] [--json]");
    console.error("  channel: @handle, channel URL, or UCxxx ID");
    process.exit(1);
  }

  // 1. Resolve channel
  process.stderr.write(`Fetching channel info...`);
  const channel = await resolveChannel(args.channel);
  process.stderr.write(` ${channel.title} (${fmtNum(channel.subscribers)} subs)\n`);

  if (channel.subscribers === 0) {
    console.error("Subscriber count is hidden or zero — ratio cannot be calculated.");
    process.exit(1);
  }

  // 2. Fetch video list
  const cutoffMs = args.days > 0 ? Date.now() - args.days * 86_400_000 : 0;
  process.stderr.write(`Fetching video list${args.days ? ` (last ${args.days} days)` : ""}...`);
  const videos = await fetchVideoList(channel.uploadsId, cutoffMs);
  process.stderr.write(` ${videos.length} videos found\n`);

  if (videos.length === 0) {
    console.log("No videos found in the specified time range.");
    process.exit(0);
  }

  // 3. Fetch stats in batches
  process.stderr.write(`Fetching statistics...`);
  const stats = await fetchVideoStats(videos.map(v => v.id));
  process.stderr.write(` done\n`);

  // 4. Build results
  const results = videos
    .map(v => {
      const s = stats[v.id] || { views: 0, likes: 0 };
      return {
        id:          v.id,
        title:       v.title,
        publishedAt: v.publishedAt,
        views:       s.views,
        likes:       s.likes,
        ratio:       channel.subscribers > 0 ? (s.views / channel.subscribers) * 100 : 0,
      };
    })
    .filter(v => v.views >= args.minViews)
    .sort((a, b) => b.ratio - a.ratio);

  const topResults = results.slice(0, args.top);

  // 5. Output
  if (args.json) {
    console.log(JSON.stringify({
      channel:     channel.title,
      channelId:   channel.id,
      subscribers: channel.subscribers,
      days:        args.days || "all",
      videoCount:  results.length,
      videos:      topResults.map(v => ({
        ...v,
        ratio:       parseFloat(v.ratio.toFixed(4)),
        url:         `https://youtu.be/${v.id}`,
      })),
    }, null, 2));
    return;
  }

  // Human-readable table
  const avgRatio = results.length
    ? results.reduce((s, v) => s + v.ratio, 0) / results.length
    : 0;

  console.log(`\n📊 YouTube Sub-Ratio — ${channel.title}`);
  console.log(`   Subscribers: ${fmtNum(channel.subscribers)}  |  Videos analyzed: ${results.length}  |  Avg ratio: ${avgRatio.toFixed(2)}×`);
  if (args.days) console.log(`   Period: last ${args.days} days`);
  console.log();

  // Column widths
  const rankW  = 3;
  const ratioW = 7;
  const viewsW = 8;
  const dateW  = 12;
  const titleW = 52;

  const header =
    "#".padStart(rankW) + "  " +
    "Ratio".padStart(ratioW) + "  " +
    "Views".padStart(viewsW) + "  " +
    "Date".padEnd(dateW) + "  " +
    "Title";
  const sep = "─".repeat(header.length);

  console.log(header);
  console.log(sep);

  for (let i = 0; i < topResults.length; i++) {
    const v    = topResults[i];
    const mark = v.ratio > avgRatio * 2 ? " 🔥" : v.ratio > avgRatio ? " ↑" : "";

    console.log(
      String(i + 1).padStart(rankW) + "  " +
      fmtRatio(v.ratio).padStart(ratioW) + "  " +
      fmtNum(v.views).padStart(viewsW) + "  " +
      fmtDate(v.publishedAt).padEnd(dateW) + "  " +
      truncate(v.title, titleW) + mark
    );
  }

  console.log(sep);
  console.log(`\n  ratio = views ÷ subscribers × 100  (higher = more viral relative to audience)`);
  console.log(`  🔥 = 2× above average  ↑ = above average\n`);
}

main().catch(err => {
  console.error("[youtube-sub-ratio]", err.message);
  process.exit(1);
});
