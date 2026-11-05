from __future__ import annotations

from urllib.parse import urlparse

# Video and social sites hold no scrapable review text (or forbid scraping).
_BLOCKED_DOMAINS = (
    "youtube.com",
    "youtu.be",
    "tiktok.com",
    "facebook.com",
    "instagram.com",
    "x.com",
    "twitter.com",
    "pinterest.com",
    "reddit.com",
)


def _blocked(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return any(host == d or host.endswith("." + d) for d in _BLOCKED_DOMAINS)


def find_review_urls(name: str, year: int | None, limit: int = 5, ddgs=None) -> list[str]:
    """Return up to `limit` unique http(s) URLs likely to hold written reviews of the title."""
    if ddgs is None:
        from ddgs import DDGS

        ddgs = DDGS()
    query = f"{name} {year or ''} film review fight scenes action".replace("  ", " ").strip()
    urls: list[str] = []
    for hit in ddgs.text(query, max_results=limit * 4):
        href = hit.get("href", "")
        if not href.startswith(("http://", "https://")) or _blocked(href) or href in urls:
            continue
        urls.append(href)
        if len(urls) >= limit:
            break
    return urls
