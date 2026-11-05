# ActionPicker: Design Spec

Date: 2026-11-05
Status: draft for review
Owner: Daniel

## 1. Purpose

A private, zero-budget tool that finds and ranks the best hard-hitting martial-arts action and gritty crime movies and TV series, using live web data and review text. It emails a weekly digest of new picks, and later answers questions in chat.

Success: a weekly email of top picks that match Daniel's taste (Ip Man 1-2, Sakra, John Wick 1-4, The Furious, Warrior, Into the Badlands), each with a score, style, a one-line reason from real reviews, and where to watch. The seed titles must all rank in the top slice.

## 2. Scope

In v1: ingestion, LLM extraction, ranking, golden tests, weekly email digest (B), CLI.
Later: chat agent (A, v1.1), "seen it" feedback loop (v1.2).
Parked: public website (C). Reason: each visitor would cost LLM and search calls, and scraping for a public product breaks site terms.

## 3. Constraints

- Budget is $0. Free tiers only: TMDB API, DuckDuckGo search, requests + BeautifulSoup (Playwright only if needed), SQLite, GitHub Actions, Gmail SMTP.
- LLM is a free-tier provider (Gemini or Groq) behind a swappable interface. Ollama is the fallback. Free-tier limits and terms must be checked before committing to a provider.
- Scraping is personal use only: obey robots.txt, 2-3 s between requests, cache every page, honest User-Agent, skip blocked sites.
- No secrets in the repo.
- Series are first-class. Seasons are scored separately, and a series ranks by its best season.

## 4. Architecture

| Unit | Responsibility | Depends on |
|---|---|---|
| sources/tmdb.py | metadata, ratings, watch providers (region KE) | TMDB API |
| sources/search.py | candidate and review-page discovery | DuckDuckGo |
| sources/reviews.py | polite fetch, parse, disk cache | requests, bs4 |
| llm.py | complete_json(prompt, schema), retry, backoff, provider switch | provider SDK |
| extract.py | review text to validated structured scores, cached by content hash | llm.py |
| store.py | SQLite access | sqlite3 |
| rank.py | pure scoring and ranking functions, no I/O | weights.yaml |
| digest.py | query, render and send weekly email | store, rank, SMTP |
| cli.py | commands: ingest, rank, digest, show | all above |
| agent.py (v1.1) | tool loop over the database with live-search fallback | store, rank, sources |

All sources sit behind one Source interface so they can be swapped or disabled.

## 5. Data model (SQLite)

- titles(id, tmdb_id, kind, name, year, overview, tmdb_rating, vote_count)
- seasons(id, title_id, season_no)
- reviews(id, title_id, season_id, url, fetched_at, text_hash, text)
- scores(id, title_id, season_id, fight_quality, style, action_density, grit, crime_tone, pacing, review_count, evidence_json, extracted_at, content_hash)
- seen(title_id, rating_1_5)
- sent_log(title_id, season_id, sent_at)

`kind` is movie or series. A season's row in `scores` has season_id set.

## 6. Extraction

One LLM call per title or season, skipped when content_hash is unchanged. Output is JSON validated against a schema:

- fight_quality, action_density, grit, crime_tone, pacing: integers 0-10, or null if reviews do not support them
- style: hand_to_hand, swordplay, wuxia, gun_fu, brawl, mixed, other
- review_count: number of reviews analysed
- evidence: up to two short paraphrased snippets with source URLs

Invalid JSON is retried once, then the title is skipped and logged.

## 7. Ranking

Starting weights, all in `weights.yaml`:

score = 0.35 fight_quality + 0.20 action_density + 0.10 grit + 0.10 pacing + 0.15 tmdb_rating_scaled + 0.10 crime_tone

Then multiply by a style factor: hand_to_hand, swordplay, wuxia 1.0; gun_fu 0.85; brawl 0.8; other 0.5.

- Bayesian shrinkage toward the global mean for titles with few reviews.
- Hard filter: action_density >= 5.
- Crime mode: crime_tone 0.35 and fight_quality 0.20.
- Seen and already-sent titles are excluded by default.
- Weights are tuned with a small search so all seed titles land in the top slice. Golden tests lock this in. Later, 1-5 "seen it" ratings nudge the weights.

Limit: fight quality comes from review text, not video. Obscure titles with little coverage are scored cautiously.

## 8. Digest (B)

- GitHub Actions cron, weekly, private repo.
- Gmail SMTP with an app password stored as a repo secret.
- Content: top 5 movies, top 5 series or seasons, 1 crime pick. Each entry has score, style, one-line reason, where to watch ("unknown" when TMDB has no data for KE, never a guess), and a link.
- Everything sent is written to sent_log.
- The SQLite file is committed back to a `data` branch after each run because runners are ephemeral.

## 9. Ingestion limits

At most 30 new titles per run. Unfinished work resumes next run. The database fills over a few weeks.

## 10. Failure handling

- Rate limit: exponential backoff, then stop the run cleanly and resume next time.
- Invalid LLM JSON: retry once, then skip and log.
- Source failure or block: skip that source, continue the run.
- Digest with no new qualifying titles: send nothing and log.

## 11. Testing

- rank.py golden tests on the seed titles.
- Extraction against saved review fixtures. No live calls in tests.
- Scraper: robots.txt and cache behaviour (mocked).
- Digest renders with empty and full data.

## 12. Config

`.env` for TMDB, LLM and SMTP keys (never committed). `weights.yaml`. `seed.yaml` for reference titles. Region setting, default KE.

## 13. Risks

- Free-tier LLM limits or terms can change. Mitigation: swappable llm.py, Ollama fallback, heavy caching.
- Scraping targets can block or change layout. Mitigation: skip on failure, Source interface, cache.
- Watch-provider coverage for Kenya may be thin. Mitigation: show "unknown".
