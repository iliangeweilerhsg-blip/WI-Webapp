"""Abhol-Logik, Retry, Fehlerzustand, hängende Jobs, Abhängigkeiten (VERTRAEGE §3)."""

from __future__ import annotations

import uuid
from typing import Any

import psycopg

from conftest import MakeJob, get_job
from sg_worker import jobs


def test_priority_then_created_at(conn: psycopg.Connection[Any], make_job: MakeJob) -> None:
    old_low = make_job(priority=0, created_at="2026-01-01")
    new_high = make_job(priority=5, created_at="2026-01-03")
    old_high = make_job(priority=5, created_at="2026-01-02")
    order = []
    for _ in range(3):
        job = jobs.claim_next(conn, "w1")
        assert job is not None
        order.append(job["id"])
    assert order == [old_high, new_high, old_low]
    assert jobs.claim_next(conn, "w1") is None


def test_claim_sets_lock_fields_and_attempts(
    conn: psycopg.Connection[Any], make_job: MakeJob
) -> None:
    job_id = make_job()
    job = jobs.claim_next(conn, "host:42")
    assert job is not None
    row = get_job(conn, job_id)
    assert row["state"] == "laeuft"
    assert row["locked_by"] == "host:42"
    assert row["locked_at"] is not None
    assert row["attempts"] == 1


def test_run_after_in_future_is_skipped(conn: psycopg.Connection[Any], make_job: MakeJob) -> None:
    make_job(run_after="2999-01-01")
    due = make_job(run_after="2000-01-01")
    job = jobs.claim_next(conn, "w")
    assert job is not None
    assert job["id"] == due
    assert jobs.claim_next(conn, "w") is None


def test_ignores_deleted_and_non_waiting(conn: psycopg.Connection[Any], make_job: MakeJob) -> None:
    gone = make_job()
    conn.execute("UPDATE job SET deleted_at = now() WHERE id = %s", (gone,))
    make_job(state="fertig")
    make_job(state="laeuft")
    assert jobs.claim_next(conn, "w") is None


def test_depends_on_waits_until_all_done(conn: psycopg.Connection[Any], make_job: MakeJob) -> None:
    dep_a = make_job(state="fertig")
    dep_b = make_job(state="wartet", priority=-10)
    child = make_job(depends_on=[dep_a, dep_b], priority=100)
    first = jobs.claim_next(conn, "w")
    assert first is not None
    assert first["id"] == dep_b  # child ist trotz Priorität noch blockiert
    jobs.complete(conn, dep_b, "w", {})
    second = jobs.claim_next(conn, "w")
    assert second is not None
    assert second["id"] == child


def test_skip_locked_with_two_parallel_connections(
    database_url: str, connect_kwargs: dict[str, Any], make_job: MakeJob
) -> None:
    first_id = make_job(created_at="2026-01-01")
    second_id = make_job(created_at="2026-01-02")
    with (
        psycopg.connect(database_url, **connect_kwargs) as a,
        psycopg.connect(database_url, **connect_kwargs) as b,
    ):
        # Beide Transaktionen bleiben offen: B darf auf A's Sperre nicht warten.
        job_a = jobs.claim_next(a, "a")
        job_b = jobs.claim_next(b, "b")
        assert job_a is not None
        assert job_b is not None
        assert {job_a["id"], job_b["id"]} == {first_id, second_id}
        assert job_a["id"] != job_b["id"]
        assert jobs.claim_next(b, "b") is None
        a.commit()
        b.commit()


def test_fail_retries_with_backoff(conn: psycopg.Connection[Any], make_job: MakeJob) -> None:
    job_id = make_job(max_attempts=3)
    for attempt, expected_seconds in ((1, 30), (2, 60)):
        conn.execute("UPDATE job SET run_after = NULL WHERE id = %s", (job_id,))
        job = jobs.claim_next(conn, "w")
        assert job is not None
        assert job["attempts"] == attempt
        assert jobs.fail(conn, job_id, "w", "kaputt") == "wartet"
        row = get_job(conn, job_id)
        assert row["state"] == "wartet"
        assert row["error"] == "kaputt"
        assert row["locked_by"] is None
        with conn.cursor() as cur:
            cur.execute(
                "SELECT extract(epoch FROM run_after - now()) FROM job WHERE id = %s", (job_id,)
            )
            delta = cur.fetchone()
        assert delta is not None
        assert expected_seconds - 5 < float(delta[0]) <= expected_seconds


def test_fail_after_max_attempts_is_fehler(
    conn: psycopg.Connection[Any], make_job: MakeJob
) -> None:
    job_id = make_job(max_attempts=1)
    assert jobs.claim_next(conn, "w") is not None
    assert jobs.fail(conn, job_id, "w", "endgültig") == "fehler"
    row = get_job(conn, job_id)
    assert row["state"] == "fehler"
    assert row["error"] == "endgültig"
    assert jobs.claim_next(conn, "w") is None


def test_complete_stores_result_and_clears_lock(
    conn: psycopg.Connection[Any], make_job: MakeJob
) -> None:
    job_id = make_job()
    assert jobs.claim_next(conn, "w") is not None
    jobs.complete(conn, job_id, "w", {"slides": 12})
    row = get_job(conn, job_id)
    assert row["state"] == "fertig"
    assert row["result"] == {"slides": 12}
    assert row["locked_by"] is None
    assert row["locked_at"] is None


def test_recover_stuck_only_old_locks(conn: psycopg.Connection[Any], make_job: MakeJob) -> None:
    stuck = make_job(state="laeuft", attempts=1)
    fresh = make_job(state="laeuft", attempts=1)
    conn.execute(
        "UPDATE job SET locked_at = now() - interval '31 minutes', locked_by='x' WHERE id = %s",
        (stuck,),
    )
    conn.execute("UPDATE job SET locked_at = now() - interval '5 minutes' WHERE id = %s", (fresh,))
    assert len(jobs.recover_stuck(conn, 30 * 60)) == 1
    assert get_job(conn, stuck)["state"] == "wartet"
    assert get_job(conn, stuck)["locked_by"] is None
    assert get_job(conn, fresh)["state"] == "laeuft"


def test_failed_dependency_cancels_dependents_cascading(
    conn: psycopg.Connection[Any], make_job: MakeJob
) -> None:
    broken = make_job(state="fehler")
    child = make_job(depends_on=[broken])
    grandchild = make_job(depends_on=[child])
    unrelated = make_job()
    assert jobs.cancel_failed_dependents(conn) == 2
    row = get_job(conn, child)
    assert row["state"] == "abgebrochen"
    assert row["error"] == f"Abhängigkeit {broken} fehlgeschlagen"
    row = get_job(conn, grandchild)
    assert row["state"] == "abgebrochen"
    assert row["error"] == f"Abhängigkeit {child} fehlgeschlagen"
    assert get_job(conn, unrelated)["state"] == "wartet"


def test_cancelled_dependency_also_cancels(
    conn: psycopg.Connection[Any], make_job: MakeJob
) -> None:
    cancelled = make_job(state="abgebrochen")
    child = make_job(depends_on=[cancelled])
    jobs.cancel_failed_dependents(conn)
    row = get_job(conn, child)
    assert row["state"] == "abgebrochen"
    assert row["error"] == f"Abhängigkeit {cancelled} fehlgeschlagen"


def test_duplicate_depends_on_ids(conn: psycopg.Connection[Any], make_job: MakeJob) -> None:
    dep = make_job(state="fertig")
    child = make_job(depends_on=[dep, dep])
    job = jobs.claim_next(conn, "w")
    assert job is not None
    assert job["id"] == child


def test_missing_dependency_cancels(conn: psycopg.Connection[Any], make_job: MakeJob) -> None:
    ghost = uuid.uuid4()
    child = make_job(depends_on=[ghost])
    jobs.cancel_failed_dependents(conn)
    row = get_job(conn, child)
    assert row["state"] == "abgebrochen"
    assert row["error"] == f"Abhängigkeit {ghost} unbekannt"


def test_soft_deleted_dependency_cancels(conn: psycopg.Connection[Any], make_job: MakeJob) -> None:
    dep = make_job(state="fertig")
    conn.execute("UPDATE job SET deleted_at = now() WHERE id = %s", (dep,))
    child = make_job(depends_on=[dep])
    jobs.cancel_failed_dependents(conn)
    row = get_job(conn, child)
    assert row["state"] == "abgebrochen"
    assert row["error"] == f"Abhängigkeit {dep} unbekannt"


def test_complete_and_fail_require_lock_owner(
    conn: psycopg.Connection[Any], make_job: MakeJob
) -> None:
    job_id = make_job()
    assert jobs.claim_next(conn, "alt") is not None
    assert jobs.complete(conn, job_id, "anderer", {}) is False
    assert jobs.fail(conn, job_id, "anderer", "x") is None
    assert get_job(conn, job_id)["state"] == "laeuft"
    assert jobs.complete(conn, job_id, "alt", {}) is True
    assert jobs.fail(conn, job_id, "alt", "x") is None
    assert get_job(conn, job_id)["state"] == "fertig"


def test_heartbeat_refreshes_locked_at(conn: psycopg.Connection[Any], make_job: MakeJob) -> None:
    job_id = make_job()
    assert jobs.claim_next(conn, "w") is not None
    conn.execute(
        "UPDATE job SET locked_at = now() - interval '10 minutes' WHERE id = %s", (job_id,)
    )
    assert jobs.heartbeat(conn, job_id, "w") is True
    row = conn.execute(
        "SELECT now() - locked_at < interval '1 minute' FROM job WHERE id = %s", (job_id,)
    ).fetchone()
    assert row is not None
    assert row[0] is True
    assert jobs.heartbeat(conn, job_id, "anderer") is False


def test_seconds_until_next_run(conn: psycopg.Connection[Any], make_job: MakeJob) -> None:
    assert jobs.seconds_until_next_run(conn) is None
    make_job(run_after="2999-01-01")
    conn.execute("UPDATE job SET run_after = now() + interval '20 seconds'")
    secs = jobs.seconds_until_next_run(conn)
    assert secs is not None
    assert 10 < secs <= 20
