"""Hilfe für `e2e-inbox-worker.test.ts`: arbeitet alle fälligen Jobs mit dem echten Worker-Code ab.

Aufruf: `uv run --project services/worker python drain_worker.py <DATABASE_URL> <Datenordner>`.
Es läuft dieselbe Job-Schleife (`Worker.drain`: abholen, Abhängigkeiten, Handler, Ergebnis) und
dieselben Handler wie im Betrieb. Nur der Rahmen fehlt (LISTEN, Signale, Loopback-Server). Die KI
ist der deterministische Fake (`provider = fake`), der Embedder ebenfalls. Kein Netz, kein
Schlüssel.
Ausgabe: die Anzahl der bearbeiteten Jobs.
"""

from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path

import psycopg

import sg_worker.handlers  # noqa: F401  (registriert die Handler)
from sg_worker.ai import llm
from sg_worker.config import LlmSettings
from sg_worker.loop import Worker
from sg_worker.registry import default_registry


def main() -> int:
    database_url, data_dir = sys.argv[1], Path(sys.argv[2])
    os.environ["SG_EMBEDDER"] = "fake"
    llm.configure(LlmSettings(provider="fake"))
    worker = Worker(
        database_url,
        data_dir,
        registry=default_registry,
        channel=f"sg_jobs_{uuid.uuid4().hex[:8]}",
        worker_id="e2e-inbox",
    )
    with psycopg.connect(database_url, autocommit=True) as conn:
        done = worker.drain(conn)
    print(done)
    return 0


if __name__ == "__main__":
    sys.exit(main())
