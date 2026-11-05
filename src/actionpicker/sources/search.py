from __future__ import annotations


def find_review_urls(name: str, year: int | None, limit: int = 5, ddgs=None) -> list[str]:
    """Return up to `limit` unique http(s) URLs likely to hold reviews of the title."""
    if ddgs is None:
        from duckduckgo_search import DDGS

        ddgs = DDGS()
    query = f"{name} {year or ''} review fight scenes action".replace("  ", " ").strip()
    urls: list[str] = []
    for hit in ddgs.text(query, max_results=limit * 3):
        href = hit.get("href", "")
        if href.startswith(("http://", "https://")) and href not in urls:
            urls.append(href)
        if len(urls) >= limit:
            break
    return urls
