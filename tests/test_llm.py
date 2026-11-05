import pytest
import responses

from actionpicker.llm import LlmError, LlmOutputError, complete_json

SCHEMA = {"type": "object"}


def test_unknown_provider_raises(monkeypatch):
    monkeypatch.setenv("LLM_MODEL", "m")
    with pytest.raises(LlmError):
        complete_json("hi", SCHEMA, provider="nope")


def test_missing_model_raises(monkeypatch):
    monkeypatch.delenv("LLM_MODEL", raising=False)
    with pytest.raises(LlmError, match="LLM_MODEL"):
        complete_json("hi", SCHEMA, provider="ollama")


@responses.activate
def test_ollama_parses_json_message(monkeypatch):
    monkeypatch.setenv("LLM_MODEL", "m")
    monkeypatch.setenv("OLLAMA_URL", "http://localhost:11434")
    responses.add(
        responses.POST,
        "http://localhost:11434/api/chat",
        json={"message": {"content": '{"a": 1}'}},
    )
    assert complete_json("hi", SCHEMA, provider="ollama") == {"a": 1}


@responses.activate
def test_groq_strips_code_fences(monkeypatch):
    monkeypatch.setenv("LLM_MODEL", "m")
    monkeypatch.setenv("LLM_API_KEY", "k")
    responses.add(
        responses.POST,
        "https://api.groq.com/openai/v1/chat/completions",
        json={"choices": [{"message": {"content": '```json\n{"a": 2}\n```'}}]},
    )
    assert complete_json("hi", SCHEMA, provider="groq") == {"a": 2}


@responses.activate
def test_gemini_parses_candidate_text(monkeypatch):
    monkeypatch.setenv("LLM_MODEL", "gem")
    monkeypatch.setenv("LLM_API_KEY", "k")
    responses.add(
        responses.POST,
        "https://generativelanguage.googleapis.com/v1beta/models/gem:generateContent",
        json={"candidates": [{"content": {"parts": [{"text": '{"a": 3}'}]}}]},
    )
    assert complete_json("hi", SCHEMA, provider="gemini") == {"a": 3}


CF_URL = "https://api.cloudflare.com/client/v4/accounts/acct/ai/run/@cf/meta/m"


@responses.activate
def test_cloudflare_parses_result_response(monkeypatch):
    monkeypatch.setenv("LLM_MODEL", "@cf/meta/m")
    monkeypatch.setenv("LLM_API_KEY", "tok")
    monkeypatch.setenv("CLOUDFLARE_ACCOUNT_ID", "acct")
    responses.add(
        responses.POST, CF_URL, json={"result": {"response": '{"a": 4}'}, "success": True}
    )
    assert complete_json("hi", SCHEMA, provider="cloudflare") == {"a": 4}
    assert responses.calls[0].request.headers["Authorization"] == "Bearer tok"


@responses.activate
def test_cloudflare_accepts_response_already_parsed_as_object(monkeypatch):
    monkeypatch.setenv("LLM_MODEL", "@cf/meta/m")
    monkeypatch.setenv("LLM_API_KEY", "tok")
    monkeypatch.setenv("CLOUDFLARE_ACCOUNT_ID", "acct")
    responses.add(responses.POST, CF_URL, json={"result": {"response": {"a": 5}}})
    assert complete_json("hi", SCHEMA, provider="cloudflare") == {"a": 5}


def test_cloudflare_without_account_id_raises(monkeypatch):
    monkeypatch.setenv("LLM_MODEL", "@cf/meta/m")
    monkeypatch.delenv("CLOUDFLARE_ACCOUNT_ID", raising=False)
    with pytest.raises(LlmError, match="CLOUDFLARE_ACCOUNT_ID"):
        complete_json("hi", SCHEMA, provider="cloudflare")


@responses.activate
def test_retries_on_429_with_backoff_then_succeeds(monkeypatch):
    monkeypatch.setenv("LLM_MODEL", "m")
    monkeypatch.setenv("OLLAMA_URL", "http://localhost:11434")
    url = "http://localhost:11434/api/chat"
    responses.add(responses.POST, url, status=429)
    responses.add(responses.POST, url, json={"message": {"content": '{"ok": true}'}})
    sleeps: list[float] = []
    out = complete_json("hi", SCHEMA, provider="ollama", sleep=sleeps.append)
    assert out == {"ok": True} and sleeps == [2]


@responses.activate
def test_gives_up_after_three_attempts(monkeypatch):
    monkeypatch.setenv("LLM_MODEL", "m")
    monkeypatch.setenv("OLLAMA_URL", "http://localhost:11434")
    responses.add(responses.POST, "http://localhost:11434/api/chat", status=503)
    with pytest.raises(LlmError):
        complete_json("hi", SCHEMA, provider="ollama", sleep=lambda s: None)
    assert len(responses.calls) == 3


@responses.activate
def test_non_json_reply_raises(monkeypatch):
    monkeypatch.setenv("LLM_MODEL", "m")
    monkeypatch.setenv("OLLAMA_URL", "http://localhost:11434")
    responses.add(
        responses.POST, "http://localhost:11434/api/chat", json={"message": {"content": "sorry"}}
    )
    with pytest.raises(LlmOutputError):
        complete_json("hi", SCHEMA, provider="ollama")


@responses.activate
def test_http_400_is_an_output_error_for_that_prompt(monkeypatch):
    monkeypatch.setenv("LLM_MODEL", "m")
    monkeypatch.setenv("OLLAMA_URL", "http://localhost:11434")
    responses.add(responses.POST, "http://localhost:11434/api/chat", status=400)
    with pytest.raises(LlmOutputError):
        complete_json("hi", SCHEMA, provider="ollama")


@responses.activate
def test_http_401_is_a_plain_error_that_should_stop_the_run(monkeypatch):
    monkeypatch.setenv("LLM_MODEL", "m")
    monkeypatch.setenv("OLLAMA_URL", "http://localhost:11434")
    responses.add(responses.POST, "http://localhost:11434/api/chat", status=401)
    with pytest.raises(LlmError) as info:
        complete_json("hi", SCHEMA, provider="ollama")
    assert not isinstance(info.value, LlmOutputError)


@responses.activate
def test_unexpected_response_shape_is_an_output_error(monkeypatch):
    monkeypatch.setenv("LLM_MODEL", "gem")
    monkeypatch.setenv("LLM_API_KEY", "k")
    responses.add(
        responses.POST,
        "https://generativelanguage.googleapis.com/v1beta/models/gem:generateContent",
        json={"candidates": [{"finishReason": "SAFETY"}]},
    )
    with pytest.raises(LlmOutputError):
        complete_json("hi", SCHEMA, provider="gemini")
