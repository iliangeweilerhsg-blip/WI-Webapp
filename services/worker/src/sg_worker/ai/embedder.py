"""Embedder (VERTRAEGE §19.2): `bge-m3` (Standard, nur macOS arm64) und `fake` (CI, Linux).

Auswahl über `SG_EMBEDDER` (`bge-m3` | `fake`, Standard `bge-m3`), Modell über
`SG_EMBED_MODEL` (Standard `BAAI/bge-m3`). Ein unbekannter Wert in `SG_EMBEDDER` verhält sich
wie ein gescheitertes Laden: Der Embedder ist dauerhaft „nicht verfügbar“, der Worker läuft weiter.

**`bge-m3`** lädt das Modell in einem Hintergrund-Thread (`start`). Bis dahin ist er „nicht
bereit“. `sentence_transformers` (und torch) werden erst in diesem Thread importiert. Unter Linux
und in der CI ist das Paket nicht installiert: Der Importfehler macht ihn „nicht verfügbar“.
Beim ersten Start lädt `sentence-transformers` das Modell (≈ 2,3 GB) von Hugging Face. Texte
verlassen den Mac nie.

Job-Schleife und Loopback-Endpunkt (`server.py`) teilen sich **ein** Modell
(`shared_embedder`). `embed` ist darum thread-sicher.

**Entlastung für Macs mit 8 GB:** Auf `mps` und `cuda` lädt das Modell in fp16 (halber Speicher),
auf der CPU in fp32. `torch` rechnet mit `SG_EMBED_THREADS` Threads. Die Pause zwischen den
Stapeln von `search.index` (`SG_EMBED_PAUSE_MS`) liegt im Handler, **nicht** in `embed`: Der
Loopback-Endpunkt wird nie gedrosselt. `__main__` übergibt die Werte mit `configure_tuning`.
"""

from __future__ import annotations

import hashlib
import logging
import math
import os
import re
import threading
import time
import unicodedata
from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

from ..config import DEFAULT_EMBED_PAUSE_MS, default_embed_threads
from .interfaces import Embedder

PROVIDER_BGE = "bge-m3"
PROVIDER_FAKE = "fake"
DEFAULT_PROVIDER = PROVIDER_BGE
DEFAULT_EMBED_MODEL = "BAAI/bge-m3"
FAKE_MODEL = "fake-embed-1"
DIM = 1024
#: Längere Eingaben schneidet das Modell ab (Tokens)
MAX_SEQ_LENGTH = 512
#: Länge eines Fehlertexts (WorkerHealth.error, SearchIndexResult.embedding_error: ≤ 500)
MAX_ERROR = 300

#: Auf diesen Geräten lädt das Modell in fp16, sonst in fp32
HALF_DEVICES = ("mps", "cuda")
#: Kurzer Text für den Probelauf nach dem Laden (prüft fp16, wärmt das Gerät vor)
WARMUP_TEXT = "Probe"

EmbedderState = Literal["bereit", "laedt", "nicht_verfuegbar"]

log = logging.getLogger(__name__)


class EmbedderNotReady(Exception):
    """Das Modell lädt noch."""


class EmbedderUnavailable(Exception):
    """Der Embedder ist dauerhaft nicht verfügbar (Import, Download, unbekannter Anbieter)."""


def embedder_state(embedder: Embedder) -> EmbedderState:
    """Zustand für `GET /health` (§19.4)."""
    if embedder.ready():
        return "bereit"
    if embedder.error() is not None:
        return "nicht_verfuegbar"
    return "laedt"


#: Wird beim Beenden des Workers gesetzt (`request_shutdown`): Wartende (`wait_ready`,
#: `wait_idle`) geben dann sofort auf, statt den SIGTERM bis zu 10 min aufzuhalten.
SHUTDOWN = threading.Event()
#: So oft prüfen Wartende das Stopp-Signal (Sekunden)
_WAIT_SLICE_S = 0.5


class EndpointPriority:
    """Vorrang des Loopback-Endpunkts (§19.2): Zähler anstehender Endpunkt-Anfragen mit
    `threading.Condition`. Die Job-Schleife wartet vor jedem Stapel (`wait_idle`), bis keine
    Anfrage ansteht. Eine Suchanfrage wartet so höchstens auf den gerade laufenden Stapel."""

    def __init__(self) -> None:
        self._cond = threading.Condition()
        self._pending = 0

    @property
    def pending(self) -> int:
        with self._cond:
            return self._pending

    @contextmanager
    def request(self) -> Iterator[None]:
        """Um eine Endpunkt-Anfrage legen (vom Eintreffen bis zur Antwort)."""
        with self._cond:
            self._pending += 1
        try:
            yield
        finally:
            with self._cond:
                self._pending -= 1
                if self._pending == 0:
                    self._cond.notify_all()

    def wait_idle(self, timeout_s: float | None = None) -> bool:
        """Wartet, bis keine Endpunkt-Anfrage ansteht. False: Zeitlimit erreicht oder der Worker
        wird beendet (`SHUTDOWN`)."""
        with self._cond:
            return self._cond.wait_for(
                lambda: self._pending == 0 or SHUTDOWN.is_set(), timeout_s
            ) and (self._pending == 0)

    def wake(self) -> None:
        """Weckt Wartende (nach `SHUTDOWN.set()`)."""
        with self._cond:
            self._cond.notify_all()


#: Gemeinsam für Job-Schleife und Endpunkt (ein Modell je Prozess)
ENDPOINT_PRIORITY = EndpointPriority()


def request_shutdown() -> None:
    """Der Worker wird beendet: Wartende sofort freigeben."""
    SHUTDOWN.set()
    ENDPOINT_PRIORITY.wake()


def shutdown_when(
    stopping: Callable[[], bool], interval_s: float = _WAIT_SLICE_S
) -> threading.Thread:
    """Daemon-Thread, der `request_shutdown()` auslöst, sobald `stopping()` wahr ist (beim Start
    des Workers mit `lambda: worker.stopping`)."""

    def watch() -> None:
        while not stopping():
            time.sleep(interval_s)
        request_shutdown()

    thread = threading.Thread(target=watch, name="sg-embedder-stop", daemon=True)
    thread.start()
    return thread


_ABS_PATH = re.compile(r"(?<![\w.:/])/(?:[\w.\-]+/)+[\w.\-]*")


def safe_error(text: str) -> str:
    """Fehlertext ohne absolute Pfade (Health-Antwort, `job.result`), gekürzt."""
    home = str(Path.home())
    if len(home) > 1:
        text = text.replace(home, "~")
    text = _ABS_PATH.sub("<Pfad>", text)
    text = " ".join(text.split())
    return text if len(text) <= MAX_ERROR else text[: MAX_ERROR - 1] + "…"


# ---------- Fake ----------


_WORD = re.compile(r"[^\W_]+")


def fake_words(text: str) -> list[str]:
    """Wörter = Treffer von `[^\\W_]+` (Buchstaben und Ziffern) in
    `unicodedata.normalize('NFC', text).casefold()`, nur mit mindestens 2 Zeichen (§19.2)."""
    folded = unicodedata.normalize("NFC", text).casefold()
    return [w for w in _WORD.findall(folded) if len(w) >= 2]


def fake_vector(text: str, dim: int = DIM) -> list[float]:
    """Deterministischer Vektor nach §19.2. Ohne Wörter: Nullvektor (wird nie gespeichert)."""
    vec = [0.0] * dim
    for word in fake_words(text):
        h = hashlib.sha256(word.encode("utf-8")).digest()
        pos = int.from_bytes(h[0:4], "big") % dim
        vec[pos] += 1.0 if h[4] % 2 == 0 else -1.0
    norm = math.sqrt(sum(x * x for x in vec))
    return vec if norm == 0 else [x / norm for x in vec]


@dataclass
class FakeEmbedder:
    """Deterministisch, sofort bereit, ohne Modell (§19.2). Zustandslos und damit thread-sicher."""

    provider: str = PROVIDER_FAKE
    model: str = FAKE_MODEL
    dim: int = DIM

    def ready(self) -> bool:
        return True

    def error(self) -> str | None:
        return None

    def wait_ready(self, timeout_s: float) -> bool:
        return True

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [fake_vector(t, self.dim) for t in texts]


# ---------- Nicht verfügbar (unbekannter Anbieter) ----------


@dataclass
class UnavailableEmbedder:
    """Platzhalter für einen unbekannten `SG_EMBEDDER`: dauerhaft „nicht verfügbar“."""

    provider: str
    model: str
    reason: str
    dim: int = DIM

    def ready(self) -> bool:
        return False

    def error(self) -> str | None:
        return self.reason

    def wait_ready(self, timeout_s: float) -> bool:
        return False

    def embed(self, texts: list[str]) -> list[list[float]]:
        raise EmbedderUnavailable(self.reason)


# ---------- Entlastung (SG_EMBED_THREADS, SG_EMBED_PAUSE_MS) ----------


@dataclass(frozen=True)
class Tuning:
    #: Threads für `torch.set_num_threads`. None: etwa die Hälfte der Kerne
    threads: int | None = None
    #: Pause zwischen zwei Stapeln von `search.index` (Millisekunden)
    pause_ms: int = DEFAULT_EMBED_PAUSE_MS


_tuning = Tuning()


def configure_tuning(*, threads: int | None = None, pause_ms: int = DEFAULT_EMBED_PAUSE_MS) -> None:
    """Beim Start des Workers (und in Tests): Werte aus `Settings` übernehmen."""
    global _tuning
    _tuning = Tuning(threads=threads, pause_ms=max(0, pause_ms))


def embed_threads() -> int:
    threads = _tuning.threads
    return default_embed_threads() if threads is None else max(1, threads)


def index_pause_s() -> float:
    """Pause zwischen zwei Stapeln von `search.index` in Sekunden (0 = keine)."""
    return _tuning.pause_ms / 1000.0


def pause_between_batches() -> None:
    """Nur für `search.index`: gibt CPU und GPU kurz frei. Endet sofort, wenn der Worker beendet
    wird. Der Loopback-Endpunkt ruft das nie auf."""
    pause = index_pause_s()
    if pause > 0:
        SHUTDOWN.wait(pause)


# ---------- bge-m3 ----------


def _import_sentence_transformers() -> tuple[Any, Any]:
    """Importiert `sentence_transformers` und `torch` (nur macOS arm64 installiert)."""
    try:
        import sentence_transformers  # type: ignore[import-not-found,unused-ignore]
        import torch  # type: ignore[import-not-found,unused-ignore]
    except ImportError as exc:  # auch fehlende Abhängigkeiten von torch
        raise EmbedderUnavailable(
            f"sentence_transformers nicht importierbar ({exc.name or 'unbekannt'})"
        ) from exc
    return sentence_transformers, torch


def _pick_device(torch: Any) -> str:
    mps = getattr(getattr(torch, "backends", None), "mps", None)
    try:
        return "mps" if mps is not None and mps.is_available() else "cpu"
    except Exception:
        return "cpu"


def pick_dtype(device: str) -> Literal["float16", "float32"]:
    """fp16 auf `mps` und `cuda` (halber Speicher, ≈ 1,1 statt 2,3 GB), fp32 auf der CPU (dort ist
    fp16 langsam und teils nicht umgesetzt)."""
    return "float16" if device.split(":", 1)[0] in HALF_DEVICES else "float32"


def _set_threads(torch: Any, threads: int) -> None:
    try:
        torch.set_num_threads(threads)
    except Exception as exc:  # nur eine Optimierung: nie das Laden verhindern
        log.warning("Thread-Zahl nicht gesetzt", extra={"error": type(exc).__name__})


def _unit(row: list[Any]) -> list[float]:
    """L2-normiert in doppelter Genauigkeit nach. fp16 normiert nur auf etwa 1e-3 genau; die
    gespeicherten Vektoren sollen unabhängig vom dtype die Länge 1 haben. Nullvektoren und
    ungültige Werte bleiben unverändert (der Aufrufer prüft sie)."""
    values = [float(x) for x in row]
    norm = math.sqrt(math.fsum(x * x for x in values))
    if norm == 0 or not math.isfinite(norm):
        return values
    return [x / norm for x in values]


def _all_finite(rows: list[list[float]]) -> bool:
    return all(math.isfinite(x) for row in rows for x in row)


def _dimension(model: Any) -> int | None:
    # sentence-transformers ≥ 6: `get_embedding_dimension`, davor `get_sentence_embedding_dimension`
    for name in ("get_embedding_dimension", "get_sentence_embedding_dimension"):
        fn = getattr(model, name, None)
        if callable(fn):
            value = fn()
            return None if value is None else int(value)
    return None


@dataclass
class BgeM3Embedder:
    """`bge-m3` über `sentence-transformers`: nur dichte Vektoren (1024), L2-normiert,
    `max_seq_length = 512`, Gerät `mps`, wenn verfügbar, sonst `cpu`. Keine Präfixe.
    Auf `mps`/`cuda` fp16, auf der CPU fp32 (`pick_dtype`).

    `start()` lädt das Modell in einem Daemon-Thread. `importer` ist für Tests austauschbar."""

    model: str = DEFAULT_EMBED_MODEL
    provider: str = PROVIDER_BGE
    dim: int = DIM
    importer: Callable[[], tuple[Any, Any]] = _import_sentence_transformers
    device: str | None = field(default=None, init=False)
    dtype: str | None = field(default=None, init=False)
    _torch: Any = field(default=None, init=False, repr=False)
    _st: Any = field(default=None, init=False, repr=False)
    _error: str | None = field(default=None, init=False)
    _done: threading.Event = field(default_factory=threading.Event, init=False, repr=False)
    _lock: threading.Lock = field(default_factory=threading.Lock, init=False, repr=False)
    _thread: threading.Thread | None = field(default=None, init=False, repr=False)

    def start(self) -> None:
        """Startet das Laden im Hintergrund (idempotent)."""
        with self._lock:
            if self._thread is not None:
                return
            self._thread = threading.Thread(target=self._load, name="sg-embedder", daemon=True)
            self._thread.start()

    def _load(self) -> None:
        t0 = time.monotonic()
        try:
            st, torch = self.importer()
            _set_threads(torch, embed_threads())
            device = _pick_device(torch)
            dtype = pick_dtype(device)
            if dtype == "float16":
                loaded = st.SentenceTransformer(
                    self.model, device=device, model_kwargs={"dtype": torch.float16}
                )
            else:
                loaded = st.SentenceTransformer(self.model, device=device)
            loaded.max_seq_length = MAX_SEQ_LENGTH
            dim = _dimension(loaded)
            if dim is not None and dim != self.dim:
                raise EmbedderUnavailable(f"Modell liefert {dim} statt {self.dim} Dimensionen")
            # Probelauf: wärmt das Gerät vor (die erste Suchanfrage ist sonst langsam) und prüft,
            # ob fp16 gültige Zahlen liefert. Wenn nicht: zurück auf fp32 statt NaN-Vektoren.
            if dtype == "float16" and not _all_finite(self._encode(loaded, [WARMUP_TEXT])):
                log.warning(
                    "fp16 liefert ungültige Werte, weiter mit fp32", extra={"device": device}
                )
                loaded = loaded.float()
                dtype = "float32"
            self.device = device
            self.dtype = dtype
            self._torch = torch
            self._st = loaded
            self.release_cache()
        except EmbedderUnavailable as exc:
            self._error = safe_error(str(exc))
        except Exception as exc:  # Download ohne Netz, kaputter Cache, Speicher …
            self._error = safe_error(f"Modell nicht ladbar ({type(exc).__name__}: {exc})")
        finally:
            self._done.set()
        if self._error is not None:
            log.error(
                "Embedder nicht verfügbar",
                extra={"provider": self.provider, "model": self.model, "error": self._error},
            )
        else:
            log.info(
                "Embedder bereit",
                extra={
                    "provider": self.provider,
                    "model": self.model,
                    "device": self.device,
                    "dtype": self.dtype,
                    "threads": embed_threads(),
                    "load_ms": int((time.monotonic() - t0) * 1000),
                },
            )

    def ready(self) -> bool:
        return self._st is not None

    def error(self) -> str | None:
        return self._error

    def wait_ready(self, timeout_s: float) -> bool:
        if self._thread is None:
            self.start()
        deadline = time.monotonic() + max(0.0, timeout_s)
        while not self._done.is_set() and not SHUTDOWN.is_set():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            self._done.wait(min(remaining, _WAIT_SLICE_S))
        return self.ready()

    def embed(self, texts: list[str]) -> list[list[float]]:
        st = self._st
        if st is None:
            if self._error is not None:
                raise EmbedderUnavailable(self._error)
            raise EmbedderNotReady
        if not texts:
            return []
        with self._lock:
            return self._encode(st, texts)

    @staticmethod
    def _encode(st: Any, texts: list[str]) -> list[list[float]]:
        out = st.encode(
            list(texts),
            batch_size=len(texts),
            show_progress_bar=False,
            convert_to_numpy=True,
            normalize_embeddings=True,
        )
        return [_unit(row) for row in out.tolist()]

    def release_cache(self) -> None:
        """Gibt auf `mps` den Zwischenspeicher des Geräts frei (nach dem Laden und nach großen
        Index-Läufen). Nur eine Optimierung: Fehler werden verschluckt."""
        if self.device != "mps" or self._torch is None:
            return
        try:
            with self._lock:
                self._torch.mps.empty_cache()
        except Exception as exc:
            log.debug("empty_cache fehlgeschlagen", extra={"error": type(exc).__name__})


# ---------- Auswahl ----------


def make_embedder(environ: Mapping[str, str] | None = None) -> Embedder:
    """Embedder laut `SG_EMBEDDER`/`SG_EMBED_MODEL`, noch nicht gestartet. Unbekannter Anbieter:
    `UnavailableEmbedder`."""
    env = os.environ if environ is None else environ
    name = (env.get("SG_EMBEDDER") or DEFAULT_PROVIDER).strip()
    model = (env.get("SG_EMBED_MODEL") or "").strip() or DEFAULT_EMBED_MODEL
    if name == PROVIDER_FAKE:
        return FakeEmbedder()
    if name == PROVIDER_BGE:
        return BgeM3Embedder(model=model)
    return UnavailableEmbedder(
        provider=name[:40] or "?", model=model, reason=f"unbekannter SG_EMBEDDER {name[:40]!r}"
    )


_shared: Embedder | None = None
_shared_guard = threading.Lock()


def shared_embedder() -> Embedder:
    """Der eine Embedder des Prozesses (Job-Schleife und Loopback-Endpunkt). Beim ersten Aufruf
    angelegt und gestartet."""
    global _shared
    with _shared_guard:
        if _shared is None:
            _shared = make_embedder()
            start = getattr(_shared, "start", None)
            if callable(start):
                start()
        return _shared


def set_shared_embedder(embedder: Embedder | None) -> None:
    """Ersetzt den gemeinsamen Embedder (Tests). None: beim nächsten Zugriff neu anlegen."""
    global _shared
    with _shared_guard:
        _shared = embedder


def start_embedder(logger: logging.Logger | None = None) -> Embedder:
    """Beim Start des Workers: Embedder anlegen und laden. Ist er sofort nicht verfügbar
    (unbekannter Anbieter), wird das einmal protokolliert. Ein Ladefehler von `bge-m3` wird im
    Lade-Thread protokolliert."""
    embedder = shared_embedder()
    problem = embedder.error()
    if problem is not None:
        (logger or log).error(
            "Embedder nicht verfügbar", extra={"provider": embedder.provider, "error": problem}
        )
    else:
        (logger or log).info(
            "Embedder gestartet", extra={"provider": embedder.provider, "model": embedder.model}
        )
    return embedder
