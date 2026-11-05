"""Testdaten für Phase 2 (`transcribe`, `align.log`). Alle Namen und Texte sind erfunden."""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from conftest import USER_ID

Conn = psycopg.Connection[Any]

SID = uuid.UUID("00000000-0000-7000-8000-0000000002a1")
MODULE = uuid.UUID("00000000-0000-7000-8000-0000000002b1")
DECK = uuid.UUID("00000000-0000-7000-8000-0000000002c1")


def add_module(conn: Conn, *, name: str = "Testmodul Algorithmen", lang: str | None = "de") -> None:
    conn.execute(
        "INSERT INTO module (id, user_id, name, lang) VALUES (%s, %s, %s, %s)",
        (MODULE, USER_ID, name, lang),
    )


def add_session(
    conn: Conn,
    *,
    state: str = "beendet",
    deck: uuid.UUID | None = DECK,
    started_at: str | None = "2026-11-05 10:00:00+00",
    ended_at: str | None = None,
    start_offsets: list[dict[str, Any]] | None = None,
) -> uuid.UUID:
    conn.execute(
        "INSERT INTO session (id, user_id, state, module_id, slide_deck_id, started_at, ended_at, "
        "start_offsets) VALUES (%s, %s, %s, %s, %s, %s::timestamptz, %s::timestamptz, %s)",
        (SID, USER_ID, state, MODULE, deck, started_at, ended_at, Jsonb(start_offsets or [])),
    )
    return SID


def add_deck(
    conn: Conn,
    titles: list[str | None],
    *,
    deck: uuid.UUID = DECK,
    texts: list[str] | None = None,
    deleted: bool = False,
) -> dict[int, uuid.UUID]:
    """Foliensatz mit Folien 1..n. Rückgabe: Index → Folien-ID."""
    conn.execute(
        "INSERT INTO slide_deck (id, user_id, module_id, title, file_path, sha256, deleted_at) "
        "VALUES (%s, %s, %s, 'Foliensatz', 'x.pdf', %s, CASE WHEN %s THEN now() END)",
        (deck, USER_ID, MODULE, "0" * 64, deleted),
    )
    ids: dict[int, uuid.UUID] = {}
    for i, title in enumerate(titles, start=1):
        sid = uuid.uuid4()
        ids[i] = sid
        text = texts[i - 1] if texts else ""
        conn.execute(
            "INSERT INTO slide (id, user_id, deck_id, index, width_pt, height_pt, text, title) "
            "VALUES (%s, %s, %s, %s, 720, 540, %s, %s)",
            (sid, USER_ID, deck, i, text, title),
        )
    return ids


def add_recording(
    conn: Conn,
    data_dir: Path | None,
    *,
    started_ms: int = 0,
    duration_ms: int | None = 25_000,
    finalize: str | None = "fertig",
    content: bytes | None = b"erfundenes audio",
    rec_id: uuid.UUID | None = None,
) -> tuple[uuid.UUID, uuid.UUID | None]:
    """Aufnahme mit `audio.finalize`-Job (Zustand `finalize`) und `full.m4a` (Inhalt `content`)."""
    rid = rec_id or uuid.uuid4()
    conn.execute(
        "INSERT INTO recording (id, user_id, session_id, mime, codec, started_ms, duration_ms, "
        "state) VALUES (%s, %s, %s, 'audio/webm', 'opus', %s, %s, 'vollstaendig')",
        (rid, USER_ID, SID, started_ms, duration_ms),
    )
    job_id = None
    if finalize is not None:
        job_id = add_finalize_job(conn, rid, finalize)
    if content is not None and data_dir is not None:
        path = data_dir / "media" / "recordings" / str(rid) / "full.m4a"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    return rid, job_id


def add_finalize_job(conn: Conn, rid: uuid.UUID, state: str = "fertig") -> uuid.UUID:
    job_id = uuid.uuid4()
    conn.execute(
        "INSERT INTO job (id, user_id, type, payload, state, session_id, created_at) "
        "VALUES (%s, %s, 'audio.finalize', %s, %s, %s, clock_timestamp())",
        (job_id, USER_ID, json.dumps({"recording_id": str(rid)}), state, SID),
    )
    return job_id


def add_pipeline_job(conn: Conn, job_type: str, payload: dict[str, Any] | None = None) -> uuid.UUID:
    job_id = uuid.uuid4()
    conn.execute(
        "INSERT INTO job (id, user_id, type, payload, session_id, priority, created_at) "
        "VALUES (%s, %s, %s, %s, %s, 20, clock_timestamp())",
        (job_id, USER_ID, job_type, json.dumps(payload or {"session_id": str(SID)}), SID),
    )
    return job_id


def processing(conn: Conn) -> tuple[str, dict[str, str] | None]:
    row = conn.execute("SELECT state, processing FROM session WHERE id = %s", (SID,)).fetchone()
    assert row is not None
    return row[0], row[1]
