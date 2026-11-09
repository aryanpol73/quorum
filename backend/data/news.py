"""Latest headlines from the Google News RSS search feed."""

from __future__ import annotations

import json
import logging
from datetime import date, timedelta, timezone
from email.utils import parsedate_to_datetime

import feedparser
import httpx

from .. import cache
from ..config import DEMO_DATA_DIR, get_settings
from ..tickers import TickerRef

log = logging.getLogger("quorum.news")

RSS_URL = "https://news.google.com/rss/search"
USER_AGENT = "Mozilla/5.0 (compatible; QuorumEducationalBot/1.0)"


def build_query(ref: TickerRef, as_of: date | None = None) -> str:
    query = f"{ref.name} stock"
    if as_of is not None:
        # Google News search operators: only headlines published in the 2 weeks before as_of.
        start = as_of - timedelta(days=14)
        query += f" after:{start.isoformat()} before:{(as_of + timedelta(days=1)).isoformat()}"
    return query


def _parse_feed(content: bytes, limit: int, as_of: date | None) -> list[dict]:
    feed = feedparser.parse(content)
    items, seen = [], set()
    for entry in feed.entries:
        title = (entry.get("title") or "").strip()
        source = (entry.get("source") or {}).get("title") or ""
        if source and title.endswith(f" - {source}"):
            title = title[: -len(source) - 3].strip()
        key = title.lower()[:80]
        if not title or key in seen:
            continue
        seen.add(key)
        published = None
        if entry.get("published"):
            try:
                published = parsedate_to_datetime(entry["published"]).astimezone(timezone.utc)
            except (TypeError, ValueError):
                published = None
        if as_of is not None and published is not None and published.date() > as_of:
            continue  # never leak post-as_of headlines into an evaluation run
        items.append(
            {
                "title": title,
                "source": source,
                "published": published.isoformat() if published else None,
                "link": entry.get("link"),
            }
        )
    items.sort(key=lambda h: h["published"] or "", reverse=True)
    return items[:limit]


def _fetch(query: str, limit: int, as_of: date | None) -> list[dict]:
    resp = httpx.get(
        RSS_URL,
        params={"q": query, "hl": "en-IN", "gl": "IN", "ceid": "IN:en"},
        headers={"User-Agent": USER_AGENT},
        timeout=12.0,
        follow_redirects=True,
    )
    resp.raise_for_status()
    return _parse_feed(resp.content, limit, as_of)


def _load_demo(ref: TickerRef) -> list[dict] | None:
    path = DEMO_DATA_DIR / ref.symbol / "news.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))["headlines"]


def get_headlines(ref: TickerRef, as_of: date | None = None, limit: int = 10) -> tuple[list[dict], str, str]:
    """Returns (headlines, source, query). source is 'live', 'cache', 'demo' or 'none'."""
    query = build_query(ref, as_of)
    settings = get_settings()
    if settings.demo_mode and as_of is None:
        demo = _load_demo(ref)
        if demo is not None:
            return demo[:limit], "demo", query
    try:
        items, hit = cache.cached(f"news:{query}:{limit}", lambda: _fetch(query, limit, as_of))
        if items:
            return items, "cache" if hit else "live", query
    except Exception as exc:
        log.warning("Google News fetch failed for %r: %s", query, exc)
    if as_of is None:
        demo = _load_demo(ref)
        if demo is not None:
            return demo[:limit], "demo", query
    return [], "none", query

