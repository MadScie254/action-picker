from pathlib import Path

from actionpicker.models import Scores, Title
from actionpicker.rank import load_weights
from actionpicker.store import Store
from actionpicker.webexport import build, shape_details

ROOT = Path(__file__).resolve().parent.parent
W = load_weights(str(ROOT / "weights.yaml"))

RAW_MOVIE = {
    "poster_path": "/p.jpg",
    "backdrop_path": "/b.jpg",
    "runtime": 106,
    "tagline": "Respect the master",
    "genres": [{"name": "Action"}, {"name": "Drama"}],
    "videos": {
        "results": [
            {"site": "Vimeo", "type": "Trailer", "key": "v1"},
            {"site": "YouTube", "type": "Teaser", "key": "t1"},
            {"site": "YouTube", "type": "Trailer", "key": "yt1", "official": True},
        ]
    },
    "watch/providers": {
        "results": {
            "US": {
                "link": "https://tmdb.test/us",
                "flatrate": [{"provider_name": "Netflix"}],
                "rent": [{"provider_name": "Apple TV"}],
            }
        }
    },
}


def test_shape_details_picks_poster_trailer_and_genres():
    d = shape_details(RAW_MOVIE, "KE")
    assert d["poster"] == "/p.jpg" and d["backdrop"] == "/b.jpg"
    assert d["runtime"] == 106 and d["genres"] == ["Action", "Drama"]
    assert d["trailer"] == "yt1"


def test_shape_details_falls_back_to_us_providers_and_says_so():
    d = shape_details(RAW_MOVIE, "KE")
    assert d["watch"]["region"] == "US"
    assert d["watch"]["stream"] == ["Netflix"] and d["watch"]["rent"] == ["Apple TV"]


def test_shape_details_prefers_requested_region():
    raw = {**RAW_MOVIE}
    raw["watch/providers"] = {
        "results": {
            **RAW_MOVIE["watch/providers"]["results"],
            "KE": {"flatrate": [{"provider_name": "Showmax"}]},
        }
    }
    d = shape_details(raw, "KE")
    assert d["watch"]["region"] == "KE" and d["watch"]["stream"] == ["Showmax"]


def test_shape_details_survives_empty_response():
    d = shape_details({}, "KE")
    assert d["poster"] is None and d["trailer"] is None and d["watch"] is None
    assert d["genres"] == []


def _scored_store() -> Store:
    store = Store(":memory:")
    for i, name in ((1, "Ip Man"), (2, "Thin Short")):
        votes = 900 if i == 1 else 2
        tid = store.upsert_title(Title(None, 100 + i, "movie", name, 2008, "ov", 8.0, votes))
        store.save_scores(
            Scores(tid, None, 9, "hand_to_hand", 8, 6, 2, 7, 5,
                   [{"text": "great wing chun", "url": "https://x.test/a"}], "h")
        )
    return store


def test_build_includes_details_and_drops_low_vote_titles():
    calls = []

    def fetch(tmdb_id, kind):
        calls.append((tmdb_id, kind))
        return RAW_MOVIE

    out = build(_scored_store(), W, fetch, region="KE")
    assert [r["name"] for r in out["action"]] == ["Ip Man"]
    assert out["action"][0]["poster"] == "/p.jpg"
    assert out["crime"][0]["name"] == "Ip Man"
    assert calls == [(101, "movie")]  # fetched once even though it is in both modes


def test_build_keeps_titles_when_details_fetch_fails():
    out = build(_scored_store(), W, lambda *_: None, region="KE")
    assert out["action"][0]["name"] == "Ip Man" and out["action"][0]["poster"] is None
