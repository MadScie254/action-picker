from __future__ import annotations

import hashlib
import re
import time
from pathlib import Path
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

import requests
from bs4 import BeautifulSoup

_BLOCK_PHRASES = re.compile(r"captcha|verify you are human|are you a robot|access denied", re.IGNORECASE)
_MIN_CHARS = 200


class ReviewFetcher:
    """Polite page fetcher: robots.txt, delay between requests, disk cache, honest UA."""

    def __init__(
        self,
        cache_dir: str,
        delay: float = 2.5,
        user_agent: str = "ActionPicker/0.1 (personal use)",
        session: requests.Session | None = None,
        sleep=time.sleep,
        clock=time.monotonic,
    ) -> None:
        self.cache = Path(cache_dir)
        self.cache.mkdir(parents=True, exist_ok=True)
        self.delay = delay
        self.user_agent = user_agent
        self.session = session or requests.Session()
        self._sleep = sleep
        self._clock = clock
        self._last: float | None = None
        self._robots: dict[str, RobotFileParser] = {}

    def _paths(self, url: str) -> tuple[Path, Path]:
        key = hashlib.sha256(url.encode()).hexdigest()
        return self.cache / f"{key}.txt", self.cache / f"{key}.skip"

    def _get(self, url: str) -> requests.Response | None:
        if self._last is not None:
            wait = self.delay - (self._clock() - self._last)
            if wait > 0:
                self._sleep(wait)
        try:
            return self.session.get(
                url, headers={"User-Agent": self.user_agent}, timeout=15
            )
        except requests.RequestException:
            return None
        finally:
            self._last = self._clock()

    def _allowed(self, url: str) -> bool:
        parts = urlparse(url)
        host = f"{parts.scheme}://{parts.netloc}"
        parser = self._robots.get(host)
        if parser is None:
            parser = RobotFileParser()
            resp = self._get(f"{host}/robots.txt")
            if resp is None or resp.status_code >= 500 or resp.status_code in (401, 403):
                parser.disallow_all = True
            elif resp.status_code == 200:
                parser.parse(resp.text.splitlines())
            else:
                parser.parse([])  # 404 and friends: no rules, allow all
            self._robots[host] = parser
        return parser.can_fetch("ActionPicker", url)

    @staticmethod
    def _extract(html: str) -> str:
        soup = BeautifulSoup(html, "html.parser")
        for tag in soup(["script", "style", "nav", "header", "footer", "aside", "form", "noscript"]):
            tag.decompose()
        paragraphs = [p.get_text(" ", strip=True) for p in soup.find_all("p")]
        text = "\n".join(p for p in paragraphs if p) or soup.get_text(" ", strip=True)
        return text.strip()

    def fetch(self, url: str) -> str | None:
        hit, skip = self._paths(url)
        if hit.exists():
            return hit.read_text()
        if skip.exists():
            return None
        if not self._allowed(url):
            skip.write_text("robots")
            return None
        resp = self._get(url)
        if resp is None:
            return None  # network error: not cached, retry next run
        if resp.status_code != 200:
            skip.write_text(str(resp.status_code))
            return None
        text = self._extract(resp.text)
        if len(text) < _MIN_CHARS or (len(text) < 1500 and _BLOCK_PHRASES.search(text)):
            skip.write_text("empty-or-blocked")
            return None
        hit.write_text(text)
        return text
