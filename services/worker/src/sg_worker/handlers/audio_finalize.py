"""`audio.finalize`: Chunks einer Aufnahme prüfen und zu `full.m4a` zusammenfügen
(docs/VERTRAEGE.md §3, §10; Spike S4).

Ablauf:

1. Chunks nach `seq` lesen. Der Dateipfad entsteht nur aus IDs und `seq`
   (`media/recordings/<id>/chunks/<seq>.<ext>`, §4), nie aus der Spalte `file_path`.
   Jeder Chunk wird gegen sha256 und Größe aus `audio_chunk` geprüft und als geprüfte Kopie in
   den Arbeitsordner geschrieben (ffmpeg liest nur diese Kopien). Fehlende oder beschädigte
   Chunks zählen als fehlend (`mit_luecken`), der Job scheitert deshalb nicht.
2. Dekodieren nach rohem PCM (s16le, 48 kHz, mono) in "Stücke" mit Beginn und Soll-Länge:
   - `chunks_independent = true`: ein Stück je Chunk.
   - `chunks_independent = false`: Die Chunks sind ein Bytestrom. Zusammenhängende Läufe (lückenlose
     `seq`, kein Sprung in `start_ms`) werden einzeln dekodiert, jeweils mit dem Init-Segment aus
     Chunk 0 davor (EBML bis zum ersten Cluster bzw. `ftyp`+`moov`). Ohne Chunk 0 ist nichts
     dekodierbar (`mit_luecken`, keine Datei). Chunks, die nicht an Cluster- oder Fragmentgrenzen
     beginnen, kosten nur den angeschnittenen Anfang eines Laufs; seine Länge bleibt richtig.
3. Platzieren: Jedes Stück liegt bei seinem `start_ms` (relativ zu `recording.started_ms`) und ist
   auf seine Soll-Länge (Summe `duration_ms`) gebracht: zu kurz -> Stille, zu lang -> gekürzt,
   Überlappung mit dem Vorgänger -> der Anfang entfällt. So summieren sich Encoder-Priming und
   Rotationslücken nicht auf. Die Toleranz `GAP_TOLERANCE_MS` gilt nur für die Meldung in `gaps`.
4. Das PCM wird nach `full.m4a` kodiert (AAC, 48 kHz, mono, 64 kbit/s), nach `.part` im
   Arbeitsordner geschrieben, mit fsync gesichert und atomar nach `full.m4a` verschoben.

`ffmpeg` läuft per `subprocess` mit Argumentliste (ohne Shell), mit Zeitlimit, `-threads 1`,
erzwungenem Eingabeformat und `-protocol_whitelist file`.

Idempotent: Ein erneuter Lauf liefert dieselbe Datei und dasselbe Ergebnis (bis auf
`job_duration_ms`). Alte Arbeitsordner (`.work-*`) werden beim Start entfernt.

Ist die Aufnahme beim Start nicht abgeschlossen (`completed_at` leer), arbeitet der Handler mit den
vorhandenen Chunks; ohne `last_seq` lässt sich ein fehlendes Ende nicht erkennen.
"""

from __future__ import annotations

import hashlib
import logging
import os
import shutil
import struct
import subprocess
import tempfile
import time
import uuid
from dataclasses import dataclass, replace
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

#: Sprünge in `start_ms` bis zu dieser Größe sind Jitter der Browseruhr und keine gemeldete Lücke
GAP_TOLERANCE_MS = 50
#: Obergrenzen gegen unsinnige Angaben (kaputte Uhr, riesiges `last_seq`). Ist die Länge laut
#: Client bekannt, gilt sie plus Puffer, sonst der feste Wert.
SILENCE_LIMIT_FALLBACK_MS = 12 * 3_600_000
SILENCE_LIMIT_BUFFER_MS = 3_600_000
MAX_MISSING_SEQS = 10_000
#: Fehlt einem Lauf mehr als das an Dekodiertem, wird der Verlust als Lücke gemeldet
LOSS_REPORT_MS = 1000

#: Zeitlimits in Sekunden
DECODE_TIMEOUT_S = 900
ENCODE_TIMEOUT_S = 1800
PROBE_TIMEOUT_S = 60
STDERR_TAIL_BYTES = 2000

FFMPEG = "ffmpeg"
FFPROBE = "ffprobe"

_EXT_BY_MIME = {"audio/webm": "webm", "audio/mp4": "mp4"}
_DEMUXER_BY_EXT = {"webm": "matroska", "mp4": "mov"}

GAP_MISSING = "fehlender_chunk"
GAP_JUMP = "zeitluecke"


class FfmpegError(Exception):
    """ffmpeg/ffprobe scheitert (Zeitlimit, nicht installiert, ...). Wiederholbar."""


class DecodeError(Exception):
    """ffmpeg kann die Daten nicht dekodieren (deterministisch). Meldung ohne absolute Pfade."""


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
    tail_end_ms: int | None  # Sitzungszeit, bis zu der am Ende Stille aufzufüllen ist


@dataclass(frozen=True)
class Piece:
    """Dekodiertes Stück: liegt ab `start_ms` (Sitzungszeit) und ist `length_ms` lang."""

    start_ms: int
    length_ms: int
    pcm: Path
    #: Läufe ab `seq > 0` verlieren ihren Anfang (bis zur nächsten Grenze): Das Defizit kommt als
    #: Stille nach vorn. Läufe ab `seq 0` verlieren höchstens ihr Ende: Defizit hinten.
    align_right: bool = False


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


def silence_limit_ms(completed_duration_ms: int | None) -> int:
    if completed_duration_ms is None:
        return SILENCE_LIMIT_FALLBACK_MS
    return completed_duration_ms + SILENCE_LIMIT_BUFFER_MS


def _boundary_gap(prev: ChunkRow, cur: ChunkRow) -> tuple[int, str] | None:
    """Lücke zwischen zwei aufeinanderfolgenden verwendbaren Chunks (Dauer, Grund) oder None."""
    gap = cur.start_ms - (prev.start_ms + prev.duration_ms)
    if cur.seq != prev.seq + 1:
        return (gap, GAP_MISSING) if gap >= 1 else None
    return (gap, GAP_JUMP) if gap > GAP_TOLERANCE_MS else None


def analyze(
    usable: list[ChunkRow],
    bad: list[ChunkRow],
    *,
    started_ms: int,
    last_seq: int | None,
    completed_duration_ms: int | None,
) -> Analysis:
    """Fehlende `seq` und Lücken bestimmen. `usable` ist nach `seq` sortiert; `bad` sind Chunks
    mit Zeile, aber ohne verwendbare Daten (ihre Zeiten dienen nur für das Ende)."""
    present = {c.seq for c in usable}
    upper = max([*present, *(c.seq for c in bad), last_seq if last_seq is not None else -1])
    if upper + 1 - len(present) > MAX_MISSING_SEQS:
        raise NonRetryableError("unplausibel viele fehlende Chunks")
    missing = [s for s in range(upper + 1) if s not in present]
    limit = silence_limit_ms(completed_duration_ms)

    gaps: list[Gap] = []
    tail_end: int | None = None
    announced_end = (
        started_ms + completed_duration_ms
        if last_seq is not None and completed_duration_ms is not None
        else None
    )
    if not usable:
        ends = [e for e in (announced_end, *(c.start_ms + c.duration_ms for c in bad)) if e]
        if ends and max(ends) - started_ms >= 1:
            gaps.append(Gap(started_ms, max(ends) - started_ms, GAP_MISSING, 0))
            tail_end = max(ends)
    else:
        first = usable[0]
        lead = first.start_ms - started_ms
        if first.seq > 0 and lead >= 1:
            gaps.append(Gap(started_ms, lead, GAP_MISSING, 0))
        elif first.seq == 0 and lead > GAP_TOLERANCE_MS:
            gaps.append(Gap(started_ms, lead, GAP_JUMP, 0))
        for i in range(1, len(usable)):
            found = _boundary_gap(usable[i - 1], usable[i])
            if found is not None:
                prev_end = usable[i - 1].start_ms + usable[i - 1].duration_ms
                gaps.append(Gap(prev_end, found[0], found[1], i))
        last = usable[-1]
        last_end = last.start_ms + last.duration_ms
        candidates = [c.start_ms + c.duration_ms for c in bad if c.seq > last.seq]
        if announced_end is not None and last_seq is not None and last_seq > last.seq:
            candidates.append(announced_end)
        if candidates and max(candidates) - last_end >= 1:
            tail_end = max(candidates)
            gaps.append(Gap(last_end, tail_end - last_end, GAP_MISSING, len(usable)))
    total = 0
    for g in gaps:
        if g.duration_ms > limit:
            raise NonRetryableError("unplausibel lange Lücke in der Aufnahme")
        total += g.duration_ms
    if total > limit:
        raise NonRetryableError("unplausibel viel Stille in der Aufnahme")
    return Analysis(missing, gaps, tail_end)


def split_runs(usable: list[ChunkRow]) -> list[list[ChunkRow]]:
    """Zusammenhängende Läufe: lückenlose `seq` und kein gemeldeter Sprung in `start_ms`."""
    runs: list[list[ChunkRow]] = []
    for c in usable:
        if runs and _boundary_gap(runs[-1][-1], c) is None and c.seq == runs[-1][-1].seq + 1:
            runs[-1].append(c)
        else:
            runs.append([c])
    return runs


def init_segment(data: bytes, ext: str) -> bytes | None:
    """Init-Segment aus dem ersten Chunk: WebM bis zum ersten Cluster, MP4 bis zum ersten `moof`."""
    if ext == "webm":
        i = data.find(b"\x1f\x43\xb6\x75")
        return data[:i] if i > 0 else None
    pos = 0
    while pos + 8 <= len(data):
        (size,) = struct.unpack(">I", data[pos : pos + 4])
        if data[pos + 4 : pos + 8] in (b"moof", b"mdat"):
            return data[:pos] if pos > 0 else None
        if size < 8:
            return None
        pos += size
    return None


def first_boundary(data: bytes, ext: str) -> int | None:
    """Erste Cluster- bzw. Fragmentgrenze in `data` (Byte-Index) oder None.
    WebM: Cluster-ID `1F 43 B6 75`. MP4: `moof`-Box, auf die direkt `mfhd` folgt."""
    if ext == "webm":
        i = data.find(b"\x1f\x43\xb6\x75")
        return i if i >= 0 else None
    i = data.find(b"moof")
    while i >= 0:
        if i >= 4 and data[i + 8 : i + 12] == b"mfhd":
            return i - 4
        i = data.find(b"moof", i + 1)
    return None


# ---------- ffmpeg ----------


@dataclass(frozen=True)
class Proc:
    returncode: int
    stderr: bytes


def _run(args: list[str], timeout: float) -> Proc:
    """Ohne Shell, mit Zeitlimit; stderr wird nur als Ende (begrenzt) behalten."""
    try:
        with tempfile.TemporaryFile() as err:
            done = subprocess.run(
                args, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=err,
                timeout=timeout, check=False,
            )  # fmt: skip
            size = err.seek(0, os.SEEK_END)
            err.seek(max(0, size - STDERR_TAIL_BYTES))
            tail = err.read()
    except subprocess.TimeoutExpired as exc:
        raise FfmpegError(f"{args[0]}: Zeitlimit von {int(timeout)} s überschritten") from exc
    except FileNotFoundError as exc:
        raise FfmpegError(f"{args[0]} nicht gefunden") from exc
    return Proc(done.returncode, tail)


def _fail_message(name: str, proc: Proc, data_dir: Path) -> str:
    tail = proc.stderr.decode("utf-8", "replace").strip()[-300:]
    return sanitize_error(f"{name} endete mit Code {proc.returncode}: {tail}", data_dir)


def decode_to_pcm(src: Path, dst: Path, ext: str, data_dir: Path, timeout: float) -> None:
    """Dekodiert nach s16le/48 kHz/mono. Das Eingabeformat ist fest (kein Raten, so wird ein
    Chunk mit `ffconcat`-Inhalt nicht als Concat-Liste gelesen), nur das Protokoll `file`.
    `asetpts=N/SR/TB` macht die Zeitstempel lückenlos: Lücken füllt der Handler selbst."""
    args = [
        FFMPEG, "-nostdin", "-v", "error", "-y",
        "-protocol_whitelist", "file", "-f", _DEMUXER_BY_EXT[ext], "-threads", "1",
        "-i", str(src),
        "-vn", "-af", "asetpts=N/SR/TB",
        "-ar", str(SAMPLE_RATE), "-ac", "1", "-f", "s16le", str(dst),
    ]  # fmt: skip
    proc = _run(args, timeout)
    if proc.returncode != 0:
        dst.unlink(missing_ok=True)
        raise DecodeError(_fail_message("ffmpeg (Dekodieren)", proc, data_dir))


def encode_m4a(pcm: Path, dst: Path, data_dir: Path) -> None:
    """AAC, 48 kHz, mono. `bitexact` und ohne Metadaten: gleiche Eingabe, gleiche Datei."""
    args = [
        FFMPEG, "-nostdin", "-v", "error", "-y",
        "-f", "s16le", "-ar", str(SAMPLE_RATE), "-ac", "1", "-i", str(pcm),
        "-threads", "1", "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact",
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
            args, stdin=subprocess.DEVNULL, capture_output=True, timeout=PROBE_TIMEOUT_S,
            check=False,
        )  # fmt: skip
    except subprocess.TimeoutExpired as exc:
        raise FfmpegError("ffprobe: Zeitlimit überschritten") from exc
    except FileNotFoundError as exc:
        raise FfmpegError("ffprobe nicht gefunden") from exc
    if proc.returncode != 0:
        raise FfmpegError(
            _fail_message(
                "ffprobe", Proc(proc.returncode, proc.stderr[-STDERR_TAIL_BYTES:]), data_dir
            )
        )
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


def _copy_range(src: Any, dst: Any, count: int) -> int:
    done = 0
    while done < count:
        buf = src.read(min(1 << 20, count - done))
        if not buf:
            break
        dst.write(buf)
        done += len(buf)
    return done


def assemble(pieces: list[Piece], started_ms: int, tail_end_ms: int | None, out: Path) -> int:
    """Legt die Stücke bei ihrem `start_ms` ab und gibt die Länge in ms zurück.

    Jedes Stück wird auf `length_ms` gebracht (Stille oder Kürzen). Beginnt es vor dem Ende des
    Vorgängers (Überlappung), entfällt sein Anfang. Verbrauchte PCM-Dateien werden gelöscht."""
    cursor = 0  # Bytes
    with out.open("wb") as dst:
        for piece in sorted(pieces, key=lambda p: p.start_ms):
            target = max(0, piece.start_ms - started_ms) * BYTES_PER_MS
            skip = max(0, cursor - target)
            total = piece.length_ms * BYTES_PER_MS
            want = total - skip
            if want > 0:
                actual = piece.pcm.stat().st_size
                front = max(0, total - actual) if piece.align_right else 0
                front_zeros = max(0, front - skip)
                _write_zeros(dst, max(0, target - cursor) + front_zeros)
                with piece.pcm.open("rb") as src:
                    src.seek(max(0, skip - front))
                    got = _copy_range(src, dst, want - front_zeros)
                _write_zeros(dst, want - front_zeros - got)
                cursor = max(cursor, target) + want
            piece.pcm.unlink(missing_ok=True)
        if tail_end_ms is not None:
            _write_zeros(dst, max(0, (tail_end_ms - started_ms) * BYTES_PER_MS - cursor))
            cursor = max(cursor, (tail_end_ms - started_ms) * BYTES_PER_MS)
    return cursor // BYTES_PER_MS


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


def update_session(conn: psycopg.Connection[Any], session_id: uuid.UUID, outcome: str) -> None:
    """Session-Fortschritt (§3): `processing['audio.finalize'] = outcome` (`fertig`/`fehler`).
    Ist die Session `beendet` und läuft kein weiterer Job mehr, wird sie `verarbeitet`.
    Danach `sg_session`."""
    row = conn.execute(
        "UPDATE session SET processing = COALESCE(processing, '{}'::jsonb) "
        "|| jsonb_build_object('audio.finalize', %s::text), updated_at = now() "
        "WHERE id = %s AND deleted_at IS NULL RETURNING state",
        (outcome, session_id),
    ).fetchone()
    if row is None:
        return
    if row[0] == "beendet":
        conn.execute(
            "UPDATE session SET state = 'verarbeitet', updated_at = now() "
            "WHERE id = %s AND state = 'beendet' AND NOT EXISTS ("
            "  SELECT 1 FROM job WHERE session_id = %s AND deleted_at IS NULL "
            "  AND state IN ('wartet', 'laeuft'))",
            (session_id, session_id),
        )
    conn.execute("SELECT pg_notify('sg_session', %s)", (str(session_id),))


def mark_session_failed(conn: psycopg.Connection[Any], payload: dict[str, Any]) -> None:
    """Hook `on_final_failure`: Session-Fortschritt auch bei endgültigem Scheitern. Die Session
    kommt aus `recording.session_id` (der Job ist schon `fehler`)."""
    try:
        recording_id = uuid.UUID(str(payload.get("recording_id")))
    except ValueError:
        return
    row = conn.execute("SELECT session_id FROM recording WHERE id = %s", (recording_id,)).fetchone()
    if row is not None:
        update_session(conn, row[0], "fehler")


def _cleanup_old_work(rec_dir: Path) -> None:
    """Reste abgebrochener Läufe entfernen."""
    if rec_dir.is_dir():
        for old in rec_dir.glob(".work-*"):
            shutil.rmtree(old, ignore_errors=True)
        (rec_dir / "full.m4a.part").unlink(missing_ok=True)


def _fsync(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _decode_pieces(
    work: Path,
    ext: str,
    usable: list[ChunkRow],
    independent: bool,
    data_dir: Path,
) -> tuple[list[ChunkRow], list[ChunkRow], list[Piece], list[Gap]]:
    """Gibt (behaltene Chunks, nicht dekodierbare Chunks, Stücke, gemeldete Verluste) zurück.
    Die geprüften Kopien liegen als `c<seq>.<ext>` im Arbeitsordner."""
    kept: list[ChunkRow] = []
    bad: list[ChunkRow] = []
    pieces: list[Piece] = []
    losses: list[Gap] = []

    def accept(group: list[ChunkRow], dst: Path, *, right: bool) -> None:
        """Stück übernehmen. 0 ms Dekodiertes: Chunks gelten als fehlend. Fehlt mehr als
        `LOSS_REPORT_MS` gegenüber der Soll-Länge, wird der Verlust als Lücke gemeldet."""
        declared = sum(c.duration_ms for c in group)
        actual = dst.stat().st_size // BYTES_PER_MS
        if actual == 0:
            log.warning("Lauf ab Chunk %d ergibt kein Audio", group[0].seq)
            dst.unlink(missing_ok=True)
            bad.extend(group)
            return
        loss = declared - actual
        if loss > LOSS_REPORT_MS:
            at = group[0].start_ms if right else group[0].start_ms + actual
            losses.append(Gap(at, loss, GAP_MISSING, 0))
        kept.extend(group)
        pieces.append(Piece(group[0].start_ms, declared, dst, align_right=right))

    if independent:
        for c in usable:
            dst = work / f"p{c.seq}.pcm"
            try:
                decode_to_pcm(work / f"c{c.seq}.{ext}", dst, ext, data_dir, DECODE_TIMEOUT_S)
            except DecodeError:
                log.warning("Chunk %d nicht dekodierbar", c.seq)
                bad.append(c)
                continue
            accept([c], dst, right=False)
        return kept, bad, pieces, losses

    if not usable or usable[0].seq != 0:
        # Ohne Init-Chunk ist kein Strom dekodierbar. Nachgelieferter seq 0 macht es später gut.
        return [], list(usable), [], []
    init = init_segment((work / f"c0.{ext}").read_bytes(), ext)
    for n, run in enumerate(split_runs(usable)):
        body = b"".join((work / f"c{c.seq}.{ext}").read_bytes() for c in run)
        if run[0].seq == 0:
            data = body
        else:
            # Der Lauf beginnt mitten im Strom: erst ab der ersten Grenze dekodierbar
            offset = first_boundary(body, ext)
            if init is None or offset is None:
                bad.extend(run)
                continue
            data = init + body[offset:]
        stream = work / f"run{n}.{ext}"
        stream.write_bytes(data)
        dst = work / f"p{n}.pcm"
        try:
            decode_to_pcm(stream, dst, ext, data_dir, DECODE_TIMEOUT_S)
        except DecodeError:
            log.warning("Lauf ab Chunk %d nicht dekodierbar", run[0].seq)
            bad.extend(run)
            continue
        finally:
            stream.unlink(missing_ok=True)
        accept(run, dst, right=run[0].seq > 0)
    return kept, bad, pieces, losses


@handler("audio.finalize", payload_type=AudioFinalizePayload, on_final_failure=mark_session_failed)
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
    mime, started_raw, independent, last_raw, completed_raw = rec
    ext = chunk_ext(str(mime))
    started_ms = int(started_raw)
    last_seq = None if last_raw is None else int(last_raw)
    completed_ms = None if completed_raw is None else int(completed_raw)

    rec_dir = recording_dir(ctx.data_dir, recording_id)
    final = rec_dir / "full.m4a"
    _cleanup_old_work(rec_dir)
    chunks = _load_chunks(ctx.conn, recording_id)

    work: Path | None = None
    audio_ms = 0
    size = 0
    try:
        usable: list[ChunkRow] = []
        bad: list[ChunkRow] = []
        pieces: list[Piece] = []
        losses: list[Gap] = []
        if chunks:
            rec_dir.mkdir(parents=True, exist_ok=True)
            work = Path(tempfile.mkdtemp(prefix=".work-", dir=rec_dir))
            for c in chunks:
                data = _read_verified(chunk_path(ctx.data_dir, recording_id, c.seq, ext), c)
                if data is None:
                    bad.append(c)
                else:
                    (work / f"c{c.seq}.{ext}").write_bytes(data)  # geprüfte Kopie
                    usable.append(c)
            usable, undecodable, pieces, losses = _decode_pieces(
                work, ext, usable, bool(independent), ctx.data_dir
            )
            bad.extend(undecodable)
        analysis = analyze(
            usable,
            bad,
            started_ms=started_ms,
            last_seq=last_seq,
            completed_duration_ms=completed_ms,
        )
        if losses:
            analysis = replace(
                analysis, gaps=sorted([*analysis.gaps, *losses], key=lambda g: g.start_ms)
            )
        if usable:
            assert work is not None
            pcm_out = work / "out.pcm"
            pcm_ms = assemble(pieces, started_ms, analysis.tail_end_ms, pcm_out)
            part = work / "full.m4a.part"
            encode_m4a(pcm_out, part, ctx.data_dir)
            pcm_out.unlink(missing_ok=True)
            try:
                audio_ms = probe_duration_ms(part, ctx.data_dir)
            except FfmpegError:
                audio_ms = pcm_ms
            _fsync(part)
            os.replace(part, final)
            size = final.stat().st_size
        else:
            final.unlink(missing_ok=True)  # kein verwertbares Audio: keine alte Datei stehen lassen
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
            try:
                session_uuid = uuid.UUID(ctx.session_id)
            except ValueError:
                session_uuid = None
            if session_uuid is not None:
                update_session(ctx.conn, session_uuid, "fertig")
    return result
