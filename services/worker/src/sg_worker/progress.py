"""Session-Fortschritt (docs/VERTRAEGE.md §3), generisch für jeden Job mit `session_id`.

Wird von der Job-Schleife in **derselben Transaktion** aufgerufen, in der ein Job final wird
(`fertig`, endgültig `fehler`, `abgebrochen`; bei Retry auch `wartet`).

Ablauf je Session (`refresh`):

1. Session-Zeile `FOR NO KEY UPDATE` sperren (`lock_session`), **bevor** Jobs gezählt werden.
   Zwei gleichzeitig endende Jobs derselben Session laufen so nacheinander: der zweite sieht
   nach dem Warten (READ COMMITTED, neuer Snapshot je Anweisung) den Abschluss des ersten.
2. `processing[<job_type>]` aus allen Jobs dieses Typs der Session zusammenfassen.
3. Ist die Session `beendet` und kein Job der Session mehr `wartet`/`laeuft`: `verarbeitet`.
   Eine `verarbeitet`e Session ändert ihren Zustand nicht mehr, nur `processing`.
4. `pg_notify('sg_session', <session_id>)`.

Sperrreihenfolge (§16.2): Session zuerst, dann Job-Zeilen, überall. Einzelne Jobs sperren die
Session vor dem Schreiben des Ergebnisses (`lock_session`). Die Sammelwege (abgestürzte Jobs,
eigene verwaiste Jobs, Abbruch über `depends_on`) lesen zuerst die Kandidaten-Sessions ohne
Sperre und arbeiten dann je Session in einer eigenen Transaktion (`run_per_session`).
Alle Funktionen setzen eine offene Transaktion voraus und sind idempotent.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable, Iterable
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

Conn = psycopg.Connection[Any]

#: Fasst alle Jobs eines Typs einer Session zusammen. `abgebrochen` zählt nicht mit, es sei denn,
#: es gibt nur abgebrochene Jobs. Kein Job (alle gelöscht): NULL.
_SUMMARY_SQL = """
SELECT CASE WHEN count(*) = 0 THEN NULL
            WHEN bool_or(state = 'fehler') THEN 'fehler'
            WHEN bool_or(state = 'laeuft') THEN 'laeuft'
            WHEN bool_or(state = 'wartet') THEN 'wartet'
            WHEN bool_or(state = 'fertig') THEN 'fertig'
            ELSE 'abgebrochen' END
FROM job WHERE session_id = %s AND type = %s AND deleted_at IS NULL
"""


def _as_uuid(session_id: Any) -> uuid.UUID | None:
    if isinstance(session_id, uuid.UUID):
        return session_id
    try:
        return uuid.UUID(str(session_id))
    except ValueError:
        return None


def lock_session(conn: Conn, session_id: Any) -> bool:
    """Sperrt die Session-Zeile (`FOR NO KEY UPDATE`). False, wenn es sie nicht (mehr) gibt."""
    sid = _as_uuid(session_id)
    if sid is None:
        return False
    row = conn.execute(
        "SELECT 1 FROM session WHERE id = %s AND deleted_at IS NULL FOR NO KEY UPDATE", (sid,)
    ).fetchone()
    return row is not None


def refresh(conn: Conn, session_id: Any, job_types: Iterable[str]) -> None:
    """Zieht `processing`, ggf. `verarbeitet` und NOTIFY nach (siehe Modul-Doku)."""
    sid = _as_uuid(session_id)
    if sid is None or not lock_session(conn, sid):
        return
    for job_type in sorted(set(job_types)):
        row = conn.execute(_SUMMARY_SQL, (sid, job_type)).fetchone()
        if row is None or row[0] is None:
            continue
        conn.execute(
            "UPDATE session SET processing = COALESCE(processing, '{}'::jsonb) || %s, "
            "updated_at = now() WHERE id = %s",
            (Jsonb({job_type: row[0]}), sid),
        )
    conn.execute(
        "UPDATE session SET state = 'verarbeitet', updated_at = now() "
        "WHERE id = %s AND state = 'beendet' AND NOT EXISTS ("
        "  SELECT 1 FROM job WHERE session_id = %s AND deleted_at IS NULL "
        "  AND state IN ('wartet', 'laeuft'))",
        (sid, sid),
    )
    conn.execute("SELECT pg_notify('sg_session', %s)", (str(sid),))


def run_per_session(
    conn: Conn, sessions: Iterable[Any], step: Callable[[Any], list[dict[str, Any]]]
) -> list[dict[str, Any]]:
    """Führt `step(session_id)` je Session in einer **eigenen Transaktion** aus: Session sperren,
    Jobs ändern (`step` liefert die Zeilen mit `type`), Fortschritt nachziehen. Reihenfolge
    sortiert, Jobs ohne Session (`None`) zuerst. Es hält nie mehr als eine Session gleichzeitig,
    und die Session wird immer vor den Job-Zeilen gesperrt (§16.2).

    `sessions` kommt aus einer Abfrage ohne Sperre (nur Kandidaten); `step` prüft die Bedingung
    unter der Sperre erneut.
    """
    done: list[dict[str, Any]] = []
    for sid in sorted(set(sessions), key=lambda s: (s is not None, str(s))):
        with conn.transaction():
            if sid is not None:
                lock_session(conn, sid)
            rows = step(sid)
            if sid is not None and rows:
                refresh(conn, sid, {r["type"] for r in rows})
            done.extend(rows)
    return done
