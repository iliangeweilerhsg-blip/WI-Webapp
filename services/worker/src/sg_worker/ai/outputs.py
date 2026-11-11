"""Ausgabemodelle der KI-Aufrufe (VERTRAEGE §20.5), versioniert mit ihrem Prompt.

Sie gehören zum Prompt (`services/worker/prompts/<aufgabe>/v<n>.md`), nicht zu `packages/schemas`:
Sie nutzen Folien-Indizes und Sekunden statt IDs, und nicht jede Grenze lässt sich in der
strukturierten Ausgabe erzwingen. Gespeichert werden immer die geprüften Typen aus
`packages/schemas` (z. B. `ConceptsExtractResult`). Ändert sich ein Modell, ändert sich auch die
Prompt-Version (alte bleiben liegen).

Grenzen, die das Schema nicht ausdrückt (Längen, Wertebereiche), prüft der Handler und verwirft
bzw. kürzt dort (§20.3 Schritt 7). Hier stehen nur Typen und Aufzählungen, damit eine knapp
danebenliegende Antwort nicht gleich als ungültig gilt.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# ---------- concepts.extract/v1 (05 §P7a) ----------

CONCEPTS_EXTRACT_PROMPT = "concepts.extract/v1"

ConceptKindOut = Literal["definition", "verfahren", "modell", "satz", "beispiel"]
RelationKindOut = Literal["baut_auf", "beispiel_fuer", "gegensatz", "angewendet_in", "verwandt"]


class ExtractTimeRange(BaseModel):
    """Zeitraum des Gesagten in Sekunden Sitzungszeit (wie die Zeiten `[h:mm:ss]` der Eingabe)."""

    model_config = ConfigDict(extra="forbid")
    start_s: int = Field(description="Beginn in Sekunden Sitzungszeit")
    end_s: int = Field(description="Ende in Sekunden Sitzungszeit, größer als start_s")


class ExtractConceptOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(description="Fachbegriff, kurz, wie in der Vorlesung")
    aliases: list[str] = Field(description="weitere Namen, z. B. der englische Begriff")
    one_liner: str = Field(description="Erklärung in einem Satz")
    kind: ConceptKindOut | None
    slides: list[int] = Field(description="Indizes der Folien (i aus <folie i=…>), die es belegen")
    times: list[ExtractTimeRange] = Field(
        description="Zeiträume des Transkripts, in denen es erklärt wird"
    )
    importance: Literal[1, 2, 3] = Field(description="1 Randnotiz, 2 wichtig, 3 zentral")
    exam_hint: bool = Field(description="true, wenn ein Klausurhinweis dazu fiel")
    prof_explanation: str | None = Field(
        description="Kernaussage des Profs dazu in 1 bis 2 Sätzen, sonst null"
    )
    confidence: float = Field(description="Selbsteinschätzung 0 bis 1")


class ExtractRelationOut(BaseModel):
    """Beziehung zwischen zwei Konzepten dieser Ausgabe, über ihre Namen."""

    model_config = ConfigDict(extra="forbid")
    from_concept: str = Field(description="Name des Konzepts A")
    to_concept: str = Field(description="Name des Konzepts B")
    kind: RelationKindOut = Field(description="„A baut_auf B“: B ist Voraussetzung von A")
    why: str = Field(description="Begründung in einem Satz")
    confidence: float = Field(description="Selbsteinschätzung 0 bis 1")


class ConceptsExtractOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    concepts: list[ExtractConceptOut]
    relations: list[ExtractRelationOut]


# ---------- concepts.resolve/v1 (05 §P8) ----------

CONCEPTS_RESOLVE_PROMPT = "concepts.resolve/v1"

ResolveVerdictOut = Literal["gleich", "teil_von", "verwandt", "verschieden"]


class ResolveDecisionOut(BaseModel):
    """Entscheidung zu einem Paar aus `<paar neu=… vorhanden=…/>`."""

    model_config = ConfigDict(extra="forbid")
    concept: str = Field(description="ref des neuen Konzepts, z. B. c3")
    candidate: str = Field(description="ref des vorhandenen Konzepts, z. B. k7")
    verdict: ResolveVerdictOut = Field(description="Verhältnis des neuen zum vorhandenen Konzept")
    reason: str = Field(description="Begründung in einem Satz")
    confidence: float = Field(description="Selbsteinschätzung 0 bis 1")


class ResolveRelationOut(BaseModel):
    """Beziehung zwischen einem neuen Konzept und einem seiner Nachbarn, über ihre refs."""

    model_config = ConfigDict(extra="forbid")
    from_ref: str = Field(description="ref des Konzepts A (c… oder k…)")
    to_ref: str = Field(description="ref des Konzepts B (c… oder k…)")
    kind: RelationKindOut = Field(description="„A baut_auf B“: B ist Voraussetzung von A")
    why: str = Field(description="Begründung in einem Satz")
    confidence: float = Field(description="Selbsteinschätzung 0 bis 1")


class ConceptsResolveOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decisions: list[ResolveDecisionOut]
    relations: list[ResolveRelationOut]


# ---------- summary.write/v1 (05 §P9) ----------

SUMMARY_WRITE_PROMPT = "summary.write/v1"


class SummarySentenceOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(description="ein Satz der Kurzfassung")
    slides: list[int] = Field(description="Indizes der Folien (i aus <folie i=…>), die ihn belegen")
    times: list[ExtractTimeRange] = Field(description="Zeiträume des Transkripts, die ihn belegen")


class SummaryOutlineOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(description="Titel des Kapitels")
    slides: list[int] = Field(description="Indizes der Folien des Kapitels")


class SummaryWriteOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sentences: list[SummarySentenceOut]
    outline: list[SummaryOutlineOut]
