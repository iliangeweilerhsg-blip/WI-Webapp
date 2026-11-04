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
import logging
import math
import os
import re
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import psycopg
import pymupdf
from PIL import Image
from psycopg.types.json import Jsonb
from sg_schemas.models import PdfIngestDeckPayload, PdfIngestPayload, PdfIngestSheetPayload

from ..registry import JobContext, LockLostError, NonRetryableError, PayloadError, handler
from ..uuid7 import uuid7

#: Renderfaktor und Obergrenzen (05 §P1: 2x, max. 2400 px Breite)
RENDER_SCALE = 2.0
MAX_IMAGE_WIDTH_PX = 2400
MAX_IMAGE_HEIGHT_PX = 4800
THUMB_WIDTH_PX = 320
THUMB_MAX_HEIGHT_PX = 960  # WebP erlaubt höchstens 16383 px; sehr hohe Seiten bleiben klein
THUMB_QUALITY = 80
#: Titel: Schrift im oberen Drittel, Zeilen ab 90 % der größten Schrift gehören dazu
TITLE_ZONE = 1 / 3
TITLE_SIZE_TOLERANCE = 0.9
TITLE_MAX_CHARS = 200


log = logging.getLogger(__name__)


class IngestError(NonRetryableError):
    """Das PDF ist unbrauchbar (beschädigt, passwortgeschützt, leer). Ein Retry ändert nichts."""


class TransientIngestError(Exception):
    """Alles andere (I/O, DB): wiederholbar. Meldung ohne absolute Pfade."""


_ABS_PATH = re.compile(r"(?<![\w.:])/(?:[\w.\-]+/)+[\w.\-]*")


def sanitize_error(text: str, data_dir: Path) -> str:
    """Entfernt absolute Pfade aus Fehlertexten (`job.error` ist in der API sichtbar)."""
    for variant in {str(data_dir), str(data_dir.resolve())}:
        text = text.replace(variant.rstrip("/") + "/", "").replace(variant, "<SG_DATA_DIR>")
    return _ABS_PATH.sub("<Pfad>", text)


@dataclass
class PageData:
    index: int  # 1-basiert
    width_pt: float
    height_pt: float
    text: str
    text_blocks: list[dict[str, Any]]
    title: str | None
    image_rel: str | None  # None: Seite nicht renderbar, Text bleibt erhalten
    thumb_rel: str | None


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


def _finite(value: float) -> float:
    """NaN/inf (kaputte Textkoordinaten) passen weder in `jsonb` noch in `real`."""
    return round(value, 2) if math.isfinite(value) else 0.0


def _render_page(page: pymupdf.Page, width_pt: float, height_pt: float) -> tuple[bytes, bytes]:
    """PNG (2x, begrenzt) und WebP-Vorschau. Die Vorschau entsteht aus dem schon gerenderten
    Pixmap (kein zweites Rendern), Skala `min(320/w, 960/h)` relativ zur Seite."""
    scale = min(RENDER_SCALE, MAX_IMAGE_WIDTH_PX / width_pt, MAX_IMAGE_HEIGHT_PX / height_pt)
    pix = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False)
    png = bytes(pix.tobytes("png"))
    image = Image.frombuffer(
        "RGB", (pix.width, pix.height), pix.samples, "raw", "RGB", pix.stride, 1
    )
    factor = min(1.0, min(THUMB_WIDTH_PX / width_pt, THUMB_MAX_HEIGHT_PX / height_pt) / scale)
    if factor < 1.0:
        size = (max(1, round(pix.width * factor)), max(1, round(pix.height * factor)))
        image = image.resize(size, Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    image.save(buffer, format="WEBP", quality=THUMB_QUALITY, method=4)
    return png, buffer.getvalue()


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
                "bbox": [_finite(x0), _finite(y0), _finite(x1 - x0), _finite(y1 - y0)],
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
    Ergebnisse werden überschrieben, überzählige Dateien (kürzeres PDF) entfernt. Eine nicht
    renderbare Seite bekommt keine Bildpfade, behält aber ihren Text; das PDF als Ganzes scheitert
    nur, wenn es sich nicht öffnen lässt, passwortgeschützt oder leer ist.
    """
    out = IngestOutput()
    if not pdf_path.is_file():
        raise FileNotFoundError("Original-PDF fehlt")
    try:
        doc = pymupdf.open(pdf_path)
    except (pymupdf.FileDataError, RuntimeError) as exc:
        raise IngestError("PDF nicht lesbar (beschädigt oder kein PDF)") from exc
    with doc:
        if doc.needs_pass:
            raise IngestError("PDF ist passwortgeschützt")
        if doc.page_count < 1:
            raise IngestError("PDF enthält keine Seiten")
        for number in range(1, doc.page_count + 1):
            png_path = media_dir / subdir / f"{number}.png"
            thumb_path = media_dir / "thumbs" / f"{number}.webp"
            try:
                page = doc.load_page(number - 1)
                width_pt = float(page.rect.width)
                height_pt = float(page.rect.height)
            except Exception as exc:
                raise IngestError(f"Seite {number} lässt sich nicht laden") from exc
            if (
                not (math.isfinite(width_pt) and math.isfinite(height_pt))
                or min(width_pt, height_pt) <= 0
            ):
                raise IngestError(f"Seite {number} hat keine gültige Größe")
            image_rel: str | None = f"{rel_base}/{subdir}/{number}.png"
            thumb_rel: str | None = f"{rel_base}/thumbs/{number}.webp"
            try:
                png, thumb = _render_page(page, width_pt, height_pt)
                _write_atomic(png_path, png)
                _write_atomic(thumb_path, thumb)
            except Exception:
                log.warning("Seite %d nicht renderbar, nur Text", number, exc_info=True)
                image_rel = thumb_rel = None
                png_path.unlink(missing_ok=True)
                thumb_path.unlink(missing_ok=True)
            try:
                text, blocks, title = extract_text(page)
            except Exception:
                log.warning("Text von Seite %d nicht lesbar", number, exc_info=True)
                text, blocks, title = "", [], None
            out.pages.append(
                PageData(
                    index=number,
                    width_pt=_finite(width_pt),
                    height_pt=_finite(height_pt),
                    text=text,
                    text_blocks=blocks,
                    title=title,
                    image_rel=image_rel,
                    thumb_rel=thumb_rel,
                )
            )
            pymupdf.TOOLS.store_shrink(100)  # Cache der Seite freigeben
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


def mark_ingest_failed(conn: psycopg.Connection[Any], payload: dict[str, Any]) -> None:
    """Hook `on_final_failure`: Der Job ist endgültig gescheitert, egal auf welchem Weg
    (Handler-Fehler, Verbindungsverlust, abgestürzter Worker) -> `ingest_state='fehler'`."""
    for key, table in (("slide_deck_id", "slide_deck"), ("exercise_sheet_id", "exercise_sheet")):
        raw = payload.get(key)
        if raw is None:
            continue
        try:
            row_id = uuid.UUID(str(raw))
        except ValueError:
            return
        conn.execute(
            f"UPDATE {table} SET ingest_state = 'fehler', updated_at = now() WHERE id = %s",
            (row_id,),
        )
        return


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


@handler("pdf.ingest", payload_type=PdfIngestPayload, on_final_failure=mark_ingest_failed)
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
            if not ctx.lock_ok:
                # Der Job gehört einem anderen Worker: nichts committen
                raise LockLostError(ctx.job_id)
    except (NonRetryableError, LockLostError, psycopg.OperationalError, psycopg.InterfaceError):
        raise
    except Exception as exc:
        # Meldung ohne absolute Pfade; `ingest_state='fehler'` setzt der Hook beim endgültigen
        # Scheitern
        raise TransientIngestError(
            sanitize_error(f"{type(exc).__name__}: {exc}", ctx.data_dir)
        ) from exc
    return result
