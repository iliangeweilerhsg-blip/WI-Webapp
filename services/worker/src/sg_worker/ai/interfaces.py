"""KI-Anbieter-Schnittstellen (docs/spezifikation/02-ARCHITEKTUR.md §7).

Nur Protokolle und Typen. Echte Implementierungen (mlx-whisper, bge-m3, Claude API,
macOS-Stimmen) folgen mit den Pipeline-Tickets.
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
class Segment:
    """Ein transkribierter Abschnitt. Zeiten in Sekunden ab Audio-Beginn."""

    start: float
    end: float
    text: str
    language: str | None = None


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
    def transcribe(self, audio: Path, language_hint: list[str]) -> list[Segment]: ...


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
