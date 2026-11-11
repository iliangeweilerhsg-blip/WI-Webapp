"""`search.index` gegen das echte Schema des Core (VERTRAEGE §19.1, §19.3), Fake-Embedder.

Die Migrationen des Core laufen in ein eigenes Schema je Test (wie `test_maintenance.py`), damit
`search_chunk` mit `vector`, `tsvector`, CHECKs und FKs genau so entsteht wie im Core.
"""

from __future__ import annotations

import hashlib
import json
import threading
import time
import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import psycopg
import pytest
from psycopg.rows import dict_row
from sg_schemas.models import SearchIndexResult

import sg_worker.handlers  # noqa: F401  (registriert die Handler)
from conftest import USER_ID, get_job
from sg_worker.ai import embedder as em
from sg_worker.handlers import search_index as si
from sg_worker.loop import Worker
from sg_worker.registry import default_registry

Conn = psycopg.Connection[Any]

DRIZZLE = Path(__file__).resolve().parents[2] / "core" / "drizzle"


def _migrations() -> list[str]:
    sql: list[str] = []
    for f in sorted(DRIZZLE.glob("*.sql")):
        sql.extend(part for part in f.read_text().split("--> statement-breakpoint") if part.strip())
    return sql


@pytest.fixture
def core_schema(database_url: str) -> Iterator[str]:
    name = f"s_{uuid.uuid4().hex[:12]}"
    with psycopg.connect(database_url, autocommit=True) as c:
        c.execute("CREATE EXTENSION IF NOT EXISTS vector")
        c.execute(f'CREATE SCHEMA "{name}"')
        c.execute(f'SET search_path TO "{name}", public')
        for statement in _migrations():
            if "CREATE EXTENSION" in statement:
                continue
            c.execute(statement.replace('"public".', f'"{name}".'))  # type: ignore[call-overload]
        try:
            yield name
        finally:
            c.execute(f'DROP SCHEMA "{name}" CASCADE')


@pytest.fixture
def kwargs(core_schema: str) -> dict[str, Any]:
    return {"options": f"-c search_path={core_schema},public"}


@pytest.fixture
def db(database_url: str, kwargs: dict[str, Any]) -> Iterator[Conn]:
    with psycopg.connect(database_url, autocommit=True, **kwargs) as c:
        yield c


@pytest.fixture
def worker(database_url: str, kwargs: dict[str, Any], tmp_path: Path) -> Worker:
    return Worker(
        database_url,
        tmp_path,
        registry=default_registry,
        channel=f"sg_jobs_{uuid.uuid4().hex[:8]}",
        connect_kwargs=kwargs,
        worker_id="ich",
    )


class Counting:
    """Fake-Embedder, der Aufrufe mitschreibt. `hook` läuft vor jedem `embed`."""

    def __init__(self, inner: Any = None, hook: Any = None) -> None:
        self.inner = inner or em.FakeEmbedder()
        self.provider = self.inner.provider
        self.model = self.inner.model
        self.dim = self.inner.dim
        self.calls: list[list[str]] = []
        self.waits: list[float] = []
        self.hook = hook

    def ready(self) -> bool:
        return bool(self.inner.ready())

    def error(self) -> str | None:
        return self.inner.error()  # type: ignore[no-any-return]

    def wait_ready(self, timeout_s: float) -> bool:
        self.waits.append(timeout_s)
        return bool(self.inner.wait_ready(timeout_s))

    def embed(self, texts: list[str]) -> list[list[float]]:
        if self.hook is not None:
            self.hook()
        self.calls.append(list(texts))
        return self.inner.embed(texts)  # type: ignore[no-any-return]


@pytest.fixture
def emb(monkeypatch: pytest.MonkeyPatch) -> Counting:
    counting = Counting()
    monkeypatch.setattr(si, "get_embedder", lambda: counting)
    return counting


def use(monkeypatch: pytest.MonkeyPatch, embedder: Any) -> None:
    monkeypatch.setattr(si, "get_embedder", lambda: embedder)


# ---------- Testdaten (erfunden) ----------


def ins(conn: Conn, table: str, **cols: Any) -> uuid.UUID:
    cols.setdefault("id", uuid.uuid4())
    cols.setdefault("user_id", USER_ID)
    keys = ", ".join(cols)
    marks = ", ".join(["%s"] * len(cols))
    conn.execute(f"INSERT INTO {table} ({keys}) VALUES ({marks})", list(cols.values()))  # type: ignore[call-overload]
    return uuid.UUID(str(cols["id"]))


def module(conn: Conn, lang: str | None = "de") -> uuid.UUID:
    sem = ins(conn, "semester", name="HS 2026")
    return ins(conn, "module", semester_id=sem, name="Algorithmen", color="mod-01", lang=lang)


def deck(
    conn: Conn, mod: uuid.UUID, slides: list[dict[str, Any]]
) -> tuple[uuid.UUID, list[uuid.UUID]]:
    did = ins(
        conn, "slide_deck", module_id=mod, title="VL 1", file_path="media/decks/x/original.pdf",
        sha256="a" * 64,
    )  # fmt: skip
    ids = [
        ins(conn, "slide", deck_id=did, index=i, width_pt=720, height_pt=540, **s)
        for i, s in enumerate(slides, start=1)
    ]
    return did, ids


def session(conn: Conn, mod: uuid.UUID) -> uuid.UUID:
    return ins(conn, "session", module_id=mod, state="verarbeitet")


def transcript(
    conn: Conn, sid: uuid.UUID, segs: list[tuple[int, int, str, str | None]], *, started_ms: int = 0
) -> uuid.UUID:
    """Aufnahme mit Transkript. `segs`: (start_ms, end_ms, text, lang) in Sitzungszeit."""
    rid = ins(conn, "recording", session_id=sid, mime="audio/webm", codec="opus",
              started_ms=started_ms)  # fmt: skip
    tid = ins(
        conn, "transcript", session_id=sid, recording_id=rid, job_id=uuid.uuid4(),
        finalize_job_id=uuid.uuid4(), provider="fake", model="fake-1", input_hash="b" * 64,
        audio_sha256="c" * 64, audio_duration_ms=0, segment_count=len(segs), word_count=0,
    )  # fmt: skip
    for seq, (start, end, text, lang) in enumerate(segs):
        ins(
            conn, "transcript_segment", transcript_id=tid, session_id=sid, recording_id=rid,
            seq=seq, start_ms=start, end_ms=end, text=text, lang=lang,
        )  # fmt: skip
    return rid


def run_job(worker: Worker, conn: Conn, scope: str, target: Any) -> dict[str, Any]:
    job_id = uuid.uuid4()
    conn.execute(
        "INSERT INTO job (id, user_id, type, payload, priority) VALUES (%s, %s, 'search.index', "
        "%s::jsonb, 5)",
        (job_id, USER_ID, json.dumps({"scope": scope, "id": str(target)})),
    )
    worker.drain(conn)
    return get_job(conn, job_id)


def chunks(conn: Conn) -> list[dict[str, Any]]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT *, embedding::text AS vec FROM search_chunk "
            "ORDER BY source_kind, slide_index, part"
        )
        return cur.fetchall()


def as_vector(conn: Conn, text: str) -> str:
    """`embedding::text` des Fake-Vektors, so wie pgvector ihn zurückgibt."""
    got = conn.execute(
        "SELECT %s::vector::text", (si.vector_literal(em.fake_vector(text)),)
    ).fetchone()
    assert got is not None
    return str(got[0])


def result(job: dict[str, Any]) -> dict[str, Any]:
    assert job["state"] == "fertig", job["error"]
    SearchIndexResult.model_validate(job["result"])
    return dict(job["result"])


def slide_vectors(conn: Conn, did: uuid.UUID) -> list[str | None]:
    rows = conn.execute(
        "SELECT embedding::text FROM slide WHERE deck_id = %s ORDER BY index", (did,)
    ).fetchall()
    return [r[0] for r in rows]


# ---------- Reine Regeln ----------


def test_clean_text_rules() -> None:
    assert si.clean_text("  A\x01Treffer\x02 \x00b\r\n\n c\t d\x7f\x9f  ") == "ATreffer b c d"
    assert si.clean_text("a \x01 b") == "a b"  # erst Steuerzeichen, dann Leerraum
    assert si.clean_text("a\x1cb\x85c\u2028d\x0be") == "a b c d e"  # Cc-Leerraum wird Leerzeichen
    assert si.clean_text("\x01\x02 \n\t ") == ""
    assert si.clean_text("Cafe\u0301") == "Café"  # NFC
    assert si.clean_text("x" * 9000) == "x" * 8000
    assert si.clean_text("a" * 7999 + " b") == "a" * 7999 + " "  # erst trimmen, dann kürzen


def test_clean_text_has_no_control_chars() -> None:
    import unicodedata

    every = "".join(chr(c) for c in range(0x0, 0x250)) + "\u2028\u2029\ufeff"
    out = si.clean_text(every)
    assert not any(unicodedata.category(ch) in ("Cc", "Cf") for ch in out)


def test_clean_text_removes_format_chars() -> None:
    # weiches Trennzeichen, Nullbreite-Leerzeichen, BOM, Richtungszeichen
    assert si.clean_text("Vor\u00adle\u200bsung\ufeff \u200eTeil\u2060") == "Vorlesung Teil"
    assert si.clean_text("\u00ad\u200b") == ""


def test_clean_text_result_is_always_nfc() -> None:
    import unicodedata

    # e + ZWJ + Akut: nach dem Entfernen des Cf stehen e und U+0301 zusammen und müssen zu é werden
    out = si.clean_text("e\u200d\u0301")
    assert unicodedata.is_normalized("NFC", out)
    assert out == "\u00e9"
    assert unicodedata.is_normalized("NFC", si.clean_text("a\x01\u0308 o\u00ad\u0308"))


def test_ts_config_mapping() -> None:
    assert [si.ts_config_for(x) for x in ("de", "en", "mixed", None, "fr")] == [
        "german", "english", "simple", "simple", "simple",
    ]  # fmt: skip


def seg(start: int, end: int, text: str = "x", lang: str | None = "de") -> si.SegmentRow:
    return si.SegmentRow(start, end, text, lang)


def starts(segments: list[si.SegmentRow]) -> list[list[int]]:
    return [[s.start_ms for s in w] for w in si.group_windows(segments)]


def test_window_rule_boundary() -> None:
    # Genau 60 000 ms ab Fensterbeginn passen noch, 60 001 nicht mehr
    assert starts([seg(0, 10_000), seg(20_000, 60_000)]) == [[0, 20_000]]
    assert starts([seg(0, 10_000), seg(20_000, 60_001)]) == [[0], [20_000]]
    assert starts([seg(5_000, 6_000), seg(6_000, 65_000), seg(65_000, 65_001)]) == [
        [5_000, 6_000], [65_000],
    ]  # fmt: skip


def test_long_segment_is_own_window() -> None:
    assert starts([seg(0, 90_000), seg(90_000, 95_000), seg(95_000, 100_000)]) == [
        [0], [90_000, 95_000],
    ]  # fmt: skip


def test_session_chunks_times_lang_and_parts() -> None:
    sid = uuid.uuid4()
    out = si.session_chunks(
        sid,
        [
            seg(0, 5_000, "Hallo", "en"),
            seg(5_000, 70_000, "zwei", "de"),
            seg(70_000, 71_000, "\x01"),
        ],
    )
    assert [(c.part, c.t_ms, c.t_end_ms, c.ts_config, c.text) for c in out] == [
        (0, 0, 5_000, "english", "Hallo"),
        (1, 5_000, 70_000, "german", "zwei"),
    ]  # das leere Fenster 2 entfällt, seine Nummer bleibt frei


# ---------- Foliensatz ----------

SLIDES = [
    {"title": "Einführung", "text": "Organisatorisches\nKlausur", "vision_summary": None},
    {"title": "Quicksort", "text": "Pivotelement\x01wählen,\x02 Liste teilen", "vision_summary":
     "Diagramm: Rekursionsbaum"},
    {"title": None, "text": "", "vision_summary": None},  # leer: kein Eintrag
    {"title": "Mergesort", "text": "Teile und herrsche", "vision_summary": None},
]  # fmt: skip


def test_deck_writes_one_chunk_per_slide(worker: Worker, db: Conn, emb: Counting) -> None:
    did, slide_ids = deck(db, module(db, "de"), SLIDES)
    db.execute("UPDATE slide SET deleted_at = now() WHERE id = %s", (slide_ids[3],))
    job = run_job(worker, db, "deck", did)
    res = result(job)
    assert res == {
        "scope": "deck", "id": str(did), "chunk_count": 2, "embedded_count": 2,
        "reused_count": 0, "removed_count": 0, "embedding_model": "fake-embed-1",
        "embedding_error": None, "index_version": 1, "deleted": False, "missing": False,
    }  # fmt: skip
    rows = chunks(db)
    assert [r["slide_index"] for r in rows] == [1, 2]
    first, second = rows
    assert first["text"] == "Einführung Organisatorisches Klausur"
    assert second["text"] == "Quicksort Pivotelementwählen, Liste teilen Diagramm: Rekursionsbaum"
    assert "\x01" not in second["text"] and "\x02" not in second["text"]
    for row, sid in zip(rows, slide_ids[:2], strict=True):
        assert (row["source_kind"], row["source_id"], row["part"]) == ("slide", sid, 0)
        assert (row["deck_id"], row["session_id"]) == (did, None)
        assert (row["t_ms"], row["t_end_ms"]) == (None, None)
        assert row["ts_config"] == "german"
        assert row["content_hash"] == hashlib.sha256(row["text"].encode()).hexdigest()
        assert (row["index_version"], row["job_id"]) == (1, job["id"])
        assert row["embedding_model"] == "fake-embed-1"
        assert row["vec"] == as_vector(db, row["text"])
        assert row["user_id"] == USER_ID and row["deleted_at"] is None
    assert (first["title"], second["title"]) == ("Einführung", "Quicksort")
    # slide.embedding = Vektor des Eintrags, Folien ohne Eintrag: NULL
    assert slide_vectors(db, did) == [first["vec"], second["vec"], None, None]
    # Die Wortsuche findet den Eintrag (tsv mit german, Stammform)
    hit = db.execute(
        "SELECT slide_index FROM search_chunk WHERE tsv @@ to_tsquery('german', 'rekursionsbäume')"
    ).fetchall()
    assert hit == [(2,)]
    assert job["session_id"] is None


@pytest.mark.parametrize(
    ("lang", "config"), [("en", "english"), ("mixed", "simple"), (None, "simple")]
)
def test_deck_ts_config_follows_module_lang(
    worker: Worker, db: Conn, emb: Counting, lang: str | None, config: str
) -> None:
    did, _ = deck(db, module(db, lang), SLIDES[:1])
    result(run_job(worker, db, "deck", did))
    assert [r["ts_config"] for r in chunks(db)] == [config]


def test_reuse_and_stale_removal(worker: Worker, db: Conn, emb: Counting) -> None:
    did, ids = deck(db, module(db), SLIDES)
    result(run_job(worker, db, "deck", did))
    before = {r["source_id"]: r for r in chunks(db)}
    assert sum(len(c) for c in emb.calls) == 3

    # Unverändert: nichts neu eingebettet, Vektoren bleiben, Einträge neu geschrieben
    emb.calls.clear()
    res = result(run_job(worker, db, "deck", did))
    assert (res["embedded_count"], res["reused_count"], res["removed_count"]) == (0, 3, 0)
    assert emb.calls == [] and emb.waits == [600.0]  # nur beim ersten Lauf gewartet
    after = {r["source_id"]: r for r in chunks(db)}
    assert {k: (v["id"], v["vec"]) for k, v in after.items()} == {
        k: (v["id"], v["vec"]) for k, v in before.items()
    }
    assert all(r["job_id"] != before[k]["job_id"] for k, r in after.items())

    # Folie 2 geändert, Folie 4 gelöscht: eins neu, eins entfernt
    db.execute("UPDATE slide SET text = 'Neuer Text zur Laufzeit' WHERE id = %s", (ids[1],))
    db.execute("UPDATE slide SET deleted_at = now() WHERE id = %s", (ids[3],))
    emb.calls.clear()
    res = result(run_job(worker, db, "deck", did))
    counts = [res[k] for k in ("chunk_count", "embedded_count", "reused_count", "removed_count")]
    assert counts == [2, 1, 1, 1]
    assert len(emb.calls) == 1 and "Laufzeit" in emb.calls[0][0]
    rows = chunks(db)
    assert [r["source_id"] for r in rows] == [ids[0], ids[1]]
    assert rows[1]["vec"] == as_vector(db, rows[1]["text"])
    assert slide_vectors(db, did) == [rows[0]["vec"], rows[1]["vec"], None, None]


@pytest.mark.parametrize(
    "change",
    [
        "UPDATE search_chunk SET index_version = 2",
        "UPDATE search_chunk SET embedding_model = 'anderes-modell'",
        "UPDATE search_chunk SET embedding = NULL, embedding_model = NULL",
    ],
)
def test_no_reuse_with_other_version_or_model(
    worker: Worker, db: Conn, emb: Counting, change: str
) -> None:
    did, _ = deck(db, module(db), SLIDES[:2])
    result(run_job(worker, db, "deck", did))
    db.execute(change)  # type: ignore[call-overload]
    res = result(run_job(worker, db, "deck", did))
    assert (res["embedded_count"], res["reused_count"]) == (2, 0)
    assert {r["embedding_model"] for r in chunks(db)} == {"fake-embed-1"}
    assert {r["index_version"] for r in chunks(db)} == {1}


def test_embeds_in_small_batches(worker: Worker, db: Conn, emb: Counting) -> None:
    assert si.EMBED_BATCH == 4
    did, _ = deck(db, module(db), [{"title": f"Folie {i}", "text": "Inhalt"} for i in range(18)])
    res = result(run_job(worker, db, "deck", did))
    assert res["embedded_count"] == 18
    assert [len(c) for c in emb.calls] == [4, 4, 4, 4, 2]


def test_pauses_between_batches_but_not_before_the_first(
    worker: Worker, db: Conn, emb: Counting, monkeypatch: pytest.MonkeyPatch
) -> None:
    events: list[str] = []
    monkeypatch.setattr(em, "pause_between_batches", lambda: events.append("pause"))
    emb.hook = lambda: events.append("embed")
    did, _ = deck(db, module(db), [{"title": f"Folie {i}", "text": "Inhalt"} for i in range(9)])
    result(run_job(worker, db, "deck", did))
    assert events == ["embed", "pause", "embed", "pause", "embed"]


def test_single_batch_never_pauses(
    worker: Worker, db: Conn, emb: Counting, monkeypatch: pytest.MonkeyPatch
) -> None:
    pauses: list[int] = []
    monkeypatch.setattr(em, "pause_between_batches", lambda: pauses.append(1))
    did, _ = deck(db, module(db), SLIDES[:2])
    result(run_job(worker, db, "deck", did))
    assert len(emb.calls) == 1 and pauses == []


def test_pause_comes_before_waiting_for_search_requests(
    emb: Counting, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Erst pausieren, dann auf Suchanfragen warten: Eine Anfrage, die während der Pause
    eintrifft, kommt so vor dem nächsten Stapel dran."""
    events: list[str] = []
    monkeypatch.setattr(em, "pause_between_batches", lambda: events.append("pause"))
    monkeypatch.setattr(em.ENDPOINT_PRIORITY, "wait_idle", lambda *a: events.append("idle") or True)
    emb.hook = lambda: events.append("embed")
    todo = [si.Chunk("slide", uuid.uuid4(), 0, f"Text {i}", "simple") for i in range(5)]
    si.embed_chunks(emb, todo)
    assert events == ["idle", "embed", "pause", "idle", "embed"]


def test_releases_device_cache_only_after_large_runs(emb: Counting) -> None:
    released: list[int] = []
    emb.release_cache = lambda: released.append(1)  # type: ignore[attr-defined]

    def todo(n: int) -> list[si.Chunk]:
        return [si.Chunk("slide", uuid.uuid4(), 0, f"T {i}", "simple") for i in range(n)]

    em.configure_tuning(pause_ms=0)
    try:
        si.embed_chunks(emb, todo(si.EMBED_BATCH))
        assert released == []
        si.embed_chunks(emb, todo(si.EMBED_BATCH + 1))
        assert released == [1]
    finally:
        em.configure_tuning()


def test_text_without_words_gets_no_vector(worker: Worker, db: Conn, emb: Counting) -> None:
    did, _ = deck(db, module(db), [{"title": "a", "text": "§ 3 ."}, {"title": "Wort", "text": ""}])
    res = result(run_job(worker, db, "deck", did))
    assert (res["chunk_count"], res["embedded_count"]) == (2, 1)
    assert [(r["vec"] is None, r["embedding_model"]) for r in chunks(db)] == [
        (True, None), (False, "fake-embed-1"),
    ]  # fmt: skip


# ---------- Session ----------


def test_session_windows(worker: Worker, db: Conn, emb: Counting) -> None:
    sid = session(db, module(db))
    # Zwei Aufnahmen, gemischt sortiert nach (start_ms, recording_id, seq)
    transcript(db, sid, [(0, 20_000, "Heute geht es um Graphen.", "de"),
                         (20_000, 60_000, "Ein Knoten\x01 hat\x02 Kanten.", "de"),
                         (60_000, 70_000, "Neues Fenster.", "de"),
                         (200_000, 290_000, "Ein sehr langer Abschnitt.", "de")])  # fmt: skip
    transcript(db, sid, [(65_000, 66_000, "Zwischenruf auf Englisch.", "en")], started_ms=65_000)
    res = result(run_job(worker, db, "session", sid))
    assert (res["scope"], res["chunk_count"], res["embedded_count"]) == ("session", 3, 3)
    rows = chunks(db)
    assert [(r["part"], r["t_ms"], r["t_end_ms"], r["ts_config"]) for r in rows] == [
        (0, 0, 60_000, "german"),
        (1, 60_000, 70_000, "german"),
        (2, 200_000, 290_000, "german"),
    ]
    assert rows[0]["text"] == "Heute geht es um Graphen. Ein Knoten hat Kanten."
    assert rows[1]["text"] == "Neues Fenster. Zwischenruf auf Englisch."
    for r in rows:
        assert (r["source_kind"], r["source_id"], r["session_id"], r["deck_id"]) == (
            "transcript", sid, sid, None,
        )  # fmt: skip
        assert (r["slide_index"], r["title"]) == (None, None)
        assert r["vec"] == as_vector(db, r["text"])


def test_session_ts_config_from_first_segment(worker: Worker, db: Conn, emb: Counting) -> None:
    sid = session(db, module(db))
    transcript(db, sid, [(0, 1_000, "Hello world", "en"), (1_000, 2_000, "Hallo Welt", "de"),
                         (100_000, 101_000, "Bonjour", "fr")])  # fmt: skip
    result(run_job(worker, db, "session", sid))
    assert [r["ts_config"] for r in chunks(db)] == ["english", "simple"]


def test_session_removes_stale_windows(worker: Worker, db: Conn, emb: Counting) -> None:
    sid = session(db, module(db))
    transcript(db, sid, [(0, 1_000, "eins", "de"), (100_000, 101_000, "zwei", "de"),
                         (200_000, 201_000, "drei", "de")])  # fmt: skip
    result(run_job(worker, db, "session", sid))
    db.execute("UPDATE transcript_segment SET deleted_at = now() WHERE start_ms >= 100000")
    res = result(run_job(worker, db, "session", sid))
    assert (res["chunk_count"], res["removed_count"], res["reused_count"]) == (1, 2, 1)
    assert [r["part"] for r in chunks(db)] == [0]


def test_session_without_transcript_removes_all(worker: Worker, db: Conn, emb: Counting) -> None:
    sid = session(db, module(db))
    transcript(db, sid, [(0, 1_000, "eins", "de")])
    result(run_job(worker, db, "session", sid))
    db.execute("DELETE FROM transcript")
    res = result(run_job(worker, db, "session", sid))
    assert (res["chunk_count"], res["removed_count"]) == (0, 1)
    assert chunks(db) == []


# ---------- Ziel gelöscht oder fehlt ----------


@pytest.mark.parametrize("scope", ["deck", "session"])
def test_soft_deleted_target_writes_nothing(
    worker: Worker, db: Conn, emb: Counting, scope: str
) -> None:
    mod = module(db)
    if scope == "deck":
        target, _ = deck(db, mod, SLIDES[:1])
    else:
        target = session(db, mod)
        transcript(db, target, [(0, 1_000, "eins", "de")])
    result(run_job(worker, db, scope, target))
    table = "slide_deck" if scope == "deck" else "session"
    stamp = db.execute(f"UPDATE {table} SET deleted_at = now() RETURNING deleted_at").fetchone()  # type: ignore[call-overload]
    db.execute("UPDATE search_chunk SET deleted_at = %s", (stamp[0],))  # wie der Papierkorb
    before = chunks(db)
    res = result(run_job(worker, db, scope, target))
    assert (res["deleted"], res["missing"], res["chunk_count"]) == (True, False, 0)
    assert res["embedding_model"] is None
    assert chunks(db) == before
    assert emb.calls == [[before[0]["text"]]]  # nur der erste Lauf hat eingebettet


@pytest.mark.parametrize("scope", ["deck", "session"])
def test_missing_target(worker: Worker, db: Conn, emb: Counting, scope: str) -> None:
    res = result(run_job(worker, db, scope, uuid.uuid4()))
    assert (res["missing"], res["deleted"], res["chunk_count"]) == (True, False, 0)
    assert chunks(db) == [] and emb.calls == []


@pytest.mark.parametrize("scope", ["deck", "session"])
def test_target_deleted_while_embedding(
    worker: Worker, db: Conn, monkeypatch: pytest.MonkeyPatch, scope: str
) -> None:
    mod = module(db)
    if scope == "deck":
        target, _ = deck(db, mod, SLIDES[:2])
    else:
        target = session(db, mod)
        transcript(db, target, [(0, 1_000, "eins", "de")])
    table = "slide_deck" if scope == "deck" else "session"
    sql = f"UPDATE {table} SET deleted_at = now()"
    use(monkeypatch, Counting(hook=lambda: db.execute(sql)))  # type: ignore[call-overload]
    res = result(run_job(worker, db, scope, target))
    assert (res["deleted"], res["missing"], res["chunk_count"], res["embedded_count"]) == (
        True, False, 0, 0,
    )  # fmt: skip
    assert (res["embedding_model"], res["embedding_error"]) == (None, None)
    assert chunks(db) == []


def test_target_removed_while_embedding(
    worker: Worker, db: Conn, monkeypatch: pytest.MonkeyPatch
) -> None:
    sid = session(db, module(db))
    transcript(db, sid, [(0, 1_000, "eins", "de")])

    def drop() -> None:
        db.execute("DELETE FROM transcript_segment")
        db.execute("DELETE FROM transcript")
        db.execute("DELETE FROM recording")
        db.execute("DELETE FROM session")

    use(monkeypatch, Counting(hook=drop))
    res = result(run_job(worker, db, "session", sid))
    assert (res["missing"], res["chunk_count"]) == (True, 0)
    assert chunks(db) == []


def test_invalid_payload_fails_immediately(worker: Worker, db: Conn, emb: Counting) -> None:
    job = run_job(worker, db, "kurs", uuid.uuid4())
    assert job["state"] == "fehler" and job["attempts"] == 1
    assert "ungültiges Payload" in job["error"]


# ---------- Ohne Embedder ----------


def test_without_embedder_writes_text_only_then_backfills(
    worker: Worker, db: Conn, monkeypatch: pytest.MonkeyPatch
) -> None:
    did, _ = deck(db, module(db), SLIDES)
    missing = em.UnavailableEmbedder("bge-m3", "BAAI/bge-m3", "sentence_transformers fehlt")
    use(monkeypatch, missing)
    res = result(run_job(worker, db, "deck", did))
    assert res["chunk_count"] == 3 and res["embedded_count"] == 0
    assert (res["embedding_model"], res["embedding_error"]) == (None, "sentence_transformers fehlt")
    rows = chunks(db)
    assert [(r["vec"], r["embedding_model"]) for r in rows] == [(None, None)] * 3
    assert all(r["tsv"] for r in rows)  # Wortsuche geht trotzdem
    assert slide_vectors(db, did) == [None] * 4

    # Später bereit (§19.5 holt nach): jetzt mit Vektoren, nichts wiederverwendet
    fake = Counting()
    use(monkeypatch, fake)
    res = result(run_job(worker, db, "deck", did))
    assert (res["embedded_count"], res["reused_count"], res["embedding_model"]) == (
        3, 0, "fake-embed-1",
    )  # fmt: skip
    assert all(r["vec"] is not None for r in chunks(db))


def test_not_ready_after_wait_writes_without_vectors(
    worker: Worker, db: Conn, monkeypatch: pytest.MonkeyPatch
) -> None:
    class Loading(Counting):
        def ready(self) -> bool:
            return False

        def error(self) -> str | None:
            return None

        def wait_ready(self, timeout_s: float) -> bool:
            self.waits.append(timeout_s)
            return False

    loading = Loading()
    use(monkeypatch, loading)
    monkeypatch.setattr(si, "WAIT_READY_S", 0.01)
    did, _ = deck(db, module(db), SLIDES[:1])
    res = result(run_job(worker, db, "deck", did))
    assert loading.waits == [0.01] and loading.calls == []
    assert res["embedding_model"] is None
    assert res["embedding_error"] == "Embedder nach 0 s nicht bereit"
    assert chunks(db)[0]["vec"] is None


def test_without_embedder_keeps_reusable_vectors(
    worker: Worker, db: Conn, emb: Counting, monkeypatch: pytest.MonkeyPatch
) -> None:
    did, ids = deck(db, module(db), SLIDES[:2])
    result(run_job(worker, db, "deck", did))
    db.execute("UPDATE slide SET text = 'geändert' WHERE id = %s", (ids[1],))
    use(monkeypatch, em.UnavailableEmbedder("fake", "fake-embed-1", "weg"))
    res = result(run_job(worker, db, "deck", did))
    assert (res["reused_count"], res["embedded_count"], res["embedding_model"]) == (1, 0, None)
    rows = chunks(db)
    assert rows[0]["vec"] is not None and rows[1]["vec"] is None


def test_embedder_lost_between_batches(
    worker: Worker, db: Conn, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = 0

    def second_fails() -> None:
        nonlocal calls
        calls += 1
        if calls == 2:
            raise em.EmbedderUnavailable("Modell entladen")

    use(monkeypatch, Counting(hook=second_fails))
    did, _ = deck(db, module(db), [{"title": f"Folie {i}", "text": "Inhalt"} for i in range(20)])
    res = result(run_job(worker, db, "deck", did))
    assert (res["chunk_count"], res["embedded_count"]) == (20, 4)
    assert (res["embedding_model"], res["embedding_error"]) == (None, "Modell entladen")
    models = [r["embedding_model"] for r in chunks(db)]
    assert models == ["fake-embed-1"] * 4 + [None] * 16


# ---------- Lock ----------


def test_lock_lost_writes_nothing(
    worker: Worker, db: Conn, monkeypatch: pytest.MonkeyPatch
) -> None:
    did, _ = deck(db, module(db), SLIDES[:2])
    steal = "UPDATE job SET locked_by = 'anderer' WHERE type = 'search.index'"
    use(monkeypatch, Counting(hook=lambda: db.execute(steal)))
    job_id = uuid.uuid4()
    db.execute(
        "INSERT INTO job (id, user_id, type, payload) VALUES (%s, %s, 'search.index', %s::jsonb)",
        (job_id, USER_ID, json.dumps({"scope": "deck", "id": str(did)})),
    )
    worker.drain(db)
    job = get_job(db, job_id)
    assert (job["state"], job["locked_by"], job["result"]) == ("laeuft", "anderer", None)
    assert chunks(db) == []
    assert slide_vectors(db, did) == [None, None]


def test_embedder_crash_is_retried(
    worker: Worker, db: Conn, monkeypatch: pytest.MonkeyPatch
) -> None:
    def boom() -> None:
        raise RuntimeError("Speicher voll")

    use(monkeypatch, Counting(hook=boom))
    did, _ = deck(db, module(db), SLIDES[:1])
    job = run_job(worker, db, "deck", did)
    assert job["state"] == "wartet" and job["attempts"] == 1
    assert "Speicher voll" in job["error"]
    assert chunks(db) == []


# ---------- Nachträge aus dem Review von #162 ----------


def test_tsv_has_simple_part_for_prefixes(worker: Worker, db: Conn, emb: Counting) -> None:
    did, _ = deck(db, module(db, "de"), [{"title": "Vorlesungen", "text": "Divide and Conquer"}])
    result(run_job(worker, db, "deck", did))

    def hits(query: str, config: str = "simple") -> int:
        row = db.execute(
            "SELECT count(*) FROM search_chunk WHERE tsv @@ to_tsquery(%s::regconfig, %s)",
            (config, query),
        ).fetchone()
        assert row is not None
        return int(row[0])

    assert hits("vorlesu:*") == 1  # halbes Wort, nur über den simple-Teil
    assert hits("vorlesung", "german") == 1  # Stamm über den german-Teil
    assert hits("conquer") == 1
    assert hits("nichtda") == 0


def test_text_with_unicode_whitespace_passes_check(worker: Worker, db: Conn, emb: Counting) -> None:
    did, _ = deck(db, module(db), [{"title": "Kopf\x1czeile", "text": "a\x85b\x0bc\u2028d\x7f"}])
    result(run_job(worker, db, "deck", did))
    assert [r["text"] for r in chunks(db)] == ["Kopf zeile a b c d"]


def test_rerun_does_not_touch_slides(worker: Worker, db: Conn, emb: Counting) -> None:
    did, _ = deck(db, module(db), SLIDES)
    result(run_job(worker, db, "deck", did))
    stamps = db.execute(
        "SELECT id, updated_at FROM slide WHERE deck_id = %s ORDER BY index", (did,)
    ).fetchall()
    result(run_job(worker, db, "deck", did))
    again = db.execute(
        "SELECT id, updated_at FROM slide WHERE deck_id = %s ORDER BY index", (did,)
    ).fetchall()
    assert again == stamps  # nur WHERE embedding IS DISTINCT FROM …


def test_job_waits_for_endpoint_requests() -> None:
    fake = Counting()
    chunk_list = [si.Chunk("slide", uuid.uuid4(), 0, f"Text {i}", "german") for i in range(3)]
    done = threading.Event()
    out: list[si.Embedded] = []

    def run() -> None:
        out.append(si.embed_chunks(fake, chunk_list))
        done.set()

    with em.ENDPOINT_PRIORITY.request():
        thread = threading.Thread(target=run)
        thread.start()
        time.sleep(0.1)
        assert fake.calls == [] and not done.is_set()  # Stapel wartet auf die Suchanfrage
    assert done.wait(5)
    thread.join()
    assert len(fake.calls) == 1 and out[0].model == "fake-embed-1"


def test_format_chars_never_reach_the_table(worker: Worker, db: Conn, emb: Counting) -> None:
    did, _ = deck(db, module(db), [{"title": "Al\u00adgo\u200brith\ufeffmus", "text": "x"}])
    result(run_job(worker, db, "deck", did))
    [row] = chunks(db)
    assert row["text"] == "Algorithmus x"
    assert db.execute("SELECT %s !~ '[[:cntrl:]]'", (row["text"],)).fetchone() == (True,)


def test_shutdown_stops_embedding(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = Counting()
    chunk_list = [si.Chunk("slide", uuid.uuid4(), 0, f"Text {i}", "german") for i in range(20)]
    em.SHUTDOWN.set()
    try:
        out = si.embed_chunks(fake, chunk_list)
    finally:
        em.SHUTDOWN.clear()
    assert fake.calls == []
    assert (out.model, out.error, out.vectors) == (None, "Worker wird beendet", {})
