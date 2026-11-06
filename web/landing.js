// Contact details. Drop Daniel's number into phone (international digits, e.g. "2547XXXXXXXX")
// and the WhatsApp block appears on its own.
const SITE = {
  email: "danieleinstein1998@gmail.com",
  phone: "254742007277",
  phoneDisplay: "+254 742 007 277",
  whatsappText: "Hi Daniel, I found you through ActionPicker and want to talk about a data project.",
};
window.SITE = Object.assign(SITE, window.SITE || {});

(function () {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const IMG = "https://image.tmdb.org/t/p/w500";
  const $ = (id) => document.getElementById(id);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const AT = Math.max(0, parseInt(new URLSearchParams(location.search).get("at") || "0", 10) || 0);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => { t = clamp((t - 0.12) / 0.76, 0, 1); return t * t * (3 - 2 * t); };
  const arr = (v) => (Array.isArray(v) ? v : []);
  const titleHref = (name) => "/app/#/title/" + encodeURIComponent(name);

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function svgEl(tag, attrs) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }
  function poster(path, name, w) {
    if (!path) return null;
    const img = el("img");
    img.src = IMG + path;
    img.alt = "Poster for " + name;
    img.width = w; img.height = Math.round(w * 1.5);
    img.loading = "lazy"; img.decoding = "async";
    img.addEventListener("error", () => img.remove());
    return img;
  }
  function source(url) {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch (_) { return ""; }
  }
  const STYLE = { hand_to_hand: "Hand-to-hand", swordplay: "Swordplay", wuxia: "Wuxia", gun_fu: "Gun-fu",
    mixed: "Mixed styles", brawl: "Brawling", other: "Other action" };
  const SCORES = [["fight_quality", "Fight quality"], ["action_density", "Action density"], ["grit", "Grit"],
    ["pacing", "Pacing"], ["crime_tone", "Crime tone"]];

  /* ---------- Content from data.json (null-safe, text only) ---------- */
  const FALLBACK = { name: "Warrior", year: 2019, kind: "series", style: "hand_to_hand", reviews: 0,
    fight_quality: 8, action_density: 7, grit: 8, pacing: 8, crime_tone: 9,
    evidence: [{ text: "awesome fight scenes", url: "" }, { text: "great fights dotted throughout its run-time", url: "" }] };

  function fillShelf(action) {
    const top = action.slice(0, 3);
    if (top.length < 3) return;
    const fan = $("fan");
    fan.textContent = "";
    top.forEach((t) => {
      const li = el("li", "slot");
      const a = el("a");
      a.href = titleHref(t.name);
      a.setAttribute("aria-label", t.name + ", " + (t.year || "") + ", scored " + Number(t.value).toFixed(1));
      a.appendChild(el("span", "alt", t.name));
      const img = poster(t.poster, t.name, 160);
      if (img) a.appendChild(img);
      a.appendChild(el("span", "tag", Number(t.value).toFixed(1)));
      li.appendChild(a);
      fan.appendChild(li);
    });
    $("shelfCap").textContent = "Tonight's shelf, top three for action";
  }

  function fillSlip(t) {
    $("slipName").textContent = t.name;
    $("slipMeta").textContent = [t.year, t.kind === "series" ? "series" : "film", STYLE[t.style] ? STYLE[t.style].toLowerCase() : ""]
      .filter(Boolean).join(", ");
    const meter = $("meter");
    meter.textContent = "";
    SCORES.forEach(([k, label]) => {
      const v = t[k];
      const li = el("li", v == null ? "na" : "");
      li.appendChild(el("span", "", label));
      const b = el("span", "blocks");
      for (let i = 0; i < 10; i++) b.appendChild(el("i"));
      li.appendChild(b);
      li.appendChild(el("span", "n", v == null ? "n/a" : String(v)));
      li.dataset.v = v == null ? 0 : v;
      li.setAttribute("aria-label", label + ": " + (v == null ? "not scored" : v + " out of 10"));
      meter.appendChild(li);
    });
    const q = $("quotes");
    q.textContent = "";
    arr(t.evidence).slice(0, 3).forEach((ev) => {
      if (!ev || !ev.text) return;
      const words = String(ev.text).split(/\s+/);
      const text = words.length > 24 ? words.slice(0, 24).join(" ") + "..." : ev.text;
      const li = el("li");
      li.appendChild(el("span", "", "\u201C" + text + "\u201D"));
      const src = source(ev.url);
      if (src) li.appendChild(el("cite", "", src));
      q.appendChild(li);
    });
  }

  function fillLadder(all) {
    document.querySelectorAll("#ladderList li").forEach((li) => {
      const styles = (li.dataset.styles || "").split(" ");
      const hits = all.filter((t) => styles.includes(t.style));
      const ex = li.querySelector("[data-ex]");
      if (!hits.length) return;
      const t = hits[0];
      ex.textContent = hits.length + (hits.length === 1 ? " title" : " titles") + " on the shelf now, led by " + t.name + " (" + t.year + ")";
    });
  }

  function fillPicks(all) {
    let picks = all.filter((t) => t.style === "swordplay" || t.style === "wuxia").slice(0, 3);
    const ol = $("picks");
    if (!picks.length) picks = [{ name: "Into the Badlands", year: 2015, evidence: [] }, { name: "Sakra", year: 2023, evidence: [] }];
    ol.textContent = "";
    picks.forEach((t) => {
      const li = el("li", "pick");
      const th = el("div", "thumb");
      const img = poster(t.poster, t.name, 92);
      if (img) th.appendChild(img);
      li.appendChild(th);
      const body = el("div");
      const h = el("h3");
      const a = el("a", "", t.name);
      a.href = titleHref(t.name);
      h.appendChild(a);
      if (t.year) h.appendChild(el("span", "yr", String(t.year)));
      body.appendChild(h);
      const ev = arr(t.evidence).filter((e) => e && e.text && e.text.split(/\s+/).length <= 20)
        .sort((a, b) => b.text.length - a.text.length)[0];
      body.appendChild(el("p", "", ev && ev.text ? "\u201C" + ev.text + "\u201D" : "Scored for swordplay on the shelf."));
      const src = ev ? source(ev.url) : "";
      if (src) body.appendChild(el("cite", "", "From a review on " + src));
      li.appendChild(body);
      ol.appendChild(li);
    });
  }

  function fillCounts(d, action, crime) {
    if (!action.length && !crime.length) return;
    let when = "";
    try {
      when = new Date(d.generated).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    } catch (_) {}
    $("counts").textContent = "Right now the action shelf holds " + action.length + " scored titles and the crime shelf holds " +
      crime.length + (when ? ", last refreshed " + when + "." : ".");
    const g = $("shelfBlocks");
    g.textContent = "";
    [[action.length, "Action", 0], [crime.length, "Crime", 58]].forEach(([n, label, y]) => {
      const t = svgEl("text", { x: 0, y: y + 10, fill: "#E6EAE3", "font-family": "Bricolage Grotesque, sans-serif", "font-size": 14, "font-weight": 650 });
      t.textContent = label + ", " + n;
      g.appendChild(svgEl("rect", { x: -8, y: y - 8, width: 560, height: 56, fill: "#0A1F1A" }));
      g.appendChild(t);
      for (let i = 0; i < n; i++) {
        g.appendChild(svgEl("rect", { x: (i % 32) * 17, y: y + 18 + Math.floor(i / 32) * 17, width: 13, height: 13, fill: "#E9B949" }));
      }
    });
  }

  function build(d) {
    const action = arr(d && d.action), crime = arr(d && d.crime);
    const seen = new Set(), all = [];
    action.concat(crime).forEach((t) => { if (t && t.name && !seen.has(t.name)) { seen.add(t.name); all.push(t); } });
    fillShelf(action);
    const full = action.find((t) => SCORES.every(([k]) => typeof t[k] === "number"));
    fillSlip(full || action[0] || FALLBACK);
    fillLadder(all);
    fillPicks(all);
    fillCounts(d || {}, action, crime);
  }

  /* ---------- Contact ---------- */
  function contact() {
    const S = window.SITE || SITE;
    const mail = $("mailLink");
    mail.href = "mailto:" + S.email;
    mail.textContent = S.email;
    $("copyMail").addEventListener("click", () => {
      const done = (ok) => { $("copied").textContent = ok ? "Copied" : "Press Ctrl+C"; setTimeout(() => ($("copied").textContent = ""), 2400); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(S.email).then(() => done(true), () => done(false));
      else done(false);
    });
    const digits = String(S.phone || "").replace(/\D/g, "");
    if (digits) {
      $("phoneBlock").hidden = false;
      $("waLink").href = "https://wa.me/" + digits + "?text=" + encodeURIComponent(S.whatsappText || "");
      const tel = $("telLink");
      tel.href = "tel:+" + digits;
      tel.textContent = S.phoneDisplay || "+" + digits;
    }
    $("year").textContent = String(new Date().getFullYear());
  }

  /* ---------- Fighter: joint skeleton, poses as world angles ---------- */
  // Angle convention: 0 points down, 90 points forward, 180 points up.
  const P = {
    guard: { lean: 10, head: 4, aFu: 25, aFl: 140, aBu: 10, aBl: 150, lFu: 36, lFl: 4, lBu: -8, lBl: -40, blade: 150, bOn: 0, air: 0 },
    jab: { lean: 14, head: 2, aFu: 86, aFl: 90, aBu: 12, aBl: 155, lFu: 44, lFl: 8, lBu: -14, lBl: -48, blade: 150, bOn: 0, air: 0 },
    cross: { lean: 20, head: 2, aFu: 22, aFl: 150, aBu: 84, aBl: 88, lFu: 46, lFl: 10, lBu: -20, lBl: -56, blade: 150, bOn: 0, air: 0 },
    sweep: { lean: 30, head: -4, aFu: 50, aFl: 150, aBu: -100, aBl: -95, lFu: 80, lFl: -10, lBu: -62, lBl: -66, blade: 150, bOn: 0, air: 0 },
    kick: { lean: -20, head: 10, aFu: 45, aFl: 125, aBu: -62, aBl: -30, lFu: 128, lFl: 138, lBu: -6, lBl: -4, blade: 150, bOn: 0, air: 0 },
    draw: { lean: 4, head: 6, aFu: 165, aFl: 230, aBu: 20, aBl: 125, lFu: 36, lFl: 6, lBu: -10, lBl: -42, blade: 178, bOn: 1, air: 0 },
    ready: { lean: 8, head: 4, aFu: 34, aFl: 112, aBu: 22, aBl: 118, lFu: 38, lFl: 4, lBu: -10, lBl: -42, blade: 138, bOn: 1, air: 0 },
    slash: { lean: 26, head: 0, aFu: 100, aFl: 100, aBu: -50, aBl: -72, lFu: 64, lFl: 4, lBu: -58, lBl: -60, blade: 80, bOn: 1, air: 0 },
    bow: { lean: 40, head: 12, aFu: 16, aFl: 26, aBu: 8, aBl: 18, lFu: 3, lFl: 1, lBu: -3, lBl: -1, blade: 140, bOn: 0, air: 0 },
    leap: { lean: -6, head: 4, aFu: 40, aFl: 130, aBu: -30, aBl: 20, lFu: 96, lFl: 96, lBu: 50, lBl: -70, blade: 150, bOn: 0, air: 46 },
    leapB: { lean: -4, head: 4, aFu: 60, aFl: 150, aBu: -30, aBl: 20, lFu: 96, lFl: 96, lBu: 50, lBl: -70, blade: 205, bOn: 1, air: 46 },
  };
  const KEYS = Object.keys(P.guard);
  // Choreography per section: [fraction of section height, pose]
  const CHOREO = {
    roof: [[0, "guard"]],
    dojo: [[0.1, "guard"], [0.2, "jab"], [0.28, "guard"], [0.36, "cross"], [0.44, "jab"], [0.52, "cross"], [0.6, "guard"], [0.7, "jab"], [0.8, "guard"]],
    alley: [[0.12, "guard"], [0.32, "sweep"], [0.46, "sweep"], [0.58, "guard"], [0.72, "kick"], [0.86, "guard"]],
    room: [[0.12, "guard"], [0.4, "draw"], [0.66, "ready"]],
    field: [[0.12, "ready"], [0.42, "slash"], [0.56, "slash"], [0.78, "ready"]],
    dawn: [[0.12, "ready"], [0.5, "bow"], [1, "bow"]],
  };
  const SIGNATURE = { roof: "guard", dojo: "jab", alley: "kick", room: "draw", field: "slash", dawn: "bow" };

  const TORSO = 52, UA = 31, FA = 29, TH = 44, SH = 44, HEAD = 11.5;
  const rad = Math.PI / 180;
  const dir = (a) => [Math.sin(a * rad), Math.cos(a * rad)];
  const add = (p, a, len) => { const d = dir(a); return [p[0] + d[0] * len, p[1] + d[1] * len]; };
  const f1 = (n) => Math.round(n * 10) / 10;

  let fid = 0;
  function makeFighter() {
    const id = "fb" + fid++;
    const wrap = el("div", "fighter");
    const svg = svgEl("svg", { viewBox: "-100 -230 200 250", width: 200, height: 250, focusable: "false" });
    const shadow = svgEl("ellipse", { cx: 0, cy: 3, rx: 46, ry: 5, fill: "#000", opacity: ".35" });
    const root = svgEl("g", {});
    const fill = svgEl("use", { href: "#" + id, transform: "translate(2 1.6)", opacity: ".5", style: "color:#9DB3A8" });
    const rim = svgEl("use", { href: "#" + id, transform: "translate(-2.6 -2.1)", style: "color:#E9B949" });
    const bodyWrap = svgEl("g", { style: "color:#040C0A" });
    const body = svgEl("g", { id, stroke: "currentColor", fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" });
    const L = (w) => { const n = svgEl("line", { "stroke-width": w }); body.appendChild(n); return n; };
    const parts = {};
    parts.aBu = L(12); parts.aBl = L(10);
    parts.fistB = svgEl("circle", { r: 6.2, fill: "currentColor", stroke: "none" }); body.appendChild(parts.fistB);
    parts.lBu = L(18); parts.lBl = L(14); parts.footB = L(8);
    parts.sheath = L(5);
    parts.torso = svgEl("path", { fill: "currentColor", "stroke-width": 7 }); body.appendChild(parts.torso);
    parts.neck = L(10);
    parts.headC = svgEl("circle", { r: HEAD, fill: "currentColor", stroke: "none" }); body.appendChild(parts.headC);
    parts.knot = svgEl("circle", { r: 4.6, fill: "currentColor", stroke: "none" }); body.appendChild(parts.knot);
    parts.band = svgEl("path", { "stroke-width": 3.2 }); body.appendChild(parts.band);
    parts.lFu = L(18); parts.lFl = L(14); parts.footF = L(8);
    parts.aFu = L(12); parts.aFl = L(10);
    parts.fistF = svgEl("circle", { r: 6.4, fill: "currentColor", stroke: "none" }); body.appendChild(parts.fistF);
    parts.hilt = L(5);
    bodyWrap.appendChild(body);
    const sash = svgEl("path", { stroke: "#E9B949", "stroke-width": 3.4, fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" });
    const blade = svgEl("g", { "stroke-linecap": "round" });
    const bHilt = svgEl("line", { stroke: "#040C0A", "stroke-width": 5.5 });
    const bSteel = svgEl("line", { stroke: "#E6EAE3", "stroke-width": 3 });
    const bEdge = svgEl("line", { stroke: "#E9B949", "stroke-width": 1.1 });
    const bGuard = svgEl("line", { stroke: "#E9B949", "stroke-width": 3 });
    blade.append(bSteel, bEdge, bHilt, bGuard);
    root.append(fill, rim, bodyWrap, sash, blade);
    svg.append(shadow, root);
    wrap.appendChild(svg);
    $("fighters").appendChild(wrap);

    const ln = (n, a, b) => { n.setAttribute("x1", f1(a[0])); n.setAttribute("y1", f1(a[1])); n.setAttribute("x2", f1(b[0])); n.setAttribute("y2", f1(b[1])); };

    function pose(p, face, rot, wind) {
      const H0 = [0, 0];
      const ta = 180 - p.lean;
      const S0 = add(H0, ta, TORSO - 6), N0 = add(H0, ta, TORSO);
      const C0 = add(N0, ta - p.head, HEAD + 5);
      const E1 = add(S0, p.aFu, UA), F1 = add(E1, p.aFl, FA);
      const E2 = add(S0, p.aBu, UA), F2 = add(E2, p.aBl, FA);
      const K1 = add(H0, p.lFu, TH), A1 = add(K1, p.lFl, SH);
      const K2 = add(H0, p.lBu, TH), A2 = add(K2, p.lBl, SH);
      const g = Math.max(A1[1], A2[1]) + 6 + p.air;
      const T = (q) => [q[0], q[1] - g];
      const H = T(H0), S = T(S0), N = T(N0), C = T(C0);
      ln(parts.aBu, S, T(E2)); ln(parts.aBl, T(E2), T(F2));
      parts.fistB.setAttribute("cx", f1(F2[0])); parts.fistB.setAttribute("cy", f1(F2[1] - g));
      ln(parts.lBu, H, T(K2)); ln(parts.lBl, T(K2), T(A2)); ln(parts.footB, T(A2), T(add(A2, p.lBl + 90, 9)));
      ln(parts.lFu, H, T(K1)); ln(parts.lFl, T(K1), T(A1)); ln(parts.footF, T(A1), T(add(A1, p.lFl + 90, 10)));
      ln(parts.aFu, S, T(E1)); ln(parts.aFl, T(E1), T(F1));
      parts.fistF.setAttribute("cx", f1(F1[0])); parts.fistF.setAttribute("cy", f1(F1[1] - g));
      // torso as a tapered block: narrow at the hip, broad at the shoulder
      const fw = ta - 90; // forward perpendicular
      const h1 = add(H, fw, 8), h2 = add(H, fw, -9), s1 = add(S, fw, 16), s2 = add(S, fw, -17);
      parts.torso.setAttribute("d", "M" + f1(h1[0]) + " " + f1(h1[1]) + "L" + f1(s1[0]) + " " + f1(s1[1]) + "L" + f1(s2[0]) + " " + f1(s2[1]) + "L" + f1(h2[0]) + " " + f1(h2[1]) + "Z");
      ln(parts.neck, S, N);
      parts.headC.setAttribute("cx", f1(C[0])); parts.headC.setAttribute("cy", f1(C[1]));
      const kn = add(C, ta - p.head - 60, HEAD + 1);
      parts.knot.setAttribute("cx", f1(kn[0])); parts.knot.setAttribute("cy", f1(kn[1]));
      // headband tails stream behind; wind comes from travel speed
      const bb = add(C, ta - p.head - 95, HEAD - 1);
      const t1 = add(bb, -78 - wind, 20), t2 = add(bb, -62 - wind * 0.8, 16);
      parts.band.setAttribute("d", "M" + f1(bb[0]) + " " + f1(bb[1]) + "L" + f1(t1[0]) + " " + f1(t1[1]) + "M" + f1(bb[0]) + " " + f1(bb[1]) + "L" + f1(t2[0]) + " " + f1(t2[1]));
      // scabbard across the back; hilt shows over the shoulder while the blade is sheathed
      const sb = add(add(H, ta, 6), fw, -15), st = add(add(S, ta, 10), fw, -5);
      ln(parts.sheath, sb, st);
      const hl = add(st, ta + 12, 14 * (1 - p.bOn));
      ln(parts.hilt, st, hl);
      // sash knot at the waist, tails trailing
      const w0 = add(add(H, ta, 7), fw, -9), w1 = add(add(H, ta, 7), fw, 8);
      const wt = add(w0, -55 - wind * 0.6, 18);
      sash.setAttribute("d", "M" + f1(w1[0]) + " " + f1(w1[1]) + "L" + f1(w0[0]) + " " + f1(w0[1]) + "L" + f1(wt[0]) + " " + f1(wt[1]));
      // blade
      const F = T(F1);
      blade.setAttribute("opacity", f1(clamp(p.bOn * 1.4 - 0.2, 0, 1)));
      ln(bHilt, add(F, p.blade, -12), add(F, p.blade, 4));
      ln(bSteel, add(F, p.blade, 7), add(F, p.blade, 86));
      ln(bEdge, add(add(F, p.blade, 9), p.blade + 90, 1.6), add(add(F, p.blade, 82), p.blade + 90, 1.6));
      ln(bGuard, add(add(F, p.blade, 5), p.blade + 90, -6), add(add(F, p.blade, 5), p.blade + 90, 6));
      root.setAttribute("transform", "rotate(" + f1(rot) + ") scale(" + f1(face * 100) / 100 + " 1)");
      shadow.setAttribute("rx", f1(46 - p.air * 0.4));
    }
    return { wrap, pose };
  }

  function blend(a, b, t) {
    const o = {};
    for (const k of KEYS) o[k] = lerp(a[k], b[k], t);
    return o;
  }

  /* ---------- Track geometry ---------- */
  const track = $("track");
  const ink = [$("ink"), $("strandA"), $("strandB"), $("edge")];
  const ghost = $("ghost");
  const sections = Array.from(document.querySelectorAll(".s[data-track]"));
  let G = null; // layout state
  let hero = null;
  const statics = [];

  function layout() {
    const W = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const sy = window.scrollY;
    const narrow = W < 760;
    const stage = document.querySelector(".stage");
    stage.style.transform = "";
    const docH = document.documentElement.scrollHeight;
    track.setAttribute("width", W); track.setAttribute("height", docH);
    track.style.height = docH + "px";
    track.setAttribute("viewBox", "0 0 " + W + " " + docH);

    const secs = sections.map((s) => {
      const r = s.getBoundingClientRect();
      return { el: s, top: r.top + sy, h: r.height, bottom: r.bottom + sy, side: s.dataset.track, scene: s.dataset.scene };
    });
    const roofEl = document.querySelector(".hero .roof");
    const roofH = roofEl ? roofEl.offsetHeight : 132;
    const pts = [];
    secs.forEach((s, i) => {
      const cx = narrow ? 30 : (s.side === "L" ? W * 0.17 : W * 0.8);
      const amp = narrow ? 10 : W * 0.045;
      if (i === 0) {
        pts.push([cx, s.bottom - roofH, 0]);
        return;
      }
      const last = i === secs.length - 1;
      const yA = s.top + 140, yB = last ? s.bottom - roofH : s.bottom - 150;
      const n = Math.max(1, Math.round((yB - yA) / 420));
      for (let j = 0; j <= n; j++) {
        const x = last && j === n ? cx + amp * 0.4 : cx + amp * (j % 2 ? 1 : -1) * (j === 0 ? 0.3 : 1);
        pts.push([x, yA + ((yB - yA) * j) / n, j === 0 ? 1 : 0]);
      }
    });
    let d = "M" + f1(pts[0][0]) + " " + f1(pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], dy = b[1] - a[1], dx = b[0] - a[0];
      if (b[2]) { // a crossing between sections: a long blade-slash
        d += "C" + f1(a[0] + dx * 0.04) + " " + f1(a[1] + dy * 0.7) + " " + f1(b[0] - dx * 0.04) + " " + f1(b[1] - dy * 0.7) + " " + f1(b[0]) + " " + f1(b[1]);
      } else {
        d += "C" + f1(a[0]) + " " + f1(a[1] + dy * 0.5) + " " + f1(b[0]) + " " + f1(b[1] - dy * 0.5) + " " + f1(b[0]) + " " + f1(b[1]);
      }
    }
    ghost.setAttribute("d", d);
    ink.forEach((p) => p.setAttribute("d", d));
    ink[0].setAttribute("stroke-width", narrow ? 4.5 : 7);
    const len = ink[0].getTotalLength();
    // sample once; per frame we only read arrays
    const step = 5, N = Math.ceil(len / step) + 1;
    const xs = new Float32Array(N), ys = new Float32Array(N);
    let my = -1e9;
    for (let i = 0; i < N; i++) {
      const p = ink[0].getPointAtLength(Math.min(len, i * step));
      xs[i] = p.x; my = Math.max(my, p.y); ys[i] = my;
    }
    ink.forEach((p) => { p.style.strokeDasharray = len + " " + (len + 20); });

    // clip: light ink on dark scenes, dark ink on the dawn section
    const dawn = secs[secs.length - 1];
    const setR = (id, x, y, w, h) => { const r = $(id); r.setAttribute("x", x); r.setAttribute("y", y); r.setAttribute("width", w); r.setAttribute("height", Math.max(0, h)); };
    setR("clipDarkA", -50, 0, W + 100, dawn.top);
    setR("clipDarkB", -50, dawn.bottom, W + 100, docH - dawn.bottom);
    setR("clipDawnR", -50, dawn.top, W + 100, dawn.h);

    // pose keyframes in document y
    const kf = [];
    secs.forEach((s, i) => {
      const list = CHOREO[s.scene] || [[0, "guard"]];
      if (i > 0) {
        const prev = kf[kf.length - 1].pose;
        const next = P[list[0][1]];
        kf.push({ y: s.top + 30, pose: prev.bOn > 0.5 && next.bOn > 0.5 ? P.leapB : P.leap });
      }
      list.forEach(([f, name]) => kf.push({ y: s.top + f * s.h, pose: P[name] }));
      if (i === 0) kf.push({ y: pts[0][1] + 1, pose: P[list[list.length - 1][1]] });
    });

    // parallax layers
    const layers = [];
    secs.forEach((s) => s.el.querySelectorAll(".layer").forEach((l) => layers.push({ el: l, depth: parseFloat(l.dataset.depth) || 0, s })));

    // reviews stage
    const reads = secs.find((s) => s.scene === "dojo");
    const quotes = Array.from(document.querySelectorAll("#quotes li"));
    const meterRows = Array.from(document.querySelectorAll("#meter li")).map((li) => ({ blocks: li.querySelectorAll(".blocks i"), v: +li.dataset.v || 0, shown: -1 }));
    const sticky = !narrow && !reduced;
    const convo = $("convo");
    const convoTop = convo.getBoundingClientRect().top + sy;
    const slipTop = $("slip").getBoundingClientRect().top + sy;
    const scale = narrow ? 0.5 : clamp((W / 1440) * 1.18, 0.72, 1.25);
    G = { W, vh, narrow, docH, len, step, N, xs, ys, kf, layers, reads, quotes, meterRows, sticky, convoTop, slipTop, scale, secs, stage };
    setupDrift();
    if (reduced) placeStatics();
  }

  function lenAtY(y) {
    const ys = G.ys;
    if (y <= ys[0]) return 0;
    if (y >= ys[G.N - 1]) return G.len;
    let lo = 0, hi = G.N - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ys[m] < y) lo = m; else hi = m; }
    const t = ys[hi] === ys[lo] ? 0 : (y - ys[lo]) / (ys[hi] - ys[lo]);
    return Math.min(G.len, (lo + t) * G.step);
  }
  function ptAt(l) {
    const f = clamp(l / G.step, 0, G.N - 1), i = Math.floor(f), j = Math.min(G.N - 1, i + 1), t = f - i;
    const x = lerp(G.xs[i], G.xs[j], t), y = lerp(G.ys[i], G.ys[j], t);
    const a = Math.max(0, i - 3), b = Math.min(G.N - 1, i + 4);
    return { x, y, dx: G.xs[b] - G.xs[a], dy: G.ys[b] - G.ys[a] };
  }
  function poseAtY(y) {
    const kf = G.kf;
    if (y <= kf[0].y) return kf[0].pose;
    for (let i = 1; i < kf.length; i++) {
      if (y < kf[i].y) {
        const t = (y - kf[i - 1].y) / (kf[i].y - kf[i - 1].y);
        return blend(kf[i - 1].pose, kf[i].pose, ease(t));
      }
    }
    return kf[kf.length - 1].pose;
  }
  function sectionAt(y) {
    for (const s of G.secs) if (y < s.bottom) return s;
    return G.secs[G.secs.length - 1];
  }
  function place(f, x, y, s) {
    f.wrap.style.transform = "translate3d(" + f1(x - 100 * s) + "px," + f1(y - 230 * s) + "px,0) scale(" + s + ")";
  }

  /* ---------- Reviews drift: quotes float in, then settle into the slip ---------- */
  let drift = [];
  function setupDrift() {
    drift.forEach((d) => d.ghost.remove());
    drift = [];
    if (!G.sticky || G.W < 1180) { G.quotes.forEach((q) => (q.style.opacity = "")); return; }
    const board = $("board"), br = board.getBoundingClientRect();
    const S = 1.12;
    G.quotes.forEach((q, i) => {
      const r = q.getBoundingClientRect();
      const gq = q.cloneNode(true);
      gq.classList.add("drift");
      gq.setAttribute("aria-hidden", "true");
      const fx = r.left - br.left, fy = r.top - br.top;
      Object.assign(gq.style, { position: "absolute", left: fx + "px", top: fy + "px", width: "max-content", maxWidth: r.width + "px", margin: 0, pointerEvents: "none" });
      board.appendChild(gq);
      // start in the open space beside the heading, larger, then fall into the slip
      const gw = gq.offsetWidth;
      const sx = Math.max(0, br.width - gw * S), sy = -372 + i * 100;
      drift.push({ ghost: gq, q, dx: sx - fx, dy: sy - fy, s: S });
    });
  }

  /* ---------- Frame ---------- */
  let shown = -1, face = 1, lastL = 0, ticking = false, typedN = -1;
  function frame() {
    ticking = false;
    if (!G) return;
    const sy = AT || window.scrollY, vh = G.vh;
    if (AT && G.stage && G.sticky) {
      const st = clamp(sy - G.reads.top, 0, G.reads.h - G.stage.offsetHeight);
      G.stage.style.transform = "translateY(" + st + "px)";
    }
    const target = lenAtY(sy + vh * 0.62);
    const snap = shown < 0;
    if (snap) shown = target;
    shown += (target - shown) * 0.22;
    if (Math.abs(target - shown) < 0.4) shown = target;
    const off = f1(G.len - shown);
    for (const p of ink) p.style.strokeDashoffset = off;

    const pt = ptAt(shown);
    if (snap) lastL = shown;
    const v = shown - lastL; lastL = shown;
    const s = sectionAt(pt.y);
    const n = Math.hypot(pt.dx, pt.dy) || 1;
    const ux = pt.dx / n;
    const want = G.narrow ? 1 : Math.abs(ux) > 0.55 ? Math.sign(ux) : s.side === "L" ? 1 : -1;
    if (snap) face = want;
    face += (want - face) * 0.2;
    if (Math.abs(want - face) < 0.01) face = want;
    if (Math.abs(face) < 0.08) face = face < 0 ? -0.08 : 0.08;
    const rot = clamp(Math.atan2(pt.dx, Math.max(1, pt.dy)) / rad * 0.18, -14, 14);
    const wind = clamp(Math.abs(v) * 1.6, 0, 55);
    hero.pose(poseAtY(pt.y), face, rot, wind);
    place(hero, pt.x, pt.y, G.scale);

    // parallax, only for layers near the viewport
    for (const L of G.layers) {
      if (L.s.bottom < sy - 200 || L.s.top > sy + vh + 200) continue;
      const c = (L.s.top + L.s.h / 2) - (sy + vh / 2);
      L.el.style.transform = "translate3d(0," + f1(c * L.depth) + "px,0)";
    }

    // reviews: progress through the sticky stage
    let rp;
    if (G.sticky) rp = clamp((sy - G.reads.top) / Math.max(1, G.reads.h - vh), 0, 1);
    else rp = clamp((vh * 0.9 - (G.slipTop - sy)) / (vh * 0.5), 0, 1);
    for (let i = 0; i < drift.length; i++) {
      const d = drift[i];
      const a = clamp((rp - 0.04 - i * 0.08) / 0.4, 0, 1), e = a * a * (3 - 2 * a);
      const tx = d.dx * (1 - e), ty = d.dy * (1 - e), sc = lerp(d.s, 1, e);
      d.ghost.style.transform = "translate3d(" + f1(tx) + "px," + f1(ty) + "px,0) scale(" + f1(sc * 100) / 100 + ")";
      d.ghost.style.opacity = f1(clamp(rp * 8 - i, 0, 1) * (1 - clamp((e - 0.85) / 0.15, 0, 1)) * 100) / 100;
      d.q.style.opacity = f1(clamp((e - 0.8) / 0.2, 0, 1) * 100) / 100;
    }
    G.meterRows.forEach((m, i) => {
      const k = clamp((rp - 0.3 - i * 0.07) / 0.3, 0, 1);
      const on = Math.round(k * m.v);
      if (on !== m.shown) { m.shown = on; m.blocks.forEach((b, j) => b.classList.toggle("on", j < on)); }
    });

    // chat: typing follows the scroll, answers arrive once the question is complete
    const tp = clamp((vh * 0.86 - (G.convoTop - sy)) / (vh * 0.42), 0, 1);
    typeTo(Math.round(tp * Q.length));

    if (shown !== target || Math.abs(want - face) > 0.01) request();
  }
  const Q = "Swordplay instead of gunfights tonight. What have you got?";
  function typeTo(n) {
    if (n === typedN) return;
    typedN = n;
    $("typed").textContent = Q.slice(0, n);
    $("untyped").textContent = Q.slice(n);
    $("convo").classList.toggle("done", n >= Q.length);
    $("answer").classList.toggle("wait", n < Q.length);
  }
  function request() { if (!ticking) { ticking = true; requestAnimationFrame(frame); } }

  /* ---------- Reduced motion: one still fighter per scene, full path ---------- */
  function placeStatics() {
    statics.forEach((f) => f.wrap.remove());
    statics.length = 0;
    for (const p of ink) { p.style.strokeDashoffset = "0"; }
    G.secs.forEach((s) => {
      const f = makeFighter();
      const y = s.scene === "roof" || s.scene === "dawn" ? s.bottom - 1 : s.top + s.h * 0.5;
      const pt = ptAt(lenAtY(y));
      f.pose(P[SIGNATURE[s.scene]] || P.guard, G.narrow || s.side === "L" ? 1 : -1, 0, 0);
      place(f, pt.x, pt.y, G.scale);
      statics.push(f);
    });
    G.meterRows.forEach((m) => m.blocks.forEach((b, j) => b.classList.toggle("on", j < m.v)));
    typeTo(Q.length);
  }

  /* ---------- Boot ---------- */
  function relayout() {
    document.body.style.transform = "";
    layout();
    jumpTo();
    if (!reduced) { shown = -1; request(); }
  }
  let rq = 0;
  function onResize() { cancelAnimationFrame(rq); rq = requestAnimationFrame(relayout); }

  contact();
  if (!reduced) hero = makeFighter();
  // ?at=<px> previews a scroll position. Headless screenshots ignore real scrolling,
  // so the page is shifted with a transform and the engine reads that offset instead.
  const jumpTo = () => {
    if (!AT) return;
    document.body.style.transform = "translateY(" + -AT + "px)";
    shown = -1;
  };
  const start = (d) => {
    build(d);
    layout();
    jumpTo();
    if (!reduced) { frame(); addEventListener("scroll", request, { passive: true }); }
    addEventListener("resize", onResize, { passive: true });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { relayout(); if (!reduced) frame(); });
  };
  typeTo(0);
  fetch("/data.json", { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then(start);
})();
