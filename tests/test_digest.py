from datetime import UTC, datetime
from typing import ClassVar

import pytest

from actionpicker.digest import SmtpConfig, build_digest, render, send
from actionpicker.models import Scores, Title
from actionpicker.rank import load_weights
from actionpicker.store import Store

W = load_weights(str(__import__("pathlib").Path(__file__).resolve().parent.parent / "weights.yaml"))
NO_PROVIDERS = lambda t: []


def add(store, i, kind="movie", name=None, fq=8, ad=8, crime=2, seasons=None):
    tid = store.upsert_title(Title(None, i, kind, name or f"Title {i}", 2020, "", 7.5, 500))
    for sid in seasons or [None]:
        season_id = store.upsert_season(tid, sid) if sid else None
        store.save_scores(Scores(tid, season_id, fq, "hand_to_hand", ad, 7, crime, 7, 20,
                                 [{"text": "superb choreography", "url": "https://x.test/r"}], "h"))
    return tid


class FakeSmtp:
    sent: ClassVar[list] = []
    fail: ClassVar[bool] = False

    def __init__(self, host, port):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def login(self, user, password):
        pass

    def send_message(self, msg):
        if FakeSmtp.fail:
            raise OSError("smtp down")
        FakeSmtp.sent.append(msg)


@pytest.fixture(autouse=True)
def reset_smtp():
    FakeSmtp.sent, FakeSmtp.fail = [], False


CFG = SmtpConfig(user="me@gmail.com", password="app-pw", to="me@gmail.com")


def test_build_digest_none_when_store_empty():
    assert build_digest(Store(":memory:"), W, NO_PROVIDERS) is None


def test_build_digest_none_when_nothing_qualifies():
    store = Store(":memory:")
    add(store, 1, ad=3)
    assert build_digest(store, W, NO_PROVIDERS) is None


def test_build_digest_partial_when_fewer_than_five():
    store = Store(":memory:")
    add(store, 1)
    add(store, 2)
    add(store, 3, kind="series", seasons=[1])
    d = build_digest(store, W, NO_PROVIDERS)
    assert len(d.movies) == 2 and len(d.series) == 1


def test_build_digest_caps_each_section_at_five():
    store = Store(":memory:")
    for i in range(8):
        add(store, i + 1)
    assert len(build_digest(store, W, NO_PROVIDERS).movies) == 5


def test_crime_pick_is_not_a_duplicate_of_listed_titles():
    store = Store(":memory:")
    for i in range(6):
        add(store, i + 1, crime=9, fq=9 - (i % 2))
    d = build_digest(store, W, NO_PROVIDERS)
    listed = {it.ranked.title.id for it in d.movies + d.series}
    assert d.crime_pick is not None and d.crime_pick.ranked.title.id not in listed


def test_seen_titles_are_excluded():
    store = Store(":memory:")
    a, b = add(store, 1, name="Seen One"), add(store, 2, name="Fresh")
    with store.db:
        store.db.execute("INSERT INTO seen (title_id, rating_1_5) VALUES (?, 5)", (a,))
    names = [it.ranked.title.name for it in build_digest(store, W, NO_PROVIDERS).movies]
    assert names == ["Fresh"] and b


def test_providers_empty_renders_unknown_and_never_guesses():
    store = Store(":memory:")
    add(store, 1)
    text, html = render(build_digest(store, W, NO_PROVIDERS))
    assert "Where to watch: unknown" in text and "unknown" in html


def test_providers_listed_when_available():
    store = Store(":memory:")
    add(store, 1)
    text, _ = render(build_digest(store, W, lambda t: ["Netflix", "Showmax"]))
    assert "Where to watch: Netflix, Showmax" in text


def test_render_includes_score_style_reason_link_and_attribution():
    store = Store(":memory:")
    add(store, 1, name="Ip Man")
    text, _ = render(build_digest(store, W, NO_PROVIDERS))
    assert "Ip Man" in text and "hand_to_hand" in text and "superb choreography" in text
    assert "https://www.themoviedb.org/movie/1" in text
    assert "TMDB" in text and "JustWatch" in text


def test_render_escapes_html_in_titles():
    store = Store(":memory:")
    add(store, 1, name="<script>alert(1)</script>")
    _, html = render(build_digest(store, W, NO_PROVIDERS))
    assert "<script>" not in html and "&lt;script&gt;" in html


def test_send_marks_sent_only_after_success():
    store = Store(":memory:")
    tid = add(store, 1)
    d = build_digest(store, W, NO_PROVIDERS)
    FakeSmtp.fail = True
    with pytest.raises(OSError):
        send(d, CFG, store, smtp_factory=FakeSmtp)
    assert store.sent_keys() == set()
    FakeSmtp.fail = False
    send(d, CFG, store, smtp_factory=FakeSmtp)
    assert store.sent_keys() == {(tid, None)} and len(FakeSmtp.sent) == 1
    assert datetime.now(tz=UTC).date().isoformat() in FakeSmtp.sent[0]["Subject"]


def test_sent_items_not_repeated_next_week_and_series_not_resurfaced():
    store = Store(":memory:")
    add(store, 1, name="Movie A")
    add(store, 2, kind="series", name="Show", seasons=[1, 2])
    send(build_digest(store, W, NO_PROVIDERS), CFG, store, smtp_factory=FakeSmtp)
    assert build_digest(store, W, NO_PROVIDERS) is None


def test_series_item_names_best_season():
    store = Store(":memory:")
    tid = store.upsert_title(Title(None, 9, "series", "Warrior", 2019, "", 8.2, 900))
    for n, fq in ((1, 6), (2, 9)):
        sid = store.upsert_season(tid, n)
        store.save_scores(Scores(tid, sid, fq, "hand_to_hand", 8, 7, 2, 7, 20, [], "h"))
    d = build_digest(store, W, NO_PROVIDERS)
    assert d.series[0].season_no == 2
    text, _ = render(d)
    assert "Warrior (2019) - Season 2" in text
