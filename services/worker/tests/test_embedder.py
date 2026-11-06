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

    def __init__(self, name: str, *, device: str, dim: int = 1024, gate: Any = None) -> None:
        if gate is not None:
            gate.wait(10)
        self.name = name
        self.device = device
        self.dim = dim
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
        return SimpleNamespace(tolist=lambda: rows)


def stub_importer(
    *, mps: bool = True, dim: int = 1024, gate: Any = None, fail: Exception | None = None
) -> tuple[Any, dict[str, Any]]:
    seen: dict[str, Any] = {}

    def make(name: str, *, device: str) -> StubModel:
        if fail is not None:
            raise fail
        seen["model"] = StubModel(name, device=device, dim=dim, gate=gate)
        return seen["model"]

    st = SimpleNamespace(SentenceTransformer=make)
    torch = SimpleNamespace(backends=SimpleNamespace(mps=SimpleNamespace(is_available=lambda: mps)))
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
    call = model.calls[0]
    assert call["normalize_embeddings"] is True
    assert call["convert_to_numpy"] is True
    assert call["texts"] == ["Pivotelement"]  # keine Präfixe
    assert em.embedder_state(e) == "bereit"


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
    assert len(seen["model"].calls) == 40
    assert seen["model"].overlap is False


def test_safe_error_strips_home_and_paths() -> None:
    text = f"kaputt in {'/home/erfunden/x/y.bin'} und /tmp/a/b, " + "z" * 400
    out = em.safe_error(text)
    assert "/home/erfunden" not in out and "/tmp/a" not in out
    assert len(out) <= em.MAX_ERROR
