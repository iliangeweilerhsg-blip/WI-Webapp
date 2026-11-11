"""Entlastung für Macs mit 8 GB: `SG_WORKER_NICE`, `SG_EMBED_THREADS`, `SG_EMBED_PAUSE_MS`."""

from __future__ import annotations

import logging
from typing import Any

import pytest

from sg_worker import __main__ as main_mod
from sg_worker import config
from sg_worker.ai import embedder as em
from sg_worker.config import Settings


def test_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("os.cpu_count", lambda: 8)
    s = Settings.from_env({})
    assert (s.worker_nice, s.embed_threads, s.embed_pause_ms) == (10, 4, 75)
    assert 50 <= config.DEFAULT_EMBED_PAUSE_MS <= 100
    assert em.Tuning().pause_ms == config.DEFAULT_EMBED_PAUSE_MS


@pytest.mark.parametrize(("cores", "threads"), [(8, 4), (10, 5), (3, 1), (2, 1), (1, 1), (None, 1)])
def test_default_embed_threads(
    monkeypatch: pytest.MonkeyPatch, cores: int | None, threads: int
) -> None:
    monkeypatch.setattr("os.cpu_count", lambda: cores)
    assert config.default_embed_threads() == threads
    assert Settings.from_env({}).embed_threads == threads


def test_values_from_env() -> None:
    s = Settings.from_env(
        {"SG_WORKER_NICE": "5", "SG_EMBED_THREADS": " 2 ", "SG_EMBED_PAUSE_MS": "0"}
    )
    assert (s.worker_nice, s.embed_threads, s.embed_pause_ms) == (5, 2, 0)


def test_values_are_clamped_and_garbage_falls_back(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("os.cpu_count", lambda: 8)
    s = Settings.from_env(
        {"SG_WORKER_NICE": "-5", "SG_EMBED_THREADS": "0", "SG_EMBED_PAUSE_MS": "999999"}
    )
    assert (s.worker_nice, s.embed_threads, s.embed_pause_ms) == (0, 1, 5000)
    s = Settings.from_env({"SG_WORKER_NICE": "99", "SG_EMBED_THREADS": "viele"})
    assert (s.worker_nice, s.embed_threads) == (19, 4)
    s = Settings.from_env({"SG_WORKER_NICE": "", "SG_EMBED_PAUSE_MS": "1.5"})
    assert (s.worker_nice, s.embed_pause_ms) == (10, 75)


def test_lower_priority_calls_nice(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[int] = []
    monkeypatch.setattr("os.nice", lambda n: seen.append(n) or n)
    main_mod.lower_priority(10, logging.getLogger("test"))
    assert seen == [10]


def test_lower_priority_zero_does_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[int] = []
    monkeypatch.setattr("os.nice", lambda n: seen.append(n) or n)
    main_mod.lower_priority(0, logging.getLogger("test"))
    assert seen == []


def test_lower_priority_failure_is_only_logged(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    def denied(_: int) -> int:
        raise PermissionError("nein")

    monkeypatch.setattr("os.nice", denied)
    with caplog.at_level(logging.WARNING):
        main_mod.lower_priority(10, logging.getLogger("test"))
    [record] = caplog.records
    assert record.getMessage() == "Priorität nicht gesenkt"
    assert (record.nice, record.error) == (10, "PermissionError")  # type: ignore[attr-defined]


def test_lower_priority_without_os_nice(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delattr("os.nice")
    main_mod.lower_priority(10, logging.getLogger("test"))  # kein Fehler


def test_configure_tuning_takes_settings() -> None:
    try:
        em.configure_tuning(threads=2, pause_ms=90)
        assert (em.embed_threads(), em.index_pause_s()) == (2, 0.09)
        em.configure_tuning(threads=0, pause_ms=-5)
        assert (em.embed_threads(), em.index_pause_s()) == (1, 0.0)
    finally:
        em.configure_tuning()


def test_main_applies_nice_and_tuning(monkeypatch: pytest.MonkeyPatch, tmp_path: Any) -> None:
    """`main` senkt die Priorität und übergibt Threads und Pause, bevor der Embedder startet."""
    order: list[Any] = []
    monkeypatch.setenv("SG_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("SG_WORKER_NICE", "7")
    monkeypatch.setenv("SG_EMBED_THREADS", "2")
    monkeypatch.setenv("SG_EMBED_PAUSE_MS", "60")
    monkeypatch.setenv("SG_LLM", "fake")
    monkeypatch.setattr("os.nice", lambda n: order.append(("nice", n)) or n)
    monkeypatch.setattr(main_mod, "configure_tuning", lambda **kw: order.append(("tuning", kw)))
    monkeypatch.setattr(main_mod, "start_embedder", lambda log: order.append("embedder"))
    monkeypatch.setattr(main_mod, "start_server", lambda *a: None)
    # das echte `setup_logging` würde die Logger für die folgenden Tests umbauen
    monkeypatch.setattr(main_mod, "setup_logging", lambda *a: logging.getLogger("test"))
    monkeypatch.setattr(main_mod.llm, "configure", lambda s: None)
    monkeypatch.setattr(main_mod, "shutdown_when", lambda *a: None)
    monkeypatch.setattr(main_mod, "install_signal_handlers", lambda w: None)
    monkeypatch.setattr(main_mod.Worker, "run", lambda self: None)
    assert main_mod.main() == 0
    assert order == [("nice", 7), ("tuning", {"threads": 2, "pause_ms": 60}), "embedder"]
