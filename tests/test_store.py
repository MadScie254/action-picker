from actionpicker.models import Scores, Title
from actionpicker.store import Store


def make_title(
    tmdb_id: int = 1, kind: str = "movie", name: str = "Ip Man", vote_count: int = 3000
) -> Title:
    return Title(None, tmdb_id, kind, name, 2008, "overview", 8.0, vote_count)


def make_scores(title_id: int, season_id: int | None = None) -> Scores:
    return Scores(
        title_id=title_id,
        season_id=season_id,
        fight_quality=9,
        style="hand_to_hand",
        action_density=8,
        grit=6,
        crime_tone=2,
        pacing=7,
        review_count=5,
        evidence=[{"text": "great wing chun", "url": "https://x.test/a"}],
        content_hash="h1",
    )


def test_pending_titles_skips_titles_below_min_votes():
    store = Store(":memory:")
    store.upsert_title(make_title(tmdb_id=1, vote_count=3))
    store.upsert_title(make_title(tmdb_id=2, vote_count=500))
    assert len(store.pending_titles(limit=10)) == 2
    kept = store.pending_titles(limit=10, min_votes=25)
    assert [t.tmdb_id for t in kept] == [2]


def test_upsert_title_is_idempotent():
    store = Store(":memory:")
    first = store.upsert_title(make_title(tmdb_id=10))
    second = store.upsert_title(make_title(tmdb_id=10))
    assert first == second
    assert len(store.pending_titles(limit=10)) == 1


def test_pending_titles_excludes_scored():
    store = Store(":memory:")
    a = store.upsert_title(make_title(tmdb_id=1, name="A"))
    store.upsert_title(make_title(tmdb_id=2, name="B"))
    store.save_scores(make_scores(a))
    names = [t.name for t in store.pending_titles(limit=10)]
    assert names == ["B"]


def test_pending_titles_respects_limit():
    store = Store(":memory:")
    for i in range(5):
        store.upsert_title(make_title(tmdb_id=i))
    assert len(store.pending_titles(limit=3)) == 3


def test_save_and_get_scores_roundtrip():
    store = Store(":memory:")
    tid = store.upsert_title(make_title())
    store.save_scores(make_scores(tid))
    got = store.get_scores(tid, None)
    assert got is not None
    assert got.fight_quality == 9
    assert got.evidence == [{"text": "great wing chun", "url": "https://x.test/a"}]


def test_save_scores_twice_without_season_keeps_one_row():
    store = Store(":memory:")
    tid = store.upsert_title(make_title())
    store.save_scores(make_scores(tid))
    updated = make_scores(tid)
    updated.fight_quality = 4
    store.save_scores(updated)
    assert len(store.all_scored()) == 1
    assert store.get_scores(tid, None).fight_quality == 4


def test_scores_per_season_are_separate():
    store = Store(":memory:")
    tid = store.upsert_title(make_title(kind="series", name="Warrior"))
    s1 = store.upsert_season(tid, 1)
    s2 = store.upsert_season(tid, 2)
    assert s1 != s2 and store.upsert_season(tid, 1) == s1
    store.save_scores(make_scores(tid, s1))
    store.save_scores(make_scores(tid, s2))
    assert len(store.all_scored()) == 2


def test_reviews_roundtrip_and_deduplicate_by_url():
    store = Store(":memory:")
    tid = store.upsert_title(make_title())
    store.add_review(tid, None, "https://x.test/r1", "text one")
    store.add_review(tid, None, "https://x.test/r1", "text one")
    reviews = store.get_reviews(tid, None)
    assert [(r.url, r.text) for r in reviews] == [("https://x.test/r1", "text one")]


def test_sent_keys_after_mark_sent():
    store = Store(":memory:")
    tid = store.upsert_title(make_title())
    assert store.sent_keys() == set()
    store.mark_sent(tid, None)
    store.mark_sent(tid, None)
    assert store.sent_keys() == {(tid, None)}


def test_seen_ids_empty_by_default():
    assert Store(":memory:").seen_ids() == set()


def test_title_count():
    store = Store(":memory:")
    assert store.title_count() == 0
    store.upsert_title(make_title(tmdb_id=1))
    store.upsert_title(make_title(tmdb_id=1))
    store.upsert_title(make_title(tmdb_id=2))
    assert store.title_count() == 2


def test_bump_attempts_demotes_then_drops_title():
    store = Store(":memory:")
    a = store.upsert_title(make_title(tmdb_id=1, name="A"))
    store.upsert_title(make_title(tmdb_id=2, name="B"))
    store.bump_attempts(a)
    assert [t.name for t in store.pending_titles(10)] == ["B", "A"]
    store.bump_attempts(a)
    store.bump_attempts(a)
    assert [t.name for t in store.pending_titles(10)] == ["B"]


def test_find_titles_matches_substring_case_insensitive():
    store = Store(":memory:")
    store.upsert_title(make_title(tmdb_id=1, name="Into the Badlands"))
    store.upsert_title(make_title(tmdb_id=2, name="Warrior"))
    assert [t.name for t in store.find_titles("badlands")] == ["Into the Badlands"]


def test_purge_scored_reviews_removes_only_scored_titles_reviews():
    store = Store(":memory:")
    done = store.upsert_title(make_title(tmdb_id=1, name="Done"))
    todo = store.upsert_title(make_title(tmdb_id=2, name="Todo"))
    store.add_review(done, None, "https://x.test/d", "scraped text")
    store.add_review(todo, None, "https://x.test/t", "scraped text")
    store.save_scores(make_scores(done))
    assert store.purge_scored_reviews() == 1
    assert store.get_reviews(done, None) == []
    assert len(store.get_reviews(todo, None)) == 1
