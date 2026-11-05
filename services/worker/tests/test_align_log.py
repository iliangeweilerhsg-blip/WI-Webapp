"""`align.log`: Folien-Zeitleiste aus dem Wechsel-Log (VERTRAEGE §18.3, 05 §P5a)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import psycopg
import pytest
from psycopg.types.json import Jsonb
from sg_schemas.models import AlignLogResult

import sg_worker.handlers  # noqa: F401  (registriert die Handler)
from conftest import USER_ID, get_job
from p2data import (
    DECK,
    SID,
    add_deck,
    add_module,
    add_pipeline_job,
    add_recording,
    add_session,
    processing,
)
from sg_worker.handlers.align_log import Change, Seg, build_timeline
from sg_worker.loop import Worker
from sg_worker.registry import default_registry

Conn = psycopg.Connection[Any]
T0 = datetime(2026, 11, 5, 10, 0, tzinfo=UTC)
SLIDES = {i: uuid.UUID(int=i) for i in range(1, 6)}


def ch(t: int, index: int, n: int = 0) -> Change:
    return Change(t, T0 + timedelta(seconds=n), uuid.UUID(int=1000 + n), index)


def spans(segments: list[Seg]) -> list[tuple[int, int, int]]:
    return [(s.slide_index, s.start_ms, s.end_ms) for s in segments]


# ---------- reine Logik ----------


def test_without_changes_whole_session_on_slide_one() -> None:
    tl = build_timeline([], SLIDES, 60_000)
    assert spans(tl.segments) == [(1, 0, 60_000)]
    assert (tl.real_changes, tl.skipped, tl.unresolved) == (0, 0, 0)
    assert tl.segments[0].slide_id == SLIDES[1]


def test_passes_under_one_and_a_half_seconds_are_skipped() -> None:
    changes = [ch(10_000, 2, 1), ch(10_500, 3, 2), ch(20_000, 4, 3)]
    tl = build_timeline(changes, SLIDES, 30_000)
    assert spans(tl.segments) == [(1, 0, 10_500), (3, 10_500, 20_000), (4, 20_000, 30_000)]
    assert (tl.real_changes, tl.skipped) == (2, 1)


def test_dwell_exactly_one_and_a_half_seconds_is_kept() -> None:
    tl = build_timeline([ch(10_000, 2, 1), ch(11_500, 3, 2)], SLIDES, 20_000)
    assert spans(tl.segments) == [(1, 0, 10_000), (2, 10_000, 11_500), (3, 11_500, 20_000)]


def test_dwell_times_are_computed_once_from_the_list() -> None:
    """Die Standzeiten kommen aus der Liste nach Schritt 5, nicht erneut nach dem Wegfallen.
    Der gedachte Start (Folie 1 bis 1 000 ms) fällt darum ebenfalls weg, ohne gezählt zu werden."""
    tl = build_timeline([ch(1_000, 2, 1), ch(2_000, 3, 2)], SLIDES, 30_000)
    assert spans(tl.segments) == [(3, 2_000, 30_000)]
    assert tl.skipped == 1


def test_first_change_at_zero_replaces_virtual_start() -> None:
    tl = build_timeline([ch(0, 3, 1)], SLIDES, 30_000)
    assert spans(tl.segments) == [(3, 0, 30_000)]
    assert (tl.skipped, tl.real_changes) == (0, 1)


def test_consecutive_segments_of_same_slide_are_merged() -> None:
    changes = [ch(5_000, 2, 1), ch(9_000, 2, 2), ch(12_000, 1, 3), ch(12_200, 4, 4)]
    tl = build_timeline(changes, SLIDES, 20_000)
    # Folie 1 bei 12 000 ist ein Durchgang, Folie 2 läuft bis zum Wechsel auf 4 weiter
    assert spans(tl.segments) == [(1, 0, 5_000), (2, 5_000, 12_200), (4, 12_200, 20_000)]
    assert tl.skipped == 1


def test_unknown_index_is_unresolved_and_dropped() -> None:
    tl = build_timeline([ch(5_000, 9, 1), ch(10_000, 2, 2)], SLIDES, 20_000)
    assert spans(tl.segments) == [(1, 0, 10_000), (2, 10_000, 20_000)]
    assert (tl.unresolved, tl.skipped) == (1, 0)


def test_without_slide_one_no_virtual_start() -> None:
    slides = {k: v for k, v in SLIDES.items() if k != 1}
    tl = build_timeline([ch(5_000, 2, 1)], slides, 20_000)
    assert spans(tl.segments) == [(2, 5_000, 20_000)]
    assert build_timeline([], slides, 20_000).segments == []


def test_empty_timeline_gives_no_segments() -> None:
    tl = build_timeline([], SLIDES, 0)
    assert tl.segments == [] and tl.skipped == 0


# ---------- mit DB ----------


@pytest.fixture
def worker(database_url: str, connect_kwargs: dict[str, Any], tmp_path: Path) -> Worker:
    return Worker(
        database_url,
        tmp_path,
        registry=default_registry,
        channel=f"sg_jobs_{uuid.uuid4().hex[:8]}",
        connect_kwargs=connect_kwargs,
    )


def add_event(
    conn: Conn,
    t_ms: int,
    index: int,
    *,
    device: str = "mac",
    device_id: uuid.UUID | None = None,
    slide_id: uuid.UUID | None = None,
    deleted: bool = False,
    created_s: int = 0,
) -> uuid.UUID:
    eid = uuid.uuid4()
    conn.execute(
        "INSERT INTO slide_event (id, user_id, session_id, slide_id, slide_index, t_ms, device, "
        "source, created_at, deleted_at) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, "
        "%s, CASE WHEN %s THEN now() END)",
        (
            eid,
            USER_ID,
            SID,
            slide_id,
            index,
            t_ms,
            device,
            f"manuell_{device}",
            T0 + timedelta(seconds=created_s),
            deleted,
        ),
    )
    if device_id is not None:
        seq_row = conn.execute(
            "SELECT coalesce(max(seq), 0) + 1 FROM sync_op WHERE stream = %s", (f"session:{SID}",)
        ).fetchone()
        assert seq_row is not None
        conn.execute(
            "INSERT INTO sync_op (stream, seq, op_id, kind, at, clock_uncertain, data, origin, "
            "device_id) VALUES (%s, %s, %s, 'slide.change', 0, false, %s, 'ipad', %s)",
            (
                f"session:{SID}",
                seq_row[0],
                uuid.uuid4(),
                Jsonb({"event_id": str(eid), "slide_index": index}),
                device_id,
            ),
        )
    return eid


def run_align(worker: Worker, conn: Conn, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    job_id = add_pipeline_job(conn, "align.log", payload)
    worker.drain(conn)
    return get_job(conn, job_id)


def stored(conn: Conn, source: str = "log") -> list[tuple[int, int, int]]:
    rows = conn.execute(
        "SELECT slide_index, start_ms, end_ms FROM slide_segment WHERE source = %s "
        "ORDER BY start_ms",
        (source,),
    ).fetchall()
    return [(int(a), int(b), int(c)) for a, b, c in rows]


@pytest.fixture
def slides(conn: Conn) -> dict[int, uuid.UUID]:
    add_module(conn)
    return add_deck(conn, ["Titel 1", "Titel 2", "Titel 3", "Titel 4"])


def test_log_timeline_is_written(worker: Worker, conn: Conn, slides: dict[int, Any]) -> None:
    add_session(conn, ended_at="2026-11-05 10:01:00+00")  # 60 s
    add_event(conn, 10_000, 2)
    add_event(conn, 10_400, 3)  # Durchgang
    add_event(conn, 30_000, 4)
    job = run_align(worker, conn)
    assert job["state"] == "fertig", job["error"]
    result = AlignLogResult.model_validate(job["result"])
    assert (result.mode.value, result.timeline_end_ms, result.event_count) == ("log", 60_000, 3)
    assert (result.skipped_events, result.unresolved_events, result.segment_count) == (1, 0, 3)
    assert result.slide_deck_id is not None and result.slide_deck_id.root == str(DECK)
    assert stored(conn) == [(1, 0, 10_400), (3, 10_400, 30_000), (4, 30_000, 60_000)]
    row = conn.execute(
        "SELECT DISTINCT confidence, job_id, slide_id = %s FROM slide_segment "
        "WHERE slide_index = 1",
        (slides[1],),
    ).fetchone()
    assert row == (1.0, job["id"], True)
    assert processing(conn) == ("verarbeitet", {"align.log": "fertig"})


def test_ipad_offset_from_sync_op_and_start_offsets(
    worker: Worker, conn: Conn, slides: dict[int, Any]
) -> None:
    ipad, other = uuid.uuid4(), uuid.uuid4()
    add_session(
        conn,
        ended_at="2026-11-05 10:01:00+00",
        start_offsets=[
            {"device_id": str(ipad), "offset_ms": 5_000},
            {"device_id": str(ipad), "offset_ms": 99_000},  # nur der erste zählt
            {"device_id": str(other), "offset_ms": -3_000},
        ],
    )
    add_event(conn, 10_000, 2, device="ipad", device_id=ipad)  # → 15 000
    add_event(conn, 20_000, 3, device="mac")  # Mac: kein Versatz
    add_event(conn, 40_000, 4, device="ipad")  # ohne sync_op: kein Versatz
    job = run_align(worker, conn)
    assert job["state"] == "fertig", job["error"]
    assert stored(conn) == [
        (1, 0, 15_000),
        (2, 15_000, 20_000),
        (3, 20_000, 40_000),
        (4, 40_000, 60_000),
    ]


def test_negative_offset_is_clamped_to_zero_and_end(
    worker: Worker, conn: Conn, slides: dict[int, Any]
) -> None:
    ipad = uuid.uuid4()
    add_session(
        conn,
        ended_at="2026-11-05 10:01:00+00",
        start_offsets=[{"device_id": str(ipad), "offset_ms": -5_000}],
    )
    add_event(conn, 2_000, 2, device="ipad", device_id=ipad)  # → -3 000 → 0
    add_event(conn, 90_000, 3)  # → 60 000, Standzeit 0: Durchgang
    job = run_align(worker, conn)
    assert stored(conn) == [(2, 0, 60_000)]
    assert job["result"]["skipped_events"] == 1


def test_timeline_end_from_recordings(
    worker: Worker, conn: Conn, slides: dict[int, Any], tmp_path: Path
) -> None:
    add_session(conn, ended_at="2026-11-05 10:01:00+00")
    add_recording(conn, None, started_ms=30_000, duration_ms=50_000)  # → 80 000
    rid, _ = add_recording(conn, None, started_ms=100_000, duration_ms=None)
    conn.execute("UPDATE recording SET completed_duration_ms = 20_000 WHERE id = %s", (rid,))
    add_recording(conn, None, started_ms=500_000, duration_ms=1)
    conn.execute("UPDATE recording SET deleted_at = now() WHERE started_ms = 500000")
    job = run_align(worker, conn)
    assert job["result"]["timeline_end_ms"] == 120_000
    assert job["result"]["mode"] == "ohne_wechsel"
    assert stored(conn) == [(1, 0, 120_000)]


def test_slide_resolved_by_index_and_deleted_rows_ignored(
    worker: Worker, conn: Conn, slides: dict[int, Any]
) -> None:
    add_session(conn, ended_at="2026-11-05 10:01:00+00")
    add_event(conn, 10_000, 2, slide_id=uuid.uuid4())  # slide_id zählt nicht
    add_event(conn, 20_000, 3, deleted=True)
    add_event(conn, 30_000, 4)
    conn.execute("UPDATE slide SET deleted_at = now() WHERE index = 4")
    job = run_align(worker, conn)
    assert stored(conn) == [(1, 0, 10_000), (2, 10_000, 60_000)]
    assert (job["result"]["event_count"], job["result"]["unresolved_events"]) == (2, 1)


def test_order_ties_by_created_at(worker: Worker, conn: Conn, slides: dict[int, Any]) -> None:
    add_session(conn, ended_at="2026-11-05 10:01:00+00")
    add_event(conn, 10_000, 3, created_s=2)
    add_event(conn, 10_000, 2, created_s=1)
    run_align(worker, conn)
    # Erst Folie 2 (früher angelegt, Standzeit 0: Durchgang), dann Folie 3
    assert stored(conn) == [(1, 0, 10_000), (3, 10_000, 60_000)]


def test_without_deck_folienlos_and_only_log_segments_replaced(
    worker: Worker, conn: Conn, slides: dict[int, Any]
) -> None:
    add_session(conn, deck=None, ended_at="2026-11-05 10:01:00+00")
    for source in ("log", "manuell"):
        conn.execute(
            "INSERT INTO slide_segment (id, user_id, session_id, slide_id, slide_index, start_ms, "
            "end_ms, source, confidence) VALUES (%s, %s, %s, %s, 1, 0, 1000, %s, 1)",
            (uuid.uuid4(), USER_ID, SID, slides[1], source),
        )
    job = run_align(worker, conn)
    result = AlignLogResult.model_validate(job["result"])
    assert (result.mode.value, result.slide_deck_id, result.segment_count) == ("folienlos", None, 0)
    assert stored(conn) == [] and stored(conn, "manuell") == [(1, 0, 1000)]


def test_deleted_deck_is_folienlos(worker: Worker, conn: Conn) -> None:
    add_module(conn)
    add_deck(conn, ["A"], deleted=True)
    add_session(conn, ended_at="2026-11-05 10:01:00+00")
    job = run_align(worker, conn)
    assert job["result"]["mode"] == "folienlos"


def test_rerun_replaces_log_segments(worker: Worker, conn: Conn, slides: dict[int, Any]) -> None:
    add_session(conn, ended_at="2026-11-05 10:01:00+00")
    add_event(conn, 10_000, 2)
    run_align(worker, conn)
    first = stored(conn)
    add_event(conn, 40_000, 3)
    run_align(worker, conn)
    assert first == [(1, 0, 10_000), (2, 10_000, 60_000)]
    assert stored(conn) == [(1, 0, 10_000), (2, 10_000, 40_000), (3, 40_000, 60_000)]


def test_deleted_session_writes_nothing(worker: Worker, conn: Conn, slides: dict[int, Any]) -> None:
    add_session(conn, ended_at="2026-11-05 10:01:00+00")
    conn.execute("UPDATE session SET deleted_at = now()")
    job = run_align(worker, conn)
    assert job["state"] == "fertig"
    result = AlignLogResult.model_validate(job["result"])
    assert result.session_deleted is True and stored(conn) == []


def test_missing_session_fails_without_retry(worker: Worker, conn: Conn) -> None:
    job = run_align(worker, conn)
    assert (job["state"], job["attempts"], job["error"]) == ("fehler", 1, "Session unbekannt")


def test_invalid_payload_fails(worker: Worker, conn: Conn) -> None:
    job = run_align(worker, conn, {"session_id": str(SID), "extra": 1})
    assert job["state"] == "fehler" and job["error"].startswith("ungültiges Payload")
