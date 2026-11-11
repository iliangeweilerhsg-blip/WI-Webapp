"""Job-Schleife: LISTEN sg_jobs + Fallback-Abfrage, Abholen, Ausführen, Ergebnis schreiben."""

from __future__ import annotations

import logging
import os
import socket
import threading
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import psycopg
from psycopg import sql
from psycopg.pq import TransactionStatus

from . import jobs, progress
from .logging_setup import LOGGER_NAME, job_log_context
from .registry import JobContext, LockLostError, NonRetryableError, Registry, default_registry

DEFAULT_CHANNEL = "sg_jobs"
POLL_INTERVAL_SECONDS = 30.0
HEARTBEAT_INTERVAL_SECONDS = 60.0
RECONNECT_MAX_SECONDS = 30.0
RECOVER_INTERVAL_SECONDS = 60.0
_WAKE_SLICE_SECONDS = 0.5  # So schnell reagiert die Schleife auf stop()

ORPHAN_ERROR = "Verbindung während des Jobs verloren"

_CONNECTION_ERRORS = (psycopg.OperationalError, psycopg.InterfaceError)


@dataclass
class _ProgressContext(JobContext):
    """`JobContext`, dessen `finish` den Session-Fortschritt (§3) in derselben Transaktion
    nachzieht. Die Session wird vor dem Job-Update gesperrt (Sperrreihenfolge §16.2)."""

    job_type: str = ""

    def finish(self, result: dict[str, Any]) -> None:
        if not self.session_id:
            super().finish(result)
            return
        with self.conn.transaction():
            progress.lock_session(self.conn, self.session_id)
            super().finish(result)
            if self.lock_ok:
                progress.refresh(self.conn, self.session_id, [self.job_type])


class Worker:
    def __init__(
        self,
        database_url: str,
        data_dir: Path,
        *,
        registry: Registry | None = None,
        poll_interval: float = POLL_INTERVAL_SECONDS,
        heartbeat_interval: float = HEARTBEAT_INTERVAL_SECONDS,
        stuck_after: float = jobs.STUCK_AFTER_SECONDS,
        recover_interval: float = RECOVER_INTERVAL_SECONDS,
        channel: str = DEFAULT_CHANNEL,
        worker_id: str | None = None,
        connect_kwargs: Mapping[str, Any] | None = None,
        logger: logging.Logger | None = None,
        heavy_hold: Callable[[], bool] | None = None,
    ) -> None:
        self.database_url = database_url
        self.data_dir = data_dir
        self.registry = registry or default_registry
        self.poll_interval = poll_interval
        self.heartbeat_interval = heartbeat_interval
        self.stuck_after = stuck_after
        self.recover_interval = recover_interval
        self._last_recover = 0.0
        self.channel = channel
        self.worker_id = worker_id or f"{socket.gethostname()}:{os.getpid()}"
        self.connect_kwargs = dict(connect_kwargs or {})
        self.log = logger or logging.getLogger(LOGGER_NAME)
        # Haken für weitere Gründe, schwere Jobs zu halten (#204). Standard: keiner
        self.heavy_hold = heavy_hold
        self._stop = threading.Event()
        self._reconnect_delay = 1.0

    def stop(self) -> None:
        """Beendet die Schleife nach dem laufenden Job (signalsicher, idempotent)."""
        self._stop.set()

    @property
    def stopping(self) -> bool:
        return self._stop.is_set()

    def _connect(self) -> psycopg.Connection[Any]:
        return psycopg.connect(self.database_url, autocommit=True, **self.connect_kwargs)

    def run(self) -> None:
        """Läuft bis `stop()`. Verbindungsfehler führen zu Neuaufbau mit Backoff (1 s bis 30 s)."""
        while not self.stopping:
            try:
                self._run_connected()
            except _CONNECTION_ERRORS as exc:
                delay = self._reconnect_delay
                self.log.error(
                    "Datenbankverbindung verloren, neuer Versuch",
                    extra={"error": str(exc), "retry_in": delay},
                )
                self._stop.wait(delay)
                self._reconnect_delay = min(delay * 2, RECONNECT_MAX_SECONDS)
        self.log.info("Worker beendet", extra={"worker": self.worker_id})

    def _run_connected(self) -> None:
        with self._connect() as work, self._connect() as listen:
            listen.execute(sql.SQL("LISTEN {}").format(sql.Identifier(self.channel)))
            self._reconnect_delay = 1.0
            # Beim Verbinden kann kein eigener Job laufen: Locks aus einer abgebrochenen
            # Verbindung (auch Claim ohne Handler-Start, "unbekannter Job-Typ") freigeben.
            orphaned = progress.run_per_session(
                work,
                jobs.own_running_sessions(work, self.worker_id),
                lambda sid: jobs.fail_own_running(work, self.worker_id, ORPHAN_ERROR, sid),
                lambda rows: self._run_failure_hooks(work, rows),
            )
            if orphaned:
                self.log.warning(
                    "Verwaiste eigene Jobs zurückgesetzt", extra={"count": len(orphaned)}
                )
            recovered = self._recover(work)
            self.log.info(
                "Worker verbunden",
                extra={
                    "worker": self.worker_id,
                    "handlers": self.registry.types(),
                    "recovered": recovered,
                },
            )
            while not self.stopping:
                self.drain(work)
                if time.monotonic() - self._last_recover >= self.recover_interval:
                    self._recover(work)
                self._wait(listen, work)

    def _recover(self, conn: psycopg.Connection[Any]) -> int:
        """Abgestürzte Jobs fremder Worker freigeben (Start und danach jede Minute)."""
        self._last_recover = time.monotonic()
        rows = progress.run_per_session(
            conn,
            jobs.stuck_sessions(conn, self.stuck_after),
            lambda sid: jobs.recover_stuck(conn, self.stuck_after, sid),
            lambda done: self._run_failure_hooks(conn, done),
        )
        if rows:
            self.log.warning("Hängende Jobs freigegeben", extra={"count": len(rows)})
        return len(rows)

    def _run_failure_hooks(self, conn: psycopg.Connection[Any], rows: list[jobs.Job]) -> None:
        """Führt für endgültig gescheiterte Jobs (`fehler`) den Hook ihres Typs aus."""
        for row in rows:
            if row.get("state") != "fehler":
                continue
            spec = self.registry.get(row["type"])
            if spec is None or spec.on_final_failure is None:
                continue
            try:
                spec.on_final_failure(conn, row["payload"])
            except Exception:
                self.log.exception("Fehler-Hook fehlgeschlagen", extra={"type": row["type"]})

    def _wait(self, listen: psycopg.Connection[Any], work: psycopg.Connection[Any]) -> None:
        """Wartet auf NOTIFY, höchstens bis zum nächsten `run_after` bzw. `poll_interval`."""
        timeout = min(self.poll_interval, self.recover_interval)
        next_run = jobs.seconds_until_next_run(work)
        if next_run is not None:
            timeout = min(timeout, next_run + 0.05)
        deadline = time.monotonic() + timeout
        while not self.stopping and time.monotonic() < deadline:
            slice_ = min(_WAKE_SLICE_SECONDS, max(deadline - time.monotonic(), 0.01))
            for _ in listen.notifies(timeout=slice_, stop_after=1):
                return

    def drain(self, conn: psycopg.Connection[Any]) -> int:
        """Arbeitet alle fälligen Jobs ab. Gibt die Anzahl bearbeiteter Jobs zurück."""
        count = 0
        while not self.stopping:
            self._cancel_dependents(conn)
            hold = bool(self.heavy_hold and self.heavy_hold())
            job = jobs.claim_next(conn, self.worker_id, hold_heavy=hold)
            if job is None:
                break
            if job["session_id"]:
                # Fortschritt beim Abholen (§18.2): `laeuft` sichtbar machen, eigene Transaktion
                with conn.transaction():
                    progress.refresh(conn, job["session_id"], [job["type"]])
            self._execute(conn, job)
            count += 1
        return count

    def _cancel_dependents(self, conn: psycopg.Connection[Any]) -> None:
        """Bricht Jobs mit gescheiterter Abhängigkeit ab, kaskadierend in Runden. Je Session eine
        Transaktion mit Fortschritt; ohne Kandidaten nur eine einzelne Abfrage."""
        while sessions := jobs.cancel_candidate_sessions(conn):
            cancelled = progress.run_per_session(
                conn, sessions, lambda sid: jobs.cancel_dependents(conn, sid)
            )
            if not cancelled:
                return

    def _finish_failed(
        self, conn: psycopg.Connection[Any], job: jobs.Job, error: str, *, retry: bool = True
    ) -> None:
        session_id = job["session_id"]
        with conn.transaction():
            if session_id:
                progress.lock_session(conn, session_id)
            state = jobs.fail(conn, job["id"], self.worker_id, error, retry=retry)
            if state is not None and session_id:
                progress.refresh(conn, session_id, [job["type"]])
        if state is None:
            self.log.warning("Lock verloren, Fehler verworfen", extra={"error": error})
        elif state == "fehler":
            self._run_failure_hooks(conn, [{**job, "state": state}])

    def _execute(self, conn: psycopg.Connection[Any], job: jobs.Job) -> None:
        job_id = job["id"]
        session_id = str(job["session_id"]) if job["session_id"] else None
        with job_log_context(str(job_id), session_id):
            self.log.info("Job gestartet", extra={"type": job["type"], "attempt": job["attempts"]})
            spec = self.registry.get(job["type"])
            if spec is None:
                self._finish_failed(conn, job, "unbekannter Job-Typ", retry=False)
                self.log.error("unbekannter Job-Typ", extra={"type": job["type"]})
                return
            heartbeat_stop = threading.Event()
            beat = threading.Thread(
                target=self._heartbeat, args=(job_id, heartbeat_stop), daemon=True
            )
            beat.start()
            try:
                payload = spec.validate(job["payload"])
                ctx = _ProgressContext(
                    conn,
                    self.data_dir,
                    self.log,
                    str(job_id),
                    session_id,
                    self.worker_id,
                    job_type=job["type"],
                )
                result = spec.fn(payload, ctx)
                ok = self._complete(conn, ctx, job, result)
                if ok:
                    self.log.info("Job fertig")
                else:
                    self.log.warning("Lock verloren, Ergebnis verworfen")
            except LockLostError:
                self._reset_connection(conn)
                self.log.warning("Lock verloren, nichts committet")
            except NonRetryableError as exc:
                self._reset_connection(conn)
                self._finish_failed(conn, job, str(exc), retry=False)
                self.log.error("Job nicht wiederholbar fehlgeschlagen", extra={"error": str(exc)})
            except Exception as exc:
                error = f"{type(exc).__name__}: {exc}"
                self._reset_connection(conn)
                self._finish_failed(conn, job, error)
                self.log.exception("Job fehlgeschlagen")
            finally:
                heartbeat_stop.set()
                beat.join(timeout=5)

    def _complete(
        self, conn: psycopg.Connection[Any], ctx: JobContext, job: jobs.Job, result: dict[str, Any]
    ) -> bool:
        """Schreibt `fertig`. Ist die Verbindung nach der Berechnung weg, einmal auf frischer
        Verbindung wiederholen, damit lange Jobs nicht komplett neu laufen. Hat der Handler
        `fertig` schon selbst geschrieben (`ctx.finished`), gilt dessen Ergebnis."""
        if ctx.finished:
            self._ensure_clean_connection(conn)
            return ctx.lock_ok
        if not self._connection_lost(conn):
            try:
                self._ensure_clean_connection(conn)
                return self._write_fertig(conn, job, result)
            except _CONNECTION_ERRORS:
                pass
        self.log.warning("Verbindung nach der Berechnung verloren, schreibe Ergebnis neu")
        with self._connect() as fresh:
            return self._write_fertig(fresh, job, result)

    def _write_fertig(
        self, conn: psycopg.Connection[Any], job: jobs.Job, result: dict[str, Any]
    ) -> bool:
        """`fertig` und Session-Fortschritt in einer Transaktion (Session zuerst gesperrt)."""
        session_id = job["session_id"]
        with conn.transaction():
            if session_id:
                progress.lock_session(conn, session_id)
            ok = jobs.complete(conn, job["id"], self.worker_id, result)
            if ok and session_id:
                progress.refresh(conn, session_id, [job["type"]])
            return ok

    @staticmethod
    def _connection_lost(conn: psycopg.Connection[Any]) -> bool:
        status = conn.info.transaction_status
        return conn.closed or conn.broken or status == TransactionStatus.UNKNOWN

    def _heartbeat(self, job_id: Any, stop: threading.Event) -> None:
        """Erneuert `locked_at` auf eigener Verbindung, solange der Handler läuft."""
        conn: psycopg.Connection[Any] | None = None
        try:
            while not stop.wait(self.heartbeat_interval):
                try:
                    if conn is None or conn.closed:
                        conn = self._connect()
                    if not jobs.heartbeat(conn, job_id, self.worker_id):
                        self.log.warning("Heartbeat: Lock verloren", extra={"job": str(job_id)})
                        return
                except _CONNECTION_ERRORS as exc:
                    self.log.warning("Heartbeat fehlgeschlagen", extra={"error": str(exc)})
                    conn = None
        finally:
            if conn is not None and not conn.closed:
                conn.close()

    @staticmethod
    def _reset_connection(conn: psycopg.Connection[Any]) -> None:
        """Rollback und autocommit wiederherstellen (Verbindung bleibt benutzbar)."""
        if conn.closed:
            return
        conn.rollback()
        if not conn.autocommit:
            conn.autocommit = True

    def _ensure_clean_connection(self, conn: psycopg.Connection[Any]) -> None:
        """Nach dem Handler: IDLE und autocommit an, sonst aufräumen und fehlschlagen lassen."""
        if conn.info.transaction_status == TransactionStatus.IDLE and conn.autocommit:
            return
        self._reset_connection(conn)
        raise RuntimeError("Handler hat Transaktion offen gelassen oder autocommit geändert")
