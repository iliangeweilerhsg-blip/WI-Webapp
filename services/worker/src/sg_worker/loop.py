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

from . import jobs
from .logging_setup import LOGGER_NAME, job_log_context
from .registry import JobContext, PayloadError, Registry, default_registry

DEFAULT_CHANNEL = "sg_jobs"
POLL_INTERVAL_SECONDS = 30.0
_WAKE_SLICE_SECONDS = 0.5  # So schnell reagiert die Schleife auf stop()


class Worker:
    def __init__(
        self,
        database_url: str,
        data_dir: Path,
        *,
        registry: Registry | None = None,
        poll_interval: float = POLL_INTERVAL_SECONDS,
        channel: str = DEFAULT_CHANNEL,
        worker_id: str | None = None,
        connect_kwargs: Mapping[str, Any] | None = None,
        logger: logging.Logger | None = None,
    ) -> None:
        self.database_url = database_url
        self.data_dir = data_dir
        self.registry = registry or default_registry
        self.poll_interval = poll_interval
        self.channel = channel
        self.worker_id = worker_id or f"{socket.gethostname()}:{os.getpid()}"
        self.connect_kwargs = dict(connect_kwargs or {})
        self.log = logger or logging.getLogger(LOGGER_NAME)
        self._stop = threading.Event()

    def stop(self) -> None:
        """Beendet die Schleife nach dem laufenden Job (signalsicher)."""
        self._stop.set()

    @property
    def stopping(self) -> bool:
        return self._stop.is_set()

    def _connect(self) -> psycopg.Connection[Any]:
        return psycopg.connect(self.database_url, autocommit=True, **self.connect_kwargs)

    def run(self) -> None:
        with self._connect() as work, self._connect() as listen:
            listen.execute(sql.SQL("LISTEN {}").format(sql.Identifier(self.channel)))
            recovered = jobs.recover_stuck(work)
            self.log.info(
                "Worker gestartet",
                extra={
                    "worker": self.worker_id,
                    "handlers": self.registry.types(),
                    "recovered": recovered,
                },
            )
            while not self.stopping:
                self.drain(work)
                self._wait(listen)
            self.log.info("Worker beendet", extra={"worker": self.worker_id})

    def _wait(self, listen: psycopg.Connection[Any]) -> None:
        """Wartet auf NOTIFY, höchstens `poll_interval` Sekunden (oder bis stop())."""
        deadline = time.monotonic() + self.poll_interval
        while not self.stopping and time.monotonic() < deadline:
            for _ in listen.notifies(timeout=_WAKE_SLICE_SECONDS, stop_after=1):
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

    def _execute(self, conn: psycopg.Connection[Any], job: jobs.Job) -> None:
        job_id = job["id"]
        session_id = str(job["session_id"]) if job["session_id"] else None
        with job_log_context(str(job_id), session_id):
            self.log.info(
                "Job gestartet",
                extra={"type": job["type"], "attempt": job["attempts"]},
            )
            spec = self.registry.get(job["type"])
            if spec is None:
                jobs.fail(conn, job_id, "unbekannter Job-Typ", retry=False)
                self.log.error("unbekannter Job-Typ", extra={"type": job["type"]})
                return
            try:
                payload = spec.validate(job["payload"])
                ctx = JobContext(conn, self.data_dir, self.log, str(job_id), session_id)
                result = spec.fn(payload, ctx)
            except PayloadError as exc:
                jobs.fail(conn, job_id, str(exc), retry=False)
                self.log.error("Payload ungültig", extra={"error": str(exc)})
            except Exception as exc:
                self._recover_connection(conn)
                state = jobs.fail(conn, job_id, f"{type(exc).__name__}: {exc}")
                self.log.exception("Job fehlgeschlagen", extra={"next_state": state})
            else:
                jobs.complete(conn, job_id, result)
                self.log.info("Job fertig")

    @staticmethod
    def _recover_connection(conn: psycopg.Connection[Any]) -> None:
        """Räumt eine möglicherweise im Fehlerzustand hängende Transaktion auf."""
        if not conn.closed:
            conn.rollback()
