"""Build the JSON the website serves: ranked titles plus TMDB art, trailer and where-to-watch."""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime

from .rank import Weights, rank
from .store import Store

_FALLBACK_REGION = "US"


def _names(entries: list | None) -> list[str]:
    return [e["provider_name"] for e in entries or [] if e.get("provider_name")]


def _watch(raw: dict, region: str) -> dict | None:
    results = (raw.get("watch/providers") or {}).get("results") or {}
    for code in (region, _FALLBACK_REGION):
        entry = results.get(code)
        if entry and (entry.get("flatrate") or entry.get("rent") or entry.get("buy")):
            return {
                "region": code,
                "stream": _names(entry.get("flatrate")),
                "rent": _names(entry.get("rent")),
                "buy": _names(entry.get("buy")),
                "link": entry.get("link"),
            }
    return None


def _trailer(raw: dict) -> str | None:
    vids = [
        v
        for v in (raw.get("videos") or {}).get("results") or []
        if v.get("site") == "YouTube" and v.get("type") == "Trailer" and v.get("key")
    ]
    vids.sort(key=lambda v: not v.get("official"))
    return vids[0]["key"] if vids else None


def shape_details(raw: dict, region: str) -> dict:
    """Reduce a TMDB details response to the few fields the site uses."""
    runtime = raw.get("runtime")
    if runtime is None and raw.get("episode_run_time"):
        runtime = raw["episode_run_time"][0]
    return {
        "poster": raw.get("poster_path"),
        "backdrop": raw.get("backdrop_path"),
        "runtime": runtime,
        "tagline": raw.get("tagline") or "",
        "genres": [g["name"] for g in raw.get("genres") or [] if g.get("name")],
        "trailer": _trailer(raw),
        "watch": _watch(raw, region),
    }


def build(
    store: Store,
    weights: Weights,
    fetch_details: Callable[[int, str], dict | None],
    region: str = "KE",
    top: int = 40,
) -> dict:
    """Rank in both modes and attach TMDB details (fetched once per title)."""
    details: dict[tuple[int, str], dict] = {}

    def details_for(tmdb_id: int, kind: str) -> dict:
        key = (tmdb_id, kind)
        if key not in details:
            raw = fetch_details(tmdb_id, kind)
            details[key] = shape_details(raw, region) if raw else shape_details({}, region)
        return details[key]

    out: dict = {"generated": datetime.now(UTC).isoformat(timespec="seconds"), "region": region}
    scored = store.all_scored()
    for mode in ("action", "crime"):
        rows = []
        for r in rank(scored, weights, mode, set())[:top]:
            s, t = r.scores, r.title
            rows.append(
                {
                    "name": t.name,
                    "year": t.year,
                    "kind": t.kind,
                    "season": store.season_no(s.season_id) if s.season_id else None,
                    "value": round(r.value, 2),
                    "style": s.style,
                    "tmdb_rating": t.tmdb_rating,
                    "overview": t.overview,
                    "fight_quality": s.fight_quality,
                    "action_density": s.action_density,
                    "grit": s.grit,
                    "pacing": s.pacing,
                    "crime_tone": s.crime_tone,
                    "reviews": s.review_count,
                    "evidence": [{"text": e["text"], "url": e["url"]} for e in s.evidence[:3]],
                    **details_for(t.tmdb_id, t.kind),
                }
            )
        out[mode] = rows
    return out
