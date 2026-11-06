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

function createHandler({ fetchImpl, env, data }) {
  const catalog = buildCatalog(data);
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) return res.status(400).json({ error: "Type a question first." });
    if (message.length > MAX_MESSAGE) {
      return res.status(400).json({ error: `Keep it under ${MAX_MESSAGE} characters.` });
    }
    const { CLOUDFLARE_ACCOUNT_ID: acct, LLM_API_KEY: key, LLM_MODEL: model } = env;
    if (!acct || !key || !model) {
      return res.status(500).json({ error: "Chat is not configured on the server." });
    }
    let upstream;
    try {
      upstream = await fetchImpl(
        `https://api.cloudflare.com/client/v4/accounts/${acct}/ai/run/${model}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: buildMessages(catalog.text, body.history, message),
            max_tokens: 600,
            temperature: 0.3,
          }),
        }
      );
    } catch (_) {
      return res.status(502).json({ error: "The AI is unreachable. Try again in a moment." });
    }
    if (!upstream.ok) {
      const why = upstream.status === 429 ? "The AI is busy. Try again in a moment." : "The AI could not answer.";
      return res.status(502).json({ error: why });
    }
    let payload;
    try {
      payload = await upstream.json();
    } catch (_) {
      return res.status(502).json({ error: "The AI could not answer." });
    }
    const raw = payload && payload.result && payload.result.response;
    return res.status(200).json(parseReply(raw, catalog.names));
  };
}

module.exports = { MAX_MESSAGE, buildCatalog, buildMessages, parseReply, createHandler };
