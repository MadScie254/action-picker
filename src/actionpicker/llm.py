from __future__ import annotations

import json
import os
import re
import time

import requests


class LlmError(Exception):
    """Transient or configuration failure (network, quota, bad key): the run should stop."""


class LlmOutputError(LlmError):
    """The model replied, but its output is unusable for this prompt: skip the title."""


_RETRY_STATUS = {429, 500, 502, 503, 504}
_OUTPUT_STATUS = {400, 413, 422}  # this prompt was refused, not the whole service
_ATTEMPTS = 3


def _parse_json(text: str) -> dict:
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    try:
        out = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise LlmOutputError(f"model did not return valid JSON: {exc}") from exc
    if not isinstance(out, dict):
        raise LlmOutputError("model JSON was not an object")
    return out


def _build_request(provider: str, prompt: str, schema: dict) -> tuple[str, dict, dict, callable]:
    """Return (url, headers, body, extract_text) for the provider."""
    model = os.environ.get("LLM_MODEL", "")
    if not model:
        raise LlmError("LLM_MODEL is not set; pick a currently free model for your provider")
    key = os.environ.get("LLM_API_KEY", "")
    full = f"{prompt}\n\nReply with JSON only, matching this JSON schema:\n{json.dumps(schema)}"
    if provider == "gemini":
        return (
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
            {"x-goog-api-key": key},
            {
                "contents": [{"parts": [{"text": full}]}],
                "generationConfig": {"responseMimeType": "application/json"},
            },
            lambda j: j["candidates"][0]["content"]["parts"][0]["text"],
        )
    if provider == "groq":
        return (
            "https://api.groq.com/openai/v1/chat/completions",
            {"Authorization": f"Bearer {key}"},
            {
                "model": model,
                "messages": [{"role": "user", "content": full}],
                "response_format": {"type": "json_object"},
            },
            lambda j: j["choices"][0]["message"]["content"],
        )
    if provider == "ollama":
        base = os.environ.get("OLLAMA_URL", "http://localhost:11434")
        return (
            f"{base}/api/chat",
            {},
            {
                "model": model,
                "messages": [{"role": "user", "content": full}],
                "stream": False,
                "format": "json",
            },
            lambda j: j["message"]["content"],
        )
    raise LlmError(f"unknown LLM provider: {provider!r}")


def complete_json(
    prompt: str,
    schema: dict,
    provider: str | None = None,
    *,
    sleep=time.sleep,
    session: requests.Session | None = None,
) -> dict:
    provider = provider or os.environ.get("LLM_PROVIDER", "gemini")
    url, headers, body, pick = _build_request(provider, prompt, schema)
    http = session or requests.Session()
    last = "no attempt made"
    for attempt in range(_ATTEMPTS):
        try:
            resp = http.post(url, headers=headers, json=body, timeout=60)
        except requests.RequestException as exc:
            last = str(exc)
        else:
            if resp.status_code in _RETRY_STATUS:
                last = f"HTTP {resp.status_code}"
            elif resp.status_code in _OUTPUT_STATUS:
                raise LlmOutputError(f"HTTP {resp.status_code} from {provider} for this prompt")
            elif resp.status_code != 200:
                raise LlmError(f"HTTP {resp.status_code} from {provider}")
            else:
                try:
                    return _parse_json(pick(resp.json()))
                except (KeyError, IndexError, TypeError, ValueError) as exc:
                    raise LlmOutputError(f"unexpected {provider} response shape: {exc}") from exc
        if attempt < _ATTEMPTS - 1:
            sleep(2 ** (attempt + 1))
    raise LlmError(f"{provider} failed after {_ATTEMPTS} attempts: {last}")
