"""`search.index`: Suchindex eines Foliensatzes oder einer Session (VERTRAEGE §19.1, §19.3).

Ablauf:

1. Payload prüfen. Ziel ohne Sperre lesen: fehlt die Zeile → `fertig` mit `missing`, weich gelöscht
   → `fertig` mit `deleted` (nichts schreiben).
2. Stücke bilden (`deck_chunks`, `session_chunks`, rein und ohne DB testbar) und die vorhandenen
   Einträge des Ziels lesen.
3. Vektoren mit gleichem Text (`content_hash`), gleicher `index_version` und gleichem Modell
   wiederverwenden. Die übrigen in Stapeln zu `EMBED_BATCH` einbetten, **außerhalb** einer
   Transaktion (der Heartbeat läuft weiter), vorher `wait_ready(600)`.
4. Ohne Embedder trotzdem schreiben, mit `embedding = NULL` (die Wortsuche funktioniert immer).
5. Eine Transaktion: Ziel sperren und erneut lesen, Lock prüfen, veraltete Einträge hart löschen,
   die übrigen per Upsert schreiben, bei `deck` `slide.embedding` nachziehen, `fertig`.

`job.session_id` ist bei diesem Job immer `NULL` (§19.3): kein Session-Fortschritt.
"""

from __future__ import annotations

import hashlib
import math
import re
import unicodedata
import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Any

import psycopg
from sg_schemas.models import SearchIndexPayload, SearchIndexResult

from .. import progress
from ..ai import embedder as embedders
from ..ai.embedder import EmbedderNotReady, EmbedderUnavailable, safe_error
from ..ai.interfaces import Embedder
from ..registry import JobContext, LockLostError, handler
from ..uuid7 import uuid7

#: Steigt, wenn sich Stückelung, Textbildung oder `ts_config` ändern. Der Core kennt denselben
#: Wert (§19.5): Wer ihn ändert, ändert ihn dort und in VERTRAEGE §19.3.
SEARCH_INDEX_VERSION = 1
MAX_TEXT = 8000
WINDOW_MS = 60_000
#: Klein gehalten: Eine Suchanfrage wartet höchstens auf den laufenden Stapel (§19.2), und der
#: Speicherbedarf je Stapel bleibt auf Macs mit 8 GB gering.
EMBED_BATCH = 4
#: So lange wartet ein Job auf das Laden des Modells (Sekunden)
WAIT_READY_S = 600.0

Conn = psycopg.Connection[Any]
Key = tuple[str, uuid.UUID, int]  # (source_kind, source_id, part)

# Steuerzeichen (Unicode-Kategorie Cc: U+0000 bis U+001F, U+007F bis U+009F) ohne die, die `\s`
# als Leerraum zählt (U+0009 bis U+000D, U+001C bis U+001F, U+0085)
_CONTROL = re.compile(r"[\x00-\x08\x0e-\x1b\x7f-\x84\x86-\x9f]")
_SPACE = re.compile(r"\s+")


def clean_text(text: str) -> str:
    """Säubern nach §19.3, in dieser Reihenfolge: Steuerzeichen (Cc, etwa `\\x01`/`\\x02` aus
    §19.6) außer Leerraum und Formatzeichen (Cf, etwa U+00AD, U+200B, U+FEFF) entfernen, danach NFC
    (so ist das Ergebnis immer NFC, auch wenn ein entferntes Zeichen Bestandteile trennte), Leerraum
    (`\\s+`, auch Zeilenumbrüche) zu einem Leerzeichen, trimmen, auf `MAX_TEXT` Zeichen kürzen.
    Erfüllt `text !~ '[[:cntrl:]]'`, auch wenn Postgres mit ICU Cf dazuzählt."""
    text = _CONTROL.sub("", text)
    if not text.isascii():  # Cf gibt es nur außerhalb von ASCII
        text = "".join(ch for ch in text if unicodedata.category(ch) != "Cf")
        text = unicodedata.normalize("NFC", text)
    return _SPACE.sub(" ", text).strip()[:MAX_TEXT]


def ts_config_for(lang: str | None) -> str:
    """`de` → `german`, `en` → `english`, sonst `simple`."""
    return {"de": "german", "en": "english"}.get((lang or "").strip().lower(), "simple")


def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class Chunk:
    source_kind: str  # "slide" | "transcript"
    source_id: uuid.UUID
    part: int
    text: str
    ts_config: str
    slide_index: int | None = None
    title: str | None = None
    t_ms: int | None = None
    t_end_ms: int | None = None

    @property
    def key(self) -> Key:
        return (self.source_kind, self.source_id, self.part)

    @property
    def hash(self) -> str:
        return content_hash(self.text)


@dataclass(frozen=True)
class SlideRow:
    id: uuid.UUID
    index: int
    title: str | None
    text: str | None
    vision_summary: str | None


@dataclass(frozen=True)
class SegmentRow:
    start_ms: int
    end_ms: int
    text: str
    lang: str | None


def deck_chunks(slides: Iterable[SlideRow], module_lang: str | None) -> list[Chunk]:
    """Je Folie ein Stück: nicht leere Teile aus Titel, Text und Bildbeschreibung, mit `\\n`
    verbunden, gesäubert. Leere Stücke entfallen."""
    config = ts_config_for(module_lang)
    chunks: list[Chunk] = []
    for s in slides:
        parts = [p for p in (s.title, s.text, s.vision_summary) if p and p.strip()]
        text = clean_text("\n".join(parts))
        if text:
            chunks.append(Chunk("slide", s.id, 0, text, config, slide_index=s.index, title=s.title))
    return chunks


def group_windows(segments: Sequence[SegmentRow]) -> list[list[SegmentRow]]:
    """Fenster (§19.3): Ein Abschnitt kommt in das laufende Fenster, solange danach
    `Ende - Fensterbeginn ≤ WINDOW_MS` gilt, sonst beginnt ein neues. `segments` ist nach
    `(start_ms, recording_id, seq)` sortiert. Ende des Fensters = spätestes Ende seiner
    Abschnitte."""
    windows: list[list[SegmentRow]] = []
    start = end = 0
    for seg in segments:
        if windows and max(end, seg.end_ms) - start <= WINDOW_MS:
            windows[-1].append(seg)
            end = max(end, seg.end_ms)
        else:
            windows.append([seg])
            start, end = seg.start_ms, seg.end_ms
    return windows


def session_chunks(session_id: uuid.UUID, segments: Sequence[SegmentRow]) -> list[Chunk]:
    """Je Fenster ein Stück: Abschnittstexte mit Leerzeichen, gesäubert, `t_ms`/`t_end_ms` =
    erster Beginn/spätestes Ende, `ts_config` nach der Sprache des ersten Abschnitts, `part` =
    Nummer des Fensters (ab 0). Leere Fenster entfallen, ihre Nummer bleibt frei."""
    chunks: list[Chunk] = []
    for part, window in enumerate(group_windows(segments)):
        text = clean_text(" ".join(s.text for s in window))
        if not text:
            continue
        chunks.append(
            Chunk(
                "transcript",
                session_id,
                part,
                text,
                ts_config_for(window[0].lang),
                t_ms=window[0].start_ms,
                t_end_ms=max(s.end_ms for s in window),
            )
        )
    return chunks


# ---------- Lesen ----------


@dataclass(frozen=True)
class Target:
    user_id: uuid.UUID
    deleted: bool
    module_lang: str | None = None


def _read_target(conn: Conn, scope: str, tid: uuid.UUID) -> Target | None:
    """Ziel ohne Sperre lesen (Schritt 1). None: Zeile fehlt."""
    if scope == "deck":
        row = conn.execute(
            "SELECT t.user_id, t.deleted_at, m.lang FROM slide_deck t "
            "LEFT JOIN module m ON m.id = t.module_id WHERE t.id = %s",
            (tid,),
        ).fetchone()
    else:
        row = conn.execute(
            "SELECT user_id, deleted_at, NULL FROM session WHERE id = %s", (tid,)
        ).fetchone()
    if row is None:
        return None
    return Target(user_id=row[0], deleted=row[1] is not None, module_lang=row[2])


def _lock_target(conn: Conn, scope: str, tid: uuid.UUID) -> Target | None:
    """Ziel in der Schreib-Transaktion sperren (Schritt 5), damit Löschen und Wiederherstellen
    davor oder danach liegen: Session über `progress.lock_session` (`FOR NO KEY UPDATE`),
    Foliensatz mit `FOR SHARE`. None: fehlt. `deleted`: weich gelöscht (dann nicht gesperrt)."""
    if scope == "deck":
        row = conn.execute(
            "SELECT user_id, deleted_at FROM slide_deck WHERE id = %s FOR SHARE", (tid,)
        ).fetchone()
        return None if row is None else Target(user_id=row[0], deleted=row[1] is not None)
    if progress.lock_session(conn, tid):
        row = conn.execute("SELECT user_id FROM session WHERE id = %s", (tid,)).fetchone()
        assert row is not None
        return Target(user_id=row[0], deleted=False)
    return _read_target(conn, scope, tid)  # fehlt oder gelöscht


def _build_chunks(conn: Conn, scope: str, tid: uuid.UUID, target: Target) -> list[Chunk]:
    if scope == "deck":
        rows = conn.execute(
            "SELECT id, index, title, text, vision_summary FROM slide "
            "WHERE deck_id = %s AND deleted_at IS NULL ORDER BY index, id",
            (tid,),
        ).fetchall()
        return deck_chunks((SlideRow(*r) for r in rows), target.module_lang)
    segs = conn.execute(
        "SELECT start_ms, end_ms, text, lang FROM transcript_segment "
        "WHERE session_id = %s AND deleted_at IS NULL ORDER BY start_ms, recording_id, seq",
        (tid,),
    ).fetchall()
    return session_chunks(tid, [SegmentRow(int(s[0]), int(s[1]), s[2], s[3]) for s in segs])


def _target_filter(scope: str) -> str:
    """Bedingung für die Einträge des Ziels (Parameter: Ziel-ID)."""
    if scope == "deck":
        return "source_kind = 'slide' AND deck_id = %s"
    return "source_kind = 'transcript' AND session_id = %s"


@dataclass(frozen=True)
class Existing:
    content_hash: str
    index_version: int
    embedding_model: str | None


def _existing(conn: Conn, scope: str, tid: uuid.UUID) -> dict[Key, Existing]:
    rows = conn.execute(
        "SELECT source_kind, source_id, part, content_hash, index_version, embedding_model "
        "FROM search_chunk WHERE " + _target_filter(scope) + " AND deleted_at IS NULL",
        (tid,),
    ).fetchall()
    return {(r[0], r[1], int(r[2])): Existing(r[3], int(r[4]), r[5]) for r in rows}


# ---------- Einbetten ----------


def _valid_vector(vec: Sequence[float], dim: int) -> list[float] | None:
    """Ein Vektor zum Speichern. None: Nullvektor (Fake ohne Wörter), wird nie gespeichert."""
    if len(vec) != dim:
        raise RuntimeError(f"Embedder lieferte {len(vec)} statt {dim} Dimensionen")
    values = [float(x) for x in vec]
    if not all(math.isfinite(x) for x in values):
        raise RuntimeError("Embedder lieferte ungültige Werte")
    if not any(values):
        return None
    return values


@dataclass
class Embedded:
    vectors: dict[Key, list[float] | None]
    vector_model: str  # Modell der Vektoren in `vectors`
    model: str | None  # Ergebnis: None, wenn Stücke ohne Embedder blieben (§19.3 Schritt 4)
    error: str | None


_STOPPING = "Worker wird beendet"


def embed_chunks(embedder: Embedder, todo: Sequence[Chunk]) -> Embedded:
    """Bettet `todo` in Stapeln ein (außerhalb einer Transaktion). Ist der Embedder nicht
    verfügbar oder nach `WAIT_READY_S` nicht bereit, bleiben die übrigen Stücke ohne Vektor."""
    out = Embedded({}, embedder.model, embedder.model, None)
    if not todo:
        return out
    try:
        if not embedder.wait_ready(WAIT_READY_S):
            raise EmbedderUnavailable(
                embedder.error()
                or (_STOPPING if embedders.SHUTDOWN.is_set() else None)
                or f"Embedder nach {int(WAIT_READY_S)} s nicht bereit"
            )
        for i in range(0, len(todo), EMBED_BATCH):
            batch = todo[i : i + EMBED_BATCH]
            if i > 0:
                # Drosselung nur hier, nie in `POST /embed`: CPU und GPU kurz freigeben
                embedders.pause_between_batches()
            embedders.ENDPOINT_PRIORITY.wait_idle()  # Suchanfragen gehen vor (§19.2)
            if embedders.SHUTDOWN.is_set():  # SIGTERM: Rest ohne Vektor, §19.5 holt nach
                raise EmbedderUnavailable(_STOPPING)
            vectors = embedder.embed([c.text for c in batch])
            if len(vectors) != len(batch):
                raise RuntimeError("Embedder lieferte eine falsche Anzahl Vektoren")
            for chunk, vec in zip(batch, vectors, strict=True):
                out.vectors[chunk.key] = _valid_vector(vec, embedder.dim)
        if len(todo) > EMBED_BATCH:
            release = getattr(embedder, "release_cache", None)
            if callable(release):
                release()
    except (EmbedderNotReady, EmbedderUnavailable) as exc:
        out.model = None
        out.error = safe_error(str(exc) or embedder.error() or "Embedder nicht verfügbar")
    return out


def vector_literal(vec: Sequence[float]) -> str:
    """Textform für `::vector` (pgvector)."""
    return "[" + ",".join(repr(float(x)) for x in vec) + "]"


# ---------- Schreiben ----------


def _assert_owner(ctx: JobContext) -> None:
    row = ctx.conn.execute(
        "SELECT 1 FROM job WHERE id = %s AND state = 'laeuft' AND locked_by = %s FOR UPDATE",
        (ctx.job_id, ctx.worker_id),
    ).fetchone()
    if row is None:
        raise LockLostError(ctx.job_id)


_UPSERT = """
INSERT INTO search_chunk (id, user_id, source_kind, source_id, part, deck_id, session_id,
  slide_index, t_ms, t_end_ms, title, text, ts_config, tsv, embedding, embedding_model,
  content_hash, index_version, job_id)
VALUES (%(id)s, %(user_id)s, %(kind)s, %(source_id)s, %(part)s, %(deck_id)s, %(session_id)s,
  %(slide_index)s, %(t_ms)s, %(t_end_ms)s, %(title)s, %(text)s::text, %(ts_config)s::text,
  to_tsvector(%(ts_config)s::text::regconfig, %(text)s::text)
    || to_tsvector('simple', %(text)s::text),
  %(embedding)s::vector, %(model)s, %(hash)s, %(version)s, %(job_id)s)
ON CONFLICT (source_kind, source_id, part) DO UPDATE SET
  user_id = EXCLUDED.user_id, deck_id = EXCLUDED.deck_id, session_id = EXCLUDED.session_id,
  slide_index = EXCLUDED.slide_index, t_ms = EXCLUDED.t_ms, t_end_ms = EXCLUDED.t_end_ms,
  title = EXCLUDED.title, text = EXCLUDED.text, ts_config = EXCLUDED.ts_config,
  tsv = EXCLUDED.tsv,
  embedding = CASE WHEN %(keep)s AND search_chunk.content_hash = EXCLUDED.content_hash
      AND search_chunk.index_version = EXCLUDED.index_version
      AND search_chunk.embedding_model = %(keep_model)s
    THEN search_chunk.embedding ELSE EXCLUDED.embedding END,
  embedding_model = CASE WHEN %(keep)s AND search_chunk.content_hash = EXCLUDED.content_hash
      AND search_chunk.index_version = EXCLUDED.index_version
      AND search_chunk.embedding_model = %(keep_model)s
    THEN search_chunk.embedding_model ELSE EXCLUDED.embedding_model END,
  content_hash = EXCLUDED.content_hash, index_version = EXCLUDED.index_version,
  job_id = EXCLUDED.job_id
"""

# `slide.embedding` = Vektor des Stücks der Folie, Folien ohne Stück oder Vektor: NULL
_SLIDE_EMBEDDING = """
UPDATE slide s SET embedding = c.embedding
FROM slide s2 LEFT JOIN search_chunk c
  ON c.source_kind = 'slide' AND c.source_id = s2.id AND c.part = 0 AND c.deleted_at IS NULL
WHERE s2.id = s.id AND s.deck_id = %s AND s.embedding IS DISTINCT FROM c.embedding
"""


def _write(
    ctx: JobContext,
    scope: str,
    tid: uuid.UUID,
    target: Target,
    chunks: Sequence[Chunk],
    reuse: set[Key],
    keep_model: str,
    embedded: Embedded,
) -> int:
    """Veraltete Einträge löschen, die übrigen schreiben. Rückgabe: Anzahl gelöschter Einträge."""
    conn = ctx.conn
    # Folien: je Folie ein Stück (`part` = 0). Session: Stücke unterscheiden sich in `part`.
    keep_ids = [c.source_id for c in chunks] if scope == "deck" else [c.part for c in chunks]
    column = "source_id = ANY(%s::uuid[])" if scope == "deck" else "part = ANY(%s::int[])"
    removed = conn.execute(
        "DELETE FROM search_chunk WHERE " + _target_filter(scope) + f" AND NOT ({column}) "
        "RETURNING id",
        (tid, keep_ids),
    ).fetchall()
    job_id = uuid.UUID(ctx.job_id)
    params = []
    for c in chunks:
        vec = embedded.vectors.get(c.key)
        params.append(
            {
                "id": uuid7(),
                "user_id": target.user_id,
                "kind": c.source_kind,
                "source_id": c.source_id,
                "part": c.part,
                "deck_id": tid if scope == "deck" else None,
                "session_id": tid if scope == "session" else None,
                "slide_index": c.slide_index,
                "t_ms": c.t_ms,
                "t_end_ms": c.t_end_ms,
                "title": c.title,
                "text": c.text,
                "ts_config": c.ts_config,
                "embedding": None if vec is None else vector_literal(vec),
                "model": None if vec is None else embedded.vector_model,
                "hash": c.hash,
                "version": SEARCH_INDEX_VERSION,
                "job_id": job_id,
                "keep": c.key in reuse,
                "keep_model": keep_model,
            }
        )
    if params:
        with conn.cursor() as cur:
            cur.executemany(_UPSERT, params)
    if scope == "deck":
        conn.execute(_SLIDE_EMBEDDING, (tid,))
    return len(removed)


def _result(
    scope: str,
    tid: uuid.UUID,
    *,
    chunks: int = 0,
    embedded: int = 0,
    reused: int = 0,
    removed: int = 0,
    model: str | None = None,
    error: str | None = None,
    deleted: bool = False,
    missing: bool = False,
) -> dict[str, Any]:
    return SearchIndexResult.model_validate(
        {
            "scope": scope,
            "id": str(tid),
            "chunk_count": chunks,
            "embedded_count": embedded,
            "reused_count": reused,
            "removed_count": removed,
            "embedding_model": model,
            "embedding_error": None if error is None else error[:500],
            "index_version": SEARCH_INDEX_VERSION,
            "deleted": deleted,
            "missing": missing,
        }
    ).model_dump(mode="json")


def _finish(ctx: JobContext, result: dict[str, Any]) -> dict[str, Any]:
    """`fertig` in der laufenden Transaktion. Lock verloren: `LockLostError` (Rollback)."""
    ctx.finish(result)
    if not ctx.lock_ok:
        raise LockLostError(ctx.job_id)
    return result


def get_embedder() -> Embedder:
    """Der gemeinsame Embedder des Prozesses (in Tests ersetzbar)."""
    return embedders.shared_embedder()


# ---------- Handler ----------


@handler("search.index", payload_type=SearchIndexPayload)
def search_index(payload: SearchIndexPayload, ctx: JobContext) -> dict[str, Any]:
    scope = payload.scope.value
    tid = uuid.UUID(payload.id)
    conn = ctx.conn

    target = _read_target(conn, scope, tid)
    if target is None or target.deleted:
        with conn.transaction():
            return _finish(
                ctx, _result(scope, tid, deleted=target is not None, missing=target is None)
            )

    chunks = _build_chunks(conn, scope, tid, target)
    existing = _existing(conn, scope, tid)
    embedder = get_embedder()
    model = embedder.model
    reuse = {
        c.key
        for c in chunks
        if (old := existing.get(c.key)) is not None
        and old.content_hash == c.hash
        and old.index_version == SEARCH_INDEX_VERSION
        and old.embedding_model == model
    }
    embedded = embed_chunks(embedder, [c for c in chunks if c.key not in reuse])

    with conn.transaction():
        # Sperrreihenfolge §16.2: erst das Ziel (Session bzw. Foliensatz), dann die Job-Zeile
        current = _lock_target(conn, scope, tid)
        if current is None or current.deleted:
            return _finish(
                ctx, _result(scope, tid, deleted=current is not None, missing=current is None)
            )
        _assert_owner(ctx)
        removed = _write(ctx, scope, tid, current, chunks, reuse, model, embedded)
        new = sum(1 for v in embedded.vectors.values() if v is not None)
        result = _result(
            scope,
            tid,
            chunks=len(chunks),
            embedded=new,
            reused=len(reuse),
            removed=removed,
            model=embedded.model,
            error=embedded.error,
        )
        ctx.logger.info(
            "Suchindex geschrieben",
            extra={
                k: result[k] for k in ("scope", "chunk_count", "embedded_count", "reused_count")
            },
        )
        return _finish(ctx, result)
