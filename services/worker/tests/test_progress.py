"""Session-Fortschritt in der Job-Schleife (VERTRAEGE §3, #75)."""

from __future__ import annotations

import threading
import uuid
from pathlib import Path
from typing import Any

import psycopg
import pytest

from conftest import USER_ID, get_job
from sg_worker import jobs, progress
from sg_worker.loop import Worker
from sg_worker.registry import JobContext, Registry

SID = uuid.UUID("00000000-0000-7000-8000-0000000000a1")


def make_registry() -> Registry:
    reg = Registry()

    def work(payload: dict[str, Any], ctx: JobContext) -> dict[str, Any]:
        if payload.get("fail"):
            raise RuntimeError("boom")
        return {"ok": True}

    reg.register("transcribe", work)
    reg.register("summarize", work)
    return reg


@pytest.fixture
def worker(database_url: str, connect_kwargs: dict[str, Any], tmp_path: Path) -> Worker:
    return Worker(
        database_url,
        tmp_path,
        registry=make_registry(),
        channel=f"sg_jobs_{uuid.uuid4().hex[:8]}",
        connect_kwargs=connect_kwargs,
    )


def add_session(conn: psycopg.Connection[Any], state: str = "beendet") -> uuid.UUID:
    conn.execute(
        "INSERT INTO session (id, user_id, state) VALUES (%s, %s, %s)", (SID, USER_ID, state)
    )
    return SID


def session_row(conn: psycopg.Connection[Any]) -> tuple[str, dict[str, str] | None]:
    row = conn.execute("SELECT state, processing FROM session WHERE id = %s", (SID,)).fetchone()
    assert row is not None
    return row[0], row[1]


def add_job(
    conn: psycopg.Connection[Any],
    job_type: str = "transcribe",
    *,
    state: str = "wartet",
    payload: str = "{}",
    max_attempts: int = 3,
    depends_on: list[uuid.UUID] | None = None,
    delayed: bool = False,
) -> uuid.UUID:
    job_id = uuid.uuid4()
    conn.execute(
        "INSERT INTO job (id, user_id, type, payload, state, session_id, max_attempts, "
        "depends_on, run_after) VALUES (%s, %s, %s, %s::jsonb, %s, %s, %s, %s, "
        "CASE WHEN %s THEN now() + interval '1 day' END)",
        (job_id, USER_ID, job_type, payload, state, SID, max_attempts, depends_on or [], delayed),
    )
    return job_id


def refresh(conn: psycopg.Connection[Any], *types: str) -> None:
    with conn.transaction():
        progress.refresh(conn, SID, types or ["transcribe"])


def test_fertig_sets_processing_and_verarbeitet(
    worker: Worker, conn: psycopg.Connection[Any]
) -> None:
    add_session(conn)
    add_job(conn)
    worker.drain(conn)
    assert session_row(conn) == ("verarbeitet", {"transcribe": "fertig"})


def test_fehler_after_retries_exhausted(worker: Worker, conn: psycopg.Connection[Any]) -> None:
    add_session(conn)
    add_job(conn, payload='{"fail": true}', max_attempts=1)
    worker.drain(conn)
    assert session_row(conn) == ("verarbeitet", {"transcribe": "fehler"})


def test_retry_keeps_session_beendet(worker: Worker, conn: psycopg.Connection[Any]) -> None:
    add_session(conn)
    add_job(conn, payload='{"fail": true}')
    worker.drain(conn)
    assert session_row(conn) == ("beendet", {"transcribe": "wartet"})


def test_abgebrochen_via_depends_on(worker: Worker, conn: psycopg.Connection[Any]) -> None:
    add_session(conn)
    first = add_job(conn, "transcribe", payload='{"fail": true}', max_attempts=1)
    add_job(conn, "summarize", depends_on=[first])
    worker.drain(conn)
    assert session_row(conn) == (
        "verarbeitet",
        {"transcribe": "fehler", "summarize": "abgebrochen"},
    )


def test_only_cancelled_jobs_give_abgebrochen(
    worker: Worker, conn: psycopg.Connection[Any]
) -> None:
    add_session(conn)
    add_job(conn, "summarize", depends_on=[uuid.uuid4()])  # Abhängigkeit existiert nicht
    worker.drain(conn)
    assert session_row(conn) == ("verarbeitet", {"summarize": "abgebrochen"})


def test_cancelled_does_not_count_next_to_fertig(conn: psycopg.Connection[Any]) -> None:
    add_session(conn)
    add_job(conn, state="fertig")
    add_job(conn, state="abgebrochen")
    refresh(conn)
    assert session_row(conn)[1] == {"transcribe": "fertig"}


def test_summary_priority_for_several_jobs_of_one_type(conn: psycopg.Connection[Any]) -> None:
    add_session(conn, "laeuft")
    add_job(conn, state="fertig")
    add_job(conn, state="wartet")
    refresh(conn)
    assert session_row(conn)[1] == {"transcribe": "wartet"}
    add_job(conn, state="laeuft")
    refresh(conn)
    assert session_row(conn)[1] == {"transcribe": "laeuft"}
    add_job(conn, state="fehler")
    refresh(conn)
    assert session_row(conn)[1] == {"transcribe": "fehler"}


def test_several_job_types_and_open_job_blocks_verarbeitet(
    worker: Worker, conn: psycopg.Connection[Any]
) -> None:
    add_session(conn)
    add_job(conn, "transcribe")
    add_job(conn, "summarize", delayed=True)
    worker.drain(conn)
    assert session_row(conn) == ("beendet", {"transcribe": "fertig"})
    conn.execute("UPDATE job SET run_after = NULL WHERE type = 'summarize'")
    worker.drain(conn)
    assert session_row(conn) == ("verarbeitet", {"transcribe": "fertig", "summarize": "fertig"})


def test_straggler_after_verarbeitet_only_updates_processing(
    worker: Worker, conn: psycopg.Connection[Any]
) -> None:
    add_session(conn, "verarbeitet")
    add_job(conn)
    worker.drain(conn)
    assert session_row(conn) == ("verarbeitet", {"transcribe": "fertig"})


def test_running_session_stays_laeuft(worker: Worker, conn: psycopg.Connection[Any]) -> None:
    add_session(conn, "laeuft")
    add_job(conn)
    worker.drain(conn)
    assert session_row(conn) == ("laeuft", {"transcribe": "fertig"})


def test_notify(worker: Worker, conn: psycopg.Connection[Any], database_url: str) -> None:
    add_session(conn)
    add_job(conn)
    with psycopg.connect(database_url, autocommit=True) as listener:
        listener.execute("LISTEN sg_session")
        worker.drain(conn)
        got = [n.payload for n in listener.notifies(timeout=2, stop_after=1)]
    assert got == [str(SID)]


def test_idempotent_double_run(conn: psycopg.Connection[Any]) -> None:
    add_session(conn)
    add_job(conn, state="fertig")
    refresh(conn)
    first = session_row(conn)
    refresh(conn)
    refresh(conn)
    assert session_row(conn) == first == ("verarbeitet", {"transcribe": "fertig"})


def test_unknown_session_is_ignored(conn: psycopg.Connection[Any]) -> None:
    add_job(conn, state="fertig")
    refresh(conn)  # keine Session-Zeile: kein Fehler


def test_stuck_job_final_failure_updates_progress(
    worker: Worker, conn: psycopg.Connection[Any]
) -> None:
    add_session(conn)
    job = add_job(conn, state="laeuft", max_attempts=1)
    conn.execute(
        "UPDATE job SET attempts = 1, locked_by = 'andere', locked_at = now() - interval '1 hour' "
        "WHERE id = %s",
        (job,),
    )
    assert worker._recover(conn) == 1
    assert session_row(conn) == ("verarbeitet", {"transcribe": "fehler"})


def test_unknown_job_type_marks_fehler(worker: Worker, conn: psycopg.Connection[Any]) -> None:
    add_session(conn)
    add_job(conn, "nicht.registriert")
    worker.drain(conn)
    assert session_row(conn) == ("verarbeitet", {"nicht.registriert": "fehler"})


def test_two_connections_finishing_together_end_verarbeitet(
    database_url: str,
    connect_kwargs: dict[str, Any],
    tmp_path: Path,
    conn: psycopg.Connection[Any],
) -> None:
    """Zwei Worker beenden die letzten zwei Jobs gleichzeitig. Ohne Sperre vor dem Zählen sähe
    jeder den anderen noch als `laeuft`, und die Session bliebe `beendet`."""
    add_session(conn)
    ids = {"slow": add_job(conn, "slow"), "fast": add_job(conn, "fast")}
    for name, job_id in ids.items():
        conn.execute(
            "UPDATE job SET state = 'laeuft', attempts = 1, locked_by = %s, locked_at = now() "
            "WHERE id = %s",
            (name, job_id),
        )
    a_in_txn = threading.Event()
    release = threading.Event()

    def slow(payload: Any, ctx: JobContext) -> dict[str, Any]:
        with ctx.conn.transaction():
            ctx.finish({})
            a_in_txn.set()  # Transaktion von A ist offen, Session gesperrt
            release.wait(10)
        return {}

    def fast(payload: Any, ctx: JobContext) -> dict[str, Any]:
        assert a_in_txn.wait(10)
        threading.Timer(0.5, release.set).start()  # A committet erst, wenn B schon wartet
        return {}

    def run(name: str, fn: Any) -> None:
        reg = Registry()
        reg.register(name, fn)
        w = Worker(
            database_url,
            tmp_path,
            registry=reg,
            worker_id=name,
            channel=f"sg_jobs_{uuid.uuid4().hex[:8]}",
            connect_kwargs=connect_kwargs,
        )
        with psycopg.connect(database_url, autocommit=True, **connect_kwargs) as c:
            row = get_job(conn, ids[name])
            w._execute(c, row)

    threads = [
        threading.Thread(target=run, args=("slow", slow)),
        threading.Thread(target=run, args=("fast", fast)),
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join(30)
        assert not t.is_alive()
    assert session_row(conn) == ("verarbeitet", {"slow": "fertig", "fast": "fertig"})


def test_cancel_dependents_returns_rows(conn: psycopg.Connection[Any]) -> None:
    add_session(conn)
    dep = add_job(conn, state="fehler")
    add_job(conn, "summarize", depends_on=[dep])
    rows = jobs.cancel_dependents(conn)
    assert [(r["type"], r["session_id"]) for r in rows] == [("summarize", SID)]
