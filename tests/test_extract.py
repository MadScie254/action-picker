from actionpicker.extract import compute_content_hash, extract_scores
from actionpicker.llm import LlmError
from actionpicker.models import Review, Title

TITLE = Title(7, 100, "series", "Warrior", 2019, "Tong wars", 8.2, 900)
REVIEWS = [Review("https://a.test/1", "Brutal hatchet fights."), Review("https://b.test/2", "Fast.")]

GOOD = {
    "fight_quality": 9,
    "style": "hand_to_hand",
    "action_density": 8,
    "grit": 8,
    "crime_tone": 6,
    "pacing": 7,
    "evidence": [{"text": "brutal, grounded fights", "url": "https://a.test/1"}],
}


class FakeLlm:
    def __init__(self, *outputs):
        self.outputs = list(outputs)
        self.prompts: list[str] = []

    def __call__(self, prompt, schema):
        self.prompts.append(prompt)
        out = self.outputs.pop(0)
        if isinstance(out, Exception):
            raise out
        return out


def run(llm, reviews=REVIEWS, season_no=2, season_id=55):
    return extract_scores(TITLE, season_no, season_id, reviews, llm=llm)


def test_extract_valid_result_maps_to_scores():
    s = run(FakeLlm(GOOD))
    assert (s.title_id, s.season_id, s.review_count) == (7, 55, 2)
    assert (s.fight_quality, s.style, s.action_density) == (9, "hand_to_hand", 8)
    assert s.evidence == [{"text": "brutal, grounded fights", "url": "https://a.test/1"}]
    assert s.content_hash == compute_content_hash(REVIEWS)


def test_extract_rejects_out_of_range_then_retries_once():
    llm = FakeLlm({**GOOD, "fight_quality": 11}, GOOD)
    s = run(llm)
    assert s is not None and s.fight_quality == 9
    assert len(llm.prompts) == 2


def test_extract_invalid_after_retry_returns_none():
    llm = FakeLlm({**GOOD, "style": "kung_fu_magic"}, {**GOOD, "style": "kung_fu_magic"})
    assert run(llm) is None
    assert len(llm.prompts) == 2


def test_extract_all_numeric_null_is_rejected():
    empty = {**GOOD, **{k: None for k in ("fight_quality", "action_density", "grit", "crime_tone", "pacing")}}
    llm = FakeLlm(empty, empty)
    assert run(llm) is None
    assert len(llm.prompts) == 2


def test_extract_empty_reviews_makes_no_llm_call():
    llm = FakeLlm()
    assert run(llm, reviews=[]) is None
    assert llm.prompts == []


def test_extract_null_fields_preserved():
    s = run(FakeLlm({**GOOD, "grit": None, "pacing": None}))
    assert s.grit is None and s.pacing is None and s.fight_quality == 9


def test_extract_evidence_capped_at_two():
    ev = [{"text": f"point {i}", "url": "https://a.test/1"} for i in range(3)]
    s = run(FakeLlm({**GOOD, "evidence": ev}))
    assert len(s.evidence) == 2


def test_extract_llm_error_retries_once():
    llm = FakeLlm(LlmError("boom"), GOOD)
    assert run(llm) is not None
    assert len(llm.prompts) == 2


def test_prompt_names_season_and_includes_reviews_and_no_invent_rule():
    llm = FakeLlm(GOOD)
    run(llm)
    p = llm.prompts[0]
    assert "Warrior" in p and "season 2" in p.lower()
    assert "Brutal hatchet fights." in p and "https://b.test/2" in p
    assert "null" in p and "never invent" in p.lower()
