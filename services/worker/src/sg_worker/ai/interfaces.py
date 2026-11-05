"""KI-Anbieter-Schnittstellen (docs/spezifikation/02-ARCHITEKTUR.md §7).

Nur Protokolle und Typen. Transcriber-Implementierungen stehen in `transcriber.py`, die übrigen
(bge-m3, Claude API, macOS-Stimmen) folgen mit den Pipeline-Tickets.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Protocol

from pydantic import BaseModel

Tier = Literal["fast", "standard", "deep"]
Role = Literal["system", "user", "assistant"]


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


@dataclass(frozen=True)
class Msg:
    role: Role
    content: str


@dataclass(frozen=True)
class Result:
    """Antwort eines LLM-Aufrufs. `parsed` ist gesetzt, wenn ein Schema verlangt war."""

    text: str
    model: str
    parsed: BaseModel | None = None
    input_tokens: int = 0
    output_tokens: int = 0


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
    dim: int

    def embed(self, texts: list[str]) -> list[list[float]]: ...


class LLM(Protocol):
    def complete(
        self,
        task: str,
        messages: list[Msg],
        schema: type[BaseModel] | None,
        tier: Tier,
        images: Sequence[Path] = (),
    ) -> Result: ...


class Speech(Protocol):
    def synthesize(self, text: str, voice: str, lang: str) -> Path: ...
