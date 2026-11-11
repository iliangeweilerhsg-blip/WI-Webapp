"""Embedder (VERTRAEGE §19.2): Fake, Auswahl, `bge-m3` mit Attrappe statt sentence-transformers."""

from __future__ import annotations

import hashlib
import importlib.util
import math
import sys
import threading
import time
from types import SimpleNamespace
from typing import Any

import pytest

from sg_worker.ai import embedder as em


def cos(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b, strict=True))


def norm(v: list[float]) -> float:
    return math.sqrt(sum(x * x for x in v))


# ---------- Fake ----------


def test_fake_is_deterministic_and_normalized() -> None:
    text = "Der Quicksort teilt die Liste am Pivotelement."
    a = em.FakeEmbedder().embed([text])[0]
    b = em.FakeEmbedder().embed([text, "anderes"])[0]
    assert a == b
    assert len(a) == 1024
    assert norm(a) == pytest.approx(1.0)


def test_fake_follows_the_contract_exactly() -> None:
    # Ein Wort: genau eine Position mit ±1 (nach Normierung)
    h = hashlib.sha256(b"pivotelement").digest()
    pos = int.from_bytes(h[0:4], "big") % 1024
    sign = 1.0 if h[4] % 2 == 0 else -1.0
    vec = em.fake_vector("PIVOTELEMENT")
    assert vec[pos] == sign
    assert sum(1 for x in vec if x) == 1


def test_fake_words_casefold_unicode_and_min_length() -> None:
    assert em.fake_words("Straße, x 7 42 Café_Bar ÄÖÜ") == ["strasse", "42", "café", "bar", "äöü"]
    assert em.fake_vector("Straße") == em.fake_vector("STRASSE")
    # NFC vor dem Zerlegen: kombinierendes Akzentzeichen zählt wie das fertige Zeichen
    assert em.fake_words("Cafe\u0301 Ma\u0308rz") == ["café", "märz"]
    assert em.fake_vector("Cafe\u0301") == em.fake_vector("Café")


def test_fake_similar_words_give_similar_vectors() -> None:
    [a, b, c] = em.FakeEmbedder().embed(
        [
            "Sortieralgorithmen und ihre Laufzeit",
            "Laufzeit der Sortieralgorithmen",
            "Photosynthese im Chlorophyll",
        ]
    )
    assert cos(a, b) > 0.5  # 2 gemeinsame von 4 bzw. 3 Wörtern: 2 / sqrt(12)
    assert abs(cos(a, c)) < 0.3
    assert cos(a, b) > cos(a, c)


def test_fake_without_words_is_zero_vector() -> None:
    assert not any(em.fake_vector("a . ! b"))
    assert not any(em.fake_vector(""))


def test_fake_is_ready_immediately() -> None:
    fake = em.FakeEmbedder()
    assert (fake.provider, fake.model, fake.dim) == ("fake", "fake-embed-1", 1024)
    assert fake.ready() and fake.wait_ready(0) and fake.error() is None
    assert em.embedder_state(fake) == "bereit"


# ---------- Auswahl ----------


def test_make_embedder_selection() -> None:
    assert isinstance(em.make_embedder({"SG_EMBEDDER": "fake"}), em.FakeEmbedder)
    default = em.make_embedder({})
    assert isinstance(default, em.BgeM3Embedder)
    assert (default.provider, default.model) == ("bge-m3", "BAAI/bge-m3")
    custom = em.make_embedder({"SG_EMBEDDER": "bge-m3", "SG_EMBED_MODEL": "erfunden/modell"})
    assert custom.model == "erfunden/modell"


def test_unknown_provider_is_unavailable() -> None:
    e = em.make_embedder({"SG_EMBEDDER": "gibtsnicht"})
    assert em.embedder_state(e) == "nicht_verfuegbar"
    assert "gibtsnicht" in (e.error() or "")
    assert e.wait_ready(0) is False
    with pytest.raises(em.EmbedderUnavailable):
        e.embed(["x"])


def test_shared_embedder_is_one_instance(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SG_EMBEDDER", "fake")
    em.set_shared_embedder(None)
    try:
        first = em.shared_embedder()
        assert first is em.shared_embedder()
        assert isinstance(first, em.FakeEmbedder)
    finally:
        em.set_shared_embedder(None)


# ---------- bge-m3 ohne sentence-transformers ----------


@pytest.mark.skipif(
    importlib.util.find_spec("sentence_transformers") is not None,
    reason="sentence-transformers ist installiert (Mac)",
)
def test_bge_without_package_is_unavailable() -> None:
    e = em.BgeM3Embedder()
    assert e.wait_ready(10) is False
    assert em.embedder_state(e) == "nicht_verfuegbar"
    assert e.error() == "sentence_transformers nicht importierbar (sentence_transformers)"
    with pytest.raises(em.EmbedderUnavailable):
        e.embed(["Text"])


def test_bge_import_error_is_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(sys.modules, "sentence_transformers", None)  # Import scheitert
    e = em.BgeM3Embedder()
    e.start()
    assert e.wait_ready(10) is False
    assert (e.error() or "").startswith("sentence_transformers nicht importierbar")


# ---------- bge-m3 mit Attrappe ----------


class StubModel:
    """Attrappe für `SentenceTransformer`: zählt gleichzeitige Aufrufe von `encode`."""

    def __init__(
        self,
        name: str,
        *,
        device: str,
        dim: int = 1024,
        gate: Any = None,
        model_kwargs: dict[str, Any] | None = None,
        nan_in: tuple[str, ...] = (),
    ) -> None:
        if gate is not None:
            gate.wait(10)
        self.name = name
        self.device = device
        self.dim = dim
        self.model_kwargs = model_kwargs
        self.dtype = (model_kwargs or {}).get("dtype", "float32")
        self.nan_in = nan_in
        self.max_seq_length = 8192
        self.calls: list[dict[str, Any]] = []
        self.active = 0
        self.overlap = False

    def get_embedding_dimension(self) -> int:
        return self.dim

    def encode(self, texts: list[str], **kwargs: Any) -> Any:
        self.active += 1
        if self.active > 1:
            self.overlap = True
        time.sleep(0.002)
        self.calls.append({"texts": list(texts), **kwargs})
        self.active -= 1
        rows = [em.fake_vector(t) for t in texts]
        if self.dtype in self.nan_in:
            rows = [[math.nan] * self.dim for _ in texts]
        return SimpleNamespace(tolist=lambda: rows)

    def float(self) -> StubModel:
        self.dtype = "float32"
        return self


def stub_importer(
    *,
    mps: bool = True,
    dim: int = 1024,
    gate: Any = None,
    fail: Exception | None = None,
    nan_in: tuple[str, ...] = (),
) -> tuple[Any, dict[str, Any]]:
    seen: dict[str, Any] = {"threads": [], "empty_cache": 0}

    def make(name: str, **kwargs: Any) -> StubModel:
        if fail is not None:
            raise fail
        seen["kwargs"] = kwargs
        seen["model"] = StubModel(name, dim=dim, gate=gate, nan_in=nan_in, **kwargs)
        return seen["model"]

    def empty_cache() -> None:
        seen["empty_cache"] += 1

    st = SimpleNamespace(SentenceTransformer=make)
    torch = SimpleNamespace(
        backends=SimpleNamespace(mps=SimpleNamespace(is_available=lambda: mps)),
        float16="float16",
        set_num_threads=seen["threads"].append,
        mps=SimpleNamespace(empty_cache=empty_cache),
    )
    return (lambda: (st, torch)), seen


@pytest.mark.parametrize(("mps", "device"), [(True, "mps"), (False, "cpu")])
def test_bge_loads_with_contract_settings(mps: bool, device: str) -> None:
    importer, seen = stub_importer(mps=mps)
    e = em.BgeM3Embedder(model="BAAI/bge-m3", importer=importer)
    e.start()
    assert e.wait_ready(10) is True
    model = seen["model"]
    assert (model.name, model.device, e.device) == ("BAAI/bge-m3", device, device)
    assert model.max_seq_length == 512
    [vec] = e.embed(["Pivotelement"])
    assert vec == em.fake_vector("Pivotelement")
    call = model.calls[-1]
    assert call["normalize_embeddings"] is True
    assert call["convert_to_numpy"] is True
    assert call["texts"] == ["Pivotelement"]  # keine Präfixe
    assert em.embedder_state(e) == "bereit"


# ---------- Entlastung: fp16, Threads, Zwischenspeicher ----------


@pytest.fixture
def tuning() -> Any:
    yield
    em.configure_tuning()


@pytest.mark.parametrize(
    ("device", "dtype"),
    [("mps", "float16"), ("cuda", "float16"), ("cuda:0", "float16"), ("cpu", "float32")],
)
def test_pick_dtype_per_device(device: str, dtype: str) -> None:
    assert em.pick_dtype(device) == dtype


def test_bge_loads_fp16_on_mps() -> None:
    importer, seen = stub_importer(mps=True)
    e = em.BgeM3Embedder(importer=importer)
    assert e.wait_ready(10)
    assert seen["kwargs"] == {"device": "mps", "model_kwargs": {"dtype": "float16"}}
    assert (e.device, e.dtype) == ("mps", "float16")
    # Probelauf beim Laden, danach den Zwischenspeicher des Geräts freigeben
    assert [c["texts"] for c in seen["model"].calls] == [[em.WARMUP_TEXT]]
    assert seen["empty_cache"] == 1
    [vec] = e.embed(["Pivotelement"])
    assert len(vec) == 1024 and abs(norm(vec) - 1.0) < 1e-12


def test_bge_stays_fp32_on_cpu() -> None:
    importer, seen = stub_importer(mps=False)
    e = em.BgeM3Embedder(importer=importer)
    assert e.wait_ready(10)
    assert seen["kwargs"] == {"device": "cpu"}  # kein dtype: fp32 wie bisher
    assert (e.device, e.dtype) == ("cpu", "float32")
    assert seen["model"].calls == [] and seen["empty_cache"] == 0
    e.release_cache()
    assert seen["empty_cache"] == 0  # nur auf mps


def test_bge_falls_back_to_fp32_when_fp16_gives_nan() -> None:
    importer, seen = stub_importer(mps=True, nan_in=("float16",))
    e = em.BgeM3Embedder(importer=importer)
    assert e.wait_ready(10)
    assert (e.dtype, seen["model"].dtype) == ("float32", "float32")
    assert e.embed(["Laufzeit"]) == [em.fake_vector("Laufzeit")]


def test_bge_falls_back_to_fp32_when_fp16_probe_raises() -> None:
    """Scheitert fp16 auf dem Gerät ganz (fehlende Half-Operation), bleibt der Embedder nutzbar."""
    importer, seen = stub_importer(mps=True)
    st, torch = importer()
    make = st.SentenceTransformer

    def make_failing_fp16(name: str, **kwargs: Any) -> Any:
        model = make(name, **kwargs)
        encode = model.encode

        def encode_or_fail(texts: list[str], **kw: Any) -> Any:
            if model.dtype == "float16":
                raise RuntimeError("MPS: Half nicht unterstützt")
            return encode(texts, **kw)

        model.encode = encode_or_fail
        return model

    st.SentenceTransformer = make_failing_fp16
    e = em.BgeM3Embedder(importer=lambda: (st, torch))
    assert e.wait_ready(10) is True and e.error() is None
    assert (e.dtype, seen["model"].dtype) == ("float32", "float32")
    assert e.embed(["Laufzeit"]) == [em.fake_vector("Laufzeit")]


def test_bge_renormalizes_fp16_vectors() -> None:
    importer, seen = stub_importer()
    e = em.BgeM3Embedder(importer=importer)
    assert e.wait_ready(10)
    # fp16 normiert nur grob: Länge 0,999 statt 1
    rows = [[0.999 * x for x in em.fake_vector("Laufzeit Rekursion")]]
    seen["model"].encode = lambda texts, **kw: SimpleNamespace(tolist=lambda: rows)
    [vec] = e.embed(["x"])
    assert abs(norm(vec) - 1.0) < 1e-12
    assert cos(vec, em.fake_vector("Laufzeit Rekursion")) > 1 - 1e-12


def test_unit_keeps_zero_and_invalid_rows() -> None:
    assert em._unit([0.0, 0.0]) == [0.0, 0.0]
    assert math.isnan(em._unit([math.nan, 1.0])[0])
    assert em._unit([3, 4]) == [0.6, 0.8]


@pytest.mark.usefixtures("tuning")
def test_bge_sets_torch_threads() -> None:
    em.configure_tuning(threads=3)
    importer, seen = stub_importer()
    assert em.BgeM3Embedder(importer=importer).wait_ready(10)
    assert seen["threads"] == [3]


@pytest.mark.usefixtures("tuning")
def test_default_threads_are_half_the_cores(monkeypatch: pytest.MonkeyPatch) -> None:
    em.configure_tuning()
    monkeypatch.setattr("os.cpu_count", lambda: 8)
    assert em.embed_threads() == 4
    monkeypatch.setattr("os.cpu_count", lambda: 1)
    assert em.embed_threads() == 1
    monkeypatch.setattr("os.cpu_count", lambda: None)
    assert em.embed_threads() == 1


def test_bge_survives_failing_set_num_threads_and_empty_cache() -> None:
    importer, _ = stub_importer()
    st, torch = importer()

    def boom(*_: Any) -> None:
        raise RuntimeError("nein")

    torch.set_num_threads = boom
    torch.mps.empty_cache = boom
    e = em.BgeM3Embedder(importer=lambda: (st, torch))
    assert e.wait_ready(10) is True and e.error() is None


@pytest.mark.usefixtures("tuning", "reset_shutdown")
def test_pause_between_batches_waits_and_stops_on_shutdown() -> None:
    em.configure_tuning(pause_ms=60)
    assert em.index_pause_s() == 0.06
    t0 = time.monotonic()
    em.pause_between_batches()
    assert time.monotonic() - t0 >= 0.05
    em.configure_tuning(pause_ms=0)
    t0 = time.monotonic()
    em.pause_between_batches()
    assert time.monotonic() - t0 < 0.05
    em.configure_tuning(pause_ms=5000)
    em.request_shutdown()
    t0 = time.monotonic()
    em.pause_between_batches()
    assert time.monotonic() - t0 < 1


def test_embed_itself_never_pauses(monkeypatch: pytest.MonkeyPatch) -> None:
    """Die Drosselung liegt im Handler von `search.index`, nicht im Embedder."""
    waits: list[float] = []
    monkeypatch.setattr(em.SHUTDOWN, "wait", lambda t=None: waits.append(t) or False)
    importer, _ = stub_importer()
    e = em.BgeM3Embedder(importer=importer)
    assert e.wait_ready(10)
    for _ in range(5):
        e.embed(["Laufzeit"])
    em.FakeEmbedder().embed(["Laufzeit"])
    assert waits == []


def test_bge_is_loading_until_model_is_there() -> None:
    gate = threading.Event()
    importer, _ = stub_importer(gate=gate)
    e = em.BgeM3Embedder(importer=importer)
    e.start()
    assert em.embedder_state(e) == "laedt"
    assert e.wait_ready(0.05) is False
    with pytest.raises(em.EmbedderNotReady):
        e.embed(["x"])
    gate.set()
    assert e.wait_ready(10) is True


def test_bge_wrong_dimension_is_unavailable() -> None:
    importer, _ = stub_importer(dim=768)
    e = em.BgeM3Embedder(importer=importer)
    assert e.wait_ready(10) is False
    assert e.error() == "Modell liefert 768 statt 1024 Dimensionen"


def test_bge_load_error_has_no_paths() -> None:
    importer, _ = stub_importer(
        fail=OSError("Kein Netz für /Users/erfunden/.cache/huggingface/hub")
    )
    e = em.BgeM3Embedder(importer=importer)
    assert e.wait_ready(10) is False
    error = e.error() or ""
    assert error.startswith("Modell nicht ladbar (OSError")
    assert "/Users" not in error and "<Pfad>" in error


def test_bge_embed_is_thread_safe() -> None:
    importer, seen = stub_importer()
    e = em.BgeM3Embedder(importer=importer)
    assert e.wait_ready(10)
    errors: list[BaseException] = []

    def work() -> None:
        try:
            for _ in range(5):
                e.embed(["Laufzeit", "Rekursion"])
        except BaseException as exc:
            errors.append(exc)

    threads = [threading.Thread(target=work) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == []
    assert len(seen["model"].calls) == 41  # 40 und der Probelauf nach dem Laden (mps)
    assert seen["model"].overlap is False


def test_safe_error_strips_home_and_paths() -> None:
    text = f"kaputt in {'/home/erfunden/x/y.bin'} und /tmp/a/b, " + "z" * 400
    out = em.safe_error(text)
    assert "/home/erfunden" not in out and "/tmp/a" not in out
    assert len(out) <= em.MAX_ERROR


# ---------- Stopp-Signal ----------


@pytest.fixture
def reset_shutdown() -> Any:
    em.SHUTDOWN.clear()
    yield
    em.SHUTDOWN.clear()


@pytest.mark.usefixtures("reset_shutdown")
def test_wait_ready_returns_on_shutdown() -> None:
    gate = threading.Event()
    importer, _ = stub_importer(gate=gate)
    e = em.BgeM3Embedder(importer=importer)
    e.start()
    t0 = time.monotonic()
    threading.Timer(0.1, em.request_shutdown).start()
    assert e.wait_ready(600) is False
    assert time.monotonic() - t0 < 3
    gate.set()


@pytest.mark.usefixtures("reset_shutdown")
def test_shutdown_when_triggers() -> None:
    flag = threading.Event()
    thread = em.shutdown_when(flag.is_set, interval_s=0.01)
    assert not em.SHUTDOWN.is_set()
    flag.set()
    thread.join(2)
    assert em.SHUTDOWN.is_set()
