from __future__ import annotations

import requests

from ..models import Title

BASE = "https://api.themoviedb.org/3"


class TmdbError(Exception):
    """A TMDB call failed. The message never contains the API key."""


class RateLimitError(TmdbError):
    """TMDB answered 429."""


def _year(date: str | None) -> int | None:
    return int(date[:4]) if date and len(date) >= 4 and date[:4].isdigit() else None


class TmdbSource:
    def __init__(
        self, api_key: str, region: str = "KE", session: requests.Session | None = None
    ) -> None:
        self.api_key = api_key
        self.region = region
        self.session = session or requests.Session()

    def _get(self, path: str, **params: str) -> dict:
        try:
            resp = self.session.get(
                f"{BASE}{path}", params={"api_key": self.api_key, **params}, timeout=15
            )
        except requests.RequestException as exc:
            # requests puts the full URL, api_key included, in its messages: drop it.
            raise TmdbError(f"{type(exc).__name__} calling TMDB {path}") from None
        if resp.status_code == 429:
            raise RateLimitError("TMDB rate limit reached")
        if resp.status_code >= 400:
            raise TmdbError(f"HTTP {resp.status_code} from TMDB {path}")
        return resp.json()

    def discover(self, query: str) -> list[Title]:
        titles: list[Title] = []
        for r in self._get("/search/multi", query=query).get("results", []):
            media = r.get("media_type")
            if media == "movie":
                name, date, kind = r.get("title", ""), r.get("release_date"), "movie"
            elif media == "tv":
                name, date, kind = r.get("name", ""), r.get("first_air_date"), "series"
            else:
                continue
            titles.append(
                Title(
                    None, r["id"], kind, name, _year(date), r.get("overview", ""),
                    float(r.get("vote_average") or 0), int(r.get("vote_count") or 0),
                )
            )
        return titles

    def seasons(self, tmdb_id: int) -> list[int]:
        data = self._get(f"/tv/{tmdb_id}")
        return [s["season_number"] for s in data.get("seasons", []) if s["season_number"] > 0]

    def watch_providers(self, tmdb_id: int, kind: str) -> list[str]:
        media = "tv" if kind == "series" else "movie"
        region = self._get(f"/{media}/{tmdb_id}/watch/providers").get("results", {})
        entry = region.get(self.region, {})
        names: list[str] = []
        for bucket in ("flatrate", "free", "ads"):
            for p in entry.get(bucket, []):
                if p["provider_name"] not in names:
                    names.append(p["provider_name"])
        return names
