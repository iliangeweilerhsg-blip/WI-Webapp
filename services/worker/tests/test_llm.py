"""Cloud-KI im Worker (VERTRAEGE §20.5): Claude-Client mit gemocktem HTTP, Fehlerabbildung,
Kosten, Budget, Schlüssel und `GET /health`.

Kein echter API-Aufruf: Der SDK-Client bekommt einen `httpx2.MockTransport` (Abhängigkeit des
SDK, keine neue). Die Adresse bleibt `https://api.anthropic.com`, der Transport fängt ab.
Der Schlüssel ist erfunden.
"""

from __future__ import annotations

import http.client
import json
import logging
import os
import uuid
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import anthropic
import httpx2
import psycopg
import pytest
from sg_schemas.models import ConceptsExtractResult, WorkerHealth

import sg_worker.handlers  # noqa: F401  (registriert die Handler)
from conceptdata import add_cost, add_job, costs, deck, module, run, session, set_budget
from conftest import USER_ID
from sg_worker import server as srv
from sg_worker.ai import budget, llm, pricing
from sg_worker.ai import embedder as em
from sg_worker.ai.outputs import ConceptsExtractOutput, ExtractConceptOut
from sg_worker.config import LlmSettings, take_llm_settings

Conn = psycopg.Connection[Any]

KEY = "sk-ant-test-erfunden-0000000000000000000000000000"
MODEL = "claude-sonnet-5-5"
Handler = Callable[[httpx2.Request], httpx2.Response]


@pytest.fixture(autouse=True)
def clean(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    for name in ("SG_MODEL_STANDARD", "SG_USD_EUR", "SG_FAKE_LLM_EUR_PER_CALL", "SG_LLM"):
        monkeypatch.delenv(name, raising=False)
    yield
    llm.reset()


# ---------- Antworten der erfundenen API ----------


def output_json(slides: list[int] | None = None) -> str:
    concept = ExtractConceptOut(
        name="Rekursion", aliases=["Recursion"], one_liner="Eine Funktion ruft sich selbst auf.",
        kind="definition", slides=[1] if slides is None else slides, times=[], importance=3,
        exam_hint=False, prof_explanation=None, confidence=0.9,
    )  # fmt: skip
    return ConceptsExtractOutput(concepts=[concept], relations=[]).model_dump_json()


def sse(
    text: str,
    *,
    stop_reason: str = "end_turn",
    model: str = MODEL,
    stop_details: dict[str, Any] | None = None,
    usage: dict[str, Any] | None = None,
    request_id: str = "req_erfunden_1",
) -> httpx2.Response:
    """Antwort im Stream-Format: Thinking-Block (mit Signatur), Textblock, Ende."""
    events: list[tuple[str, dict[str, Any]]] = [
        ("message_start", {"type": "message_start", "message": {
            "id": "msg_erfunden", "type": "message", "role": "assistant", "model": model,
            "content": [], "stop_reason": None, "stop_sequence": None,
            "usage": {"input_tokens": 1000, "output_tokens": 1,
                      "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0}}}),
        ("content_block_start", {"type": "content_block_start", "index": 0, "content_block": {
            "type": "thinking", "thinking": "", "signature": ""}}),
        ("content_block_delta", {"type": "content_block_delta", "index": 0, "delta": {
            "type": "signature_delta", "signature": "sig-erfunden"}}),
        ("content_block_stop", {"type": "content_block_stop", "index": 0}),
        ("content_block_start", {"type": "content_block_start", "index": 1,
                                 "content_block": {"type": "text", "text": ""}}),
        ("content_block_delta", {"type": "content_block_delta", "index": 1,
                                 "delta": {"type": "text_delta", "text": text}}),
        ("content_block_stop", {"type": "content_block_stop", "index": 1}),
        ("message_delta", {"type": "message_delta",
                           "delta": {"stop_reason": stop_reason, "stop_sequence": None,
                                     "stop_details": stop_details},
                           "usage": {"output_tokens": 200, **(usage or {})}}),
        ("message_stop", {"type": "message_stop"}),
    ]  # fmt: skip
    body = "".join(f"event: {name}\ndata: {json.dumps(data)}\n\n" for name, data in events)
    return httpx2.Response(
        200,
        headers={"content-type": "text/event-stream", "request-id": request_id},
        content=body.encode(),
    )


def error(status: int, kind: str = "api_error") -> httpx2.Response:
    return httpx2.Response(
        status, json={"type": "error", "error": {"type": kind, "message": "erfundener Fehler"}}
    )


class Api:
    """Erfundene API: beantwortet Anfragen der Reihe nach und merkt sie sich."""

    def __init__(self, *answers: httpx2.Response | Exception) -> None:
        self.answers = list(answers)
        self.requests: list[httpx2.Request] = []

    def __call__(self, request: httpx2.Request) -> httpx2.Response:
        self.requests.append(request)
        answer = self.answers[min(len(self.requests), len(self.answers)) - 1]
        if isinstance(answer, Exception):
            raise answer
        return answer

    def body(self, i: int) -> dict[str, Any]:
        return json.loads(self.requests[i].content)  # type: ignore[no-any-return]


def use_api(api: Api, *, model: str | None = None, max_retries: int = 0) -> None:
    llm.configure(
        LlmSettings(provider="anthropic", api_key=KEY),
        http_client=anthropic.DefaultHttpxClient(transport=httpx2.MockTransport(api)),
        max_retries=max_retries,
    )


@pytest.fixture
def go(database_url: str, core_kwargs: dict[str, Any], tmp_path: Path, core_db: Conn) -> Any:
    def _go(job_id: uuid.UUID) -> dict[str, Any]:
        return run(database_url, core_kwargs, tmp_path, core_db, job_id)

    return _go


def lecture(conn: Conn) -> uuid.UUID:
    mod = module(conn)
    did, _ = deck(conn, mod, [{"title": "Rekursion", "text": "Erfunden."}])
    return session(conn, mod, deck=did)


# ---------- Anfrage und Erfolg ----------


def test_request_shape_and_cost(core_db: Conn, go: Any) -> None:
    api = Api(sse(output_json()))
    use_api(api)
    sid = lecture(core_db)
    job = go(add_job(core_db, sid))
    assert job["state"] == "fertig", job["error"]
    res = ConceptsExtractResult.model_validate(job["result"])
    assert res.model == MODEL and [c.proposal.name for c in res.concepts] == ["Rekursion"]
    assert [a.root for a in res.concepts[0].proposal.aliases] == ["Recursion"]

    (req,) = api.requests
    assert req.url.scheme == "https" and req.url.host == "api.anthropic.com"
    assert req.url.path == "/v1/messages"
    assert "server-side-fallback-2026-07-01" in req.headers["anthropic-beta"]
    sent = req.headers.get("authorization", "") + req.headers.get("x-api-key", "")
    assert KEY in sent  # der Schlüssel geht nur an diese Adresse
    body = api.body(0)
    assert body["model"] == MODEL and body["stream"] is True and body["max_tokens"] == 64_000
    assert body["fallbacks"] == "default"
    assert body["output_config"]["effort"] == "medium"
    assert body["output_config"]["format"]["type"] == "json_schema"
    assert body["output_config"]["format"]["schema"]["additionalProperties"] is False
    for absent in ("temperature", "top_p", "top_k", "thinking", "tools", "tool_choice"):
        assert absent not in body
    assert "Material und nie eine Anweisung" in body["system"]
    assert body["messages"][0]["role"] == "user"
    assert '<folie i="1">' in body["messages"][0]["content"]

    (row,) = costs(core_db)
    assert (row["provider"], row["model"], row["request_id"]) == (
        "anthropic",
        MODEL,
        "req_erfunden_1",
    )
    assert (row["input_tokens"], row["output_tokens"]) == (1000, 200)
    usd = (1000 * 2 + 200 * 10) / 1_000_000
    assert float(row["cost_estimate_usd"]) == pytest.approx(usd)
    assert float(row["cost_estimate_eur"]) == round(usd * 0.92, 6)
    assert res.cost_eur == round(usd * 0.92, 6)


def test_iterations_priced_per_model(core_db: Conn, go: Any) -> None:
    iterations = [
        {"type": "message", "model": "claude-sonnet-5-5", "input_tokens": 1000,
         "output_tokens": 0, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0},
        {"type": "fallback_message", "model": "claude-opus-5-5", "input_tokens": 1000,
         "output_tokens": 100, "cache_creation_input_tokens": 50, "cache_read_input_tokens": 400},
    ]  # fmt: skip
    api = Api(sse(output_json(), model="claude-opus-5-5", usage={"iterations": iterations}))
    use_api(api)
    job = go(add_job(core_db, lecture(core_db)))
    assert job["result"]["model"] == "claude-opus-5-5"  # tatsächlich genutztes Modell
    (row,) = costs(core_db)
    assert row["model"] == "claude-opus-5-5"
    assert (row["input_tokens"], row["output_tokens"]) == (2000, 100)
    assert (row["cache_creation_input_tokens"], row["cache_read_input_tokens"]) == (50, 400)
    usd = (1000 * 2 + 1000 * 4 + 100 * 20 + 50 * 5 + 400 * 0.20) / 1_000_000
    assert float(row["cost_estimate_usd"]) == pytest.approx(usd)


def test_haiku_has_no_fallback(core_db: Conn, go: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SG_MODEL_STANDARD", "claude-haiku-5-5")
    api = Api(sse(output_json(), model="claude-haiku-5-5"))
    use_api(api)
    assert go(add_job(core_db, lecture(core_db)))["state"] == "fertig"
    assert "fallbacks" not in api.body(0) and "anthropic-beta" not in api.requests[0].headers


def test_client_settings() -> None:
    backend = llm.AnthropicBackend(KEY)
    client = backend.client
    assert str(client.base_url).rstrip("/") == "https://api.anthropic.com"
    assert client.max_retries == 2 and client.timeout == 600.0
    assert KEY not in repr(LlmSettings(provider="anthropic", api_key=KEY))


# ---------- stop_reason, ungültige Ausgabe ----------


def test_refusal_fails_and_is_billed(core_db: Conn, go: Any) -> None:
    api = Api(sse("", stop_reason="refusal", stop_details={"type": "refusal", "category": "cyber"}))
    use_api(api)
    job = go(add_job(core_db, lecture(core_db)))
    assert (job["state"], job["error"]) == ("fehler", "KI hat die Anfrage abgelehnt (cyber)")
    assert job["attempts"] == 1 and len(api.requests) == 1 and len(costs(core_db)) == 1


def test_refusal_without_category(core_db: Conn, go: Any) -> None:
    use_api(Api(sse("", stop_reason="refusal")))
    job = go(add_job(core_db, lecture(core_db)))
    assert job["error"] == "KI hat die Anfrage abgelehnt (ohne Kategorie)"


def test_refusal_category_is_shortened() -> None:
    message = llm.refused("neue_kategorie_" + "x" * 80 + "\nzweite Zeile")
    assert message == f"KI hat die Anfrage abgelehnt ({('neue_kategorie_' + 'x' * 80)[:50]})"
    assert llm.refused("  ") == "KI hat die Anfrage abgelehnt (ohne Kategorie)"


def test_echo_content_after_mid_output_fallback() -> None:
    """Nach einem Fallback mitten in der Ausgabe entfallen Thinking- und Tool-Blöcke vor dem
    letzten `fallback`-Block; alles andere bleibt unverändert und in Reihenfolge."""
    thinking = {"type": "thinking", "thinking": "", "signature": "a"}
    redacted = {"type": "redacted_thinking", "data": "b"}
    tool = {"type": "tool_use", "id": "t1", "name": "x", "input": {}}
    partial = {"type": "text", "text": '{"concepts": ['}
    switch = {"type": "fallback", "from": {"model": "m1"}, "to": {"model": "m2"}}
    late_thinking = {"type": "thinking", "thinking": "", "signature": "c"}
    rest = {"type": "text", "text": "]}"}
    content = [thinking, redacted, tool, partial, switch, late_thinking, rest]
    assert llm.echo_content(content) == [partial, switch, late_thinking, rest]
    # Ohne Fallback: unverändert (auch Objekte statt dicts)
    plain = [thinking, partial]
    assert llm.echo_content(plain) == plain and llm.echo_content(plain) is not plain


def test_max_tokens_fails(core_db: Conn, go: Any) -> None:
    api = Api(sse('{"concepts": [', stop_reason="max_tokens"))
    use_api(api)
    job = go(add_job(core_db, lecture(core_db)))
    assert (job["state"], job["error"]) == ("fehler", "KI-Ausgabe zu lang")
    assert len(api.requests) == 1 and len(costs(core_db)) == 1


def test_invalid_output_rerequest_with_unchanged_content(core_db: Conn, go: Any) -> None:
    api = Api(sse('{"concepts": 1}'), sse(output_json()))
    use_api(api)
    job = go(add_job(core_db, lecture(core_db)))
    assert job["state"] == "fertig", job["error"]
    assert len(api.requests) == 2 and len(costs(core_db)) == 2
    first, second = api.body(0), api.body(1)
    assert second["messages"][0] == first["messages"][0]
    assistant = second["messages"][1]
    assert assistant["role"] == "assistant"
    assert assistant["content"][0] == {
        "type": "thinking",
        "thinking": "",
        "signature": "sig-erfunden",
    }
    assert assistant["content"][1]["type"] == "text"
    assert assistant["content"][1]["text"] == '{"concepts": 1}'
    retry = second["messages"][2]
    assert retry["role"] == "user" and "Schema verletzt" in retry["content"]
    assert len(second["messages"]) == 3  # kein Prefill


def test_invalid_twice(core_db: Conn, go: Any) -> None:
    api = Api(sse("kein json"), sse(output_json(slides=[77])))  # zweites: kein gültiger Beleg
    use_api(api)
    job = go(add_job(core_db, lecture(core_db)))
    assert (job["state"], job["error"]) == ("fehler", "KI-Ausgabe ungültig")
    assert len(api.requests) == 2 and len(costs(core_db)) == 2


def test_budget_before_rerequest(core_db: Conn, go: Any) -> None:
    set_budget(core_db, 0.001)  # der erste Aufruf kostet ≈ 0,0037 €
    api = Api(sse("kein json"), sse(output_json()))
    use_api(api)
    job = go(add_job(core_db, lecture(core_db)))
    assert (job["state"], job["error"]) == ("fehler", "Monatsbudget erreicht")
    assert len(api.requests) == 1 and len(costs(core_db)) == 1


def test_budget_before_first_call(core_db: Conn, go: Any) -> None:
    set_budget(core_db, 2)
    add_cost(core_db, 2.0)
    api = Api(sse(output_json()))
    use_api(api)
    job = go(add_job(core_db, lecture(core_db)))
    assert (job["state"], job["error"]) == ("fehler", "Monatsbudget erreicht")
    assert api.requests == []


# ---------- HTTP-Fehler ----------


@pytest.mark.parametrize(
    ("status", "message"),
    [
        (401, "KI-Schlüssel ungültig"),
        (403, f"Kein Zugriff auf das Modell {MODEL}"),
        (404, f"Kein Zugriff auf das Modell {MODEL}"),
        (400, "KI-Anfrage ungültig"),
        (413, "KI-Anfrage ungültig"),
    ],
)
def test_fatal_http_errors(core_db: Conn, go: Any, status: int, message: str) -> None:
    api = Api(error(status))
    use_api(api)
    job = go(add_job(core_db, lecture(core_db)))
    assert (job["state"], job["error"], job["attempts"]) == ("fehler", message, 1)
    assert costs(core_db) == []


@pytest.mark.parametrize(
    ("answer", "status"),
    [
        (error(429, "rate_limit_error"), "429"),
        (error(500), "500"),
        (error(529, "overloaded_error"), "529"),
        (httpx2.ConnectError("erfunden"), "Verbindung"),
        (httpx2.ReadTimeout("erfunden"), "Zeitlimit"),
    ],
)
def test_transient_errors_retry_then_fail(core_db: Conn, go: Any, answer: Any, status: str) -> None:
    use_api(Api(answer))
    sid = lecture(core_db)
    job = go(add_job(core_db, sid))
    assert job["state"] == "wartet" and job["run_after"] is not None
    assert f"KI nicht erreichbar ({status})" in job["error"]
    last = go(add_job(core_db, sid, attempts=2, max_attempts=3))  # letzter Versuch
    assert (last["state"], last["error"]) == ("fehler", f"KI nicht erreichbar ({status})")


def test_error_event_in_stream(core_db: Conn, go: Any) -> None:
    event = {"type": "error", "error": {"type": "overloaded_error", "message": "x"}}
    body = f"event: error\ndata: {json.dumps(event)}\n\n"
    response = httpx2.Response(
        200, headers={"content-type": "text/event-stream"}, content=body.encode()
    )
    use_api(Api(response))
    job = go(add_job(core_db, lecture(core_db), attempts=2))
    assert (job["state"], job["error"]) == ("fehler", "KI nicht erreichbar (Stream)")


def test_sdk_retries_are_configured(core_db: Conn, go: Any) -> None:
    """Mit `max_retries` wiederholt das SDK 429 selbst; gebucht wird nur die gesehene Antwort."""
    retry_now = httpx2.Response(
        429,
        headers={"retry-after-ms": "1"},
        json={"type": "error", "error": {"type": "x", "message": "x"}},
    )
    api = Api(retry_now, sse(output_json()))
    use_api(api, max_retries=2)
    job = go(add_job(core_db, lecture(core_db)))
    assert job["state"] == "fertig" and len(api.requests) == 2 and len(costs(core_db)) == 1


# ---------- Schlüssel nie in Logs, Fehlern, Datenbank ----------


def test_key_never_leaks(core_db: Conn, go: Any, caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    sid = lecture(core_db)
    for answer in (
        error(401, "authentication_error"),
        error(429),
        sse("", stop_reason="refusal"),
        sse("kein json"),
        sse(output_json()),
    ):
        api = Api(answer, answer)
        use_api(api)
        go(add_job(core_db, sid, payload={"session_id": str(sid), "force": True}))
        assert any(KEY in r.headers.get("authorization", "") + r.headers.get("x-api-key", "")
                   for r in api.requests)  # fmt: skip
    assert KEY not in caplog.text and "sk-ant" not in caplog.text
    dump = json.dumps(
        [list(map(str, r)) for t in ("job", "cost_entry", "setting")
         for r in core_db.execute(f"SELECT * FROM {t}").fetchall()]  # type: ignore[call-overload]
    )  # fmt: skip
    assert "sk-ant" not in dump
    assert "sk-ant" not in json.dumps(llm.llm_status())
    assert os.environ.get("ANTHROPIC_API_KEY") != KEY


# ---------- Schlüssel aus .env ----------


def env_file(tmp_path: Path, mode: int, extra: str = "") -> Path:
    path = tmp_path / ".env"
    path.write_text(f"ANTHROPIC_API_KEY={KEY}\n{extra}", encoding="utf-8")
    path.chmod(mode)
    return path


def test_key_from_env_file_600(tmp_path: Path) -> None:
    path = env_file(tmp_path, 0o600)
    environ = {
        "ANTHROPIC_API_KEY": KEY,
        "ANTHROPIC_BASE_URL": "https://erfunden.example",
        "ANTHROPIC_AUTH_TOKEN": "erfunden",
        "ANTHROPIC_LOG": "debug",
        "SG_DATA_DIR": "/x",
    }
    settings = take_llm_settings(path, key_from_environment=False, environ=environ)
    assert settings.configured and settings.api_key == KEY and settings.provider == "anthropic"
    assert environ == {"SG_DATA_DIR": "/x"}  # alle ANTHROPIC_* entfernt
    assert KEY not in repr(settings)


def test_env_file_644_is_not_used(tmp_path: Path) -> None:
    path = env_file(tmp_path, 0o644)
    settings = take_llm_settings(
        path, key_from_environment=False, environ={"ANTHROPIC_API_KEY": KEY}
    )
    assert (settings.configured, settings.issue, settings.api_key) == (False, "env_offen", None)
    # Steht der Schlüssel schon in der Umgebung (Entwicklung), gilt er
    settings = take_llm_settings(
        path, key_from_environment=True, environ={"ANTHROPIC_API_KEY": KEY}
    )
    assert settings.configured


def test_env_symlink_is_not_read(tmp_path: Path) -> None:
    from sg_worker.config import load_env_file

    real = env_file(tmp_path, 0o600)
    link = tmp_path / "link.env"
    link.symlink_to(real)
    environ: dict[str, str] = {}
    assert load_env_file(link, environ) == "symlink"
    assert environ == {}  # nichts gelesen
    settings = take_llm_settings(
        link, key_from_environment=False, environ={"ANTHROPIC_API_KEY": KEY}
    )
    assert (settings.configured, settings.issue) == (False, "env_offen")


def test_env_foreign_owner_is_not_read(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import os

    from sg_worker.config import load_env_file

    path = env_file(tmp_path, 0o600, "ANDERE=1\n")
    monkeypatch.setattr(os, "geteuid", lambda: os.stat(path).st_uid + 1)
    environ: dict[str, str] = {}
    assert load_env_file(path, environ) == "fremder_besitzer"
    assert environ == {}
    settings = take_llm_settings(
        path, key_from_environment=False, environ={"ANTHROPIC_API_KEY": KEY}
    )
    assert (settings.configured, settings.issue) == (False, "env_offen")


def test_env_not_regular_file_is_not_read(tmp_path: Path) -> None:
    import os

    from sg_worker.config import load_env_file

    fifo = tmp_path / "fifo.env"
    os.mkfifo(fifo)
    assert load_env_file(fifo, {}) == "keine_datei"  # blockiert nicht
    assert load_env_file(tmp_path, {}) == "keine_datei"  # Ordner


def test_env_mode_is_checked_on_open_descriptor(tmp_path: Path) -> None:
    from sg_worker.config import read_env_file

    assert read_env_file(tmp_path / "fehlt")[1] == "fehlt"
    text, problem = read_env_file(env_file(tmp_path, 0o600))
    assert problem is None and text is not None and KEY in text
    (tmp_path / "o").mkdir()
    text, problem = read_env_file(env_file(tmp_path / "o", 0o604))
    assert problem == "offen" and text is not None  # gelesen, Schlüssel aber nicht genutzt


def test_load_env_then_take(tmp_path: Path) -> None:
    from sg_worker.config import load_env_file

    path = env_file(tmp_path, 0o640, "ANTHROPIC_BASE_URL=https://erfunden.example\n")
    environ: dict[str, str] = {}
    load_env_file(path, environ)
    settings = take_llm_settings(path, key_from_environment=False, environ=environ)
    assert settings.issue == "env_offen" and environ == {}


@pytest.mark.parametrize(
    ("env", "provider", "issue"),
    [
        ({}, "anthropic", "kein_schluessel"),
        ({"ANTHROPIC_API_KEY": "  "}, "anthropic", "kein_schluessel"),
        ({"SG_LLM": "fake"}, "fake", None),
        ({"SG_LLM": "openrouter", "ANTHROPIC_API_KEY": KEY}, "openrouter", "unbekannter_anbieter"),
    ],
)
def test_llm_settings_issues(
    tmp_path: Path, env: dict[str, str], provider: str, issue: str | None
) -> None:
    settings = take_llm_settings(
        tmp_path / "fehlt.env", key_from_environment=True, environ=dict(env)
    )
    assert (settings.provider, settings.issue, settings.api_key) == (provider, issue, None)


def test_not_configured_without_configure(core_db: Conn, go: Any) -> None:
    llm.reset()
    job = go(add_job(core_db, lecture(core_db)))
    assert (job["state"], job["error"]) == ("fehler", "KI nicht eingerichtet")


# ---------- GET /health ----------


def health(tmp_path: Path) -> dict[str, Any]:
    server = srv.LoopbackServer(tmp_path, em.FakeEmbedder(), 0)
    assert server.start() and server.address is not None
    try:
        conn = http.client.HTTPConnection(*server.address, timeout=10)
        conn.request("GET", "/health", headers={"Authorization": f"Bearer {server.token}"})
        resp = conn.getresponse()
        assert resp.status == 200
        data: dict[str, Any] = json.loads(resp.read())
        conn.close()
        return data
    finally:
        server.stop()


@pytest.mark.parametrize(
    ("settings", "expected"),
    [
        (LlmSettings(provider="fake"), {"provider": "fake", "configured": True, "issue": None}),
        (
            LlmSettings(provider="anthropic", api_key=KEY),
            {"provider": "anthropic", "configured": True, "issue": None},
        ),
        (
            LlmSettings(provider="anthropic", issue="env_offen"),
            {"provider": "anthropic", "configured": False, "issue": "env_offen"},
        ),
    ],
)
def test_health_has_llm(tmp_path: Path, settings: LlmSettings, expected: dict[str, Any]) -> None:
    llm.configure(settings)
    data = health(tmp_path)
    WorkerHealth.model_validate(data)
    assert data["llm"] == expected
    assert "sk-ant" not in json.dumps(data)


# ---------- Preise ----------


def test_prices() -> None:
    t = pricing.Tokens
    assert pricing.cost_usd("claude-sonnet-5-5", t(1_000_000, 1_000_000, 1_000_000, 1_000_000)) == (
        pytest.approx(2 + 10 + 2.5 + 0.2)
    )
    assert pricing.cost_usd("claude-opus-5-5", t(1_000_000, 0, 0, 0)) == pytest.approx(4)
    short = pricing.cost_usd("claude-haiku-5-5", t(100_000, 1000, 0, 0))
    assert short == pytest.approx((100_000 * 0.10 + 1000 * 0.50) / 1e6)
    long = pricing.cost_usd("claude-haiku-5-5", t(90_000, 1000, 5_000, 6_000))  # Prompt 101 000
    assert long == pytest.approx((90_000 * 0.5 + 1000 * 2.5 + 5_000 * 0.625 + 6_000 * 0.05) / 1e6)


def test_unknown_model_uses_opus_and_warns(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.WARNING)
    tokens = pricing.Tokens(1_000_000, 0, 0, 0)
    assert pricing.cost_usd("erfundenes-modell-7", tokens) == pytest.approx(4)
    assert "Unbekanntes Modell" in caplog.text


@pytest.mark.parametrize(("raw", "rate"), [(None, 0.92), ("1.1", 1.1), ("abc", 0.92), ("-1", 0.92)])
def test_usd_eur(raw: str | None, rate: float) -> None:
    env = {} if raw is None else {"SG_USD_EUR": raw}
    assert pricing.usd_eur(env) == rate
    assert pricing.to_eur(1.234567891, env) == round(1.234567891 * rate, 6)


# ---------- Monatsbudget ----------


@pytest.mark.parametrize(
    ("value", "expected"),
    [(None, 10.0), (0, 0.0), (25.5, 25.5), ("5", 10.0), (True, 10.0), (-1, 10.0), (1001, 10.0)],
)
def test_monthly_budget_setting(core_db: Conn, value: Any, expected: float) -> None:
    if value is not None:
        set_budget(core_db, value)
    assert budget.monthly_budget_eur(core_db) == expected


def test_month_in_local_time(core_db: Conn) -> None:
    """Der Monat beginnt um Mitternacht Ortszeit: 30 min danach zählt in Zürich, in UTC noch zum
    Vormonat (Zürich liegt im Winter und Sommer vor UTC)."""
    tz = "Europe/Zurich"
    start = "date_trunc('month', now() AT TIME ZONE 'Europe/Zurich') AT TIME ZONE 'Europe/Zurich'"
    for minutes, eur in ((30, 1.0), (-1, 7.0)):
        core_db.execute(
            "INSERT INTO cost_entry (id, user_id, provider, model, task, cost_estimate_eur, "  # type: ignore[call-overload]
            "created_at) VALUES (%s, %s, 'fake', 'm', 't', %s, "
            f"{start} + make_interval(mins => %s))",
            (uuid.uuid4(), USER_ID, eur, minutes),
        )
    add_cost(core_db, 100.0)
    core_db.execute("UPDATE cost_entry SET deleted_at = now() WHERE cost_estimate_eur = 100")
    spent_local = budget.month_spent_eur(core_db, tz)
    spent_utc = budget.month_spent_eur(core_db, "UTC")
    assert spent_local == 1.0
    # In UTC liegen beide Einträge im Vormonat, außer in der Stunde, in der Zürich schon den
    # neuen Monat hat und UTC noch nicht (dann zählt UTC beide zum laufenden Monat)
    row = core_db.execute(
        "SELECT date_trunc('month', now() AT TIME ZONE 'UTC') "
        "<> date_trunc('month', now() AT TIME ZONE 'Europe/Zurich')"
    ).fetchone()
    assert row is not None
    assert spent_utc == (8.0 if row[0] else 0.0)
    assert budget.MONTH_SPENT_SQL.count("%(tz)s") == 2


def test_local_tz_name() -> None:
    assert budget.local_tz_name({"TZ": "Europe/Zurich"}) == "Europe/Zurich"
    assert budget.local_tz_name({"TZ": ":Europe/Berlin"}) == "Europe/Berlin"
    assert budget.local_tz_name({"TZ": "Mars/Olympus"}) != "Mars/Olympus"
