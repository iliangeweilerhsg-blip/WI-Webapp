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
liegen in `concepts/names.py`.
"""

from __future__ import annotations

import bisect
import hashlib
import math
import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field
from functools import cache, partial
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import psycopg
from pydantic import ValidationError
from sg_schemas.models import ConceptsExtractPayload, ConceptsExtractResult

from .. import progress
from ..ai import llm as llm_mod
from ..ai import llm_fake
from ..ai.budget import CostMeter, local_tz_name
from ..ai.interfaces import Effort, StructuredRequest, Tier
from ..ai.outputs import (
    CONCEPTS_EXTRACT_PROMPT,
    ConceptsExtractOutput,
    ExtractConceptOut,
)
from ..concepts.names import name_key, normalize_name
from ..registry import JobContext, LockLostError, NonRetryableError, handler
from .align_log import _timeline_end
from .search_index import clean_text

TASK = "concepts.extract"
TIER: Tier = "standard"
#: Steigt mit Änderungen an Eingabe oder Prüfung (§20.3 Schritt 4)
EXTRACT_VERSION = 1
PROMPT_FILE = Path(__file__).resolve().parents[3] / "prompts" / "concepts.extract" / "v1.md"
EFFORT: Effort = "medium"
MAX_TOKENS = 64_000

MAX_SLIDE_TEXT = 1500
MAX_WORDS_PER_SLIDE = 600
BLOCK_MS = 5 * 60_000
CHAPTER_THRESHOLD = 150_000
CHAPTER_MAX = 100_000
MAX_RANGE_MS = 20 * 60_000
MAX_EVIDENCE = 12
MAX_CONCEPTS = 30
MAX_RELATIONS = 60
MAX_NAME = 200
MAX_ALIASES = 20
MAX_ONE_LINER = 500
MAX_PROF = 600
MAX_WHY = 500
SYMMETRIC = {"gegensatz", "verwandt"}
SOURCES = ("manuell", "ausrichtung", "log")
LANG_NAMES = {"de": "Deutsch", "en": "Englisch"}

Conn = psycopg.Connection[Any]


def _shorten(text: str | None, limit: int) -> str | None:
    if text is None:
        return None
    value = normalize_name(text)
    if not value:
        return None
    return value if len(value) <= limit else value[: limit - 1].rstrip() + "…"


# ---------- Material ----------


@dataclass(frozen=True)
class Slide:
    id: uuid.UUID
    index: int
    title: str | None
    text: str
    vision_summary: str | None


@dataclass(frozen=True)
class Seg:
    start_ms: int
    end_ms: int
    text: str


@dataclass
class Material:
    user_id: uuid.UUID
    deck_id: uuid.UUID | None
    module_name: str | None
    module_short: str | None
    lang: str | None
    number: int | None
    title: str | None
    date: str | None
    timeline_end_ms: int
    slides: list[Slide] = field(default_factory=list)
    segments: list[Seg] = field(default_factory=list)
    spans: list[tuple[int, int, uuid.UUID]] = field(default_factory=list)  # slide_segment
    markers: list[tuple[str, int]] = field(default_factory=list)


def _session_row(conn: Conn, sid: uuid.UUID) -> tuple[Any, ...] | None:
    return conn.execute(
        "SELECT user_id, deleted_at, module_id, slide_deck_id, number, title, started_at, "
        "ended_at FROM session WHERE id = %s",
        (sid,),
    ).fetchone()


def _load(conn: Conn, sid: uuid.UUID, row: tuple[Any, ...]) -> Material:
    user_id, _deleted, module_id, deck_id, number, title, started_at, ended_at = row
    mod = conn.execute(
        "SELECT name, short_name, lang FROM module WHERE id = %s", (module_id,)
    ).fetchone()
    slides = [
        Slide(r[0], int(r[1]), r[2], r[3] or "", r[4])
        for r in conn.execute(
            "SELECT s.id, s.index, s.title, s.text, s.vision_summary FROM slide s "
            "JOIN slide_deck d ON d.id = s.deck_id "
            "WHERE d.id = %s AND d.deleted_at IS NULL AND s.deleted_at IS NULL ORDER BY s.index",
            (deck_id,),
        ).fetchall()
    ]
    segments = [
        Seg(int(r[0]), int(r[1]), r[2] or "")
        for r in conn.execute(
            "SELECT start_ms, end_ms, text FROM transcript_segment "
            "WHERE session_id = %s AND deleted_at IS NULL ORDER BY start_ms, recording_id, seq",
            (sid,),
        ).fetchall()
    ]
    # §18.4: gelöschte Segmente und Segmente gelöschter Folien entfallen, dann die erste Quelle
    by_source: dict[str, list[tuple[int, int, uuid.UUID]]] = {}
    for source, slide_id, start, end in conn.execute(
        "SELECT g.source, g.slide_id, g.start_ms, g.end_ms FROM slide_segment g "
        "JOIN slide s ON s.id = g.slide_id AND s.deleted_at IS NULL "
        "WHERE g.session_id = %s AND g.deleted_at IS NULL ORDER BY g.start_ms, g.id",
        (sid,),
    ).fetchall():
        by_source.setdefault(source, []).append((int(start), int(end), slide_id))
    spans = next((by_source[s] for s in SOURCES if by_source.get(s)), [])
    markers = [
        (str(r[0]), int(r[1]))
        for r in conn.execute(
            "SELECT kind, t_ms FROM marker WHERE session_id = %s AND deleted_at IS NULL "
            "AND kind IN ('frage', 'klausur') ORDER BY t_ms, id",
            (sid,),
        ).fetchall()
    ]
    date = None
    if started_at is not None:
        date = started_at.astimezone(ZoneInfo(local_tz_name())).date().isoformat()
    return Material(
        user_id=user_id,
        deck_id=deck_id if slides else None,
        module_name=None if mod is None else mod[0],
        module_short=None if mod is None else mod[1],
        lang=None if mod is None else mod[2],
        number=number,
        title=title,
        date=date,
        timeline_end_ms=_timeline_end(conn, sid, started_at, ended_at),
        slides=slides,
        segments=segments,
        spans=spans,
        markers=markers,
    )


# ---------- Eingabe ----------


def hms(ms: int) -> str:
    """Sitzungszeit als `[h:mm:ss]`."""
    total = max(0, ms) // 1000
    return f"[{total // 3600}:{total // 60 % 60:02d}:{total % 60:02d}]"


def esc(text: str) -> str:
    """Material maskieren: `&`, `<`, `>` (§20.3)."""
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _words(texts: Sequence[str], limit: int) -> str:
    words = " ".join(t for t in (clean_text(x) for x in texts) if t).split(" ")
    words = [w for w in words if w]
    if len(words) <= limit:
        return " ".join(words)
    return " ".join(words[:limit]) + " …"


@dataclass(frozen=True)
class Item:
    """Ein Stück der Eingabe (eine Folie oder ein Block ohne Folie). Kapitel enden an Items."""

    text: str
    slide: Slide | None = None
    spans: tuple[tuple[int, int], ...] = ()  # Zeiten der Abschnitte darin (ms)


@dataclass(frozen=True)
class Built:
    head: str
    items: list[Item]
    footer: str

    @property
    def full(self) -> str:
        return compose(self.head, self.items, self.footer)


def compose(head: str, items: Sequence[Item], footer: str) -> str:
    return "\n\n".join([head, *(i.text for i in items), footer])


def assign(material: Material) -> tuple[dict[uuid.UUID, list[Seg]], list[Seg]]:
    """Abschnitte auf Folien verteilen: die Folie, in deren Segment die Mitte liegt."""
    spans = sorted(material.spans)
    starts = [s[0] for s in spans]
    known = {s.id for s in material.slides}
    per_slide: dict[uuid.UUID, list[Seg]] = {}
    loose: list[Seg] = []
    for seg in material.segments:
        mid = (seg.start_ms + seg.end_ms) // 2
        i = bisect.bisect_right(starts, mid) - 1
        if i >= 0 and mid < spans[i][1] and spans[i][2] in known:
            per_slide.setdefault(spans[i][2], []).append(seg)
        else:
            loose.append(seg)
    return per_slide, loose


def build_input(material: Material) -> Built:
    lines = ["<kopf>"]
    module = esc(normalize_name(material.module_name or "")) or "unbekannt"
    if material.module_short:
        module += f" ({esc(normalize_name(material.module_short))})"
    lines.append(f"Modul: {module}")
    lines.append(f"Sprache: {material.lang or 'unbekannt'}")
    if material.number is not None:
        lines.append(f"Vorlesung Nr.: {material.number}")
    if material.title:
        lines.append(f"Titel: {esc(normalize_name(material.title))}")
    if material.date:
        lines.append(f"Datum: {material.date}")
    lines.append("</kopf>")
    if material.markers:
        lines.append("Marker:")
        lines += [f'<marker art="{kind}" zeit="{hms(t)}"/>' for kind, t in material.markers]
    head = "\n".join(lines)

    per_slide, loose = assign(material)
    items: list[Item] = []
    for slide in material.slides:
        parts = [f'<folie i="{slide.index}">']
        if slide.title and normalize_name(slide.title):
            parts.append(f"Titel: {esc(normalize_name(slide.title))}")
        text = normalize_name(slide.text)
        if text:
            if len(text) > MAX_SLIDE_TEXT:
                text = text[:MAX_SLIDE_TEXT] + "…"
            parts.append(f"Text: {esc(text)}")
        if slide.vision_summary and normalize_name(slide.vision_summary):
            parts.append(f"Bildbeschreibung: {esc(normalize_name(slide.vision_summary))}")
        segs = per_slide.get(slide.id, [])
        if segs:
            said = _words([s.text for s in segs], MAX_WORDS_PER_SLIDE)
            von = hms(min(s.start_ms for s in segs))
            bis = hms(max(s.end_ms for s in segs))
            parts.append(f'<transkript von="{von}" bis="{bis}">{esc(said)}</transkript>')
        parts.append("</folie>")
        items.append(Item("\n".join(parts), slide, tuple((s.start_ms, s.end_ms) for s in segs)))
    blocks: dict[int, list[Seg]] = {}
    for seg in loose:
        blocks.setdefault(seg.start_ms // BLOCK_MS, []).append(seg)
    for k in sorted(blocks):
        segs = blocks[k]
        said = esc(" ".join(t for t in (clean_text(s.text) for s in segs) if t))
        von = hms(min(s.start_ms for s in segs))
        bis = hms(max(s.end_ms for s in segs))
        items.append(
            Item(
                f'<transkript von="{von}" bis="{bis}">{said}</transkript>',
                None,
                tuple((s.start_ms, s.end_ms) for s in segs),
            )
        )
    lang = LANG_NAMES.get(material.lang or "", "die Sprache der Vorlesung")
    footer = f"Ausgabesprache: {lang}"
    return Built(head, items, footer)


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


def _overlaps(segments: Sequence[Seg], start: int, end: int) -> bool:
    for seg in segments:
        if seg.start_ms == seg.end_ms:
            if start <= seg.start_ms < end:
                return True
        elif seg.start_ms < end and start < seg.end_ms:
            return True
    return False


def _merge_ranges(ranges: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """Überlappende Zeiträume zusammenfassen, danach jeden auf höchstens 20 min kappen."""
    merged: list[tuple[int, int]] = []
    for start, end in sorted(ranges):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return [(start, min(end, start + MAX_RANGE_MS)) for start, end in merged]


def _unit(value: float) -> float:
    """Konfidenz auf 0..1 klemmen. Nicht endliche Werte (NaN, ±inf) gelten als 0."""
    number = float(value)
    if not math.isfinite(number):
        return 0.0
    return min(max(number, 0.0), 1.0)


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
                    or not _overlaps(material.segments, start, end)
                ):
                    checked.dropped_evidence += 1
                else:
                    ranges.append((start, end))
        slide_refs.sort(key=lambda e: int(e["slide_index"]))
        time_refs = [
            {"kind": "transcript", "session_id": session_id, "t_start_ms": s, "t_end_ms": e}
            for s, e in _merge_ranges(ranges)
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
        why = _shorten(rel.why, MAX_WHY)
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
                "confidence": _unit(rel.confidence),
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
    one_liner = next((v for m in members if (v := _shorten(m.one_liner, MAX_ONE_LINER))), None)
    prof = next((v for m in members if (v := _shorten(m.prof_explanation, MAX_PROF))), None)
    return {
        "proposal": {
            "name": group.name,
            "aliases": aliases[:MAX_ALIASES],
            "one_liner": one_liner,
            "kind": next((m.kind for m in members if m.kind is not None), None),
            "importance": max(int(m.importance) for m in members),
            "exam_hint": any(m.exam_hint for m in members),
            "prof_explanation": prof,
            "confidence": max(_unit(m.confidence) for m in members),
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
    row = _session_row(ctx.conn, sid)
    if row is None:
        raise NonRetryableError("Session unbekannt")
    if row[1] is not None:
        return _finish(ctx, sid, _result(sid, session_deleted=True), 0.0)
    material = _load(ctx.conn, sid, row)
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
