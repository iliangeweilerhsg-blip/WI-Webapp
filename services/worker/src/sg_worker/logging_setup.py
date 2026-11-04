"""Strukturierte JSON-Logs nach stdout und `$SG_DATA_DIR/logs/worker.log` (rotierend, 14 Tage)."""

from __future__ import annotations

import json
import logging
import sys
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import UTC, datetime
from logging.handlers import TimedRotatingFileHandler
from pathlib import Path
from typing import Any

LOGGER_NAME = "sg_worker"

job_id_var: ContextVar[str | None] = ContextVar("sg_job_id", default=None)
session_id_var: ContextVar[str | None] = ContextVar("sg_session_id", default=None)

_RESERVED = set(logging.LogRecord("", 0, "", 0, "", None, None).__dict__) | {"message", "asctime"}


class JsonFormatter(logging.Formatter):
    """Eine JSON-Zeile pro Eintrag, mit `job_id`/`session_id` aus dem Kontext."""

    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname.lower(),
            "logger": record.name,
            "msg": record.getMessage(),
        }
        job_id = job_id_var.get()
        session_id = session_id_var.get()
        if job_id is not None:
            entry["job_id"] = job_id
        if session_id is not None:
            entry["session_id"] = session_id
        for key, value in record.__dict__.items():
            if key not in _RESERVED and not key.startswith("_"):
                entry[key] = value
        if record.exc_info:
            entry["exc"] = self.formatException(record.exc_info)
        return json.dumps(entry, ensure_ascii=False, default=str)


def setup_logging(data_dir: Path, level: str = "info") -> logging.Logger:
    """Richtet den Logger `sg_worker` ein (idempotent)."""
    logger = logging.getLogger(LOGGER_NAME)
    logger.setLevel(level.upper())
    logger.propagate = False
    for old in list(logger.handlers):
        logger.removeHandler(old)
        old.close()
    formatter = JsonFormatter()
    stream = logging.StreamHandler(sys.stdout)
    stream.setFormatter(formatter)
    logger.addHandler(stream)
    try:
        log_dir = data_dir / "logs"
        log_dir.mkdir(parents=True, exist_ok=True)
        file_handler = TimedRotatingFileHandler(
            log_dir / "worker.log", when="midnight", backupCount=14, encoding="utf-8"
        )
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)
    except OSError as exc:
        logger.warning("Logdatei nicht beschreibbar, nur stdout: %s", exc)
    return logger


@contextmanager
def job_log_context(job_id: str, session_id: str | None) -> Iterator[None]:
    """Setzt `job_id`/`session_id` für alle Log-Einträge innerhalb des Blocks."""
    t1 = job_id_var.set(job_id)
    t2 = session_id_var.set(session_id)
    try:
        yield
    finally:
        job_id_var.reset(t1)
        session_id_var.reset(t2)
