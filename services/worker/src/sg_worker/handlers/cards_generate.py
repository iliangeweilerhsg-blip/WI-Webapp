"""`cards.generate`: Kartenvorschläge zu den Konzepten einer Vorlesung
(VERTRAEGE §21.6, 05 §P10, Stufe `standard`).

Ablauf:

1. Payload prüfen, KI eingerichtet? Session lesen (fehlt → `fehler`, weich gelöscht → `fertig` mit
   `session_deleted`).
2. Konzepte der Session wie `GET /sessions/{id}/concepts` (höchstens 30). Keine → `fertig` mit
   lauter Nullen.
3. Je Konzept, der Reihe nach: schon entschieden → `skipped_decided`. Eingabe bauen (Konzept,
   nummerierte Belege `E1`…, Fragen-Marker, vorhandene Karten). Kein Belegtext → `skipped_empty`.
   Gleicher `input_hash` wie der offene Eintrag und kein `force` → `unchanged_batches`. Budget
   prüfen (ab 80 %: `fehler` sofort, „Karten pausiert“). Ein KI-Aufruf, prüfen (Inhalt, Länge,
   Belege, Lückenregel, Dubletten), eine Transaktion mit dem Inbox-Eintrag `card_batch`.
4. `fertig` mit dem Ergebnis.

Je Konzept wird sofort geschrieben: Scheitert ein späterer Aufruf, bleiben die fertigen Konzepte
stehen, und ein neuer Versuch erkennt sie am `input_hash`. Karten selbst entstehen erst beim
Annehmen im Core (§21.7), der Worker schreibt nur `inbox_item` und `cost_entry`.
"""

from __future__ import annotations

import hashlib
import math
import re
import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field
from functools import cache, partial
from pathlib import Path
from typing import Any

import psycopg
from psycopg.types.json import Jsonb
from sg_schemas.models import (
    CardProposal,
    CardsGeneratePayload,
    CardsGenerateResult,
    InboxPayloadCardBatch,
)

from .. import jobs, progress
from ..ai import embedder as embedders
from ..ai import llm as llm_mod
from ..ai import llm_fake
from ..ai.budget import CARDS_BUDGET_SHARE, BudgetReached, CostMeter
from ..ai.embedder import EmbedderNotReady, EmbedderUnavailable
from ..ai.interfaces import Effort, StructuredRequest, Tier
from ..ai.llm import INVALID_OUTPUT, TOO_LONG, LlmFatalError
from ..ai.outputs import CARDS_GENERATE_PROMPT, CardOut, CardsGenerateOutput
from ..cards.content import CardInvalid, Checked, check_content, mask_gaps
from ..cards.gaps import gap_ok
from ..concepts import material as mat
from ..concepts.names import name_key, normalize_name
from ..registry import JobContext, LockLostError, NonRetryableError, handler
from ..uuid7 import uuid7
from . import search_index
from .summary_write import SessionConcept, load_concepts

TASK = "cards.generate"
TIER: Tier = "standard"
#: Steigt mit Änderungen an Eingabe oder Prüfung (§21.6 Schritt 3.4)
CARDS_VERSION = 1
PROMPT_FILE = Path(__file__).resolve().parents[3] / "prompts" / "cards.generate" / "v1.md"
EFFORT: Effort = "medium"
MAX_TOKENS = 8_000

#: Text, mit dem der Job bei 80 % des Monatsbudgets endet (§21.6 „Budget“)
CARDS_PAUSED = "Karten pausiert (KI-Budget zu 80 % genutzt)"

MAX_CONCEPTS = 30
MAX_EVIDENCE = 12
MAX_SLIDE_TEXT = 1500
MAX_SPAN_WORDS = 300
MAX_EXISTING = 50
MAX_CARDS = 8
MAX_SOURCES = 6
MAX_FRONT_WORDS = 25
MAX_ANSWER_WORDS = 40
MAX_EXPLANATION_WORDS = 60
#: Dubletten: Ähnlichkeit der Vorderseiten über diesem Wert (05 §P10 Regel 6)
DUPLICATE_SIMILARITY = 0.92
BATCH_PRIORITY = 2000

Conn = psycopg.Connection[Any]
REFUSED_PREFIX = "KI hat die Anfrage abgelehnt"
_EVIDENCE_ID = re.compile(r"^E?([1-9][0-9]{0,3})$")


@cache
def system_prompt() -> str:
    return PROMPT_FILE.read_text(encoding="utf-8")


# ---------- Eingabe (§21.6 Schritt 3.2) ----------


@dataclass(frozen=True)
class ConceptInfo:
    id: uuid.UUID
    name: str
    aliases: tuple[str, ...]
    kind: str | None
    one_liner: str | None
    exam_relevant: bool
    status: str


@dataclass(frozen=True)
class Evidence:
    """Ein Beleg der Eingabe (`E<n>`) mit Text. `ref` ist der gespeicherte `EvidenceRef`."""

    number: int
    ref: dict[str, Any]
    text: str
    xml: str
    span: tuple[int, int] | None = None  # (start_ms, end_ms) bei Zeiträumen

    @property
    def id(self) -> str:
        return f"E{self.number}"


class MarkerHint:
    """Marker `frage` in einem Zeitraum-Beleg (05 §P10 Regel 7)."""

    def __init__(self, t_ms: int, evidence: str) -> None:
        self.t_ms = t_ms
        self.evidence = evidence


def load_infos(conn: Conn, ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, ConceptInfo]:
    rows = conn.execute(
        "SELECT id, name, aliases, kind, one_liner, exam_relevant, status FROM concept "
        "WHERE id = ANY(%s)",
        (list(ids),),
    ).fetchall()
    return {
        r[0]: ConceptInfo(r[0], r[1], tuple(r[2] or ()), r[3], r[4], bool(r[5]), r[6]) for r in rows
    }


def _slide_text(slide: mat.Slide) -> str:
    parts: list[str] = []
    title = normalize_name(slide.title or "")
    if title:
        parts.append(f"Titel: {mat.esc(title)}")
    text = normalize_name(slide.text)
    if text:
        if len(text) > MAX_SLIDE_TEXT:
            text = text[:MAX_SLIDE_TEXT] + "…"
        parts.append(f"Text: {mat.esc(text)}")
    return "\n".join(parts)


def _span_text(segments: Sequence[mat.Seg], start: int, end: int) -> str:
    texts = [
        s.text
        for s in segments
        if (s.start_ms < end and start < s.end_ms)
        or (s.start_ms == s.end_ms and start <= s.start_ms < end)
    ]
    words = " ".join(t for t in (search_index.clean_text(x) for x in texts) if t).split()
    if len(words) > MAX_SPAN_WORDS:
        return " ".join(words[:MAX_SPAN_WORDS]) + " …"
    return " ".join(words)


def build_evidence(
    material: mat.Material, concept: SessionConcept, session_id: str
) -> list[Evidence]:
    """Die Belege des Konzepts aus dieser Session als `E1`, `E2`, … (höchstens 12, Folien
    zuerst, dann Zeiträume nach Beginn). Belege ohne Text entfallen."""
    out: list[Evidence] = []
    slides = {s.index: s for s in material.slides}

    def add(ref: dict[str, Any], text: str, tag: str, span: tuple[int, int] | None) -> None:
        if not text or len(out) >= MAX_EVIDENCE:
            return
        number = len(out) + 1
        out.append(
            Evidence(number, ref, text, f'<beleg id="E{number}" {tag}>\n{text}\n</beleg>', span)
        )

    for index in concept.slides:
        slide = slides.get(index)
        if slide is None or material.deck_id is None:
            continue
        ref = {
            "kind": "slide",
            "slide_id": str(slide.id),
            "deck_id": str(material.deck_id),
            "slide_index": slide.index,
        }
        add(ref, _slide_text(slide), f'art="folie" i="{slide.index}"', None)
    for start, end in concept.spans:
        if not 0 <= start < end:
            continue
        ref = {"kind": "transcript", "session_id": session_id, "t_start_ms": start, "t_end_ms": end}
        text = mat.esc(_span_text(material.segments, start, end))
        tag = f'art="transkript" von="{mat.hms(start)}" bis="{mat.hms(end)}"'
        add(ref, text, tag, (start, end))
    return out


def marker_hints(material: mat.Material, evidence: Sequence[Evidence]) -> list[MarkerHint]:
    """Marker `frage`, deren Zeit in einem Zeitraum-Beleg liegt (erster passender Beleg)."""
    hints: list[MarkerHint] = []
    for kind, t_ms in material.markers:
        if kind != "frage":
            continue
        for e in evidence:
            if e.span is not None and e.span[0] <= t_ms <= e.span[1]:
                hints.append(MarkerHint(t_ms, e.id))
                break
    return hints


def existing_cards(conn: Conn, concept_ids: Sequence[uuid.UUID]) -> list[str]:
    """Anzeige der Vorderseiten der vorhandenen, nicht gelöschten Karten (höchstens 50, die
    neuesten, ältere zuerst). Lückentexte mit `[…]` statt der Lücken."""
    rows = conn.execute(
        "SELECT front->>'text_md' FROM card WHERE concept_id = ANY(%s) AND deleted_at IS NULL "
        "ORDER BY created_at DESC, id DESC LIMIT %s",
        (list(concept_ids), MAX_EXISTING),
    ).fetchall()
    return [mask_gaps(r[0]) for r in reversed(rows) if r[0]]


def merge_target(conn: Conn, concept_id: uuid.UUID) -> uuid.UUID | None:
    """Ziel eines offenen `concept_merge` zu diesem Vorschlag (dessen Karten gelten mit)."""
    row = conn.execute(
        "SELECT target_concept_id FROM inbox_item WHERE kind = 'concept_merge' AND concept_id = %s "
        "AND status = 'offen' AND deleted_at IS NULL ORDER BY created_at DESC, id LIMIT 1",
        (concept_id,),
    ).fetchone()
    return None if row is None else row[0]


def build_input(
    material: mat.Material,
    info: ConceptInfo,
    evidence: Sequence[Evidence],
    hints: Sequence[MarkerHint],
    existing: Sequence[str],
) -> str:
    """Die Eingabe (deterministisch). Alles Material steht in Tags, spitze Klammern sind
    maskiert."""
    head = ["<kopf>"]
    module = mat.esc(normalize_name(material.module_name or "")) or "unbekannt"
    if material.module_short:
        module += f" ({mat.esc(normalize_name(material.module_short))})"
    head.append(f"Modul: {module}")
    head.append(f"Sprache: {material.lang or 'unbekannt'}")
    if material.number is not None:
        head.append(f"Vorlesung Nr.: {material.number}")
    if material.title:
        head.append(f"Titel: {mat.esc(normalize_name(material.title))}")
    head.append("</kopf>")
    concept = ["<konzept>", f"Name: {mat.esc(normalize_name(info.name))}"]
    aliases = ", ".join(a for a in (normalize_name(x) for x in info.aliases) if a)
    if aliases:
        concept.append(f"Aliase: {mat.esc(aliases)}")
    one_liner = normalize_name(info.one_liner or "")
    if one_liner:
        concept.append(f"Erklärung: {mat.esc(one_liner)}")
    if info.kind:
        concept.append(f"Art: {info.kind}")
    concept.append(f"Klausurrelevant: {'ja' if info.exam_relevant else 'nein'}")
    concept.append("</konzept>")
    parts = ["\n".join(head), "\n".join(concept)]
    parts.append("<belege>\n" + "\n".join(e.xml for e in evidence) + "\n</belege>")
    if hints:
        lines = [f'<frage zeit="{mat.hms(h.t_ms)}" beleg="{h.evidence}"/>' for h in hints]
        parts.append("<fragen>\n" + "\n".join(lines) + "\n</fragen>")
    if existing:
        lines = [f"<karte>{mat.esc(normalize_name(text))}</karte>" for text in existing]
        parts.append("<vorhandene_karten>\n" + "\n".join(lines) + "\n</vorhandene_karten>")
    lang = mat.LANG_NAMES.get(material.lang or "", "die Sprache der Vorlesung")
    parts.append(f"Ausgabesprache: {lang}")
    return "\n\n".join(parts)


def input_hash(model: str, text: str, prompt_version: str = CARDS_GENERATE_PROMPT) -> str:
    """SHA-256 über `prompt_version \\n Modell \\n CARDS_VERSION \\n Eingabe` (§20.3 Schritt 4)."""
    data = "\n".join([prompt_version, model, str(CARDS_VERSION), text])
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


# ---------- Prüfen (§21.6 Schritt 3.7) ----------


@dataclass
class Candidate:
    content: dict[str, Any]
    sources: list[dict[str, Any]]
    plain: str


@dataclass
class Checks:
    """Ergebnis der Prüfungen ohne Dubletten. `delivered`: Karten, die die KI geliefert hat."""

    delivered: int = 0
    kept: list[Candidate] = field(default_factory=list)
    dropped_invalid: int = 0
    dropped_length: int = 0
    dropped_sources: int = 0
    dropped_cloze: int = 0


def to_content(card: CardOut) -> dict[str, Any]:
    """Ausgabe der KI als `CardContent` (ungeprüft)."""
    if card.kind == "basic":
        return {
            "kind": "basic",
            "front": {"text_md": card.front},
            "back": {"text_md": card.answer, "explanation_md": card.explanation},
        }
    answers: dict[str, list[str]] = {}
    for gap in card.gaps:
        key = f"c{gap.gap}"
        if key in answers:
            raise CardInvalid("cloze_answers")
        answers[key] = list(gap.solutions)
    return {"kind": "cloze", "front": {"text_md": card.front}, "back": {"answers": answers}}


def card_sources(card: CardOut, evidence: Sequence[Evidence]) -> list[dict[str, Any]]:
    """Gültige Belege (Nummern aus der Eingabe, ohne Dubletten, höchstens 6)."""
    by_id = {e.id: e for e in evidence}
    refs: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in card.evidence:
        m = _EVIDENCE_ID.match(raw.strip().upper())
        key = f"E{m.group(1)}" if m else ""
        if key not in by_id or key in seen:
            continue
        seen.add(key)
        refs.append(by_id[key].ref)
    return refs[:MAX_SOURCES]


def too_long(checked: Checked) -> bool:
    """Länge nach 05 §P10 Regel 1. Die Länge der Lücken prüft die Lückenregel."""
    if checked.front_words > MAX_FRONT_WORDS or checked.explanation_words > MAX_EXPLANATION_WORDS:
        return True
    return checked.content["kind"] == "basic" and checked.answer_words > MAX_ANSWER_WORDS


def check_cards(out: CardsGenerateOutput, evidence: Sequence[Evidence]) -> Checks:
    """Inhalt, Länge, Belege, Lückenregel: jede Karte fällt beim ersten Verstoß weg."""
    checks = Checks(delivered=len(out.cards))
    for card in out.cards:
        try:
            checked = check_content(to_content(card))
        except CardInvalid:
            checks.dropped_invalid += 1
            continue
        if too_long(checked):
            checks.dropped_length += 1
            continue
        sources = card_sources(card, evidence)
        if not sources:
            checks.dropped_sources += 1
            continue
        if checked.content["kind"] == "cloze" and not all(gap_ok(g) for g in checked.gaps):
            checks.dropped_cloze += 1
            continue
        try:  # Netz und doppelter Boden: genau das Format, das der Core annimmt
            CardProposal.model_validate(
                {"key": "k1", "content": checked.content, "sources": sources}
            )
        except ValueError:
            checks.dropped_invalid += 1
            continue
        checks.kept.append(Candidate(checked.content, sources, checked.plain))
    return checks


def no_valid_message(checks: Checks) -> str:
    return (
        "Keine Karte war gültig "
        f"(ungültiger Inhalt: {checks.dropped_invalid}, zu lang: {checks.dropped_length}, "
        f"ohne gültigen Beleg: {checks.dropped_sources}, "
        f"ungeeignete Lücke: {checks.dropped_cloze}). "
        "Vorderseite höchstens 25 Wörter, Antwort 40, Erklärung 60. "
        "Belege nur als Nummern E1, E2, … aus dem Material. "
        "Lücken {{c1::…}} lückenlos ab 1, höchstens drei, nur auf Fachbegriffe "
        "mit einem bis fünf Wörtern (keine Füllwörter), die erste Lösung ist der Text der Lücke."
    )


# ---------- Dubletten (§21.6 Schritt 3.7) ----------


def _cosine(a: Sequence[float], b: Sequence[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na > 0 and nb > 0 else 0.0


class Dedupe:
    """Dubletten gegen vorhandene Karten und schon behaltene Karten dieser Ausgabe. Mit Embedder
    (Ähnlichkeit über 0,92), ohne Embedder nur über gleiche Vergleichsform `key` (§20.3). Die
    Vektoren der vorhandenen Karten werden bei jedem Lauf neu berechnet und nie gespeichert."""

    def __init__(self) -> None:
        self.degraded = False
        self.used = False

    def _embed(self, texts: list[str]) -> list[list[float] | None] | None:
        embedder = search_index.get_embedder()
        try:
            if not embedder.wait_ready(search_index.WAIT_READY_S):
                raise EmbedderUnavailable(embedder.error() or "Embedder nicht bereit")
            vectors: list[list[float] | None] = []
            for i in range(0, len(texts), search_index.EMBED_BATCH):
                batch = texts[i : i + search_index.EMBED_BATCH]
                embedders.ENDPOINT_PRIORITY.wait_idle()  # Suchanfragen gehen vor (§19.2)
                if embedders.SHUTDOWN.is_set():
                    raise EmbedderUnavailable("Worker wird beendet")
                got = embedder.embed(batch)
                if len(got) != len(batch):
                    raise RuntimeError("Embedder lieferte eine falsche Anzahl Vektoren")
                vectors += [search_index._valid_vector(v, embedder.dim) for v in got]
        except (EmbedderNotReady, EmbedderUnavailable):
            self.degraded = True
            return None
        self.used = True
        return vectors

    def filter(
        self, existing: Sequence[str], candidates: list[Candidate]
    ) -> tuple[list[Candidate], int]:
        """Die behaltenen Karten und die Zahl der Dubletten."""
        if not candidates:
            return [], 0
        texts = [search_index.clean_text(t) for t in [*existing, *(c.plain for c in candidates)]]
        vectors = self._embed(texts) if len(texts) > 1 else None
        if vectors is None:
            vectors = [None] * len(texts)
        keys = {name_key(t) for t in texts[: len(existing)]}
        known = [v for v in vectors[: len(existing)] if v is not None]
        kept: list[Candidate] = []
        dropped = 0
        for cand, text, vec in zip(
            candidates, texts[len(existing) :], vectors[len(existing) :], strict=True
        ):
            key = name_key(text)
            similar = vec is not None and any(
                _cosine(vec, other) > DUPLICATE_SIMILARITY for other in known
            )
            if key in keys or similar:
                dropped += 1
                continue
            keys.add(key)
            if vec is not None:
                known.append(vec)
            kept.append(cand)
        return kept, dropped

    def model(self) -> str | None:
        """`embedding_model` des Ergebnisses: null ohne Embedder (Dubletten nur über Text)."""
        if self.degraded:
            return None
        embedder = search_index.get_embedder()
        return embedder.model if self.used or embedder.ready() else None


# ---------- Budget ----------


class CardsMeter(CostMeter):
    """Wie `CostMeter`, aber ab 80 % des Monatsbudgets (§21.6) und mit dem Text der Pause. Die
    Ausnahme ist kein `LlmFatalError` des Standardtexts `Monatsbudget erreicht`: `structured`
    reicht sie unverändert durch, der Job endet sofort mit `fehler` und kein Retry."""

    def __init__(self, conn: Conn, **kwargs: Any) -> None:
        super().__init__(conn, budget_share=CARDS_BUDGET_SHARE, **kwargs)

    def check(self) -> None:
        try:
            super().check()
        except BudgetReached:
            raise NonRetryableError(CARDS_PAUSED) from None


# ---------- Ergebnis ----------


@dataclass
class Counts:
    concepts: int = 0
    proposed_batches: int = 0
    proposed_cards: int = 0
    unchanged_batches: int = 0
    skipped_decided: int = 0
    skipped_empty: int = 0
    failed_concepts: int = 0
    dropped_invalid: int = 0
    dropped_length: int = 0
    dropped_sources: int = 0
    dropped_cloze: int = 0
    dropped_duplicates: int = 0
    called: bool = False
    model: str | None = None


def _result(
    sid: uuid.UUID, counts: Counts, dedupe: Dedupe | None, cost: float, **values: Any
) -> dict[str, Any]:
    base: dict[str, Any] = {
        "session_id": str(sid),
        "session_deleted": False,
        "concepts": counts.concepts,
        "proposed_batches": counts.proposed_batches,
        "proposed_cards": counts.proposed_cards,
        "unchanged_batches": counts.unchanged_batches,
        "skipped_decided": counts.skipped_decided,
        "skipped_empty": counts.skipped_empty,
        "failed_concepts": counts.failed_concepts,
        "dropped_invalid": counts.dropped_invalid,
        "dropped_length": counts.dropped_length,
        "dropped_sources": counts.dropped_sources,
        "dropped_cloze": counts.dropped_cloze,
        "dropped_duplicates": counts.dropped_duplicates,
        "embedding_model": None if dedupe is None or not counts.called else dedupe.model(),
        "prompt_version": CARDS_GENERATE_PROMPT if counts.called else None,
        "model": counts.model,
        "cost_eur": round(cost, 6),
    }
    base.update(values)
    return CardsGenerateResult.model_validate(base).model_dump(mode="json", by_alias=True)


def _finish(ctx: JobContext, result: dict[str, Any]) -> dict[str, Any]:
    ctx.finish(result)
    if not ctx.lock_ok:
        raise LockLostError(ctx.job_id)
    return result


def _refusal(message: str) -> bool:
    """Fehler eines einzelnen Konzepts (§21.6): Ablehnung, zu lange oder ungültige Ausgabe."""
    return message in (INVALID_OUTPUT, TOO_LONG) or message.startswith(REFUSED_PREFIX)


# ---------- Schreiben (§21.6 Schritt 3.8) ----------

INSERT_SQL = """
INSERT INTO inbox_item (id, user_id, kind, session_id, job_id, payload, priority, card_concept_id)
VALUES (%s, %s, 'card_batch', %s, %s, %s, %s, %s)
"""


def write_batch(
    ctx: JobContext,
    material: mat.Material,
    sid: uuid.UUID,
    info: ConceptInfo,
    position: int,
    payload: dict[str, Any],
) -> str:
    """Eine Transaktion je Konzept: `written`, `session_deleted`, `decided` (inzwischen entschieden
    oder Konzept abgelehnt) oder `gone` (Konzept gelöscht oder Hülle)."""
    conn = ctx.conn
    with conn.transaction():
        if not progress.lock_session(conn, sid):
            return "session_deleted"
        if not jobs.heartbeat(conn, ctx.job_id, ctx.worker_id):
            raise LockLostError(ctx.job_id)
        row = conn.execute(
            "SELECT status, deleted_at FROM concept WHERE id = %s FOR KEY SHARE", (info.id,)
        ).fetchone()
        if row is None or row[1] is not None or row[0] == "zusammengefuehrt":
            return "gone"
        rejected = conn.execute(
            "SELECT 1 FROM inbox_item WHERE concept_id = %s AND status = 'abgelehnt' "
            "AND deleted_at IS NULL LIMIT 1",
            (info.id,),
        ).fetchone()
        decided = conn.execute(
            "SELECT 1 FROM inbox_item WHERE kind = 'card_batch' AND card_concept_id = %s "
            "AND session_id = %s AND status <> 'offen' LIMIT 1",
            (info.id, sid),
        ).fetchone()
        if rejected is not None or decided is not None:
            return "decided"
        conn.execute(
            "DELETE FROM inbox_item WHERE kind = 'card_batch' AND card_concept_id = %s "
            "AND session_id = %s AND status = 'offen'",
            (info.id, sid),
        )
        conn.execute(
            INSERT_SQL,
            (
                uuid7(),
                material.user_id,
                sid,
                uuid.UUID(ctx.job_id),
                Jsonb(payload),
                BATCH_PRIORITY + position,
                info.id,
            ),
        )
    return "written"


# ---------- Handler ----------


def _inbox_state(conn: Conn, concept_id: uuid.UUID, sid: uuid.UUID) -> tuple[bool, str | None]:
    """(entschieden?, `input_hash` des offenen Eintrags) zu `(Konzept, Session)`."""
    rows = conn.execute(
        "SELECT status, payload->>'input_hash' FROM inbox_item WHERE kind = 'card_batch' "
        "AND card_concept_id = %s AND session_id = %s ORDER BY created_at DESC, id",
        (concept_id, sid),
    ).fetchall()
    if any(r[0] != "offen" for r in rows):
        return True, None
    return False, rows[0][1] if rows else None


@handler(TASK, payload_type=CardsGeneratePayload)
def cards_generate(payload: CardsGeneratePayload, ctx: JobContext) -> dict[str, Any]:
    sid = uuid.UUID(payload.session_id)
    conn = ctx.conn
    llm_mod.require_configured()
    row = mat.session_row(conn, sid)
    if row is None:
        raise NonRetryableError("Session unbekannt")
    counts = Counts()
    if row[1] is not None:
        with conn.transaction():
            progress.lock_session(conn, sid)
            return _finish(ctx, _result(sid, counts, None, 0.0, session_deleted=True))
    material = mat.load(conn, sid, row)
    concepts = load_concepts(conn, sid, material.deck_id)[:MAX_CONCEPTS]
    counts.concepts = len(concepts)
    if not concepts:
        with conn.transaction():
            if not progress.lock_session(conn, sid):
                return _finish(ctx, _result(sid, counts, None, 0.0, session_deleted=True))
            return _finish(ctx, _result(sid, counts, None, 0.0))

    llm = llm_mod.get_llm()
    model = llm.model_for(TIER)
    infos = load_infos(conn, [c.id for c in concepts])
    meter = CardsMeter(
        conn, user_id=material.user_id, job_id=ctx.job_id, session_id=str(sid), task=TASK
    )
    dedupe = Dedupe()

    for position, concept in enumerate(concepts):
        info = infos.get(concept.id)
        if info is None:
            counts.skipped_empty += 1
            continue
        decided, open_hash = _inbox_state(conn, info.id, sid)
        if decided:
            counts.skipped_decided += 1
            continue
        evidence = build_evidence(material, concept, str(sid))
        if not evidence:
            counts.skipped_empty += 1
            continue
        concept_ids = [info.id]
        if info.status == "vorschlag":
            target = merge_target(conn, info.id)
            if target is not None:
                concept_ids.append(target)
        existing = existing_cards(conn, concept_ids)
        text = build_input(material, info, evidence, marker_hints(material, evidence), existing)
        digest = input_hash(model, text)
        if open_hash == digest and not payload.force:
            counts.unchanged_batches += 1
            continue

        def usable(out: CardsGenerateOutput, evidence: Sequence[Evidence] = evidence) -> str | None:
            checks = check_cards(out, evidence)
            return None if not checks.delivered or checks.kept else no_valid_message(checks)

        request = StructuredRequest(
            task=TASK,
            tier=TIER,
            prompt_version=CARDS_GENERATE_PROMPT,
            system=system_prompt(),
            material=text,
            output=CardsGenerateOutput,
            effort=EFFORT,
            max_tokens=MAX_TOKENS,
            stream=False,
            check=usable,
            fake=partial(llm_fake.cards_generate, info.name, info.one_liner),
        )
        counts.called = True
        try:
            with llm_mod.job_errors(ctx):
                answer = llm.structured(request, meter)
        except LlmFatalError as exc:
            if not _refusal(str(exc)):
                raise
            ctx.logger.warning(
                "Karten für ein Konzept gescheitert", extra={"error": str(exc)[:200]}
            )
            counts.failed_concepts += 1
            continue
        counts.model = answer.model
        checks = check_cards(answer.parsed, evidence)
        if not checks.delivered:
            counts.skipped_empty += 1
            continue
        counts.dropped_invalid += checks.dropped_invalid
        counts.dropped_length += checks.dropped_length
        counts.dropped_sources += checks.dropped_sources
        counts.dropped_cloze += checks.dropped_cloze
        kept, duplicates = dedupe.filter(existing, checks.kept)
        counts.dropped_duplicates += duplicates
        kept = kept[:MAX_CARDS]
        if not kept:
            counts.skipped_empty += 1
            continue
        stored = {
            "kind": "card_batch",
            "concept_id": str(info.id),
            "concept_name": info.name,
            "cards": [
                {"key": f"k{i}", "content": c.content, "sources": c.sources}
                for i, c in enumerate(kept, start=1)
            ],
            "input_hash": digest,
            "prompt_version": CARDS_GENERATE_PROMPT,
            "model": answer.model,
        }
        InboxPayloadCardBatch.model_validate(stored)  # genau das Format, das der Core liest
        outcome = write_batch(ctx, material, sid, info, position, stored)
        if outcome == "session_deleted":
            with conn.transaction():
                progress.lock_session(conn, sid)
                return _finish(
                    ctx,
                    _result(sid, counts, dedupe, meter.total_eur, session_deleted=True),
                )
        if outcome == "written":
            counts.proposed_batches += 1
            counts.proposed_cards += len(kept)
        elif outcome == "decided":
            counts.skipped_decided += 1
        else:
            counts.skipped_empty += 1

    if counts.failed_concepts and not counts.proposed_batches and not counts.unchanged_batches:
        raise NonRetryableError(INVALID_OUTPUT)
    ctx.logger.info(
        "Kartenvorschläge geschrieben",
        extra={"batches": counts.proposed_batches, "cards": counts.proposed_cards},
    )
    with conn.transaction():
        if not progress.lock_session(conn, sid):
            return _finish(ctx, _result(sid, counts, dedupe, meter.total_eur, session_deleted=True))
        return _finish(ctx, _result(sid, counts, dedupe, meter.total_eur))
