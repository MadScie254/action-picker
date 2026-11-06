/* ActionPicker, direction C: the counter. No build step, no dependencies. */
(() => {
  "use strict";

  const IMG = "https://image.tmdb.org/t/p/";
  const MAX = 500;
  const HISTORY = 6;
  const STORE = "ap-c-conversation";

  const STYLE = {
    hand_to_hand: ["Hand-to-hand", "Fists, feet and close-quarters fighting carry the action."],
    swordplay: ["Swordplay", "Blades and weapon duels carry the action."],
    gun_fu: ["Gun-fu", "Gunfights choreographed like martial arts."],
    mixed: ["Mixed styles", "A mix of hand-to-hand, blades and guns."],
    brawl: ["Brawling", "Rough, scrappy fights more than polished technique."],
    wuxia: ["Wuxia", "Martial-arts fantasy with flying swordplay."],
    other: ["Other action", "Action that is not built around fighting."],
  };
  const SCORES = [
    ["fight_quality", "Fight quality"],
    ["action_density", "Action density"],
    ["grit", "Grit"],
    ["pacing", "Pacing"],
    ["crime_tone", "Crime tone"],
  ];
  const EXAMPLES = [
    ["For the Ip Man fan", "Which Ip Man film has the hardest-hitting fights?"],
    ["For a change of weapon", "Swordplay instead of gunfights tonight. What have you got?"],
    ["For a rough night", "Pick me something as brutal as The Furious."],
  ];

  const state = {
    data: null,
    byName: new Map(),
    extras: new Map(), // live TMDB picks from chat, not scored from reviews
    details: new Map(), // /api/title results keyed by "kind:id"
    mode: safeGet(localStorage, "ap-c-mode") === "crime" ? "crime" : "action",
    kind: "all",
    turns: loadTurns(),
    base: "#/",
    opener: null,
    busy: false,
  };

  const $ = (s, el = document) => el.querySelector(s);
  const els = {
    intro: $("#intro"), log: $("#log"), form: $("#composer"), q: $("#question"),
    ask: $("#ask-btn"), count: $("#count"), shelf: $("#shelf-list"), shelfNote: $("#shelf-note"),
    dlg: $("#detail"), dbody: $("#detail-body"), gen: $("#generated"),
  };

  function safeGet(store, key) { try { return store.getItem(key); } catch (_) { return null; } }
  function safeSet(store, key, v) { try { store.setItem(key, v); } catch (_) { /* storage off */ } }

  function loadTurns() {
    try {
      const raw = JSON.parse(sessionStorage.getItem(STORE) || "[]");
      if (!Array.isArray(raw)) return [];
      return raw.filter((t) => t && typeof t.q === "string").map((t) =>
        t.status === "loading"
          ? { ...t, status: "error", error: "The page reloaded before an answer came back." }
          : { ...t, fresh: false });
    } catch (_) { return []; }
  }
  function saveTurns() {
    const keep = state.turns.slice(-20).map(({ id, q, status, reply, picks, extras, error, sel }) =>
      ({ id, q, status, reply, picks, extras, error, sel }));
    safeSet(sessionStorage, STORE, JSON.stringify(keep));
  }

  /* Element helper: text always goes in as text, never as HTML. */
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === "style") el.style.cssText = v;
      else el.setAttribute(k, v === true ? "" : String(v));
    }
    for (const c of kids.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c.nodeType ? c : String(c));
    }
    return el;
  }

  /* ---------- formatting ---------- */
  const fmt = (n) => (typeof n === "number" ? n.toFixed(1) : "–");
  const styleLabel = (s) => (STYLE[s] || STYLE.other)[0];
  const styleNote = (s) => (STYLE[s] || STYLE.other)[1];
  const modeWord = () => (state.mode === "crime" ? "crime" : "action");

  function regionName(code) {
    try { return new Intl.DisplayNames(["en"], { type: "region" }).of(code) || code; } catch (_) { return code; }
  }
  function kindLine(t) {
    const parts = [];
    if (t.kind === "series") parts.push(t.season ? `Series, season ${t.season}` : "Series");
    else parts.push("Movie");
    if (t.year) parts.push(String(t.year));
    if (t.runtime) parts.push(`${t.runtime} min`);
    return parts.join(", ");
  }
  function andMore(list, n) {
    const shown = list.slice(0, n).join(", ");
    return list.length > n ? `${shown} and ${list.length - n} more` : shown;
  }
  function watchSummary(t) {
    const w = t.watch;
    if (!w) return "No streaming or rental listing found";
    const home = state.data && w.region === state.data.region;
    const stream = w.stream || [], rent = w.rent || [], buy = w.buy || [];
    let core;
    if (stream.length) core = `Stream on ${andMore(stream, 1)}`;
    else if (rent.length) core = `Rent on ${andMore(rent, 1)}`;
    else if (buy.length) core = `Buy on ${andMore(buy, 1)}`;
    else return home ? "No Kenya listing yet" : "No listing found";
    return home ? core : `${w.region} listing only. ${core}`;
  }
  function whyFits(t) {
    const ranked = SCORES
      .filter(([k]) => typeof t[k] === "number")
      .filter(([k]) => state.mode === "crime" || k !== "crime_tone")
      .sort((a, b) => t[b[0]] - t[a[0]]);
    if (!ranked.length) return "";
    const [a, b] = ranked;
    const one = `${a[1].toLowerCase()} (${t[a[0]]})`;
    const two = b ? ` and ${b[1].toLowerCase()} (${t[b[0]]})` : "";
    return `Strongest on ${one}${two}.`;
  }
  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch (_) { return "source"; }
  }
  const titleHash = (name) => "#/title/" + encodeURIComponent(name);

  /* Live picks: titles the chat found on TMDB that have no review scores yet. */
  function cleanExtras(list) {
    if (!Array.isArray(list)) return [];
    return list.filter((x) => x && typeof x.name === "string" && Number.isInteger(x.id))
      .map((x) => ({
        id: x.id, kind: x.kind === "series" ? "series" : "movie", name: x.name,
        year: Number.isInteger(x.year) ? x.year : null,
        overview: typeof x.overview === "string" ? x.overview : "",
        tmdb_rating: typeof x.rating === "number" ? x.rating : null,
        votes: typeof x.votes === "number" ? x.votes : null,
        poster: typeof x.poster === "string" ? x.poster : null,
        backdrop: typeof x.backdrop === "string" ? x.backdrop : null,
        unscored: true,
      }));
  }
  function registerExtras(list) {
    for (const x of list || []) if (x && !state.byName.has(x.name)) state.extras.set(x.name, x);
  }
  const findTitle = (name) => state.byName.get(name) || state.extras.get(name) || null;
  async function loadDetails(t) {
    const key = `${t.kind}:${t.id}`;
    if (state.details.has(key)) return state.details.get(key);
    const res = await fetch(`/api/title?id=${encodeURIComponent(t.id)}&kind=${encodeURIComponent(t.kind)}`);
    if (!res.ok) throw new Error(`TMDB lookup answered ${res.status}`);
    const d = await res.json();
    state.details.set(key, d);
    return d;
  }
  function modeRow(name) {
    const list = state.data ? state.data[state.mode] : [];
    const i = list.findIndex((t) => t.name === name);
    return i < 0 ? null : { t: list[i], rank: i + 1 };
  }

  /* ---------- shared pieces ---------- */
  function poster(t, size, cls) {
    if (t.poster) {
      return h("img", {
        class: "poster " + (cls || ""), src: IMG + size + t.poster, alt: `Poster for ${t.name}`,
        width: 500, height: 750, loading: "lazy", decoding: "async",
      });
    }
    return h("span", { class: "poster ph " + (cls || ""), role: "img", "aria-label": `${t.name}, no poster available` },
      h("span", { class: "ph-title", "aria-hidden": "true", text: t.name }),
      h("span", { class: "ph-year", "aria-hidden": "true", text: t.year ? String(t.year) : "" }));
  }
  function meter(t) {
    return h("ul", { class: "meter", "aria-label": "Scores out of 10" },
      SCORES.map(([k, label]) => {
        const v = typeof t[k] === "number" ? Math.max(0, Math.min(10, Math.round(t[k]))) : null;
        return h("li", null,
          h("span", { text: label }),
          h("span", { class: "blocks", "aria-hidden": "true" },
            Array.from({ length: 10 }, (_, i) => h("i", { class: v != null && i < v ? "on" : null }))),
          h("span", { class: "n" }, v == null ? "–" : String(t[k]), h("span", { class: "vh", text: " out of 10" })));
      }));
  }
  function quote(ev) {
    return h("blockquote", { class: "quote", cite: ev.url || null },
      h("p", { style: "margin:0", text: `“${ev.text}”` }),
      ev.url ? h("cite", null, h("a", { href: ev.url, target: "_blank", rel: "noopener noreferrer", text: hostOf(ev.url) },
        h("span", { class: "vh", text: " (opens in a new tab)" }))) : null);
  }
  function openTitle(name, opener) {
    state.opener = opener || document.activeElement;
    location.hash = titleHash(name);
  }

  /* ---------- shelf (ranked browse list) ---------- */
  function renderShelf() {
    const all = state.data[state.mode];
    const rows = all.map((t, i) => ({ t, rank: i + 1 }))
      .filter(({ t }) => state.kind === "all" || t.kind === state.kind);
    els.shelfNote.textContent = state.mode === "crime"
      ? "Ranked for crime: tone, grit and story count most."
      : "Ranked for action: fight quality counts most, and hand-to-hand beats gunplay.";
    els.shelf.replaceChildren();
    if (!rows.length) {
      const what = state.kind === "series" ? "series" : "movies";
      els.shelf.append(h("li", { class: "shelf-empty" },
        h("p", { style: "margin:0 0 10px", text: `No ${what} on the ${modeWord()} shelf right now.` }),
        h("button", { type: "button", class: "btn btn-light", text: "Show everything", onClick: () => setKind("all") })));
      return;
    }
    for (const { t, rank } of rows) {
      els.shelf.append(h("li", null,
        h("button", { type: "button", class: "row", onClick: (e) => openTitle(t.name, e.currentTarget) },
          h("span", { class: "row-rank", "aria-label": `Rank ${rank}`, text: String(rank) }),
          h("span", { class: "thumb" }, poster(t, "w185")),
          h("span", { class: "row-main" },
            h("span", { class: "row-title", text: t.name }),
            h("span", { class: "row-sub", text: `${t.kind === "series" ? "Series" : "Movie"}, ${t.year || "year unknown"}. ${styleLabel(t.style)}` }),
            h("span", { class: "row-watch", text: watchSummary(t) })),
          h("span", { class: "row-score" }, fmt(t.value), h("span", { class: "vh", text: ` out of 10 for ${modeWord()}` })))));
    }
  }

  /* ---------- empty state ---------- */
  function renderIntro() {
    els.intro.replaceChildren();
    if (state.turns.length) return;
    const n = state.data ? state.data.action.length : 0;
    els.intro.append(
      h("h2", { class: "lede", text: "Tell me what you’re in the mood to watch." }),
      h("p", { class: "voice", text: n
        ? `${n} titles on this shelf are scored from what critics wrote about the fights, the grit and the pace. I can also search every film and series on TMDB, new 2026 releases included, and flag the ones I have not scored yet. Ask for a style, a feeling, or something like a film you loved.`
        : "Ask for a style, a feeling, or something like a film you loved." }),
      h("ul", { class: "examples", "aria-label": "Example questions" },
        EXAMPLES.map(([label, q]) => h("li", null,
          h("button", { type: "button", class: "example", onClick: () => ask(q) },
            h("span", { class: "ex-label", text: label }), q)))));
    if (!state.data) return;
    // The counter's own pull: the best hand-to-hand and blade titles in the current ranking.
    const pull = state.data[state.mode].filter((t) => ["hand_to_hand", "swordplay", "wuxia"].includes(t.style)).slice(0, 4);
    if (!pull.length) return;
    if (!state.pull || state.pull.mode !== state.mode) state.pull = { id: "pull", sel: 0, mode: state.mode, fresh: !reduced() };
    els.intro.append(h("section", { class: "pull", "aria-labelledby": "pull-title" },
      h("h3", { id: "pull-title", class: "pull-line voice",
        text: "Not sure what to ask? This is what I’d hand you tonight: the best fist and blade work on the shelf." }),
      handoff(state.pull, pull, "h4")));
  }

  /* ---------- conversation ---------- */
  function renderLog() {
    els.log.replaceChildren(...state.turns.map(renderTurn));
    renderIntro();
  }
  function updateTurn(turn) {
    const old = els.log.querySelector(`[data-turn="${turn.id}"]`);
    const next = renderTurn(turn);
    if (old) old.replaceWith(next); else els.log.append(next);
    return next;
  }
  function renderTurn(turn) {
    const art = h("article", { class: "turn", "data-turn": turn.id, "aria-busy": turn.status === "loading" ? "true" : null },
      h("h3", { class: "turn-q" }, h("span", { class: "vh", text: "You asked: " }), turn.q));
    if (turn.status === "loading") {
      art.append(h("p", { class: "thinking" },
        h("span", { class: "ticks", "aria-hidden": "true" }, h("i"), h("i"), h("i"), h("i"), h("i")),
        "Checking the shelf"));
      return art;
    }
    if (turn.status === "error") {
      art.append(h("div", { class: "turn-error", role: "alert" },
        h("p", null, h("strong", { text: "No answer came back. " }), turn.error),
        h("button", { type: "button", class: "btn btn-light", text: "Try again", onClick: () => run(turn) })));
      return art;
    }
    if (turn.reply) art.append(h("p", { class: "turn-a voice" }, h("span", { class: "vh", text: "Answer: " }), turn.reply));
    registerExtras(turn.extras);
    const picks = (turn.picks || []).map(findTitle).filter(Boolean);
    if (picks.length) art.append(handoff(turn, picks));
    else if ((turn.picks || []).length) art.append(h("p", { class: "picks-missing", text: "The titles in that answer are not on this shelf." }));
    return art;
  }

  /* The hand-off: a fan of posters laid across the top of one pick slip. */
  const TILTS = [-4, 2.5, -1.5, 3.5, -2.5, 1.5, -3, 2];
  function handoff(turn, picks, level) {
    const sel = Math.min(Math.max(turn.sel || 0, 0), picks.length - 1);
    const wrap = h("div", { class: "handoff" });
    const fan = h("div", {
      class: "fan" + (picks.length === 1 ? " single" : "") + (turn.fresh ? " deal" : ""),
      role: "group", "aria-label": picks.length === 1 ? "The pick" : `${picks.length} picks. Choose one to see its slip.`,
    });
    turn.fresh = false;
    picks.forEach((t, i) => {
      const on = i === sel;
      fan.append(h("button", {
        type: "button", class: "fan-item", "aria-pressed": on ? "true" : "false",
        "aria-label": picks.length === 1 ? `${t.name}, open full details` : `Show the slip for ${t.name}`,
        style: `--i:${i};--r:${TILTS[i % TILTS.length]}deg;--z:${10 - Math.abs(i - sel)}`,
        onClick: (e) => {
          if (picks.length === 1 || i === sel) { openTitle(t.name, e.currentTarget); return; }
          turn.sel = i;
          if (turn.id !== "pull") saveTurns();
          const next = handoff(turn, picks, level);
          wrap.replaceWith(next);
          const btn = next.querySelectorAll(".fan-item")[i];
          if (btn) btn.focus({ preventScroll: true });
        },
      }, poster(t, "w342")));
    });
    wrap.append(fan, slip(picks[sel], sel, picks.length, level));
    return wrap;
  }

  /* Slip for a live TMDB find: no review scores, so none are shown. */
  function liveSlip(t, i, total, level) {
    return h("section", { class: "slip", "aria-label": `Pick slip for ${t.name}` },
      h("div", { class: "slip-top" },
        h("span", { class: "slip-rank" }, h("b", { text: "New find" }), "straight from TMDB"),
        total > 1 ? h("span", { class: "slip-of", text: `Pick ${i + 1} of ${total}` }) : null),
      h(level || "h4", { class: "slip-title", text: t.name }),
      h("p", { class: "slip-meta" },
        h("span", { text: kindLine(t) }),
        h("span", { class: "style-tag", text: "Not scored from reviews yet" })),
      h("div", { class: "slip-body" },
        h("div", null,
          t.overview ? h("p", { class: "why", text: t.overview }) : null,
          h("p", { class: "where" }, h("b", { text: "Heads up: " }),
            "I have not read reviews of this one yet, so there is no fight, grit or pace score.")),
        h("div", null,
          typeof t.tmdb_rating === "number"
            ? h("p", { class: "big-score", style: "margin:0 0 14px" }, t.tmdb_rating.toFixed(1),
              h("small", { text: `TMDB user rating${t.votes ? ` from ${t.votes.toLocaleString("en")} votes` : ""}` }))
            : h("p", { class: "muted", text: "No TMDB rating yet." }))),
      h("div", { class: "slip-actions" },
        h("button", { type: "button", class: "btn", text: "Open full details", onClick: (e) => openTitle(t.name, e.currentTarget) }),
        h("button", { type: "button", class: "textbtn", text: "Ask for more like this",
          onClick: () => { setQuestion(`More like ${t.name}, but something I haven't seen yet.`); } })));
  }

  function slip(t, i, total, level) {
    if (t.unscored) return liveSlip(t, i, total, level);
    const row = modeRow(t.name);
    const ev = (t.evidence || [])[0];
    return h("section", { class: "slip", "aria-label": `Pick slip for ${t.name}` },
      h("div", { class: "slip-top" },
        row ? h("span", { class: "slip-rank" }, h("b", { text: `#${row.rank}` }), `on the ${modeWord()} shelf`) : h("span"),
        total > 1 ? h("span", { class: "slip-of", text: `Pick ${i + 1} of ${total}` }) : null),
      h(level || "h4", { class: "slip-title", text: t.name }),
      h("p", { class: "slip-meta" },
        h("span", { text: kindLine(t) }),
        h("span", { class: "style-tag", text: styleLabel(t.style) })),
      h("div", { class: "slip-body" },
        h("div", null,
          h("p", { class: "why", text: whyFits(t) }),
          ev ? quote(ev) : null,
          h("p", { class: "where" }, h("b", { text: "Where to watch: " }), watchSummary(t))),
        h("div", null,
          h("p", { class: "big-score", style: "margin:0 0 14px" }, fmt(row ? row.t.value : t.value),
            h("small", { text: `overall ${modeWord()} score out of 10` })),
          meter(t))),
      h("div", { class: "slip-actions" },
        h("button", { type: "button", class: "btn", text: "Open full details", onClick: (e) => openTitle(t.name, e.currentTarget) }),
        h("button", { type: "button", class: "textbtn", text: "Ask for more like this",
          onClick: () => { setQuestion(`More like ${t.name}, but something I haven't seen yet.`); } })));
  }

  /* ---------- asking ---------- */
  function historyBefore(turn) {
    const msgs = [];
    for (const t of state.turns) {
      if (t === turn) break;
      if (t.status !== "done") continue;
      msgs.push({ role: "user", content: t.q });
      msgs.push({ role: "assistant", content: t.reply || (t.picks || []).join(", ") });
    }
    return msgs.slice(-HISTORY);
  }
  function setBusy(on) {
    state.busy = on;
    els.ask.setAttribute("aria-disabled", on ? "true" : "false");
    els.ask.textContent = on ? "Asking" : "Ask";
  }
  function ask(text) {
    const q = String(text || "").trim().slice(0, MAX);
    if (!q || state.busy) return;
    const turn = { id: Date.now().toString(36), q, status: "loading" };
    state.turns.push(turn);
    renderIntro();
    const el = updateTurn(turn);
    renderStartOver();
    el.scrollIntoView({ block: "start", behavior: reduced() ? "auto" : "smooth" });
    run(turn);
  }
  async function run(turn) {
    if (state.busy && turn.status !== "loading") return;
    turn.status = "loading"; turn.error = null;
    updateTurn(turn); setBusy(true); saveTurns();
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 30000);
      let res;
      try {
        res = await fetch("/api/chat", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: turn.q, history: historyBefore(turn) }),
          signal: ctl.signal,
        });
      } finally { clearTimeout(timer); }
      let body = null;
      try { body = await res.json(); } catch (_) { body = null; }
      if (!res.ok) throw new Error((body && body.error) || `The chat service answered with status ${res.status} and no message.`);
      if (!body || typeof body !== "object") throw new Error("The chat service sent an answer this page could not read.");
      turn.status = "done";
      turn.reply = typeof body.reply === "string" ? body.reply : "";
      turn.picks = Array.isArray(body.picks) ? body.picks.filter((p) => typeof p === "string") : [];
      turn.extras = cleanExtras(body.extras);
      registerExtras(turn.extras);
      turn.sel = 0; turn.fresh = !reduced();
    } catch (err) {
      turn.status = "error";
      turn.error = err && err.name === "AbortError"
        ? "The chat service took longer than 30 seconds to answer. Try again in a moment."
        : err instanceof TypeError
          ? "The chat service could not be reached. Check your connection, then try again."
          : err.message;
    }
    setBusy(false); saveTurns(); updateTurn(turn);
  }
  function renderStartOver() {
    let bar = $("#start-over");
    if (!state.turns.length) { if (bar) bar.remove(); return; }
    if (!bar) {
      bar = h("p", { id: "start-over", class: "turn-tools", style: "margin-bottom:8px" },
        h("button", { type: "button", class: "textbtn", text: "Clear the conversation", onClick: clearAll }));
      els.log.after(bar);
    }
  }
  function clearAll() {
    if (state.busy) return;
    state.turns = []; saveTurns(); renderLog(); renderStartOver(); els.q.focus();
  }
  function setQuestion(text) {
    setView("ask");
    els.q.value = text.slice(0, MAX); autosize(); counter();
    els.q.focus(); els.q.setSelectionRange(els.q.value.length, els.q.value.length);
  }
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- composer ---------- */
  function autosize() { els.q.style.height = "auto"; els.q.style.height = Math.min(els.q.scrollHeight, 200) + "px"; }
  function counter() {
    const n = els.q.value.length;
    els.count.textContent = n >= 400 ? `${n} of ${MAX} characters` : "";
    els.count.classList.toggle("near", n >= 450);
  }
  els.q.addEventListener("input", () => { autosize(); counter(); });
  els.q.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
  });
  els.form.addEventListener("submit", (e) => { e.preventDefault(); submit(); });
  function submit() {
    if (state.busy || !els.q.value.trim()) { els.q.focus(); return; }
    const q = els.q.value;
    els.q.value = ""; autosize(); counter();
    ask(q);
  }

  /* ---------- detail sheet ---------- */
  function closeBtn() {
    return h("button", { type: "button", class: "btn d-close", text: "Close", onClick: () => els.dlg.close() });
  }
  function watchBlock(t) {
    const w = t.watch;
    const sec = h("section", { class: "d-sec", "aria-labelledby": "d-watch" }, h("h3", { id: "d-watch", text: "Where to watch" }));
    if (!w) {
      sec.append(h("p", { class: "muted", text: "No streaming, rental or purchase listing was found for this title." }));
      return sec;
    }
    if (state.data && w.region !== state.data.region) {
      sec.append(h("p", { class: "region-note",
        text: `These listings are for ${regionName(w.region)}. Kenya listings are unavailable for this title.` }));
    }
    const cols = [["Stream", w.stream], ["Rent", w.rent], ["Buy", w.buy]].filter(([, l]) => l && l.length);
    if (cols.length) {
      sec.append(h("div", { class: "watch-cols" }, cols.map(([label, list]) => h("div", null,
        h("h4", { text: label }),
        h("ul", null, list.slice(0, 5).map((s) => h("li", { text: s })),
          list.length > 5 ? h("li", { class: "more", text: `and ${list.length - 5} more` }) : null)))));
    } else {
      sec.append(h("p", { class: "muted", text: "The listing exists but names no services." }));
    }
    if (w.link) sec.append(h("a", { class: "d-link", href: w.link, target: "_blank", rel: "noopener noreferrer", text: "See all options on TMDB" },
      h("span", { class: "vh", text: " (opens in a new tab)" })));
    return sec;
  }
  function trailerBlock(t) {
    const sec = h("section", { class: "d-sec", "aria-labelledby": "d-trailer" }, h("h3", { id: "d-trailer", text: "Trailer" }));
    if (!t.trailer) { sec.append(h("p", { class: "muted", text: "No trailer on file for this title." })); return sec; }
    const box = h("div", { class: "trailer-box" });
    const play = h("button", { type: "button", class: "btn btn-light", text: "Play the trailer",
      onClick: () => {
        const f = h("iframe", {
          src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(t.trailer)}?autoplay=1&rel=0`,
          title: `Trailer for ${t.name}`, allow: "autoplay; encrypted-media; picture-in-picture; fullscreen", allowfullscreen: true,
        });
        box.replaceChildren(f); f.focus();
      } });
    box.append(play);
    sec.append(box, h("p", { class: "style-note" }, "Loads from YouTube when you press play. ",
      h("a", { href: `https://www.youtube.com/watch?v=${encodeURIComponent(t.trailer)}`, target: "_blank", rel: "noopener noreferrer", text: "Open on YouTube instead" },
        h("span", { class: "vh", text: " (opens in a new tab)" }))));
    return sec;
  }

  /* Detail sheet for a live TMDB find: basics now, runtime/trailer/watch once /api/title answers. */
  function renderLiveDetail(t) {
    const more = h("div", { class: "d-grid" },
      h("section", { class: "d-sec wide" }, h("p", { class: "muted", text: "Loading trailer and where to watch" })));
    const head = t.backdrop
      ? h("img", { class: "d-backdrop", src: IMG + "w1280" + t.backdrop, alt: "", width: 1280, height: 548, loading: "lazy", decoding: "async" })
      : h("div", { class: "d-nobackdrop" });
    const tagline = h("p", { class: "tagline" });
    const meta = h("p", { class: "d-meta" }, h("span", { text: kindLine(t) }),
      h("span", { class: "style-tag", text: "Not scored from reviews yet" }));
    els.dbody.replaceChildren(
      closeBtn(), head,
      h("div", { class: "d-head" },
        h("div", { class: "dposter" }, poster(t, "w500")),
        h("div", { class: "d-titles" }, h("h2", { id: "detail-title", text: t.name }), meta),
        typeof t.tmdb_rating === "number"
          ? h("p", { class: "d-score big-score", style: "margin:0" }, t.tmdb_rating.toFixed(1), h("small", { text: "TMDB user rating" }))
          : h("span")),
      h("div", { class: "d-body" },
        tagline,
        t.overview ? h("p", { class: "overview", text: t.overview }) : h("p", { class: "overview muted", text: "No synopsis on file." }),
        h("p", { class: "style-note" }, h("b", { text: "No fight scores yet. " }),
          "This title came straight from TMDB. It has not been through the review scoring, so it has no fight, grit or pace numbers and no reviewer quotes."),
        more,
        h("div", { class: "d-foot" },
          h("button", { type: "button", class: "btn", text: "Ask for more like this",
            onClick: () => { const n = t.name; state.opener = els.q; els.dlg.close(); setQuestion(`More like ${n}, but something I haven't seen yet.`); } }),
          h("button", { type: "button", class: "btn btn-line", text: "Close", onClick: () => els.dlg.close() }))));
    loadDetails(t).then((d) => {
      if (!more.isConnected) return;
      if (d.tagline) tagline.textContent = d.tagline;
      const bits = [kindLine({ ...t, runtime: d.runtime })];
      meta.firstChild.textContent = bits[0];
      if ((d.genres || []).length) meta.append(h("span", { text: d.genres.join(", ") }));
      const full = { ...t, ...d, name: t.name };
      more.replaceChildren(watchBlock(full), h("div", { class: "wide" }, trailerBlock(full)));
    }).catch(() => {
      if (!more.isConnected) return;
      more.replaceChildren(h("section", { class: "d-sec wide" },
        h("p", { class: "muted", text: "Trailer and watch listings could not be loaded right now." }),
        h("a", { class: "d-link", href: `https://www.themoviedb.org/${t.kind === "series" ? "tv" : "movie"}/${t.id}`,
          target: "_blank", rel: "noopener noreferrer", text: "Open this title on TMDB" },
        h("span", { class: "vh", text: " (opens in a new tab)" }))));
    });
  }

  function renderDetail(name) {
    const live = !state.byName.has(name) && state.extras.get(name);
    if (live) { renderLiveDetail(live); return; }
    const t = state.byName.get(name);
    if (!t) {
      els.dbody.replaceChildren(closeBtn(), h("div", { class: "d-missing" },
        h("h2", { id: "detail-title", text: "That title is not on the shelf" }),
        h("p", { class: "overview", text: `Nothing called “${name}” is in this catalog. It may have dropped out at the last refresh.` }),
        h("a", { class: "btn", href: "#/", text: "Back to the counter" })));
      return;
    }
    const row = modeRow(t.name);
    const ev = t.evidence || [];
    const head = t.backdrop
      ? h("img", { class: "d-backdrop", src: IMG + "w1280" + t.backdrop, alt: "", width: 1280, height: 548, loading: "lazy", decoding: "async" })
      : h("div", { class: "d-nobackdrop" });
    els.dbody.replaceChildren(
      closeBtn(), head,
      h("div", { class: "d-head" },
        h("div", { class: "dposter" }, poster(t, "w500")),
        h("div", { class: "d-titles" },
          h("h2", { id: "detail-title", text: t.name }),
          h("p", { class: "d-meta" }, h("span", { text: kindLine(t) }), h("span", { class: "style-tag", text: styleLabel(t.style) }),
            (t.genres || []).length ? h("span", { text: t.genres.join(", ") }) : null)),
        h("p", { class: "d-score big-score", style: "margin:0" }, fmt(row ? row.t.value : t.value),
          h("small", { text: row ? `#${row.rank} on the ${modeWord()} shelf` : `out of 10` }))),
      h("div", { class: "d-body" },
        t.tagline ? h("p", { class: "tagline", text: t.tagline }) : null,
        t.overview ? h("p", { class: "overview", text: t.overview }) : h("p", { class: "overview muted", text: "No synopsis on file." }),
        h("div", { class: "d-grid" },
          h("section", { class: "d-sec", "aria-labelledby": "d-scores" },
            h("h3", { id: "d-scores", text: "Scores" }), meter(t),
            h("p", { class: "style-note" }, h("b", { text: `${styleLabel(t.style)}. ` }), styleNote(t.style),
              typeof t.tmdb_rating === "number" ? ` TMDB users rate it ${t.tmdb_rating.toFixed(1)}.` : "",
              t.reviews ? ` Scored from ${t.reviews} published review${t.reviews === 1 ? "" : "s"}.` : "")),
          watchBlock(t),
          h("section", { class: "d-sec wide", "aria-labelledby": "d-reviews" },
            h("h3", { id: "d-reviews", text: "What reviewers say" }),
            ev.length ? h("div", { class: "reviews" }, ev.map(quote))
              : h("p", { class: "muted", text: "No reviewer quotes on file for this title." })),
          h("div", { class: "wide" }, trailerBlock(t))),
        h("div", { class: "d-foot" },
          h("button", { type: "button", class: "btn", text: "Ask for more like this",
            onClick: () => { const n = t.name; state.opener = els.q; els.dlg.close(); setQuestion(`More like ${n}, but something I haven't seen yet.`); } }),
          h("button", { type: "button", class: "btn btn-line", text: "Close", onClick: () => els.dlg.close() }))));
  }
  els.dlg.addEventListener("click", (e) => { if (e.target === els.dlg) els.dlg.close(); });
  els.dlg.addEventListener("close", () => {
    if (location.hash.startsWith("#/title/")) {
      history.replaceState(null, "", state.base);
      route();
    }
    const back = state.opener;
    state.opener = null;
    if (back && back.isConnected) back.focus({ preventScroll: true });
  });

  /* ---------- routing: #/, #/chat, #/title/<name> ---------- */
  function route() {
    const hash = location.hash || "#/";
    if (hash.startsWith("#/title/")) {
      if (!state.data) return; // routed again once the catalog arrives
      let name;
      try { name = decodeURIComponent(hash.slice(8)); } catch (_) { name = hash.slice(8); }
      renderDetail(name);
      if (!els.dlg.open) els.dlg.showModal();
      els.dlg.scrollTop = 0;
      const c = els.dlg.querySelector(".d-close");
      if (c) c.focus({ preventScroll: true });
      document.title = `${name}: ActionPicker`;
      return;
    }
    document.title = "ActionPicker: ask for a fight film";
    if (els.dlg.open) els.dlg.close();
    if (hash === "#/chat") {
      state.base = "#/chat";
      setView("ask");
      $("#counter").scrollIntoView({ block: "start" });
      els.q.focus({ preventScroll: true });
    } else {
      state.base = "#/";
    }
  }
  window.addEventListener("hashchange", route);

  /* ---------- controls ---------- */
  function setMode(m) {
    state.mode = m; safeSet(localStorage, "ap-c-mode", m);
    document.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === m)));
    if (!state.data) return;
    renderShelf(); renderLog();
    if (els.dlg.open && location.hash.startsWith("#/title/")) route();
  }
  function setKind(k) {
    state.kind = k;
    document.querySelectorAll("[data-kind]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.kind === k)));
    if (state.data) renderShelf();
  }
  document.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
  document.querySelectorAll("[data-kind]").forEach((b) => b.addEventListener("click", () => setKind(b.dataset.kind)));
  const narrow = () => window.matchMedia("(max-width: 900px)").matches;
  function setView(v) {
    state.view = v;
    $(".room").dataset.view = v;
    $("#jump-shelf").textContent = v === "shelf" ? "Back to asking" : "Browse the shelf";
    $("#jump-shelf").setAttribute("aria-pressed", String(v === "shelf"));
  }
  $("#jump-shelf").addEventListener("click", () => {
    if (narrow()) {
      setView(state.view === "shelf" ? "ask" : "shelf");
      window.scrollTo(0, 0);
      const t = state.view === "shelf" ? $("#shelf-title") : els.q;
      if (state.view === "shelf") t.setAttribute("tabindex", "-1");
      t.focus({ preventScroll: true });
      return;
    }
    $("#shelf").scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "start" });
    $("#shelf-title").setAttribute("tabindex", "-1");
    $("#shelf-title").focus({ preventScroll: true });
  });
  setView("ask");

  /* ---------- boot ---------- */
  function showLoadError(msg) {
    els.intro.replaceChildren(h("div", { class: "load-error", role: "alert" },
      h("h2", { text: "The catalog did not load" }),
      h("p", { text: `${msg} The shelf and the picks need it. Check that data.json is being served, then try again.` }),
      h("button", { type: "button", class: "btn btn-light", text: "Try again", onClick: boot })));
    els.shelf.replaceChildren(h("li", { class: "shelf-empty", text: "The shelf is empty because the catalog did not load." }));
  }
  async function boot() {
    els.intro.replaceChildren(h("p", { class: "thinking", style: "margin-left:0" },
      h("span", { class: "ticks", "aria-hidden": "true" }, h("i"), h("i"), h("i"), h("i"), h("i")), "Stocking the shelf"));
    try {
      const res = await fetch("/data.json", { cache: "no-cache" });
      if (!res.ok) throw new Error(`The server answered ${res.status} for data.json.`);
      let data;
      try { data = await res.json(); } catch (_) { throw new Error("data.json arrived but is not valid JSON."); }
      if (!data || !Array.isArray(data.action) || !Array.isArray(data.crime)) throw new Error("data.json is missing its action and crime lists.");
      state.data = data;
      state.byName = new Map([...data.crime, ...data.action].map((t) => [t.name, t]));
    } catch (err) {
      showLoadError(err instanceof TypeError ? "The server could not be reached." : err.message);
      return;
    }
    const d = new Date(state.data.generated);
    els.gen.textContent = isNaN(d) ? "" : `Catalog generated ${d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.`;
    setMode(state.mode);
    renderStartOver();
    route();
  }

  autosize(); counter();
  boot();
})();
