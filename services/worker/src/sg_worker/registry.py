"""Handler-Registry: `@handler("pdf.ingest", payload_type=PdfIngestPayload)`."""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import psycopg
from pydantic import TypeAdapter, ValidationError

from . import jobs


class PayloadError(Exception):
    """Das Payload passt nicht zum Schema des Job-Typs. Retry wäre sinnlos."""


@dataclass
class JobContext:
    """Was ein Handler zusätzlich zum Payload bekommt.

    **Handler müssen idempotent sein**: Nach Verbindungsabbruch, Lock-Verlust oder Retry
    läuft derselbe Job erneut.

    **Atomar abschließen:** Schreibzugriffe auf Zieltabellen und `fertig` gehören in eine
    Transaktion::

        with ctx.conn.transaction():
            ...  # Zieltabellen schreiben
            ctx.finish({"slides": 12})
        return {"slides": 12}

    Ohne `finish` schreibt der Worker `fertig` nach der Rückkehr des Handlers. Lässt ein
    Handler eine Transaktion offen oder schaltet autocommit ab, rollt der Worker zurück
    und lässt den Job fehlschlagen.
    """

    conn: psycopg.Connection[Any]
    data_dir: Path
    logger: logging.Logger
    job_id: str
    session_id: str | None
    worker_id: str = ""
    finished: bool = False
    lock_ok: bool = True

    def finish(self, result: dict[str, Any]) -> None:
        """Schreibt `fertig` auf `ctx.conn` (z. B. innerhalb der Handler-Transaktion)."""
        self.lock_ok = jobs.complete(self.conn, self.job_id, self.worker_id, result)
        self.finished = True


HandlerFn = Callable[[Any, JobContext], dict[str, Any]]


@dataclass(frozen=True)
class HandlerSpec:
    job_type: str
    fn: HandlerFn
    adapter: TypeAdapter[Any] | None

    def validate(self, payload: Any) -> Any:
        if self.adapter is None:
            return payload
        try:
            return self.adapter.validate_python(payload)
        except ValidationError as exc:
            first = exc.errors()[0] if exc.errors() else None
            where = ".".join(str(x) for x in first["loc"]) if first else ""
            what = first["msg"] if first else "ungültig"
            raise PayloadError(f"ungültiges Payload: {where} {what}".strip()) from exc


class Registry:
    def __init__(self) -> None:
        self._handlers: dict[str, HandlerSpec] = {}

    def register(self, job_type: str, fn: HandlerFn, payload_type: Any = None) -> None:
        if job_type in self._handlers:
            raise ValueError(f"Handler für {job_type} ist schon registriert")
        adapter = None if payload_type is None else TypeAdapter(payload_type)
        self._handlers[job_type] = HandlerSpec(job_type, fn, adapter)

    def get(self, job_type: str) -> HandlerSpec | None:
        return self._handlers.get(job_type)

    def types(self) -> list[str]:
        return sorted(self._handlers)


# Globale Standard-Registry, in die `@handler` einträgt.
default_registry = Registry()


def handler[F: HandlerFn](
    job_type: str, payload_type: Any = None, registry: Registry | None = None
) -> Callable[[F], F]:
    """Dekorator: registriert `fn(payload, ctx) -> dict` für `job_type`.

    `payload_type` ist ein Pydantic-Typ oder Alias (z. B. `PdfIngestPayload` aus
    `sg_schemas.models`). Ohne Angabe bekommt der Handler das rohe Dict.
    """

    def decorate(fn: F) -> F:
        (registry or default_registry).register(job_type, fn, payload_type)
        return fn

    return decorate
