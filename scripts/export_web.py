"""Export the current rankings (with TMDB art, trailers, providers) to web/data.json.

Usage: python scripts/export_web.py [--db actionpicker.db] [--weights weights.yaml]
Needs TMDB_API_KEY in the environment or .env. Details are cached in cache/tmdb_details.json.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import requests

from actionpicker.cli import load_env
from actionpicker.rank import load_weights
from actionpicker.store import Store
from actionpicker.webexport import build

API = "https://api.themoviedb.org/3"


def make_fetcher(api_key: str, cache_path: Path):
    cache: dict = {}
    if cache_path.exists():
        cache = json.loads(cache_path.read_text(encoding="utf-8"))
    session = requests.Session()

    def fetch(tmdb_id: int, kind: str) -> dict | None:
        key = f"{kind}:{tmdb_id}"
        if key in cache:
            return cache[key]
        path = "tv" if kind == "series" else "movie"
        try:
            resp = session.get(
                f"{API}/{path}/{tmdb_id}",
                params={"api_key": api_key, "append_to_response": "videos,watch/providers"},
                timeout=20,
            )
        except requests.RequestException as exc:
            print(f"details {key}: {type(exc).__name__}")  # no URL: it contains the key
            return None
        if resp.status_code != 200:
            print(f"details {key}: HTTP {resp.status_code}")
            return None
        cache[key] = resp.json()
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps(cache), encoding="utf-8")
        return cache[key]

    return fetch


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--env", default=".env")
    ap.add_argument("--db", default="actionpicker.db")
    ap.add_argument("--weights", default="weights.yaml")
    ap.add_argument("--out", default="web/data.json")
    ap.add_argument("--cache", default="cache/tmdb_details.json")
    args = ap.parse_args()
    load_env(args.env)
    key = os.environ.get("TMDB_API_KEY", "")
    if not key:
        raise SystemExit("TMDB_API_KEY is not set")
    data = build(
        Store(args.db),
        load_weights(args.weights),
        make_fetcher(key, Path(args.cache)),
        region=os.environ.get("REGION", "KE"),
    )
    path = Path(args.out)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {path} ({len(data['action'])} action, {len(data['crime'])} crime)")


if __name__ == "__main__":
    main()
