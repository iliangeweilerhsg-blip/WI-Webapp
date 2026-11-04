"""`audio.finalize`: Chunks einer Aufnahme prüfen und zu `full.m4a` zusammenfügen
(docs/VERTRAEGE.md §3, §10; Spike S4).

Ablauf:

1. Chunks der Aufnahme nach `seq` lesen. Der Dateipfad entsteht nur aus IDs und `seq`
   (`media/recordings/<id>/chunks/<seq>.<ext>`, §4), nie aus der Spalte `file_path`.
   Jeder Chunk wird gegen sha256 und Größe aus `audio_chunk` geprüft. Fehlende oder beschädigte
   Chunks zählen als fehlend (`mit_luecken`), der Job scheitert deshalb nicht.
2. Lücken bestimmen: fehlende `seq` (`fehlender_chunk`) und Sprünge in `start_ms`
   (`zeitluecke`, Toleranz `GAP_TOLERANCE_MS`). Chunks am Ende, die der Client mit `last_seq`
   angekündigt hat, aber nie geliefert hat, zählen auch.
3. Dekodieren nach rohem PCM (s16le, 48 kHz, mono):
   - `chunks_independent = false`: Die Chunks sind ein Bytestrom (Init-Chunk plus Fortsetzungen).
     Sie werden binär aneinandergehängt und als Ganzes dekodiert.
   - `chunks_independent = true`: Jeder Chunk ist eine eigene Datei und wird einzeln dekodiert.
   Lücken füllt der Handler mit Nullbytes (Stille) in der Länge der Lücke.
4. Das PCM wird nach `full.m4a` kodiert (AAC, 48 kHz, mono, 64 kbit/s), zuerst nach
   `full.m4a.part`, dann atomar umbenannt.

`ffmpeg` läuft per `subprocess` mit Argumentliste (ohne Shell) und Zeitlimit.

Idempotent: Der Handler liest nur die Chunks und überschreibt `full.m4a` atomar. Ein erneuter Lauf
liefert dieselbe Datei und dasselbe Ergebnis (bis auf `job_duration_ms`); Arbeitsdateien liegen in
einem eigenen Ordner, der immer wieder entfernt wird.

Ist die Aufnahme beim Start nicht abgeschlossen (`completed_at` leer, etwa weil der Browser nie
`complete` gesendet hat), arbeitet der Handler mit den vorhandenen Chunks: Der Core plant den Job
erst 10 min nach dem Stopp ein (§3). Ohne `last_seq` lässt sich ein fehlendes Ende nicht erkennen.
"""

from __future__ import annotations

import hashlib
import logging
import os
import shutil
import subprocess
import tempfile
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import psycopg
from sg_schemas.models import AudioFinalizePayload

from ..registry import JobContext, LockLostError, NonRetryableError, PayloadError, handler
from .pdf_ingest import sanitize_error

log = logging.getLogger(__name__)

SAMPLE_RATE = 48_000
BYTES_PER_MS = SAMPLE_RATE * 2 // 1000  # s16le, mono: 96 Bytes je ms
AAC_BITRATE = "64k"

#: Sprünge in `start_ms` bis zu dieser Größe sind Jitter der Browseruhr und keine Lücke
GAP_TOLERANCE_MS = 50
#: Obergrenzen gegen unsinnige Angaben (kaputte Uhr, riesiges `last_seq`): sonst wüchse die
#: Stille ins Unermessliche
MAX_GAP_MS = 6 * 3_600_000
MAX_TOTAL_SILENCE_MS = 12 * 3_600_000
MAX_MISSING_SEQS = 10_000

#: Zeitlimits in Sekunden
DECODE_CHUNK_TIMEOUT_S = 120
DECODE_STREAM_TIMEOUT_S = 900
ENCODE_TIMEOUT_S = 1800
PROBE_TIMEOUT_S = 60

FFMPEG = "ffmpeg"
FFPROBE = "ffprobe"

_EXT_BY_MIME = {"audio/webm": "webm", "audio/mp4": "mp4"}

GAP_MISSING = "fehlender_chunk"
GAP_JUMP = "zeitluecke"


class FfmpegError(Exception):
    """ffmpeg/ffprobe scheitert. Meldung ohne absolute Pfade."""


class ChunkDecodeError(FfmpegError):
    """Ein einzelner (unabhängiger) Chunk lässt sich nicht dekodieren."""


@dataclass(frozen=True)
class ChunkRow:
    seq: int
    start_ms: int
    duration_ms: int
    sha256: str
    size_bytes: int


@dataclass(frozen=True)
class Gap:
    start_ms: int  # Sitzungszeit
    duration_ms: int
    reason: str
    before_index: int  # Anzahl der verwendbaren Chunks vor der Lücke (0 = vor dem ersten)


@dataclass(frozen=True)
class Analysis:
    missing_seqs: list[int]
    gaps: list[Gap]


# ---------- reine Logik (ohne ffmpeg, ohne DB) ----------


def chunk_ext(mime: str) -> str:
    base = mime.split(";", 1)[0].strip().lower()
    ext = _EXT_BY_MIME.get(base)
    if ext is None:
        raise NonRetryableError(f"nicht unterstützter Aufnahme-Typ: {base[:40]}")
    return ext


def recording_dir(data_dir: Path, recording_id: uuid.UUID) -> Path:
    return data_dir / "media" / "recordings" / str(recording_id)


def chunk_path(data_dir: Path, recording_id: uuid.UUID, seq: int, ext: str) -> Path:
    return recording_dir(data_dir, recording_id) / "chunks" / f"{seq}.{ext}"


def analyze(
    usable: list[ChunkRow],
    bad_seqs: set[int],
    *,
    started_ms: int,
    last_seq: int | None,
    completed_duration_ms: int | None,
) -> Analysis:
    """Fehlende `seq` und Lücken bestimmen. `usable` ist nach `seq` sortiert."""
    present = {c.seq for c in usable}
    upper = max([*present, *bad_seqs, last_seq if last_seq is not None else -1])
    if upper + 1 - len(present) > MAX_MISSING_SEQS:
        raise NonRetryableError("unplausibel viele fehlende Chunks")
    missing = [s for s in range(upper + 1) if s not in present]

    gaps: list[Gap] = []
    if not usable:
        if last_seq is not None and (completed_duration_ms or 0) >= 1:
            gaps.append(Gap(started_ms, completed_duration_ms or 0, GAP_MISSING, 0))
        return Analysis(missing, gaps)

    first = usable[0]
    lead = first.start_ms - started_ms
    if first.seq > 0 and lead >= 1:
        gaps.append(Gap(started_ms, lead, GAP_MISSING, 0))
    elif first.seq == 0 and lead > GAP_TOLERANCE_MS:
        gaps.append(Gap(started_ms, lead, GAP_JUMP, 0))

    for i in range(1, len(usable)):
        prev, cur = usable[i - 1], usable[i]
        prev_end = prev.start_ms + prev.duration_ms
        gap = cur.start_ms - prev_end
        if cur.seq != prev.seq + 1:
            if gap >= 1:
                gaps.append(Gap(prev_end, gap, GAP_MISSING, i))
        elif gap > GAP_TOLERANCE_MS:
            gaps.append(Gap(prev_end, gap, GAP_JUMP, i))

    last = usable[-1]
    if last_seq is not None and last_seq > last.seq and completed_duration_ms is not None:
        last_end = last.start_ms + last.duration_ms
        tail = started_ms + completed_duration_ms - last_end
        if tail >= 1:
            gaps.append(Gap(last_end, tail, GAP_MISSING, len(usable)))
    total = 0
    for g in gaps:
        if g.duration_ms > MAX_GAP_MS:
            raise NonRetryableError("unplausibel lange Lücke in der Aufnahme")
        total += g.duration_ms
    if total > MAX_TOTAL_SILENCE_MS:
        raise NonRetryableError("unplausibel viel Stille in der Aufnahme")
    return Analysis(missing, gaps)


def _silence_bytes(duration_ms: int) -> int:
    return duration_ms * BYTES_PER_MS


# ---------- ffmpeg ----------


def _run(args: list[str], timeout: float) -> subprocess.CompletedProcess[bytes]:
    """Ohne Shell, mit Zeitlimit. Meldungen ohne absolute Pfade."""
    try:
        proc = subprocess.run(
            args,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise FfmpegError(f"{args[0]}: Zeitlimit von {int(timeout)} s überschritten") from exc
    except FileNotFoundError as exc:
        raise FfmpegError(f"{args[0]} nicht gefunden") from exc
    return proc


def _fail_message(name: str, proc: subprocess.CompletedProcess[bytes], data_dir: Path) -> str:
    tail = proc.stderr.decode("utf-8", "replace").strip()[-300:]
    return sanitize_error(f"{name} endete mit Code {proc.returncode}: {tail}", data_dir)


def _decode(src: Path, dst: Path, timeout: float, data_dir: Path) -> None:
    """Dekodiert nach s16le/48 kHz/mono. `asetpts=N/SR/TB` macht die Zeitstempel lückenlos:
    Lücken füllt der Handler selbst, ffmpeg soll nichts dazuerfinden."""
    args = [
        FFMPEG, "-nostdin", "-v", "error", "-y",
        "-i", str(src),
        "-vn", "-af", "asetpts=N/SR/TB",
        "-ar", str(SAMPLE_RATE), "-ac", "1", "-f", "s16le", str(dst),
    ]  # fmt: skip
    proc = _run(args, timeout)
    if proc.returncode != 0:
        raise FfmpegError(_fail_message("ffmpeg (Dekodieren)", proc, data_dir))


def decode_chunk_to_pcm(src: Path, dst: Path, data_dir: Path) -> None:
    try:
        _decode(src, dst, DECODE_CHUNK_TIMEOUT_S, data_dir)
    except FfmpegError as exc:
        dst.unlink(missing_ok=True)
        raise ChunkDecodeError(str(exc)) from exc


def decode_stream_to_pcm(src: Path, dst: Path, data_dir: Path) -> None:
    _decode(src, dst, DECODE_STREAM_TIMEOUT_S, data_dir)


def encode_m4a(pcm: Path, dst: Path, data_dir: Path) -> None:
    """AAC, 48 kHz, mono. `bitexact` und ohne Metadaten: gleiche Eingabe, gleiche Datei."""
    args = [
        FFMPEG, "-nostdin", "-v", "error", "-y",
        "-f", "s16le", "-ar", str(SAMPLE_RATE), "-ac", "1", "-i", str(pcm),
        "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact",
        "-c:a", "aac", "-b:a", AAC_BITRATE, "-ar", str(SAMPLE_RATE), "-ac", "1",
        "-movflags", "+faststart", "-f", "mp4", str(dst),
    ]  # fmt: skip
    proc = _run(args, ENCODE_TIMEOUT_S)
    if proc.returncode != 0:
        raise FfmpegError(_fail_message("ffmpeg (Kodieren)", proc, data_dir))


def probe_duration_ms(path: Path, data_dir: Path) -> int:
    args = [
        FFPROBE, "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(path),
    ]  # fmt: skip
    try:
        proc = subprocess.run(
            args,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            timeout=PROBE_TIMEOUT_S,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise FfmpegError("ffprobe: Zeitlimit überschritten") from exc
    except FileNotFoundError as exc:
        raise FfmpegError("ffprobe nicht gefunden") from exc
    if proc.returncode != 0:
        raise FfmpegError(_fail_message("ffprobe", proc, data_dir))
    try:
        return max(0, round(float(proc.stdout.decode().strip()) * 1000))
    except ValueError as exc:
        raise FfmpegError("ffprobe: Dauer nicht lesbar") from exc


# ---------- Zusammenbau ----------


def _write_zeros(dst: Any, count: int) -> None:
    block = bytes(min(count, 1 << 20))
    while count > 0:
        n = min(count, len(block))
        dst.write(block[:n])
        count -= n


def _copy_range(src: Any, dst: Any, count: int | None = None) -> int:
    done = 0
    while count is None or done < count:
        want = 1 << 20 if count is None else min(1 << 20, count - done)
        buf = src.read(want)
        if not buf:
            break
        dst.write(buf)
        done += len(buf)
    return done


def assemble_independent(pcm_files: list[Path], gaps: list[Gap], out: Path) -> None:
    """Pro Chunk ein fertiges PCM; Stille vor dem Chunk `before_index`."""
    by_index: dict[int, list[Gap]] = {}
    for g in gaps:
        by_index.setdefault(g.before_index, []).append(g)
    with out.open("wb") as dst:
        for i, pcm in enumerate(pcm_files):
            for g in by_index.get(i, []):
                _write_zeros(dst, _silence_bytes(g.duration_ms))
            with pcm.open("rb") as src:
                _copy_range(src, dst)
            pcm.unlink(missing_ok=True)
        for g in by_index.get(len(pcm_files), []):
            _write_zeros(dst, _silence_bytes(g.duration_ms))


def assemble_stream(pcm: Path, usable: list[ChunkRow], gaps: list[Gap], out: Path) -> None:
    """Ein dekodierter Strom; die Stille kommt an die Stelle, die die angegebenen Längen der
    davor liegenden Chunks bestimmen (die dekodierte Länge weicht höchstens um Millisekunden ab)."""
    offsets = [0]
    for c in usable:
        offsets.append(offsets[-1] + c.duration_ms)
    inserts = sorted(((offsets[g.before_index] * BYTES_PER_MS) & ~1, g.duration_ms) for g in gaps)
    with pcm.open("rb") as src, out.open("wb") as dst:
        pos = 0
        for offset, duration in inserts:
            if offset > pos:
                pos += _copy_range(src, dst, offset - pos)
            _write_zeros(dst, _silence_bytes(duration))
        _copy_range(src, dst)


# ---------- Handler ----------


def _load_chunks(conn: psycopg.Connection[Any], recording_id: uuid.UUID) -> list[ChunkRow]:
    rows = conn.execute(
        "SELECT seq, start_ms, duration_ms, sha256, size_bytes FROM audio_chunk "
        "WHERE recording_id = %s AND deleted_at IS NULL ORDER BY seq",
        (recording_id,),
    ).fetchall()
    return [ChunkRow(int(r[0]), int(r[1]), int(r[2]), str(r[3]), int(r[4])) for r in rows]


def _read_verified(path: Path, chunk: ChunkRow) -> bytes | None:
    """Dateiinhalt, wenn Größe und sha256 zur DB passen; sonst None."""
    try:
        data = path.read_bytes()
    except OSError:
        log.warning("Chunk %d fehlt auf der Platte", chunk.seq)
        return None
    if len(data) != chunk.size_bytes or hashlib.sha256(data).hexdigest() != chunk.sha256:
        log.warning("Chunk %d: Größe oder sha256 stimmt nicht", chunk.seq)
        return None
    return data


def _update_session(conn: psycopg.Connection[Any], session_id: str) -> None:
    """Session-Fortschritt (§3): `processing['audio.finalize'] = 'fertig'`. Ist die Session
    `beendet` und läuft kein weiterer Job mehr, wird sie `verarbeitet`. Danach `sg_session`."""
    try:
        sid = uuid.UUID(session_id)
    except ValueError:
        return
    row = conn.execute(
        "UPDATE session SET processing = COALESCE(processing, '{}'::jsonb) "
        "|| jsonb_build_object('audio.finalize', 'fertig'), updated_at = now() "
        "WHERE id = %s AND deleted_at IS NULL RETURNING state",
        (sid,),
    ).fetchone()
    if row is None:
        return
    if row[0] == "beendet":
        conn.execute(
            "UPDATE session SET state = 'verarbeitet', updated_at = now() "
            "WHERE id = %s AND state = 'beendet' AND NOT EXISTS ("
            "  SELECT 1 FROM job WHERE session_id = %s AND deleted_at IS NULL "
            "  AND state IN ('wartet', 'laeuft'))",
            (sid, sid),
        )
    conn.execute("SELECT pg_notify('sg_session', %s)", (str(sid),))


@handler("audio.finalize", payload_type=AudioFinalizePayload)
def audio_finalize(payload: AudioFinalizePayload, ctx: JobContext) -> dict[str, Any]:
    started = time.monotonic()
    recording_id = uuid.UUID(payload.recording_id)
    rec = ctx.conn.execute(
        "SELECT mime, started_ms, chunks_independent, completed_last_seq, completed_duration_ms "
        "FROM recording WHERE id = %s AND deleted_at IS NULL",
        (recording_id,),
    ).fetchone()
    if rec is None:
        raise PayloadError(f"recording {recording_id} nicht gefunden")
    mime, started_ms, independent, last_seq, completed_ms = rec
    ext = chunk_ext(str(mime))

    rec_dir = recording_dir(ctx.data_dir, recording_id)
    final = rec_dir / "full.m4a"
    chunks = _load_chunks(ctx.conn, recording_id)

    # 1. Chunks prüfen
    usable: list[ChunkRow] = []
    bad: set[int] = set()
    payloads: dict[int, bytes] = {}
    for c in chunks:
        data = _read_verified(chunk_path(ctx.data_dir, recording_id, c.seq, ext), c)
        if data is None:
            bad.add(c.seq)
        else:
            usable.append(c)
            if not independent:
                payloads[c.seq] = data
    if not independent and usable and usable[0].seq != 0:
        raise NonRetryableError("Init-Chunk (seq 0) fehlt oder ist beschädigt")

    work: Path | None = None
    audio_ms = 0
    size = 0
    try:
        if usable:
            rec_dir.mkdir(parents=True, exist_ok=True)
            work = Path(tempfile.mkdtemp(prefix=".work-", dir=rec_dir))
            pcm_in = work / "in.pcm"
            if independent:
                pcm_files: list[Path] = []
                kept: list[ChunkRow] = []
                for c in usable:
                    src = chunk_path(ctx.data_dir, recording_id, c.seq, ext)
                    dst = work / f"{c.seq}.pcm"
                    try:
                        decode_chunk_to_pcm(src, dst, ctx.data_dir)
                    except ChunkDecodeError:
                        log.warning("Chunk %d nicht dekodierbar", c.seq)
                        bad.add(c.seq)
                        continue
                    kept.append(c)
                    pcm_files.append(dst)
                usable = kept
            analysis = analyze(
                usable,
                bad,
                started_ms=int(started_ms),
                last_seq=None if last_seq is None else int(last_seq),
                completed_duration_ms=None if completed_ms is None else int(completed_ms),
            )
            pcm_out = work / "out.pcm"
            if not usable:
                pcm_out.write_bytes(b"")
            elif independent:
                assemble_independent(pcm_files, analysis.gaps, pcm_out)
            else:
                stream = work / f"stream.{ext}"
                with stream.open("wb") as fh:
                    for c in usable:
                        fh.write(payloads[c.seq])
                payloads.clear()
                decode_stream_to_pcm(stream, pcm_in, ctx.data_dir)
                stream.unlink(missing_ok=True)
                assemble_stream(pcm_in, usable, analysis.gaps, pcm_out)
            if usable:
                part = rec_dir / "full.m4a.part"
                try:
                    encode_m4a(pcm_out, part, ctx.data_dir)
                    try:
                        audio_ms = probe_duration_ms(part, ctx.data_dir)
                    except FfmpegError:
                        audio_ms = pcm_out.stat().st_size // BYTES_PER_MS
                    os.replace(part, final)
                finally:
                    part.unlink(missing_ok=True)
                size = final.stat().st_size
        else:
            analysis = analyze(
                [],
                bad,
                started_ms=int(started_ms),
                last_seq=None if last_seq is None else int(last_seq),
                completed_duration_ms=None if completed_ms is None else int(completed_ms),
            )
    except (NonRetryableError, LockLostError, psycopg.OperationalError, psycopg.InterfaceError):
        raise
    except FfmpegError as exc:
        raise RuntimeError(str(exc)) from exc
    except OSError as exc:
        raise RuntimeError(sanitize_error(f"{type(exc).__name__}: {exc}", ctx.data_dir)) from exc
    finally:
        if work is not None:
            shutil.rmtree(work, ignore_errors=True)

    complete = bool(usable) and not analysis.missing_seqs and not analysis.gaps
    state = "vollstaendig" if complete else "mit_luecken"
    if not usable:
        final.unlink(missing_ok=True)  # kein verwertbares Audio: keine alte Datei stehen lassen
    result: dict[str, Any] = {
        "recording_id": str(recording_id),
        "state": state,
        "audio_duration_ms": audio_ms,
        "chunk_count": len(usable),
        "missing_seqs": analysis.missing_seqs,
        "gaps": [
            {"start_ms": g.start_ms, "duration_ms": g.duration_ms, "reason": g.reason}
            for g in analysis.gaps
        ],
        "file_size_bytes": size,
        "job_duration_ms": int((time.monotonic() - started) * 1000),
    }
    with ctx.conn.transaction():
        ctx.conn.execute(
            "UPDATE recording SET duration_ms = %s, state = %s, updated_at = now() WHERE id = %s",
            (audio_ms, state, recording_id),
        )
        ctx.finish(result)
        if not ctx.lock_ok:
            raise LockLostError(ctx.job_id)
        if ctx.session_id:
            _update_session(ctx.conn, ctx.session_id)
    return result
