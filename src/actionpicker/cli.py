from __future__ import annotations

import argparse
import logging
import os
import re
import sys
from pathlib import Path

import yaml

from .rank import load_weights, rank
from .store import Store

_ROOT = Path(__file__).resolve().parent.parent.parent


def load_env(path: str) -> None:
    """Load KEY=VALUE lines into os.environ without overriding existing variables."""
    p = Path(path)
    if not p.exists():
        return
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = re.split(r"\s+#", value, maxsplit=1)[0].strip()
        if value:
            os.environ.setdefault(key.strip(), value)


def _cmd_rank(args, store: Store) -> int:
    w = load_weights(args.weights)
    exclude = {(i, None) for i in store.seen_ids()}
    for n, r in enumerate(rank(store.all_scored(), w, args.mode, exclude)[: args.top], start=1):
        season = f" S{r.scores.season_id}" if r.scores.season_id else ""
        print(f"{n:>2}. {r.value:5.2f}  {r.title.name}{season}  [{r.title.kind}, {r.scores.style}]")
    return 0


def _cmd_show(args, store: Store) -> int:
    titles = store.find_titles(args.name)
    if not titles:
        print(f"no title matching {args.name!r}", file=sys.stderr)
        return 1
    for t in titles:
        print(f"{t.name} ({t.year or '?'}) [{t.kind}]")
        for tt, s in store.all_scored():
            if tt.id != t.id:
                continue
            print(f"  season_id={s.season_id} style={s.style} reviews={s.review_count}")
            for f in ("fight_quality", "action_density", "grit", "crime_tone", "pacing"):
                print(f"    {f}: {getattr(s, f)}")
            for e in s.evidence:
                print(f"    - {e['text']} ({e['url']})")
    return 0


def _cmd_ingest(args, store: Store) -> int:
    from .extract import extract_scores
    from .ingest import run_ingest
    from .sources.reviews import ReviewFetcher
    from .sources.search import find_review_urls
    from .sources.tmdb import TmdbSource

    key = os.environ.get("TMDB_API_KEY", "")
    if not key:
        print("TMDB_API_KEY is not set (see .env.example)", file=sys.stderr)
        return 2
    seed = yaml.safe_load(Path(args.seed).read_text(encoding="utf-8"))
    queries = list(seed.get("seeds", [])) + list(seed.get("discover_queries", []))
    tmdb = TmdbSource(key, region=os.environ.get("REGION", "KE"))
    fetcher = ReviewFetcher(cache_dir=args.cache)
    min_votes = load_weights(args.weights).min_votes
    report = run_ingest(
        store, tmdb, find_review_urls, fetcher, extract_scores, queries, args.limit, min_votes
    )
    print(report)
    return 0


def _cmd_digest(args, store: Store) -> int:
    import requests

    from .digest import SmtpConfig, build_digest, render, send
    from .sources.tmdb import RateLimitError, TmdbSource

    cfg = None
    if not args.dry_run:
        user = os.environ.get("SMTP_USER", "")
        pw = os.environ.get("SMTP_APP_PASSWORD", "")
        to = os.environ.get("DIGEST_TO", "")
        if not (user and pw and to):
            print("SMTP_USER, SMTP_APP_PASSWORD and DIGEST_TO must be set", file=sys.stderr)
            return 2
        cfg = SmtpConfig(user, pw, to)
    key = os.environ.get("TMDB_API_KEY", "")
    providers = lambda t: []
    if key and not args.dry_run:
        tmdb = TmdbSource(key, region=os.environ.get("REGION", "KE"))

        def providers(t):
            try:
                return tmdb.watch_providers(t.tmdb_id, t.kind)
            except (RateLimitError, requests.RequestException):
                return []  # shown as "unknown", never guessed

    digest = build_digest(store, load_weights(args.weights), providers)
    if digest is None:
        print("nothing new to send")
        return 0
    if args.dry_run:
        print(render(digest)[0])
        return 0
    send(digest, cfg, store)
    print("digest sent")
    return 0


def _cmd_compact(args, store: Store) -> int:
    print(f"removed {store.purge_scored_reviews()} stored reviews of scored titles")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="actionpicker")
    ap.add_argument("--env", default=".env")
    ap.add_argument("--db", default=None)
    ap.add_argument("--weights", default=str(_ROOT / "weights.yaml"))
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_rank = sub.add_parser("rank")
    p_rank.add_argument("--mode", choices=["action", "crime"], default="action")
    p_rank.add_argument("--top", type=int, default=20)
    p_rank.set_defaults(fn=_cmd_rank)

    p_show = sub.add_parser("show")
    p_show.add_argument("name")
    p_show.set_defaults(fn=_cmd_show)

    p_dig = sub.add_parser("digest")
    p_dig.add_argument("--dry-run", action="store_true")
    p_dig.set_defaults(fn=_cmd_digest)

    p_cmp = sub.add_parser("compact")
    p_cmp.set_defaults(fn=_cmd_compact)

    p_ing = sub.add_parser("ingest")
    p_ing.add_argument("--limit", type=int, default=30)
    p_ing.add_argument("--seed", default=str(_ROOT / "seed.yaml"))
    p_ing.add_argument("--cache", default="cache/pages")
    p_ing.set_defaults(fn=_cmd_ingest)

    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    load_env(args.env)
    store = Store(args.db or os.environ.get("DB_PATH", "actionpicker.db"))
    return args.fn(args, store)


if __name__ == "__main__":
    raise SystemExit(main())
