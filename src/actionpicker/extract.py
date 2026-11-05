from __future__ import annotations

import hashlib
from typing import Literal

from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator

from .llm import LlmError, LlmOutputError, complete_json
from .models import Review, Scores, Title

Style = Literal["hand_to_hand", "swordplay", "wuxia", "gun_fu", "brawl", "mixed", "other"]
Score10 = int | None

_NUMERIC = ("fight_quality", "action_density", "grit", "crime_tone", "pacing")
_PER_REVIEW_CHARS = 6000
_TOTAL_CHARS = 24000


class Evidence(BaseModel):
    text: str = Field(max_length=300)
    url: str


class ExtractionResult(BaseModel):
    fight_quality: Score10 = Field(default=None, ge=0, le=10)
    style: Style
    action_density: Score10 = Field(default=None, ge=0, le=10)
    grit: Score10 = Field(default=None, ge=0, le=10)
    crime_tone: Score10 = Field(default=None, ge=0, le=10)
    pacing: Score10 = Field(default=None, ge=0, le=10)
    evidence: list[Evidence] = Field(default_factory=list)

    @field_validator("evidence", mode="before")
    @classmethod
    def _cap_evidence(cls, v):
        return v[:2] if isinstance(v, list) else v

    @model_validator(mode="after")
    def _not_all_null(self):
        if all(getattr(self, name) is None for name in _NUMERIC):
            raise ValueError("every numeric field is null; reviews gave no usable signal")
        return self


def compute_content_hash(reviews: list[Review]) -> str:
    joined = "\n".join(sorted(r.text for r in reviews))
    return hashlib.sha256(joined.encode()).hexdigest()


def _prompt(title: Title, season_no: int | None, reviews: list[Review], error: str = "") -> str:
    scope = f"{title.name} ({title.year or 'year unknown'})"
    if season_no is not None:
        scope += f", season {season_no}"
    parts, used = [], 0
    for r in reviews:
        chunk = r.text[:_PER_REVIEW_CHARS]
        if used + len(chunk) > _TOTAL_CHARS:
            break
        parts.append(f"SOURCE {r.url}\n{chunk}")
        used += len(chunk)
    lines = [
        f"You rate the action and fight content of {scope} using ONLY the review text below.",
        "Scores are integers 0-10. style is the dominant fight style.",
        "action_density is how much of the runtime is action. grit is violence and seriousness.",
        "crime_tone is underworld, revenge, cops and criminals. pacing is how fast it moves.",
        "Never invent. If the reviews do not support a field, return null for it.",
        "evidence: at most 2 short paraphrased points (under 25 words), each with its source URL.",
        "",
        *parts,
    ]
    if error:
        lines += ["", f"Your previous reply was rejected: {error}. Fix it."]
    return "\n".join(lines)


def extract_scores(
    title: Title,
    season_no: int | None,
    season_id: int | None,
    reviews: list[Review],
    llm=complete_json,
) -> Scores | None:
    if not reviews:
        return None
    schema = ExtractionResult.model_json_schema()
    error = ""
    last_llm_error: LlmError | None = None
    for _ in range(2):
        try:
            raw = llm(_prompt(title, season_no, reviews, error), schema)
            result = ExtractionResult.model_validate(raw)
        except LlmOutputError as exc:
            error, last_llm_error = str(exc)[:300], None
            continue
        except LlmError as exc:
            error, last_llm_error = str(exc)[:300], exc
            continue
        except ValidationError as exc:
            error, last_llm_error = str(exc)[:300], None
            continue
        return Scores(
            title_id=title.id,
            season_id=season_id,
            fight_quality=result.fight_quality,
            style=result.style,
            action_density=result.action_density,
            grit=result.grit,
            crime_tone=result.crime_tone,
            pacing=result.pacing,
            review_count=len(reviews),
            evidence=[e.model_dump() for e in result.evidence],
            content_hash=compute_content_hash(reviews),
        )
    if last_llm_error is not None:
        raise last_llm_error  # outage, not a bad title: let the caller stop the run
    return None
