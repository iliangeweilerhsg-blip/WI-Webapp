"""Testdaten für die KI-Jobs (T2-21a) gegen das ganze Core-Schema. Alles erfunden."""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from conftest import USER_ID, get_job
from sg_worker.loop import Worker
from sg_worker.registry import default_registry

Conn = psycopg.Connection[Any]


def ins(conn: Conn, table: str, **cols: Any) -> uuid.UUID:
    cols.setdefault("id", uuid.uuid4())
    cols.setdefault("user_id", USER_ID)
    keys = ", ".join(cols)
    marks = ", ".join(["%s"] * len(cols))
    conn.execute(f"INSERT INTO {table} ({keys}) VALUES ({marks})", list(cols.values()))  # type: ignore[call-overload]
    return uuid.UUID(str(cols["id"]))


def module(conn: Conn, *, lang: str | None = "de") -> uuid.UUID:
    sem = ins(conn, "semester", name="HS 2026")
    return ins(
        conn, "module", semester_id=sem, name="Erfundene Algorithmik", short_name="EA",
        color="mod-01", lang=lang,
    )  # fmt: skip


def session(
    conn: Conn,
    mod: uuid.UUID,
    *,
    deck: uuid.UUID | None = None,
    state: str = "beendet",
    minutes: int = 90,
) -> uuid.UUID:
    return ins(
        conn, "session", module_id=mod, slide_deck_id=deck, state=state, number=7,
        title="Erfundene Vorlesung", started_at="2026-11-05 10:00:00+00",
        ended_at=f"2026-11-05 {10 + minutes // 60:02d}:{minutes % 60:02d}:00+00",
    )  # fmt: skip


def deck(
    conn: Conn, mod: uuid.UUID, slides: list[dict[str, Any]]
) -> tuple[uuid.UUID, list[uuid.UUID]]:
    did = ins(
        conn, "slide_deck", module_id=mod, title="VL 7", file_path="media/decks/x/original.pdf",
        sha256="a" * 64,
    )  # fmt: skip
    ids = [
        ins(conn, "slide", deck_id=did, index=i, width_pt=720, height_pt=540, **s)
        for i, s in enumerate(slides, start=1)
    ]
    return did, ids


def transcript(conn: Conn, sid: uuid.UUID, segs: list[tuple[int, int, str]]) -> uuid.UUID:
    """Aufnahme mit Transkript. `segs`: (start_ms, end_ms, text) in Sitzungszeit."""
    end = max((e for _, e, _ in segs), default=0)
    rid = ins(conn, "recording", session_id=sid, mime="audio/webm", codec="opus",
              started_ms=0, duration_ms=end, state="vollstaendig")  # fmt: skip
    tid = ins(
        conn, "transcript", session_id=sid, recording_id=rid, job_id=uuid.uuid4(),
        finalize_job_id=uuid.uuid4(), provider="fake", model="fake-1", input_hash="b" * 64,
        audio_sha256="c" * 64, audio_duration_ms=end, segment_count=len(segs), word_count=0,
    )  # fmt: skip
    for seq, (start, stop, text) in enumerate(segs):
        ins(
            conn, "transcript_segment", transcript_id=tid, session_id=sid, recording_id=rid,
            seq=seq, start_ms=start, end_ms=stop, text=text, lang="de",
        )  # fmt: skip
    return rid


def slide_segment(
    conn: Conn, sid: uuid.UUID, slide: uuid.UUID, index: int, start: int, end: int,
    source: str = "log",
) -> None:  # fmt: skip
    ins(conn, "slide_segment", session_id=sid, slide_id=slide, slide_index=index,
        start_ms=start, end_ms=end, source=source, confidence=1)  # fmt: skip


def marker(conn: Conn, sid: uuid.UUID, kind: str, t_ms: int) -> None:
    ins(conn, "marker", session_id=sid, kind=kind, t_ms=t_ms, source="mac")


def set_budget(conn: Conn, value: Any) -> None:
    conn.execute(
        "INSERT INTO setting (key, value, user_id) VALUES ('ai', %s, %s) "
        "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        (Jsonb({"monthly_budget_eur": value, "auto_accept": "aus"}), USER_ID),
    )


def add_cost(conn: Conn, eur: float, *, created_at: str | None = None) -> None:
    conn.execute(
        "INSERT INTO cost_entry (id, user_id, provider, model, task, cost_estimate_eur, created_at)"
        " VALUES (%s, %s, 'fake', 'fake-llm-1', 'concepts.extract', %s,"
        " COALESCE(%s::timestamptz, now()))",
        (uuid.uuid4(), USER_ID, eur, created_at),
    )


def add_job(
    conn: Conn,
    sid: uuid.UUID,
    *,
    job_type: str = "concepts.extract",
    payload: dict[str, Any] | None = None,
    attempts: int = 0,
    max_attempts: int = 3,
) -> uuid.UUID:
    job_id = uuid.uuid4()
    conn.execute(
        "INSERT INTO job (id, user_id, type, payload, session_id, priority, attempts, "
        "max_attempts, created_at) VALUES (%s, %s, %s, %s, %s, 8, %s, %s, clock_timestamp())",
        (job_id, USER_ID, job_type, json.dumps(payload or {"session_id": str(sid)}), sid,
         attempts, max_attempts),
    )  # fmt: skip
    return job_id


def run(
    database_url: str, kwargs: dict[str, Any], tmp_path: Path, conn: Conn, job_id: uuid.UUID
) -> dict[str, Any]:
    """Arbeitet alle fälligen Jobs ab und liefert die Job-Zeile."""
    worker = Worker(
        database_url,
        tmp_path,
        registry=default_registry,
        channel=f"sg_jobs_{uuid.uuid4().hex[:8]}",
        connect_kwargs=kwargs,
        worker_id="ich",
    )
    with psycopg.connect(database_url, autocommit=True, **kwargs) as work:
        worker.drain(work)
    return get_job(conn, job_id)


def costs(conn: Conn) -> list[dict[str, Any]]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT * FROM cost_entry ORDER BY created_at, id")
        return cur.fetchall()
