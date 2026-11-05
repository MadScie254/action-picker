"""Check or tune the ranking weights against the golden seed pool.

  python scripts/tune_weights.py --check   # report whether all seeds are in the top 15%
  python scripts/tune_weights.py --write   # tune the action weights and rewrite weights.yaml
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

import yaml

from actionpicker.golden import build_pool, seeds_in_top_fraction, tune_weights
from actionpicker.rank import load_weights


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--pool", default=str(ROOT / "tests" / "fixtures" / "seed_pool.json"))
    args = ap.parse_args()
    weights_path = ROOT / "weights.yaml"
    w = load_weights(str(weights_path))
    cands, seeds = build_pool(args.pool)
    if args.write:
        w = tune_weights(cands, seeds, w)
        raw = yaml.safe_load(weights_path.read_text())
        raw["action"] = {k: round(v, 4) for k, v in w.action.items()}
        weights_path.write_text(yaml.safe_dump(raw, sort_keys=False))
        print("weights.yaml updated")
    hits, total, missing = seeds_in_top_fraction(cands, seeds, w)
    if missing:
        print(f"FAIL: {hits}/{total} seeds in top 15%; outside: {', '.join(missing)}")
        return 1
    print(f"all seeds in top 15% ({hits}/{total})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
