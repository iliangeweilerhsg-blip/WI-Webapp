"""Test-Fixtures. DB-Tests brauchen `DATABASE_URL` und werden sonst übersprungen."""

from __future__ import annotations

import json
import os
import uuid
from collections.abc import Callable, Iterator
from typing import Any

import psycopg
import pytest

# Genau das SQL aus docs/VERTRAEGE.md §3 (der Core besitzt die Tabelle).
JOB_TABLE_SQL = """
CREATE TABLE job (
  id            uuid PRIMARY KEY,
  user_id       uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  type          text NOT NULL,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  state         text NOT NULL DEFAULT 'wartet'
                CHECK (state IN ('wartet','laeuft','fertig','fehler','abgebrochen')),
  priority      integer NOT NULL DEFAULT 0,
  attempts      integer NOT NULL DEFAULT 0,
  max_attempts  integer NOT NULL DEFAULT 3,
  depends_on    uuid[] NOT NULL DEFAULT '{}',
  session_id    uuid,
  locked_by     text,
  locked_at     timestamptz,
  error         text,
  result        jsonb,
  run_after     timestamptz
);
CREATE INDEX job_pick_idx ON job (priority DESC, created_at) WHERE state = 'wartet' AND deleted_at IS NULL;
"""

USER_ID = uuid.UUID("00000000-0000-7000-8000-000000000001")


@pytest.fixture
def database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        pytest.skip("DATABASE_URL nicht gesetzt")
    return url


@pytest.fixture
def schema(database_url: str) -> Iterator[str]:
    """Eigenes Schema pro Test mit der `job`-Tabelle nach VERTRAEGE §3."""
    name = f"t_{uuid.uuid4().hex[:12]}"
    with psycopg.connect(database_url, autocommit=True) as admin:
        admin.execute(f'CREATE SCHEMA "{name}"')
        admin.execute(f'SET search_path TO "{name}"')
        admin.execute(JOB_TABLE_SQL)
        try:
            yield name
        finally:
            admin.execute(f'DROP SCHEMA "{name}" CASCADE')


@pytest.fixture
def connect_kwargs(schema: str) -> dict[str, Any]:
    return {"options": f"-c search_path={schema}"}


@pytest.fixture
def conn(database_url: str, connect_kwargs: dict[str, Any]) -> Iterator[psycopg.Connection[Any]]:
    with psycopg.connect(database_url, autocommit=True, **connect_kwargs) as c:
        yield c


MakeJob = Callable[..., uuid.UUID]


@pytest.fixture
def make_job(conn: psycopg.Connection[Any]) -> MakeJob:
    def _make(
        type: str = "internal.echo",
        *,
        payload: dict[str, Any] | None = None,
        state: str = "wartet",
        priority: int = 0,
        attempts: int = 0,
        max_attempts: int = 3,
        depends_on: list[uuid.UUID] | None = None,
        run_after: str | None = None,
        locked_at: str | None = None,
        created_at: str | None = None,
        id: uuid.UUID | None = None,
    ) -> uuid.UUID:
        job_id = id or uuid.uuid4()
        conn.execute(
            """
            INSERT INTO job (id, user_id, type, payload, state, priority, attempts, max_attempts,
                             depends_on, run_after, locked_at, created_at)
            VALUES (%s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s,
                    %s::timestamptz, %s::timestamptz, COALESCE(%s::timestamptz, now()))
            """,
            (
                job_id,
                USER_ID,
                type,
                json.dumps(payload or {}),
                state,
                priority,
                attempts,
                max_attempts,
                depends_on or [],
                run_after,
                locked_at,
                created_at,
            ),
        )
        return job_id

    return _make


def get_job(conn: psycopg.Connection[Any], job_id: uuid.UUID) -> dict[str, Any]:
    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM job WHERE id = %s", (job_id,))
        row = cur.fetchone()
    assert row is not None
    return row
