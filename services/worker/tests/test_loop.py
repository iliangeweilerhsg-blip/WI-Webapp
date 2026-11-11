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
from sg_worker.loop import ORPHAN_ERROR, Worker
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
    assert row["error"].startswith("ungültiges Payload: ")


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


def _worker(
    reg: Registry,
    database_url: str,
    connect_kwargs: dict[str, Any],
    tmp_path: Path,
    **kw: Any,
) -> Worker:
    return Worker(
        database_url,
        tmp_path,
        registry=reg,
        connect_kwargs=connect_kwargs,
        channel=f"sg_jobs_{uuid.uuid4().hex[:8]}",
        **kw,
    )


def test_open_transaction_after_handler_fails_job(
    database_url: str,
    connect_kwargs: dict[str, Any],
    tmp_path: Path,
    conn: psycopg.Connection[Any],
    make_job: MakeJob,
) -> None:
    reg = Registry()

    def sloppy(payload: Any, ctx: JobContext) -> dict[str, Any]:
        ctx.conn.autocommit = False
        ctx.conn.execute("SELECT 1")  # Transaktion bleibt offen
        return {}

    reg.register("sloppy", sloppy)
    w = _worker(reg, database_url, connect_kwargs, tmp_path)
    job_id = make_job("sloppy", max_attempts=1)
    with psycopg.connect(database_url, autocommit=True, **connect_kwargs) as wc:
        w.drain(wc)
        assert wc.autocommit is True
        assert wc.info.transaction_status == psycopg.pq.TransactionStatus.IDLE
    row = get_job(conn, job_id)
    assert row["state"] == "fehler"
    assert "Transaktion" in row["error"]


def test_finish_inside_transaction_is_atomic(
    database_url: str,
    connect_kwargs: dict[str, Any],
    tmp_path: Path,
    conn: psycopg.Connection[Any],
    make_job: MakeJob,
) -> None:
    conn.execute("CREATE TABLE target (v int)")
    reg = Registry()

    def good(payload: Any, ctx: JobContext) -> dict[str, Any]:
        with ctx.conn.transaction():
            ctx.conn.execute("INSERT INTO target VALUES (1)")
            ctx.finish({"ok": True})
        return {"ok": True}

    def bad(payload: Any, ctx: JobContext) -> dict[str, Any]:
        with ctx.conn.transaction():
            ctx.conn.execute("INSERT INTO target VALUES (2)")
            ctx.finish({"ok": True})
            raise RuntimeError("nach finish")

    reg.register("good", good)
    reg.register("bad", bad)
    w = _worker(reg, database_url, connect_kwargs, tmp_path)
    good_id = make_job("good")
    bad_id = make_job("bad", max_attempts=1)
    with psycopg.connect(database_url, autocommit=True, **connect_kwargs) as wc:
        w.drain(wc)
    assert get_job(conn, good_id)["state"] == "fertig"
    assert get_job(conn, good_id)["result"] == {"ok": True}
    assert get_job(conn, bad_id)["state"] == "fehler"  # Rollback: kein halbes fertig
    assert conn.execute("SELECT array_agg(v) FROM target").fetchone() == ([1],)


def test_lost_lock_discards_result(
    database_url: str,
    connect_kwargs: dict[str, Any],
    tmp_path: Path,
    conn: psycopg.Connection[Any],
    make_job: MakeJob,
) -> None:
    reg = Registry()
    holder: dict[str, uuid.UUID] = {}

    def steal(payload: Any, ctx: JobContext) -> dict[str, Any]:
        conn.execute("UPDATE job SET locked_by = 'jemand-anders' WHERE id = %s", (holder["id"],))
        return {"x": 1}

    reg.register("steal", steal)
    w = _worker(reg, database_url, connect_kwargs, tmp_path)
    holder["id"] = make_job("steal")
    with psycopg.connect(database_url, autocommit=True, **connect_kwargs) as wc:
        w.drain(wc)
    row = get_job(conn, holder["id"])
    assert row["state"] == "laeuft"
    assert row["locked_by"] == "jemand-anders"
    assert row["result"] is None


def test_heartbeat_runs_during_handler(
    database_url: str,
    connect_kwargs: dict[str, Any],
    tmp_path: Path,
    conn: psycopg.Connection[Any],
    make_job: MakeJob,
) -> None:
    reg = Registry()
    seen: dict[str, Any] = {}
    holder: dict[str, uuid.UUID] = {}

    def slow(payload: Any, ctx: JobContext) -> dict[str, Any]:
        conn.execute(
            "UPDATE job SET locked_at = now() - interval '20 minutes' WHERE id = %s",
            (holder["id"],),
        )
        time.sleep(0.8)
        row = conn.execute(
            "SELECT now() - locked_at < interval '1 minute' FROM job WHERE id = %s",
            (holder["id"],),
        ).fetchone()
        seen["fresh"] = row[0] if row else None
        return {}

    reg.register("slow", slow)
    w = _worker(reg, database_url, connect_kwargs, tmp_path, heartbeat_interval=0.2)
    holder["id"] = make_job("slow")
    with psycopg.connect(database_url, autocommit=True, **connect_kwargs) as wc:
        w.drain(wc)
    assert seen["fresh"] is True
    assert get_job(conn, holder["id"])["state"] == "fertig"


def test_reconnects_after_backends_terminated(
    database_url: str,
    connect_kwargs: dict[str, Any],
    tmp_path: Path,
    conn: psycopg.Connection[Any],
    make_job: MakeJob,
) -> None:
    app = f"sgw_{uuid.uuid4().hex[:8]}"
    worker = _worker(
        make_registry(),
        database_url,
        {**connect_kwargs, "application_name": app},
        tmp_path,
    )
    with running(worker):
        time.sleep(1)
        first = make_job()
        conn.execute("SELECT pg_notify(%s, '')", (worker.channel,))
        assert wait_for(lambda: get_job(conn, first)["state"] == "fertig", timeout=5)
        with psycopg.connect(database_url, autocommit=True) as admin:
            admin.execute(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                "WHERE application_name = %s",
                (app,),
            )
        time.sleep(1.5)
        second = make_job()
        conn.execute("SELECT pg_notify(%s, '')", (worker.channel,))
        assert wait_for(lambda: get_job(conn, second)["state"] == "fertig", timeout=10)


def test_own_running_jobs_are_failed_on_connect(
    worker: Worker, conn: psycopg.Connection[Any], make_job: MakeJob
) -> None:
    """Eigene `laeuft`-Jobs (Claim ohne Handler-Lauf) werden beim Verbinden mit Retry freigegeben;
    fremde bleiben unberührt."""
    mine = make_job(state="laeuft", attempts=1)
    mine_last = make_job(state="laeuft", attempts=3, max_attempts=3)
    foreign = make_job(state="laeuft", attempts=1)
    conn.execute(
        "UPDATE job SET locked_by = %s, locked_at = now() WHERE id IN (%s, %s)",
        (worker.worker_id, mine, mine_last),
    )
    conn.execute(
        "UPDATE job SET locked_by = 'anderer:1', locked_at = now() WHERE id = %s", (foreign,)
    )
    with running(worker):
        assert wait_for(lambda: get_job(conn, mine)["state"] == "wartet")
    row = get_job(conn, mine)
    assert row["error"] == ORPHAN_ERROR
    assert row["run_after"] is not None
    assert row["locked_by"] is None
    assert get_job(conn, mine_last)["state"] == "fehler"
    assert get_job(conn, foreign)["state"] == "laeuft"
    assert get_job(conn, foreign)["locked_by"] == "anderer:1"


def test_result_is_written_on_fresh_connection_when_connection_dies_after_compute(
    database_url: str,
    connect_kwargs: dict[str, Any],
    tmp_path: Path,
    conn: psycopg.Connection[Any],
    make_job: MakeJob,
) -> None:
    reg = Registry()
    runs: list[int] = []

    def long_job(payload: dict[str, Any], ctx: JobContext) -> dict[str, Any]:
        runs.append(1)
        with psycopg.connect(database_url, autocommit=True) as admin:
            admin.execute("SELECT pg_terminate_backend(%s)", (ctx.conn.info.backend_pid,))
        return {"berechnet": True}

    reg.register("long", long_job)
    w = _worker(reg, database_url, connect_kwargs, tmp_path)
    job_id = make_job("long")
    with (
        psycopg.connect(database_url, autocommit=True, **connect_kwargs) as wc,
        pytest.raises(psycopg.OperationalError),
    ):
        w.drain(wc)  # Die Schleife stößt danach auf die tote Verbindung
    row = get_job(conn, job_id)
    assert row["state"] == "fertig"
    assert row["result"] == {"berechnet": True}
    assert row["attempts"] == 1
    assert runs == [1]


def test_startup_waits_for_database(tmp_path: Path) -> None:
    w = Worker("postgres://sg:sg@127.0.0.1:1/none", tmp_path, registry=make_registry())
    thread = threading.Thread(target=w.run, daemon=True)
    thread.start()
    time.sleep(1.5)
    assert thread.is_alive()  # kein Traceback, wartet mit Backoff
    w.stop()
    thread.join(timeout=5)
    assert not thread.is_alive()


def test_wait_wakes_for_due_run_after(
    worker: Worker, conn: psycopg.Connection[Any], make_job: MakeJob
) -> None:
    job_id = make_job()
    conn.execute("UPDATE job SET run_after = now() + interval '1500 milliseconds'")
    with running(worker):
        assert wait_for(lambda: get_job(conn, job_id)["state"] == "fertig", timeout=6)


def test_drain_passes_heavy_hold_to_claim(
    worker: Worker, conn: psycopg.Connection[Any], make_job: MakeJob
) -> None:
    heavy = make_job("transcribe")
    light = make_job("internal.echo")
    worker.heavy_hold = lambda: True
    assert worker.drain(conn) == 1
    assert get_job(conn, light)["state"] == "fertig"
    row = get_job(conn, heavy)
    assert row["state"] == "wartet"
    assert row["attempts"] == 0


def test_drain_without_heavy_hold_claims_heavy(
    worker: Worker, conn: psycopg.Connection[Any], make_job: MakeJob
) -> None:
    assert worker.heavy_hold is None
    heavy = make_job("transcribe")  # kein Handler registriert: wird geholt und scheitert
    assert worker.drain(conn) == 1
    assert get_job(conn, heavy)["attempts"] >= 1
