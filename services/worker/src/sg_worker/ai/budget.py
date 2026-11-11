"""Kosten und Monatsbudget der Cloud-KI (VERTRAEGE §20.5, F-DAT-05).

- **Vor jedem Aufruf** (auch vor dem Nachfordern) prüft `CostMeter.check`, ob die Summe des
  Monats das Budget (`setting` Schlüssel `ai`, Feld `monthly_budget_eur`, fehlend oder ungültig: 10)
  erreicht hat. `monthly_budget_eur = 0` schaltet die Cloud-KI damit ganz ab.
- **Direkt nach jedem Aufruf** schreibt `CostMeter.record` eine `cost_entry` in einer **eigenen**
  Transaktion, auch wenn der Job danach scheitert.
- **Monat** = Kalendermonat in Ortszeit. Core und Worker nutzen genau `MONTH_SPENT_SQL`, `<tz>` ist
  der IANA-Name der Ortszeit des Prozesses (`TZ`, sonst `/etc/localtime`, sonst UTC).
"""

from __future__ import annotations

import logging
import math
import os
import uuid
from collections.abc import Mapping
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import psycopg

from ..uuid7 import uuid7
from .interfaces import CallCost

log = logging.getLogger(__name__)

Conn = psycopg.Connection[Any]

DEFAULT_MONTHLY_BUDGET_EUR = 10.0
MAX_MONTHLY_BUDGET_EUR = 1000.0
MAX_REQUEST_ID = 200

#: Verbindlich für Core und Worker (§20.5)
MONTH_SPENT_SQL = """
SELECT coalesce(sum(cost_estimate_eur), 0)::float8 FROM cost_entry
WHERE deleted_at IS NULL
  AND created_at >= date_trunc('month', now() AT TIME ZONE %(tz)s) AT TIME ZONE %(tz)s
"""


class BudgetReached(Exception):
    """Das Monatsbudget ist erreicht (`fehler` sofort, `Monatsbudget erreicht`)."""


def _valid_zone(name: str) -> bool:
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return False
    return True


def local_tz_name(environ: Mapping[str, str] | None = None) -> str:
    """IANA-Name der Ortszeit: `TZ` (ohne führenden `:`), sonst das Ziel von `/etc/localtime`,
    sonst `UTC`. Ein ungültiger Name zählt als nicht gesetzt."""
    env = os.environ if environ is None else environ
    raw = (env.get("TZ") or "").strip().removeprefix(":")
    if raw and _valid_zone(raw):
        return raw
    try:
        target = str(Path("/etc/localtime").resolve())
    except OSError:
        target = ""
    if "zoneinfo/" in target:
        name = target.split("zoneinfo/", 1)[1]
        if _valid_zone(name):
            return name
    return "UTC"


def monthly_budget_eur(conn: Conn) -> float:
    """`ai.monthly_budget_eur` aus `setting` (0 bis 1000). Fehlend oder ungültig: 10."""
    row = conn.execute(
        "SELECT value FROM setting WHERE key = 'ai' AND deleted_at IS NULL"
    ).fetchone()
    value = row[0].get("monthly_budget_eur") if row and isinstance(row[0], dict) else None
    if isinstance(value, bool) or not isinstance(value, int | float):
        return DEFAULT_MONTHLY_BUDGET_EUR
    number = float(value)
    if not math.isfinite(number) or not 0 <= number <= MAX_MONTHLY_BUDGET_EUR:
        return DEFAULT_MONTHLY_BUDGET_EUR
    return number


def month_spent_eur(conn: Conn, tz: str | None = None) -> float:
    row = conn.execute(MONTH_SPENT_SQL, {"tz": tz or local_tz_name()}).fetchone()
    return float(row[0]) if row else 0.0


class CostMeter:
    """Budgetprüfung und Kostenbuchung für einen Job. Läuft auf der Verbindung des Jobs, aber nie
    innerhalb einer Transaktion des Handlers (KI-Aufrufe liegen außerhalb, §20.3)."""

    def __init__(
        self,
        conn: Conn,
        *,
        user_id: Any,
        job_id: str | None,
        session_id: str | None,
        task: str,
        tz: str | None = None,
    ) -> None:
        self.conn = conn
        self.user_id = user_id
        self.job_id = job_id
        self.session_id = session_id
        self.task = task
        self.tz = tz
        self.total_eur = 0.0
        self.calls = 0

    def check(self) -> None:
        """`BudgetReached`, wenn die Summe des Monats das Budget erreicht hat."""
        budget = monthly_budget_eur(self.conn)
        spent = month_spent_eur(self.conn, self.tz)
        if spent >= budget:
            raise BudgetReached(f"{spent:.2f} von {budget:.2f} EUR")

    def record(self, cost: CallCost) -> None:
        """Eine `cost_entry`, in eigener Transaktion committet."""
        request_id = None if cost.request_id is None else cost.request_id[:MAX_REQUEST_ID]
        with self.conn.transaction():
            self.conn.execute(
                """
                INSERT INTO cost_entry (id, user_id, job_id, session_id, provider, model, task,
                  input_tokens, output_tokens, cache_creation_input_tokens,
                  cache_read_input_tokens, cost_estimate_usd, cost_estimate_eur, request_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    uuid7(),
                    self.user_id,
                    None if self.job_id is None else uuid.UUID(self.job_id),
                    None if self.session_id is None else uuid.UUID(self.session_id),
                    cost.provider,
                    cost.model[:200],
                    self.task,
                    max(0, cost.tokens.input),
                    max(0, cost.tokens.output),
                    max(0, cost.tokens.cache_write),
                    max(0, cost.tokens.cache_read),
                    round(max(0.0, cost.usd), 8),
                    max(0.0, cost.eur),
                    request_id,
                ),
            )
        self.total_eur += max(0.0, cost.eur)
        self.calls += 1
