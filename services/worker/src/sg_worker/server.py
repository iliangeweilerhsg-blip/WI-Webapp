"""Loopback-Endpunkt des Workers (VERTRAEGE §19.4, W-04 Option A).

Ein kleiner HTTP-Server in eigenen Threads, nur auf `127.0.0.1:SG_WORKER_PORT` (Standard 4711). Der
Core holt hier den Vektor einer Suchanfrage, berechnet mit **demselben** Modell wie der Index.

- **Start:** erst den Port binden, **danach** das Token erzeugen und schreiben. Scheitert das
  Binden (Port belegt), wird die Token-Datei nicht angefasst, und der Worker läuft ohne Endpunkt
  weiter (die Suche fällt auf Wortsuche zurück).
- **Token:** 32 Zufallsbytes (`secrets.token_hex(32)`) nach `$SG_DATA_DIR/run/worker.token`
  (Ordner 700, Datei 600, atomar über `worker.token.part`, Symlinks → Endpunkt aus). Jede Anfrage
  braucht `Authorization: Bearer <token>` (`hmac.compare_digest`), sonst `401`. Das Token steht
  nie in Logs oder Antworten.
- `GET /health` → `WorkerHealth` (mit `llm`, §20.5). `POST /embed` mit `EmbedRequest` →
  `EmbedResponse`.
- **Grenzen:** `Host` muss `127.0.0.1:<port>` sein (`400`, DNS-Rebinding), `Content-Length`
  Pflicht (`411`, auch bei `Transfer-Encoding`), Body ≤ 256 KB vor dem Lesen geprüft (`413`), nur
  `application/json` (`415`), 5 s je Verbindung, höchstens 4 Anfragen gleichzeitig (`503 busy`),
  höchstens 32 offene Verbindungen (überzählige werden sofort geschlossen).
  Andere Pfade `404`, andere Methoden `405`. Keine CORS-Header.
- **Logs:** nur Methode, Pfad, Status und Dauer.
- **Vorrang (§19.2):** Eine gültige `/embed`-Anfrage meldet sich für die Dauer des Einbettens
  bei `ENDPOINT_PRIORITY` an. Die Job-Schleife wartet vor jedem Stapel, bis keine ansteht.
"""

from __future__ import annotations

import contextlib
import hmac
import json
import logging
import os
import secrets
import socket
import threading
import time
from collections.abc import Mapping
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from pydantic import ValidationError
from sg_schemas.models import EmbedRequest, EmbedResponse, WorkerHealth

from .ai.embedder import (
    ENDPOINT_PRIORITY,
    EmbedderNotReady,
    EmbedderUnavailable,
    embedder_state,
)
from .ai.interfaces import Embedder
from .ai.llm import llm_status

HOST = "127.0.0.1"  # nie eine andere Adresse
DEFAULT_PORT = 4711
MAX_BODY = 256 * 1024
MAX_CONCURRENT = 4
#: Offene Verbindungen (inklusive solcher, deren Kopfzeilen noch nicht gelesen sind)
MAX_CONNECTIONS = 32
TOKEN_NAME = "worker.token"
#: Zeitlimit je Verbindung (gesamt) und je Lese-/Schreibvorgang
CONNECTION_TIMEOUT_S = 5.0
#: So schnell reagiert der Server-Thread auf `stop()`
POLL_INTERVAL_S = 0.5

_ROUTES = {"/health": "GET", "/embed": "POST"}

log = logging.getLogger(__name__)


class ConfigError(ValueError):
    """`SG_WORKER_PORT` ist ungültig."""


class TokenError(OSError):
    """Die Token-Datei lässt sich nicht sicher schreiben (Symlink)."""


def worker_port(environ: Mapping[str, str] | None = None) -> int:
    """Port aus `SG_WORKER_PORT` (1 bis 65535), Standard 4711. Ungültig: `ConfigError`."""
    env = os.environ if environ is None else environ
    raw = (env.get("SG_WORKER_PORT") or "").strip()
    if not raw:
        return DEFAULT_PORT
    if not (raw.isascii() and raw.isdigit()) or not 1 <= int(raw) <= 65535:
        raise ConfigError(f"SG_WORKER_PORT ungültig: {raw[:20]!r}")
    return int(raw)


def token_path(data_dir: Path) -> Path:
    return data_dir / "run" / TOKEN_NAME


def write_token(data_dir: Path, token: str) -> Path:
    """Schreibt das Token atomar: `run/` anlegen bzw. auf 700 setzen, alte `.part` entfernen, neu
    mit `O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW` und 600, `fsync`, `os.replace`. Ist `run/` oder
    die Token-Datei ein Symlink: `TokenError`."""
    run = data_dir / "run"
    final = run / TOKEN_NAME
    if run.is_symlink():
        raise TokenError("run/ ist ein Symlink")
    run.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(run, 0o700, follow_symlinks=False)  # auch wenn der Ordner schon existierte
    if final.is_symlink():
        raise TokenError("worker.token ist ein Symlink")
    part = run / (TOKEN_NAME + ".part")
    with contextlib.suppress(FileNotFoundError):
        part.unlink()  # Rest eines Absturzes: neu anlegen, damit die Rechte sicher stimmen
    flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW
    fd = os.open(part, flags, 0o600)
    try:
        os.fchmod(fd, 0o600)  # unabhängig von der umask
        data = token.encode("ascii")
        while data:
            data = data[os.write(fd, data) :]
        os.fsync(fd)
    finally:
        os.close(fd)
    os.replace(part, final)
    # Das Token liegt schon an seinem Platz: scheitert nur das Sichern des Ordners, wird gewarnt
    # (ohne Pfad und ohne Token), der Start aber nicht abgebrochen.
    try:
        dir_fd = os.open(run, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(dir_fd)  # das Umbenennen überlebt einen Absturz
        finally:
            os.close(dir_fd)
    except OSError as exc:
        log.warning(
            "Token-Ordner nicht mit fsync gesichert",
            extra={"error": exc.strerror or type(exc).__name__},
        )
    return final


def _abort_connection(request: socket.socket) -> None:
    """Zeitlimit je Verbindung: Socket schließen, der Handler-Thread endet mit einem Fehler."""
    with contextlib.suppress(OSError):
        request.shutdown(socket.SHUT_RDWR)


class _Server(ThreadingHTTPServer):
    daemon_threads = True  # Anfragen halten das Beenden nicht auf
    allow_reuse_address = True  # schneller Neustart trotz TIME_WAIT
    allow_reuse_port = False  # ein zweiter Prozess darf den Port nicht mitbenutzen

    def __init__(self, port: int, embedder: Embedder) -> None:
        super().__init__((HOST, port), _Handler)
        self.embedder = embedder
        self.token_bytes = b""  # erst nach dem Binden gesetzt (§19.4)
        self.expected_host = f"{HOST}:{self.server_port}"
        self.slots = threading.BoundedSemaphore(MAX_CONCURRENT)
        self._open = 0
        self._open_lock = threading.Lock()

    @property
    def open_connections(self) -> int:
        with self._open_lock:
            return self._open

    def _release_connection(self) -> None:
        with self._open_lock:
            self._open -= 1

    def process_request(self, request: Any, client_address: Any) -> None:
        """Höchstens `MAX_CONNECTIONS` offene Verbindungen, überzählige sofort schließen."""
        with self._open_lock:
            full = self._open >= MAX_CONNECTIONS
            if not full:
                self._open += 1
        if full:
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self._release_connection()
            raise

    def process_request_thread(self, request: Any, client_address: Any) -> None:
        timer = threading.Timer(CONNECTION_TIMEOUT_S, _abort_connection, args=(request,))
        timer.daemon = True
        handled = False
        try:
            timer.start()  # scheitert schon der Start, räumt `finally` auf
            handled = True
            super().process_request_thread(request, client_address)  # schließt selbst
        finally:
            timer.cancel()
            if not handled:
                self.shutdown_request(request)
            self._release_connection()

    def handle_error(self, request: Any, client_address: Any) -> None:
        # Abgebrochene Verbindungen (Zeitlimit, Client weg): kein Traceback auf stderr
        log.debug("Loopback: Verbindung abgebrochen", exc_info=True)


class _Handler(BaseHTTPRequestHandler):
    server: _Server
    protocol_version = "HTTP/1.0"  # eine Anfrage je Verbindung
    server_version = "sg-worker"
    sys_version = ""
    timeout = CONNECTION_TIMEOUT_S
    _t0 = 0.0

    def setup(self) -> None:
        self._t0 = time.monotonic()
        super().setup()

    # Logs: nur Methode, Pfad, Status und Dauer (§19.4), nie Header, Token oder Texte.
    def log_message(self, format: str, *args: Any) -> None:
        return

    def log_request(self, code: int | str = "-", size: int | str = "-") -> None:
        path = urlsplit(self.path or "").path[:100] if getattr(self, "path", None) else "-"
        log.debug(
            "Loopback-Anfrage",
            extra={
                "method": (self.command or "-")[:10],
                "path": path,
                "status": int(code) if str(code).isdigit() else None,
                "duration_ms": int((time.monotonic() - self._t0) * 1000),
            },
        )

    def _send_json(
        self, status: int, body: str | bytes, headers: Mapping[str, str] | None = None
    ) -> None:
        data = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def _error(self, status: int, code: str, headers: Mapping[str, str] | None = None) -> None:
        self.close_connection = True  # einen ungelesenen Body nie als nächste Anfrage lesen
        self._send_json(status, json.dumps({"code": code}), headers)

    def _authorized(self) -> bool:
        scheme, _, value = (self.headers.get("Authorization") or "").strip().partition(" ")
        if scheme.lower() != "bearer" or not self.server.token_bytes:
            return False
        given = value.strip().encode("latin-1", "replace")
        return hmac.compare_digest(given, self.server.token_bytes)

    def _dispatch(self) -> None:
        if not self.server.slots.acquire(blocking=False):
            self._error(503, "busy")
            return
        try:
            self._route()
        finally:
            self.server.slots.release()

    def _route(self) -> None:
        if (self.headers.get("Host") or "").strip() != self.server.expected_host:
            self._error(400, "invalid_host")
            return
        if not self._authorized():
            self._error(401, "unauthorized", {"WWW-Authenticate": "Bearer"})
            return
        path = urlsplit(self.path).path
        method = _ROUTES.get(path)
        if method is None:
            self._error(404, "not_found")
        elif self.command != method:
            self._error(405, "method_not_allowed", {"Allow": method})
        elif path == "/health":
            self._health()
        else:
            self._embed()

    do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = do_HEAD = do_OPTIONS = _dispatch

    def _health(self) -> None:
        emb = self.server.embedder
        try:
            state = embedder_state(emb)
            error = emb.error() if state == "nicht_verfuegbar" else None
            health = WorkerHealth.model_validate(
                {
                    "embedder": {
                        "provider": emb.provider,
                        "model": emb.model,
                        "dim": emb.dim,
                        "state": state,
                        "error": None if error is None else error[:500],
                    },
                    "llm": llm_status(),  # §20.5, nie der Schlüssel
                }
            ).model_dump_json()
        except Exception:
            log.exception("Loopback: Zustand nicht lesbar")
            self._error(500, "internal_error")
            return
        self._send_json(200, health)

    def _read_body(self) -> bytes | None:
        """Body mit `Content-Length` (≤ 256 KB, vor dem Lesen geprüft). None: Antwort gesendet."""
        ctype = (self.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
        if ctype != "application/json":
            self._error(415, "unsupported_media_type")
            return None
        raw = self.headers.get("Content-Length")
        if self.headers.get("Transfer-Encoding") or raw is None:
            self._error(411, "length_required")
            return None
        raw = raw.strip()
        if not (raw.isascii() and raw.isdigit()):  # "²".isdigit() ist wahr, int("²") nicht
            self._error(400, "validation_failed")
            return None
        length = int(raw)
        if length > MAX_BODY:
            self._error(413, "payload_too_large")
            return None
        body = self.rfile.read(length)
        if len(body) != length:
            self._error(400, "validation_failed")
            return None
        return body

    def _embed(self) -> None:
        body = self._read_body()
        if body is None:
            return
        try:
            request = EmbedRequest.model_validate(json.loads(body))
        except (ValueError, ValidationError):  # JSON-Fehler sind ValueError
            self._error(400, "validation_failed")
            return
        emb = self.server.embedder
        texts = [t.root for t in request.texts]
        try:
            if not emb.ready():
                raise EmbedderNotReady if emb.error() is None else EmbedderUnavailable
            with ENDPOINT_PRIORITY.request():  # nur um das Einbetten (§19.2)
                vectors = emb.embed(texts)
            response = EmbedResponse.model_validate(
                {"model": emb.model, "dim": emb.dim, "vectors": vectors}
            ).model_dump_json()
        except EmbedderNotReady:
            self._error(503, "embedder_not_ready")
            return
        except EmbedderUnavailable:
            self._error(503, "embedder_unavailable")
            return
        except Exception:
            log.exception("Loopback: Einbetten fehlgeschlagen")  # ohne Texte, ohne Token
            self._error(500, "internal_error")
            return
        self._send_json(200, response)


class LoopbackServer:
    """Der Endpunkt mit Token-Datei. `start()` bindet, schreibt danach das Token und startet den
    Server-Thread. `stop()` beendet ihn und entfernt das eigene Token."""

    def __init__(self, data_dir: Path, embedder: Embedder, port: int) -> None:
        self.data_dir = data_dir
        self.embedder = embedder
        self.requested_port = port
        self._token: str | None = None
        self._httpd: _Server | None = None
        self._thread: threading.Thread | None = None

    @property
    def token(self) -> str | None:
        return self._token

    @property
    def address(self) -> tuple[str, int] | None:
        if self._httpd is None:
            return None
        return HOST, self._httpd.server_port

    def start(self) -> bool:
        """False: Port belegt, nicht bindbar oder Token nicht sicher schreibbar (protokolliert).
        Der Worker läuft dann ohne Endpunkt weiter."""
        try:
            httpd = _Server(self.requested_port, self.embedder)
        except OSError as exc:  # Token-Datei bleibt unberührt
            log.error(
                "Loopback-Endpunkt nicht gestartet, Suche nur mit Wortsuche",
                extra={"port": self.requested_port, "error": exc.strerror or type(exc).__name__},
            )
            return False
        token = secrets.token_hex(32)
        try:
            write_token(self.data_dir, token)
        except OSError as exc:
            httpd.server_close()
            log.error(
                "Loopback-Endpunkt nicht gestartet: Token nicht schreibbar",
                extra={"error": str(exc) if isinstance(exc, TokenError) else type(exc).__name__},
            )
            return False
        httpd.token_bytes = token.encode("ascii")
        self._token = token
        self._httpd = httpd
        self._thread = threading.Thread(
            target=httpd.serve_forever,
            kwargs={"poll_interval": POLL_INTERVAL_S},
            name="sg-loopback",
            daemon=True,
        )
        self._thread.start()
        log.info("Loopback-Endpunkt gestartet", extra={"host": HOST, "port": httpd.server_port})
        return True

    def stop(self) -> None:
        """Beendet den Server (idempotent) und entfernt das Token, wenn es noch das eigene ist."""
        httpd, self._httpd = self._httpd, None
        if httpd is None:
            return
        httpd.shutdown()
        httpd.server_close()
        if self._thread is not None:
            self._thread.join(timeout=5)
        path = token_path(self.data_dir)
        with contextlib.suppress(OSError):
            if not path.is_symlink() and path.read_text(encoding="ascii") == self._token:
                path.unlink()
        log.info("Loopback-Endpunkt beendet")


def start_server(
    data_dir: Path,
    embedder: Embedder,
    environ: Mapping[str, str] | None = None,
) -> LoopbackServer | None:
    """Beim Start des Workers: Endpunkt auf `SG_WORKER_PORT`. None, wenn er nicht läuft."""
    try:
        port = worker_port(environ)
    except ConfigError as exc:
        log.error("Loopback-Endpunkt nicht gestartet", extra={"error": str(exc)})
        return None
    server = LoopbackServer(data_dir, embedder, port)
    return server if server.start() else None
