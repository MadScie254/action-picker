from actionpicker.extract import compute_content_hash, extract_scores
from actionpicker.ingest import run_ingest
from actionpicker.llm import LlmError, LlmOutputError
from actionpicker.models import Scores, Title
from actionpicker.sources.tmdb import RateLimitError, TmdbError
from actionpicker.store import Store


def movie(i: int) -> Title:
    return Title(None, i, "movie", f"Movie {i}", 2020, "", 7.0, 100)


class FakeTmdb:
    def __init__(self, by_query, seasons=None, fail_on=None, fail_exc=None, seasons_exc=None):
        self.by_query, self._seasons, self.fail_on = by_query, seasons or {}, fail_on
        self.fail_exc, self.seasons_exc = fail_exc, seasons_exc

    def discover(self, query):
        if query == self.fail_on:
            raise self.fail_exc or RateLimitError("429")
        return list(self.by_query.get(query, []))

    def seasons(self, tmdb_id):
        if self.seasons_exc:
            raise self.seasons_exc
        return self._seasons.get(tmdb_id, [])


class FakeFinder:
    def __init__(self):
        self.names: list[str] = []

    def __call__(self, name, year):
        self.names.append(name)
        return [f"https://x.test/{name.replace(' ', '-')}"]


class FakeFetcher:
    def __init__(self, ok=True):
        self.ok = ok
        self.calls = 0

    def fetch(self, url):
        self.calls += 1
        return ("review text for " + url) if self.ok else None


class FakeExtractor:
    def __init__(self, fail_after=None):
        self.calls: list[tuple] = []
        self.fail_after = fail_after

    def __call__(self, title, season_no, season_id, reviews):
        if self.fail_after is not None and len(self.calls) >= self.fail_after:
            raise LlmError("quota")
        self.calls.append((title.name, season_no, season_id))
        return Scores(title.id, season_id, 8, "hand_to_hand", 8, 7, 3, 7, len(reviews), [],
                      compute_content_hash(reviews))


def ingest(store, tmdb, extractor=None, fetcher=None, finder=None, queries=("q",), limit=30):
    return run_ingest(store, tmdb, finder or FakeFinder(), fetcher or FakeFetcher(),
                      extractor or FakeExtractor(), list(queries), limit=limit)


def test_ingest_respects_limit_30():
    store, ex = Store(":memory:"), FakeExtractor()
    tmdb = FakeTmdb({"q": [movie(i) for i in range(50)]})
    report = ingest(store, tmdb, ex)
    assert len(ex.calls) == 30 and report.scored == 30
    assert report.titles_added == 50
    assert len(store.pending_titles(100)) == 20


def test_ingest_is_idempotent_second_run_no_llm_calls():
    store, ex = Store(":memory:"), FakeExtractor()
    tmdb = FakeTmdb({"q": [movie(1), movie(2), movie(3)]})
    ingest(store, tmdb, ex)
    second = ingest(store, tmdb, ex)
    assert len(ex.calls) == 3
    assert second.scored == 0 and second.titles_added == 0
    assert store.title_count() == 3 and len(store.all_scored()) == 3


def test_ingest_skips_title_when_all_fetches_fail_and_gives_up_after_three_runs():
    store, ex = Store(":memory:"), FakeExtractor()
    tmdb = FakeTmdb({"q": [movie(1)]})
    report = ingest(store, tmdb, ex, FakeFetcher(ok=False))
    assert report.skipped == 1 and report.scored == 0 and ex.calls == []
    assert len(store.pending_titles(10)) == 1
    ingest(store, tmdb, ex, FakeFetcher(ok=False))
    ingest(store, tmdb, ex, FakeFetcher(ok=False))
    assert store.pending_titles(10) == []


def test_ingest_stops_cleanly_on_ratelimit_and_keeps_progress():
    store, ex = Store(":memory:"), FakeExtractor()
    tmdb = FakeTmdb({"a": [movie(1), movie(2)], "b": [movie(3)]}, fail_on="b")
    report = ingest(store, tmdb, ex, queries=("a", "b"))
    assert report.stopped_on_ratelimit is True
    assert store.title_count() == 2 and report.scored == 2


def test_ingest_stops_on_llm_outage_without_penalising_titles():
    store = Store(":memory:")
    tmdb = FakeTmdb({"q": [movie(1), movie(2), movie(3)]})
    report = ingest(store, tmdb, FakeExtractor(fail_after=1))
    assert report.stopped_on_ratelimit is True and report.scored == 1
    assert len(store.pending_titles(10)) == 2
    again = ingest(store, tmdb, FakeExtractor())
    assert again.scored == 2 and store.pending_titles(10) == []


def test_ingest_scores_each_season_for_series():
    store, ex, finder = Store(":memory:"), FakeExtractor(), FakeFinder()
    show = Title(None, 22, "series", "Warrior", 2019, "", 8.2, 900)
    tmdb = FakeTmdb({"q": [show]}, seasons={22: [1, 2]})
    ingest(store, tmdb, ex, finder=finder)
    seasons = [(c[1], c[2]) for c in ex.calls]
    assert [s[0] for s in seasons] == [1, 2] and len({s[1] for s in seasons}) == 2
    assert len(store.all_scored()) == 2
    assert any("season 1" in n for n in finder.names) and any("season 2" in n for n in finder.names)


def test_ingest_skips_title_whose_llm_reply_is_never_valid_and_continues():
    store = Store(":memory:")
    tmdb = FakeTmdb({"q": [movie(1), movie(2)]})

    def llm(prompt, schema):
        if "Movie 1 " in prompt:
            raise LlmOutputError("not json")
        return {"fight_quality": 8, "style": "hand_to_hand", "action_density": 8,
                "grit": 7, "crime_tone": 2, "pacing": 7, "evidence": []}

    report = ingest(store, tmdb, lambda t, n, sid, revs: extract_scores(t, n, sid, revs, llm=llm))
    assert report.scored == 1 and report.skipped == 1
    assert report.stopped_on_ratelimit is False
    assert [t.name for t in store.pending_titles(10)] == ["Movie 1"]


def test_ingest_survives_finder_exception():
    store, ex = Store(":memory:"), FakeExtractor()
    tmdb = FakeTmdb({"q": [movie(1), movie(2)]})
    calls = {"n": 0}

    def finder(name, year):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("duckduckgo ratelimit")
        return ["https://x.test/ok"]

    report = ingest(store, tmdb, ex, finder=finder)
    assert report.scored == 1 and report.skipped == 1 and not report.stopped_on_ratelimit


def test_ingest_survives_tmdb_error_on_one_discover_query():
    store, ex = Store(":memory:"), FakeExtractor()
    tmdb = FakeTmdb({"a": [movie(1)], "b": [movie(2)]}, fail_on="a", fail_exc=TmdbError("HTTP 500"))
    report = ingest(store, tmdb, ex, queries=("a", "b"))
    assert report.scored == 1 and report.stopped_on_ratelimit is False


def test_ingest_series_seasons_error_skips_title_and_continues():
    store, ex = Store(":memory:"), FakeExtractor()
    show = Title(None, 22, "series", "Gone Show", 2019, "", 8.0, 100)
    tmdb = FakeTmdb({"q": [show, movie(1)]}, seasons_exc=TmdbError("HTTP 404"))
    report = ingest(store, tmdb, ex)
    assert report.scored == 1 and report.skipped == 1
    assert [c[0] for c in ex.calls] == ["Movie 1"]


def test_ingest_reports_stop_reason_when_llm_fails():
    store = Store(":memory:")
    report = ingest(store, FakeTmdb({"q": [movie(1)]}), FakeExtractor(fail_after=0))
    assert report.stopped_on_ratelimit is True and "quota" in report.stop_reason


def test_ingest_logs_each_skipped_title(caplog):
    store = Store(":memory:")
    with caplog.at_level("INFO", logger="actionpicker"):
        ingest(store, FakeTmdb({"q": [movie(1)]}), fetcher=FakeFetcher(ok=False))
    assert "Movie 1" in caplog.text and "skip" in caplog.text.lower()
