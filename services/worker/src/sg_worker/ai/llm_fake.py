"""Fake der Cloud-KI (`SG_LLM=fake`, VERTRAEGE §20.3/§20.5): deterministisch, ohne Netz.

Läuft durch denselben Ablauf wie die Claude API (`StructuredLLM`: Budget, `cost_entry`,
`stop_reason`, Prüfung, Nachfordern). Kosten: `provider = fake`, `model = fake-llm-1`, Tokens
geschätzt (`ceil(UTF-8-Bytes / 3)`), Euro aus `SG_FAKE_LLM_EUR_PER_CALL` (Standard 0). So lassen
sich Kostenübersicht und Budget in der CI prüfen.

Die Ausgabe je Aufgabe liefert die Funktion in `StructuredRequest.fake`; die Regeln stehen hier.
"""

from __future__ import annotations

import logging
import math
import os
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from .interfaces import CallCost, StructuredRequest, Tier
from .llm import Backend, LlmFatalError, Reply
from .outputs import (
    ConceptsExtractOutput,
    ConceptsResolveOutput,
    ExtractConceptOut,
    ExtractRelationOut,
    ExtractTimeRange,
    ResolveDecisionOut,
    ResolveVerdictOut,
    SummaryOutlineOut,
    SummarySentenceOut,
    SummaryWriteOutput,
)
from .pricing import Tokens, usd_eur

log = logging.getLogger(__name__)

PROVIDER = "fake"
MODEL = "fake-llm-1"


def estimate_tokens(text: str) -> int:
    """`ceil(UTF-8-Bytes / 3)` (§20.3 Schritt 5, §20.5)."""
    return math.ceil(len(text.encode("utf-8")) / 3)


def fake_eur_per_call(environ: Mapping[str, str] | None = None) -> float:
    """`SG_FAKE_LLM_EUR_PER_CALL` (nur Tests), ungültig oder negativ: 0."""
    env = os.environ if environ is None else environ
    try:
        value = float((env.get("SG_FAKE_LLM_EUR_PER_CALL") or "0").strip())
    except ValueError:
        return 0.0
    return value if math.isfinite(value) and value > 0 else 0.0


def _message_text(messages: Sequence[Mapping[str, Any]]) -> str:
    parts: list[str] = []
    for message in messages:
        content = message.get("content")
        if isinstance(content, str):
            parts.append(content)
            continue
        for block in content or []:
            text = block.get("text") if isinstance(block, dict) else getattr(block, "text", None)
            if isinstance(text, str):
                parts.append(text)
    return "\n".join(parts)


class FakeBackend(Backend):
    provider = PROVIDER

    def model_for(self, tier: Tier) -> str:
        return MODEL

    def send(
        self, request: StructuredRequest[Any], messages: list[dict[str, Any]], model: str
    ) -> Reply:
        if request.fake is None:
            raise LlmFatalError(f"KI-Fake kennt die Aufgabe {request.task} nicht")
        text = request.fake().model_dump_json(by_alias=True)
        eur = fake_eur_per_call()
        rate = usd_eur()
        tokens = Tokens(
            input=estimate_tokens(request.system + "\n" + _message_text(messages)),
            output=estimate_tokens(text),
        )
        return Reply(
            stop_reason="end_turn",
            refusal_category=None,
            text=text,
            content=[{"type": "text", "text": text}],
            model=MODEL,
            cost=CallCost(
                provider=PROVIDER,
                model=MODEL,
                tokens=tokens,
                usd=round(eur / rate, 6) if rate > 0 else 0.0,
                eur=eur,
            ),
        )


# ---------- concepts.extract (§20.3 „Fake“) ----------

TEN_MIN_MS = 600_000


@dataclass(frozen=True)
class FakeSlide:
    """Eine Folie der Eingabe. `title` normiert (oder None), `spans` die Zeiten (ms) der
    Transkript-Abschnitte, die laut `slide_segment` in ihre Zeit fallen."""

    index: int
    title: str | None
    spans: list[tuple[int, int]] = field(default_factory=list)


def _range(spans: Sequence[tuple[int, int]]) -> list[ExtractTimeRange]:
    if not spans:
        return []
    start = min(s for s, _ in spans) // 1000
    end = math.ceil(max(e for _, e in spans) / 1000)
    return [ExtractTimeRange(start_s=start, end_s=max(end, start + 1))]


def _concept(name: str, slides: list[int], times: list[ExtractTimeRange]) -> ExtractConceptOut:
    return ExtractConceptOut(
        name=name,
        aliases=[],
        one_liner=f"Erfundene Erklärung zu {name}.",
        kind="definition",
        slides=slides,
        times=times,
        importance=2,
        exam_hint=False,
        prof_explanation=None,
        confidence=0.95,
    )


def concepts_extract(
    slides: Sequence[FakeSlide], segments: Sequence[tuple[int, int]]
) -> ConceptsExtractOutput:
    """Je Folie mit nicht leerem Titel (nach `index`, gleiche Vergleichsform nur einmal) ein
    Konzept mit der Folie und dem Zeitraum ihrer Abschnitte als Belegen. Ohne Folien, aber mit
    Transkript: je angefangene 10 min ein Konzept `Thema <k>`. Beziehungen
    `c(k+1) baut_auf c(k)`."""
    concepts: list[ExtractConceptOut] = []
    if slides:
        seen: set[str] = set()
        for slide in sorted(slides, key=lambda s: s.index):
            if not slide.title or slide.title.lower() in seen:
                continue
            seen.add(slide.title.lower())
            concepts.append(_concept(slide.title, [slide.index], _range(slide.spans)))
    else:
        windows: dict[int, list[tuple[int, int]]] = {}
        for start, end in segments:
            windows.setdefault(start // TEN_MIN_MS + 1, []).append((start, end))
        for k in sorted(windows):
            concepts.append(_concept(f"Thema {k}", [], _range(windows[k])))
    relations = [
        ExtractRelationOut(
            from_concept=concepts[i + 1].name,
            to_concept=concepts[i].name,
            kind="baut_auf",
            why="Folgt in der Vorlesung.",
            confidence=0.9,
        )
        for i in range(len(concepts) - 1)
    ]
    return ConceptsExtractOutput(concepts=concepts, relations=relations)


# ---------- concepts.resolve (§20.3 „Fake“) ----------


@dataclass(frozen=True)
class FakePair:
    """Ein Paar, das die KI entscheiden soll. `*_base` ist die Basisform des Namens (§20.3)."""

    concept: str
    candidate: str
    concept_base: str
    candidate_base: str


def _whole_word(inner: str, outer: str) -> bool:
    return re.search(rf"(?<!\w){re.escape(inner)}(?!\w)", outer) is not None


def concepts_resolve(pairs: Sequence[FakePair]) -> ConceptsResolveOutput:
    """`gleich`, wenn die Basisform gleich ist, `teil_von`, wenn eine die andere als ganzes Wort
    enthält, sonst `verschieden`. Konfidenz 0,9. Keine weiteren Beziehungen."""
    decisions: list[ResolveDecisionOut] = []
    for pair in pairs:
        a, b = pair.concept_base, pair.candidate_base
        verdict: ResolveVerdictOut = "verschieden"
        if a == b:
            verdict = "gleich"
        elif a and b and (_whole_word(a, b) or _whole_word(b, a)):
            verdict = "teil_von"
        decisions.append(
            ResolveDecisionOut(
                concept=pair.concept,
                candidate=pair.candidate,
                verdict=verdict,
                reason="Regel des Fakes.",
                confidence=0.9,
            )
        )
    return ConceptsResolveOutput(decisions=decisions, relations=[])


# ---------- summary.write (§20.4 „Fake“) ----------

MAX_FAKE_SENTENCES = 5
MAX_FAKE_OUTLINE = 30


@dataclass(frozen=True)
class FakeConcept:
    """Ein Konzept der Eingabe mit seinen Belegen aus dieser Session (Folien-Indizes, ms)."""

    name: str
    slides: list[int] = field(default_factory=list)
    spans: list[tuple[int, int]] = field(default_factory=list)


def summary_write(
    concepts: Sequence[FakeConcept],
    slides: Sequence[FakeSlide],
    segments: Sequence[tuple[int, int]],
) -> SummaryWriteOutput:
    """`Die Vorlesung behandelt <Name>.` für die ersten 5 Konzepte mit bis zu 2 ihrer Belege;
    ohne Konzepte `Folie <i> behandelt <Titel>.` für die ersten 5 Folien mit Titel; ohne Folien
    `Ab <mm:ss> geht es um gesprochene Inhalte.` je angefangene 10 min. Gliederung: je Folie mit
    Titel (höchstens 30) der Titel mit dieser Folie."""
    titled = [s for s in sorted(slides, key=lambda s: s.index) if s.title]
    sentences: list[SummarySentenceOut] = []
    if concepts:
        for concept in concepts[:MAX_FAKE_SENTENCES]:
            picked_slides = concept.slides[:2]
            picked_spans = concept.spans[: 2 - len(picked_slides)]
            sentences.append(
                SummarySentenceOut(
                    text=f"Die Vorlesung behandelt {concept.name}.",
                    slides=picked_slides,
                    times=[t for span in picked_spans for t in _range([span])],
                )
            )
    elif titled:
        sentences = [
            SummarySentenceOut(
                text=f"Folie {s.index} behandelt {s.title}.", slides=[s.index], times=[]
            )
            for s in titled[:MAX_FAKE_SENTENCES]
        ]
    else:
        windows: dict[int, list[tuple[int, int]]] = {}
        for start, end in segments:
            windows.setdefault(start // TEN_MIN_MS, []).append((start, end))
        for k in sorted(windows)[:MAX_FAKE_SENTENCES]:
            first = min(s for s, _ in windows[k]) // 1000
            sentences.append(
                SummarySentenceOut(
                    text=f"Ab {first // 60:02d}:{first % 60:02d} geht es um gesprochene Inhalte.",
                    slides=[],
                    times=_range(windows[k]),
                )
            )
    outline = [
        SummaryOutlineOut(title=s.title or "", slides=[s.index]) for s in titled[:MAX_FAKE_OUTLINE]
    ]
    return SummaryWriteOutput(sentences=sentences, outline=outline)
