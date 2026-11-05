from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

import yaml

from .models import Scores, Title

_FIELDS = ("fight_quality", "action_density", "grit", "pacing", "crime_tone")


@dataclass
class Weights:
    action: dict[str, float]
    crime: dict[str, float]
    style_factor: dict[str, float]
    min_action_density: int
    shrinkage_k: float


@dataclass
class Ranked:
    title: Title
    scores: Scores
    value: float


def load_weights(path: str) -> Weights:
    with open(path, encoding="utf-8") as fh:
        raw = yaml.safe_load(fh)
    return Weights(
        action=dict(raw["action"]),
        crime=dict(raw["crime"]),
        style_factor=dict(raw["style_factor"]),
        min_action_density=int(raw["min_action_density"]),
        shrinkage_k=float(raw["shrinkage_k"]),
    )


def score(s: Scores, tmdb_rating: float, w: Weights, mode: str = "action") -> float:
    """Weighted 0-10 score. Missing (None) fields drop out and the weights renormalise."""
    weights = w.crime if mode == "crime" else w.action
    parts = {f: getattr(s, f) / 10 for f in _FIELDS if getattr(s, f) is not None}
    if tmdb_rating and tmdb_rating > 0:
        parts["tmdb_rating"] = min(tmdb_rating, 10.0) / 10
    used = {k: weights[k] for k in parts if k in weights}
    total = sum(used.values())
    if total == 0:
        return 0.0
    base = sum(used[k] * parts[k] for k in used) / total * 10
    return base * w.style_factor.get(s.style, w.style_factor["other"])


def rank(
    cands: Iterable[tuple[Title, Scores]],
    w: Weights,
    mode: str = "action",
    exclude: frozenset | set = frozenset(),
) -> list[Ranked]:
    """Filter, shrink toward the pool mean, collapse each series to its best season, sort."""
    pool: list[tuple[Title, Scores, float]] = []
    for title, s in cands:
        if (title.id, s.season_id) in exclude or (title.id, None) in exclude:
            continue
        if s.action_density is None or s.action_density < w.min_action_density:
            continue
        pool.append((title, s, score(s, title.tmdb_rating, w, mode)))
    if not pool:
        return []
    mean = sum(v for _, _, v in pool) / len(pool)
    k = w.shrinkage_k
    best: dict[int, Ranked] = {}
    for title, s, v in pool:
        shrunk = (s.review_count * v + k * mean) / (s.review_count + k)
        current = best.get(title.id)
        if current is None or shrunk > current.value:
            best[title.id] = Ranked(title, s, shrunk)
    return sorted(best.values(), key=lambda r: (-r.value, r.title.name))
