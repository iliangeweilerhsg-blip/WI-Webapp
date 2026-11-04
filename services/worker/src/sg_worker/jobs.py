"""Job-Warteschlange in PostgreSQL (docs/VERTRAEGE.md §3).

Alle Funktionen arbeiten auf einer übergebenen Verbindung. Sie committen nicht selbst
(außer die Verbindung steht auf autocommit), damit Tests Transaktionen offen halten können.
"""

from __future__ import annotations

from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

Conn = psycopg.Connection[Any]
Job = dict[str, Any]

STUCK_AFTER_MINUTES = 30
BACKOFF_BASE_SECONDS = 30

# Abhängige Jobs abbrechen, deren Abhängigkeit in `fehler`/`abgebrochen` ist (§3).
_CANCEL_DEPENDENTS_SQL = """
UPDATE job SET state = 'abgebrochen',
               error = 'Abhängigkeit ' || (
                 SELECT dj.id::text FROM job dj
                 WHERE dj.id = ANY(job.depends_on) AND dj.state IN ('fehler', 'abgebrochen')
                 ORDER BY dj.created_at, dj.id LIMIT 1
               ) || ' fehlgeschlagen',
               locked_by = NULL, locked_at = NULL, updated_at = now()
WHERE state = 'wartet' AND deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM job dj
              WHERE dj.id = ANY(job.depends_on) AND dj.state IN ('fehler', 'abgebrochen'))
"""

_CLAIM_SQL = """
WITH next AS (
  SELECT j.id FROM job j
  WHERE j.state = 'wartet' AND j.deleted_at IS NULL
    AND (j.run_after IS NULL OR j.run_after <= now())
    AND (SELECT count(*) FROM job dj WHERE dj.id = ANY(j.depends_on) AND dj.state = 'fertig')
        = cardinality(j.depends_on)
  ORDER BY j.priority DESC, j.created_at
  FOR UPDATE OF j SKIP LOCKED
  LIMIT 1
)
UPDATE job SET state = 'laeuft', locked_by = %(worker)s, locked_at = now(),
               attempts = job.attempts + 1, updated_at = now()
FROM next WHERE job.id = next.id
RETURNING job.*
"""


def recover_stuck(conn: Conn) -> int:
    """Setzt abgestürzte Jobs (`laeuft`, Lock älter als 30 min) auf `wartet`. Beim Start."""
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE job SET state = 'wartet', locked_by = NULL, locked_at = NULL, updated_at = now()
            WHERE state = 'laeuft' AND locked_at < now() - make_interval(mins => %s)
            """,
            (STUCK_AFTER_MINUTES,),
        )
        return cur.rowcount


def cancel_failed_dependents(conn: Conn) -> int:
    """Bricht wartende Jobs ab, deren Abhängigkeit gescheitert ist (kaskadierend)."""
    total = 0
    with conn.cursor() as cur:
        while True:
            cur.execute(_CANCEL_DEPENDENTS_SQL)
            if cur.rowcount == 0:
                return total
            total += cur.rowcount


def claim_next(conn: Conn, worker_id: str) -> Job | None:
    """Holt den nächsten fälligen Job (`FOR UPDATE SKIP LOCKED`) und markiert ihn als `laeuft`."""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(_CLAIM_SQL, {"worker": worker_id})
        return cur.fetchone()


def complete(conn: Conn, job_id: Any, result: dict[str, Any] | None) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE job SET state = 'fertig', result = %s, error = NULL,
                           locked_by = NULL, locked_at = NULL, updated_at = now()
            WHERE id = %s
            """,
            (Jsonb(result if result is not None else {}), job_id),
        )


def fail(conn: Conn, job_id: Any, error: str, *, retry: bool = True) -> str:
    """Markiert einen Fehlschlag. Gibt den neuen Zustand zurück (`wartet` oder `fehler`).

    Mit `retry` und `attempts < max_attempts`: zurück auf `wartet`, `run_after` nach
    Backoff `30 s * 2^(attempts-1)`. Sonst `fehler`.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE job SET
              state = CASE WHEN %(retry)s AND attempts < max_attempts THEN 'wartet' ELSE 'fehler' END,
              run_after = CASE WHEN %(retry)s AND attempts < max_attempts
                          THEN now() + make_interval(secs => %(base)s * power(2, attempts - 1))
                          ELSE run_after END,
              error = %(error)s, locked_by = NULL, locked_at = NULL, updated_at = now()
            WHERE id = %(id)s
            RETURNING state
            """,
            {"retry": retry, "base": BACKOFF_BASE_SECONDS, "error": error, "id": job_id},
        )
        row = cur.fetchone()
    return str(row[0]) if row else "fehler"
