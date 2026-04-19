---
name: youtube-sub-ratio
description: "Analyze YouTube channel videos by subscriber-to-view ratio. Use when: user asks which YouTube videos over-performed, what content got the most views relative to subscriber count, or wants to rank videos by viral potential. Requires YOUTUBE_API_KEY env variable."
homepage: https://developers.google.com/youtube/v3
metadata:
  {
    "openclaw":
      {
        "emoji": "📊",
        "requires": { "bins": ["node"], "env": ["YOUTUBE_API_KEY"] },
      },
  }
---

# YouTube Sub-Ratio Analyzer

Ranks a channel's videos by **ratio = views ÷ subscribers × 100**.
Higher ratio = video "punched above its weight" relative to audience size (viral, recommended, or shared externally).

**Requires:** `YOUTUBE_API_KEY` env variable (free — 10,000 units/day quota)
**Code:** `/Users/dmitriy/openclaw/tools/youtube-sub-ratio/scripts/analyze.js`

## When to Use

✅ **USE this skill when:**

- "Какое видео сильнее всего зашло на канале X?"
- "Which YouTube videos got the most views relative to subscribers?"
- "Analyze this channel's top performing content"
- "Show me viral videos from @channelname last 30 days"
- "Compare video performance on YouTube channel"

## When NOT to Use

❌ **DON'T use this skill when:**

- No `YOUTUBE_API_KEY` is configured — remind user to set it
- User asks about private channels or channels with hidden subscriber counts
- User wants real-time streaming analytics (this uses public API data)

## Commands

```bash
# Basic analysis (last 90 days, top 15 videos)
node /Users/dmitriy/openclaw/tools/youtube-sub-ratio/scripts/analyze.js @channelhandle

# Last 30 days only
node /Users/dmitriy/openclaw/tools/youtube-sub-ratio/scripts/analyze.js @channelhandle --days 30

# All videos ever uploaded
node /Users/dmitriy/openclaw/tools/youtube-sub-ratio/scripts/analyze.js @channelhandle --all

# Filter: only videos with 10k+ views
node /Users/dmitriy/openclaw/tools/youtube-sub-ratio/scripts/analyze.js @channelhandle --min 10000

# Show top 30 instead of 15
node /Users/dmitriy/openclaw/tools/youtube-sub-ratio/scripts/analyze.js @channelhandle --top 30

# JSON output for further processing
node /Users/dmitriy/openclaw/tools/youtube-sub-ratio/scripts/analyze.js @channelhandle --json

# From full URL
node /Users/dmitriy/openclaw/tools/youtube-sub-ratio/scripts/analyze.js "https://www.youtube.com/@channelname"

# By channel ID
node /Users/dmitriy/openclaw/tools/youtube-sub-ratio/scripts/analyze.js UCxxxxxxxxxxxxxxxxxx
```

## Example Output

```
📊 YouTube Sub-Ratio — Channel Name
   Subscribers: 1.2M  |  Videos analyzed: 47  |  Avg ratio: 1.84×

#    Ratio    Views  Date          Title
──────────────────────────────────────────────────────────────────────
 1   8.12×    97.4k  Jan 15, 2026  How I Built an AI Agent in 1 Hour 🔥
 2   5.43×    65.1k  Feb 3, 2026   Claude 3.5 vs GPT-4o — Real Test 🔥
 3   3.21×    38.5k  Jan 28, 2026  The Best AI Tools in 2026 ↑
 4   2.14×    25.7k  Feb 10, 2026  Building RAG From Scratch ↑
 5   1.02×    12.2k  Jan 20, 2026  Weekly AI News Roundup
```

## Notes

- `ratio = views ÷ subscribers × 100` — e.g. ratio 8× means the video got 8× more views than the channel has subscribers
- 🔥 = 2× above channel average (strong outlier)
- ↑ = above channel average
- Subscriber data from YouTube may lag 24-72h; best analyzed for videos 5+ days old
- Free API quota: 10,000 units/day. One full analysis of a 500-video channel ≈ 15 units

## Setup (first time)

```bash
# 1. Get free API key at: https://console.cloud.google.com
#    Enable "YouTube Data API v3" → Create Credentials → API Key

# 2. Add to ~/.zshrc:
export YOUTUBE_API_KEY="AIzaSy..."

# 3. Reload:
source ~/.zshrc
```
