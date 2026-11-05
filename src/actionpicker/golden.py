"""Golden pool helpers: used by tests and scripts/tune_weights.py.

The seed pool JSON holds the reference titles plus a few strong decoys. Weak decoys are
generated deterministically so the pool is large enough for a meaningful top-15% check.
"""
from __future__ import annotations

import copy
import json
import math
import random

from .models import Scores, Title
from .rank import Weights, rank

_STYLES = ["other"] * 5 + ["brawl"] * 3 + ["mixed"] * 3 + ["gun_fu"] * 2 + ["hand_to_hand"]


def _scores(title_id: int, season_id: int | None, d: dict) -> Scores:
    d = dict(d)
    return Scores(
        title_id=title_id,
        season_id=season_id,
        fight_quality=d["fight_quality"],
        style=d["style"],
        action_density=d["action_density"],
        grit=d["grit"],
        crime_tone=d["crime_tone"],
        pacing=d["pacing"],
        review_count=d["review_count"],
        evidence=[],
        content_hash="fixture",
    )


def make_decoys(start_id: int, n: int, seed: int = 7) -> list[tuple[Title, Scores]]:
    rng = random.Random(seed)
    out = []
    for i in range(n):
        tid = start_id + i
        title = Title(tid, 90000 + tid, "movie", f"Decoy {i}", 2015, "", rng.uniform(4.5, 7.5), 400)
        s = Scores(
            tid, None, rng.randint(2, 7), rng.choice(_STYLES), rng.randint(3, 8),
            rng.randint(2, 7), rng.randint(0, 8), rng.randint(3, 8), rng.randint(3, 25), [], "fixture",
        )
        out.append((title, s))
    return out


def build_pool(path: str, total: int = 80) -> tuple[list[tuple[Title, Scores]], set[str]]:
    with open(path, encoding="utf-8") as fh:
        entries = [e for e in json.load(fh) if "name" in e]
    cands: list[tuple[Title, Scores]] = []
    seeds: set[str] = set()
    for i, e in enumerate(entries, start=1):
        title = Title(i, 1000 + i, e["kind"], e["name"], 2020, "", e["tmdb_rating"], e["vote_count"])
        if e.get("seed"):
            seeds.add(e["name"])
        if "seasons" in e:
            for season in e["seasons"]:
                cands.append((title, _scores(i, 100 * i + season["n"], season["scores"])))
        else:
            cands.append((title, _scores(i, None, e["scores"])))
    cands.extend(make_decoys(len(entries) + 1, total - len(entries)))
    return cands, seeds


def seeds_in_top_fraction(
    cands, seeds: set[str], w: Weights, fraction: float = 0.15, mode: str = "action"
) -> tuple[int, int, list[str]]:
    titles = {t.id for t, _ in cands}
    cutoff = math.ceil(fraction * len(titles))
    top = {r.title.name for r in rank(cands, w, mode)[:cutoff]}
    missing = sorted(seeds - top)
    return len(seeds) - len(missing), len(seeds), missing


def seed_objective(cands, seeds: set[str], w: Weights, fraction: float = 0.15) -> tuple[int, float]:
    """(seeds inside the top fraction, negative mean seed rank): higher is better."""
    hits, _, _ = seeds_in_top_fraction(cands, seeds, w, fraction)
    ranked = [r.title.name for r in rank(cands, w)]
    positions = [ranked.index(n) + 1 if n in ranked else len(ranked) + 1 for n in seeds]
    return hits, -sum(positions) / max(len(positions), 1)


def tune_weights(
    cands, seeds: set[str], w: Weights, fraction: float = 0.15, step: float = 0.05, rounds: int = 3
) -> Weights:
    """Coordinate search over the action-mode weights. Returns a new Weights, never worse."""
    best = copy.deepcopy(w)
    best_obj = seed_objective(cands, seeds, best, fraction)
    for _ in range(rounds):
        improved = False
        for key in list(best.action):
            for delta in (step, -step):
                trial = copy.deepcopy(best)
                trial.action[key] = max(0.0, trial.action[key] + delta)
                total = sum(trial.action.values())
                if total == 0:
                    continue
                trial.action = {k: v / total for k, v in trial.action.items()}
                obj = seed_objective(cands, seeds, trial, fraction)
                if obj > best_obj:
                    best, best_obj, improved = trial, obj, True
        if not improved:
            break
    return best
