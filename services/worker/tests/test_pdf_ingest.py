"""`pdf.ingest`: Rendering, Text/BBox, Titel, Idempotenz, Fehlerpfad, Transaktion."""

from __future__ import annotations

import io
import uuid
from pathlib import Path
from typing import Any

import psycopg
import pymupdf
import pytest
from PIL import Image
from psycopg.types.json import Jsonb
from sg_schemas.models import PdfIngestPayload, PdfIngestResult

from conftest import USER_ID, get_job
from sg_worker.handlers.pdf_ingest import extract_text, pdf_ingest, process_pdf
from sg_worker.loop import Worker
from sg_worker.registry import Registry
from sg_worker.uuid7 import uuid7

MODULE_ID = uuid.UUID("00000000-0000-7000-8000-0000000000aa")


def make_pdf(
    path: Path,
    pages: list[dict[str, Any]],
    *,
    size: tuple[float, float] = (960, 540),
) -> Path:
    """Erzeugt ein PDF. Pro Seite: `title` (36 pt, oben), `body` (14 pt, Mitte), `footer`."""
    doc = pymupdf.open()
    for spec in pages:
        page = doc.new_page(width=size[0], height=size[1])
        if spec.get("footer"):
            page.insert_text((40, size[1] - 20), spec["footer"], fontsize=48)
        if spec.get("title"):
            page.insert_text((40, 70), spec["title"], fontsize=36)
        if spec.get("body"):
            page.insert_text((40, size[1] / 2), spec["body"], fontsize=14)
    doc.save(path)
    doc.close()
    return path


# ---------- Rendering, Text, Titel (ohne Datenbank) ----------


def test_renders_png_webp_text_and_bbox(tmp_path: Path) -> None:
    pdf = make_pdf(
        tmp_path / "in.pdf",
        [{"title": "Normalformen", "body": "Die dritte Normalform"}, {"body": "Nur Text"}, {}],
    )
    media = tmp_path / "media" / "decks" / "abc"
    out = process_pdf(pdf, media, "slides", "media/decks/abc")
    assert [p.index for p in out.pages] == [1, 2, 3]
    first = out.pages[0]
    assert (first.width_pt, first.height_pt) == (960.0, 540.0)
    assert first.image_rel == "media/decks/abc/slides/1.png"
    assert first.thumb_rel == "media/decks/abc/thumbs/1.webp"
    png = Image.open(media / "slides" / "1.png")
    assert png.format == "PNG"
    assert png.size == (1920, 1080)  # 2x
    thumb = Image.open(media / "thumbs" / "1.webp")
    assert thumb.format == "WEBP"
    assert thumb.size[0] == 320
    assert "Normalformen" in first.text
    assert "Die dritte Normalform" in first.text
    assert len(first.text_blocks) >= 1
    for block in first.text_blocks:
        x, y, w, h = block["bbox"]
        assert 0 <= x < 960 and 0 <= y < 540 and w > 0 and h > 0
    # Der Block mit dem Titel liegt oben (y klein), der Fließtext tiefer
    by_text = {b["text"]: b["bbox"] for b in first.text_blocks}
    assert by_text["Normalformen"][1] < by_text["Die dritte Normalform"][1]
    assert out.pages_with_text == 2
    assert out.pages[2].text == ""
    assert out.pages[2].text_blocks == []


def test_width_is_capped_at_2400_px(tmp_path: Path) -> None:
    pdf = make_pdf(tmp_path / "wide.pdf", [{"body": "breit"}], size=(2000, 1000))
    media = tmp_path / "m"
    process_pdf(pdf, media, "pages", "m")
    assert Image.open(media / "pages" / "1.png").size[0] == 2400


def test_title_is_largest_text_in_top_third(tmp_path: Path) -> None:
    pdf = make_pdf(
        tmp_path / "t.pdf",
        [
            # Größere Schrift am unteren Rand zählt nicht (nicht im oberen Drittel)
            {"title": "Relationale Algebra", "body": "Text", "footer": "Fußzeile"},
            {"body": "kein großer Titel, aber Text"},
            {},
        ],
    )
    with pymupdf.open(pdf) as doc:
        t1, _, title1 = extract_text(doc[0])
        _, _, title2 = extract_text(doc[1])
        _, _, title3 = extract_text(doc[2])
    assert title1 == "Relationale Algebra"
    assert "Fußzeile" in t1
    # Ohne Titel-Schrift ist der Text selbst der größte im oberen Drittel nur, wenn er dort liegt
    assert title2 is None
    assert title3 is None


def test_multiline_title_is_joined(tmp_path: Path) -> None:
    doc = pymupdf.open()
    page = doc.new_page(width=960, height=540)
    page.insert_text((40, 60), "Entity-Relationship-", fontsize=32)
    page.insert_text((40, 100), "Modell", fontsize=32)
    page.insert_text((40, 300), "Fließtext", fontsize=12)
    pdf = tmp_path / "m.pdf"
    doc.save(pdf)
    doc.close()
    with pymupdf.open(pdf) as d:
        _, _, title = extract_text(d[0])
    assert title is not None
    assert title.startswith("Entity-Relationship-")
    assert "Modell" in title


def test_broken_pdf_raises(tmp_path: Path) -> None:
    bad = tmp_path / "bad.pdf"
    bad.write_bytes(b"%PDF-1.4\nkaputt\n")
    with pytest.raises(ValueError, match="nicht lesbar"):
        process_pdf(bad, tmp_path / "m", "slides", "m")


def test_uuid7_is_ordered_and_valid() -> None:
    ids = [uuid7() for _ in range(2000)]
    assert all(i.version == 7 and i.variant == uuid.RFC_4122 for i in ids)
    assert ids == sorted(ids)
    assert len(set(ids)) == len(ids)


# ---------- Mit Datenbank ----------


@pytest.fixture
def worker(
    database_url: str, connect_kwargs: dict[str, Any], tmp_path: Path, schema: str
) -> Worker:
    reg = Registry()
    reg.register("pdf.ingest", pdf_ingest, PdfIngestPayload)
    return Worker(
        database_url,
        tmp_path,
        registry=reg,
        connect_kwargs=connect_kwargs,
        channel=f"sg_jobs_{uuid.uuid4().hex[:8]}",
    )


def add_deck(
    conn: psycopg.Connection[Any], data_dir: Path, pdf: Path, table: str = "slide_deck"
) -> uuid.UUID:
    row_id = uuid7()
    kind = "decks" if table == "slide_deck" else "sheets"
    rel = f"media/{kind}/{row_id}/original.pdf"
    target = data_dir / rel
    target.parent.mkdir(parents=True)
    target.write_bytes(pdf.read_bytes())
    conn.execute(
        f"INSERT INTO {table} (id, user_id, module_id, title, file_path, sha256) "
        "VALUES (%s, %s, %s, 'Test', %s, %s)",
        (row_id, USER_ID, MODULE_ID, rel, "0" * 64),
    )
    return row_id


def add_job(
    conn: psycopg.Connection[Any], payload: dict[str, str], *, max_attempts: int = 3
) -> uuid.UUID:
    job_id = uuid7()
    conn.execute(
        "INSERT INTO job (id, user_id, type, payload, max_attempts) "
        "VALUES (%s, %s, 'pdf.ingest', %s::jsonb, %s)",
        (job_id, USER_ID, Jsonb(payload), max_attempts),
    )
    return job_id


def test_deck_ingest_end_to_end(
    worker: Worker, conn: psycopg.Connection[Any], tmp_path: Path
) -> None:
    pdf = make_pdf(
        tmp_path / "src.pdf",
        [{"title": "Einführung", "body": "Willkommen"}, {"title": "SQL", "body": "SELECT"}, {}],
    )
    deck = add_deck(conn, tmp_path, pdf)
    job = add_job(conn, {"slide_deck_id": str(deck)})
    assert worker.drain(conn) == 1

    row = get_job(conn, job)
    assert row["state"] == "fertig"
    result = PdfIngestResult.model_validate(row["result"])
    assert (result.page_count, result.pages_with_text) == (3, 2)

    deck_row = conn.execute(
        "SELECT page_count, ingest_state FROM slide_deck WHERE id = %s", (deck,)
    ).fetchone()
    assert deck_row == (3, "verarbeitet")
    slides = conn.execute(
        "SELECT index, title, image_path, thumb_path, width_pt, height_pt, text, text_blocks "
        "FROM slide WHERE deck_id = %s ORDER BY index",
        (deck,),
    ).fetchall()
    assert [s[0] for s in slides] == [1, 2, 3]
    assert [s[1] for s in slides] == ["Einführung", "SQL", None]
    assert slides[0][2] == f"media/decks/{deck}/slides/1.png"
    assert slides[0][3] == f"media/decks/{deck}/thumbs/1.webp"
    assert (slides[0][4], slides[0][5]) == (960.0, 540.0)
    assert "Willkommen" in slides[0][6]
    assert slides[0][7][0]["bbox"] and len(slides[0][7][0]["bbox"]) == 4
    assert (tmp_path / slides[2][2]).is_file()
    assert (tmp_path / slides[2][3]).is_file()


def test_rerun_is_idempotent_and_keeps_slide_ids(
    worker: Worker, conn: psycopg.Connection[Any], tmp_path: Path
) -> None:
    pdf = make_pdf(tmp_path / "src.pdf", [{"title": "A"}, {"title": "B"}, {"title": "C"}])
    deck = add_deck(conn, tmp_path, pdf)
    add_job(conn, {"slide_deck_id": str(deck)})
    worker.drain(conn)
    ids = conn.execute("SELECT id FROM slide WHERE deck_id = %s ORDER BY index", (deck,)).fetchall()

    add_job(conn, {"slide_deck_id": str(deck)})
    worker.drain(conn)
    again = conn.execute(
        "SELECT id FROM slide WHERE deck_id = %s ORDER BY index", (deck,)
    ).fetchall()
    assert again == ids
    assert len(again) == 3

    # Kürzeres PDF: überzählige Folien und Bilddateien verschwinden
    short = make_pdf(tmp_path / "short.pdf", [{"title": "A"}])
    (tmp_path / "media" / "decks" / str(deck) / "original.pdf").write_bytes(short.read_bytes())
    add_job(conn, {"slide_deck_id": str(deck)})
    worker.drain(conn)
    count = conn.execute("SELECT count(*) FROM slide WHERE deck_id = %s", (deck,)).fetchone()
    assert count == (1,)
    assert not (tmp_path / "media" / "decks" / str(deck) / "slides" / "3.png").exists()
    assert not (tmp_path / "media" / "decks" / str(deck) / "thumbs" / "2.webp").exists()


def test_sheet_ingest_writes_pages_not_slides(
    worker: Worker, conn: psycopg.Connection[Any], tmp_path: Path
) -> None:
    pdf = make_pdf(
        tmp_path / "blatt.pdf", [{"title": "Aufgabe 1", "body": "a) Berechne"}, {"body": "b)"}]
    )
    sheet = add_deck(conn, tmp_path, pdf, "exercise_sheet")
    job = add_job(conn, {"exercise_sheet_id": str(sheet)})
    worker.drain(conn)
    assert get_job(conn, job)["state"] == "fertig"
    assert conn.execute(
        "SELECT page_count, ingest_state FROM exercise_sheet WHERE id = %s", (sheet,)
    ).fetchone() == (2, "verarbeitet")
    assert conn.execute("SELECT count(*) FROM slide").fetchone() == (0,)
    base = tmp_path / "media" / "sheets" / str(sheet)
    assert (base / "pages" / "1.png").is_file()
    assert (base / "pages" / "2.png").is_file()
    assert (base / "thumbs" / "2.webp").is_file()
    img = Image.open(io.BytesIO((base / "pages" / "1.png").read_bytes()))
    assert img.size == (1920, 1080)


def test_broken_pdf_retries_then_marks_fehler(
    worker: Worker, conn: psycopg.Connection[Any], tmp_path: Path
) -> None:
    bad = tmp_path / "bad.pdf"
    bad.write_bytes(b"%PDF-1.4\nkaputt")
    deck = add_deck(conn, tmp_path, bad)
    job = add_job(conn, {"slide_deck_id": str(deck)}, max_attempts=2)

    worker.drain(conn)
    row = get_job(conn, job)
    assert row["state"] == "wartet"  # Retry laut Vertrag
    assert "nicht lesbar" in row["error"]
    # Nach dem ersten Versuch noch nicht endgültig gescheitert
    assert conn.execute(
        "SELECT ingest_state FROM slide_deck WHERE id = %s", (deck,)
    ).fetchone() == ("neu",)

    conn.execute("UPDATE job SET run_after = NULL WHERE id = %s", (job,))
    worker.drain(conn)
    assert get_job(conn, job)["state"] == "fehler"
    assert conn.execute(
        "SELECT ingest_state FROM slide_deck WHERE id = %s", (deck,)
    ).fetchone() == ("fehler",)
    assert conn.execute("SELECT count(*) FROM slide").fetchone() == (0,)


def test_missing_row_fails_without_retry(worker: Worker, conn: psycopg.Connection[Any]) -> None:
    job = add_job(conn, {"slide_deck_id": str(uuid7())})
    worker.drain(conn)
    row = get_job(conn, job)
    assert row["state"] == "fehler"
    assert row["attempts"] == 1
    assert "nicht gefunden" in row["error"]


def test_db_failure_rolls_back_slides_and_job_stays_open(
    worker: Worker, conn: psycopg.Connection[Any], tmp_path: Path, schema: str
) -> None:
    """Zieltabellen und `fertig` in einer Transaktion: scheitert das Update des Foliensatzes,
    bleiben keine Folien zurück und der Job ist nicht `fertig`."""
    conn.execute(
        """
        CREATE FUNCTION block_deck_update() RETURNS trigger LANGUAGE plpgsql AS
        $$ BEGIN RAISE EXCEPTION 'gesperrt'; END $$;
        """
    )
    conn.execute(
        "CREATE TRIGGER block_deck BEFORE UPDATE ON slide_deck "
        "FOR EACH ROW EXECUTE FUNCTION block_deck_update()"
    )
    pdf = make_pdf(tmp_path / "src.pdf", [{"title": "A"}, {"title": "B"}])
    deck = add_deck(conn, tmp_path, pdf)
    job = add_job(conn, {"slide_deck_id": str(deck)})
    worker.drain(conn)
    row = get_job(conn, job)
    assert row["state"] == "wartet"
    assert "gesperrt" in row["error"]
    assert conn.execute("SELECT count(*) FROM slide").fetchone() == (0,)
    assert conn.execute(
        "SELECT ingest_state FROM slide_deck WHERE id = %s", (deck,)
    ).fetchone() == ("neu",)
