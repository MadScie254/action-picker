from __future__ import annotations

import json
import sqlite3

from .models import Review, Scores, Title

SCHEMA = """
CREATE TABLE IF NOT EXISTS titles (
  id INTEGER PRIMARY KEY,
  tmdb_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  year INTEGER,
  overview TEXT NOT NULL DEFAULT '',
  tmdb_rating REAL NOT NULL DEFAULT 0,
  vote_count INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  UNIQUE (tmdb_id, kind)
);
CREATE TABLE IF NOT EXISTS seasons (
  id INTEGER PRIMARY KEY,
  title_id INTEGER NOT NULL REFERENCES titles(id),
  season_no INTEGER NOT NULL,
  UNIQUE (title_id, season_no)
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY,
  title_id INTEGER NOT NULL REFERENCES titles(id),
  season_id INTEGER REFERENCES seasons(id),
  url TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  text_hash TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_reviews
  ON reviews (title_id, COALESCE(season_id, 0), url);
CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY,
  title_id INTEGER NOT NULL REFERENCES titles(id),
  season_id INTEGER REFERENCES seasons(id),
  fight_quality INTEGER, style TEXT NOT NULL, action_density INTEGER,
  grit INTEGER, crime_tone INTEGER, pacing INTEGER,
  review_count INTEGER NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  extracted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  content_hash TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_scores
  ON scores (title_id, COALESCE(season_id, 0));
CREATE TABLE IF NOT EXISTS seen (
  title_id INTEGER PRIMARY KEY REFERENCES titles(id),
  rating_1_5 INTEGER
);
CREATE TABLE IF NOT EXISTS sent_log (
  id INTEGER PRIMARY KEY,
  title_id INTEGER NOT NULL REFERENCES titles(id),
  season_id INTEGER REFERENCES seasons(id),
  sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sent
  ON sent_log (title_id, COALESCE(season_id, 0));
"""

_TITLE_COLS = "t.id, t.tmdb_id, t.kind, t.name, t.year, t.overview, t.tmdb_rating, t.vote_count"
_SCORE_COLS = (
    "s.title_id, s.season_id, s.fight_quality, s.style, s.action_density, s.grit, "
    "s.crime_tone, s.pacing, s.review_count, s.evidence_json, s.content_hash"
)


def _title(row: sqlite3.Row | tuple) -> Title:
    return Title(*row)


def _scores(row: sqlite3.Row | tuple) -> Scores:
    r = list(row)
    r[9] = json.loads(r[9])
    return Scores(*r)


class Store:
    def __init__(self, path: str) -> None:
        self.db = sqlite3.connect(path)
        self.db.executescript(SCHEMA)

    def upsert_title(self, t: Title) -> int:
        with self.db:
            self.db.execute(
                "INSERT INTO titles (tmdb_id, kind, name, year, overview, tmdb_rating, vote_count) "
                "VALUES (?,?,?,?,?,?,?) ON CONFLICT (tmdb_id, kind) DO UPDATE SET "
                "name=excluded.name, year=excluded.year, overview=excluded.overview, "
                "tmdb_rating=excluded.tmdb_rating, vote_count=excluded.vote_count",
                (t.tmdb_id, t.kind, t.name, t.year, t.overview, t.tmdb_rating, t.vote_count),
            )
        row = self.db.execute(
            "SELECT id FROM titles WHERE tmdb_id=? AND kind=?", (t.tmdb_id, t.kind)
        ).fetchone()
        return row[0]

    def upsert_season(self, title_id: int, season_no: int) -> int:
        with self.db:
            self.db.execute(
                "INSERT OR IGNORE INTO seasons (title_id, season_no) VALUES (?,?)",
                (title_id, season_no),
            )
        return self.db.execute(
            "SELECT id FROM seasons WHERE title_id=? AND season_no=?", (title_id, season_no)
        ).fetchone()[0]

    def add_review(self, title_id: int, season_id: int | None, url: str, text: str) -> None:
        with self.db:
            self.db.execute(
                "INSERT OR IGNORE INTO reviews (title_id, season_id, url, text) VALUES (?,?,?,?)",
                (title_id, season_id, url, text),
            )

    def get_reviews(self, title_id: int, season_id: int | None) -> list[Review]:
        rows = self.db.execute(
            "SELECT url, text FROM reviews WHERE title_id=? AND COALESCE(season_id,0)=? ORDER BY id",
            (title_id, season_id or 0),
        ).fetchall()
        return [Review(*r) for r in rows]

    def save_scores(self, s: Scores) -> None:
        with self.db:
            self.db.execute(
                "INSERT OR REPLACE INTO scores (title_id, season_id, fight_quality, style, "
                "action_density, grit, crime_tone, pacing, review_count, evidence_json, "
                "content_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (s.title_id, s.season_id, s.fight_quality, s.style, s.action_density, s.grit,
                 s.crime_tone, s.pacing, s.review_count, json.dumps(s.evidence), s.content_hash),
            )

    def get_scores(self, title_id: int, season_id: int | None) -> Scores | None:
        row = self.db.execute(
            f"SELECT {_SCORE_COLS} FROM scores s "
            "WHERE s.title_id=? AND COALESCE(s.season_id,0)=?",
            (title_id, season_id or 0),
        ).fetchone()
        return _scores(row) if row else None

    def pending_titles(self, limit: int, min_votes: int = 0) -> list[Title]:
        rows = self.db.execute(
            f"SELECT {_TITLE_COLS} FROM titles t "
            "WHERE NOT EXISTS (SELECT 1 FROM scores s WHERE s.title_id=t.id) "
            "AND t.attempts < 3 AND COALESCE(t.vote_count, 0) >= ? "
            "ORDER BY t.attempts, t.id LIMIT ?",
            (min_votes, limit),
        ).fetchall()
        return [_title(r) for r in rows]

    def bump_attempts(self, title_id: int) -> None:
        with self.db:
            self.db.execute("UPDATE titles SET attempts = attempts + 1 WHERE id=?", (title_id,))

    def purge_scored_reviews(self) -> int:
        """Delete stored review text for titles that already have scores (keeps the db small)."""
        with self.db:
            cur = self.db.execute(
                "DELETE FROM reviews WHERE title_id IN (SELECT title_id FROM scores)"
            )
        self.db.execute("VACUUM")
        return cur.rowcount

    def season_no(self, season_id: int | None) -> int | None:
        if season_id is None:
            return None
        row = self.db.execute("SELECT season_no FROM seasons WHERE id=?", (season_id,)).fetchone()
        return row[0] if row else None

    def title_count(self) -> int:
        return self.db.execute("SELECT COUNT(*) FROM titles").fetchone()[0]

    def find_titles(self, name_part: str) -> list[Title]:
        rows = self.db.execute(
            f"SELECT {_TITLE_COLS} FROM titles t WHERE LOWER(t.name) LIKE ? ORDER BY t.name",
            (f"%{name_part.lower()}%",),
        ).fetchall()
        return [_title(r) for r in rows]

    def all_scored(self) -> list[tuple[Title, Scores]]:
        rows = self.db.execute(
            f"SELECT {_TITLE_COLS}, {_SCORE_COLS} FROM scores s JOIN titles t ON t.id=s.title_id "
            "ORDER BY t.id, s.season_id"
        ).fetchall()
        return [(_title(r[:8]), _scores(r[8:])) for r in rows]

    def mark_sent(self, title_id: int, season_id: int | None) -> None:
        with self.db:
            self.db.execute(
                "INSERT OR IGNORE INTO sent_log (title_id, season_id) VALUES (?,?)",
                (title_id, season_id),
            )

    def sent_keys(self) -> set[tuple[int, int | None]]:
        rows = self.db.execute("SELECT title_id, season_id FROM sent_log").fetchall()
        return {(r[0], r[1]) for r in rows}

    def seen_ids(self) -> set[int]:
        return {r[0] for r in self.db.execute("SELECT title_id FROM seen").fetchall()}
