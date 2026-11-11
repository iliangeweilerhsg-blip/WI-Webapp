"""`summary.write`: Kurzfassung einer Vorlesung in bis zu 5 Sätzen mit Gliederung
(VERTRAEGE §20.4, 05 §P9 ohne Vault, F-NAC-08, Stufe `standard`).

Ablauf:

1. Payload prüfen, KI eingerichtet? Session lesen (fehlt → `fehler`, weich gelöscht → `fertig` mit
   `session_deleted`).
2. Eingabe wie `concepts.extract` (§20.3 Schritt 2), aber höchstens 300 Wörter Transkript je
   Folie, dazu die Konzepte der Session (aktive und Vorschläge mit Belegen aus dieser Session,
   ohne abgelehnte: Name und One-Liner).
3. Weder Folien noch Transkript: eine vorhandene Zusammenfassung hart löschen, `skipped`.
4. `input_hash` (mit `SUMMARY_VERSION`). Gleich wie gespeichert und kein `force`: `unchanged`.
5. KI-Aufruf außerhalb einer Transaktion. Belege prüfen wie §20.3 Schritt 7: Ein Satz ohne
   gültigen Beleg fällt weg, höchstens 6 Belege je Satz, höchstens 5 Sätze. Bleibt kein Satz,
   wird einmal nachgefordert.
6. Eine Transaktion: Session sperren, `session_summary` ersetzen, `fertig`.

Die Kurzfassung ist direkt sichtbar und kein Inbox-Vorschlag (§20.4).
"""

from __future__ import annotations

import dataclasses
import hashlib
import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field
from functools import cache, partial
from pathlib import Path
from typing import Any

import psycopg
from psycopg.types.json import Jsonb
from sg_schemas.models import SummaryWritePayload, SummaryWriteResult

from .. import progress
from ..ai import llm as llm_mod
from ..ai import llm_fake
from ..ai.budget import CostMeter
from ..ai.interfaces import Effort, StructuredRequest, Tier
from ..ai.outputs import SUMMARY_WRITE_PROMPT, ExtractTimeRange, SummaryWriteOutput
from ..concepts import material as mat
from ..concepts.names import normalize_name
from ..registry import JobContext, LockLostError, NonRetryableError, handler
from ..uuid7 import uuid7
from .search_index import clean_text

TASK = "summary.write"
TIER: Tier = "standard"
#: Steigt mit Änderungen an Eingabe oder Prüfung (§20.4 Schritt 4)
SUMMARY_VERSION = 1
PROMPT_FILE = Path(__file__).resolve().parents[3] / "prompts" / "summary.write" / "v1.md"
EFFORT: Effort = "medium"
MAX_TOKENS = 32_000

MAX_WORDS_PER_SLIDE = 300
MAX_SENTENCES = 5
MAX_SOURCES = 6
MAX_OUTLINE = 30
MAX_SENTENCE = 600
MAX_TITLE = 200

Conn = psycopg.Connection[Any]


# ---------- Eingabe ----------


@dataclass(frozen=True)
class SessionConcept:
    """Ein Konzept der Session mit seinen Belegen aus dieser Session."""

    id: uuid.UUID
    name: str
    one_liner: str | None
    slides: tuple[int, ...] = ()
    spans: tuple[tuple[int, int], ...] = ()


def limit_words(material: mat.Material, limit: int) -> mat.Material:
    """Kürzt das Gesagte je Folie auf die ersten `limit` Wörter (Rest als „…“). Die Zeiten der
    Abschnitte bleiben, damit `von`/`bis` und die Zuordnung zur Folie gleich bleiben."""
    per_slide, _ = mat.assign(material)
    texts: dict[int, str] = {}
    for segs in per_slide.values():
        left = limit
        for seg in segs:
            words = clean_text(seg.text).split()
            if left <= 0:
                texts[id(seg)] = ""
            elif len(words) > left:
                texts[id(seg)] = " ".join(words[:left]) + " …"
                left = 0
            else:
                left -= len(words)
    segments = [
        dataclasses.replace(seg, text=texts[id(seg)]) if id(seg) in texts else seg
        for seg in material.segments
    ]
    return dataclasses.replace(material, segments=segments)


def load_concepts(conn: Conn, sid: uuid.UUID, deck_id: uuid.UUID | None) -> list[SessionConcept]:
    """Aktive Konzepte und Vorschläge mit Belegen aus dieser Session, ohne abgelehnte. Reihenfolge
    wie `GET /sessions/{id}/concepts`: kleinster Folien-Index, frühester Zeitpunkt, Name."""
    rows = conn.execute(
        """
        SELECT c.id, c.name, c.one_liner, e.kind, e.t_start_ms, e.t_end_ms, s.index
        FROM concept c
        JOIN evidence e ON e.concept_id = c.id AND e.session_id = %s AND e.deleted_at IS NULL
        LEFT JOIN slide s ON e.kind = 'slide' AND s.id = e.ref_id AND s.deleted_at IS NULL
          AND s.deck_id = %s
        WHERE c.deleted_at IS NULL AND c.status IN ('aktiv', 'vorschlag')
          AND NOT EXISTS (SELECT 1 FROM inbox_item i WHERE i.concept_id = c.id
                          AND i.status = 'abgelehnt' AND i.deleted_at IS NULL)
        ORDER BY c.id, e.id
        """,
        (sid, deck_id),
    ).fetchall()
    slides: dict[uuid.UUID, set[int]] = {}
    spans: dict[uuid.UUID, set[tuple[int, int]]] = {}
    info: dict[uuid.UUID, tuple[str, str | None]] = {}
    for cid, name, one_liner, kind, start, end, index in rows:
        info[cid] = (name, one_liner)
        if kind == "slide" and index is not None:
            slides.setdefault(cid, set()).add(int(index))
        elif kind == "transcript" and start is not None and end is not None:
            spans.setdefault(cid, set()).add((int(start), int(end)))
    concepts = [
        SessionConcept(
            cid,
            name,
            one_liner,
            tuple(sorted(slides.get(cid, ()))),
            tuple(sorted(spans.get(cid, ()))),
        )
        for cid, (name, one_liner) in info.items()
    ]
    far = float("inf")
    return sorted(
        concepts,
        key=lambda c: (
            c.slides[0] if c.slides else far,
            c.spans[0][0] if c.spans else far,
            c.name.lower(),
            c.id,
        ),
    )


def concepts_block(concepts: Sequence[SessionConcept]) -> str:
    lines = ["<konzepte>"]
    for concept in concepts:
        text = mat.esc(normalize_name(concept.name))
        one_liner = normalize_name(concept.one_liner or "")
        if one_liner:
            text += f": {mat.esc(one_liner)}"
        lines.append(f"<konzept>{text}</konzept>")
    lines.append("</konzepte>")
    return "\n".join(lines)


def build_input(
    material: mat.Material, concepts: Sequence[SessionConcept]
) -> tuple[mat.Built, str]:
    """Die Eingabe (deterministisch): wie `concepts.extract` mit höchstens 300 Wörtern je Folie,
    danach die Konzepte der Session."""
    built = mat.build_input(limit_words(material, MAX_WORDS_PER_SLIDE))
    if not concepts:
        return built, built.full
    footer = concepts_block(concepts) + "\n\n" + built.footer
    return built, mat.compose(built.head, built.items, footer)


def input_hash(model: str, text: str, prompt_version: str = SUMMARY_WRITE_PROMPT) -> str:
    """SHA-256 über `prompt_version \\n Modell \\n SUMMARY_VERSION \\n Eingabe` (§20.4)."""
    data = "\n".join([prompt_version, model, str(SUMMARY_VERSION), text])
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


@cache
def system_prompt() -> str:
    return PROMPT_FILE.read_text(encoding="utf-8")


# ---------- Prüfen (§20.4 Schritt 5) ----------


@dataclass
class Checked:
    sentences: list[dict[str, Any]] = field(default_factory=list)
    outline: list[dict[str, Any]] = field(default_factory=list)
    dropped_sentences: int = 0


def _sources(
    material: mat.Material,
    session_id: str,
    indices: Sequence[int],
    times: Sequence[ExtractTimeRange],
) -> list[dict[str, Any]]:
    """Gültige Belege wie §20.3 Schritt 7 (Folien zuerst, dann Zeiträume nach Beginn), ≤ 6."""
    slides = {s.index: s for s in material.slides}
    refs: list[dict[str, Any]] = []
    for index in sorted(set(indices)):
        slide = slides.get(index)
        if slide is not None and material.deck_id is not None:
            refs.append(
                {
                    "kind": "slide",
                    "slide_id": str(slide.id),
                    "deck_id": str(material.deck_id),
                    "slide_index": slide.index,
                }
            )
    end_ms = material.timeline_end_ms
    ranges: list[tuple[int, int]] = []
    for r in times:
        start = min(max(r.start_s * 1000, 0), end_ms)
        end = min(max(r.end_s * 1000, 0), end_ms)
        if (
            start < end
            and end - start <= mat.MAX_RANGE_MS
            and mat.overlaps(material.segments, start, end)
        ):
            ranges.append((start, end))
    refs += [
        {"kind": "transcript", "session_id": session_id, "t_start_ms": s, "t_end_ms": e}
        for s, e in mat.merge_ranges(ranges)
    ]
    return refs[:MAX_SOURCES]


def check_output(out: SummaryWriteOutput, material: mat.Material, session_id: str) -> Checked:
    checked = Checked()
    for sentence in out.sentences:
        text = mat.shorten(sentence.text, MAX_SENTENCE)
        sources = _sources(material, session_id, sentence.slides, sentence.times)
        if text is None or not sources or len(checked.sentences) >= MAX_SENTENCES:
            checked.dropped_sentences += 1
            continue
        checked.sentences.append({"text": text, "sources": sources})
    for item in out.outline:
        title = mat.shorten(item.title, MAX_TITLE)
        if title is None or len(checked.outline) >= MAX_OUTLINE:
            continue
        checked.outline.append(
            {"title": title, "sources": _sources(material, session_id, item.slides, [])}
        )
    return checked


NO_VALID = (
    "Kein Satz hatte einen gültigen Beleg. Folien-Indizes müssen aus <folie i=…> stammen, "
    "Zeiträume in Sekunden Sitzungszeit innerhalb eines <transkript>-Abschnitts liegen und "
    "höchstens 20 Minuten lang sein."
)


# ---------- Ergebnis ----------


def _result(sid: uuid.UUID, **values: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "session_id": str(sid),
        "session_deleted": False,
        "skipped": False,
        "unchanged": False,
        "input_hash": None,
        "sentence_count": 0,
        "outline_count": 0,
        "dropped_sentences": 0,
        "prompt_version": None,
        "model": None,
        "cost_eur": 0.0,
    }
    base.update(values)
    return SummaryWriteResult.model_validate(base).model_dump(mode="json", by_alias=True)


def _finish(ctx: JobContext, result: dict[str, Any]) -> dict[str, Any]:
    ctx.finish(result)
    if not ctx.lock_ok:
        raise LockLostError(ctx.job_id)
    return result


def _fake(
    built: mat.Built, material: mat.Material, concepts: Sequence[SessionConcept]
) -> SummaryWriteOutput:
    slides = [
        llm_fake.FakeSlide(
            index=i.slide.index,
            title=normalize_name(i.slide.title) if i.slide.title else None,
            spans=list(i.spans),
        )
        for i in built.items
        if i.slide is not None
    ]
    return llm_fake.summary_write(
        [llm_fake.FakeConcept(c.name, list(c.slides), list(c.spans)) for c in concepts],
        slides,
        [(s.start_ms, s.end_ms) for s in material.segments],
    )


# ---------- Handler ----------

UPSERT_SQL = """
INSERT INTO session_summary (id, user_id, session_id, lang, sentences, outline, provider, model,
  prompt_version, input_hash, job_id)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
ON CONFLICT (session_id) DO UPDATE SET
  lang = EXCLUDED.lang, sentences = EXCLUDED.sentences, outline = EXCLUDED.outline,
  provider = EXCLUDED.provider, model = EXCLUDED.model,
  prompt_version = EXCLUDED.prompt_version, input_hash = EXCLUDED.input_hash,
  job_id = EXCLUDED.job_id, deleted_at = NULL
"""


@handler(TASK, payload_type=SummaryWritePayload)
def summary_write(payload: SummaryWritePayload, ctx: JobContext) -> dict[str, Any]:
    sid = uuid.UUID(payload.session_id)
    conn = ctx.conn
    llm_mod.require_configured()
    row = mat.session_row(conn, sid)
    if row is None:
        raise NonRetryableError("Session unbekannt")
    if row[1] is not None:
        with conn.transaction():
            progress.lock_session(conn, sid)
            return _finish(ctx, _result(sid, session_deleted=True))
    material = mat.load(conn, sid, row)
    if not material.slides and not material.segments:
        with conn.transaction():
            if not progress.lock_session(conn, sid):
                return _finish(ctx, _result(sid, session_deleted=True))
            conn.execute("DELETE FROM session_summary WHERE session_id = %s", (sid,))
            return _finish(ctx, _result(sid, skipped=True))

    llm = llm_mod.get_llm()
    model = llm.model_for(TIER)
    concepts = load_concepts(conn, sid, material.deck_id)
    built, text = build_input(material, concepts)
    digest = input_hash(model, text)
    if not payload.force:
        stored = conn.execute(
            "SELECT input_hash, jsonb_array_length(sentences), jsonb_array_length(outline), "
            "model, prompt_version FROM session_summary WHERE session_id = %s "
            "AND deleted_at IS NULL",
            (sid,),
        ).fetchone()
        if stored is not None and stored[0] == digest:
            with conn.transaction():
                if not progress.lock_session(conn, sid):
                    return _finish(ctx, _result(sid, session_deleted=True))
                return _finish(
                    ctx,
                    _result(
                        sid,
                        unchanged=True,
                        input_hash=digest,
                        sentence_count=int(stored[1]),
                        outline_count=int(stored[2]),
                        model=stored[3],
                        prompt_version=stored[4],
                    ),
                )

    meter = CostMeter(
        conn, user_id=material.user_id, job_id=ctx.job_id, session_id=str(sid), task=TASK
    )

    def usable(out: SummaryWriteOutput) -> str | None:
        return None if check_output(out, material, str(sid)).sentences else NO_VALID

    request = StructuredRequest(
        task=TASK,
        tier=TIER,
        prompt_version=SUMMARY_WRITE_PROMPT,
        system=system_prompt(),
        material=text,
        output=SummaryWriteOutput,
        effort=EFFORT,
        max_tokens=MAX_TOKENS,
        stream=True,
        check=usable,
        fake=partial(_fake, built, material, concepts),
    )
    with llm_mod.job_errors(ctx):
        answer = llm.structured(request, meter)
    checked = check_output(answer.parsed, material, str(sid))
    cost = round(meter.total_eur, 6)
    ctx.logger.info(
        "Kurzfassung geschrieben",
        extra={"sentences": len(checked.sentences), "dropped": checked.dropped_sentences},
    )
    with conn.transaction():
        if not progress.lock_session(conn, sid):
            return _finish(ctx, _result(sid, session_deleted=True, cost_eur=cost))
        conn.execute(
            UPSERT_SQL,
            (
                uuid7(),
                material.user_id,
                sid,
                material.lang,
                Jsonb(checked.sentences),
                Jsonb(checked.outline),
                answer.provider,
                answer.model,
                SUMMARY_WRITE_PROMPT,
                digest,
                uuid.UUID(ctx.job_id),
            ),
        )
        return _finish(
            ctx,
            _result(
                sid,
                input_hash=digest,
                sentence_count=len(checked.sentences),
                outline_count=len(checked.outline),
                dropped_sentences=checked.dropped_sentences,
                prompt_version=SUMMARY_WRITE_PROMPT,
                model=answer.model,
                cost_eur=cost,
            ),
        )
