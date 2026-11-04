"""Tests ohne Datenbank: Konfiguration, Logging, Registry, KI-Stufen."""

from __future__ import annotations

import json
import logging
import uuid
from pathlib import Path
from typing import Any

import pytest
from sg_schemas.models import PdfIngestPayload

from sg_worker.ai import model_for, tier_models
from sg_worker.config import Settings, load_env_file
from sg_worker.logging_setup import JsonFormatter, job_log_context, setup_logging
from sg_worker.registry import JobContext, PayloadError, Registry, handler


def test_settings_defaults_and_env(tmp_path: Path) -> None:
    s = Settings.from_env({"SG_DATA_DIR": str(tmp_path), "SG_LOG_LEVEL": "DEBUG"})
    assert s.data_dir == tmp_path
    assert s.database_url.endswith("/sg")
    assert s.log_level == "debug"


def test_load_env_file_does_not_override(tmp_path: Path) -> None:
    f = tmp_path / ".env"
    f.write_text('# c\nA=1\nexport B="zwei"\nC=3\n')
    env = {"C": "schon-da"}
    load_env_file(f, env)
    assert env == {"A": "1", "B": "zwei", "C": "schon-da"}
    load_env_file(tmp_path / "fehlt", env)


def test_tier_models_override() -> None:
    assert model_for("fast", {}) == "claude-haiku-5-5"
    assert tier_models({"SG_MODEL_DEEP": "x"})["deep"] == "x"
    assert tier_models({})["standard"] == "claude-sonnet-5-5"


def test_registry_validates_payload_union() -> None:
    reg = Registry()

    def fn(payload: Any, ctx: JobContext) -> dict[str, Any]:
        return {}

    reg.register("pdf.ingest", fn, PdfIngestPayload)
    spec = reg.get("pdf.ingest")
    assert spec is not None
    deck_id = uuid.uuid4()
    assert spec.validate({"slide_deck_id": str(deck_id)}).slide_deck_id == deck_id
    with pytest.raises(PayloadError):
        spec.validate({"slide_deck_id": str(deck_id), "extra": 1})
    with pytest.raises(ValueError):
        reg.register("pdf.ingest", fn)


def test_handler_decorator_uses_given_registry() -> None:
    reg = Registry()

    @handler("x.y", registry=reg)
    def fn(payload: Any, ctx: JobContext) -> dict[str, Any]:
        return {}

    assert reg.types() == ["x.y"]


def test_json_log_contains_job_context(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    log = setup_logging(tmp_path, "info")
    with job_log_context("job-1", "sess-1"):
        log.info("hallo", extra={"foo": 1})
    for h in log.handlers:
        h.flush()
    line = capsys.readouterr().out.strip().splitlines()[-1]
    entry = json.loads(line)
    assert entry["msg"] == "hallo"
    assert entry["job_id"] == "job-1"
    assert entry["session_id"] == "sess-1"
    assert entry["foo"] == 1
    file_line = (tmp_path / "logs" / "worker.log").read_text().strip().splitlines()[-1]
    assert json.loads(file_line)["job_id"] == "job-1"
    rotating = [h for h in log.handlers if hasattr(h, "backupCount")]
    assert rotating[0].backupCount == 14  # type: ignore[attr-defined]


def test_formatter_without_context() -> None:
    rec = logging.LogRecord("n", logging.INFO, "p", 1, "m", None, None)
    entry = json.loads(JsonFormatter().format(rec))
    assert "job_id" not in entry


def test_invalid_log_level_warns_and_uses_info(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    log = setup_logging(tmp_path, "laut")
    assert log.level == logging.INFO
    assert "Ungültiges SG_LOG_LEVEL" in capsys.readouterr().out
    assert logging.getLogger("psycopg").handlers  # psycopg ebenfalls als JSON


def test_signal_handler_semantics(tmp_path: Path) -> None:
    import signal

    from sg_worker.__main__ import make_signal_handler
    from sg_worker.loop import Worker

    w = Worker("postgres://x", tmp_path, registry=Registry())
    on_signal = make_signal_handler(w)
    on_signal(signal.SIGTERM, None)
    on_signal(signal.SIGTERM, None)  # idempotent
    assert w.stopping
    on_signal(signal.SIGINT, None)  # erstes SIGINT: nur Flag
    with pytest.raises(KeyboardInterrupt):
        on_signal(signal.SIGINT, None)  # zweites SIGINT: sofort
