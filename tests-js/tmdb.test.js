const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../web/api/_chat-core.js");
const tmdb = require("../web/api/_tmdb.js");

const DATA = {
  action: [{ name: "Ip Man 2", year: 2010, kind: "movie", style: "hand-to-hand", value: 8, fight_quality: 9,
    action_density: 8, grit: 6, pacing: 7, crime_tone: 2, tmdb_rating: 7.5, evidence: [] }],
  crime: [],
};
const KEY = "SECRETKEY123";

function fakeRes() {
  return { code: 0, body: null, status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; }, setHeader() {} };
}
const ok = (j) => ({ ok: true, status: 200, json: async () => j });

function router(extra = {}) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    if (url.includes("/search/keyword")) return ok({ results: [{ id: 779 }] });
    if (url.includes("/discover/movie")) {
      return ok({ results: [
        { id: 1, title: "Fresh Fighter", release_date: "2026-03-01", overview: "A new fight film.", vote_average: 6.54, vote_count: 40, poster_path: "/p.jpg" },
        { id: 2, title: "Ip Man 2", release_date: "2010-04-29", overview: "Already on the shelf.", vote_average: 7.5, vote_count: 900, poster_path: "/q.jpg" },
        { id: 3, title: "Adult Thing", adult: true, release_date: "2026-01-01", overview: "x", poster_path: "/a.jpg" },
      ] });
    }
    if (url.includes("/discover/tv")) return ok({ results: [] });
    if (url.includes("generativelanguage") && url.includes("flash-lite")) {
      return ok({ candidates: [{ content: { parts: [{ text: extra.plan || '{"queries":["martial arts"],"genres":["action"],"kind":"movie","year_from":2026,"sort":"new"}' }] } }] });
    }
    if (url.includes("generativelanguage")) {
      return ok({ candidates: [{ content: { parts: [{ text: '{"reply":"Try Fresh Fighter, not scored yet.","picks":["Fresh Fighter","Ip Man 2","Invented Title"]}' }] } }] });
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { calls, fetchImpl };
}

test("findCandidates drops adult rows and titles already on the shelf, and shapes rows", async () => {
  const { fetchImpl } = router();
  const rows = await tmdb.findCandidates(fetchImpl, KEY, { queries: ["martial arts"], genres: ["action"], kind: "movie" }, ["Ip Man 2"], new Date("2026-11-07"));
  assert.deepEqual(rows.map((r) => r.name), ["Fresh Fighter"]);
  assert.equal(rows[0].year, 2026);
  assert.equal(rows[0].kind, "movie");
  assert.equal(rows[0].rating, 6.5);
});

test("findCandidates uses a date window for 'new' and never needs a key to be present in output", async () => {
  const { fetchImpl, calls } = router();
  await tmdb.findCandidates(fetchImpl, KEY, { genres: ["crime"], kind: "movie", sort: "new" }, [], new Date("2026-11-07"));
  const url = calls.find((c) => c.url.includes("/discover/movie")).url;
  assert.match(url, /primary_release_date\.gte=2025-11-07/);
  assert.match(url, /primary_release_date\.lte=2026-11-07/);
  assert.match(url, /sort_by=primary_release_date\.desc/);
});

test("findCandidates returns nothing without a key and survives upstream failure", async () => {
  assert.deepEqual(await tmdb.findCandidates(async () => { throw new Error("down"); }, "", {}, []), []);
  assert.deepEqual(await tmdb.findCandidates(async () => { throw new Error("down"); }, KEY, { kind: "movie" }, []), []);
});

test("handler plans, looks up live titles, and returns extras only for picks it may use", async () => {
  const { fetchImpl, calls } = router();
  const handler = core.createHandler({
    fetchImpl, env: { GEMINI_API_KEY: "g", TMDB_API_KEY: KEY }, data: DATA, now: () => new Date("2026-11-07"),
  });
  const res = fakeRes();
  await handler({ method: "POST", body: { message: "any new martial arts films from this year?" } }, res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body.picks, ["Fresh Fighter", "Ip Man 2"]); // invented title dropped
  assert.equal(res.body.extras.length, 1);
  assert.equal(res.body.extras[0].name, "Fresh Fighter");
  assert.equal(res.body.extras[0].id, 1);
  assert.ok(!JSON.stringify(res.body).includes(KEY));
  const answerCall = calls.filter((c) => c.url.includes("generativelanguage")).at(-1);
  assert.match(JSON.parse(answerCall.opts.body).systemInstruction.parts[0].text, /LIVE TMDB RESULTS[\s\S]*Fresh Fighter/);
});

test("handler still answers from the catalog when planning or TMDB fails", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("flash-lite") || url.includes("themoviedb")) return { ok: false, status: 500, json: async () => ({}) };
    return ok({ candidates: [{ content: { parts: [{ text: '{"reply":"Ip Man 2.","picks":["Ip Man 2"]}' }] } }] });
  };
  const handler = core.createHandler({ fetchImpl, env: { GEMINI_API_KEY: "g", TMDB_API_KEY: KEY }, data: DATA });
  const res = fakeRes();
  await handler({ method: "POST", body: { message: "best wing chun?" } }, res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body.picks, ["Ip Man 2"]);
  assert.deepEqual(res.body.extras, []);
});

test("titleDetails shapes trailer, watch region fallback and runtime for a series", async () => {
  const raw = { id: 9, name: "Some Show", first_air_date: "2026-02-02", overview: "o", vote_average: 7.04,
    poster_path: "/p", backdrop_path: "/b", episode_run_time: [45], genres: [{ name: "Action" }],
    videos: { results: [{ site: "YouTube", type: "Trailer", key: "abc", official: true }, { site: "Vimeo", type: "Trailer", key: "no" }] },
    "watch/providers": { results: { US: { flatrate: [{ provider_name: "Max" }], link: "https://l" } } } };
  const d = await tmdb.titleDetails(async () => ok(raw), KEY, 9, "tv", "KE");
  assert.equal(d.kind, "series");
  assert.equal(d.runtime, 45);
  assert.equal(d.trailer, "abc");
  assert.equal(d.watch.region, "US");
  assert.deepEqual(d.watch.stream, ["Max"]);
  assert.equal(d.scored, false);
  assert.equal(await tmdb.titleDetails(async () => ({ ok: false }), KEY, 9, "tv"), null);
});
