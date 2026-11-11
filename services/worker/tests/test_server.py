"""Loopback-Endpunkt (VERTRAEGE §19.4): Token, Bindung, Dateirechte, Antworten."""

from __future__ import annotations

import contextlib
import http.client
import json
import logging
import os
import socket
import stat
import threading
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from sg_schemas.models import EmbedResponse, WorkerHealth

from sg_worker import server as srv
from sg_worker.ai import embedder as em


class Stub:
    """Embedder mit festem Zustand."""

    provider = "bge-m3"
    model = "BAAI/bge-m3"
    dim = 1024

    def __init__(self, *, ready: bool, error: str | None = None) -> None:
        self._ready = ready
        self._error = error

    def ready(self) -> bool:
        return self._ready

    def error(self) -> str | None:
        return self._error

    def wait_ready(self, timeout_s: float) -> bool:
        return self._ready

    def embed(self, texts: list[str]) -> list[list[float]]:
        if not self._ready:
            raise em.EmbedderNotReady
        return [em.fake_vector(t) for t in texts]


@pytest.fixture(autouse=True)
def quick_stop(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(srv, "POLL_INTERVAL_S", 0.02)


def start(tmp_path: Path, embedder: Any) -> srv.LoopbackServer:
    server = srv.LoopbackServer(tmp_path, embedder, 0)  # freier Port
    assert server.start()
    return server


@pytest.fixture
def server(tmp_path: Path) -> Iterator[srv.LoopbackServer]:
    s = start(tmp_path, em.FakeEmbedder())
    try:
        yield s
    finally:
        s.stop()


def request(
    server: srv.LoopbackServer,
    method: str,
    path: str,
    body: Any = None,
    *,
    token: str | None = "",
    headers: dict[str, str] | None = None,
) -> tuple[int, dict[str, str], Any]:
    """`token=""`: richtiges Token, None: ohne Authorization."""
    assert server.address is not None
    conn = http.client.HTTPConnection(*server.address, timeout=10)
    hdrs = dict(headers or {})
    if token is not None:
        hdrs.setdefault("Authorization", f"Bearer {token or server.token}")
    data: bytes | None = None
    if body is not None:
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        hdrs.setdefault("Content-Type", "application/json")
    try:
        conn.request(method, path, body=data, headers=hdrs)
        resp = conn.getresponse()
        raw = resp.read()
        parsed = json.loads(raw) if raw else None
        return resp.status, {k.lower(): v for k, v in resp.getheaders()}, parsed
    finally:
        conn.close()


# ---------- Token und Bindung ----------


def test_binds_only_loopback(server: srv.LoopbackServer) -> None:
    assert server.address is not None
    assert server.address[0] == "127.0.0.1"
    # Über eine andere Adresse des Rechners ist der Port nicht erreichbar
    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        probe.connect(("192.0.2.1", 9))  # TEST-NET, es wird nichts gesendet
        own_ip = probe.getsockname()[0]
        probe.close()
    except OSError:
        pytest.skip("keine Nicht-Loopback-Adresse")
    if own_ip.startswith("127."):
        pytest.skip("keine Nicht-Loopback-Adresse")
    with pytest.raises(OSError), socket.create_connection((own_ip, server.address[1]), timeout=2):
        pass


def test_token_file_atomic_with_private_rights(tmp_path: Path) -> None:
    run = tmp_path / "run"
    run.mkdir(mode=0o755)
    os.chmod(run, 0o755)
    stale = run / "worker.token.part"
    stale.write_text("alt")
    os.chmod(stale, 0o644)
    s = start(tmp_path, em.FakeEmbedder())
    try:
        token_file = run / "worker.token"
        assert stat.S_IMODE(run.stat().st_mode) == 0o700
        assert stat.S_IMODE(token_file.stat().st_mode) == 0o600
        assert not stale.exists()
        content = token_file.read_text()
        assert content == s.token
        assert len(content) == 64 and int(content, 16) >= 0
    finally:
        s.stop()
    assert not (run / "worker.token").exists()  # eigenes Token beim Beenden entfernt


def test_new_token_per_start(tmp_path: Path) -> None:
    a = start(tmp_path, em.FakeEmbedder())
    a.stop()
    b = start(tmp_path, em.FakeEmbedder())
    try:
        assert a.token != b.token
        assert (tmp_path / "run" / "worker.token").read_text() == b.token
    finally:
        b.stop()


@pytest.mark.parametrize(
    "auth",
    [None, "Bearer falsch", "Basic abc", "Bearer", "bearer {t}x", "{t}"],
)
def test_missing_or_wrong_token_is_401(server: srv.LoopbackServer, auth: str | None) -> None:
    headers = {} if auth is None else {"Authorization": auth.replace("{t}", server.token)}
    for method, path in (("GET", "/health"), ("POST", "/embed"), ("GET", "/gibtsnicht")):
        body = {"texts": ["x"]} if method == "POST" else None
        status, hdrs, data = request(server, method, path, body, token=None, headers=headers)
        assert status == 401, (auth, path)
        assert data == {"code": "unauthorized"}
        assert hdrs["www-authenticate"] == "Bearer"


def test_bearer_scheme_is_case_insensitive(server: srv.LoopbackServer) -> None:
    status, _, _ = request(
        server, "GET", "/health", token=None, headers={"Authorization": f"bearer {server.token}"}
    )
    assert status == 200


def test_port_in_use_runs_without_endpoint(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    with socket.socket() as busy:
        busy.bind(("127.0.0.1", 0))
        busy.listen()
        port = busy.getsockname()[1]
        s = srv.LoopbackServer(tmp_path, em.FakeEmbedder(), port)
        with caplog.at_level(logging.ERROR, logger="sg_worker.server"):
            assert s.start() is False
        assert s.address is None
        assert not (tmp_path / "run" / "worker.token").exists()  # fremdes Token bleibt
        assert any("nicht gestartet" in r.getMessage() for r in caplog.records)
        s.stop()  # ohne Wirkung


def test_stop_closes_port(tmp_path: Path) -> None:
    s = start(tmp_path, em.FakeEmbedder())
    assert s.address is not None
    port = s.address[1]
    s.stop()
    s.stop()  # idempotent
    with pytest.raises(OSError), socket.create_connection(("127.0.0.1", port), timeout=2):
        pass


def test_token_never_logged_or_returned(
    server: srv.LoopbackServer, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.DEBUG):
        responses = [
            request(server, "GET", "/health"),
            request(server, "POST", "/embed", {"texts": ["Laufzeit"]}),
            request(server, "GET", "/x"),
            request(server, "GET", "/health", token=None, headers={"Authorization": "Bearer x"}),
        ]
    logged = " ".join(r.getMessage() + repr(r.__dict__) for r in caplog.records)
    assert caplog.records  # es wird protokolliert, nur ohne Token
    assert server.token not in logged
    assert all(server.token not in json.dumps(r[2]) + repr(r[1]) for r in responses)


def test_worker_port_config() -> None:
    assert srv.worker_port({}) == 4711
    assert srv.worker_port({"SG_WORKER_PORT": "5123"}) == 5123
    for bad in (
        "0",
        "70000",
        "abc",
        "-1",
        "²",
        "\u0664\u0667\u0661\u0661",
    ):  # Hochzahl, arabisch-indische Ziffern
        with pytest.raises(srv.ConfigError):
            srv.worker_port({"SG_WORKER_PORT": bad})


@pytest.mark.parametrize("port", ["x", "²"])
def test_start_server_with_bad_port_returns_none(tmp_path: Path, port: str) -> None:
    assert srv.start_server(tmp_path, em.FakeEmbedder(), {"SG_WORKER_PORT": port}) is None
    assert not (tmp_path / "run").exists()


# ---------- /health ----------


def test_health_ready(server: srv.LoopbackServer) -> None:
    status, hdrs, data = request(server, "GET", "/health")
    assert status == 200
    health = WorkerHealth.model_validate(data)
    assert health.embedder.model_dump(mode="json") == {
        "provider": "fake",
        "model": "fake-embed-1",
        "dim": 1024,
        "state": "bereit",
        "error": None,
    }
    assert hdrs["content-type"].startswith("application/json")
    assert not any(k.startswith("access-control-") for k in hdrs)


REASON = "sentence_transformers nicht importierbar (x)"


@pytest.mark.parametrize(
    ("stub", "state", "error"),
    [
        (Stub(ready=False), "laedt", None),
        (Stub(ready=False, error=REASON), "nicht_verfuegbar", REASON),
    ],
)
def test_health_states(tmp_path: Path, stub: Stub, state: str, error: str | None) -> None:
    s = start(tmp_path, stub)
    try:
        status, _, data = request(s, "GET", "/health")
        assert status == 200
        assert data["embedder"]["state"] == state
        assert data["embedder"]["error"] == error
        WorkerHealth.model_validate(data)
    finally:
        s.stop()


def test_health_of_real_bge_without_package(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.setitem(__import__("sys").modules, "sentence_transformers", None)
    bge = em.BgeM3Embedder()
    bge.wait_ready(10)
    s = start(tmp_path, bge)
    try:
        status, _, data = request(s, "GET", "/health")
        assert data["embedder"]["state"] == "nicht_verfuegbar"
        status, _, data = request(s, "POST", "/embed", {"texts": ["x"]})
        assert (status, data) == (503, {"code": "embedder_unavailable"})
    finally:
        s.stop()


# ---------- /embed ----------


def test_embed_returns_vectors(server: srv.LoopbackServer) -> None:
    status, _, data = request(server, "POST", "/embed", {"texts": ["Laufzeit", "Rekursion"]})
    assert status == 200
    resp = EmbedResponse.model_validate(data)
    assert (resp.model, resp.dim) == ("fake-embed-1", 1024)
    assert [v.root for v in resp.vectors] == [
        em.fake_vector("Laufzeit"),
        em.fake_vector("Rekursion"),
    ]


def test_embed_not_ready_or_unavailable_is_503(tmp_path: Path) -> None:
    for stub, code in (
        (Stub(ready=False), "embedder_not_ready"),
        (Stub(ready=False, error="kaputt"), "embedder_unavailable"),
    ):
        s = start(tmp_path, stub)
        try:
            status, _, data = request(s, "POST", "/embed", {"texts": ["x"]})
            assert (status, data) == (503, {"code": code})
        finally:
            s.stop()


@pytest.mark.parametrize(
    "body",
    [
        b"{kaputt",
        b"[]",
        {"texts": []},
        {"texts": [""]},
        {"texts": ["x"] * 17},
        {"texts": ["x" * 2001]},
        {"texts": [1]},
        {"texts": ["x"], "extra": 1},
    ],
)
def test_embed_invalid_is_400(server: srv.LoopbackServer, body: Any) -> None:
    status, _, data = request(server, "POST", "/embed", body)
    assert (status, data) == (400, {"code": "validation_failed"})


def test_embed_limits_are_inclusive(server: srv.LoopbackServer) -> None:
    status, _, data = request(server, "POST", "/embed", {"texts": ["x" * 2000] * 16})
    assert status == 200 and len(data["vectors"]) == 16


def test_body_too_large_is_413(server: srv.LoopbackServer) -> None:
    big = json.dumps({"texts": ["x" * 2000] * 140}).encode()
    assert len(big) > 256 * 1024
    status, _, data = request(server, "POST", "/embed", big)
    assert (status, data) == (413, {"code": "payload_too_large"})
    # Der Server bleibt benutzbar
    assert request(server, "GET", "/health")[0] == 200


def test_content_length_announcing_too_much_is_413_without_reading(
    server: srv.LoopbackServer,
) -> None:
    assert server.address is not None
    with socket.create_connection(server.address, timeout=5) as sock:
        sock.sendall(
            b"POST /embed HTTP/1.1\r\nHost: "
            + f"127.0.0.1:{server.address[1]}".encode()
            + b"\r\nAuthorization: Bearer "
            + server.token.encode()
            + b"\r\nContent-Type: application/json\r\nContent-Length: 999999999\r\n\r\n{"
        )
        answer = sock.recv(4096)
    assert answer.startswith(b"HTTP/1.0 413")


def test_embed_needs_json_content_type(server: srv.LoopbackServer) -> None:
    status, _, data = request(
        server, "POST", "/embed", {"texts": ["x"]}, headers={"Content-Type": "text/plain"}
    )
    assert (status, data) == (415, {"code": "unsupported_media_type"})
    status, _, _ = request(
        server,
        "POST",
        "/embed",
        {"texts": ["x"]},
        headers={"Content-Type": "application/json; charset=utf-8"},
    )
    assert status == 200


# ---------- Pfade und Methoden ----------


def test_unknown_path_is_404_and_wrong_method_405(server: srv.LoopbackServer) -> None:
    assert request(server, "GET", "/")[0] == 404
    assert request(server, "POST", "/embed/x", {"texts": ["x"]})[0] == 404
    status, hdrs, data = request(server, "GET", "/embed")
    assert (status, hdrs["allow"], data) == (405, "POST", {"code": "method_not_allowed"})
    status, hdrs, _ = request(server, "POST", "/health", {"texts": ["x"]})
    assert (status, hdrs["allow"]) == (405, "GET")
    for method in ("PUT", "DELETE", "PATCH", "OPTIONS"):
        status, hdrs, _ = request(server, method, "/health")
        assert status == 405, method
        assert not any(k.startswith("access-control-") for k in hdrs)
    assert request(server, "GET", "/health?x=1")[0] == 200


# ---------- Grenzen (§19.4) ----------


def raw_request(server: srv.LoopbackServer, head: str, body: bytes = b"") -> bytes:
    """Schickt eine Anfrage von Hand. `{host}`/`{token}` werden ersetzt."""
    assert server.address is not None and server.token is not None
    text = head.replace("{host}", f"127.0.0.1:{server.address[1]}").replace("{token}", server.token)
    with socket.create_connection(server.address, timeout=5) as sock:
        sock.sendall(text.replace("\n", "\r\n").encode("latin-1") + b"\r\n" + body)
        chunks = []
        while data := sock.recv(65536):
            chunks.append(data)
    return b"".join(chunks)


def test_content_length_is_required(server: srv.LoopbackServer) -> None:
    head = "POST /embed HTTP/1.1\nHost: {host}\nAuthorization: Bearer {token}\n"
    head += "Content-Type: application/json\n"
    answer = raw_request(server, head)
    assert answer.startswith(b"HTTP/1.0 411") and b'"length_required"' in answer
    chunked = head + "Transfer-Encoding: chunked\n"
    answer = raw_request(server, chunked, b"5\r\nhallo\r\n0\r\n\r\n")
    assert answer.startswith(b"HTTP/1.0 411")


@pytest.mark.parametrize("host", ["localhost:{port}", "127.0.0.1", "evil.example:{port}", None])
def test_host_must_be_loopback_with_port(server: srv.LoopbackServer, host: str | None) -> None:
    assert server.address is not None
    headers = {} if host is None else {"Host": host.replace("{port}", str(server.address[1]))}
    conn = http.client.HTTPConnection(*server.address, timeout=5)
    try:
        conn.putrequest("GET", "/health", skip_host=True)
        for key, value in {**headers, "Authorization": f"Bearer {server.token}"}.items():
            conn.putheader(key, value)
        conn.endheaders()
        resp = conn.getresponse()
        assert (resp.status, json.loads(resp.read())) == (400, {"code": "invalid_host"})
    finally:
        conn.close()


def test_at_most_four_concurrent_requests(tmp_path: Path) -> None:
    gate = threading.Event()
    entered = threading.Semaphore(0)

    class Slow(em.FakeEmbedder):
        def embed(self, texts: list[str]) -> list[list[float]]:
            entered.release()
            gate.wait(5)
            return super().embed(texts)

    s = start(tmp_path, Slow())
    results: list[int] = []
    try:
        threads = [
            threading.Thread(
                target=lambda: results.append(request(s, "POST", "/embed", {"texts": ["x"]})[0])
            )
            for _ in range(4)
        ]
        for t in threads:
            t.start()
        for _ in range(4):
            assert entered.acquire(timeout=5)
        status, _, data = request(s, "GET", "/health")
        assert (status, data) == (503, {"code": "busy"})
        gate.set()
        for t in threads:
            t.join()
        assert results == [200] * 4
        assert request(s, "GET", "/health")[0] == 200
    finally:
        gate.set()
        s.stop()


def test_slow_client_is_cut_after_timeout(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(srv, "CONNECTION_TIMEOUT_S", 0.3)
    s = start(tmp_path, em.FakeEmbedder())
    try:
        assert s.address is not None
        with socket.create_connection(s.address, timeout=5) as sock:
            sock.sendall(b"GET /health HTTP/1.1\r\n")  # Kopfzeilen kommen nie
            t0 = time.monotonic()
            assert sock.recv(100) == b""  # Server schließt nach dem Zeitlimit
            assert time.monotonic() - t0 < 3
    finally:
        s.stop()


def test_symlinked_run_dir_disables_endpoint(tmp_path: Path) -> None:
    elsewhere = tmp_path / "anderswo"
    elsewhere.mkdir()
    data = tmp_path / "daten"
    data.mkdir()
    (data / "run").symlink_to(elsewhere, target_is_directory=True)
    s = srv.LoopbackServer(data, em.FakeEmbedder(), 0)
    assert s.start() is False and s.address is None
    assert list(elsewhere.iterdir()) == []


def test_symlinked_token_file_disables_endpoint(tmp_path: Path) -> None:
    target = tmp_path / "ziel.txt"
    target.write_text("unberührt")
    run = tmp_path / "daten" / "run"
    run.mkdir(parents=True)
    (run / "worker.token").symlink_to(target)
    s = srv.LoopbackServer(tmp_path / "daten", em.FakeEmbedder(), 0)
    assert s.start() is False
    assert target.read_text() == "unberührt"


def test_request_log_has_only_method_path_status_duration(
    server: srv.LoopbackServer, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.DEBUG, logger="sg_worker.server"):
        request(server, "POST", "/embed?geheim=1", {"texts": ["vertraulicher Suchtext"]})
    [record] = [r for r in caplog.records if r.getMessage() == "Loopback-Anfrage"]
    assert (record.method, record.path, record.status) == ("POST", "/embed", 200)  # type: ignore[attr-defined]
    assert isinstance(record.duration_ms, int)  # type: ignore[attr-defined]
    dump = repr(record.__dict__)
    assert "vertraulich" not in dump and "geheim" not in dump and str(server.token) not in dump


def test_embed_is_never_throttled(server: srv.LoopbackServer, monkeypatch: Any) -> None:
    """`SG_EMBED_PAUSE_MS` gilt nur für `search.index`: Der Endpunkt pausiert nie."""
    pauses: list[int] = []
    waits: list[Any] = []
    em.configure_tuning(pause_ms=5000)
    monkeypatch.setattr(em, "pause_between_batches", lambda: pauses.append(1))
    monkeypatch.setattr(em.SHUTDOWN, "wait", lambda t=None: waits.append(t) or False)
    try:
        t0 = time.monotonic()
        status, _, _ = request(server, "POST", "/embed", {"texts": ["Laufzeit"] * 16})
        assert status == 200
        assert time.monotonic() - t0 < 2
        assert pauses == [] and waits == []
    finally:
        em.configure_tuning()


def test_embed_requests_get_priority_over_jobs(tmp_path: Path) -> None:
    gate = threading.Event()

    class Slow(em.FakeEmbedder):
        def embed(self, texts: list[str]) -> list[list[float]]:
            gate.wait(5)
            return super().embed(texts)

    s = start(tmp_path, Slow())
    try:
        t = threading.Thread(target=lambda: request(s, "POST", "/embed", {"texts": ["x"]}))
        t.start()
        deadline = time.monotonic() + 5
        while em.ENDPOINT_PRIORITY.pending == 0 and time.monotonic() < deadline:
            time.sleep(0.01)
        assert em.ENDPOINT_PRIORITY.pending == 1
        assert em.ENDPOINT_PRIORITY.wait_idle(0.05) is False  # die Job-Schleife wartet
        gate.set()
        t.join()
        assert em.ENDPOINT_PRIORITY.wait_idle(1) is True
    finally:
        gate.set()
        s.stop()


# ---------- Nacharbeit Review #163 ----------


@pytest.fixture
def reset_shutdown() -> Iterator[None]:
    em.SHUTDOWN.clear()
    yield
    em.SHUTDOWN.clear()


def test_stop_removes_only_own_token(tmp_path: Path) -> None:
    s = start(tmp_path, em.FakeEmbedder())
    token_file = tmp_path / "run" / "worker.token"
    token_file.write_text("f" * 64)  # inzwischen von einem anderen Worker geschrieben
    s.stop()
    assert token_file.read_text() == "f" * 64


@pytest.mark.parametrize("length", ["²", "1 0", "-5", "0x10"])
def test_non_ascii_content_length_is_400(server: srv.LoopbackServer, length: str) -> None:
    head = "POST /embed HTTP/1.1\nHost: {host}\nAuthorization: Bearer {token}\n"
    head += f"Content-Type: application/json\nContent-Length: {length}\n"
    answer = raw_request(server, head)
    assert answer.startswith(b"HTTP/1.0 400") and b'"validation_failed"' in answer


def test_invalid_vectors_give_500(tmp_path: Path) -> None:
    class Broken(em.FakeEmbedder):
        def embed(self, texts: list[str]) -> list[list[float]]:
            return [[0.5] * 3 for _ in texts]  # falsche Länge

    s = start(tmp_path, Broken())
    try:
        status, _, data = request(s, "POST", "/embed", {"texts": ["x"]})
        assert (status, data) == (500, {"code": "internal_error"})
        assert request(s, "GET", "/health")[0] == 200  # Server lebt weiter
    finally:
        s.stop()


def test_invalid_health_gives_500(tmp_path: Path) -> None:
    broken = em.FakeEmbedder(provider="")  # verletzt WorkerHealth (minLength 1)
    s = start(tmp_path, broken)
    try:
        status, _, data = request(s, "GET", "/health")
        assert (status, data) == (500, {"code": "internal_error"})
    finally:
        s.stop()


def test_priority_only_while_embedding(tmp_path: Path) -> None:
    seen: list[int] = []

    class Watching(em.FakeEmbedder):
        def embed(self, texts: list[str]) -> list[list[float]]:
            seen.append(em.ENDPOINT_PRIORITY.pending)
            return super().embed(texts)

    s = start(tmp_path, Watching())
    try:
        assert s.address is not None and s.token is not None
        body = json.dumps({"texts": ["Laufzeit"]}).encode()
        head = (
            f"POST /embed HTTP/1.1\r\nHost: 127.0.0.1:{s.address[1]}\r\n"
            f"Authorization: Bearer {s.token}\r\nContent-Type: application/json\r\n"
            f"Content-Length: {len(body)}\r\n\r\n"
        ).encode()
        with socket.create_connection(s.address, timeout=5) as sock:
            sock.sendall(head + body[:5])  # Body kommt langsam
            time.sleep(0.2)
            assert em.ENDPOINT_PRIORITY.pending == 0  # beim Lesen noch nicht angemeldet
            sock.sendall(body[5:])
            answer = sock.recv(65536)
        assert answer.startswith(b"HTTP/1.0 200")
        assert seen == [1]
        assert em.ENDPOINT_PRIORITY.pending == 0
        # Ungültige oder nicht bereite Anfragen melden sich gar nicht an
        assert request(s, "POST", "/embed", {"texts": []})[0] == 400
        assert seen == [1]
    finally:
        s.stop()


def test_open_connections_are_capped(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(srv, "MAX_CONNECTIONS", 3)
    s = start(tmp_path, em.FakeEmbedder())
    idle: list[socket.socket] = []
    try:
        assert s.address is not None and s._httpd is not None
        for _ in range(3):  # offen, aber ohne Kopfzeilen
            idle.append(socket.create_connection(s.address, timeout=5))
        deadline = time.monotonic() + 5
        while s._httpd.open_connections < 3 and time.monotonic() < deadline:
            time.sleep(0.01)
        assert s._httpd.open_connections == 3
        with socket.create_connection(s.address, timeout=5) as extra:
            t0 = time.monotonic()
            with contextlib.suppress(ConnectionResetError):
                assert extra.recv(100) == b""  # sofort geschlossen
            assert time.monotonic() - t0 < 2
        for sock in idle:
            sock.close()
        deadline = time.monotonic() + 5
        while s._httpd.open_connections > 0 and time.monotonic() < deadline:
            time.sleep(0.01)
        assert request(s, "GET", "/health")[0] == 200
        deadline = time.monotonic() + 5
        while s._httpd.open_connections > 0 and time.monotonic() < deadline:
            time.sleep(0.01)
        assert s._httpd.open_connections == 0
    finally:
        for sock in idle:
            sock.close()
        s.stop()


def test_token_dir_is_fsynced(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    synced: list[bool] = []
    real_fsync = os.fsync

    def spy(fd: int) -> None:
        synced.append(stat.S_ISDIR(os.fstat(fd).st_mode))
        real_fsync(fd)

    monkeypatch.setattr(srv.os, "fsync", spy)
    srv.write_token(tmp_path, "a" * 64)
    assert synced == [False, True]  # erst die Datei, nach dem Umbenennen der Ordner


@pytest.mark.usefixtures("reset_shutdown")
def test_wait_idle_returns_on_shutdown() -> None:
    with em.ENDPOINT_PRIORITY.request():
        t0 = time.monotonic()
        threading.Timer(0.1, em.request_shutdown).start()
        assert em.ENDPOINT_PRIORITY.wait_idle(10) is False
        assert time.monotonic() - t0 < 2


def test_timer_start_failure_closes_connection_and_frees_counter(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    s = start(tmp_path, em.FakeEmbedder())
    try:
        httpd = s._httpd
        assert httpd is not None
        client, server_side = socket.socketpair()
        with httpd._open_lock:
            httpd._open += 1  # wie `process_request`, bevor der Thread startet

        def boom(self: threading.Timer) -> None:
            raise RuntimeError("can't start new thread")

        monkeypatch.setattr(srv.threading.Timer, "start", boom)
        with pytest.raises(RuntimeError):
            httpd.process_request_thread(server_side, ("127.0.0.1", 0))
        assert httpd.open_connections == 0
        assert server_side.fileno() == -1  # Verbindung geschlossen
        client.settimeout(2)
        assert client.recv(10) == b""
        client.close()
    finally:
        s.stop()


def test_token_dir_fsync_failure_only_warns(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    real_fsync = os.fsync

    def failing(fd: int) -> None:
        if stat.S_ISDIR(os.fstat(fd).st_mode):
            raise OSError(5, "Input/output error")
        real_fsync(fd)

    monkeypatch.setattr(srv.os, "fsync", failing)
    token = "b" * 64
    with caplog.at_level(logging.WARNING, logger=srv.log.name):
        final = srv.write_token(tmp_path, token)
    assert final.read_text() == token  # Token liegt an seinem Platz
    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 1
    assert token not in caplog.text and str(tmp_path) not in caplog.text
