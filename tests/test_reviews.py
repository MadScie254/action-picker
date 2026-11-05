import responses

from actionpicker.sources.reviews import ReviewFetcher
from actionpicker.sources.search import find_review_urls

ROBOTS_URL = "https://site.test/robots.txt"
PAGE_URL = "https://site.test/reviews/ip-man"
ARTICLE = (
    "<html><head><script>var x=1;</script></head><body><nav>menu menu</nav>"
    "<article><p>" + "The Wing Chun choreography in this film is superb and grounded. " * 6
    + "</p><p>Donnie Yen fights ten men with brutal speed.</p></article></body></html>"
)


def fetcher(tmp_path, **kw) -> ReviewFetcher:
    kw.setdefault("delay", 2.5)
    return ReviewFetcher(cache_dir=str(tmp_path), **kw)


@responses.activate
def test_fetch_returns_clean_article_text(tmp_path):
    responses.add(responses.GET, ROBOTS_URL, status=404)
    responses.add(responses.GET, PAGE_URL, body=ARTICLE)
    text = fetcher(tmp_path, sleep=lambda s: None).fetch(PAGE_URL)
    assert "Wing Chun choreography" in text
    assert "menu menu" not in text and "var x" not in text


@responses.activate
def test_fetch_respects_robots_disallow(tmp_path):
    responses.add(responses.GET, ROBOTS_URL, body="User-agent: *\nDisallow: /reviews/")
    page = responses.add(responses.GET, PAGE_URL, body=ARTICLE)
    assert fetcher(tmp_path, sleep=lambda s: None).fetch(PAGE_URL) is None
    assert page.call_count == 0


@responses.activate
def test_fetch_uses_disk_cache_second_call(tmp_path):
    responses.add(responses.GET, ROBOTS_URL, status=404)
    page = responses.add(responses.GET, PAGE_URL, body=ARTICLE)
    f = fetcher(tmp_path, sleep=lambda s: None)
    first = f.fetch(PAGE_URL)
    second = fetcher(tmp_path, sleep=lambda s: None).fetch(PAGE_URL)
    assert first == second and first is not None
    assert page.call_count == 1


@responses.activate
def test_fetch_403_returns_none(tmp_path):
    responses.add(responses.GET, ROBOTS_URL, status=404)
    responses.add(responses.GET, PAGE_URL, status=403)
    assert fetcher(tmp_path, sleep=lambda s: None).fetch(PAGE_URL) is None


@responses.activate
def test_blocked_page_is_not_refetched(tmp_path):
    responses.add(responses.GET, ROBOTS_URL, status=404)
    page = responses.add(responses.GET, PAGE_URL, status=403)
    fetcher(tmp_path, sleep=lambda s: None).fetch(PAGE_URL)
    fetcher(tmp_path, sleep=lambda s: None).fetch(PAGE_URL)
    assert page.call_count == 1


@responses.activate
def test_fetch_captcha_or_tiny_page_returns_none(tmp_path):
    responses.add(responses.GET, ROBOTS_URL, status=404)
    responses.add(
        responses.GET, PAGE_URL, body="<html><body><p>Please verify you are human. CAPTCHA</p></body></html>"
    )
    assert fetcher(tmp_path, sleep=lambda s: None).fetch(PAGE_URL) is None


@responses.activate
def test_fetch_waits_delay_between_requests(tmp_path):
    responses.add(responses.GET, ROBOTS_URL, status=404)
    responses.add(responses.GET, PAGE_URL, body=ARTICLE)
    sleeps: list[float] = []
    fetcher(tmp_path, sleep=sleeps.append, clock=lambda: 100.0).fetch(PAGE_URL)
    assert sleeps == [2.5]


@responses.activate
def test_fetch_sends_honest_user_agent(tmp_path):
    responses.add(responses.GET, ROBOTS_URL, status=404)
    page = responses.add(responses.GET, PAGE_URL, body=ARTICLE)
    fetcher(tmp_path, sleep=lambda s: None).fetch(PAGE_URL)
    assert page.calls[0].request.headers["User-Agent"].startswith("ActionPicker/")


class FakeDDGS:
    def text(self, query, max_results=10):
        return [
            {"href": "https://a.test/review"},
            {"href": "ftp://bad.test/x"},
            {"href": "https://a.test/review"},
            {"href": "javascript:alert(1)"},
            {"href": "https://b.test/review"},
            {"href": "https://c.test/review"},
        ]


def test_find_review_urls_filters_dedupes_and_limits():
    urls = find_review_urls("Ip Man 2", 2010, limit=2, ddgs=FakeDDGS())
    assert urls == ["https://a.test/review", "https://b.test/review"]
