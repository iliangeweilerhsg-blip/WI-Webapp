"""`pdf.ingest`: PDF einlesen (05 §P1, ohne Vision).

Pro Seite: PNG (2x, höchstens 2400 px breit), WebP-Vorschau (320 px), Text und Textblöcke mit
Bounding-Box in pt, Seitenmaße und für Foliensätze eine Titel-Heuristik. Schreibt bei
Foliensätzen `slide`-Zeilen und `slide_deck.page_count`, bei Übungsblättern
`exercise_sheet.page_count`; danach `ingest_state='verarbeitet'`.

Die Zerlegung eines Blatts in Aufgaben (`task`) kommt erst mit `sheet.split` (Phase 2).

Lizenz-Hinweis: PyMuPDF steht unter AGPL-3.0 (oder kommerzieller Lizenz). Das Projekt läuft
rein lokal und wird nicht als Dienst angeboten; bei einer Weitergabe der App ist die AGPL zu
beachten.
"""

from __future__ import annotations

import io
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import psycopg
import pymupdf
from PIL import Image
from psycopg.types.json import Jsonb
from sg_schemas.models import PdfIngestDeckPayload, PdfIngestPayload, PdfIngestSheetPayload

from ..registry import JobContext, PayloadError, handler
from ..uuid7 import uuid7

#: Renderfaktor und Obergrenzen (05 §P1: 2x, max. 2400 px Breite)
RENDER_SCALE = 2.0
MAX_IMAGE_WIDTH_PX = 2400
MAX_IMAGE_HEIGHT_PX = 4800
THUMB_WIDTH_PX = 320
THUMB_QUALITY = 80
#: Titel: Schrift im oberen Drittel, Zeilen ab 90 % der größten Schrift gehören dazu
TITLE_ZONE = 1 / 3
TITLE_SIZE_TOLERANCE = 0.9
TITLE_MAX_CHARS = 200


@dataclass
class PageData:
    index: int  # 1-basiert
    width_pt: float
    height_pt: float
    text: str
    text_blocks: list[dict[str, Any]]
    title: str | None
    image_rel: str
    thumb_rel: str


@dataclass
class IngestOutput:
    pages: list[PageData] = field(default_factory=list)

    @property
    def pages_with_text(self) -> int:
        return sum(1 for p in self.pages if p.text.strip())


def _clean(text: str) -> str:
    """Entfernt Zeichen, die Postgres in `text`/`jsonb` ablehnt (NUL, einzelne Surrogate)."""
    return text.replace("\x00", "").encode("utf-8", "ignore").decode("utf-8")


def _write_atomic(path: Path, data: bytes) -> None:
    """Temporär schreiben, dann umbenennen: nie eine halb geschriebene Bilddatei."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        tmp.write_bytes(data)
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def _render_png(page: pymupdf.Page, width_pt: float, height_pt: float) -> bytes:
    scale = min(RENDER_SCALE, MAX_IMAGE_WIDTH_PX / width_pt, MAX_IMAGE_HEIGHT_PX / height_pt)
    pix = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False)
    return bytes(pix.tobytes("png"))


def _render_thumb(page: pymupdf.Page, width_pt: float) -> bytes:
    scale = THUMB_WIDTH_PX / width_pt
    pix = page.get_pixmap(
        matrix=pymupdf.Matrix(scale, scale), colorspace=pymupdf.csRGB, alpha=False
    )
    image = Image.frombytes("RGB", (pix.width, pix.height), bytes(pix.samples))
    buffer = io.BytesIO()
    image.save(buffer, format="WEBP", quality=THUMB_QUALITY, method=4)
    return buffer.getvalue()


def extract_text(page: pymupdf.Page) -> tuple[str, list[dict[str, Any]], str | None]:
    """Text, Textblöcke `{text, bbox:[x,y,w,h]}` (pt) und Titel-Kandidat einer Seite."""
    rect = page.rect
    title_limit = rect.y0 + rect.height * TITLE_ZONE
    data = page.get_text("dict", flags=pymupdf.TEXTFLAGS_TEXT, sort=True)

    blocks: list[dict[str, Any]] = []
    best_size = 0.0
    best_lines: list[tuple[float, str]] = []  # (Größe, Text) der Titelzeilen des besten Blocks
    for block in data.get("blocks", []):
        if block.get("type") != 0:
            continue
        lines: list[tuple[float, str, float]] = []  # (Größe, Text, Oberkante)
        for line in block.get("lines", []):
            spans = [s for s in line.get("spans", []) if s.get("text", "").strip()]
            if not spans:
                continue
            text = _clean("".join(s["text"] for s in line["spans"])).strip()
            if not text:
                continue
            size = max(float(s.get("size", 0.0)) for s in spans)
            lines.append((size, text, float(line["bbox"][1])))
        if not lines:
            continue
        x0, y0, x1, y1 = (float(v) for v in block["bbox"])
        blocks.append(
            {
                "text": "\n".join(text for _, text, _ in lines),
                "bbox": [round(x0, 2), round(y0, 2), round(x1 - x0, 2), round(y1 - y0, 2)],
            }
        )
        in_zone = [(size, text) for size, text, top in lines if top < title_limit]
        if in_zone:
            block_size = max(size for size, _ in in_zone)
            if block_size > best_size:
                best_size = block_size
                best_lines = in_zone

    title: str | None = None
    if best_lines:
        parts = [t for size, t in best_lines if size >= best_size * TITLE_SIZE_TOLERANCE]
        joined = " ".join(parts).strip()
        if joined:
            title = joined[:TITLE_MAX_CHARS]
    text = "\n".join(b["text"] for b in blocks)
    return text, blocks, title


def process_pdf(pdf_path: Path, media_dir: Path, subdir: str, rel_base: str) -> IngestOutput:
    """Rendert alle Seiten nach `media_dir/<subdir>/<n>.png` und `thumbs/<n>.webp`.

    `rel_base` ist der Ordner relativ zu `SG_DATA_DIR` (für die Pfade in der DB). Frühere
    Ergebnisse werden überschrieben, überzählige Dateien (kürzeres PDF) entfernt.
    """
    out = IngestOutput()
    try:
        doc = pymupdf.open(pdf_path)
    except (pymupdf.FileDataError, pymupdf.FileNotFoundError, RuntimeError) as exc:
        raise ValueError(f"PDF nicht lesbar: {exc}") from exc
    with doc:
        if doc.needs_pass:
            raise ValueError("PDF ist passwortgeschützt")
        if doc.page_count < 1:
            raise ValueError("PDF enthält keine Seiten")
        for number in range(1, doc.page_count + 1):
            page = doc.load_page(number - 1)
            width_pt = float(page.rect.width)
            height_pt = float(page.rect.height)
            if width_pt <= 0 or height_pt <= 0:
                raise ValueError(f"Seite {number} hat keine gültige Größe")
            image_rel = f"{rel_base}/{subdir}/{number}.png"
            thumb_rel = f"{rel_base}/thumbs/{number}.webp"
            png = _render_png(page, width_pt, height_pt)
            _write_atomic(media_dir / subdir / f"{number}.png", png)
            _write_atomic(media_dir / "thumbs" / f"{number}.webp", _render_thumb(page, width_pt))
            text, blocks, title = extract_text(page)
            out.pages.append(
                PageData(
                    index=number,
                    width_pt=round(width_pt, 2),
                    height_pt=round(height_pt, 2),
                    text=text,
                    text_blocks=blocks,
                    title=title,
                    image_rel=image_rel,
                    thumb_rel=thumb_rel,
                )
            )
    _remove_stale(media_dir / subdir, ".png", len(out.pages))
    _remove_stale(media_dir / "thumbs", ".webp", len(out.pages))
    return out


def _remove_stale(folder: Path, suffix: str, keep_up_to: int) -> None:
    for file in folder.glob(f"*{suffix}"):
        if file.stem.isdigit() and int(file.stem) > keep_up_to:
            file.unlink(missing_ok=True)


def _safe_source(data_dir: Path, file_path: str) -> Path:
    root = data_dir.resolve()
    path = (root / file_path).resolve()
    if not path.is_relative_to(root):
        raise ValueError("Dateipfad liegt außerhalb des Datenordners")
    return path


def _mark_error_if_last_attempt(ctx: JobContext, table: str, row_id: Any) -> None:
    """Letzter Versuch gescheitert: `ingest_state='fehler'` (VERTRAEGE §3: danach kein Retry)."""
    try:
        row = ctx.conn.execute(
            "SELECT attempts >= max_attempts FROM job WHERE id = %s", (ctx.job_id,)
        ).fetchone()
        if row is not None and row[0]:
            ctx.conn.execute(
                f"UPDATE {table} SET ingest_state = 'fehler', updated_at = now() WHERE id = %s",
                (row_id,),
            )
    except psycopg.Error:
        ctx.logger.exception("ingest_state konnte nicht auf 'fehler' gesetzt werden")


_UPSERT_SLIDE = """
INSERT INTO slide (id, user_id, deck_id, index, image_path, thumb_path, width_pt, height_pt,
                   text, text_blocks, title)
VALUES (%(id)s, %(user_id)s, %(deck_id)s, %(index)s, %(image_path)s, %(thumb_path)s,
        %(width_pt)s, %(height_pt)s, %(text)s, %(text_blocks)s, %(title)s)
ON CONFLICT (deck_id, index) WHERE deleted_at IS NULL DO UPDATE SET
  image_path = EXCLUDED.image_path, thumb_path = EXCLUDED.thumb_path,
  width_pt = EXCLUDED.width_pt, height_pt = EXCLUDED.height_pt, text = EXCLUDED.text,
  text_blocks = EXCLUDED.text_blocks, title = EXCLUDED.title, updated_at = now()
"""


@handler("pdf.ingest", payload_type=PdfIngestPayload)
def pdf_ingest(
    payload: PdfIngestDeckPayload | PdfIngestSheetPayload, ctx: JobContext
) -> dict[str, Any]:
    started = time.monotonic()
    if isinstance(payload, PdfIngestDeckPayload):
        table, kind, row_id = "slide_deck", "decks", payload.slide_deck_id
        subdir = "slides"
    else:
        table, kind, row_id = "exercise_sheet", "sheets", payload.exercise_sheet_id
        subdir = "pages"

    row = ctx.conn.execute(
        f"SELECT file_path, user_id FROM {table} WHERE id = %s AND deleted_at IS NULL",
        (row_id,),
    ).fetchone()
    if row is None:
        # Gelöscht oder nie vorhanden: ein neuer Versuch ändert nichts
        raise PayloadError(f"{table} {row_id} nicht gefunden")
    file_path, user_id = row

    try:
        source = _safe_source(ctx.data_dir, file_path)
        rel_base = f"media/{kind}/{row_id}"
        out = process_pdf(source, ctx.data_dir / rel_base, subdir, rel_base)
    except Exception:
        _mark_error_if_last_attempt(ctx, table, row_id)
        raise

    result = {
        "page_count": len(out.pages),
        "pages_with_text": out.pages_with_text,
        "duration_ms": int((time.monotonic() - started) * 1000),
    }
    with ctx.conn.transaction():
        if kind == "decks":
            with ctx.conn.cursor() as cur:
                cur.executemany(
                    _UPSERT_SLIDE,
                    [
                        {
                            "id": uuid7(),
                            "user_id": user_id,
                            "deck_id": row_id,
                            "index": p.index,
                            "image_path": p.image_rel,
                            "thumb_path": p.thumb_rel,
                            "width_pt": p.width_pt,
                            "height_pt": p.height_pt,
                            "text": p.text,
                            "text_blocks": Jsonb(p.text_blocks),
                            "title": p.title,
                        }
                        for p in out.pages
                    ],
                )
                # Kürzeres PDF bei erneutem Lauf: überzählige Folien entfernen
                cur.execute(
                    "DELETE FROM slide WHERE deck_id = %s AND index > %s",
                    (row_id, len(out.pages)),
                )
        ctx.conn.execute(
            f"UPDATE {table} SET page_count = %s, ingest_state = 'verarbeitet', "
            "updated_at = now() WHERE id = %s",
            (len(out.pages), row_id),
        )
        ctx.finish(result)
    return result
