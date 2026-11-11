"""Konfiguration aus Umgebungsvariablen (docs/VERTRAEGE.md §1)."""

from __future__ import annotations

import os
import stat
from collections.abc import Mapping, MutableMapping
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_DATABASE_URL = "postgres://sg:sg@127.0.0.1:5432/sg"
#: `SG_WORKER_NICE`: um so viel senkt der Worker beim Start seine Priorität (0 = aus, höchstens 19)
DEFAULT_WORKER_NICE = 10
#: `SG_EMBED_PAUSE_MS`: Pause zwischen zwei Stapeln von `search.index` (0 = aus, höchstens 5000)
DEFAULT_EMBED_PAUSE_MS = 75
MAX_EMBED_PAUSE_MS = 5000


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


def default_embed_threads(cpu_count: int | None = None) -> int:
    """Etwa die Hälfte der Kerne, mindestens 1 (Standard für `SG_EMBED_THREADS`)."""
    cores = os.cpu_count() if cpu_count is None else cpu_count
    return max(1, (cores or 1) // 2)


def env_int(env: Mapping[str, str], name: str, default: int, low: int, high: int) -> int:
    """Ganze Zahl aus `env[name]`, auf `low`..`high` begrenzt. Leer oder keine Zahl: `default`."""
    raw = (env.get(name) or "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return min(high, max(low, value))


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    database_url: str = DEFAULT_DATABASE_URL
    log_level: str = "info"
    poll_interval: float = 30.0
    worker_nice: int = DEFAULT_WORKER_NICE
    embed_threads: int = field(default_factory=default_embed_threads)
    embed_pause_ms: int = DEFAULT_EMBED_PAUSE_MS

    @classmethod
    def from_env(cls, environ: Mapping[str, str] | None = None) -> Settings:
        env = os.environ if environ is None else environ
        data_dir = Path(env.get("SG_DATA_DIR") or "~/StudienGehirn").expanduser()
        return cls(
            data_dir=data_dir,
            database_url=env.get("DATABASE_URL") or DEFAULT_DATABASE_URL,
            log_level=(env.get("SG_LOG_LEVEL") or "info").lower(),
            worker_nice=env_int(env, "SG_WORKER_NICE", DEFAULT_WORKER_NICE, 0, 19),
            embed_threads=env_int(env, "SG_EMBED_THREADS", default_embed_threads(), 1, 64),
            embed_pause_ms=env_int(
                env, "SG_EMBED_PAUSE_MS", DEFAULT_EMBED_PAUSE_MS, 0, MAX_EMBED_PAUSE_MS
            ),
        )


# ---------- KI-Anbieter und Schlüssel (VERTRAEGE §20.5) ----------

LLM_PROVIDERS = ("anthropic", "fake")
DEFAULT_LLM_PROVIDER = "anthropic"
KEY_VAR = "ANTHROPIC_API_KEY"


@dataclass(frozen=True)
class LlmSettings:
    """Anbieter und Schlüssel der Cloud-KI. Der Schlüssel steht nie in `repr` (Logs, Fehler).

    `issue`: `kein_schluessel` | `env_offen` | `unbekannter_anbieter` | None (`LlmIssue`).
    """

    provider: str = DEFAULT_LLM_PROVIDER
    api_key: str | None = field(default=None, repr=False)
    issue: str | None = None

    @property
    def configured(self) -> bool:
        return self.issue is None


def env_file_open(path: Path) -> bool:
    """True, wenn die Datei für Gruppe oder andere lesbar ist (nicht `chmod 600`)."""
    try:
        mode = path.stat().st_mode
    except OSError:
        return False
    return bool(mode & (stat.S_IRWXG | stat.S_IRWXO))


def take_llm_settings(
    env_file: Path,
    *,
    key_from_environment: bool,
    environ: MutableMapping[str, str] | None = None,
) -> LlmSettings:
    """Liest `SG_LLM` und `ANTHROPIC_API_KEY` und entfernt danach **alle** Variablen, die mit
    `ANTHROPIC_` beginnen, aus `environ` (Standard: os.environ), damit Kindprozesse und das SDK
    keine davon sehen (§20.5).

    `key_from_environment`: Der Schlüssel stand schon vor dem Laden der `.env` in der Umgebung
    (Entwicklung). Sonst stammt er aus `env_file`; ist die Datei für Gruppe oder andere lesbar,
    wird er nicht genutzt (`env_offen`).
    """
    env = os.environ if environ is None else environ
    provider = (env.get("SG_LLM") or DEFAULT_LLM_PROVIDER).strip() or DEFAULT_LLM_PROVIDER
    key = (env.get(KEY_VAR) or "").strip() or None
    for name in [n for n in env if n.startswith("ANTHROPIC_")]:
        del env[name]
    if provider not in LLM_PROVIDERS:
        return LlmSettings(provider=provider[:40], issue="unbekannter_anbieter")
    if provider == "fake":
        return LlmSettings(provider="fake")
    if key is None:
        return LlmSettings(provider=provider, issue="kein_schluessel")
    if not key_from_environment and env_file_open(env_file):
        return LlmSettings(provider=provider, issue="env_offen")
    return LlmSettings(provider=provider, api_key=key)
