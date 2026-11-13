"""Material einer Vorlesung für die KI-Jobs: lesen, als Eingabe bauen, Belege prüfen.

Gemeinsame Teile von `concepts.extract`, `concepts.resolve` und `summary.write` (VERTRAEGE §20.3
„Gemeinsame Regeln“ und Schritte 1, 2 und 7, §20.4 Schritt 2):

- `session_row`, `load`: Session, Modul, Folien, `slide_segment` (Quelle `manuell` vor
  `ausrichtung` vor `log`, §18.4), Transkript-Abschnitte und Marker (mit Geräteversatz, §9.3)
  lesen.
- `build_input`: die deterministische Eingabe. Alles Material steht in Tags, spitze Klammern sind
  maskiert (`esc`).
- `overlaps`, `merge_ranges`: Zeit-Belege prüfen. `shorten`, `unit`: Texte und Konfidenzen
  begrenzen.
"""

from __future__ import annotations

import bisect
import math
import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any
from zoneinfo import ZoneInfo

import psycopg

from ..ai.budget import local_tz_name
from .names import normalize_name

MAX_SLIDE_TEXT = 1500
MAX_WORDS_PER_SLIDE = 600
BLOCK_MS = 5 * 60_000
MAX_RANGE_MS = 20 * 60_000
SOURCES = ("manuell", "ausrichtung", "log")
LANG_NAMES = {"de": "Deutsch", "en": "Englisch"}

Conn = psycopg.Connection[Any]


def _clean_text(text: str) -> str:
    # Spät importiert: `handlers/__init__` lädt `concepts_extract`, das dieses Modul braucht.
    from ..handlers.search_index import clean_text

    return clean_text(text)


def shorten(text: str | None, limit: int) -> str | None:
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


def session_row(conn: Conn, sid: uuid.UUID) -> tuple[Any, ...] | None:
    return conn.execute(
        "SELECT user_id, deleted_at, module_id, slide_deck_id, number, title, started_at, "
        "ended_at FROM session WHERE id = %s",
        (sid,),
    ).fetchone()


def load(conn: Conn, sid: uuid.UUID, row: tuple[Any, ...]) -> Material:
    # Spät importiert, Grund wie bei `_clean_text`
    from ..handlers.align_log import _timeline_end

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
    markers = load_markers(conn, sid)
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


def load_markers(conn: Conn, sid: uuid.UUID) -> list[tuple[str, int]]:
    """Marker `frage`/`klausur` mit Sitzungszeit nach Serveruhr (VERTRAEGE §9.3, #332).

    Hat ein Gerät die Session offline mit eigenem Start begonnen, gilt `t_ms + offset_ms`
    (nie unter 0). Das Gerät eines Markers ist das der ersten `marker.add` im Strom der Session,
    wie in `align.log` für Folienwechsel. Ohne Eintrag in `start_offsets` gilt `t_ms`.
    """
    # Spät importiert, Grund wie bei `_clean_text`
    from ..handlers.align_log import _offsets

    row = conn.execute("SELECT start_offsets FROM session WHERE id = %s", (sid,)).fetchone()
    offsets = _offsets(row[0] if row else None)
    if not offsets:
        return [
            (str(r[0]), int(r[1]))
            for r in conn.execute(
                "SELECT kind, t_ms FROM marker WHERE session_id = %s AND deleted_at IS NULL "
                "AND kind IN ('frage', 'klausur') ORDER BY t_ms, id",
                (sid,),
            ).fetchall()
        ]
    rows = conn.execute(
        """
        SELECT m.kind, m.t_ms, m.id, (
          SELECT o.device_id FROM sync_op o
           WHERE o.stream = %(stream)s AND o.kind = 'marker.add'
             AND o.data->>'marker_id' = m.id::text
           ORDER BY o.seq LIMIT 1)
        FROM marker m
        WHERE m.session_id = %(sid)s AND m.deleted_at IS NULL AND m.kind IN ('frage', 'klausur')
        """,
        {"sid": sid, "stream": f"session:{sid}"},
    ).fetchall()
    timed = []
    for kind, t_ms, mid, device_id in rows:
        offset = offsets.get(str(device_id).lower(), 0) if device_id is not None else 0
        timed.append((max(int(t_ms) + offset, 0), str(mid), str(kind)))
    timed.sort()
    return [(kind, t) for t, _mid, kind in timed]


# ---------- Eingabe ----------


def hms(ms: int) -> str:
    """Sitzungszeit als `[h:mm:ss]`."""
    total = max(0, ms) // 1000
    return f"[{total // 3600}:{total // 60 % 60:02d}:{total % 60:02d}]"


def esc(text: str) -> str:
    """Material maskieren: `&`, `<`, `>` (§20.3)."""
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _words(texts: Sequence[str], limit: int) -> str:
    words = " ".join(t for t in (_clean_text(x) for x in texts) if t).split(" ")
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
        said = esc(" ".join(t for t in (_clean_text(s.text) for s in segs) if t))
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


# ---------- Belege und Werte ----------


def overlaps(segments: Sequence[Seg], start: int, end: int) -> bool:
    for seg in segments:
        if seg.start_ms == seg.end_ms:
            if start <= seg.start_ms < end:
                return True
        elif seg.start_ms < end and start < seg.end_ms:
            return True
    return False


def merge_ranges(ranges: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """Überlappende Zeiträume zusammenfassen, danach jeden auf höchstens 20 min kappen."""
    merged: list[tuple[int, int]] = []
    for start, end in sorted(ranges):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return [(start, min(end, start + MAX_RANGE_MS)) for start, end in merged]


def unit(value: float) -> float:
    """Konfidenz auf 0..1 klemmen. Nicht endliche Werte (NaN, ±inf) gelten als 0."""
    number = float(value)
    if not math.isfinite(number):
        return 0.0
    return min(max(number, 0.0), 1.0)
