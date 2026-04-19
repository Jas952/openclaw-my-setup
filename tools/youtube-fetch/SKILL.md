---
name: youtube-fetch
description: "Fetch YouTube video content: transcript, metadata, description. Use when: user shares a YouTube URL and wants to know what the video is about, asks for a summary, wants key points extracted, or wants to understand the content without watching. Also use when asked to ingest a YouTube video into the knowledge base."
homepage: https://github.com/yt-dlp/yt-dlp
metadata:
  {
    "openclaw":
      {
        "emoji": "▶️",
        "requires": { "bins": ["yt-dlp", "node"] },
      },
  }
---

# YouTube Fetch

Extracts the full transcript and metadata from any YouTube video. Feed it to Claude to summarize, analyze, answer questions, or ingest into the knowledge base.

**Code:** `/Users/dmitriy/openclaw/tools/youtube-fetch/scripts/fetch.js`
**Requires:** `yt-dlp` (already installed)

## When to Use

✅ **USE this skill when:**

- User shares a YouTube link → "о чём это видео?", "what is this about?"
- User wants a summary of a YouTube video
- User asks to extract key points / takeaways from a video
- User wants to save a video's content to the knowledge base
- User asks "watch this for me" about a YouTube URL

## When NOT to Use

❌ **DON'T use this skill when:**

- User wants to **download** the video file (use yt-dlp directly)
- User asks for channel analytics or subscriber stats (use youtube-sub-ratio)

## Command

```bash
# Full transcript + metadata (default)
node /Users/dmitriy/openclaw/tools/youtube-fetch/scripts/fetch.js <youtube-url>

# Metadata only (no transcript)
node /Users/dmitriy/openclaw/tools/youtube-fetch/scripts/fetch.js <url> --meta-only

# Prefer Russian transcript
node /Users/dmitriy/openclaw/tools/youtube-fetch/scripts/fetch.js <url> --lang ru

# JSON output (for piping to other tools)
node /Users/dmitriy/openclaw/tools/youtube-fetch/scripts/fetch.js <url> --json
```

## Workflow

1. User shares a YouTube URL
2. Run `fetch.js <url>` — outputs title, channel, metadata, and full transcript
3. Use the transcript to answer questions, summarize, extract insights
4. Optionally ingest into knowledge base:
   ```bash
   node /Users/dmitriy/openclaw/core/knowledge-base/ingest.js "<url>" --title "<video title>" --tags youtube,<topic>
   ```

## Notes

- Transcripts are available for most talk/educational/news videos (auto-generated captions)
- Music videos and very old videos may not have transcripts → summarize from title + description
- Transcript truncated at 12,000 chars if very long (plenty for most 30–60 min videos)
- Language fallback: tries `en` first, then `ru`, then any available language
- No API key required — uses yt-dlp which bypasses auth for public videos
