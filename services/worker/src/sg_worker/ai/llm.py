"""Cloud-KI im Worker (VERTRAEGE §20.5): Claude API über das offizielle SDK `anthropic`, dazu der
Fake (`SG_LLM=fake`, `ai/llm_fake.py`).

**Ablauf eines Aufrufs** (`StructuredLLM.structured`, gleich für Claude und Fake):

1. Budget prüfen (`Meter.check`, vor **jedem** Aufruf, auch vor dem Nachfordern).
2. Aufruf. Danach sofort `cost_entry` in eigener Transaktion (`Meter.record`), auch wenn der Job
   danach scheitert.
3. `stop_reason` **vor** dem Lesen: `refusal` (auch nach dem Fallback) → `fehler`
   `KI hat die Anfrage abgelehnt (<Kategorie>)`, `max_tokens` → `fehler` `KI-Ausgabe zu lang`.
4. Ausgabe gegen das Ausgabemodell prüfen, dann die fachliche Prüfung des Handlers. Ungültig:
   **einmal** nachfordern, mit `response.content` der ersten Antwort unverändert als
   Assistent-Nachricht (samt Thinking-Blöcken) und einer Nutzer-Nachricht mit der Fehlermeldung
   (kein Prefill). Scheitert auch das: `fehler` `KI-Ausgabe ungültig`.

**Claude API** (`AnthropicBackend`):

- Client mit ausdrücklichem Schlüssel und fester Adresse `https://api.anthropic.com`, Zeitlimit
  600 s, `max_retries = 2`. Die `ANTHROPIC_*`-Variablen hat `config.take_llm_settings` beim Start
  aus der Umgebung entfernt; andere Anmeldewege des SDK werden so nicht genutzt.
- Aufrufe über `client.beta.messages` (`stream` bzw. `create`) mit `betas=[server-side-fallback-
  2026-07-01]` und `fallbacks="default"` (nur Sonnet und Opus, Haiku hat keinen Fallback).
- Strukturierte Ausgabe über `output_config = {effort, format}`. Das Format entsteht genau wie in
  `messages.parse(output_format=…)` (`anthropic.transform_schema` auf dem Pydantic-Modell).
  **Abweichung:** nicht `parse`/`output_format` selbst, weil das SDK dort schon beim Ende des
  Textblocks validiert und bei ungültiger Ausgabe eine Ausnahme wirft, bevor `stop_reason`,
  `usage` und `content` vorliegen. Dann ließen sich weder `stop_reason` zuerst prüfen noch die
  Kosten buchen noch die Antwort unverändert zurückgeben (§20.5). Geprüft wird darum nach dem
  Aufruf mit demselben Pydantic-Modell.
- Kein `temperature`/`top_p`/`top_k`, kein `thinking` (Standard: adaptiv), keine Tools.

**Fehler** (Tabelle §20.5): 401 → `KI-Schlüssel ungültig`, 403/404 → `Kein Zugriff auf das Modell
<Modell>`, 400/413 und andere 4xx → `KI-Anfrage ungültig` (alle `fehler` sofort). 429, 5xx, 529,
Verbindung, Zeitlimit und Fehler im Stream → `LlmUnavailable` (Retry nach §3); im letzten Versuch
macht `job_errors` daraus `fehler` mit `KI nicht erreichbar (<Status>)`. Fehlertexte enthalten nie
Schlüssel, Header oder Eingabetexte, Ausnahmen des SDK werden nicht angehängt (`from None`).
"""

from __future__ import annotations

import logging
import os
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any

import anthropic
from pydantic import BaseModel, ValidationError

from ..config import LlmSettings
from ..registry import JobContext, NonRetryableError
from .budget import BudgetReached
from .interfaces import CallCost, Meter, StructuredRequest, StructuredResult, Tier
from .pricing import Tokens, cost_usd, to_eur
from .tiers import model_for

log = logging.getLogger(__name__)

API_BASE_URL = "https://api.anthropic.com"
TIMEOUT_S = 600.0
MAX_RETRIES = 2
FALLBACK_BETA = "server-side-fallback-2026-07-01"
#: Nur diese Modellfamilien haben einen serverseitigen Refusal-Fallback (Haiku nicht)
FALLBACK_PREFIXES = ("claude-sonnet-", "claude-opus-")

NOT_CONFIGURED = "KI nicht eingerichtet"
BUDGET_REACHED = "Monatsbudget erreicht"
KEY_INVALID = "KI-Schlüssel ungültig"
BAD_REQUEST = "KI-Anfrage ungültig"
TOO_LONG = "KI-Ausgabe zu lang"
INVALID_OUTPUT = "KI-Ausgabe ungültig"

#: Diese Logger schreiben bei DEBUG Anfrage-Optionen (Material) mit: nie unter WARNING
_QUIET_LOGGERS = ("anthropic", "httpx2", "httpcore2", "httpx", "httpcore")


class LlmFatalError(NonRetryableError):
    """KI-Fehler ohne Retry (§20.5). Die Meldung landet unverändert in `job.error`."""


class LlmUnavailable(Exception):
    """KI vorübergehend nicht erreichbar (429, 5xx, 529, Verbindung, Zeitlimit): Retry nach §3."""

    def __init__(self, status: str) -> None:
        super().__init__(f"KI nicht erreichbar ({status})")
        self.status = status


def no_access(model: str) -> str:
    return f"Kein Zugriff auf das Modell {model[:100]}"


def refused(category: str | None) -> str:
    return f"KI hat die Anfrage abgelehnt ({category or 'ohne Kategorie'})"


# ---------- Antwort eines Anbieters ----------


@dataclass(frozen=True)
class Reply:
    """Eine Antwort, unabhängig vom Anbieter. `content` geht beim Nachfordern unverändert zurück."""

    stop_reason: str | None
    refusal_category: str | None
    text: str
    content: list[Any]
    model: str
    cost: CallCost


def user_content(request: StructuredRequest[Any]) -> str | list[dict[str, Any]]:
    """Nutzer-Nachricht. Mit `shared_head` (mehrere Kapitel) zwei Blöcke, der Kopf mit
    Prompt-Caching (§20.3 Schritt 5)."""
    if request.shared_head is None:
        return request.material
    return [
        {"type": "text", "text": request.shared_head, "cache_control": {"type": "ephemeral"}},
        {"type": "text", "text": request.material},
    ]


def retry_message(error: str) -> str:
    return (
        "Deine letzte Ausgabe war ungültig: "
        + error[:2000]
        + "\nGib die vollständige Antwort noch einmal aus, genau nach dem vorgegebenen Schema."
    )


def parse_output[T: BaseModel](text: str, output: type[T]) -> tuple[T | None, str | None]:
    """Prüft den Text gegen das Ausgabemodell. Fehlermeldung ohne Eingabewerte."""
    try:
        return output.model_validate_json(text), None
    except ValidationError as exc:
        problems = [
            f"{'.'.join(str(x) for x in e['loc']) or '(Wurzel)'}: {e['msg']}"
            for e in exc.errors(include_url=False, include_input=False)[:10]
        ]
        return None, "Schema verletzt: " + "; ".join(problems)


class Backend:
    """Ein Anbieter: schickt eine Anfrage und liefert `Reply` (oder wirft `LlmFatalError` bzw.
    `LlmUnavailable`)."""

    provider: str = ""

    def model_for(self, tier: Tier) -> str:
        raise NotImplementedError

    def send(
        self, request: StructuredRequest[Any], messages: list[dict[str, Any]], model: str
    ) -> Reply:
        raise NotImplementedError


class StructuredLLM:
    """`LLM` über einem `Backend` (Ablauf siehe Modul-Doku)."""

    def __init__(self, backend: Backend) -> None:
        self.backend = backend
        self.provider = backend.provider

    def model_for(self, tier: Tier) -> str:
        return self.backend.model_for(tier)

    def structured[T: BaseModel](
        self, request: StructuredRequest[T], meter: Meter
    ) -> StructuredResult[T]:
        model = self.backend.model_for(request.tier)
        messages: list[dict[str, Any]] = [{"role": "user", "content": user_content(request)}]
        cost_eur = 0.0
        for attempt in (1, 2):
            try:
                meter.check()
            except BudgetReached:
                raise LlmFatalError(BUDGET_REACHED) from None
            reply = self.backend.send(request, messages, model)
            meter.record(reply.cost)
            cost_eur += reply.cost.eur
            if reply.stop_reason == "refusal":
                raise LlmFatalError(refused(reply.refusal_category))
            if reply.stop_reason in ("max_tokens", "model_context_window_exceeded"):
                raise LlmFatalError(TOO_LONG)
            parsed: T | None = None
            if reply.stop_reason not in ("end_turn", "stop_sequence"):
                error: str | None = f"Unerwartetes Ende der Antwort ({reply.stop_reason})"
            else:
                parsed, error = parse_output(reply.text, request.output)
                if parsed is not None and request.check is not None:
                    error = request.check(parsed)
            if parsed is not None and error is None:
                return StructuredResult(
                    parsed=parsed,
                    provider=self.provider,
                    model=reply.model,
                    calls=attempt,
                    cost_eur=round(cost_eur, 6),
                )
            log.warning(
                "KI-Ausgabe ungültig",
                extra={"task": request.task, "attempt": attempt, "error": (error or "")[:300]},
            )
            messages = [
                *messages,
                {"role": "assistant", "content": reply.content},
                {"role": "user", "content": retry_message(error or "ungültig")},
            ]
        raise LlmFatalError(INVALID_OUTPUT)


class UnconfiguredLLM:
    """KI nicht eingerichtet (kein Schlüssel, `.env` offen, unbekannter Anbieter)."""

    def __init__(self, settings: LlmSettings) -> None:
        self.provider = settings.provider
        self.issue = settings.issue

    def model_for(self, tier: Tier) -> str:
        return model_for(tier)

    def structured[T: BaseModel](
        self, request: StructuredRequest[T], meter: Meter
    ) -> StructuredResult[T]:
        raise LlmFatalError(NOT_CONFIGURED)


# ---------- Claude API ----------


def supports_fallback(model: str) -> bool:
    return model.startswith(FALLBACK_PREFIXES)


def echo_content(content: list[Any]) -> list[Any]:
    """`response.content` für das Nachfordern. Unverändert, außer nach einem Refusal-Fallback
    mitten in der Ausgabe: Thinking- und Tool-Blöcke **vor** dem letzten `fallback`-Block
    entfallen (Regel der API für das Zurückgeben von Fallback-Antworten)."""
    last = max((i for i, b in enumerate(content) if _block_type(b) == "fallback"), default=-1)
    if last < 0:
        return list(content)
    internal = {"thinking", "redacted_thinking", "tool_use", "server_tool_use"}
    return [b for i, b in enumerate(content) if i > last or _block_type(b) not in internal]


def _block_type(block: Any) -> str:
    return str(block.get("type") if isinstance(block, dict) else getattr(block, "type", ""))


def _tokens(usage: Any) -> Tokens:
    return Tokens(
        input=int(getattr(usage, "input_tokens", 0) or 0),
        output=int(getattr(usage, "output_tokens", 0) or 0),
        cache_write=int(getattr(usage, "cache_creation_input_tokens", 0) or 0),
        cache_read=int(getattr(usage, "cache_read_input_tokens", 0) or 0),
    )


def message_cost(message: Any, requested_model: str, request_id: str | None) -> CallCost:
    """Kosten einer Antwort: Summe über `usage.iterations`, falls vorhanden (je Eintrag mit dem
    Preis seines Modells, ohne Modell: das angefragte), sonst aus `usage` mit `message.model`."""
    usage = message.usage
    iterations = list(getattr(usage, "iterations", None) or [])
    total = Tokens()
    usd = 0.0
    if iterations:
        for entry in iterations:
            tokens = _tokens(entry)
            total = total + tokens
            usd += cost_usd(str(getattr(entry, "model", None) or requested_model), tokens)
    else:
        total = _tokens(usage)
        usd = cost_usd(str(message.model or requested_model), total)
    return CallCost(
        provider="anthropic",
        model=str(message.model or requested_model),
        tokens=total,
        usd=usd,
        eur=to_eur(usd),
        request_id=request_id,
    )


def _status_error(exc: anthropic.APIStatusError, model: str) -> Exception:
    status = exc.status_code
    if status == 401:
        return LlmFatalError(KEY_INVALID)
    if status in (403, 404):
        return LlmFatalError(no_access(model))
    if status == 429 or status >= 500:
        return LlmUnavailable(str(status))
    if 400 <= status < 500:
        return LlmFatalError(BAD_REQUEST)
    return LlmUnavailable("Stream")  # Fehler-Ereignis im Stream (HTTP 200)


class AnthropicBackend(Backend):
    provider = "anthropic"

    def __init__(
        self,
        api_key: str,
        *,
        http_client: Any = None,
        max_retries: int = MAX_RETRIES,
    ) -> None:
        for name in _QUIET_LOGGERS:
            logger = logging.getLogger(name)
            if logger.getEffectiveLevel() < logging.WARNING:
                logger.setLevel(logging.WARNING)
        self.client = anthropic.Anthropic(
            api_key=api_key,
            base_url=API_BASE_URL,
            timeout=TIMEOUT_S,
            max_retries=max_retries,
            http_client=http_client,
        )

    def model_for(self, tier: Tier) -> str:
        return model_for(tier)

    def send(
        self, request: StructuredRequest[Any], messages: list[dict[str, Any]], model: str
    ) -> Reply:
        kwargs: dict[str, Any] = {
            "model": model,
            "max_tokens": request.max_tokens,
            "system": request.system,
            "messages": messages,
            "output_config": {
                "effort": request.effort,
                "format": {
                    "type": "json_schema",
                    "schema": anthropic.transform_schema(request.output),
                },
            },
        }
        if supports_fallback(model):
            kwargs["betas"] = [FALLBACK_BETA]
            kwargs["fallbacks"] = "default"
        try:
            if request.stream:
                with self.client.beta.messages.stream(**kwargs) as stream:
                    message = stream.get_final_message()
                    request_id = stream.request_id
            else:
                message = self.client.beta.messages.create(**kwargs)
                request_id = message._request_id
        except anthropic.APIStatusError as exc:
            raise _status_error(exc, model) from None
        except anthropic.APITimeoutError:
            raise LlmUnavailable("Zeitlimit") from None
        except anthropic.APIConnectionError:
            raise LlmUnavailable("Verbindung") from None
        except anthropic.AnthropicError:
            raise LlmUnavailable("Fehler") from None
        details = getattr(message, "stop_details", None)
        content = list(message.content)
        return Reply(
            stop_reason=message.stop_reason,
            refusal_category=getattr(details, "category", None),
            text="".join(b.text for b in content if b.type == "text"),
            content=echo_content(content),
            model=str(message.model or model),
            cost=message_cost(message, model, request_id),
        )


# ---------- Auswahl und Zustand ----------


@dataclass
class _State:
    settings: LlmSettings | None = None
    instance: Any = None
    http_client: Any = field(default=None, repr=False)
    max_retries: int = MAX_RETRIES


_state = _State()
_lock = threading.Lock()


def configure(
    settings: LlmSettings, *, http_client: Any = None, max_retries: int = MAX_RETRIES
) -> None:
    """Beim Start (`__main__`) bzw. in Tests: Anbieter und Schlüssel festlegen."""
    with _lock:
        _state.settings = settings
        _state.instance = None
        _state.http_client = http_client
        _state.max_retries = max_retries


def reset() -> None:
    """Nur Tests: zurück auf „nicht konfiguriert“."""
    with _lock:
        _state.settings = None
        _state.instance = None
        _state.http_client = None
        _state.max_retries = MAX_RETRIES


def current_settings() -> LlmSettings:
    """Die beim Start übernommenen Einstellungen. Ohne `configure` (Tests): `SG_LLM` aus der
    Umgebung, aber nie ein Schlüssel."""
    if _state.settings is not None:
        return _state.settings
    provider = (os.environ.get("SG_LLM") or "anthropic").strip() or "anthropic"
    if provider == "fake":
        return LlmSettings(provider="fake")
    if provider != "anthropic":
        return LlmSettings(provider=provider[:40], issue="unbekannter_anbieter")
    return LlmSettings(provider=provider, issue="kein_schluessel")


def _build(settings: LlmSettings) -> StructuredLLM | UnconfiguredLLM:
    if not settings.configured:
        return UnconfiguredLLM(settings)
    if settings.provider == "fake":
        from .llm_fake import FakeBackend  # erst hier: llm_fake importiert dieses Modul

        return StructuredLLM(FakeBackend())
    assert settings.api_key is not None
    backend = AnthropicBackend(
        settings.api_key, http_client=_state.http_client, max_retries=_state.max_retries
    )
    return StructuredLLM(backend)


def get_llm() -> StructuredLLM | UnconfiguredLLM:
    """Die KI des Prozesses (nach `configure` einmal angelegt, sonst je Aufruf neu)."""
    with _lock:
        if _state.settings is None:
            return _build(current_settings())
        if _state.instance is None:
            _state.instance = _build(_state.settings)
        instance: StructuredLLM | UnconfiguredLLM = _state.instance
        return instance


def llm_status() -> dict[str, Any]:
    """`WorkerLlmStatus` für `GET /health` (§20.5). Nie der Schlüssel."""
    s = current_settings()
    return {"provider": s.provider or "?", "configured": s.configured, "issue": s.issue}


def require_configured() -> None:
    """Beim Start jedes KI-Jobs: nicht eingerichtet → `fehler` sofort."""
    if not current_settings().configured:
        raise LlmFatalError(NOT_CONFIGURED)


def last_attempt(ctx: JobContext) -> bool:
    row = ctx.conn.execute(
        "SELECT attempts >= max_attempts FROM job WHERE id = %s", (ctx.job_id,)
    ).fetchone()
    return bool(row and row[0])


@contextmanager
def job_errors(ctx: JobContext) -> Iterator[None]:
    """`LlmUnavailable` im letzten Versuch → `fehler` mit `KI nicht erreichbar (<Status>)`
    (sonst Retry nach §3, 30 s und 60 s)."""
    try:
        yield
    except LlmUnavailable as exc:
        if last_attempt(ctx):
            raise LlmFatalError(str(exc)) from None
        raise
