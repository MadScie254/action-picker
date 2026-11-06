const { titleDetails } = require("./_tmdb.js");

// GET /api/title?id=123&kind=movie|series  -> details for a title that is not on the scored shelf.
module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
  if (req.method !== "GET") return res.status(405).json({ error: "Use GET." });
  const q = req.query || {};
  const id = String(q.id || "");
  const kind = String(q.kind || "");
  if (!/^\d{1,9}$/.test(id) || !["movie", "series", "tv"].includes(kind)) {
    return res.status(400).json({ error: "Pass a numeric id and kind=movie or kind=series." });
  }
  const key = process.env.TMDB_API_KEY;
  if (!key) return res.status(500).json({ error: "Title lookup is not configured on the server." });
  const d = await titleDetails(fetch, key, id, kind, process.env.REGION || "KE");
  if (!d) return res.status(404).json({ error: "TMDB has no title with that id." });
  return res.status(200).json(d);
};
