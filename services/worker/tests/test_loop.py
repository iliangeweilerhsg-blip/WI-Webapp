"""Job-Schleife: Handler, Fehlerpfade, NOTIFY, sauberes Beenden."""

from __future__ import annotations

import threading
import time
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import psycopg
import pytest
from sg_schemas.models import PdfIngestPayload

from conftest import MakeJob, get_job
from sg_worker.loop import Worker
from sg_worker.registry import JobContext, Registry


def make_registry() -> Registry:
    reg = Registry()

    def echo(payload: dict[str, Any], ctx: JobContext) -> dict[str, Any]:
        if payload.get("fail"):
            raise RuntimeError("boom")
        return {"echo": payload, "job_id": ctx.job_id}

    def ingest(payload: Any, ctx: JobContext) -> dict[str, Any]:
        return {"kind": type(payload).__name__}

    reg.register("internal.echo", echo)
    reg.register("pdf.ingest", ingest, PdfIngestPayload)
    return reg


@pytest.fixture
def worker(database_url: str, connect_kwargs: dict[str, Any], tmp_path: Path) -> Worker:
    return Worker(
        database_url,
        tmp_path,
        registry=make_registry(),
        poll_interval=30,
        channel=f"sg_jobs_{uuid.uuid4().hex[:8]}",
        connect_kwargs=connect_kwargs,
    )


def test_drain_success(worker: Worker, conn: psycopg.Connection[Any], make_job: MakeJob) -> None:
    job_id = make_job(payload={"a": 1})
    assert worker.drain(conn) == 1
    row = get_job(conn, job_id)
    assert row["state"] == "fertig"
    assert row["result"] == {"echo": {"a": 1}, "job_id": str(job_id)}


def test_handler_exception_retries_then_fails(
    worker: Worker, conn: psycopg.Connection[Any], make_job: MakeJob
) -> None:
    job_id = make_job(payload={"fail": True}, max_attempts=2)
    worker.drain(conn)
    row = get_job(conn, job_id)
    assert row["state"] == "wartet"
    assert "boom" in row["error"]
    assert row["run_after"] is not None
    conn.execute("UPDATE job SET run_after = NULL WHERE id = %s", (job_id,))
    worker.drain(conn)
    row = get_job(conn, job_id)
    assert row["state"] == "fehler"
    assert row["attempts"] == 2


def test_unknown_type_is_fehler_and_loop_continues(
    worker: Worker, conn: psycopg.Connection[Any], make_job: MakeJob
) -> None:
    unknown = make_job("gibt.es.nicht", priority=10)
    ok = make_job()
    assert worker.drain(conn) == 2
    row = get_job(conn, unknown)
    assert row["state"] == "fehler"
    assert row["error"] == "unbekannter Job-Typ"
    assert get_job(conn, ok)["state"] == "fertig"


def test_payload_validated_with_pydantic(
    worker: Worker, conn: psycopg.Connection[Any], make_job: MakeJob
) -> None:
    good = make_job("pdf.ingest", payload={"slide_deck_id": str(uuid.uuid4())})
    bad = make_job("pdf.ingest", payload={"slide_deck_id": "keine-uuid"})
    worker.drain(conn)
    assert get_job(conn, good)["result"] == {"kind": "PdfIngestDeckPayload"}
    row = get_job(conn, bad)
    assert row["state"] == "fehler"  # ungültiges Payload: kein Retry
    assert "ungültiges Payload" in row["error"]


def test_dependency_failure_cancels_dependent(
    worker: Worker, conn: psycopg.Connection[Any], make_job: MakeJob
) -> None:
    first = make_job(payload={"fail": True}, max_attempts=1)
    child = make_job(depends_on=[first])
    worker.drain(conn)
    assert get_job(conn, first)["state"] == "fehler"
    row = get_job(conn, child)
    assert row["state"] == "abgebrochen"
    assert row["error"] == f"Abhängigkeit {first} fehlgeschlagen"


@contextmanager
def running(worker: Worker) -> Iterator[threading.Thread]:
    thread = threading.Thread(target=worker.run, daemon=True)
    thread.start()
    try:
        yield thread
    finally:
        worker.stop()
        thread.join(timeout=10)
        assert not thread.is_alive()


def wait_for(predicate: Callable[[], bool], timeout: float = 10) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.05)
    return False


def test_notify_wakes_the_loop(
    worker: Worker,
    database_url: str,
    conn: psycopg.Connection[Any],
    make_job: MakeJob,
) -> None:
    with running(worker):
        time.sleep(1)  # Schleife ist eingeschlafen (Fallback-Intervall 30 s)
        job_id = make_job()
        # Ohne NOTIFY würde der Job bis zur nächsten Abfrage (30 s) liegen bleiben.
        time.sleep(1)
        assert get_job(conn, job_id)["state"] == "wartet"
        conn.execute("SELECT pg_notify(%s, %s)", (worker.channel, str(job_id)))
        assert wait_for(lambda: get_job(conn, job_id)["state"] == "fertig", timeout=5)


def test_startup_recovers_stuck_jobs(
    worker: Worker, conn: psycopg.Connection[Any], make_job: MakeJob
) -> None:
    job_id = make_job(state="laeuft", attempts=1, locked_at="2000-01-01")
    with running(worker):
        assert wait_for(lambda: get_job(conn, job_id)["state"] == "fertig")
    assert get_job(conn, job_id)["attempts"] == 2


def test_stop_ends_run_promptly(worker: Worker) -> None:
    start = time.monotonic()
    with running(worker):
        time.sleep(0.5)
    assert time.monotonic() - start < 5
