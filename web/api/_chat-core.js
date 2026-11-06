// Pure helpers for /api/chat. Files starting with "_" are not routed by Vercel.
const tmdb = require("./_tmdb.js");

const MAX_MESSAGE = 500;
const MAX_HISTORY = 6;
const MAX_PICKS = 5;

const SYSTEM = [
  "You are ActionPicker, a recommender for martial-arts action and gritty crime movies and series.",
  "Answer ONLY from the CATALOG and the LIVE TMDB RESULTS below. Never invent titles, scores, dates or streaming services.",
  "CATALOG titles were scored by reading published reviews: quote their scores as given (0-10).",
  "LIVE TMDB RESULTS were looked up just now and have NOT been scored from reviews: never give them a fight or action score, and say plainly that they are not scored yet. You may quote only their TMDB rating and the facts shown.",
  "Prefer CATALOG titles when they fit; use LIVE TMDB RESULTS for new releases, other titles or anything the catalog lacks.",
  "If nothing fits, say so plainly and offer the closest match.",
  "Hand-to-hand and swordplay rank above gun-fu; say so when it matters to the pick.",
  "Say where to watch only when the catalog lists a service.",
  "Keep replies under 120 words, plain sentences, no markdown, no emoji.",
  'Reply with JSON only: {"reply": "<text>", "picks": ["<exact title>", ...]} with at most 5 picks, each copied exactly from the CATALOG or the LIVE TMDB RESULTS.',
].join("\n");

const PLAN_SYSTEM = [
  "Turn the user's request into a TMDB search plan for martial-arts action and gritty crime films and series.",
  "Reply with JSON only, no prose: " +
    '{"queries": [up to 3 short keyword phrases such as "martial arts", "kung fu", "samurai", "heist", "triad"],' +
    ' "titles": [exact titles the user named, up to 3],' +
    ' "similar_to": "<one title the user wants more of, or null>",' +
    ' "genres": [from action, adventure, crime, thriller, drama, war, western, mystery, scifi, comedy, animation, horror, history, fantasy],' +
    ' "kind": "movie" | "tv" | "any",' +
    ' "year_from": <integer or null>, "year_to": <integer or null>,' +
    ' "sort": "popular" | "new" | "rated"}.',
  'Use sort "new" and set year_from to the current year when the user asks for new, latest, recent or this year.',
  "Leave fields empty or null when the request does not say.",
].join("\n");

function line(name, a, c) {
  const base = a || c;
  const parts = [`${name} (${base.year || "?"}, ${base.kind}, ${base.style})`];
  if (a) parts.push(`action ${a.value}`);
  if (c) parts.push(`crime ${c.value}`);
  parts.push(
    `fight ${base.fight_quality}, density ${base.action_density}, grit ${base.grit}, ` +
      `pacing ${base.pacing}, crime-tone ${base.crime_tone}`
  );
  if (base.tmdb_rating) parts.push(`TMDB ${base.tmdb_rating}`);
  if (base.runtime) parts.push(`${base.runtime} min`);
  if (base.genres && base.genres.length) parts.push(base.genres.join("/"));
  if (base.watch) {
    const where = (base.watch.stream || []).slice(0, 4);
    if (where.length) parts.push(`streams on ${where.join(", ")} (${base.watch.region})`);
  }
  const note = base.evidence && base.evidence[0] && base.evidence[0].text;
  if (note) parts.push(`reviewers: "${note}"`);
  return parts.join(" | ");
}

function buildCatalog(data) {
  const key = (r) => `${r.name}#${r.season || ""}`;
  const crime = new Map((data.crime || []).map((r) => [key(r), r]));
  const names = [];
  const lines = [];
  const seen = new Set();
  for (const a of data.action || []) {
    seen.add(key(a));
    names.push(a.name);
    lines.push(line(a.name, a, crime.get(key(a))));
  }
  for (const c of data.crime || []) {
    if (seen.has(key(c))) continue;
    names.push(c.name);
    lines.push(line(c.name, null, c));
  }
  return { text: lines.join("\n"), names };
}

function cleanHistory(history) {
  return (Array.isArray(history) ? history : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE) }));
}

function buildMessages(catalogText, history, message, liveText) {
  const live = liveText ? `\n\nLIVE TMDB RESULTS (not scored from reviews):\n${liveText}` : "";
  return [
    { role: "system", content: `${SYSTEM}\n\nCATALOG:\n${catalogText}${live}` },
    ...cleanHistory(history),
    { role: "user", content: String(message).slice(0, MAX_MESSAGE) },
  ];
}

function buildPlanMessages(history, message, today) {
  return [
    { role: "system", content: `${PLAN_SYSTEM}\nToday is ${today.toISOString().slice(0, 10)}.` },
    ...cleanHistory(history).slice(-4),
    { role: "user", content: String(message).slice(0, MAX_MESSAGE) },
  ];
}

function parseJson(raw) {
  const text = typeof raw === "string" ? raw : JSON.stringify(raw ?? "");
  const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return { obj: JSON.parse(cleaned.slice(start, end + 1)), cleaned };
    } catch (_) {
      // fall through
    }
  }
  return { obj: null, cleaned };
}

// `live` is an optional array of live TMDB candidates the model may also pick from.
function parseReply(raw, names, live = []) {
  const { obj, cleaned } = parseJson(raw);
  if (obj && typeof obj.reply === "string") {
    const known = new Set(names);
    const liveByName = new Map(live.map((c) => [c.name, c]));
    const picks = (Array.isArray(obj.picks) ? obj.picks : [])
      .filter((p, i, all) => typeof p === "string" && (known.has(p) || liveByName.has(p)) && all.indexOf(p) === i)
      .slice(0, MAX_PICKS);
    const extras = picks.filter((p) => !known.has(p)).map((p) => liveByName.get(p));
    return { reply: obj.reply.trim(), picks, extras };
  }
  return { reply: cleaned, picks: [], extras: [] };
}

const QUOTA_MESSAGE = "Today's free AI allowance is used up. It resets at 03:00 Nairobi time.";

// Each provider resolves to { text } on success or { fail: "quota" | "busy" | "error" }.
async function callCloudflare(fetchImpl, env, messages, maxTokens = 500) {
  const model = env.LLM_CHAT_MODEL || env.LLM_MODEL;
  let r;
  try {
    r = await fetchImpl(
      `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${model}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${env.LLM_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messages, max_tokens: maxTokens, temperature: 0.3 }),
      }
    );
  } catch (_) {
    return { fail: "error" };
  }
  if (!r.ok) {
    if (r.status === 429) {
      let code;
      try {
        const j = await r.json();
        code = j && j.errors && j.errors[0] && j.errors[0].code;
      } catch (_) {
        code = undefined;
      }
      return { fail: code === 4006 ? "quota" : "busy" };
    }
    return { fail: "error" };
  }
  try {
    const j = await r.json();
    const text = j && j.result && j.result.response;
    return text == null ? { fail: "error" } : { text };
  } catch (_) {
    return { fail: "error" };
  }
}

async function callGemini(fetchImpl, env, messages, opts = {}) {
  const model = opts.model || env.GEMINI_MODEL || "gemini-3.5-flash";
  const system = messages.find((m) => m.role === "system");
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  let r;
  try {
    r = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": env.GEMINI_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system ? system.content : "" }] },
          contents,
          generationConfig: { responseMimeType: "application/json", maxOutputTokens: opts.maxTokens || 1500, temperature: 0.3 },
        }),
      }
    );
  } catch (_) {
    return { fail: "error" };
  }
  if (!r.ok) return { fail: r.status === 429 ? "quota" : "error" };
  try {
    const j = await r.json();
    const parts = (j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
    const text = parts.filter((p) => p && !p.thought && typeof p.text === "string").map((p) => p.text).join("");
    return text ? { text } : { fail: "error" };
  } catch (_) {
    return { fail: "error" };
  }
}

// Best-effort per-IP limit. Serverless instances keep their own memory, so this
// slows a casual abuser; it is not a hard guarantee.
function makeLimiter(max, windowMs, now = Date.now) {
  const hits = new Map();
  return function allow(key) {
    const t = now();
    const recent = (hits.get(key) || []).filter((x) => t - x < windowMs);
    if (recent.length >= max) { hits.set(key, recent); return false; }
    recent.push(t);
    hits.set(key, recent);
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (!v.some((x) => t - x < windowMs)) hits.delete(k);
    }
    return true;
  };
}
function clientKey(req) {
  const xf = req.headers && req.headers["x-forwarded-for"];
  const first = typeof xf === "string" ? xf.split(",")[0].trim() : "";
  return first || (req.socket && req.socket.remoteAddress) || "unknown";
}

function createHandler({ fetchImpl, env, data, limiter = makeLimiter(15, 10 * 60 * 1000), now = () => new Date() }) {
  const catalog = buildCatalog(data);
  const hasCloudflare = Boolean(env.CLOUDFLARE_ACCOUNT_ID && env.LLM_API_KEY && (env.LLM_CHAT_MODEL || env.LLM_MODEL));
  const hasGemini = Boolean(env.GEMINI_API_KEY);
  const hasTmdb = Boolean(env.TMDB_API_KEY);
  let cloudflareSkipUntil = 0; // after a quota failure, skip Cloudflare for a while

  async function answer(messages) {
    let result = { fail: "error" };
    const useCf = hasCloudflare && Date.now() >= cloudflareSkipUntil;
    if (useCf) {
      result = await callCloudflare(fetchImpl, env, messages);
      if (result.fail === "quota") cloudflareSkipUntil = Date.now() + 30 * 60 * 1000;
    }
    if (result.fail && hasGemini) result = await callGemini(fetchImpl, env, messages);
    return result;
  }

  // A cheap first call that turns the question into a TMDB search plan. Any failure means no plan.
  async function plan(history, message) {
    if (!hasGemini || !hasTmdb) return null;
    const r = await callGemini(fetchImpl, env, buildPlanMessages(history, message, now()), {
      model: env.GEMINI_PLAN_MODEL || "gemini-3.1-flash-lite",
      maxTokens: 400,
    });
    return r.text ? parseJson(r.text).obj : null;
  }

  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) return res.status(400).json({ error: "Type a question first." });
    if (message.length > MAX_MESSAGE) {
      return res.status(400).json({ error: `Keep it under ${MAX_MESSAGE} characters.` });
    }
    if (!hasCloudflare && !hasGemini) {
      return res.status(500).json({ error: "Chat is not configured on the server." });
    }
    if (!limiter(clientKey(req))) {
      return res.status(429).json({ error: "Too many questions in a short time. Wait a few minutes, then ask again.", code: "rate" });
    }
    let live = [];
    try {
      const p = await plan(body.history, message);
      if (p) live = await tmdb.findCandidates(fetchImpl, env.TMDB_API_KEY, p, catalog.names, now());
    } catch (_) {
      live = [];
    }
    const messages = buildMessages(catalog.text, body.history, message, live.map(tmdb.candidateLine).join("\n"));
    const result = await answer(messages);
    if (result.fail === "quota") return res.status(503).json({ error: QUOTA_MESSAGE, code: "quota" });
    if (result.fail === "busy") {
      return res.status(502).json({ error: "The AI is busy. Try again in a moment." });
    }
    if (result.fail) return res.status(502).json({ error: "The AI could not answer." });
    return res.status(200).json(parseReply(result.text, catalog.names, live));
  };
}

module.exports = { MAX_MESSAGE, buildCatalog, buildMessages, buildPlanMessages, parseReply, createHandler, makeLimiter };
