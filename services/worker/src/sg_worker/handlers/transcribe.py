"""`transcribe`: Aufnahmen einer Session transkribieren (VERTRAEGE §18.2, §18.6; 05 §P4).

Ablauf:

1. Payload prüfen, Transcriber wählen (`SG_TRANSCRIBER`). Unbekannt: sofort `fehler`.
2. Ohne Sperre lesen: Session (fehlt → `fehler`, weich gelöscht → `fertig` mit
   `session_deleted`), Modul, Folientitel des Foliensatzes, Texte aller Folien des Moduls, Aufnahmen
   nach `started_ms`, `id` und je Aufnahme der neueste fertige `audio.finalize`-Job.
3. Je Aufnahme mit Audio `input_hash` bilden (mit `PIPELINE_VERSION`). Gleiches Transkript
   vorhanden und kein `force`: übersprungen (`unveraendert`). Sonst transkribieren (außerhalb einer
   Transaktion, der Heartbeat läuft weiter), nachbearbeiten und in **einer Transaktion je
   Aufnahme** ersetzen. Ein Abbruch danach verliert keine fertige Aufnahme.
4. Abschluss in einer Transaktion: `finalize_job_id` der unveränderten nachziehen, Transkripte zu
   gelöschten Aufnahmen und zu Aufnahmen ohne Audio löschen, `fertig` schreiben.

Der Audio-Pfad entsteht nur aus der `recording.id` (§4), nie aus einer Spalte.
"""

from __future__ import annotations

import hashlib
import logging
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import psycopg
from psycopg.types.json import Jsonb
from sg_schemas.models import TranscribePayload

from .. import progress
from ..ai.interfaces import Transcriber
from ..ai.postprocess import SegmentRow, postprocess, recording_language
from ..ai.prompt import build_initial_prompt, prompt_language
from ..ai.transcriber import (
    AudioDecodeError,
    TranscriberUnavailable,
    make_transcriber,
    token_counter,
)
from ..registry import JobContext, LockLostError, NonRetryableError, handler
from ..uuid7 import uuid7
from .audio_finalize import recording_dir
from .pdf_ingest import sanitize_error

log = logging.getLogger(__name__)

#: Steigt, wenn sich Nachbearbeitung, Prompt-Regeln oder Fensterung ändern (§18.2). Dann wird beim
#: nächsten Lauf neu transkribiert, weil sich `input_hash` ändert.
PIPELINE_VERSION = "p4-v1"

Conn = psycopg.Connection[Any]


@dataclass
class Rec:
    id: uuid.UUID
    started_ms: int
    duration_ms: int | None
    finalize_job_id: uuid.UUID | None
    existing: dict[str, Any] | None = None  # vorhandenes Transkript (nicht gelöscht)


@dataclass
class Inputs:
    user_id: uuid.UUID
    module_name: str | None
    module_lang: str | None
    deck_titles: list[str | None]
    module_texts: list[str | None]
    recordings: list[Rec] = field(default_factory=list)


def audio_path(data_dir: Path, recording_id: uuid.UUID) -> Path:
    return recording_dir(data_dir, recording_id) / "full.m4a"


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        while block := fh.read(1 << 20):
            digest.update(block)
    return digest.hexdigest()


def input_hash(
    *,
    audio_sha256: str,
    provider: str,
    model: str,
    language: str | None,
    initial_prompt: str | None,
    pipeline_version: str | None = None,
) -> str:
    """SHA-256 (hex) über UTF-8 von `pipeline_version \\n audio_sha256 \\n provider \\n model \\n
    sprache \\n initial_prompt`, fehlende Werte als leere Zeichenkette (§18.2)."""
    version = PIPELINE_VERSION if pipeline_version is None else pipeline_version
    text = "\n".join([version, audio_sha256, provider, model, language or "", initial_prompt or ""])
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# ---------- Lesen ----------


def _session_row(conn: Conn, sid: uuid.UUID) -> tuple[Any, ...] | None:
    return conn.execute(
        "SELECT user_id, deleted_at, module_id, slide_deck_id FROM session WHERE id = %s", (sid,)
    ).fetchone()


def _load_inputs(conn: Conn, sid: uuid.UUID, row: tuple[Any, ...]) -> Inputs:
    user_id, _deleted, module_id, deck_id = row
    mod = conn.execute("SELECT name, lang FROM module WHERE id = %s", (module_id,)).fetchone()
    titles = conn.execute(
        "SELECT s.title FROM slide s JOIN slide_deck d ON d.id = s.deck_id "
        "WHERE d.id = %s AND d.deleted_at IS NULL AND s.deleted_at IS NULL ORDER BY s.index",
        (deck_id,),
    ).fetchall()
    texts = conn.execute(
        "SELECT s.title, s.text FROM slide s JOIN slide_deck d ON d.id = s.deck_id "
        "WHERE d.module_id = %s AND d.deleted_at IS NULL AND s.deleted_at IS NULL "
        "ORDER BY d.created_at, d.id, s.index",
        (module_id,),
    ).fetchall()
    recs = conn.execute(
        """
        SELECT r.id, r.started_ms, r.duration_ms,
               (SELECT j.id FROM job j
                 WHERE j.type = 'audio.finalize' AND j.state = 'fertig' AND j.deleted_at IS NULL
                   AND j.payload->>'recording_id' = r.id::text
                 ORDER BY j.created_at DESC, j.id DESC LIMIT 1)
        FROM recording r
        WHERE r.session_id = %s AND r.deleted_at IS NULL
        ORDER BY r.started_ms, r.id
        """,
        (sid,),
    ).fetchall()
    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            "SELECT id, recording_id, job_id, input_hash, language, segment_count, word_count, "
            "audio_duration_ms FROM transcript WHERE session_id = %s AND deleted_at IS NULL",
            (sid,),
        )
        existing = {r["recording_id"]: r for r in cur.fetchall()}
    return Inputs(
        user_id=user_id,
        module_name=None if mod is None else mod[0],
        module_lang=None if mod is None else mod[1],
        deck_titles=[t[0] for t in titles],
        module_texts=[x for t in texts for x in t],
        recordings=[
            Rec(r[0], int(r[1]), None if r[2] is None else int(r[2]), r[3], existing.get(r[0]))
            for r in recs
        ],
    )


# ---------- Schreiben ----------


def _assert_owner(ctx: JobContext) -> None:
    row = ctx.conn.execute(
        "SELECT 1 FROM job WHERE id = %s AND state = 'laeuft' AND locked_by = %s FOR UPDATE",
        (ctx.job_id, ctx.worker_id),
    ).fetchone()
    if row is None:
        raise LockLostError(ctx.job_id)


def _write_transcript(
    ctx: JobContext,
    sid: uuid.UUID,
    inputs: Inputs,
    rec: Rec,
    meta: dict[str, Any],
    rows: list[SegmentRow],
) -> uuid.UUID | None:
    """Ersetzt das Transkript einer Aufnahme. None: Session inzwischen gelöscht."""
    conn = ctx.conn
    with conn.transaction():
        if not progress.lock_session(conn, sid):
            return None
        _assert_owner(ctx)
        conn.execute("DELETE FROM transcript WHERE recording_id = %s", (rec.id,))
        tid = uuid7()
        conn.execute(
            """
            INSERT INTO transcript (id, user_id, session_id, recording_id, job_id, finalize_job_id,
              provider, model, language, initial_prompt, input_hash, audio_sha256,
              audio_duration_ms, segment_count, word_count)
            VALUES (%(id)s, %(user_id)s, %(sid)s, %(rid)s, %(job)s, %(fin)s, %(provider)s,
              %(model)s, %(language)s, %(prompt)s, %(hash)s, %(sha)s, %(duration)s, %(segments)s,
              %(words)s)
            """,
            {
                "id": tid,
                "user_id": inputs.user_id,
                "sid": sid,
                "rid": rec.id,
                "job": uuid.UUID(ctx.job_id),
                "fin": rec.finalize_job_id,
                **meta,
                "segments": len(rows),
                "words": sum(r.word_count for r in rows),
            },
        )
        with conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO transcript_segment (id, user_id, transcript_id, session_id,
                  recording_id, seq, start_ms, end_ms, text, lang, speaker, avg_logprob,
                  no_speech_prob, words)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NULL, %s, %s, %s)
                """,
                [
                    (
                        uuid7(),
                        inputs.user_id,
                        tid,
                        sid,
                        rec.id,
                        seq,
                        r.start_ms,
                        r.end_ms,
                        r.text,
                        r.lang,
                        r.avg_logprob,
                        r.no_speech_prob,
                        None if r.words is None else Jsonb(r.words),
                    )
                    for seq, r in enumerate(rows)
                ],
            )
    return tid


def _result(
    sid: uuid.UUID,
    transcriber: Transcriber,
    recordings: list[dict[str, Any]],
    *,
    removed: int = 0,
    segments: int = 0,
    words: int = 0,
    deleted: bool = False,
    started: float,
) -> dict[str, Any]:
    return {
        "session_id": str(sid),
        "provider": transcriber.provider,
        "model": transcriber.model,
        "recordings": recordings,
        "removed_transcripts": removed,
        "segment_count": segments,
        "word_count": words,
        "session_deleted": deleted,
        "job_duration_ms": int((time.monotonic() - started) * 1000),
    }


def _finish_deleted(
    ctx: JobContext, sid: uuid.UUID, transcriber: Transcriber, started: float
) -> dict[str, Any]:
    result = _result(sid, transcriber, [], deleted=True, started=started)
    ctx.finish(result)
    if not ctx.lock_ok:
        raise LockLostError(ctx.job_id)
    return result


def _rec_result(
    rec: Rec,
    outcome: str,
    *,
    transcript_id: Any = None,
    segments: int = 0,
    words: int = 0,
    duration: int | None = None,
    language: str | None = None,
    transcribe_ms: int = 0,
) -> dict[str, Any]:
    return {
        "recording_id": str(rec.id),
        "transcript_id": None if transcript_id is None else str(transcript_id),
        "outcome": outcome,
        "segment_count": segments,
        "word_count": words,
        "audio_duration_ms": max(0, duration if duration is not None else rec.duration_ms or 0),
        "language": language,
        "transcribe_ms": transcribe_ms,
    }


# ---------- Handler ----------


@handler("transcribe", payload_type=TranscribePayload)
def transcribe(payload: TranscribePayload, ctx: JobContext) -> dict[str, Any]:
    started = time.monotonic()
    sid = uuid.UUID(payload.session_id)
    force = bool(payload.force)
    try:
        transcriber = make_transcriber()
    except TranscriberUnavailable as exc:
        raise NonRetryableError(f"Transkription nicht verfügbar: {exc}") from exc

    row = _session_row(ctx.conn, sid)
    if row is None:
        raise NonRetryableError("Session unbekannt")
    if row[1] is not None:
        with ctx.conn.transaction():
            return _finish_deleted(ctx, sid, transcriber, started)
    inputs = _load_inputs(ctx.conn, sid, row)

    language = prompt_language(inputs.module_lang)
    prompt: str | None = None
    prompt_ready = False
    results: list[dict[str, Any]] = []
    unchanged: list[Rec] = []
    no_audio: list[uuid.UUID] = []
    try:
        for rec in inputs.recordings:
            path = audio_path(ctx.data_dir, rec.id)
            if rec.finalize_job_id is None or not rec.duration_ms or not path.is_file():
                no_audio.append(rec.id)
                results.append(_rec_result(rec, "ohne_audio"))
                continue
            if not prompt_ready:  # erst hier: braucht ggf. den Tokenizer des Transcribers
                prompt = build_initial_prompt(
                    module_name=inputs.module_name,
                    module_lang=inputs.module_lang,
                    deck_titles=inputs.deck_titles,
                    module_texts=inputs.module_texts,
                    count_tokens=token_counter(transcriber),
                )
                prompt_ready = True
            sha = file_sha256(path)
            meta = {
                "provider": transcriber.provider,
                "model": transcriber.model,
                "prompt": prompt,
                "hash": input_hash(
                    audio_sha256=sha,
                    provider=transcriber.provider,
                    model=transcriber.model,
                    language=language,
                    initial_prompt=prompt,
                ),
                "sha": sha,
                "duration": rec.duration_ms,
            }
            old = rec.existing
            # Mit `force` überspringt ein neuer Versuch desselben Jobs, was er schon geschrieben hat
            redo = force and (old is None or str(old["job_id"]) != ctx.job_id)
            if old is not None and old["input_hash"] == meta["hash"] and not redo:
                unchanged.append(rec)
                results.append(
                    _rec_result(
                        rec,
                        "unveraendert",
                        transcript_id=old["id"],
                        segments=old["segment_count"],
                        words=old["word_count"],
                        duration=old["audio_duration_ms"],
                        language=old["language"],
                    )
                )
                continue
            t0 = time.monotonic()
            try:
                segments = transcriber.transcribe(
                    path, language=language, initial_prompt=prompt, duration_ms=rec.duration_ms
                )
            except AudioDecodeError as exc:
                raise NonRetryableError(
                    f"Audio der Aufnahme {rec.id} lässt sich nicht dekodieren"
                ) from exc
            took = int((time.monotonic() - t0) * 1000)
            lang = recording_language(segments, language)
            rows = postprocess(segments, started_ms=rec.started_ms, language=lang)
            tid = _write_transcript(ctx, sid, inputs, rec, {**meta, "language": lang}, rows)
            if tid is None:
                with ctx.conn.transaction():
                    return _finish_deleted(ctx, sid, transcriber, started)
            results.append(
                _rec_result(
                    rec,
                    "transkribiert",
                    transcript_id=tid,
                    segments=len(rows),
                    words=sum(r.word_count for r in rows),
                    language=lang,
                    transcribe_ms=took,
                )
            )
            log.info(
                "Aufnahme transkribiert",
                extra={
                    "recording_id": str(rec.id),
                    "audio_ms": rec.duration_ms,
                    "transcribe_ms": took,
                    "segments": len(rows),
                },
            )
    except TranscriberUnavailable as exc:
        raise NonRetryableError(f"Transkription nicht verfügbar: {exc}") from exc
    except OSError as exc:
        raise RuntimeError(sanitize_error(f"{type(exc).__name__}: {exc}", ctx.data_dir)) from exc

    with ctx.conn.transaction():
        if not progress.lock_session(ctx.conn, sid):
            return _finish_deleted(ctx, sid, transcriber, started)
        for rec in unchanged:
            ctx.conn.execute(
                "UPDATE transcript SET finalize_job_id = %s WHERE recording_id = %s",
                (rec.finalize_job_id, rec.id),
            )
        removed = ctx.conn.execute(
            """
            DELETE FROM transcript t WHERE t.session_id = %s
              AND (t.recording_id = ANY(%s) OR NOT EXISTS (
                SELECT 1 FROM recording r WHERE r.id = t.recording_id AND r.deleted_at IS NULL))
            RETURNING t.id
            """,
            (sid, no_audio),
        ).fetchall()
        totals = ctx.conn.execute(
            "SELECT coalesce(sum(segment_count), 0), coalesce(sum(word_count), 0) "
            "FROM transcript WHERE session_id = %s AND deleted_at IS NULL",
            (sid,),
        ).fetchone()
        assert totals is not None
        result = _result(
            sid,
            transcriber,
            results,
            removed=len(removed),
            segments=int(totals[0]),
            words=int(totals[1]),
            started=started,
        )
        ctx.finish(result)
        if not ctx.lock_ok:
            raise LockLostError(ctx.job_id)
    return result
