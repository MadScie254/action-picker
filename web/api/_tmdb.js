// Live TMDB lookups for the chat. Files starting with "_" are not routed by Vercel.
// The API key never appears in a thrown error, a log line or a response.
const BASE = "https://api.themoviedb.org/3";

const MOVIE_GENRES = {
  action: 28, adventure: 12, crime: 80, thriller: 53, drama: 18, war: 10752, western: 37,
  mystery: 9648, scifi: 878, comedy: 35, animation: 16, horror: 27, history: 36, fantasy: 14,
};
const TV_GENRES = {
  action: 10759, adventure: 10759, crime: 80, thriller: 9648, drama: 18, war: 10768, western: 37,
  mystery: 9648, scifi: 10765, comedy: 35, animation: 16, horror: 9648, history: 18, fantasy: 10765,
};
const MAX_CANDIDATES = 24;

function iso(d) {
  return d.toISOString().slice(0, 10);
}

async function get(fetchImpl, key, path, params) {
  const qs = new URLSearchParams({ api_key: key, language: "en-US", include_adult: "false", ...params });
  try {
    const r = await fetchImpl(`${BASE}${path}?${qs}`);
    if (!r || !r.ok) return null;
    return await r.json();
  } catch (_) {
    return null;
  }
}

function yearOf(row) {
  const d = row.release_date || row.first_air_date || "";
  return d ? Number(d.slice(0, 4)) : null;
}

function toCandidate(row, kindHint) {
  const kind = row.media_type === "tv" || kindHint === "tv" ? "series" : "movie";
  const name = row.title || row.name;
  if (!name || row.adult) return null;
  return {
    id: row.id,
    kind,
    name,
    year: yearOf(row),
    overview: String(row.overview || "").slice(0, 220),
    rating: typeof row.vote_average === "number" ? Math.round(row.vote_average * 10) / 10 : null,
    votes: row.vote_count || 0,
    poster: row.poster_path || null,
    backdrop: row.backdrop_path || null,
  };
}

function cleanPlan(plan) {
  const p = plan && typeof plan === "object" ? plan : {};
  const strs = (v, n) => (Array.isArray(v) ? v : []).filter((x) => typeof x === "string" && x.trim()).slice(0, n).map((x) => x.trim().slice(0, 60));
  const yr = (v) => (Number.isInteger(v) && v >= 1900 && v <= 2100 ? v : null);
  return {
    queries: strs(p.queries, 3),
    titles: strs(p.titles, 3),
    similarTo: typeof p.similar_to === "string" && p.similar_to.trim() ? p.similar_to.trim().slice(0, 60) : null,
    genres: strs(p.genres, 4).map((g) => g.toLowerCase()),
    kind: ["movie", "tv", "any"].includes(p.kind) ? p.kind : "any",
    yearFrom: yr(p.year_from),
    yearTo: yr(p.year_to),
    sort: ["popular", "new", "rated"].includes(p.sort) ? p.sort : "popular",
  };
}

async function keywordIds(fetchImpl, key, query) {
  const j = await get(fetchImpl, key, "/search/keyword", { query });
  return ((j && j.results) || []).slice(0, 2).map((k) => k.id);
}

async function discover(fetchImpl, key, plan, today) {
  const out = [];
  const ids = [];
  for (const q of plan.queries) ids.push(...(await keywordIds(fetchImpl, key, q)));
  const kinds = plan.kind === "any" ? ["movie", "tv"] : [plan.kind];
  const from = plan.yearFrom ? `${plan.yearFrom}-01-01` : plan.sort === "new" ? iso(new Date(today.getTime() - 365 * 864e5)) : null;
  const to = plan.yearTo ? `${plan.yearTo}-12-31` : plan.sort === "new" ? iso(today) : null;
  const jobs = kinds.map(async (kind) => {
    const gmap = kind === "tv" ? TV_GENRES : MOVIE_GENRES;
    const gids = [...new Set((plan.genres.length ? plan.genres : ["action", "crime"]).map((g) => gmap[g]).filter(Boolean))];
    const dateKey = kind === "tv" ? "first_air_date" : "primary_release_date";
    const params = {
      with_genres: gids.join("|"),
      sort_by: plan.sort === "new" ? `${dateKey}.desc` : plan.sort === "rated" ? "vote_average.desc" : "popularity.desc",
      "vote_count.gte": plan.sort === "new" ? "3" : plan.sort === "rated" ? "150" : "30",
    };
    if (ids.length) params.with_keywords = [...new Set(ids)].join("|");
    if (from) params[`${dateKey}.gte`] = from;
    if (to) params[`${dateKey}.lte`] = to;
    const j = await get(fetchImpl, key, `/discover/${kind}`, params);
    return ((j && j.results) || []).slice(0, 10).map((r) => toCandidate(r, kind));
  });
  for (const rows of await Promise.all(jobs)) out.push(...rows);
  return out;
}

async function byTitle(fetchImpl, key, title, take) {
  const j = await get(fetchImpl, key, "/search/multi", { query: title });
  return ((j && j.results) || [])
    .filter((r) => r.media_type === "movie" || r.media_type === "tv")
    .slice(0, take)
    .map((r) => ({ cand: toCandidate(r), raw: r }));
}

async function similar(fetchImpl, key, title) {
  const hit = (await byTitle(fetchImpl, key, title, 1))[0];
  if (!hit) return [];
  const kind = hit.raw.media_type;
  const j = await get(fetchImpl, key, `/${kind}/${hit.raw.id}/recommendations`, {});
  return [hit.cand, ...((j && j.results) || []).slice(0, 10).map((r) => toCandidate(r, kind))];
}

// Returns up to MAX_CANDIDATES live TMDB rows that are NOT already in the scored catalog.
async function findCandidates(fetchImpl, key, rawPlan, knownNames, now = new Date()) {
  if (!key) return [];
  const plan = cleanPlan(rawPlan);
  const jobs = [discover(fetchImpl, key, plan, now)];
  for (const t of plan.titles) jobs.push(byTitle(fetchImpl, key, t, 2).then((r) => r.map((x) => x.cand)));
  if (plan.similarTo) jobs.push(similar(fetchImpl, key, plan.similarTo));
  const lists = await Promise.all(jobs.map((j) => j.catch(() => [])));
  const known = new Set([...knownNames].map((n) => n.toLowerCase()));
  const seen = new Set();
  const out = [];
  // Interleave so a named title or a "similar to" list is not crowded out by discover results.
  const order = [...lists.slice(1), lists[0]];
  const longest = Math.max(0, ...order.map((l) => l.length));
  for (let i = 0; i < longest && out.length < MAX_CANDIDATES; i++) {
    for (const l of order) {
      const c = l[i];
      if (!c || !c.name) continue;
      const k = `${c.kind}:${c.id}`;
      if (seen.has(k) || known.has(c.name.toLowerCase())) continue;
      if (!c.overview && !c.poster) continue;
      seen.add(k);
      out.push(c);
      if (out.length >= MAX_CANDIDATES) break;
    }
  }
  return out;
}

function candidateLine(c) {
  const parts = [`${c.name} (${c.year || "?"}, ${c.kind})`];
  if (c.rating != null) parts.push(`TMDB ${c.rating} from ${c.votes} votes`);
  if (c.overview) parts.push(c.overview);
  return parts.join(" | ");
}

// ---- detail for one title (used by /api/title) ----
function names(entries) {
  return (entries || []).map((e) => e && e.provider_name).filter(Boolean);
}
function shapeWatch(raw, region) {
  const results = (raw["watch/providers"] && raw["watch/providers"].results) || {};
  for (const code of [region, "US"]) {
    const e = results[code];
    if (e && (e.flatrate || e.rent || e.buy)) {
      return { region: code, stream: names(e.flatrate), rent: names(e.rent), buy: names(e.buy), link: e.link || null };
    }
  }
  return null;
}
function shapeTrailer(raw) {
  const vids = ((raw.videos && raw.videos.results) || []).filter((v) => v.site === "YouTube" && v.type === "Trailer" && v.key);
  vids.sort((a, b) => Number(Boolean(b.official)) - Number(Boolean(a.official)));
  return vids[0] ? vids[0].key : null;
}
async function titleDetails(fetchImpl, key, id, kind, region = "KE") {
  const k = kind === "series" || kind === "tv" ? "tv" : "movie";
  const raw = await get(fetchImpl, key, `/${k}/${id}`, { append_to_response: "videos,watch/providers" });
  if (!raw || !raw.id) return null;
  const runtime = raw.runtime != null ? raw.runtime : (raw.episode_run_time || [])[0] || null;
  return {
    id: raw.id,
    kind: k === "tv" ? "series" : "movie",
    name: raw.title || raw.name || "",
    year: yearOf(raw),
    overview: raw.overview || "",
    tmdb_rating: typeof raw.vote_average === "number" ? Math.round(raw.vote_average * 10) / 10 : null,
    poster: raw.poster_path || null,
    backdrop: raw.backdrop_path || null,
    runtime,
    tagline: raw.tagline || "",
    genres: (raw.genres || []).map((g) => g.name).filter(Boolean),
    trailer: shapeTrailer(raw),
    watch: shapeWatch(raw, region),
    scored: false,
  };
}

module.exports = { findCandidates, candidateLine, titleDetails, cleanPlan, MAX_CANDIDATES };
