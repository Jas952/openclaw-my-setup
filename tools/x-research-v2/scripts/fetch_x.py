#!/usr/bin/env python3
import argparse
import json
import time
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path

OPENCLAW_X_ROOT = Path("/Users/dmitriy/openclaw/openclaw_x")
ENV_PATH = OPENCLAW_X_ROOT / ".env"
SEARCH_QUERY_ID = "XM0urMMfseSQYH5yohYHuQ"

SEARCH_FEATURES = {
    "responsive_web_graphql_exclude_directive_enabled": True,
    "verified_phone_label_enabled": False,
    "creator_subscriptions_tweet_preview_api_enabled": True,
    "responsive_web_graphql_timeline_navigation_enabled": True,
    "responsive_web_graphql_skip_user_profile_image_extensions_enabled": False,
    "c9s_tweet_anatomy_moderator_badge_enabled": True,
    "tweetypie_unmention_optimization_enabled": True,
    "responsive_web_edit_tweet_api_enabled": True,
    "graphql_is_translatable_rweb_tweet_is_translatable_enabled": True,
    "view_counts_everywhere_api_enabled": True,
    "longform_notetweets_consumption_enabled": True,
    "responsive_web_twitter_article_tweet_consumption_enabled": True,
    "tweet_awards_web_tipping_enabled": False,
    "freedom_of_speech_not_reach_fetch_enabled": True,
    "standardized_nudges_misinfo": True,
    "tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled": True,
    "rweb_video_timestamps_enabled": True,
    "longform_notetweets_rich_text_read_enabled": True,
    "longform_notetweets_inline_media_enabled": True,
    "responsive_web_enhance_cards_enabled": False,
    "responsive_web_media_download_video_enabled": True,
    "rweb_lists_timeline_redesign_enabled": True,
    "communities_web_enable_tweet_community_results_fetch": True,
    "articles_preview_enabled": True,
    "rweb_tipjar_consumption_enabled": True,
    "creator_subscriptions_quote_tweet_preview_enabled": False,
}


def parse_env(path: Path) -> dict:
    out = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        out[key.strip()] = val.strip()
    return out


def get_nested(obj, *keys):
    cur = obj
    for k in keys:
        if not isinstance(cur, dict) or k not in cur:
            return None
        cur = cur[k]
    return cur


def parse_tweets(payload):
    instructions = get_nested(payload, "data", "search_by_raw_query", "search_timeline", "timeline", "instructions") or []
    tweets = []
    for instr in instructions:
        entries = instr.get("entries") if isinstance(instr, dict) else None
        if not isinstance(entries, list):
            continue
        for entry in entries:
            item = get_nested(entry, "content", "itemContent")
            if not isinstance(item, dict):
                continue
            result = get_nested(item, "tweet_results", "result")
            if not isinstance(result, dict):
                continue
            tweet_wrap = result.get("tweet") if isinstance(result.get("tweet"), dict) else result
            legacy = tweet_wrap.get("legacy") if isinstance(tweet_wrap.get("legacy"), dict) else {}
            core_user = get_nested(tweet_wrap, "core", "user_results", "result", "legacy") or {}

            tid = legacy.get("id_str") or tweet_wrap.get("rest_id")
            if not tid:
                continue
            username = core_user.get("screen_name") or ""
            text = legacy.get("full_text") or legacy.get("text") or ""
            conv_id = legacy.get("conversation_id_str") or tid
            created_at = legacy.get("created_at") or ""

            media = []
            ext = legacy.get("extended_entities")
            if isinstance(ext, dict):
                for m in ext.get("media", []) or []:
                    if not isinstance(m, dict):
                        continue
                    mtype = str(m.get("type") or "")
                    murl = str(m.get("media_url_https") or m.get("media_url") or "")
                    if murl:
                        media.append({"type": mtype, "url": murl})

            ptype = "original"
            if str(text).startswith("RT @"):
                ptype = "retweet"
            elif legacy.get("in_reply_to_status_id_str"):
                ptype = "reply"
            elif legacy.get("quoted_status_id_str"):
                ptype = "quote"

            tweets.append(
                {
                    "id": str(tid),
                    "username": str(username),
                    "text": str(text),
                    "created_at": str(created_at),
                    "conversation_id": str(conv_id),
                    "type": ptype,
                    "tweet_url": f"https://x.com/{username}/status/{tid}" if username else "",
                    "media": media,
                }
            )
    return tweets


def search_once(raw_query: str, cursor: str | None, headers: dict, cookies: dict, product: str):
    variables = {
        "rawQuery": raw_query,
        "count": 20,
        "querySource": "typed_query",
        "product": product,
    }
    if cursor:
        variables["cursor"] = cursor

    url = f"https://x.com/i/api/graphql/{SEARCH_QUERY_ID}/SearchTimeline"
    body = json.dumps({"variables": variables, "features": SEARCH_FEATURES}, separators=(",", ":")).encode("utf-8")
    req = urllib.request.Request(url=url, method="POST", data=body)

    for k, v in headers.items():
        lk = str(k).lower()
        if lk == "cookie":
            continue
        req.add_header(str(k), str(v))
    req.add_header("content-type", "application/json")
    req.add_header("cookie", "; ".join([f"{k}={v}" for k, v in cookies.items()]))

    with urllib.request.urlopen(req, timeout=45) as resp:
        payload = json.loads(resp.read().decode("utf-8", "ignore"))
    return payload


def short_error(exc: Exception) -> str:
    if isinstance(exc, urllib.error.HTTPError):
        return f"HTTP {exc.code}"
    if isinstance(exc, urllib.error.URLError):
        reason = str(getattr(exc, "reason", "") or "").strip()
        return f"URLError: {reason}" if reason else "URLError"
    text = str(exc).strip()
    return text or exc.__class__.__name__


def next_cursor(payload):
    instructions = get_nested(payload, "data", "search_by_raw_query", "search_timeline", "timeline", "instructions") or []
    for instr in instructions:
        entries = instr.get("entries") if isinstance(instr, dict) else None
        if not isinstance(entries, list):
            continue
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            if str(entry.get("entryId") or "").startswith("cursor-bottom"):
                content = entry.get("content")
                if isinstance(content, dict):
                    val = content.get("value")
                    if isinstance(val, str) and val:
                        return val
    return ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--profile", default="")
    ap.add_argument("--query", default="")
    ap.add_argument("--limit", type=int, default=10)
    ap.add_argument("--pages", type=int, default=2)
    ap.add_argument("--attempts", type=int, default=3)
    args = ap.parse_args()

    profile = args.profile.strip().lstrip("@")
    query = args.query.strip()
    if not profile and not query:
        raise SystemExit("profile or query required")

    env = parse_env(ENV_PATH)
    cookies_raw = env.get("COOKIES_SEARCH_CONFIG") or env.get("TWITTER_COOKIES_CONFIG") or "{}"
    headers_raw = env.get("HEADERS_SEARCH_CONFIG") or env.get("HEADERS_ID_CONFIG") or "{}"
    cookies = json.loads(cookies_raw)
    headers = json.loads(headers_raw)
    if not isinstance(cookies, dict) or not isinstance(headers, dict) or not cookies or not headers:
        out = {
            "profile": profile,
            "query": query,
            "count": 0,
            "posts": [],
            "error": "missing X auth config (cookies/headers)",
            "meta": {
                "retry_exhausted": True,
                "attempts_used": 0,
                "max_attempts_per_page": max(1, int(args.attempts)),
                "product": "none",
            },
        }
        print(json.dumps(out, ensure_ascii=False))
        return

    raw_query = query or f"from:{profile} -is:retweet"
    pages = max(1, int(args.pages))
    limit = max(1, int(args.limit))
    max_attempts = max(1, int(args.attempts))

    def collect_with_product(product: str):
        all_items = []
        cursor_local = None
        attempts_used = 0
        last_error = ""
        retry_exhausted = False
        for _ in range(pages):
            payload = None
            for attempt in range(1, max_attempts + 1):
                attempts_used += 1
                try:
                    payload = search_once(raw_query, cursor_local, headers, cookies, product)
                    last_error = ""
                    break
                except Exception as exc:  # noqa: BLE001
                    last_error = short_error(exc)
                    if attempt < max_attempts:
                        time.sleep(min(1.6, 0.5 * attempt))
            if payload is None:
                retry_exhausted = True
                break
            all_items.extend(parse_tweets(payload))
            cursor_local = next_cursor(payload)
            if not cursor_local:
                break
        return all_items, {
            "attempts_used": attempts_used,
            "max_attempts_per_page": max_attempts,
            "retry_exhausted": retry_exhausted,
            "error": last_error,
            "product": product,
        }

    all_tweets, meta = collect_with_product("Latest")
    # Empirically, some auth profiles return empty entries for `from:user` on Latest.
    # Fallback to Top keeps request-time fetch working for profile research.
    if len(all_tweets) == 0:
        top_tweets, top_meta = collect_with_product("Top")
        if top_tweets:
            all_tweets = top_tweets
            meta = top_meta
        else:
            meta = {
                "attempts_used": int(meta.get("attempts_used", 0)) + int(top_meta.get("attempts_used", 0)),
                "max_attempts_per_page": max_attempts,
                "retry_exhausted": bool(meta.get("retry_exhausted")) or bool(top_meta.get("retry_exhausted")),
                "error": top_meta.get("error") or meta.get("error") or "",
                "product": "Top" if top_meta.get("attempts_used") else str(meta.get("product") or "Latest"),
            }

    # dedupe keep order
    uniq = []
    seen = set()
    for t in all_tweets:
        tid = t.get("id")
        if tid in seen:
            continue
        seen.add(tid)
        if profile and not (t.get("username") or "").strip():
            t["username"] = profile
            if not (t.get("tweet_url") or "").strip() and t.get("id"):
                t["tweet_url"] = f"https://x.com/{profile}/status/{t['id']}"
        uniq.append(t)

    out = {
        "profile": profile,
        "query": raw_query,
        "count": min(len(uniq), limit),
        "posts": uniq[:limit],
        "error": str(meta.get("error") or ""),
        "meta": meta,
    }
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
