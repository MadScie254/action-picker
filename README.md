# ActionPicker

A private, zero-budget tool that finds and ranks hard-hitting martial-arts action and gritty
crime movies and series, then emails a weekly digest. Taste seeds: Ip Man 1-2, Sakra, John Wick
1-4, The Furious, Warrior, Into the Badlands (see `seed.yaml`).

Design: `docs/superpowers/specs/2026-11-05-action-picker-design.md`.
Plan: `docs/superpowers/plans/2026-11-05-action-picker.md`.

## How it works

1. `ingest` finds titles through TMDB, finds review pages through DuckDuckGo, fetches them politely,
   and asks a free-tier LLM to extract structured scores once per title or season.
2. `rank` scores them in plain code using `weights.yaml` (hand-to-hand and swordplay above gun-fu).
3. `digest` emails the top 5 movies, top 5 series and one crime pick, then never repeats them.

## Setup

```bash
pip install -e ".[dev]"
cp .env.example .env     # then fill in the keys
pytest
python -m actionpicker.cli ingest --limit 5     # try a small batch first
python -m actionpicker.cli rank
python -m actionpicker.cli digest --dry-run     # prints the email, sends nothing
```

Keys you need, all free: a TMDB API key, an LLM key (Gemini or Groq) or a local Ollama, and a
Gmail app password. Set `LLM_PROVIDER` and `LLM_MODEL` yourself.

## Verify before you trust it

- **LLM providers.** The Gemini, Groq and Ollama request shapes in `llm.py` were written from
  memory and tested only against mocks. Run one real `ingest --limit 2` and check it works.
- **Free tiers change.** Check each provider's current free limits and model names. There is no
  default `LLM_MODEL` on purpose.
- **Watch providers.** TMDB coverage for Kenya may be thin. Missing data shows as "unknown".
- **Golden test.** `tests/fixtures/seed_pool.json` holds author-estimated scores, not real
  extractions. Once the database has real data, re-tune with `python scripts/tune_weights.py`.

## Scraping etiquette

Personal use only. The fetcher obeys robots.txt, waits 2.5 seconds between requests, caches every
page, sends an honest User-Agent, and skips sites that block it. Blocked pages are remembered and
not requested again. Before each run commits the database, `compact` deletes the stored review
text of every scored title. Text for titles still waiting to be scored can remain in the
database, so keep the repository private.

## Weekly run on GitHub Actions

`.github/workflows/weekly.yml` runs Mondays at 05:17 UTC. Add these repository secrets:
`TMDB_API_KEY`, `LLM_API_KEY`, `SMTP_USER`, `SMTP_APP_PASSWORD`, `DIGEST_TO`, and these
repository variables: `LLM_PROVIDER`, `LLM_MODEL`. The SQLite database is pushed to a `data`
branch after each run (a single force-pushed commit). Keep the repository private.

## Attribution

This product uses the TMDB API but is not endorsed or certified by TMDB. Streaming availability
data comes from TMDB (provided by JustWatch).
