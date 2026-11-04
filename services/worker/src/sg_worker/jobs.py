"""Job-Warteschlange in PostgreSQL (docs/VERTRAEGE.md §3).

Alle Funktionen arbeiten auf einer übergebenen Verbindung. Sie committen nicht selbst
(außer die Verbindung steht auf autocommit), damit Tests Transaktionen offen halten können.

Ergebnis und Fehler schreibt nur der Worker, dessen `locked_by` noch eingetragen ist
(`complete`/`fail` geben sonst `False`/`None` zurück).
"""

from __future__ import annotations

from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

Conn = psycopg.Connection[Any]
Job = dict[str, Any]

# Dreifaches Heartbeat-Intervall (60 s): so lange darf ein Lock höchstens alt sein (VERTRAEGE §3)
STUCK_AFTER_SECONDS = 180.0
BACKOFF_BASE_SECONDS = 30

# Abhängigkeit gescheitert (`fehler`/`abgebrochen`) -> abhängigen Job abbrechen (§3).
_CANCEL_FAILED_SQL = """
UPDATE job SET state = 'abgebrochen',
               error = 'Abhängigkeit ' || (
                 SELECT dj.id::text FROM job dj
                 WHERE dj.id = ANY(job.depends_on) AND dj.deleted_at IS NULL
                   AND dj.state IN ('fehler', 'abgebrochen')
                 ORDER BY dj.created_at, dj.id LIMIT 1
               ) || ' fehlgeschlagen',
               locked_by = NULL, locked_at = NULL, updated_at = now()
WHERE state = 'wartet' AND deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM job dj
              WHERE dj.id = ANY(job.depends_on) AND dj.deleted_at IS NULL
                AND dj.state IN ('fehler', 'abgebrochen'))
"""

# Abhängigkeit existiert nicht oder ist soft-gelöscht -> abhängigen Job abbrechen (§3).
_CANCEL_UNKNOWN_SQL = """
UPDATE job SET state = 'abgebrochen',
               error = 'Abhängigkeit ' || (
                 SELECT d.id::text FROM unnest(job.depends_on) AS d(id)
                 WHERE NOT EXISTS (SELECT 1 FROM job dj WHERE dj.id = d.id AND dj.deleted_at IS NULL)
                 LIMIT 1
               ) || ' unbekannt',
               locked_by = NULL, locked_at = NULL, updated_at = now()
WHERE state = 'wartet' AND deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM unnest(job.depends_on) AS d(id)
              WHERE NOT EXISTS (SELECT 1 FROM job dj WHERE dj.id = d.id AND dj.deleted_at IS NULL))
"""

_CLAIM_SQL = """
WITH next AS (
  SELECT j.id FROM job j
  WHERE j.state = 'wartet' AND j.deleted_at IS NULL
    AND (j.run_after IS NULL OR j.run_after <= now())
    AND NOT EXISTS (
      SELECT 1 FROM unnest(j.depends_on) AS d(id)
      WHERE NOT EXISTS (SELECT 1 FROM job dj
                        WHERE dj.id = d.id AND dj.state = 'fertig' AND dj.deleted_at IS NULL))
  ORDER BY j.priority DESC, j.created_at
  FOR UPDATE OF j SKIP LOCKED
  LIMIT 1
)
UPDATE job SET state = 'laeuft', locked_by = %(worker)s, locked_at = now(),
               attempts = job.attempts + 1, updated_at = now()
FROM next WHERE job.id = next.id
RETURNING job.*
"""


def recover_stuck(conn: Conn, after_seconds: float = STUCK_AFTER_SECONDS) -> list[Job]:
    """Abgestürzte Jobs (`laeuft`, `locked_at` älter als `after_seconds`): mit
    `attempts >= max_attempts` -> `fehler`, sonst zurück auf `wartet`.

    Gibt die betroffenen Jobs (id, type, payload, state) zurück, damit der Aufrufer für endgültig
    gescheiterte die Fehler-Hooks ausführen kann.
    """
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            UPDATE job SET
              state = CASE WHEN attempts >= max_attempts THEN 'fehler' ELSE 'wartet' END,
              error = CASE WHEN attempts >= max_attempts
                      THEN 'Worker abgestürzt oder Lock verloren (zu viele Versuche)' ELSE error END,
              locked_by = NULL, locked_at = NULL, updated_at = now()
            WHERE state = 'laeuft' AND locked_at < now() - make_interval(secs => %s)
            RETURNING id, type, payload, state
            """,
            (after_seconds,),
        )
        return cur.fetchall()


def fail_own_running(conn: Conn, worker_id: str, error: str) -> list[Job]:
    """Lässt alle Jobs, die dieser Worker hält (`laeuft`, `locked_by = worker_id`), mit Retry
    fehlschlagen. Beim (Wieder-)Verbinden aufrufen: Ein eigener Job kann dann nicht mehr laufen,
    der Lock stammt aus einer abgebrochenen Verbindung. Backoff und `fehler` wie bei `fail`.
    """
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            UPDATE job SET
              state = CASE WHEN attempts < max_attempts THEN 'wartet' ELSE 'fehler' END,
              run_after = CASE WHEN attempts < max_attempts
                          THEN now() + make_interval(secs => %(base)s * power(2, attempts - 1))
                          ELSE run_after END,
              error = %(error)s, locked_by = NULL, locked_at = NULL, updated_at = now()
            WHERE state = 'laeuft' AND locked_by = %(worker)s
            RETURNING id, type, payload, state
            """,
            {"base": BACKOFF_BASE_SECONDS, "error": error, "worker": worker_id},
        )
        return cur.fetchall()


def cancel_failed_dependents(conn: Conn) -> int:
    """Bricht wartende Jobs mit gescheiterter oder unbekannter Abhängigkeit ab (kaskadierend)."""
    total = 0
    with conn.cursor() as cur:
        while True:
            changed = 0
            for sql in (_CANCEL_UNKNOWN_SQL, _CANCEL_FAILED_SQL):
                cur.execute(sql)
                changed += cur.rowcount
            if changed == 0:
                return total
            total += changed


def claim_next(conn: Conn, worker_id: str) -> Job | None:
    """Holt den nächsten fälligen Job (`FOR UPDATE SKIP LOCKED`) und markiert ihn als `laeuft`."""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(_CLAIM_SQL, {"worker": worker_id})
        return cur.fetchone()


def seconds_until_next_run(conn: Conn) -> float | None:
    """Sekunden bis zum frühesten künftigen `run_after` eines wartenden Jobs (sonst None)."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT extract(epoch FROM min(run_after) - now()) FROM job
            WHERE state = 'wartet' AND deleted_at IS NULL AND run_after > now()
            """
        )
        row = cur.fetchone()
    return None if row is None or row[0] is None else float(row[0])


def heartbeat(conn: Conn, job_id: Any, worker_id: str) -> bool:
    """Erneuert `locked_at` eines laufenden Jobs. False, wenn der Lock verloren ist."""
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE job SET locked_at = now()
            WHERE id = %s AND state = 'laeuft' AND locked_by = %s
            """,
            (job_id, worker_id),
        )
        return cur.rowcount == 1


def complete(conn: Conn, job_id: Any, worker_id: str, result: dict[str, Any] | None) -> bool:
    """Schreibt `fertig`. False, wenn der Job diesem Worker nicht mehr gehört."""
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE job SET state = 'fertig', result = %s, error = NULL,
                           locked_by = NULL, locked_at = NULL, updated_at = now()
            WHERE id = %s AND state = 'laeuft' AND locked_by = %s
            """,
            (Jsonb(result if result is not None else {}), job_id, worker_id),
        )
        return cur.rowcount == 1


def fail(conn: Conn, job_id: Any, worker_id: str, error: str, *, retry: bool = True) -> str | None:
    """Markiert einen Fehlschlag. Gibt den neuen Zustand zurück (`wartet` oder `fehler`),
    `None`, wenn der Job diesem Worker nicht mehr gehört.

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
            WHERE id = %(id)s AND state = 'laeuft' AND locked_by = %(worker)s
            RETURNING state
            """,
            {
                "retry": retry,
                "base": BACKOFF_BASE_SECONDS,
                "error": error,
                "id": job_id,
                "worker": worker_id,
            },
        )
        row = cur.fetchone()
    return str(row[0]) if row else None
