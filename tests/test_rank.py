from pathlib import Path

import pytest

from actionpicker.golden import build_pool, seeds_in_top_fraction
from actionpicker.models import Scores, Title
from actionpicker.rank import load_weights, rank, score

ROOT = Path(__file__).resolve().parent.parent
W = load_weights(str(ROOT / "weights.yaml"))
POOL_FILE = str(ROOT / "tests" / "fixtures" / "seed_pool.json")


def sc(title_id=1, season_id=None, style="hand_to_hand", n=20, **kw) -> Scores:
    base = {"fight_quality": 8, "action_density": 8, "grit": 8, "crime_tone": 8, "pacing": 8}
    base.update(kw)
    return Scores(title_id, season_id, style=style, review_count=n, evidence=[], content_hash="h", **base)


def ti(i=1, kind="movie", name=None, rating=8.0) -> Title:
    return Title(i, 1000 + i, kind, name or f"T{i}", 2020, "", rating, 500)


def test_weights_file_sums_to_one_per_mode():
    assert sum(W.action.values()) == pytest.approx(1.0)
    assert sum(W.crime.values()) == pytest.approx(1.0)


def test_style_factor_gun_fu_below_hand_to_hand():
    hand = score(sc(style="hand_to_hand"), 8.0, W)
    gun = score(sc(style="gun_fu"), 8.0, W)
    assert gun == pytest.approx(hand * 0.85)


def test_null_fields_treated_as_missing_not_zero():
    present = score(sc(grit=8), 8.0, W)
    missing = score(sc(grit=None), 8.0, W)
    zero = score(sc(grit=0), 8.0, W)
    assert missing == pytest.approx(present)  # all other fields are 8, so renormalising keeps 8.0
    assert missing > zero


def test_titles_with_too_few_votes_are_filtered_out():
    thin = Title(1, 1001, "movie", "Featurette", 2015, "", 7.0, 3)
    cands = [(thin, sc(1)), (ti(2), sc(2))]
    assert W.min_votes > 3
    assert [r.title.id for r in rank(cands, W)] == [2]


def test_low_action_density_filtered():
    cands = [(ti(1), sc(1, action_density=4)), (ti(2), sc(2, action_density=5))]
    assert [r.title.id for r in rank(cands, W)] == [2]


def test_null_action_density_filtered():
    assert rank([(ti(1), sc(1, action_density=None))], W) == []


def test_shrinkage_demotes_low_review_count():
    weak = [(ti(i), sc(i, fight_quality=4, action_density=6, grit=4, crime_tone=2, pacing=4)) for i in (3, 4, 5)]
    few = (ti(1), sc(1, n=2))
    many = (ti(2), sc(2, n=40))
    ranked = rank([few, many, *weak], W)
    assert [r.title.id for r in ranked[:2]] == [2, 1]
    assert ranked[0].value > ranked[1].value


def test_series_ranks_by_best_season():
    series = ti(1, kind="series", name="Show")
    cands = [
        (series, sc(1, season_id=10, fight_quality=6)),
        (series, sc(1, season_id=11, fight_quality=9)),
    ]
    ranked = rank(cands, W)
    assert len(ranked) == 1 and ranked[0].scores.season_id == 11


def test_series_with_one_scored_season_still_ranks():
    series = ti(1, kind="series", name="Show")
    ranked = rank([(series, sc(1, season_id=10))], W)
    assert len(ranked) == 1 and ranked[0].scores.season_id == 10


def test_crime_mode_boosts_crime_tone():
    action_first = (ti(1), sc(1, fight_quality=10, crime_tone=2))
    crime_first = (ti(2), sc(2, fight_quality=7, crime_tone=9))
    assert rank([action_first, crime_first], W, "action")[0].title.id == 1
    assert rank([action_first, crime_first], W, "crime")[0].title.id == 2


def test_excluded_keys_removed():
    series = ti(2, kind="series", name="Show")
    cands = [(ti(1), sc(1)), (series, sc(2, season_id=7)), (ti(3), sc(3))]
    ids = {r.title.id for r in rank(cands, W, exclude={(1, None)})}
    assert ids == {2, 3}
    ids = {r.title.id for r in rank(cands, W, exclude={(1, None), (2, 7)})}
    assert ids == {3}
    ids = {r.title.id for r in rank(cands, W, exclude={(2, None)})}
    assert ids == {1, 3}


def test_seed_titles_in_top_15_percent():
    cands, seeds = build_pool(POOL_FILE)
    assert len(cands) >= 80
    hits, total, missing = seeds_in_top_fraction(cands, seeds, W, fraction=0.15)
    assert not missing, f"seeds outside top 15%: {missing}"
    assert hits == total == len(seeds)


def test_tune_weights_never_worse_and_sums_to_one():
    from copy import deepcopy

    from actionpicker.golden import seed_objective, tune_weights

    cands, seeds = build_pool(POOL_FILE)
    start = deepcopy(W)
    start.action = {"fight_quality": 0.0, "action_density": 0.0, "grit": 0.0,
                    "pacing": 0.0, "tmdb_rating": 0.5, "crime_tone": 0.5}
    tuned = tune_weights(cands, seeds, start)
    assert seed_objective(cands, seeds, tuned) >= seed_objective(cands, seeds, start)
    assert sum(tuned.action.values()) == pytest.approx(1.0)
    assert start.action["tmdb_rating"] == 0.5  # input not mutated
