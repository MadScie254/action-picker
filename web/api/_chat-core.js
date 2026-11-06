// Pure helpers for /api/chat. Files starting with "_" are not routed by Vercel.
const MAX_MESSAGE = 500;
const MAX_HISTORY = 6;
const MAX_PICKS = 5;

const SYSTEM = [
  "You are ActionPicker, a recommender for martial-arts action and gritty crime movies and series.",
  "Answer ONLY from the CATALOG below. Never invent titles, scores, dates or streaming services.",
  "If the catalog has nothing that fits, say so plainly and offer the closest match.",
  "Hand-to-hand and swordplay rank above gun-fu; say so when it matters to the pick.",
  "Quote scores as given (0-10). Say where to watch only when the catalog lists a service.",
  "Keep replies under 120 words, plain sentences, no markdown, no emoji.",
  'Reply with JSON only: {"reply": "<text>", "picks": ["<exact catalog title>", ...]} with at most 5 picks.',
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

function buildMessages(catalogText, history, message) {
  const turns = (Array.isArray(history) ? history : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE) }));
  return [
    { role: "system", content: `${SYSTEM}\n\nCATALOG:\n${catalogText}` },
    ...turns,
    { role: "user", content: String(message).slice(0, MAX_MESSAGE) },
  ];
}

function parseReply(raw, names) {
  const text = typeof raw === "string" ? raw : JSON.stringify(raw ?? "");
  const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const obj = JSON.parse(cleaned.slice(start, end + 1));
      if (obj && typeof obj.reply === "string") {
        const known = new Set(names);
        const picks = (Array.isArray(obj.picks) ? obj.picks : [])
          .filter((p, i, all) => known.has(p) && all.indexOf(p) === i)
          .slice(0, MAX_PICKS);
        return { reply: obj.reply.trim(), picks };
      }
    } catch (_) {
      // fall through to plain text
    }
  }
  return { reply: cleaned, picks: [] };
}

const QUOTA_MESSAGE = "Today's free AI allowance is used up. It resets at 03:00 Nairobi time.";

// Each provider resolves to { text } on success or { fail: "quota" | "busy" | "error" }.
async function callCloudflare(fetchImpl, env, messages) {
  const model = env.LLM_CHAT_MODEL || env.LLM_MODEL;
  let r;
  try {
    r = await fetchImpl(
      `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${model}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${env.LLM_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messages, max_tokens: 500, temperature: 0.3 }),
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
      } catch (_) {}
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

async function callGemini(fetchImpl, env, messages) {
  const model = env.GEMINI_MODEL || "gemini-3.5-flash";
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
          generationConfig: { responseMimeType: "application/json", maxOutputTokens: 1500, temperature: 0.3 },
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

function createHandler({ fetchImpl, env, data, limiter = makeLimiter(15, 10 * 60 * 1000) }) {
  const catalog = buildCatalog(data);
  const hasCloudflare = Boolean(env.CLOUDFLARE_ACCOUNT_ID && env.LLM_API_KEY && (env.LLM_CHAT_MODEL || env.LLM_MODEL));
  const hasGemini = Boolean(env.GEMINI_API_KEY);
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
    const messages = buildMessages(catalog.text, body.history, message);
    let result = { fail: "error" };
    if (hasCloudflare) result = await callCloudflare(fetchImpl, env, messages);
    if (result.fail && hasGemini) result = await callGemini(fetchImpl, env, messages);
    if (result.fail === "quota") return res.status(503).json({ error: QUOTA_MESSAGE, code: "quota" });
    if (result.fail === "busy") {
      return res.status(502).json({ error: "The AI is busy. Try again in a moment." });
    }
    if (result.fail) return res.status(502).json({ error: "The AI could not answer." });
    return res.status(200).json(parseReply(result.text, catalog.names));
  };
}

module.exports = { MAX_MESSAGE, buildCatalog, buildMessages, parseReply, createHandler, makeLimiter };
