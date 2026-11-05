"""Session-Fortschritt in der Job-Schleife (VERTRAEGE §3, #75)."""

from __future__ import annotations

import threading
import time
import uuid
from collections.abc import Callable
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
    """Zwei Aufnahmen derselben Session (gleicher Jobtyp) enden gleichzeitig (#73). Ohne Sperre
    der Session vor dem Zählen sähe jeder Abschluss den anderen noch als `laeuft`
    (`processing = laeuft`) und die Session bliebe `beendet`."""
    add_session(conn)
    ids = {"slow": add_job(conn, "t"), "fast": add_job(conn, "t")}
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
        reg.register("t", fn)
        w = Worker(
            database_url,
            tmp_path,
            registry=reg,
            worker_id=name,
            channel=f"sg_jobs_{uuid.uuid4().hex[:8]}",
            connect_kwargs=connect_kwargs,
        )
        with psycopg.connect(database_url, autocommit=True, **connect_kwargs) as c:
            w._execute(c, get_job(conn, ids[name]))

    threads = [
        threading.Thread(target=run, args=("slow", slow)),
        threading.Thread(target=run, args=("fast", fast)),
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join(30)
        assert not t.is_alive()
    assert session_row(conn) == ("verarbeitet", {"t": "fertig"})


# ---------- Sammelwege gegen den Core-Stopp: kein Deadlock ----------


def _wait_until_lock_wait(
    watcher: psycopg.Connection[Any], pids: list[int], timeout: float = 15.0
) -> None:
    """Wartet, bis die Worker-Verbindung auf eine Sperre wartet (`pg_stat_activity`)."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if pids:
            row = watcher.execute(
                "SELECT 1 FROM pg_stat_activity WHERE pid = %s AND wait_event_type = 'Lock'",
                (pids[0],),
            ).fetchone()
            if row is not None:
                return
        time.sleep(0.02)
    raise AssertionError("Worker wartet nicht auf eine Sperre")


def _core_stop_vs_worker(
    database_url: str,
    connect_kwargs: dict[str, Any],
    conn: psycopg.Connection[Any],
    worker_call: Callable[[psycopg.Connection[Any]], None],
) -> None:
    """Der Core hält die Session (`FOR NO KEY UPDATE`) und liest danach den Job `FOR UPDATE`
    (ensureFinalizeOnStop). Der Worker-Sammelweg läuft währenddessen. Hielte der Worker erst die
    Job-Zeile und wollte dann die Session, gäbe es einen Deadlock (40P01), und der Core könnte das
    Opfer sein."""
    result: dict[str, str] = {}
    worker_pid: list[int] = []

    def worker() -> None:
        try:
            with psycopg.connect(database_url, autocommit=True, **connect_kwargs) as wc:
                wc.execute("SET deadlock_timeout = '300ms'")
                worker_pid.append(wc.info.backend_pid)
                worker_call(wc)
            result["worker"] = "ok"
        except psycopg.errors.DeadlockDetected:
            result["worker"] = "deadlock"

    with psycopg.connect(database_url, autocommit=True, **connect_kwargs) as core:
        core.execute("SET deadlock_timeout = '300ms'")
        core.execute("BEGIN")
        core.execute("SELECT 1 FROM session WHERE id = %s FOR NO KEY UPDATE", (SID,))
        thread = threading.Thread(target=worker)
        thread.start()
        _wait_until_lock_wait(core, worker_pid)  # Worker wartet auf die Session
        try:
            core.execute("SELECT id FROM job WHERE session_id = %s FOR UPDATE", (SID,)).fetchall()
            core.execute("UPDATE session SET updated_at = now() WHERE id = %s", (SID,))
            core.execute("COMMIT")
            result["core"] = "ok"
        except psycopg.errors.DeadlockDetected:
            core.execute("ROLLBACK")
            result["core"] = "deadlock"
        thread.join(30)
        assert not thread.is_alive()
    assert result == {"core": "ok", "worker": "ok"}


def test_recover_stuck_does_not_deadlock_with_core_stop(
    database_url: str,
    connect_kwargs: dict[str, Any],
    worker: Worker,
    conn: psycopg.Connection[Any],
) -> None:
    add_session(conn)
    job = add_job(conn, state="laeuft", max_attempts=1)
    conn.execute(
        "UPDATE job SET attempts = 1, locked_by = 'tot', locked_at = now() - interval '1 hour' "
        "WHERE id = %s",
        (job,),
    )
    _core_stop_vs_worker(database_url, connect_kwargs, conn, lambda c: worker._recover(c))
    assert session_row(conn) == ("verarbeitet", {"transcribe": "fehler"})


def test_fail_own_running_does_not_deadlock_with_core_stop(
    database_url: str, connect_kwargs: dict[str, Any], conn: psycopg.Connection[Any]
) -> None:
    add_session(conn)
    job = add_job(conn, state="laeuft", max_attempts=1)
    conn.execute(
        "UPDATE job SET attempts = 1, locked_by = 'ich', locked_at = now() WHERE id = %s", (job,)
    )

    def call(c: psycopg.Connection[Any]) -> None:
        progress.run_per_session(
            c,
            jobs.own_running_sessions(c, "ich"),
            lambda sid: jobs.fail_own_running(c, "ich", "weg", sid),
        )

    _core_stop_vs_worker(database_url, connect_kwargs, conn, call)
    assert session_row(conn) == ("verarbeitet", {"transcribe": "fehler"})


def test_cancel_dependents_does_not_deadlock_with_core_stop(
    database_url: str,
    connect_kwargs: dict[str, Any],
    worker: Worker,
    conn: psycopg.Connection[Any],
) -> None:
    add_session(conn)
    dep = add_job(conn, state="fehler")
    add_job(conn, "summarize", depends_on=[dep])
    _core_stop_vs_worker(database_url, connect_kwargs, conn, lambda c: worker._cancel_dependents(c))
    assert session_row(conn) == ("verarbeitet", {"summarize": "abgebrochen"})


def test_cascading_cancel_over_rounds(worker: Worker, conn: psycopg.Connection[Any]) -> None:
    add_session(conn)
    first = add_job(conn, "transcribe", state="fehler")
    second = add_job(conn, "summarize", depends_on=[first])
    add_job(conn, "other", depends_on=[second])
    worker._cancel_dependents(conn)
    states = conn.execute("SELECT type, state FROM job ORDER BY type").fetchall()
    assert states == [
        ("other", "abgebrochen"),
        ("summarize", "abgebrochen"),
        ("transcribe", "fehler"),
    ]


def test_no_transaction_for_empty_drain_round(
    worker: Worker, conn: psycopg.Connection[Any]
) -> None:
    worker._cancel_dependents(conn)  # nichts zu tun: kein Fehler, Verbindung bleibt idle
    assert conn.info.transaction_status == psycopg.pq.TransactionStatus.IDLE


def test_cancel_dependents_returns_rows(conn: psycopg.Connection[Any]) -> None:
    add_session(conn)
    dep = add_job(conn, state="fehler")
    add_job(conn, "summarize", depends_on=[dep])
    rows = jobs.cancel_dependents(conn)
    assert [(r["type"], r["session_id"]) for r in rows] == [("summarize", SID)]


def test_failure_hooks_run_per_session_right_after_commit(
    database_url: str,
    connect_kwargs: dict[str, Any],
    tmp_path: Path,
    conn: psycopg.Connection[Any],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Wirft die zweite Session, sind die Hooks der ersten (schon committeten) trotzdem gelaufen."""
    seen: list[dict[str, Any]] = []
    reg = Registry()
    reg.register("transcribe", lambda p, c: {}, None, lambda c, payload: seen.append(payload))
    w = Worker(
        database_url,
        tmp_path,
        registry=reg,
        channel=f"sg_jobs_{uuid.uuid4().hex[:8]}",
        connect_kwargs=connect_kwargs,
    )
    first, second = sorted([uuid.uuid4(), uuid.uuid4()], key=str)
    for n, sid in enumerate((first, second)):
        conn.execute(
            "INSERT INTO session (id, user_id, state) VALUES (%s, %s, 'beendet')", (sid, USER_ID)
        )
        conn.execute(
            "INSERT INTO job (id, user_id, type, payload, state, session_id, attempts, "
            "max_attempts, locked_by, locked_at) VALUES (%s, %s, 'transcribe', %s::jsonb, "
            "'laeuft', %s, 1, 1, 'tot', now() - interval '1 hour')",
            (uuid.uuid4(), USER_ID, f'{{"n": {n}}}', sid),
        )
    real = jobs.recover_stuck

    def flaky(c: Any, after: float, sid: Any) -> Any:
        if sid == second:
            raise psycopg.OperationalError("Verbindung weg")
        return real(c, after, sid)

    monkeypatch.setattr(jobs, "recover_stuck", flaky)
    with pytest.raises(psycopg.OperationalError):
        w._recover(conn)
    assert seen == [{"n": 0}]


def test_updated_at_stays_monotonic_when_worker_waits_for_core_stop(
    database_url: str, connect_kwargs: dict[str, Any], conn: psycopg.Connection[Any]
) -> None:
    """Die Worker-Transaktion beginnt, während der Stopp die Session hält, und schreibt danach.
    Mit `now()` (Transaktionsbeginn) läge `updated_at` vor dem des Stopps, und Web-Clients
    verwürfen `session.updated` mit `verarbeitet` (Prüfung auf `<`)."""
    add_session(conn)
    add_job(conn, state="fertig")
    worker_pid: list[int] = []
    errors: list[BaseException] = []

    def worker() -> None:
        try:
            with psycopg.connect(database_url, autocommit=True, **connect_kwargs) as wc:
                worker_pid.append(wc.info.backend_pid)
                with wc.transaction():
                    progress.refresh(wc, SID, ["transcribe"])
        except BaseException as error:  # noqa: BLE001
            errors.append(error)

    with psycopg.connect(database_url, autocommit=True, **connect_kwargs) as core:
        core.execute("BEGIN")
        core.execute("SELECT 1 FROM session WHERE id = %s FOR NO KEY UPDATE", (SID,))
        thread = threading.Thread(target=worker)
        thread.start()
        _wait_until_lock_wait(core, worker_pid)
        time.sleep(0.3)  # der Worker wartet nachweislich eine Weile
        row = core.execute(
            "UPDATE session SET updated_at = clock_timestamp() WHERE id = %s RETURNING updated_at",
            (SID,),
        ).fetchone()
        assert row is not None
        core_updated_at = row[0]
        core.execute("COMMIT")
        thread.join(30)
    assert not thread.is_alive() and errors == []
    final = conn.execute("SELECT state, updated_at FROM session WHERE id = %s", (SID,)).fetchone()
    assert final is not None
    assert final[0] == "verarbeitet"
    assert final[1] > core_updated_at
