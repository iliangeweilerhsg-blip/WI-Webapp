"""`pdf.ingest`: harte Fälle (bösartige PDFs, Fehlerpfade, Lock verloren, Wiederanlauf)."""

from __future__ import annotations

import resource
import time
import uuid
from pathlib import Path
from typing import Any

import psycopg
import pymupdf
import pytest
from PIL import Image
from sg_schemas.models import PdfIngestPayload

from conftest import USER_ID, MakeJob, get_job
from sg_worker.handlers import pdf_ingest as pdf_ingest_module
from sg_worker.handlers.pdf_ingest import (
    extract_text,
    mark_ingest_failed,
    pdf_ingest,
    process_pdf,
    sanitize_error,
)
from sg_worker.loop import Worker
from sg_worker.registry import JobContext, Registry
from sg_worker.uuid7 import uuid7
from test_loop import running, wait_for
from test_pdf_ingest import MODULE_ID, add_deck, add_job, make_pdf


def make_worker(
    database_url: str,
    connect_kwargs: dict[str, Any],
    tmp_path: Path,
    fn: Any = pdf_ingest,
    **kw: Any,
) -> Worker:
    reg = Registry()
    reg.register("pdf.ingest", fn, PdfIngestPayload, on_final_failure=mark_ingest_failed)
    return Worker(
        database_url,
        tmp_path,
        registry=reg,
        connect_kwargs=connect_kwargs,
        channel=f"sg_jobs_{uuid.uuid4().hex[:8]}",
        **kw,
    )


@pytest.fixture
def worker(database_url: str, connect_kwargs: dict[str, Any], tmp_path: Path) -> Worker:
    return make_worker(database_url, connect_kwargs, tmp_path)


def state_of(conn: psycopg.Connection[Any], row_id: uuid.UUID, table: str = "slide_deck") -> str:
    row = conn.execute(f"SELECT ingest_state FROM {table} WHERE id = %s", (row_id,)).fetchone()
    assert row is not None
    return str(row[0])


def encrypted_pdf(path: Path) -> Path:
    doc = pymupdf.open()
    doc.new_page().insert_text((50, 80), "geheim")
    doc.save(path, encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="u", owner_pw="o")
    doc.close()
    return path


EMPTY_PAGES_PDF = (
    b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n"
    b"trailer<</Root 1 0 R/Size 3>>\n%%EOF\n"
)


@pytest.mark.parametrize("kind", ["kaputt", "passwort", "leer"])
def test_deterministic_errors_fail_at_once_without_retry(
    worker: Worker, conn: psycopg.Connection[Any], tmp_path: Path, kind: str
) -> None:
    src = tmp_path / "src.pdf"
    if kind == "kaputt":
        src.write_bytes(b"%PDF-1.4\nkaputt")
    elif kind == "passwort":
        encrypted_pdf(src)
    else:
        src.write_bytes(EMPTY_PAGES_PDF)
    deck = add_deck(conn, tmp_path, src)
    job = add_job(conn, {"slide_deck_id": str(deck)})  # max_attempts=3

    worker.drain(conn)
    row = get_job(conn, job)
    assert row["state"] == "fehler"
    assert row["attempts"] == 1  # kein Retry
    assert str(tmp_path) not in row["error"]
    assert "/" not in row["error"]
    assert state_of(conn, deck) == "fehler"
    assert conn.execute("SELECT count(*) FROM slide").fetchone() == (0,)


def test_missing_file_retries_and_error_has_no_absolute_path(
    worker: Worker, conn: psycopg.Connection[Any], tmp_path: Path
) -> None:
    pdf = make_pdf(tmp_path / "src.pdf", [{"title": "A"}])
    deck = add_deck(conn, tmp_path, pdf)
    (tmp_path / "media" / "decks" / str(deck) / "original.pdf").unlink()
    job = add_job(conn, {"slide_deck_id": str(deck)}, max_attempts=2)

    worker.drain(conn)
    row = get_job(conn, job)
    assert row["state"] == "wartet"  # wiederholbar
    assert str(tmp_path) not in row["error"]
    assert state_of(conn, deck) == "neu"

    conn.execute("UPDATE job SET run_after = NULL WHERE id = %s", (job,))
    worker.drain(conn)
    assert get_job(conn, job)["state"] == "fehler"
    assert state_of(conn, deck) == "fehler"


def test_sanitize_error_strips_absolute_paths(tmp_path: Path) -> None:
    text = f"Fehler bei {tmp_path}/media/a.pdf und /etc/passwd: kaputt"
    clean = sanitize_error(text, tmp_path)
    assert str(tmp_path) not in clean
    assert "/etc" not in clean
    assert "media/a.pdf" in clean


def test_final_db_failure_in_transaction_sets_fehler(
    worker: Worker, conn: psycopg.Connection[Any], tmp_path: Path
) -> None:
    """Scheitert der Abschluss in der DB beim letzten Versuch, steht der Foliensatz auf 'fehler'."""
    conn.execute(
        "CREATE FUNCTION block_done() RETURNS trigger LANGUAGE plpgsql AS "
        "$$ BEGIN RAISE EXCEPTION 'gesperrt'; END $$"
    )
    conn.execute(
        "CREATE TRIGGER block_done BEFORE UPDATE ON slide_deck FOR EACH ROW "
        "WHEN (NEW.ingest_state = 'verarbeitet') EXECUTE FUNCTION block_done()"
    )
    pdf = make_pdf(tmp_path / "src.pdf", [{"title": "A"}])
    deck = add_deck(conn, tmp_path, pdf)
    job = add_job(conn, {"slide_deck_id": str(deck)}, max_attempts=1)
    worker.drain(conn)
    assert get_job(conn, job)["state"] == "fehler"
    assert state_of(conn, deck) == "fehler"
    assert conn.execute("SELECT count(*) FROM slide").fetchone() == (0,)


def test_lock_lost_does_not_commit(
    database_url: str,
    connect_kwargs: dict[str, Any],
    conn: psycopg.Connection[Any],
    tmp_path: Path,
) -> None:
    def thief(payload: Any, ctx: JobContext) -> dict[str, Any]:
        # Ein anderer Worker hat den Job inzwischen übernommen
        conn.execute("UPDATE job SET locked_by = 'anderer:1' WHERE id = %s", (ctx.job_id,))
        return pdf_ingest(payload, ctx)

    w = make_worker(database_url, connect_kwargs, tmp_path, thief)
    pdf = make_pdf(tmp_path / "src.pdf", [{"title": "A"}, {"title": "B"}])
    deck = add_deck(conn, tmp_path, pdf)
    job = add_job(conn, {"slide_deck_id": str(deck)})
    w.drain(conn)
    assert conn.execute("SELECT count(*) FROM slide").fetchone() == (0,)
    assert state_of(conn, deck) == "neu"
    row = get_job(conn, job)
    assert row["state"] == "laeuft"
    assert row["locked_by"] == "anderer:1"  # unangetastet


def test_giant_page_renders_small_and_cheap(tmp_path: Path) -> None:
    pdf = make_pdf(tmp_path / "riesig.pdf", [{"body": "schmal"}] * 6, size=(12, 14400))
    media = tmp_path / "m"
    out = process_pdf(pdf, media, "slides", "m")
    assert len(out.pages) == 6
    assert all(p.image_rel and p.thumb_rel for p in out.pages)
    assert Image.open(media / "slides" / "1.png").size[1] <= 4800
    thumb = Image.open(media / "thumbs" / "1.webp")
    assert thumb.size[0] >= 1
    assert thumb.size[1] <= 960
    assert resource.getrusage(resource.RUSAGE_SELF).ru_maxrss < 500_000  # KB, grob


def test_wide_page_thumbnail_is_at_least_one_pixel(tmp_path: Path) -> None:
    pdf = make_pdf(tmp_path / "breit.pdf", [{}], size=(14400, 12))
    process_pdf(pdf, tmp_path / "m", "slides", "m")
    thumb = Image.open(tmp_path / "m" / "thumbs" / "1.webp")
    assert thumb.size[0] == 320
    assert thumb.size[1] >= 1


def test_unrenderable_page_keeps_text_and_deck_survives(
    worker: Worker,
    conn: psycopg.Connection[Any],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    real = pdf_ingest_module._render_page
    calls = {"n": 0}

    def flaky(page: pymupdf.Page, w: float, h: float) -> tuple[bytes, bytes]:
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("Renderfehler")
        return real(page, w, h)

    monkeypatch.setattr(pdf_ingest_module, "_render_page", flaky)
    pdf = make_pdf(
        tmp_path / "src.pdf", [{"title": "Eins"}, {"title": "Zwei", "body": "Text bleibt"}, {}]
    )
    deck = add_deck(conn, tmp_path, pdf)
    job = add_job(conn, {"slide_deck_id": str(deck)})
    worker.drain(conn)
    assert get_job(conn, job)["state"] == "fertig"
    assert state_of(conn, deck) == "verarbeitet"
    rows = conn.execute(
        "SELECT index, image_path, thumb_path, text FROM slide WHERE deck_id = %s ORDER BY index",
        (deck,),
    ).fetchall()
    assert rows[0][1]
    assert rows[2][1]
    assert rows[1][1] is None
    assert rows[1][2] is None
    assert "Text bleibt" in rows[1][3]


class _FakePage:
    rect = pymupdf.Rect(0, 0, 960, 540)

    def get_text(self, *_args: Any, **_kw: Any) -> dict[str, Any]:
        nan = float("nan")
        line = {"bbox": (0, 0, 10, 10), "spans": [{"text": "Hallo", "size": 20.0}]}
        return {"blocks": [{"type": 0, "bbox": (nan, 0, float("inf"), 5), "lines": [line]}]}


def test_non_finite_bbox_is_sanitized() -> None:
    text, blocks, title = extract_text(_FakePage())  # type: ignore[arg-type]
    assert text == "Hallo"
    assert title == "Hallo"
    assert blocks[0]["bbox"] == [0.0, 0.0, 0.0, 5.0]


def test_final_failure_hook_runs_for_connection_loss_and_crash(
    worker: Worker, conn: psycopg.Connection[Any], tmp_path: Path
) -> None:
    """Verbindungsverlust (fail_own_running) und Absturz (recover_stuck) beim letzten Versuch."""
    pdf = make_pdf(tmp_path / "src.pdf", [{"title": "A"}])
    deck_a = add_deck(conn, tmp_path, pdf)
    sheet_b = uuid7()
    conn.execute(
        "INSERT INTO exercise_sheet (id, user_id, module_id, title, file_path, sha256) "
        "VALUES (%s, %s, %s, 't', 'x', %s)",
        (sheet_b, USER_ID, MODULE_ID, "0" * 64),
    )
    own = add_job(conn, {"slide_deck_id": str(deck_a)}, max_attempts=1)
    killer = add_job(conn, {"exercise_sheet_id": str(sheet_b)}, max_attempts=1)
    conn.execute(
        "UPDATE job SET state = 'laeuft', attempts = 1, locked_by = %s, locked_at = now() "
        "WHERE id = %s",
        (worker.worker_id, own),
    )
    conn.execute(
        "UPDATE job SET state = 'laeuft', attempts = 1, locked_by = 'tot:1', "
        "locked_at = now() - interval '1 hour' WHERE id = %s",
        (killer,),
    )
    with running(worker):
        assert wait_for(lambda: state_of(conn, deck_a) == "fehler")
        assert wait_for(lambda: state_of(conn, sheet_b, "exercise_sheet") == "fehler")
    assert get_job(conn, own)["state"] == "fehler"
    assert get_job(conn, killer)["state"] == "fehler"
    assert "abgestürzt" in get_job(conn, killer)["error"]


def test_stuck_foreign_job_is_picked_up_while_running(
    database_url: str,
    connect_kwargs: dict[str, Any],
    tmp_path: Path,
    conn: psycopg.Connection[Any],
    make_job: MakeJob,
) -> None:
    """Abgestürzter Fremd-Worker: Der Job läuft nach der Schwelle weiter (Prüfung wiederholt)."""
    reg = Registry()
    reg.register("internal.echo", lambda payload, ctx: {"ok": True})
    w = Worker(
        database_url,
        tmp_path,
        registry=reg,
        connect_kwargs=connect_kwargs,
        channel=f"sg_jobs_{uuid.uuid4().hex[:8]}",
        stuck_after=2,
        recover_interval=0.5,
    )
    with running(w):
        time.sleep(0.5)
        job_id = make_job(state="laeuft", attempts=1)
        conn.execute(
            "UPDATE job SET locked_by = 'tot:9', locked_at = now() WHERE id = %s", (job_id,)
        )
        time.sleep(1)
        assert get_job(conn, job_id)["state"] == "laeuft"  # Lock noch frisch
        assert wait_for(lambda: get_job(conn, job_id)["state"] == "fertig", timeout=8)
    assert get_job(conn, job_id)["attempts"] == 2
