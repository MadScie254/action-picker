from __future__ import annotations

import html as htmllib
import smtplib
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from email.message import EmailMessage

from .models import Title
from .rank import Ranked, Weights, rank
from .store import Store

_ATTRIBUTION = (
    "This product uses the TMDB API but is not endorsed or certified by TMDB. "
    "Streaming availability data comes from TMDB (provided by JustWatch)."
)


@dataclass
class DigestItem:
    ranked: Ranked
    watch: list[str]
    season_no: int | None = None

    @property
    def reason(self) -> str:
        ev = self.ranked.scores.evidence
        return ev[0]["text"] if ev else "no review excerpt available"

    @property
    def label(self) -> str:
        t = self.ranked.title
        base = f"{t.name} ({t.year})" if t.year else t.name
        return f"{base} - Season {self.season_no}" if self.season_no else base

    @property
    def link(self) -> str:
        t = self.ranked.title
        return f"https://www.themoviedb.org/{'tv' if t.kind == 'series' else 'movie'}/{t.tmdb_id}"


@dataclass
class Digest:
    movies: list[DigestItem]
    series: list[DigestItem]
    crime_pick: DigestItem | None

    def items(self) -> list[DigestItem]:
        crime = [self.crime_pick] if self.crime_pick else []
        return [*self.movies, *self.series, *crime]


@dataclass
class SmtpConfig:
    user: str
    password: str
    to: str
    host: str = "smtp.gmail.com"
    port: int = 465


def build_digest(
    store: Store, w: Weights, providers: Callable[[Title], list[str]]
) -> Digest | None:
    cands = store.all_scored()
    exclude: set[tuple[int, int | None]] = {(i, None) for i in store.seen_ids()}
    exclude |= {(tid, None) for tid, _ in store.sent_keys()}  # whole title, so no other season resurfaces

    def item(r: Ranked) -> DigestItem:
        return DigestItem(r, providers(r.title), store.season_no(r.scores.season_id))

    ranked = rank(cands, w, "action", exclude)
    movies = [item(r) for r in ranked if r.title.kind == "movie"][:5]
    series = [item(r) for r in ranked if r.title.kind == "series"][:5]
    listed = {it.ranked.title.id for it in movies + series}
    crime = rank(cands, w, "crime", exclude | {(i, None) for i in listed})
    crime_pick = item(crime[0]) if crime else None
    if not (movies or series or crime_pick):
        return None
    return Digest(movies, series, crime_pick)


def _sections(d: Digest) -> list[tuple[str, list[DigestItem]]]:
    sections = [("MOVIES", d.movies), ("SERIES", d.series)]
    if d.crime_pick:
        sections.append(("CRIME PICK", [d.crime_pick]))
    return [(name, items) for name, items in sections if items]


def render(d: Digest) -> tuple[str, str]:
    esc = htmllib.escape
    text = ["ActionPicker weekly picks", ""]
    html = ["<h2>ActionPicker weekly picks</h2>"]
    for name, items in _sections(d):
        text.append(name)
        html.append(f"<h3>{esc(name.title())}</h3><ol>")
        for n, it in enumerate(items, start=1):
            r = it.ranked
            watch = ", ".join(it.watch) if it.watch else "unknown"
            text += [
                f"{n}. {it.label} - {r.value:.1f}/10 - {r.scores.style}",
                f"   Why: {it.reason}",
                f"   Where to watch: {watch}",
                f"   {it.link}",
            ]
            html.append(
                f"<li><b>{esc(it.label)}</b> - {r.value:.1f}/10 - {esc(r.scores.style)}<br>"
                f"Why: {esc(it.reason)}<br>Where to watch: {esc(watch)}<br>"
                f'<a href="{esc(it.link)}">{esc(it.link)}</a></li>'
            )
        text.append("")
        html.append("</ol>")
    text.append(_ATTRIBUTION)
    html.append(f"<p><small>{esc(_ATTRIBUTION)}</small></p>")
    return "\n".join(text), "\n".join(html)


def send(
    d: Digest, smtp: SmtpConfig, store: Store, smtp_factory=smtplib.SMTP_SSL
) -> None:
    text, html = render(d)
    msg = EmailMessage()
    msg["Subject"] = f"ActionPicker: this week's picks ({datetime.now(tz=UTC).date().isoformat()})"
    msg["From"], msg["To"] = smtp.user, smtp.to
    msg.set_content(text)
    msg.add_alternative(html, subtype="html")
    with smtp_factory(smtp.host, smtp.port) as server:
        server.login(smtp.user, smtp.password)
        server.send_message(msg)
    for it in d.items():  # only after a successful send
        store.mark_sent(it.ranked.title.id, it.ranked.scores.season_id)
