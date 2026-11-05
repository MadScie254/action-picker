import json
from pathlib import Path

import pytest
import requests
import responses

from actionpicker.sources.tmdb import RateLimitError, TmdbError, TmdbSource

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


@responses.activate
def test_http_error_raises_tmdb_error_without_leaking_api_key():
    responses.add(responses.GET, f"{BASE}/search/multi", status=500)
    with pytest.raises(TmdbError) as info:
        TmdbSource("SECRETKEY").discover("x")
    assert "SECRETKEY" not in str(info.value) and "500" in str(info.value)


@responses.activate
def test_connection_error_raises_tmdb_error_without_leaking_api_key():
    responses.add(
        responses.GET, f"{BASE}/tv/5",
        body=requests.ConnectionError("failed for url ?api_key=SECRETKEY"),
    )
    with pytest.raises(TmdbError) as info:
        TmdbSource("SECRETKEY").seasons(5)
    assert "SECRETKEY" not in str(info.value)
    assert "SECRETKEY" not in repr(info.value.__cause__)


def test_ratelimit_error_is_a_tmdb_error():
    assert issubclass(RateLimitError, TmdbError)
