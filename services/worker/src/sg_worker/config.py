"""Konfiguration aus Umgebungsvariablen (docs/VERTRAEGE.md §1)."""

from __future__ import annotations

import os
from collections.abc import Mapping, MutableMapping
from dataclasses import dataclass
from pathlib import Path

DEFAULT_DATABASE_URL = "postgres://sg:sg@127.0.0.1:5432/sg"


def load_env_file(path: Path, environ: MutableMapping[str, str] | None = None) -> None:
    """Liest `KEY=VALUE`-Zeilen aus `path` in `environ` (Standard: os.environ).

    Bereits gesetzte Variablen gewinnen. Fehlt die Datei, passiert nichts.
    """
    target = os.environ if environ is None else environ
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip().removeprefix("export ").strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        target.setdefault(key, value)


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    database_url: str = DEFAULT_DATABASE_URL
    log_level: str = "info"
    poll_interval: float = 30.0

    @classmethod
    def from_env(cls, environ: Mapping[str, str] | None = None) -> Settings:
        env = os.environ if environ is None else environ
        data_dir = Path(env.get("SG_DATA_DIR") or "~/StudienGehirn").expanduser()
        return cls(
            data_dir=data_dir,
            database_url=env.get("DATABASE_URL") or DEFAULT_DATABASE_URL,
            log_level=(env.get("SG_LOG_LEVEL") or "info").lower(),
        )
