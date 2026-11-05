from __future__ import annotations

from dataclasses import dataclass

from .llm import LlmError
from .models import Title
from .sources.tmdb import RateLimitError
from .store import Store


@dataclass
class IngestReport:
    titles_added: int = 0
    scored: int = 0
    skipped: int = 0
    stopped_on_ratelimit: bool = False


def _gather_reviews(store, finder, fetcher, title: Title, name: str, season_id) -> list:
    for url in finder(name, title.year):
        text = fetcher.fetch(url)
        if text:
            store.add_review(title.id, season_id, url, text)
    return store.get_reviews(title.id, season_id)


def run_ingest(
    store: Store, tmdb, finder, fetcher, extractor, queries: list[str], limit: int = 30
) -> IngestReport:
    """Discover titles, then fetch reviews and score up to `limit` pending titles."""
    report = IngestReport()
    before = store.title_count()
    try:
        for query in queries:
            for title in tmdb.discover(query):
                store.upsert_title(title)
    except RateLimitError:
        report.stopped_on_ratelimit = True
    report.titles_added = store.title_count() - before

    for title in store.pending_titles(limit):
        try:
            targets: list[tuple[int | None, int | None]]  # (season_no, season_id)
            if title.kind == "series":
                numbers = tmdb.seasons(title.tmdb_id)
                targets = [(n, store.upsert_season(title.id, n)) for n in numbers]
            else:
                targets = [(None, None)]
            scored_any = False
            for season_no, season_id in targets:
                name = title.name if season_no is None else f"{title.name} season {season_no}"
                reviews = _gather_reviews(store, finder, fetcher, title, name, season_id)
                if not reviews:
                    continue
                scores = extractor(title, season_no, season_id, reviews)
                if scores is not None:
                    store.save_scores(scores)
                    scored_any = True
        except (RateLimitError, LlmError):
            report.stopped_on_ratelimit = True
            break
        if scored_any:
            report.scored += 1
        else:
            report.skipped += 1
            store.bump_attempts(title.id)
    return report
