from __future__ import annotations

import logging
from dataclasses import dataclass

from .llm import LlmError
from .models import Title
from .sources.tmdb import RateLimitError, TmdbError
from .store import Store

log = logging.getLogger("actionpicker")


@dataclass
class IngestReport:
    titles_added: int = 0
    scored: int = 0
    skipped: int = 0
    stopped_on_ratelimit: bool = False  # true when the run stopped early for any outage
    stop_reason: str = ""


def _gather_reviews(store, finder, fetcher, title: Title, name: str, season_id) -> list:
    try:
        urls = finder(name, title.year)
    except Exception as exc:  # noqa: BLE001 - third-party search errors vary; skip, do not crash
        log.warning("search failed for %s: %s", name, type(exc).__name__)
        urls = []
    for url in urls:
        text = fetcher.fetch(url)
        if text:
            store.add_review(title.id, season_id, url, text)
    return store.get_reviews(title.id, season_id)


def _process_title(store, tmdb, finder, fetcher, extractor, title: Title) -> bool:
    """Score every season (or the movie). Returns True when at least one score was saved."""
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
    return scored_any


def run_ingest(
    store: Store,
    tmdb,
    finder,
    fetcher,
    extractor,
    queries: list[str],
    limit: int = 30,
    min_votes: int = 0,
) -> IngestReport:
    """Discover titles, then fetch reviews and score up to `limit` pending titles."""
    report = IngestReport()
    before = store.title_count()
    for query in queries:
        try:
            for title in tmdb.discover(query):
                store.upsert_title(title)
        except RateLimitError as exc:
            report.stopped_on_ratelimit, report.stop_reason = True, f"TMDB: {exc}"
            break
        except TmdbError as exc:
            log.warning("discover %r failed: %s", query, exc)
    report.titles_added = store.title_count() - before

    for title in store.pending_titles(limit, min_votes):
        try:
            scored = _process_title(store, tmdb, finder, fetcher, extractor, title)
        except (RateLimitError, LlmError) as exc:
            report.stopped_on_ratelimit = True
            report.stop_reason = f"{type(exc).__name__}: {exc}"
            log.warning("stopping run: %s", report.stop_reason)
            break
        except Exception as exc:  # noqa: BLE001 - one bad title must not end the run
            log.warning("skip %s: %s", title.name, exc)
            scored = False
        if scored:
            report.scored += 1
        else:
            log.info("skip %s: no score produced (attempt will be counted)", title.name)
            report.skipped += 1
            store.bump_attempts(title.id)
    return report
