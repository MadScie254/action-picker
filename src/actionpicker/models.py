from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Title:
    id: int | None
    tmdb_id: int
    kind: str  # "movie" | "series"
    name: str
    year: int | None
    overview: str
    tmdb_rating: float
    vote_count: int


@dataclass
class Review:
    url: str
    text: str


@dataclass
class Scores:
    title_id: int
    season_id: int | None
    fight_quality: int | None
    style: str
    action_density: int | None
    grit: int | None
    crime_tone: int | None
    pacing: int | None
    review_count: int
    evidence: list[dict] = field(default_factory=list)
    content_hash: str = ""
