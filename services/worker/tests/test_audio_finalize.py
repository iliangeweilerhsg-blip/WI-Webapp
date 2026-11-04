"""`audio.finalize`: Lücken, Prüfsummen, abhängige/unabhängige Chunks, Idempotenz, Session.

Zwei Gruppen:

- **Mit Fakes** (immer, wenn `DATABASE_URL` gesetzt ist): ffmpeg wird durch Kopierfunktionen
  ersetzt. Die "Audiodaten" der Chunks sind rohes PCM, das Ergebnis lässt sich byteweise prüfen.
- **Mit echtem ffmpeg** (`skipif`, wenn `ffmpeg`/`ffprobe` fehlen): Sinuston als WebM/Opus und
  fragmentiertes MP4/AAC, Prüfung von Dauer, Format und Stille an der Lücke.
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import struct
import subprocess
import uuid
from pathlib import Path
from typing import Any

import psycopg
import pytest
from psycopg.types.json import Jsonb
from sg_schemas.models import AudioFinalizePayload, AudioFinalizeResult

from conftest import USER_ID, get_job
from sg_worker.handlers import audio_finalize as af
from sg_worker.handlers.audio_finalize import ChunkRow, analyze, audio_finalize
from sg_worker.loop import Worker
from sg_worker.registry import Registry
from sg_worker.uuid7 import uuid7

HAVE_FFMPEG = shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None
needs_ffmpeg = pytest.mark.skipif(not HAVE_FFMPEG, reason="ffmpeg/ffprobe nicht installiert")

SESSION_ID = uuid.UUID("00000000-0000-7000-8000-0000000000bb")


# ---------- reine Logik: Lücken ----------


def rows(*spec: tuple[int, int, int]) -> list[ChunkRow]:
    return [ChunkRow(seq, start, dur, "0" * 64, 1) for seq, start, dur in spec]


def test_analyze_gapless() -> None:
    a = analyze(
        rows((0, 0, 1000), (1, 1000, 1000), (2, 2000, 500)),
        set(),
        started_ms=0,
        last_seq=2,
        completed_duration_ms=2500,
    )
    assert a.missing_seqs == []
    assert a.gaps == []


def test_analyze_tolerates_clock_jitter() -> None:
    a = analyze(
        rows((0, 0, 1000), (1, 1030, 1000)),
        set(),
        started_ms=0,
        last_seq=None,
        completed_duration_ms=None,
    )
    assert a.gaps == []


def test_analyze_missing_chunk_and_time_jump() -> None:
    a = analyze(
        rows((0, 0, 1000), (1, 1000, 1000), (3, 3000, 1000), (4, 5000, 1000)),
        set(),
        started_ms=0,
        last_seq=4,
        completed_duration_ms=6000,
    )
    assert a.missing_seqs == [2]
    assert [(g.start_ms, g.duration_ms, g.reason, g.before_index) for g in a.gaps] == [
        (2000, 1000, "fehlender_chunk", 2),
        (4000, 1000, "zeitluecke", 3),
    ]


def test_analyze_missing_tail_and_head() -> None:
    a = analyze(
        rows((1, 1000, 1000), (2, 2000, 1000)),
        {0},
        started_ms=0,
        last_seq=4,
        completed_duration_ms=5000,
    )
    assert a.missing_seqs == [0, 3, 4]
    assert [(g.start_ms, g.duration_ms, g.reason, g.before_index) for g in a.gaps] == [
        (0, 1000, "fehlender_chunk", 0),
        (3000, 2000, "fehlender_chunk", 2),
    ]


def test_analyze_not_completed_does_not_invent_tail() -> None:
    a = analyze(
        rows((0, 0, 1000), (1, 1000, 1000)),
        set(),
        started_ms=0,
        last_seq=None,
        completed_duration_ms=None,
    )
    assert (a.missing_seqs, a.gaps) == ([], [])


def test_analyze_rejects_absurd_input() -> None:
    from sg_worker.registry import NonRetryableError

    with pytest.raises(NonRetryableError):
        analyze(
            rows((0, 0, 1000)), set(), started_ms=0, last_seq=2_000_000_000, completed_duration_ms=1
        )
    with pytest.raises(NonRetryableError):
        analyze(
            rows((0, 0, 1000), (2, 10**10, 1000)),
            set(),
            started_ms=0,
            last_seq=None,
            completed_duration_ms=None,
        )


def test_chunk_paths_come_from_ids_only(tmp_path: Path) -> None:
    rid = uuid.UUID("00000000-0000-7000-8000-000000000001")
    assert af.chunk_path(tmp_path, rid, 7, "webm") == (
        tmp_path / "media" / "recordings" / str(rid) / "chunks" / "7.webm"
    )
    assert af.chunk_ext("audio/webm;codecs=opus") == "webm"
    assert af.chunk_ext("Audio/MP4; codecs=mp4a.40.2") == "mp4"
    from sg_worker.registry import NonRetryableError

    with pytest.raises(NonRetryableError):
        af.chunk_ext("audio/ogg")


# ---------- Hilfen für DB-Tests ----------


@pytest.fixture
def worker(
    database_url: str, connect_kwargs: dict[str, Any], tmp_path: Path, schema: str
) -> Worker:
    reg = Registry()
    reg.register("audio.finalize", audio_finalize, AudioFinalizePayload)
    return Worker(
        database_url,
        tmp_path,
        registry=reg,
        connect_kwargs=connect_kwargs,
        channel=f"sg_jobs_{uuid.uuid4().hex[:8]}",
    )


def add_recording(
    conn: psycopg.Connection[Any],
    data_dir: Path,
    chunks: list[tuple[int, bytes]],
    *,
    mime: str = "audio/webm;codecs=opus",
    independent: bool = False,
    dur: int = 2000,
    starts: dict[int, int] | None = None,
    last_seq: int | None = None,
    completed_ms: int | None = None,
    started_ms: int = 0,
    sha_override: dict[int, str] | None = None,
    session_id: uuid.UUID | None = None,
) -> uuid.UUID:
    """Legt Aufnahme, Chunk-Zeilen und Dateien an. `start_ms` = `seq * dur`, außer `starts`."""
    rid = uuid7()
    ext = af.chunk_ext(mime)
    conn.execute(
        "INSERT INTO recording (id, user_id, session_id, mime, codec, started_ms, "
        "chunks_independent, completed_at, completed_last_seq, completed_duration_ms) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, CASE WHEN %s THEN now() END, %s, %s)",
        (
            rid,
            USER_ID,
            session_id or SESSION_ID,
            mime,
            "opus" if ext == "webm" else "aac",
            started_ms,
            independent,
            last_seq is not None,
            last_seq,
            completed_ms,
        ),
    )
    folder = af.recording_dir(data_dir, rid) / "chunks"
    folder.mkdir(parents=True)
    for seq, data in chunks:
        (folder / f"{seq}.{ext}").write_bytes(data)
        conn.execute(
            "INSERT INTO audio_chunk (id, user_id, recording_id, seq, start_ms, duration_ms, "
            "file_path, sha256, size_bytes) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (
                uuid7(),
                USER_ID,
                rid,
                seq,
                (starts or {}).get(seq, started_ms + seq * dur),
                dur,
                f"media/recordings/{rid}/chunks/{seq}.{ext}",
                (sha_override or {}).get(seq, hashlib.sha256(data).hexdigest()),
                len(data),
            ),
        )
    return rid


def add_job(
    conn: psycopg.Connection[Any],
    rid: uuid.UUID,
    *,
    session_id: uuid.UUID | None = None,
    max_attempts: int = 3,
) -> uuid.UUID:
    job_id = uuid7()
    conn.execute(
        "INSERT INTO job (id, user_id, type, payload, session_id, max_attempts) "
        "VALUES (%s, %s, 'audio.finalize', %s, %s, %s)",
        (job_id, USER_ID, Jsonb({"recording_id": str(rid)}), session_id, max_attempts),
    )
    return job_id


def full_path(data_dir: Path, rid: uuid.UUID) -> Path:
    return af.recording_dir(data_dir, rid) / "full.m4a"


def result_of(conn: psycopg.Connection[Any], job: uuid.UUID) -> AudioFinalizeResult:
    row = get_job(conn, job)
    assert row["state"] == "fertig", row["error"]
    return AudioFinalizeResult.model_validate(row["result"])


def recording_row(conn: psycopg.Connection[Any], rid: uuid.UUID) -> tuple[Any, ...]:
    row = conn.execute("SELECT duration_ms, state FROM recording WHERE id = %s", (rid,)).fetchone()
    assert row is not None
    return row


def leftovers(data_dir: Path, rid: uuid.UUID) -> list[str]:
    folder = af.recording_dir(data_dir, rid)
    return sorted(p.name for p in folder.iterdir() if p.name != "chunks")


# ---------- Fakes: PCM statt Audio, ffmpeg ersetzt ----------

#: 10 ms = 960 Bytes PCM. Die "Chunk-Dateien" bestehen direkt aus PCM.
MS = af.BYTES_PER_MS


def pcm(tag: int, ms: int = 10) -> bytes:
    return bytes([tag]) * (ms * MS)


@pytest.fixture
def fake_ffmpeg(monkeypatch: pytest.MonkeyPatch) -> None:
    def decode(src: Path, dst: Path, data_dir: Path) -> None:
        data = src.read_bytes()
        if data.startswith(b"KAPUTT"):
            raise af.ChunkDecodeError("ffmpeg (Dekodieren) endete mit Code 1")
        dst.write_bytes(data)

    def encode(src: Path, dst: Path, data_dir: Path) -> None:
        dst.write_bytes(src.read_bytes())

    def probe(path: Path, data_dir: Path) -> int:
        return path.stat().st_size // MS

    monkeypatch.setattr(af, "decode_chunk_to_pcm", decode)
    monkeypatch.setattr(af, "decode_stream_to_pcm", decode)
    monkeypatch.setattr(af, "encode_m4a", encode)
    monkeypatch.setattr(af, "probe_duration_ms", probe)


def five(tags: str = "ABCDE") -> list[tuple[int, bytes]]:
    return [(i, pcm(ord(t))) for i, t in enumerate(tags)]


@pytest.mark.parametrize("independent", [False, True])
def test_gapless(
    worker: Worker,
    conn: psycopg.Connection[Any],
    tmp_path: Path,
    fake_ffmpeg: None,
    independent: bool,
) -> None:
    rid = add_recording(
        conn, tmp_path, five(), dur=10, independent=independent, last_seq=4, completed_ms=50
    )
    job = add_job(conn, rid)
    assert worker.drain(conn) == 1
    res = result_of(conn, job)
    assert (res.state.value, res.chunk_count, res.missing_seqs, res.gaps) == (
        "vollstaendig",
        5,
        [],
        [],
    )
    assert res.audio_duration_ms == 50
    assert res.file_size_bytes == 50 * MS
    assert full_path(tmp_path, rid).read_bytes() == b"".join(d for _, d in five())
    assert recording_row(conn, rid) == (50, "vollstaendig")
    assert leftovers(tmp_path, rid) == ["full.m4a"]


@pytest.mark.parametrize("independent", [False, True])
def test_gap_is_filled_with_silence(
    worker: Worker,
    conn: psycopg.Connection[Any],
    tmp_path: Path,
    fake_ffmpeg: None,
    independent: bool,
) -> None:
    chunks = [c for c in five() if c[0] != 2]
    rid = add_recording(
        conn, tmp_path, chunks, dur=10, independent=independent, last_seq=4, completed_ms=50
    )
    job = add_job(conn, rid)
    worker.drain(conn)
    res = result_of(conn, job)
    assert res.state.value == "mit_luecken"
    assert [m.root for m in res.missing_seqs] == [2]
    assert [(g.start_ms, g.duration_ms, g.reason.value) for g in res.gaps] == [
        (20, 10, "fehlender_chunk")
    ]
    expected = pcm(ord("A")) + pcm(ord("B")) + bytes(10 * MS) + pcm(ord("D")) + pcm(ord("E"))
    assert full_path(tmp_path, rid).read_bytes() == expected
    assert res.audio_duration_ms == 50  # Länge inklusive Stille
    assert recording_row(conn, rid) == (50, "mit_luecken")


@pytest.mark.parametrize("independent", [False, True])
def test_time_jump_without_missing_seq(
    worker: Worker,
    conn: psycopg.Connection[Any],
    tmp_path: Path,
    fake_ffmpeg: None,
    independent: bool,
) -> None:
    # Chunk 3 und 4 beginnen 100 ms später (Recorder-Pause), alle seq sind da
    rid = add_recording(
        conn,
        tmp_path,
        five(),
        dur=10,
        independent=independent,
        starts={3: 130, 4: 140},
        last_seq=4,
        completed_ms=150,
    )
    job = add_job(conn, rid)
    worker.drain(conn)
    res = result_of(conn, job)
    assert res.state.value == "mit_luecken"
    assert res.missing_seqs == []
    assert [(g.start_ms, g.duration_ms, g.reason.value) for g in res.gaps] == [
        (30, 100, "zeitluecke")
    ]
    out = full_path(tmp_path, rid).read_bytes()
    assert out == (
        pcm(ord("A"))
        + pcm(ord("B"))
        + pcm(ord("C"))
        + bytes(100 * MS)
        + pcm(ord("D"))
        + pcm(ord("E"))
    )


@pytest.mark.parametrize("independent", [False, True])
def test_wrong_sha256_counts_as_missing(
    worker: Worker,
    conn: psycopg.Connection[Any],
    tmp_path: Path,
    fake_ffmpeg: None,
    independent: bool,
) -> None:
    rid = add_recording(
        conn,
        tmp_path,
        five(),
        dur=10,
        independent=independent,
        sha_override={3: "f" * 64},
        last_seq=4,
        completed_ms=50,
    )
    job = add_job(conn, rid)
    worker.drain(conn)
    res = result_of(conn, job)
    assert res.state.value == "mit_luecken"
    assert [m.root for m in res.missing_seqs] == [3]
    assert res.chunk_count == 4
    assert [(g.start_ms, g.duration_ms) for g in res.gaps] == [(30, 10)]
    out = full_path(tmp_path, rid).read_bytes()
    assert pcm(ord("D")) not in out
    assert len(out) == 50 * MS


def test_changed_file_size_counts_as_missing(
    worker: Worker, conn: psycopg.Connection[Any], tmp_path: Path, fake_ffmpeg: None
) -> None:
    rid = add_recording(conn, tmp_path, five(), dur=10, independent=True, last_seq=4)
    path = af.chunk_path(tmp_path, rid, 1, "webm")
    path.write_bytes(path.read_bytes() + b"x")
    job = add_job(conn, rid)
    worker.drain(conn)
    assert [m.root for m in result_of(conn, job).missing_seqs] == [1]


def test_missing_file_on_disk_counts_as_missing(
    worker: Worker, conn: psycopg.Connection[Any], tmp_path: Path, fake_ffmpeg: None
) -> None:
    rid = add_recording(conn, tmp_path, five(), dur=10, independent=True, last_seq=4)
    af.chunk_path(tmp_path, rid, 2, "webm").unlink()
    job = add_job(conn, rid)
    worker.drain(conn)
    assert [m.root for m in result_of(conn, job).missing_seqs] == [2]


def test_undecodable_independent_chunk_becomes_gap(
    worker: Worker, conn: psycopg.Connection[Any], tmp_path: Path, fake_ffmpeg: None
) -> None:
    chunks = five()
    chunks[1] = (1, b"KAPUTT" + bytes(10 * MS - 6))
    rid = add_recording(conn, tmp_path, chunks, dur=10, independent=True, last_seq=4)
    job = add_job(conn, rid)
    worker.drain(conn)
    res = result_of(conn, job)
    assert [m.root for m in res.missing_seqs] == [1]
    assert [(g.start_ms, g.duration_ms) for g in res.gaps] == [(10, 10)]
    assert len(full_path(tmp_path, rid).read_bytes()) == 50 * MS


def test_dependent_without_init_chunk_fails_without_retry(
    worker: Worker, conn: psycopg.Connection[Any], tmp_path: Path, fake_ffmpeg: None
) -> None:
    rid = add_recording(conn, tmp_path, five()[1:], dur=10, independent=False, last_seq=4)
    job = add_job(conn, rid)
    worker.drain(conn)
    row = get_job(conn, job)
    assert row["state"] == "fehler"
    assert row["attempts"] == 1
    assert "Init-Chunk" in row["error"]
    assert not full_path(tmp_path, rid).exists()


def test_independent_without_first_chunk_pads_the_start(
    worker: Worker, conn: psycopg.Connection[Any], tmp_path: Path, fake_ffmpeg: None
) -> None:
    rid = add_recording(conn, tmp_path, five()[1:], dur=10, independent=True, last_seq=4)
    job = add_job(conn, rid)
    worker.drain(conn)
    res = result_of(conn, job)
    assert [m.root for m in res.missing_seqs] == [0]
    assert [(g.start_ms, g.duration_ms) for g in res.gaps] == [(0, 10)]
    assert full_path(tmp_path, rid).read_bytes()[: 10 * MS] == bytes(10 * MS)


def test_missing_tail_is_padded(
    worker: Worker, conn: psycopg.Connection[Any], tmp_path: Path, fake_ffmpeg: None
) -> None:
    # Client meldet last_seq=4 / 50 ms, geliefert wurden nur 0..2
    rid = add_recording(conn, tmp_path, five()[:3], dur=10, last_seq=4, completed_ms=50)
    job = add_job(conn, rid)
    worker.drain(conn)
    res = result_of(conn, job)
    assert res.state.value == "mit_luecken"
    assert [m.root for m in res.missing_seqs] == [3, 4]
    assert [(g.start_ms, g.duration_ms) for g in res.gaps] == [(30, 20)]
    assert res.audio_duration_ms == 50


def test_aborted_recording_uses_available_chunks(
    worker: Worker, conn: psycopg.Connection[Any], tmp_path: Path, fake_ffmpeg: None
) -> None:
    """Nie `complete` gesendet: Der Job arbeitet mit dem, was da ist (kein Neueinplanen)."""
    rid = add_recording(conn, tmp_path, five()[:3], dur=10)  # completed_at/last_seq leer
    assert conn.execute("SELECT completed_at FROM recording WHERE id = %s", (rid,)).fetchone() == (
        None,
    )
    job = add_job(conn, rid)
    worker.drain(conn)
    res = result_of(conn, job)
    assert (res.chunk_count, res.audio_duration_ms, res.missing_seqs) == (3, 30, [])
    assert res.state.value == "vollstaendig"
    assert recording_row(conn, rid) == (30, "vollstaendig")


def test_no_chunks_at_all(
    worker: Worker, conn: psycopg.Connection[Any], tmp_path: Path, fake_ffmpeg: None
) -> None:
    rid = add_recording(conn, tmp_path, [], dur=10, last_seq=0, completed_ms=0)
    job = add_job(conn, rid)
    worker.drain(conn)
    res = result_of(conn, job)
    assert (res.state.value, res.chunk_count, res.audio_duration_ms, res.file_size_bytes) == (
        "mit_luecken",
        0,
        0,
        0,
    )
    assert [m.root for m in res.missing_seqs] == [0]
    assert not full_path(tmp_path, rid).exists()


def test_rerun_is_idempotent(
    worker: Worker, conn: psycopg.Connection[Any], tmp_path: Path, fake_ffmpeg: None
) -> None:
    chunks = [c for c in five() if c[0] != 2]
    rid = add_recording(conn, tmp_path, chunks, dur=10, last_seq=4, completed_ms=50)
    first = add_job(conn, rid)
    worker.drain(conn)
    data = full_path(tmp_path, rid).read_bytes()
    second = add_job(conn, rid)
    worker.drain(conn)
    a, b = result_of(conn, first), result_of(conn, second)
    a_json = a.model_dump(mode="json")
    b_json = b.model_dump(mode="json")
    a_json.pop("job_duration_ms")
    b_json.pop("job_duration_ms")
    assert a_json == b_json
    assert full_path(tmp_path, rid).read_bytes() == data
    assert leftovers(tmp_path, rid) == ["full.m4a"]
    assert recording_row(conn, rid) == (50, "mit_luecken")


def test_late_chunk_after_finalize_repairs_gap(
    worker: Worker, conn: psycopg.Connection[Any], tmp_path: Path, fake_ffmpeg: None
) -> None:
    chunks = five()
    rid = add_recording(
        conn, tmp_path, [c for c in chunks if c[0] != 2], dur=10, last_seq=4, completed_ms=50
    )
    first = add_job(conn, rid)
    worker.drain(conn)
    assert result_of(conn, first).state.value == "mit_luecken"
    # Der Browser liefert Chunk 2 nach (der Core legt dazu einen neuen Job an)
    data = chunks[2][1]
    af.chunk_path(tmp_path, rid, 2, "webm").write_bytes(data)
    conn.execute(
        "INSERT INTO audio_chunk (id, user_id, recording_id, seq, start_ms, duration_ms, "
        "file_path, sha256, size_bytes) VALUES (%s, %s, %s, 2, 20, 10, 'x', %s, %s)",
        (uuid7(), USER_ID, rid, hashlib.sha256(data).hexdigest(), len(data)),
    )
    second = add_job(conn, rid)
    worker.drain(conn)
    res = result_of(conn, second)
    assert (res.state.value, res.missing_seqs, res.gaps) == ("vollstaendig", [], [])
    assert full_path(tmp_path, rid).read_bytes() == b"".join(d for _, d in chunks)
    assert recording_row(conn, rid) == (50, "vollstaendig")


def test_unknown_recording_fails_without_retry(
    worker: Worker, conn: psycopg.Connection[Any], fake_ffmpeg: None
) -> None:
    job = add_job(conn, uuid7())
    worker.drain(conn)
    row = get_job(conn, job)
    assert (row["state"], row["attempts"]) == ("fehler", 1)
    assert "nicht gefunden" in row["error"]


def test_invalid_payload_fails_without_retry(
    worker: Worker, conn: psycopg.Connection[Any], fake_ffmpeg: None
) -> None:
    job = uuid7()
    conn.execute(
        "INSERT INTO job (id, user_id, type, payload) VALUES (%s, %s, 'audio.finalize', %s)",
        (job, USER_ID, Jsonb({"recording_id": "kein-uuid"})),
    )
    worker.drain(conn)
    assert get_job(conn, job)["state"] == "fehler"


def test_ffmpeg_error_is_retried_and_path_free(
    worker: Worker,
    conn: psycopg.Connection[Any],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(af, "FFMPEG", "/nicht/vorhanden/ffmpeg")
    rid = add_recording(conn, tmp_path, five(), dur=10, last_seq=4)
    job = add_job(conn, rid)
    worker.drain(conn)
    row = get_job(conn, job)
    assert row["state"] == "wartet"  # Retry mit Backoff
    assert "nicht gefunden" in row["error"]
    assert str(tmp_path) not in row["error"]
    assert leftovers(tmp_path, rid) == []  # Arbeitsordner aufgeräumt
    assert recording_row(conn, rid)[1] == "laeuft"  # nichts halb geschrieben


def test_db_failure_rolls_back_recording_and_job(
    worker: Worker, conn: psycopg.Connection[Any], tmp_path: Path, fake_ffmpeg: None
) -> None:
    conn.execute(
        "CREATE FUNCTION block_rec() RETURNS trigger LANGUAGE plpgsql AS "
        "$$ BEGIN RAISE EXCEPTION 'gesperrt'; END $$"
    )
    conn.execute(
        "CREATE TRIGGER block_rec BEFORE UPDATE ON recording "
        "FOR EACH ROW EXECUTE FUNCTION block_rec()"
    )
    rid = add_recording(conn, tmp_path, five(), dur=10, last_seq=4)
    job = add_job(conn, rid)
    worker.drain(conn)
    row = get_job(conn, job)
    assert row["state"] == "wartet"
    assert "gesperrt" in row["error"]


# ---------- Session-Fortschritt und pg_notify ----------


def add_session(conn: psycopg.Connection[Any], state: str) -> uuid.UUID:
    conn.execute(
        "INSERT INTO session (id, user_id, state) VALUES (%s, %s, %s)",
        (SESSION_ID, USER_ID, state),
    )
    return SESSION_ID


def test_session_becomes_verarbeitet_and_notifies(
    worker: Worker,
    conn: psycopg.Connection[Any],
    tmp_path: Path,
    database_url: str,
    fake_ffmpeg: None,
) -> None:
    sid = add_session(conn, "beendet")
    rid = add_recording(conn, tmp_path, five(), dur=10, last_seq=4, session_id=sid)
    add_job(conn, rid, session_id=sid)
    with psycopg.connect(database_url, autocommit=True) as listener:
        listener.execute("LISTEN sg_session")
        worker.drain(conn)
        got = [n.payload for n in listener.notifies(timeout=2, stop_after=1)]
    assert got == [str(sid)]
    state, processing = conn.execute(
        "SELECT state, processing FROM session WHERE id = %s", (sid,)
    ).fetchone() or (None, None)
    assert state == "verarbeitet"
    assert processing == {"audio.finalize": "fertig"}


def test_session_stays_beendet_while_other_job_pending(
    worker: Worker, conn: psycopg.Connection[Any], tmp_path: Path, fake_ffmpeg: None
) -> None:
    sid = add_session(conn, "beendet")
    rid = add_recording(conn, tmp_path, five(), dur=10, last_seq=4, session_id=sid)
    add_job(conn, rid, session_id=sid)
    conn.execute(
        "INSERT INTO job (id, user_id, type, session_id, state, run_after) "
        "VALUES (%s, %s, 'transcribe', %s, 'wartet', now() + interval '1 day')",
        (uuid7(), USER_ID, sid),
    )
    worker.drain(conn)
    state = conn.execute("SELECT state FROM session WHERE id = %s", (sid,)).fetchone()
    assert state == ("beendet",)


def test_running_session_is_not_finished(
    worker: Worker, conn: psycopg.Connection[Any], tmp_path: Path, fake_ffmpeg: None
) -> None:
    sid = add_session(conn, "laeuft")
    rid = add_recording(conn, tmp_path, five(), dur=10, last_seq=4, session_id=sid)
    add_job(conn, rid, session_id=sid)
    worker.drain(conn)
    state = conn.execute("SELECT state FROM session WHERE id = %s", (sid,)).fetchone()
    assert state == ("laeuft",)


# ---------- echtes ffmpeg ----------


def _sh(*args: str) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(args, capture_output=True, check=True, timeout=120)


def _split(data: bytes, marker: bytes) -> list[bytes]:
    """Zerlegt an `marker`-Positionen. Der erste Chunk enthält den Header davor."""
    pos: list[int] = []
    i = data.find(marker)
    while i >= 0:
        pos.append(i)
        i = data.find(marker, i + 1)
    assert len(pos) >= 5
    pos[0] = 0
    return [data[a:b] for a, b in zip(pos, [*pos[1:], len(data)], strict=True)]


@pytest.fixture(scope="session")
def webm_stream(tmp_path_factory: pytest.TempPathFactory) -> list[bytes]:
    """10 s Sinuston als ein WebM-Strom, Cluster à 2 s: 5 Chunks, nur der erste mit Header."""
    if not HAVE_FFMPEG:
        pytest.skip("ffmpeg fehlt")
    out = tmp_path_factory.mktemp("webm") / "s.webm"
    _sh(
        "ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i",
        "sine=frequency=440:sample_rate=48000:duration=10",
        "-c:a", "libopus", "-cluster_time_limit", "2000", "-f", "webm", str(out),
    )  # fmt: skip
    chunks = _split(out.read_bytes(), b"\x1f\x43\xb6\x75")
    assert len(chunks) in (5, 6)
    if len(chunks) == 6:  # Cues am Ende gehören zum letzten Chunk
        chunks[4:] = [b"".join(chunks[4:])]
    return chunks


@pytest.fixture(scope="session")
def mp4_stream(tmp_path_factory: pytest.TempPathFactory) -> list[bytes]:
    """10 s Sinuston als fragmentiertes MP4: Init + erstes Fragment, dann je ein Fragment."""
    if not HAVE_FFMPEG:
        pytest.skip("ffmpeg fehlt")
    out = tmp_path_factory.mktemp("mp4") / "s.mp4"
    _sh(
        "ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i",
        "sine=frequency=440:sample_rate=48000:duration=10",
        "-c:a", "aac", "-b:a", "64k",
        "-movflags", "frag_keyframe+empty_moov+default_base_moof",
        "-frag_duration", "2000000", "-f", "mp4", str(out),
    )  # fmt: skip
    data = out.read_bytes()
    boxes: list[tuple[str, int, int]] = []
    i = 0
    while i < len(data):
        (size,) = struct.unpack(">I", data[i : i + 4])
        boxes.append((data[i + 4 : i + 8].decode("ascii"), i, size))
        i += size
    groups: list[list[tuple[str, int, int]]] = []
    cur: list[tuple[str, int, int]] = []
    for box in boxes:
        if box[0] == "moof" and any(b[0] == "moof" for b in cur):
            groups.append(cur)
            cur = []
        cur.append(box)
    groups.append(cur)
    chunks = [data[g[0][1] : g[-1][1] + g[-1][2]] for g in groups]
    assert len(chunks) == 5
    return chunks


@pytest.fixture(scope="session")
def independent_webm(tmp_path_factory: pytest.TempPathFactory) -> list[bytes]:
    """5 eigenständige WebM-Dateien à 2 s (Recorder je Chunk neu gestartet)."""
    if not HAVE_FFMPEG:
        pytest.skip("ffmpeg fehlt")
    folder = tmp_path_factory.mktemp("indep")
    chunks = []
    for i in range(5):
        out = folder / f"{i}.webm"
        _sh(
            "ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i",
            "sine=frequency=440:sample_rate=48000:duration=2",
            "-c:a", "libopus", "-f", "webm", str(out),
        )  # fmt: skip
        chunks.append(out.read_bytes())
    return chunks


def probe(path: Path) -> dict[str, Any]:
    out = _sh(
        "ffprobe", "-v", "error", "-show_entries",
        "stream=codec_name,sample_rate,channels:format=duration,format_name",
        "-of", "json", str(path),
    ).stdout  # fmt: skip
    return json.loads(out)  # type: ignore[no-any-return]


def silences(path: Path) -> list[tuple[float, float]]:
    err = subprocess.run(
        ["ffmpeg", "-nostdin", "-i", str(path), "-af", "silencedetect=noise=-50dB:d=0.3",
         "-f", "null", "-"],
        capture_output=True,
        timeout=120,
        check=True,
    ).stderr.decode()  # fmt: skip
    starts = [float(m) for m in re.findall(r"silence_start: ([0-9.]+)", err)]
    durations = [float(m) for m in re.findall(r"silence_duration: ([0-9.]+)", err)]
    return list(zip(starts, durations, strict=False))


def assert_m4a(path: Path, seconds: float, tolerance: float = 0.3) -> None:
    info = probe(path)
    stream = info["streams"][0]
    assert (stream["codec_name"], int(stream["sample_rate"]), stream["channels"]) == (
        "aac",
        48000,
        1,
    )
    assert "mp4" in info["format"]["format_name"]
    assert abs(float(info["format"]["duration"]) - seconds) < tolerance


@needs_ffmpeg
@pytest.mark.parametrize("kind", ["webm", "mp4"])
def test_real_dependent_gapless(
    worker: Worker,
    conn: psycopg.Connection[Any],
    tmp_path: Path,
    kind: str,
    webm_stream: list[bytes],
    mp4_stream: list[bytes],
) -> None:
    stream = webm_stream if kind == "webm" else mp4_stream
    mime = "audio/webm;codecs=opus" if kind == "webm" else "audio/mp4;codecs=mp4a.40.2"
    rid = add_recording(
        conn, tmp_path, list(enumerate(stream)), mime=mime, last_seq=4, completed_ms=10000
    )
    job = add_job(conn, rid)
    worker.drain(conn)
    res = result_of(conn, job)
    assert (res.state.value, res.missing_seqs, res.gaps) == ("vollstaendig", [], [])
    assert_m4a(full_path(tmp_path, rid), 10.0)
    assert silences(full_path(tmp_path, rid)) == []
    assert abs(res.audio_duration_ms - 10000) < 300
    assert res.file_size_bytes == full_path(tmp_path, rid).stat().st_size
    assert recording_row(conn, rid) == (res.audio_duration_ms, "vollstaendig")
    assert leftovers(tmp_path, rid) == ["full.m4a"]


@needs_ffmpeg
@pytest.mark.parametrize("kind", ["webm", "mp4", "independent"])
def test_real_gap_gets_exact_silence(
    worker: Worker,
    conn: psycopg.Connection[Any],
    tmp_path: Path,
    kind: str,
    webm_stream: list[bytes],
    mp4_stream: list[bytes],
    independent_webm: list[bytes],
) -> None:
    source = {"webm": webm_stream, "mp4": mp4_stream, "independent": independent_webm}[kind]
    mime = "audio/mp4;codecs=mp4a.40.2" if kind == "mp4" else "audio/webm;codecs=opus"
    chunks = [c for c in enumerate(source) if c[0] != 2]  # Chunk 2 (4 bis 6 s) fehlt
    rid = add_recording(
        conn,
        tmp_path,
        chunks,
        mime=mime,
        independent=kind == "independent",
        last_seq=4,
        completed_ms=10000,
    )
    job = add_job(conn, rid)
    worker.drain(conn)
    res = result_of(conn, job)
    assert res.state.value == "mit_luecken"
    assert [m.root for m in res.missing_seqs] == [2]
    assert [(g.start_ms, g.duration_ms, g.reason.value) for g in res.gaps] == [
        (4000, 2000, "fehlender_chunk")
    ]
    out = full_path(tmp_path, rid)
    assert_m4a(out, 10.0)  # 8 s Ton + 2 s Stille
    found = silences(out)
    assert len(found) == 1
    start, length = found[0]
    assert abs(start - 4.0) < 0.15
    assert abs(length - 2.0) < 0.25
    assert recording_row(conn, rid)[1] == "mit_luecken"


@needs_ffmpeg
def test_real_rerun_gives_identical_file(
    worker: Worker, conn: psycopg.Connection[Any], tmp_path: Path, webm_stream: list[bytes]
) -> None:
    chunks = [c for c in enumerate(webm_stream) if c[0] != 3]
    rid = add_recording(conn, tmp_path, chunks, last_seq=4, completed_ms=10000)
    first = add_job(conn, rid)
    worker.drain(conn)
    digest = hashlib.sha256(full_path(tmp_path, rid).read_bytes()).hexdigest()
    second = add_job(conn, rid)
    worker.drain(conn)
    a = result_of(conn, first).model_dump(mode="json")
    b = result_of(conn, second).model_dump(mode="json")
    a.pop("job_duration_ms")
    b.pop("job_duration_ms")
    assert a == b
    assert hashlib.sha256(full_path(tmp_path, rid).read_bytes()).hexdigest() == digest
    assert leftovers(tmp_path, rid) == ["full.m4a"]


@needs_ffmpeg
def test_real_wrong_sha256_chunk_is_silenced(
    worker: Worker, conn: psycopg.Connection[Any], tmp_path: Path, independent_webm: list[bytes]
) -> None:
    rid = add_recording(
        conn,
        tmp_path,
        list(enumerate(independent_webm)),
        independent=True,
        sha_override={1: "0" * 64},
        last_seq=4,
        completed_ms=10000,
    )
    job = add_job(conn, rid)
    worker.drain(conn)
    res = result_of(conn, job)
    assert [m.root for m in res.missing_seqs] == [1]
    found = silences(full_path(tmp_path, rid))
    assert len(found) == 1 and abs(found[0][0] - 2.0) < 0.15


@needs_ffmpeg
def test_real_garbage_independent_chunk_is_skipped(
    worker: Worker, conn: psycopg.Connection[Any], tmp_path: Path, independent_webm: list[bytes]
) -> None:
    chunks = list(enumerate(independent_webm))
    chunks[3] = (3, b"das ist kein Audio" * 50)  # sha256 stimmt, ffmpeg kann es nicht lesen
    rid = add_recording(conn, tmp_path, chunks, independent=True, last_seq=4, completed_ms=10000)
    job = add_job(conn, rid)
    worker.drain(conn)
    res = result_of(conn, job)
    assert [m.root for m in res.missing_seqs] == [3]
    assert_m4a(full_path(tmp_path, rid), 10.0)
