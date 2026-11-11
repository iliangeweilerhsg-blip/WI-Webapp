"""KI-Anbieter-Schnittstellen (docs/spezifikation/02-ARCHITEKTUR.md §7).

Nur Protokolle und Typen. Transcriber-Implementierungen stehen in `transcriber.py`, Embedder in
`embedder.py`, die Cloud-KI (Claude API und Fake) in `llm.py`, macOS-Stimmen folgen später.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Protocol

from pydantic import BaseModel

from .pricing import Tokens

Tier = Literal["fast", "standard", "deep"]


@dataclass(frozen=True)
class Word:
    """Ein Wort mit Zeitstempel (VERTRAEGE §18.6). Zeiten in Sekunden ab Dateibeginn."""

    start: float
    end: float
    text: str
    prob: float


@dataclass(frozen=True)
class Segment:
    """Ein transkribierter Abschnitt (VERTRAEGE §18.6). Zeiten in Sekunden ab Dateibeginn.
    `language` ist die erkannte Sprache (ISO 639-1)."""

    start: float
    end: float
    text: str
    language: str | None = None
    avg_logprob: float | None = None
    no_speech_prob: float | None = None
    words: tuple[Word, ...] = ()


class Transcriber(Protocol):
    """Transkription einer Audiodatei (VERTRAEGE §18.6, Abweichung von 02 §7: `language` statt
    `language_hint`, dazu `initial_prompt` und `duration_ms`). Implementierungen in
    `ai/transcriber.py`: `mlx-whisper` (nur macOS arm64) und `fake` (CI, Linux)."""

    provider: str  # "mlx-whisper" | "fake" (TranscriptProvider)
    model: str

    def transcribe(
        self, audio: Path, *, language: str | None, initial_prompt: str | None, duration_ms: int
    ) -> list[Segment]: ...


class Embedder(Protocol):
    """Text-Embeddings (VERTRAEGE §19.2, erweitert 02 §7). Implementierungen in `ai/embedder.py`:
    `bge-m3` (nur macOS arm64, lädt im Hintergrund) und `fake` (CI, Linux).

    `ready()`: Modell geladen, `embed` liefert Vektoren. `error()`: Grund, warum der Embedder
    dauerhaft nicht verfügbar ist (sonst None). `wait_ready` wartet höchstens `timeout_s` Sekunden
    auf das Ende des Ladens und gibt `ready()` zurück. `embed` ist thread-sicher (Job-Schleife und
    Loopback-Endpunkt teilen sich ein Modell) und liefert je Text einen L2-normierten Vektor der
    Länge `dim` in derselben Reihenfolge."""

    provider: str  # "bge-m3" | "fake"
    model: str  # "BAAI/bge-m3" | "fake-embed-1" (search_chunk.embedding_model)
    dim: int

    def ready(self) -> bool: ...

    def error(self) -> str | None: ...

    def wait_ready(self, timeout_s: float) -> bool: ...

    def embed(self, texts: list[str]) -> list[list[float]]: ...


Effort = Literal["low", "medium", "high", "xhigh", "max"]


@dataclass(frozen=True)
class CallCost:
    """Kosten eines KI-Aufrufs, eine `cost_entry` (VERTRAEGE §20.5)."""

    provider: str
    model: str
    tokens: Tokens
    usd: float
    eur: float
    request_id: str | None = None


class Meter(Protocol):
    """Budget und Kosten eines Jobs (`ai/budget.py`, `CostMeter`)."""

    def check(self) -> None:
        """Vor jedem Aufruf: `BudgetReached`, wenn das Monatsbudget erreicht ist."""
        ...

    def record(self, cost: CallCost) -> None:
        """Direkt nach jedem Aufruf: eine `cost_entry` in eigener Transaktion."""
        ...


@dataclass(frozen=True)
class StructuredRequest[T: BaseModel]:
    """Ein KI-Aufruf mit strukturierter Ausgabe (VERTRAEGE §20.5, Form legt T2-21a fest).

    - `system`: die Anweisung (Prompt-Datei). `material`: die Nutzer-Nachricht, alles Material
      steht darin in Tags (§20.3). `shared_head`: bei mehreren Kapiteln der gemeinsame Kopf, als
      eigener Block vor `material` mit Prompt-Caching.
    - `output`: Ausgabemodell aus `ai/outputs.py`, versioniert mit dem Prompt (`prompt_version`).
    - `check`: fachliche Prüfung der geparsten Ausgabe. Ein Text heißt „ganz unbrauchbar“: einmal
      nachfordern mit diesem Text als Fehlermeldung (§20.5), None heißt gültig.
    - `fake`: deterministische Ausgabe für `SG_LLM=fake` (Regeln in `ai/llm_fake.py`).
    """

    task: str
    tier: Tier
    prompt_version: str
    system: str
    material: str
    output: type[T]
    effort: Effort
    max_tokens: int
    stream: bool
    shared_head: str | None = None
    check: Callable[[T], str | None] | None = None
    fake: Callable[[], T] | None = None


@dataclass(frozen=True)
class StructuredResult[T: BaseModel]:
    """Geprüfte Ausgabe. `model` ist das Modell der letzten Antwort (nach einem Refusal-Fallback
    das tatsächlich genutzte), `cost_eur` die Summe aller Aufrufe (mit Nachfordern)."""

    parsed: T
    provider: str
    model: str
    calls: int
    cost_eur: float


class LLM(Protocol):
    """Cloud-KI mit strukturierter Ausgabe (`ai/llm.py`: Claude API und Fake). Fehler sind
    `NonRetryableError` (Texte aus §20.5) oder `LlmUnavailable` (Retry nach §3)."""

    provider: str

    def model_for(self, tier: Tier) -> str:
        """Das für die Stufe konfigurierte Modell (nicht das einer Antwort nach Fallback)."""
        ...

    def structured[T: BaseModel](
        self, request: StructuredRequest[T], meter: Meter
    ) -> StructuredResult[T]: ...


class Speech(Protocol):
    def synthesize(self, text: str, voice: str, lang: str) -> Path: ...
