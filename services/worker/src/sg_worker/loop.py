"""Job-Schleife: LISTEN sg_jobs + Fallback-Abfrage, Abholen, Ausführen, Ergebnis schreiben."""

from __future__ import annotations

import logging
import os
import socket
import threading
import time
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import psycopg
from psycopg import sql
from psycopg.pq import TransactionStatus

from . import jobs
from .logging_setup import LOGGER_NAME, job_log_context
from .registry import JobContext, PayloadError, Registry, default_registry

DEFAULT_CHANNEL = "sg_jobs"
POLL_INTERVAL_SECONDS = 30.0
HEARTBEAT_INTERVAL_SECONDS = 60.0
RECONNECT_MAX_SECONDS = 30.0
_WAKE_SLICE_SECONDS = 0.5  # So schnell reagiert die Schleife auf stop()

_CONNECTION_ERRORS = (psycopg.OperationalError, psycopg.InterfaceError)


class Worker:
    def __init__(
        self,
        database_url: str,
        data_dir: Path,
        *,
        registry: Registry | None = None,
        poll_interval: float = POLL_INTERVAL_SECONDS,
        heartbeat_interval: float = HEARTBEAT_INTERVAL_SECONDS,
        channel: str = DEFAULT_CHANNEL,
        worker_id: str | None = None,
        connect_kwargs: Mapping[str, Any] | None = None,
        logger: logging.Logger | None = None,
    ) -> None:
        self.database_url = database_url
        self.data_dir = data_dir
        self.registry = registry or default_registry
        self.poll_interval = poll_interval
        self.heartbeat_interval = heartbeat_interval
        self.channel = channel
        self.worker_id = worker_id or f"{socket.gethostname()}:{os.getpid()}"
        self.connect_kwargs = dict(connect_kwargs or {})
        self.log = logger or logging.getLogger(LOGGER_NAME)
        self._stop = threading.Event()
        self._reconnect_delay = 1.0
        # (job_id, Fehlertext) des Jobs, der bei einem Verbindungsabbruch lief.
        self._orphan: tuple[Any, str] | None = None

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
            if self._orphan is not None:
                job_id, error = self._orphan
                self._orphan = None
                self._finish_failed(work, job_id, error)
            recovered = jobs.recover_stuck(work)
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
                self._wait(listen, work)

    def _wait(self, listen: psycopg.Connection[Any], work: psycopg.Connection[Any]) -> None:
        """Wartet auf NOTIFY, höchstens bis zum nächsten `run_after` bzw. `poll_interval`."""
        timeout = self.poll_interval
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
            jobs.cancel_failed_dependents(conn)
            job = jobs.claim_next(conn, self.worker_id)
            if job is None:
                break
            self._execute(conn, job)
            count += 1
        return count

    def _finish_failed(
        self, conn: psycopg.Connection[Any], job_id: Any, error: str, *, retry: bool = True
    ) -> None:
        state = jobs.fail(conn, job_id, self.worker_id, error, retry=retry)
        if state is None:
            self.log.warning("Lock verloren, Fehler verworfen", extra={"error": error})

    def _execute(self, conn: psycopg.Connection[Any], job: jobs.Job) -> None:
        job_id = job["id"]
        session_id = str(job["session_id"]) if job["session_id"] else None
        with job_log_context(str(job_id), session_id):
            self.log.info("Job gestartet", extra={"type": job["type"], "attempt": job["attempts"]})
            spec = self.registry.get(job["type"])
            if spec is None:
                self._finish_failed(conn, job_id, "unbekannter Job-Typ", retry=False)
                self.log.error("unbekannter Job-Typ", extra={"type": job["type"]})
                return
            self._orphan = (job_id, "Verbindung während des Jobs verloren")
            heartbeat_stop = threading.Event()
            beat = threading.Thread(
                target=self._heartbeat, args=(job_id, heartbeat_stop), daemon=True
            )
            beat.start()
            try:
                payload = spec.validate(job["payload"])
                ctx = JobContext(
                    conn, self.data_dir, self.log, str(job_id), session_id, self.worker_id
                )
                result = spec.fn(payload, ctx)
                self._ensure_clean_connection(conn)
                ok = (
                    ctx.lock_ok
                    if ctx.finished
                    else jobs.complete(conn, job_id, self.worker_id, result)
                )
                if ok:
                    self.log.info("Job fertig")
                else:
                    self.log.warning("Lock verloren, Ergebnis verworfen")
            except PayloadError as exc:
                self._orphan = (job_id, str(exc))
                self._finish_failed(conn, job_id, str(exc), retry=False)
                self.log.error("Payload ungültig", extra={"error": str(exc)})
            except Exception as exc:
                error = f"{type(exc).__name__}: {exc}"
                self._orphan = (job_id, error)
                self._reset_connection(conn)
                self._finish_failed(conn, job_id, error)
                self.log.exception("Job fehlgeschlagen")
            finally:
                heartbeat_stop.set()
                beat.join(timeout=5)
            self._orphan = None

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
