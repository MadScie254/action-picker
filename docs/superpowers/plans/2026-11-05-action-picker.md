# ActionPicker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A private, zero-budget tool that ingests, scores and ranks martial-arts action and crime movies and series from live web data, and emails a weekly digest.

**Architecture:** A weekly ingestion pipeline discovers titles (TMDB), fetches reviews politely (cached), and has a free-tier LLM extract structured scores once per title or season into SQLite. `rank.py` ranks in pure code. A digest job queries the database and emails new picks. A chat agent comes later (v1.1) and is not in this plan.

**Tech Stack:** Python 3.11, requests, beautifulsoup4, duckduckgo-search, pydantic v2, PyYAML, pytest, responses (HTTP mocking), ruff, SQLite, GitHub Actions, Gmail SMTP.

**Spec:** `docs/superpowers/specs/2026-11-05-action-picker-design.md`

## Global Constraints

- Budget is $0: TMDB API, DuckDuckGo search, requests + BeautifulSoup, SQLite, GitHub Actions, Gmail SMTP, free-tier LLM only.
- LLM behind one `complete_json(prompt, schema)` interface; providers gemini, groq, ollama (fallback).
- Python 3.11, type hints, pytest, ruff. No secrets in the repo; keys come from `.env` or GitHub secrets.
- Scraping: obey robots.txt, 2-3 s between requests, cache every page on disk, honest User-Agent, skip blocked sites. Personal use only.
- At most 30 new titles per ingest run; unfinished work resumes next run.
- Style factors: hand_to_hand, swordplay, wuxia 1.0; gun_fu 0.85; brawl 0.8; other 0.5.
- Default weights: fight_quality 0.35, action_density 0.20, grit 0.10, pacing 0.10, tmdb_rating_scaled 0.15, crime_tone 0.10. Crime mode: crime_tone 0.35, fight_quality 0.20.
- Hard filter: action_density >= 5. Series rank by best season. Seen and already-sent titles excluded by default.
- Where-to-watch comes from TMDB providers for region KE; when empty show "unknown", never guess.
- Digest: top 5 movies, top 5 series or seasons, 1 crime pick; send nothing when no new qualifying titles.

## Review Focus

- A review URL returns 403, a captcha page, or empty text: no crash, no score written, URL skipped and logged.
- LLM returns out-of-range numbers, wrong enum, or all nulls: result rejected, one retry, then title skipped.
- A title with zero reviews: no LLM call, never ranked.
- A series where only one season has scores: ranks by that season; a season with no data does not zero the series.
- Digest with fewer than 5 qualifying items per section, or none: partial email, or nothing sent.
- Re-running ingest on the same titles is idempotent (no duplicate rows, no repeated LLM calls).

## File Structure

```
pyproject.toml  .env.example  weights.yaml  seed.yaml  README.md
src/actionpicker/{models,store,llm,extract,rank,ingest,digest,cli}.py
src/actionpicker/sources/{tmdb,search,reviews}.py
scripts/tune_weights.py
tests/{test_store,test_tmdb,test_reviews,test_extract,test_rank,test_ingest,test_digest}.py
tests/fixtures/  .github/workflows/weekly.yml
```

---

### Task 1: Scaffold, models and store

**Files:**
- Create: `pyproject.toml`, `.env.example`, `.gitignore` (ignores `.env`, `cache/`, `*.db` except `data/`), `src/actionpicker/models.py`, `src/actionpicker/store.py`
- Test: `tests/test_store.py`

**Interfaces:**
- Produces (`models.py`): dataclasses `Title(id: int|None, tmdb_id: int, kind: str, name: str, year: int|None, overview: str, tmdb_rating: float, vote_count: int)`; `Review(url: str, text: str)`; `Scores(title_id: int, season_id: int|None, fight_quality: int|None, style: str, action_density: int|None, grit: int|None, crime_tone: int|None, pacing: int|None, review_count: int, evidence: list[dict], content_hash: str)`.
- Produces (`store.py`): `class Store(path: str)` with `upsert_title(t: Title) -> int`, `upsert_season(title_id: int, season_no: int) -> int`, `add_review(title_id: int, season_id: int|None, url: str, text: str) -> None`, `get_reviews(title_id: int, season_id: int|None) -> list[Review]`, `save_scores(s: Scores) -> None`, `get_scores(title_id: int, season_id: int|None) -> Scores|None`, `pending_titles(limit: int) -> list[Title]` (titles with no scores row), `all_scored() -> list[tuple[Title, Scores]]`, `mark_sent(title_id: int, season_id: int|None) -> None`, `sent_keys() -> set[tuple[int, int|None]]`, `seen_ids() -> set[int]`.

- [ ] **Step 1: Write failing tests** in `tests/test_store.py`: `test_upsert_title_is_idempotent` (same tmdb_id twice returns same id, one row), `test_pending_titles_excludes_scored`, `test_save_and_get_scores_roundtrip` (evidence list survives), `test_sent_keys_after_mark_sent`.
- [ ] **Step 2: Run** `pytest tests/test_store.py -v`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `models.py` and `store.py` with the schema from spec section 5 (tables titles, seasons, reviews, scores, seen, sent_log; unique on tmdb_id and on (title_id, season_id) for scores). Create `pyproject.toml` with the stack above and ruff config.
- [ ] **Step 4: Run** `pytest tests/test_store.py -v`. Expected: PASS.
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat: scaffold, models, sqlite store"`

### Task 2: TMDB source

**Files:**
- Create: `src/actionpicker/sources/tmdb.py`
- Test: `tests/test_tmdb.py`, `tests/fixtures/tmdb_*.json`

**Interfaces:**
- Consumes: `Title` (Task 1).
- Produces: `class TmdbSource(api_key: str, region: str = "KE", session: requests.Session | None = None)` with `discover(query: str) -> list[Title]` (searches movies and series), `seasons(tmdb_id: int) -> list[int]` (season numbers, specials excluded), `watch_providers(tmdb_id: int, kind: str) -> list[str]` (provider names for the region, `[]` if none).

- [ ] **Step 1: Write failing tests** using `responses` and saved fixtures: `test_discover_maps_movie_and_series`, `test_seasons_excludes_season_zero`, `test_watch_providers_region_ke`, `test_watch_providers_empty_returns_empty_list`, `test_http_429_raises_ratelimit_error`.
- [ ] **Step 2: Run** `pytest tests/test_tmdb.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** `TmdbSource` and a `RateLimitError`. One line: use TMDB v3 `search/multi`, `tv/{id}`, `{kind}/{id}/watch/providers`. Add the TMDB attribution line to the README later (Task 7).
- [ ] **Step 4: Run** `pytest tests/test_tmdb.py -v`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: tmdb source"` (after `git add`).

### Task 3: Review discovery and polite fetching

**Files:**
- Create: `src/actionpicker/sources/search.py`, `src/actionpicker/sources/reviews.py`
- Test: `tests/test_reviews.py`

**Interfaces:**
- Produces: `find_review_urls(name: str, year: int|None, limit: int = 5, ddgs=None) -> list[str]`; `class ReviewFetcher(cache_dir: str, delay: float = 2.5, user_agent: str = "ActionPicker/0.1 (personal use)", session=None)` with `fetch(url: str) -> str | None` returning cleaned article text, or `None` when robots.txt disallows, the status is not 200, the page is a captcha/empty, or text is under 200 characters.

- [ ] **Step 1: Write failing tests**: `test_fetch_respects_robots_disallow` (returns None, no GET to the page), `test_fetch_uses_disk_cache_second_call` (one HTTP call for two fetches), `test_fetch_403_returns_none`, `test_fetch_waits_delay_between_requests` (inject a fake clock/sleep), `test_find_review_urls_filters_non_http` (fake ddgs).
- [ ] **Step 2: Run** `pytest tests/test_reviews.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** both. Use `urllib.robotparser`, cache key = sha256 of URL, text extraction with BeautifulSoup (drop script/style/nav, join paragraphs).
- [ ] **Step 4: Run** `pytest tests/test_reviews.py -v`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: review search and polite fetcher"`

### Task 4: LLM interface and extraction

**Files:**
- Create: `src/actionpicker/llm.py`, `src/actionpicker/extract.py`
- Test: `tests/test_extract.py`

**Interfaces:**
- Consumes: `Title`, `Review`, `Scores` (Task 1).
- Produces: `complete_json(prompt: str, schema: dict, provider: str | None = None) -> dict` (provider from `LLM_PROVIDER` env: gemini, groq or ollama; retries with exponential backoff; raises `LlmError`); `extract_scores(title: Title, season_no: int | None, season_id: int | None, reviews: list[Review], llm=complete_json) -> Scores | None`. Returns `None` when `reviews` is empty or the result is invalid after one retry. `content_hash` = sha256 of the sorted review texts.

- [ ] **Step 1: Write failing tests** with a fake `llm` callable: `test_extract_valid_result_maps_to_scores`, `test_extract_rejects_out_of_range_then_retries_once`, `test_extract_invalid_after_retry_returns_none`, `test_extract_empty_reviews_makes_no_llm_call`, `test_extract_null_fields_preserved`, `test_extract_evidence_capped_at_two`.
- [ ] **Step 2: Run** `pytest tests/test_extract.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** a pydantic `ExtractionResult` (ints 0-10 or null, style enum from spec section 6, evidence max 2 with url) and a prompt instructing "never invent; return null when reviews do not support a field; paraphrase evidence in under 25 words". Implement `llm.py` provider adapters behind `complete_json`; no live calls in tests.
- [ ] **Step 4: Run** `pytest tests/test_extract.py -v`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: llm interface and score extraction"`

### Task 5: Ranking, weights and golden tests

**Files:**
- Create: `src/actionpicker/rank.py`, `weights.yaml`, `seed.yaml`, `scripts/tune_weights.py`
- Test: `tests/test_rank.py`, `tests/fixtures/seed_pool.json`

**Interfaces:**
- Consumes: `Title`, `Scores`.
- Produces: `load_weights(path: str) -> Weights`; `score(s: Scores, tmdb_rating: float, w: Weights, mode: str = "action") -> float` (mode `"action"` or `"crime"`); `rank(cands: list[tuple[Title, Scores]], w: Weights, mode: str = "action", exclude: set[tuple[int, int|None]] = frozenset()) -> list[Ranked]` where `Ranked(title: Title, scores: Scores, value: float)`. `rank` applies the action_density >= 5 filter, Bayesian shrinkage toward the pool mean (k = 5 reviews), and collapses a series to its best season.

- [ ] **Step 1: Write failing tests**: `test_style_factor_gun_fu_below_hand_to_hand`, `test_null_fields_treated_as_missing_not_zero` (missing fields drop out and weights renormalise), `test_low_action_density_filtered`, `test_shrinkage_demotes_low_review_count`, `test_series_ranks_by_best_season`, `test_series_with_one_scored_season_still_ranks`, `test_crime_mode_boosts_crime_tone`, `test_excluded_keys_removed`, and golden `test_seed_titles_in_top_15_percent` using `seed_pool.json` (seed titles plus decoys, scores hand-authored as fixtures and labelled as such).
- [ ] **Step 2: Run** `pytest tests/test_rank.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** `rank.py` with pure functions. Write `weights.yaml` from Global Constraints. Write `scripts/tune_weights.py`, a coordinate search over the weights that maximises how many seed titles land in the top 15% and writes the best weights back. One line: keep weights summing to 1.
- [ ] **Step 4: Run** `pytest tests/test_rank.py -v`, then `python scripts/tune_weights.py --check`. Expected: PASS and "all seeds in top 15%".
- [ ] **Step 5: Commit** `git commit -m "feat: ranking, weights, golden tests"`

### Task 6: Ingestion orchestration and CLI

**Files:**
- Create: `src/actionpicker/ingest.py`, `src/actionpicker/cli.py`
- Test: `tests/test_ingest.py`

**Interfaces:**
- Consumes: `Store`, `TmdbSource`, `find_review_urls`, `ReviewFetcher`, `extract_scores`, `rank`.
- Produces: `run_ingest(store: Store, tmdb: TmdbSource, finder, fetcher: ReviewFetcher, extractor, queries: list[str], limit: int = 30) -> IngestReport` where `IngestReport(titles_added: int, scored: int, skipped: int, stopped_on_ratelimit: bool)`; CLI commands `ingest`, `rank [--mode action|crime]`, `digest`, `show <title>`. Seed queries come from `seed.yaml`.

- [ ] **Step 1: Write failing tests** with fakes: `test_ingest_respects_limit_30`, `test_ingest_is_idempotent_second_run_no_llm_calls`, `test_ingest_skips_title_when_all_fetches_fail`, `test_ingest_stops_cleanly_on_ratelimit_and_keeps_progress`, `test_ingest_scores_each_season_for_series`.
- [ ] **Step 2: Run** `pytest tests/test_ingest.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** `run_ingest` and `cli.py` (argparse). Log skipped URLs and titles.
- [ ] **Step 4: Run** `pytest tests/test_ingest.py -v`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: ingestion orchestration and cli"`

### Task 7: Digest, workflow and README

**Files:**
- Create: `src/actionpicker/digest.py`, `.github/workflows/weekly.yml`, `README.md`
- Test: `tests/test_digest.py`

**Interfaces:**
- Consumes: `Store`, `rank`, `TmdbSource.watch_providers`.
- Produces: `build_digest(store: Store, w: Weights, providers: Callable[[Title], list[str]]) -> Digest | None` (`Digest` has `movies`, `series`, `crime_pick`; `None` when nothing qualifies); `render(d: Digest) -> tuple[str, str]` (plain text, html); `send(d: Digest, smtp: SmtpConfig) -> None` (also calls `store.mark_sent` for every item after a successful send).

- [ ] **Step 1: Write failing tests**: `test_build_digest_none_when_no_qualifying`, `test_build_digest_partial_when_fewer_than_five`, `test_providers_empty_renders_unknown`, `test_sent_items_not_repeated_next_week`, `test_render_includes_score_style_reason_link`, `test_send_marks_sent_only_after_success` (fake SMTP that raises).
- [ ] **Step 2: Run** `pytest tests/test_digest.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** `digest.py`. Write `weekly.yml`: weekly cron; check out the `data` branch for `actionpicker.db`; run `ingest` then `digest`; commit the db back to `data`; secrets TMDB_API_KEY, LLM_PROVIDER, LLM_API_KEY, SMTP_USER, SMTP_APP_PASSWORD, DIGEST_TO. Write `README.md` with setup steps, free-tier warning ("verify current limits"), scraping etiquette note, and the TMDB attribution notice.
- [ ] **Step 4: Run** `pytest -v` and `ruff check .`. Expected: all tests pass, ruff clean.
- [ ] **Step 5: Commit** `git commit -m "feat: weekly digest, workflow, readme"`

---

## Self-Review

- Spec coverage: sections 4-12 map to Tasks 1-7; section 13 risks are covered by swappable `llm.py`, skip-on-block fetcher and "unknown" providers. Chat agent and feedback loop are out of v1 by the spec.
- Types: `Title`, `Review`, `Scores`, `Ranked`, `Digest` names match across tasks.
- Every Review Focus line has a named test: Task 3 (403/captcha), Task 4 (range, nulls, empty reviews), Task 5 (one scored season), Task 6 (idempotency), Task 7 (partial and none).
