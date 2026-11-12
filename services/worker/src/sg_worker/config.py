"""Konfiguration aus Umgebungsvariablen (docs/VERTRAEGE.md §1)."""

from __future__ import annotations

import errno
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
#: Eine `.env` ist klein; eine größere Datei wird nicht gelesen
MAX_ENV_BYTES = 1_000_000


#: Befunde von `inspect_env_file`, bei denen die Datei gar nicht gelesen wird (fail-closed)
ENV_UNSAFE = ("symlink", "keine_datei", "fremder_besitzer", "unlesbar")


def read_env_file(path: Path) -> tuple[str | None, str | None]:
    """Öffnet `path` ohne einem Symlink zu folgen (`O_NOFOLLOW`, `O_NONBLOCK`: eine FIFO hält den
    Worker nicht an) und prüft Art, Besitzer und Rechte per `fstat` auf dem **offenen**
    Deskriptor (kein TOCTOU zwischen Prüfung und Lesen). Gleiche Regeln wie der Core bei seinen
    Schlüsseldateien (`worker-client.ts`, `tunnel.ts`).

    Rückgabe `(text, befund)`. Befund: `None` (in Ordnung), `fehlt`, `offen` (für Gruppe oder
    andere lesbar: der Text wird gelesen, ein Schlüssel daraus aber nicht genutzt) oder einer aus
    `ENV_UNSAFE` (`symlink`, `keine_datei`, `fremder_besitzer`, `unlesbar`): dann ist `text` None.
    """
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    try:
        fd = os.open(path, flags)
    except FileNotFoundError:
        return None, "fehlt"
    except OSError as exc:
        # ELOOP: der letzte Teil des Pfads ist ein Symlink (O_NOFOLLOW)
        return None, "symlink" if exc.errno == errno.ELOOP else "unlesbar"
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode):
            return None, "keine_datei"
        geteuid = getattr(os, "geteuid", None)
        if geteuid is not None and info.st_uid != geteuid():
            return None, "fremder_besitzer"
        with os.fdopen(fd, "rb", closefd=False) as handle:
            raw = handle.read(MAX_ENV_BYTES + 1)
    except OSError:
        return None, "unlesbar"
    finally:
        os.close(fd)
    if len(raw) > MAX_ENV_BYTES:
        return None, "unlesbar"
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return None, "unlesbar"
    return text, "offen" if info.st_mode & (stat.S_IRWXG | stat.S_IRWXO) else None


def inspect_env_file(path: Path) -> str | None:
    """Befund zu `path` wie bei `read_env_file`, ohne den Inhalt zu behalten."""
    return read_env_file(path)[1]


def load_env_file(path: Path, environ: MutableMapping[str, str] | None = None) -> str | None:
    """Liest `KEY=VALUE`-Zeilen aus `path` in `environ` (Standard: os.environ).

    Bereits gesetzte Variablen gewinnen. Fehlt die Datei, passiert nichts. Ist sie ein Symlink,
    keine reguläre Datei oder gehört sie einem anderen Benutzer, wird sie **nicht** gelesen.
    Rückgabe: der Befund von `read_env_file` (None = in Ordnung).
    """
    target = os.environ if environ is None else environ
    text, problem = read_env_file(path)
    if text is None:
        return problem
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
    return problem


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
    """True, wenn der Schlüssel aus `path` nicht genutzt werden darf: für Gruppe oder andere
    lesbar (nicht `chmod 600`), Symlink, keine reguläre Datei oder fremder Besitzer. Eine fehlende
    Datei gilt nicht als offen."""
    problem = inspect_env_file(path)
    return problem is not None and problem != "fehlt"


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
