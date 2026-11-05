"""`align.log`: Folien-Zeitleiste aus dem Folienwechsel-Log (VERTRAEGE §18.3, 05 §P5a).

Der ganze Job läuft in **einer** Transaktion, die Session zuerst gesperrt (keine KI, schnell).
Die Logik der Zeitleiste ist rein (`build_timeline`) und ohne DB testbar.
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import psycopg
from sg_schemas.models import AlignLogPayload

from ..registry import JobContext, LockLostError, NonRetryableError, handler
from ..uuid7 import uuid7

#: Ein Wechsel, dessen Standzeit darunter liegt, ist ein Durchgang und fällt weg
MIN_DWELL_MS = 1_500

Conn = psycopg.Connection[Any]


@dataclass(frozen=True)
class Change:
    """Ein Folienwechsel in Sitzungszeit nach Serveruhr (`t_ms + offset_ms`, geklemmt)."""

    t: int
    created_at: datetime
    id: uuid.UUID
    slide_index: int


@dataclass(frozen=True)
class Seg:
    slide_id: uuid.UUID
    slide_index: int
    start_ms: int
    end_ms: int


@dataclass(frozen=True)
class Timeline:
    segments: list[Seg]
    real_changes: int  # verbleibende echte Wechsel (ohne den gedachten Start)
    skipped: int
    unresolved: int


def build_timeline(
    changes: Sequence[Change], slides: Mapping[int, uuid.UUID], timeline_end_ms: int
) -> Timeline:
    """Schritte 5 bis 8 aus §18.3. `changes` ist nach `(t, created_at, id)` sortiert und geklemmt,
    `slides` bildet `slide_index` auf die Folie des Foliensatzes ab. Die erste stabile Folie
    beginnt bei 0. Fällt alles als Durchgang weg, gilt der letzte Eintrag ab 0."""
    resolved = [c for c in changes if c.slide_index in slides]
    unresolved = len(changes) - len(resolved)
    # (Folie, Zeit, echt?): gedachter Wechsel auf Folie 1 bei t = 0 vorn, wenn es sie gibt
    entries: list[tuple[int, int, bool]] = [(c.slide_index, c.t, True) for c in resolved]
    if 1 in slides:
        entries.insert(0, (1, 0, False))
    kept: list[tuple[int, int, bool]] = []
    skipped = 0
    for i, entry in enumerate(entries):  # Standzeiten einmal aus der Liste von Schritt 5
        until = entries[i + 1][1] if i + 1 < len(entries) else timeline_end_ms
        if until - entry[1] < MIN_DWELL_MS:
            skipped += entry[2]
        else:
            kept.append(entry)
    if not kept and entries and timeline_end_ms > 0:
        # Alles Durchgänge: Der letzte Eintrag gilt für die ganze Zeitleiste
        last = entries[-1]
        skipped -= last[2]
        kept.append(last)
    if kept:
        # Lead-Entscheidung (Review #148): Die Zeit vom Aufnahmestart bis zur ersten stabilen
        # Folie gehört zu dieser Folie
        kept[0] = (kept[0][0], 0, kept[0][2])
    segments: list[Seg] = []
    for i, (index, t, _real) in enumerate(kept):
        end = kept[i + 1][1] if i + 1 < len(kept) else timeline_end_ms
        if end <= t:
            continue
        if segments and segments[-1].slide_index == index and segments[-1].end_ms == t:
            prev = segments[-1]
            segments[-1] = Seg(prev.slide_id, index, prev.start_ms, end)
        else:
            segments.append(Seg(slides[index], index, t, end))
    real = sum(1 for e in kept if e[2])
    return Timeline(segments, real, skipped, unresolved)


def _ms_between(a: datetime | None, b: datetime | None) -> int | None:
    if a is None or b is None:
        return None
    return round((b - a).total_seconds() * 1000)


def _timeline_end(conn: Conn, sid: uuid.UUID, started: Any, ended: Any) -> int:
    row = conn.execute(
        "SELECT max(started_ms + coalesce(duration_ms, completed_duration_ms, 0)) "
        "FROM recording WHERE session_id = %s AND deleted_at IS NULL",
        (sid,),
    ).fetchone()
    candidates = [v for v in (_ms_between(started, ended), row and row[0]) if v is not None]
    return max(0, *(int(v) for v in candidates))


def _offsets(raw: Any) -> dict[str, int]:
    """`session.start_offsets` → Gerät → Versatz. Pro Gerät gilt der erste Eintrag."""
    out: dict[str, int] = {}
    for entry in raw if isinstance(raw, list) else []:
        if not isinstance(entry, dict):
            continue
        dev, off = entry.get("device_id"), entry.get("offset_ms")
        if isinstance(dev, str) and isinstance(off, int) and not isinstance(off, bool):
            out.setdefault(dev.lower(), off)
    return out


def _load_changes(
    conn: Conn, sid: uuid.UUID, offsets: Mapping[str, int], timeline_end: int
) -> list[Change]:
    rows = conn.execute(
        """
        SELECT e.id, e.slide_index, e.t_ms, e.device, e.created_at,
               CASE WHEN e.device = 'ipad' THEN (
                 SELECT o.device_id FROM sync_op o
                  WHERE o.stream = %(stream)s AND o.kind = 'slide.change'
                    AND o.data->>'event_id' = e.id::text
                  ORDER BY o.seq LIMIT 1) END
        FROM slide_event e
        WHERE e.session_id = %(sid)s AND e.deleted_at IS NULL
        """,
        {"sid": sid, "stream": f"session:{sid}"},
    ).fetchall()
    changes = []
    for eid, index, t_ms, _device, created_at, device_id in rows:
        offset = offsets.get(str(device_id), 0) if device_id is not None else 0
        t = min(max(int(t_ms) + offset, 0), timeline_end)
        changes.append(Change(t, created_at, eid, int(index)))
    changes.sort(key=lambda c: (c.t, c.created_at, str(c.id)))
    return changes


@handler("align.log", payload_type=AlignLogPayload)
def align_log(payload: AlignLogPayload, ctx: JobContext) -> dict[str, Any]:
    started = time.monotonic()
    sid = uuid.UUID(payload.session_id)
    conn = ctx.conn
    with conn.transaction():
        row = conn.execute(
            "SELECT deleted_at, slide_deck_id, started_at, ended_at, start_offsets, user_id "
            "FROM session WHERE id = %s FOR NO KEY UPDATE",
            (sid,),
        ).fetchone()
        if row is None:
            raise NonRetryableError("Session unbekannt")
        deleted_at, deck_id, started_at, ended_at, start_offsets, user_id = row
        result: dict[str, Any] = {
            "session_id": str(sid),
            "slide_deck_id": None,
            "mode": "folienlos",
            "timeline_end_ms": 0,
            "event_count": 0,
            "skipped_events": 0,
            "unresolved_events": 0,
            "segment_count": 0,
            "session_deleted": deleted_at is not None,
            "job_duration_ms": 0,
        }
        if deleted_at is None:
            end = _timeline_end(conn, sid, started_at, ended_at)
            result["timeline_end_ms"] = end
            deck = None
            if deck_id is not None:
                deck = conn.execute(
                    "SELECT id FROM slide_deck WHERE id = %s AND deleted_at IS NULL", (deck_id,)
                ).fetchone()
            conn.execute(
                "DELETE FROM slide_segment WHERE session_id = %s AND source = 'log'", (sid,)
            )
            if deck is not None:
                slides = {
                    int(r[0]): r[1]
                    for r in conn.execute(
                        "SELECT index, id FROM slide WHERE deck_id = %s AND deleted_at IS NULL",
                        (deck_id,),
                    ).fetchall()
                }
                changes = _load_changes(conn, sid, _offsets(start_offsets), end)
                timeline = build_timeline(changes, slides, end)
                job_id = uuid.UUID(ctx.job_id)
                with conn.cursor() as cur:
                    cur.executemany(
                        "INSERT INTO slide_segment (id, user_id, session_id, slide_id, "
                        "slide_index, start_ms, end_ms, source, confidence, job_id) "
                        "VALUES (%s, %s, %s, %s, %s, %s, %s, 'log', 1, %s)",
                        [
                            (uuid7(), user_id, sid, s.slide_id, s.slide_index, s.start_ms,
                             s.end_ms, job_id)
                            for s in timeline.segments
                        ],
                    )  # fmt: skip
                result.update(
                    slide_deck_id=str(deck_id),
                    mode="log" if timeline.real_changes else "ohne_wechsel",
                    event_count=len(changes),
                    skipped_events=timeline.skipped,
                    unresolved_events=timeline.unresolved,
                    segment_count=len(timeline.segments),
                )
        result["job_duration_ms"] = int((time.monotonic() - started) * 1000)
        ctx.finish(result)
        if not ctx.lock_ok:
            raise LockLostError(ctx.job_id)
    return result
