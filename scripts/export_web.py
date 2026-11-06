"""Export the current rankings to web/data.json for the static Vercel page.

Usage: python scripts/export_web.py [--db actionpicker.db] [--weights weights.yaml]
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from actionpicker.rank import load_weights, rank
from actionpicker.store import Store


def build(db: str, weights_path: str, top: int = 50) -> dict:
    store = Store(db)
    w = load_weights(weights_path)
    out: dict = {"generated": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    for mode in ("action", "crime"):
        rows = []
        for r in rank(store.all_scored(), w, mode, set())[:top]:
            s, t = r.scores, r.title
            season = store.season_no(s.season_id) if s.season_id else None
            rows.append(
                {
                    "name": t.name,
                    "year": t.year,
                    "kind": t.kind,
                    "season": season,
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
                }
            )
        out[mode] = rows
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="actionpicker.db")
    ap.add_argument("--weights", default="weights.yaml")
    ap.add_argument("--out", default="web/data.json")
    args = ap.parse_args()
    data = build(args.db, args.weights)
    path = Path(args.out)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {path} ({len(data['action'])} action, {len(data['crime'])} crime)")


if __name__ == "__main__":
    main()
