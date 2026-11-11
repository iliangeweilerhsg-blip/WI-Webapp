"""`concepts.extract`: Konzepte einer Vorlesung finden (VERTRAEGE §20.3, 05 §P7a, Stufe `standard`).

Ablauf:

1. Payload prüfen, KI eingerichtet? (sonst `fehler` sofort). Session lesen: fehlt → `fehler`, weich
   gelöscht → `fertig` mit `session_deleted`. Modul, Foliensatz, Folien, `slide_segment` (Quelle
   `manuell` vor `ausrichtung` vor `log`, §18.4), Transkript-Abschnitte und Marker lesen.
2. Eingabe bauen (deterministisch): Kopf, je Folie Titel, Text (≤ 1 500 Zeichen),
   Bildbeschreibung und das Gesagte in ihrer Zeit (Mitte des Abschnitts, ≤ 600 Wörter), Abschnitte
   ohne Folie in Blöcken zu 5 min. Alles Material in Tags, spitze Klammern maskiert.
3. Weder Folien noch Transkript: `fertig` mit `empty`, kein Aufruf.
4. `input_hash`; gleich wie beim neuesten fertigen Lauf und kein `force`: Ergebnis übernehmen.
5. Über 150 000 geschätzten Tokens: Kapitel an Foliengrenzen (≤ 100 000), gemeinsamer Kopf mit
   Prompt-Caching. Zusammenführen ohne weiteren KI-Aufruf.
6. KI-Aufruf(e) außerhalb einer Transaktion (`ai/llm.py`: Budget, Kosten, `stop_reason`,
   Nachfordern), der Heartbeat läuft weiter.
7. Belege gegen die Datenbank prüfen, ungültige verwerfen (LP8), normieren, zusammenführen,
   begrenzen. Liefert die KI Konzepte und ist keins gültig, wird einmal nachgefordert.
8. Eine Transaktion: Session sperren (gelöscht → `session_deleted`), `fertig` mit
   `ConceptsExtractResult`. Der Job schreibt keine Tabellen außer `cost_entry`.

Normieren und Vergleichsform (`normalize_name`, `name_key`) folgen §20.3 „Gemeinsame Regeln“ und
liegen in `concepts/names.py`. Material lesen, Eingabe bauen und die Hilfen für Belege teilt sich
der Job mit `concepts.resolve` und `summary.write`: `concepts/material.py`.
"""

from __future__ import annotations

import hashlib
import math
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from functools import cache, partial
from pathlib import Path
from typing import Any

import psycopg
from pydantic import ValidationError
from sg_schemas.models import ConceptsExtractPayload, ConceptsExtractResult

from .. import progress
from ..ai import llm as llm_mod
from ..ai import llm_fake
from ..ai.budget import CostMeter
from ..ai.interfaces import Effort, StructuredRequest, Tier
from ..ai.outputs import (
    CONCEPTS_EXTRACT_PROMPT,
    ConceptsExtractOutput,
    ExtractConceptOut,
)
from ..concepts.material import (
    MAX_RANGE_MS,
    Built,
    Item,
    Material,
    build_input,
    compose,
    load,
    merge_ranges,
    overlaps,
    session_row,
    shorten,
    unit,
)
from ..concepts.names import name_key, normalize_name
from ..registry import JobContext, LockLostError, NonRetryableError, handler

TASK = "concepts.extract"
TIER: Tier = "standard"
#: Steigt mit Änderungen an Eingabe oder Prüfung (§20.3 Schritt 4)
EXTRACT_VERSION = 1
PROMPT_FILE = Path(__file__).resolve().parents[3] / "prompts" / "concepts.extract" / "v1.md"
EFFORT: Effort = "medium"
MAX_TOKENS = 64_000

CHAPTER_THRESHOLD = 150_000
CHAPTER_MAX = 100_000
MAX_EVIDENCE = 12
MAX_CONCEPTS = 30
MAX_RELATIONS = 60
MAX_NAME = 200
MAX_ALIASES = 20
MAX_ONE_LINER = 500
MAX_PROF = 600
MAX_WHY = 500
SYMMETRIC = {"gegensatz", "verwandt"}

Conn = psycopg.Connection[Any]


def estimate_tokens(text: str) -> int:
    return math.ceil(len(text.encode("utf-8")) / 3)


def chapters(built: Built) -> list[list[Item]]:
    """Eine Eingabe bis 150 000 geschätzten Tokens bleibt ganz. Darüber Kapitel an Foliengrenzen
    mit höchstens 100 000 geschätzten Tokens (Kopf und Schluss eingerechnet)."""
    if estimate_tokens(built.full) <= CHAPTER_THRESHOLD:
        return [built.items]
    result: list[list[Item]] = []
    current: list[Item] = []
    for item in built.items:
        if current and estimate_tokens(compose(built.head, [*current, item], built.footer)) > (
            CHAPTER_MAX
        ):
            result.append(current)
            current = []
        current.append(item)
    if current:
        result.append(current)
    return result


def input_hash(model: str, text: str, prompt_version: str = CONCEPTS_EXTRACT_PROMPT) -> str:
    """SHA-256 über `prompt_version \\n Modell \\n EXTRACT_VERSION \\n Eingabe` (§20.3)."""
    data = "\n".join([prompt_version, model, str(EXTRACT_VERSION), text])
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


@cache
def system_prompt() -> str:
    return PROMPT_FILE.read_text(encoding="utf-8")


# ---------- Prüfen (§20.3 Schritt 7) ----------


@dataclass
class Checked:
    concepts: list[dict[str, Any]]
    relations: list[dict[str, Any]]
    dropped_concepts: int = 0
    dropped_evidence: int = 0
    dropped_relations: int = 0


@dataclass
class _Group:
    pos: int
    name: str
    first: ExtractConceptOut
    members: list[ExtractConceptOut]


def check_outputs(
    outputs: Sequence[ConceptsExtractOutput], material: Material, session_id: str
) -> Checked:
    """Prüft und vereinigt die Ausgaben (aller Kapitel) gegen das Material."""
    slides = {s.index: s for s in material.slides}
    end_ms = material.timeline_end_ms
    groups: dict[str, _Group] = {}
    order: list[str] = []
    dropped_names = 0
    for concept in (c for out in outputs for c in out.concepts):
        name = normalize_name(concept.name)
        if not name or len(name) > MAX_NAME:
            dropped_names += 1
            continue
        key = name.lower()
        if key in groups:
            groups[key].members.append(concept)
        else:
            groups[key] = _Group(len(order), name, concept, [concept])
            order.append(key)

    checked = Checked(concepts=[], relations=[], dropped_concepts=dropped_names)
    kept: list[tuple[_Group, dict[str, Any]]] = []
    for key in order:
        group = groups[key]
        slide_refs: list[dict[str, Any]] = []
        ranges: list[tuple[int, int]] = []
        seen_slides: set[int] = set()
        for member in group.members:
            for index in member.slides:
                if index in seen_slides:
                    continue
                seen_slides.add(index)
                slide = slides.get(index)
                if slide is None or material.deck_id is None:
                    checked.dropped_evidence += 1
                    continue
                slide_refs.append(
                    {
                        "kind": "slide",
                        "slide_id": str(slide.id),
                        "deck_id": str(material.deck_id),
                        "slide_index": slide.index,
                    }
                )
            for r in member.times:
                start = min(max(r.start_s * 1000, 0), end_ms)
                end = min(max(r.end_s * 1000, 0), end_ms)
                if (
                    not start < end
                    or end - start > MAX_RANGE_MS
                    or not overlaps(material.segments, start, end)
                ):
                    checked.dropped_evidence += 1
                else:
                    ranges.append((start, end))
        slide_refs.sort(key=lambda e: int(e["slide_index"]))
        time_refs = [
            {"kind": "transcript", "session_id": session_id, "t_start_ms": s, "t_end_ms": e}
            for s, e in merge_ranges(ranges)
        ]
        evidence = [*slide_refs, *time_refs]
        if len(evidence) > MAX_EVIDENCE:
            checked.dropped_evidence += len(evidence) - MAX_EVIDENCE
            evidence = evidence[:MAX_EVIDENCE]
        if not evidence:
            checked.dropped_concepts += 1
            continue
        kept.append((group, _proposal(group, evidence)))

    # Höchstens 30: nach importance, dann Reihenfolge der Ausgabe; danach wieder in Ausgabefolge
    chosen = sorted(kept, key=lambda gp: (-gp[1]["proposal"]["importance"], gp[0].pos))
    chosen = sorted(chosen[:MAX_CONCEPTS], key=lambda gp: gp[0].pos)
    keys: dict[str, str] = {}
    for n, (group, entry) in enumerate(chosen, start=1):
        entry["key"] = f"c{n}"
        checked.concepts.append(entry)
        for label in [group.name, *entry["proposal"]["aliases"]]:
            keys.setdefault(name_key(label), entry["key"])

    seen: set[tuple[str, str, str]] = set()
    for rel in (r for out in outputs for r in out.relations):
        a = keys.get(name_key(rel.from_concept))
        b = keys.get(name_key(rel.to_concept))
        why = shorten(rel.why, MAX_WHY)
        if a is None or b is None or a == b or why is None:
            checked.dropped_relations += 1
            continue
        ident = (min(a, b), max(a, b), rel.kind) if rel.kind in SYMMETRIC else (a, b, rel.kind)
        if ident in seen or len(checked.relations) >= MAX_RELATIONS:
            checked.dropped_relations += 1
            continue
        seen.add(ident)
        checked.relations.append(
            {
                "from": a,
                "to": b,
                "kind": rel.kind,
                "why": why,
                "confidence": unit(rel.confidence),
            }
        )
    return checked


def _proposal(group: _Group, evidence: list[dict[str, Any]]) -> dict[str, Any]:
    members = group.members
    name_k = group.name.lower()
    aliases: list[str] = []
    alias_keys = {name_k}
    for alias in (a for m in members for a in m.aliases):
        value = normalize_name(alias)
        if not value or len(value) > MAX_NAME or value.lower() in alias_keys:
            continue
        alias_keys.add(value.lower())
        aliases.append(value)
    one_liner = next((v for m in members if (v := shorten(m.one_liner, MAX_ONE_LINER))), None)
    prof = next((v for m in members if (v := shorten(m.prof_explanation, MAX_PROF))), None)
    return {
        "proposal": {
            "name": group.name,
            "aliases": aliases[:MAX_ALIASES],
            "one_liner": one_liner,
            "kind": next((m.kind for m in members if m.kind is not None), None),
            "importance": max(int(m.importance) for m in members),
            "exam_hint": any(m.exam_hint for m in members),
            "prof_explanation": prof,
            "confidence": max(unit(m.confidence) for m in members),
        },
        "evidence": evidence,
    }


NO_VALID = (
    "Kein Konzept hatte einen gültigen Beleg. Folien-Indizes müssen aus <folie i=…> stammen, "
    "Zeiträume in Sekunden Sitzungszeit innerhalb eines <transkript>-Abschnitts liegen und "
    "höchstens 20 Minuten lang sein."
)


# ---------- Ergebnis ----------


def _result(sid: uuid.UUID, **values: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "session_id": str(sid),
        "session_deleted": False,
        "empty": False,
        "unchanged": False,
        "input_hash": None,
        "prompt_version": None,
        "model": None,
        "chapters": 0,
        "concepts": [],
        "relations": [],
        "dropped_concepts": 0,
        "dropped_evidence": 0,
        "dropped_relations": 0,
        "cost_eur": 0.0,
    }
    base.update(values)
    return ConceptsExtractResult.model_validate(base).model_dump(mode="json", by_alias=True)


def _finish(ctx: JobContext, sid: uuid.UUID, result: dict[str, Any], cost: float) -> dict[str, Any]:
    """Session sperren (gelöscht → `session_deleted`), `fertig` schreiben."""
    with ctx.conn.transaction():
        if not progress.lock_session(ctx.conn, sid):
            result = _result(sid, session_deleted=True, cost_eur=round(cost, 6))
        ctx.finish(result)
        if not ctx.lock_ok:
            raise LockLostError(ctx.job_id)
    return result


def _previous(conn: Conn, sid: uuid.UUID, job_id: str) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT result FROM job WHERE type = %s AND session_id = %s AND state = 'fertig' "
        "AND deleted_at IS NULL AND id <> %s ORDER BY created_at DESC, id DESC LIMIT 1",
        (TASK, sid, uuid.UUID(job_id)),
    ).fetchone()
    return row[0] if row and isinstance(row[0], dict) else None


def _fake(items: Sequence[Item]) -> ConceptsExtractOutput:
    slides = [
        llm_fake.FakeSlide(
            index=i.slide.index,
            title=normalize_name(i.slide.title) if i.slide.title else None,
            spans=list(i.spans),
        )
        for i in items
        if i.slide is not None
    ]
    segments = [span for i in items if i.slide is None for span in i.spans]
    return llm_fake.concepts_extract(slides, segments)


# ---------- Handler ----------


@handler(TASK, payload_type=ConceptsExtractPayload)
def concepts_extract(payload: ConceptsExtractPayload, ctx: JobContext) -> dict[str, Any]:
    sid = uuid.UUID(payload.session_id)
    llm_mod.require_configured()
    row = session_row(ctx.conn, sid)
    if row is None:
        raise NonRetryableError("Session unbekannt")
    if row[1] is not None:
        return _finish(ctx, sid, _result(sid, session_deleted=True), 0.0)
    material = load(ctx.conn, sid, row)
    if not material.slides and not material.segments:
        return _finish(ctx, sid, _result(sid, empty=True), 0.0)

    llm = llm_mod.get_llm()
    model = llm.model_for(TIER)
    built = build_input(material)
    digest = input_hash(model, built.full)
    if not payload.force:
        previous = _previous(ctx.conn, sid, ctx.job_id)
        if previous is not None and previous.get("input_hash") == digest:
            reused = {k: v for k, v in previous.items() if k in ConceptsExtractResult.model_fields}
            reused.update(unchanged=True, chapters=0, cost_eur=0.0, session_deleted=False)
            return _finish(ctx, sid, _result(sid, **reused), 0.0)

    parts = chapters(built)
    meter = CostMeter(
        ctx.conn, user_id=material.user_id, job_id=ctx.job_id, session_id=str(sid), task=TASK
    )
    outputs: list[ConceptsExtractOutput] = []
    used_model = model

    def usable(out: ConceptsExtractOutput) -> str | None:
        if out.concepts and not check_outputs([out], material, str(sid)).concepts:
            return NO_VALID
        return None

    with llm_mod.job_errors(ctx):
        for items in parts:
            several = len(parts) > 1
            request = StructuredRequest(
                task=TASK,
                tier=TIER,
                prompt_version=CONCEPTS_EXTRACT_PROMPT,
                system=system_prompt(),
                material=compose(built.head, items, built.footer)
                if not several
                else "\n\n".join([*(i.text for i in items), built.footer]),
                shared_head=built.head if several else None,
                output=ConceptsExtractOutput,
                effort=EFFORT,
                max_tokens=MAX_TOKENS,
                stream=True,
                check=usable,
                fake=partial(_fake, items),
            )
            answer = llm.structured(request, meter)
            outputs.append(answer.parsed)
            used_model = answer.model
    checked = check_outputs(outputs, material, str(sid))
    ctx.logger.info(
        "Konzepte gefunden",
        extra={
            "concepts": len(checked.concepts),
            "chapters": len(parts),
            "dropped_concepts": checked.dropped_concepts,
        },
    )
    try:
        result = _result(
            sid,
            input_hash=digest,
            prompt_version=CONCEPTS_EXTRACT_PROMPT,
            model=used_model,
            chapters=len(parts),
            concepts=checked.concepts,
            relations=checked.relations,
            dropped_concepts=checked.dropped_concepts,
            dropped_evidence=checked.dropped_evidence,
            dropped_relations=checked.dropped_relations,
            cost_eur=round(meter.total_eur, 6),
        )
    except ValidationError:
        # Nie den Pydantic-Text (mit Eingabewerten) in job.error, kein Retry (Kosten)
        ctx.logger.error("Geprüftes Ergebnis verletzt ConceptsExtractResult")
        raise NonRetryableError(llm_mod.INVALID_OUTPUT) from None
    return _finish(ctx, sid, result, meter.total_eur)
