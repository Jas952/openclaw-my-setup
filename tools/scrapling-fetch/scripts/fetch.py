#!/usr/bin/env python3
import argparse
import json
import sys
import time
from typing import Any


def _build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description="Universal scraping with Scrapling")
    ap.add_argument("--url", required=True, help="Target URL")
    ap.add_argument(
        "--mode",
        choices=["http", "stealth", "dynamic"],
        default="http",
        help="Fetcher mode",
    )
    ap.add_argument("--selector", default="", help="CSS or XPath selector")
    ap.add_argument(
        "--selector-type",
        choices=["css", "xpath"],
        default="css",
        help="Selector type",
    )
    ap.add_argument("--all", action="store_true", help="Return all matches")
    ap.add_argument(
        "--headless",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Headless browser for stealth/dynamic",
    )
    ap.add_argument(
        "--network-idle",
        action="store_true",
        help="Wait for network idle where supported",
    )
    ap.add_argument(
        "--solve-cloudflare",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Enable Cloudflare-solving options where supported",
    )
    ap.add_argument("--timeout", type=int, default=45, help="Timeout seconds")
    ap.add_argument("--max-chars", type=int, default=5000, help="Max output text size")
    ap.add_argument("--json", action="store_true", help="JSON output")
    return ap


def _emit(data: dict[str, Any], as_json: bool) -> int:
    if as_json:
        print(json.dumps(data, ensure_ascii=False, indent=2))
    else:
        if data.get("ok"):
            print(f"URL: {data.get('final_url') or data.get('url')}")
            print(f"Mode: {data.get('mode')}")
            print(f"Title: {data.get('title') or ''}")
            print(f"Extractor: {data.get('extractor')}")
            result = data.get("result")
            if isinstance(result, list):
                for i, item in enumerate(result, 1):
                    print(f"{i}. {item}")
            elif result is not None:
                print(result)
            sample = data.get("sample_text")
            if sample:
                print("\nSample:")
                print(sample)
        else:
            print(data.get("error") or "unknown error")
    return 0 if data.get("ok") else 1


def _safe_kwargs(fn: Any, kwargs: dict[str, Any]) -> dict[str, Any]:
    try:
        import inspect

        sig = inspect.signature(fn)
    except Exception:
        return kwargs
    accepted = {}
    for k, v in kwargs.items():
        if k in sig.parameters:
            accepted[k] = v
    return accepted


def _call_fetch(fetcher_obj: Any, url: str, kwargs: dict[str, Any]) -> Any:
    candidates = ("fetch", "get", "request")
    last_error: Exception | None = None
    for method_name in candidates:
        fn = getattr(fetcher_obj, method_name, None)
        if not callable(fn):
            continue
        use_kwargs = _safe_kwargs(fn, kwargs)
        try:
            return fn(url, **use_kwargs)
        except TypeError:
            try:
                return fn(url)
            except Exception as exc:
                last_error = exc
        except Exception as exc:
            last_error = exc
    if last_error:
        raise last_error
    raise RuntimeError("No callable fetch method found on fetcher")


def _extract(page: Any, selector: str, selector_type: str, return_all: bool) -> Any:
    if not selector:
        return None
    if selector_type == "xpath":
        node = page.xpath(selector)
    else:
        node = page.css(selector)
    if return_all:
        return node.getall()
    return node.get()


def _collect_page_text(page: Any, max_chars: int) -> str:
    text = ""
    try:
        parts = page.css("body *::text").getall()
        if parts:
            text = " ".join(p.strip() for p in parts if p and p.strip())
    except Exception:
        pass
    if not text:
        try:
            text = str(page)
        except Exception:
            text = ""
    text = " ".join(text.split())
    return text[:max_chars]


def main() -> int:
    args = _build_parser().parse_args()
    started = time.time()

    try:
        from scrapling.fetchers import DynamicFetcher, Fetcher, StealthyFetcher
    except Exception as exc:
        return _emit(
            {
                "ok": False,
                "url": args.url,
                "mode": args.mode,
                "error": (
                    "scrapling import failed. Install with: "
                    "python3 -m pip install -U 'scrapling[fetchers]' && "
                    "python3 -m scrapling install"
                ),
                "details": str(exc),
            },
            args.json,
        )

    fetch_kwargs = {
        "headless": args.headless,
        "network_idle": args.network_idle,
        "solve_cloudflare": args.solve_cloudflare,
        "timeout": args.timeout,
    }

    try:
        if args.mode == "http":
            page = _call_fetch(Fetcher, args.url, {"timeout": args.timeout})
        elif args.mode == "stealth":
            page = _call_fetch(StealthyFetcher, args.url, fetch_kwargs)
        else:
            page = _call_fetch(DynamicFetcher, args.url, fetch_kwargs)
    except Exception as exc:
        return _emit(
            {
                "ok": False,
                "url": args.url,
                "mode": args.mode,
                "error": f"fetch failed: {exc}",
                "took_ms": int((time.time() - started) * 1000),
            },
            args.json,
        )

    title = ""
    try:
        title = page.css("title::text").get() or ""
    except Exception:
        title = ""

    result = None
    extractor = "page_sample"
    if args.selector:
        try:
            result = _extract(page, args.selector, args.selector_type, args.all)
            extractor = f"{args.selector_type}:{'all' if args.all else 'first'}"
        except Exception as exc:
            return _emit(
                {
                    "ok": False,
                    "url": args.url,
                    "mode": args.mode,
                    "error": f"selector extraction failed: {exc}",
                    "took_ms": int((time.time() - started) * 1000),
                },
                args.json,
            )

    sample_text = _collect_page_text(page, args.max_chars)
    final_url = ""
    for attr in ("url", "final_url", "response_url"):
        value = getattr(page, attr, "")
        if isinstance(value, str) and value:
            final_url = value
            break

    payload = {
        "ok": True,
        "url": args.url,
        "final_url": final_url or args.url,
        "mode": args.mode,
        "title": title,
        "extractor": extractor,
        "selector": args.selector,
        "selector_type": args.selector_type,
        "all": args.all,
        "result": result,
        "sample_text": sample_text,
        "took_ms": int((time.time() - started) * 1000),
    }
    return _emit(payload, args.json)


if __name__ == "__main__":
    sys.exit(main())
