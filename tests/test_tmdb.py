import json
from pathlib import Path

import pytest
import responses

from actionpicker.sources.tmdb import RateLimitError, TmdbSource

FIX = Path(__file__).parent / "fixtures"
BASE = "https://api.themoviedb.org/3"


def load(name: str) -> dict:
    return json.loads((FIX / name).read_text())


@responses.activate
def test_discover_maps_movie_and_series():
    responses.add(responses.GET, f"{BASE}/search/multi", json=load("tmdb_search.json"))
    titles = TmdbSource("k").discover("ip man")
    assert [(t.tmdb_id, t.kind, t.name, t.year) for t in titles] == [
        (11, "movie", "Ip Man 2", 2010),
        (22, "series", "Warrior", 2019),
        (44, "movie", "No Date Film", None),
    ]
    assert titles[0].tmdb_rating == 7.3 and titles[0].vote_count == 1800


@responses.activate
def test_seasons_excludes_season_zero():
    responses.add(responses.GET, f"{BASE}/tv/22", json=load("tmdb_tv.json"))
    assert TmdbSource("k").seasons(22) == [1, 2, 3]


@responses.activate
def test_watch_providers_region_ke():
    responses.add(responses.GET, f"{BASE}/tv/22/watch/providers", json=load("tmdb_providers.json"))
    assert TmdbSource("k", region="KE").watch_providers(22, "series") == ["Netflix", "Showmax"]


@responses.activate
def test_watch_providers_empty_returns_empty_list():
    responses.add(responses.GET, f"{BASE}/movie/11/watch/providers", json={"id": 11, "results": {}})
    assert TmdbSource("k").watch_providers(11, "movie") == []


@responses.activate
def test_http_429_raises_ratelimit_error():
    responses.add(responses.GET, f"{BASE}/search/multi", status=429)
    with pytest.raises(RateLimitError):
        TmdbSource("k").discover("anything")
