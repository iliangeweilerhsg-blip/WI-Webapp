"""`transcribe` mit echter DB und Fake-Transcriber (VERTRAEGE §18.2, §18.6)."""

from __future__ import annotations

import hashlib
import uuid
from pathlib import Path
from typing import Any

import psycopg
import pytest
from psycopg.rows import dict_row
from sg_schemas.models import TranscribeResult

import sg_worker.handlers  # noqa: F401  (registriert die Handler)
from conftest import get_job
from p2data import (
    SID,
    add_deck,
    add_finalize_job,
    add_module,
    add_pipeline_job,
    add_recording,
    add_session,
    processing,
)
from sg_worker.ai import transcriber as tr
from sg_worker.ai.interfaces import Segment
from sg_worker.ai.prompt import build_initial_prompt
from sg_worker.handlers import transcribe as th
from sg_worker.loop import Worker
from sg_worker.registry import default_registry

Conn = psycopg.Connection[Any]

TITLES = ["Einführung", "Sortieren", "Sortieren"]
TEXTS = ["Pivotelement Pivotelement Laufzeit", "Laufzeit Laufzeit Rekursion", ""]


@pytest.fixture(autouse=True)
def fake_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SG_TRANSCRIBER", "fake")


@pytest.fixture
def worker(database_url: str, connect_kwargs: dict[str, Any], tmp_path: Path) -> Worker:
    return Worker(
        database_url,
        tmp_path,
        registry=default_registry,
        channel=f"sg_jobs_{uuid.uuid4().hex[:8]}",
        connect_kwargs=connect_kwargs,
        worker_id="ich",
    )


@pytest.fixture
def base(conn: Conn) -> None:
    add_module(conn)
    add_deck(conn, TITLES, texts=TEXTS)
    add_session(conn)


def run_job(worker: Worker, conn: Conn, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    job_id = add_pipeline_job(conn, "transcribe", payload)
    worker.drain(conn)
    return get_job(conn, job_id)


def transcripts(conn: Conn) -> list[dict[str, Any]]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT * FROM transcript ORDER BY audio_duration_ms DESC")
        return cur.fetchall()


def segments(conn: Conn, transcript_id: Any) -> list[dict[str, Any]]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT * FROM transcript_segment WHERE transcript_id = %s ORDER BY seq",
            (transcript_id,),
        )
        return cur.fetchall()


def outcomes(job: dict[str, Any]) -> list[str]:
    return [r["outcome"] for r in job["result"]["recordings"]]


class Recording:
    """Transcriber, der Aufrufe mitschreibt und optional scheitert."""

    provider = "fake"
    model = "fake-1"

    def __init__(self, fail_on: int | None = None, error: Exception | None = None) -> None:
        self.calls: list[dict[str, Any]] = []
        self.fail_on = fail_on
        self.error = error or RuntimeError("Speicher voll")
        self.inner = tr.FakeTranscriber()

    def transcribe(
        self, audio: Path, *, language: str | None, initial_prompt: str | None, duration_ms: int
    ) -> list[Segment]:
        self.calls.append({"audio": audio, "language": language, "prompt": initial_prompt})
        if self.fail_on is not None and len(self.calls) == self.fail_on:
            raise self.error
        return self.inner.transcribe(
            audio, language=language, initial_prompt=initial_prompt, duration_ms=duration_ms
        )


def use(monkeypatch: pytest.MonkeyPatch, transcriber: Any) -> None:
    monkeypatch.setattr(th, "make_transcriber", lambda: transcriber)


# ---------- Eingaben, Rückschreiben ----------


@pytest.mark.usefixtures("base")
def test_transcribes_all_recordings_and_writes_rows(
    worker: Worker, conn: Conn, tmp_path: Path
) -> None:
    rec_a, fin_a = add_recording(conn, tmp_path, started_ms=0, duration_ms=25_000)
    rec_b, fin_b = add_recording(
        conn, tmp_path, started_ms=60_000, duration_ms=12_000, content=b"anderes audio"
    )
    job = run_job(worker, conn)
    assert job["state"] == "fertig", job["error"]
    result = TranscribeResult.model_validate(job["result"])
    assert result.provider == "fake" and result.model == "fake-1"
    assert outcomes(job) == ["transkribiert", "transkribiert"]
    assert (result.segment_count, result.word_count, result.removed_transcripts) == (5, 25, 0)

    prompt = build_initial_prompt(
        module_name="Testmodul Algorithmen",
        module_lang="de",
        deck_titles=TITLES,
        module_texts=[*TITLES, *TEXTS],
    )
    assert prompt == (
        "Vorlesung Testmodul Algorithmen. Begriffe: Pivotelement, Laufzeit. "
        "Folien: Einführung, Sortieren."
    )
    first, second = transcripts(conn)
    sha = hashlib.sha256(b"erfundenes audio").hexdigest()
    assert first["recording_id"] == rec_a and first["finalize_job_id"] == fin_a
    assert first["job_id"] == job["id"] and first["session_id"] == SID
    assert (first["provider"], first["model"], first["language"]) == ("fake", "fake-1", "de")
    assert first["initial_prompt"] == prompt
    assert first["audio_sha256"] == sha
    assert first["input_hash"] == th.input_hash(
        audio_sha256=sha, provider="fake", model="fake-1", language="de", initial_prompt=prompt
    )
    assert (first["audio_duration_ms"], first["segment_count"], first["word_count"]) == (
        25_000,
        3,
        15,
    )
    assert second["recording_id"] == rec_b and second["finalize_job_id"] == fin_b

    rows = segments(conn, second["id"])
    assert [(r["seq"], r["start_ms"], r["end_ms"]) for r in rows] == [
        (0, 60_000, 70_000),
        (1, 70_000, 72_000),
    ]  # Sitzungszeit = started_ms + Sekunden
    assert rows[0]["text"] == "Testabschnitt 1 mit erfundenem Inhalt."
    assert rows[0]["lang"] == "de" and rows[0]["speaker"] is None
    assert rows[0]["words"][0] == {
        "text": "Testabschnitt",
        "start_ms": 60_000,
        "end_ms": 62_000,
        "prob": 1.0,
    }
    assert processing(conn) == ("verarbeitet", {"transcribe": "fertig"})


@pytest.mark.usefixtures("base")
def test_prompt_and_language_reach_transcriber(
    worker: Worker, conn: Conn, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    conn.execute("UPDATE module SET lang = 'mixed'")
    add_recording(conn, tmp_path)
    spy = Recording()
    use(monkeypatch, spy)
    job = run_job(worker, conn)
    assert job["state"] == "fertig", job["error"]
    assert spy.calls[0]["language"] is None  # mixed → automatisch
    assert spy.calls[0]["prompt"].startswith("Vorlesung Testmodul")
    assert transcripts(conn)[0]["language"] == "de"  # erkannt (Fake: de)


@pytest.mark.usefixtures("base")
def test_english_module_gets_english_prompt(worker: Worker, conn: Conn, tmp_path: Path) -> None:
    conn.execute("UPDATE module SET lang = 'en'")
    add_recording(conn, tmp_path)
    run_job(worker, conn)
    t = transcripts(conn)[0]
    assert t["initial_prompt"].startswith("Lecture Testmodul Algorithmen.")
    assert t["language"] == "en"


# ---------- Wiederholbarkeit, input_hash ----------


@pytest.mark.usefixtures("base")
def test_unchanged_input_is_skipped_and_finalize_job_updated(
    worker: Worker, conn: Conn, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    rec, _ = add_recording(conn, tmp_path)
    run_job(worker, conn)
    before = transcripts(conn)[0]
    newer_finalize = add_finalize_job(conn, rec)
    spy = Recording()
    use(monkeypatch, spy)
    job = run_job(worker, conn)
    assert job["state"] == "fertig", job["error"]
    assert outcomes(job) == ["unveraendert"]
    assert spy.calls == []
    after = transcripts(conn)[0]
    assert after["id"] == before["id"]
    assert after["finalize_job_id"] == newer_finalize
    result = TranscribeResult.model_validate(job["result"])
    assert result.recordings[0].transcribe_ms == 0
    assert result.recordings[0].segment_count == 3


@pytest.mark.usefixtures("base")
def test_force_transcribes_again(worker: Worker, conn: Conn, tmp_path: Path) -> None:
    add_recording(conn, tmp_path)
    run_job(worker, conn)
    before = transcripts(conn)[0]
    job = run_job(worker, conn, {"session_id": str(SID), "force": True})
    assert outcomes(job) == ["transkribiert"]
    after = transcripts(conn)[0]
    assert after["id"] != before["id"]
    assert conn.execute("SELECT count(*) FROM transcript_segment").fetchone() == (3,)


@pytest.mark.usefixtures("base")
def test_changed_inputs_transcribe_again(
    worker: Worker, conn: Conn, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Neue `pipeline_version`, neues Audio oder ein geänderter Hinweis ändern `input_hash`."""
    rec, _ = add_recording(conn, tmp_path)
    run_job(worker, conn)
    monkeypatch.setattr(th, "PIPELINE_VERSION", "p4-v2")
    assert outcomes(run_job(worker, conn)) == ["transkribiert"]
    path = tmp_path / "media" / "recordings" / str(rec) / "full.m4a"
    path.write_bytes(b"neu kodiertes audio")
    assert outcomes(run_job(worker, conn)) == ["transkribiert"]
    conn.execute("UPDATE slide SET title = 'Neuer Titel' WHERE index = 1")
    assert outcomes(run_job(worker, conn)) == ["transkribiert"]
    assert outcomes(run_job(worker, conn)) == ["unveraendert"]


@pytest.mark.usefixtures("base")
def test_abort_keeps_finished_recording_and_retry_skips_it(
    worker: Worker, conn: Conn, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    add_recording(conn, tmp_path, started_ms=0)
    add_recording(conn, tmp_path, started_ms=60_000, content=b"zweite")
    spy = Recording(fail_on=2)
    use(monkeypatch, spy)
    job = run_job(worker, conn)
    assert (job["state"], job["attempts"]) == ("wartet", 1)  # Retry nach §3
    assert job["error"] == "RuntimeError: Speicher voll"
    assert len(transcripts(conn)) == 1  # die erste Aufnahme ist schon geschrieben

    spy2 = Recording()
    use(monkeypatch, spy2)
    conn.execute("UPDATE job SET run_after = NULL WHERE id = %s", (job["id"],))
    worker.drain(conn)
    job = get_job(conn, job["id"])
    assert job["state"] == "fertig", job["error"]
    assert outcomes(job) == ["unveraendert", "transkribiert"]
    assert len(spy2.calls) == 1


@pytest.mark.usefixtures("base")
def test_force_retry_skips_what_this_job_already_wrote(
    worker: Worker, conn: Conn, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    add_recording(conn, tmp_path, started_ms=0)
    add_recording(conn, tmp_path, started_ms=60_000, content=b"zweite")
    run_job(worker, conn)
    use(monkeypatch, Recording(fail_on=2))
    job = run_job(worker, conn, {"session_id": str(SID), "force": True})
    assert job["state"] == "wartet"
    spy = Recording()
    use(monkeypatch, spy)
    conn.execute("UPDATE job SET run_after = NULL WHERE id = %s", (job["id"],))
    worker.drain(conn)
    job = get_job(conn, job["id"])
    assert outcomes(job) == ["unveraendert", "transkribiert"]
    assert len(spy.calls) == 1


# ---------- ohne Audio, entfernte Transkripte ----------


@pytest.mark.usefixtures("base")
def test_recordings_without_audio(worker: Worker, conn: Conn, tmp_path: Path) -> None:
    add_recording(conn, tmp_path, started_ms=0, finalize=None)  # kein fertiger finalize
    add_recording(conn, tmp_path, started_ms=1, finalize="fehler")
    add_recording(conn, tmp_path, started_ms=2, duration_ms=0)
    add_recording(conn, tmp_path, started_ms=3, duration_ms=None)
    add_recording(conn, tmp_path, started_ms=4, content=None)  # Datei fehlt
    job = run_job(worker, conn)
    assert job["state"] == "fertig", job["error"]
    assert outcomes(job) == ["ohne_audio"] * 5
    TranscribeResult.model_validate(job["result"])
    assert transcripts(conn) == []
    assert processing(conn)[1] == {"transcribe": "fertig"}


@pytest.mark.usefixtures("base")
def test_session_without_recordings(worker: Worker, conn: Conn) -> None:
    job = run_job(worker, conn)
    assert job["state"] == "fertig"
    assert job["result"]["recordings"] == [] and job["result"]["session_deleted"] is False


@pytest.mark.usefixtures("base")
def test_removes_transcripts_of_deleted_and_audioless_recordings(
    worker: Worker, conn: Conn, tmp_path: Path
) -> None:
    rec_a, _ = add_recording(conn, tmp_path, started_ms=0)
    rec_b, _ = add_recording(conn, tmp_path, started_ms=60_000, content=b"b")
    rec_c, _ = add_recording(conn, tmp_path, started_ms=120_000, content=b"c")
    run_job(worker, conn)
    assert len(transcripts(conn)) == 3
    conn.execute("UPDATE recording SET deleted_at = now() WHERE id = %s", (rec_a,))
    (tmp_path / "media" / "recordings" / str(rec_b) / "full.m4a").unlink()
    job = run_job(worker, conn)
    assert job["state"] == "fertig", job["error"]
    assert outcomes(job) == ["ohne_audio", "unveraendert"]
    assert job["result"]["removed_transcripts"] == 2
    assert [t["recording_id"] for t in transcripts(conn)] == [rec_c]
    assert conn.execute("SELECT count(*) FROM transcript_segment").fetchone() == (3,)


# ---------- Fehler ----------


@pytest.mark.usefixtures("base")
def test_deleted_session_finishes_without_writing(
    worker: Worker, conn: Conn, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    add_recording(conn, tmp_path)
    conn.execute("UPDATE session SET deleted_at = now()")
    spy = Recording()
    use(monkeypatch, spy)
    job = run_job(worker, conn)
    assert job["state"] == "fertig"
    assert job["result"]["session_deleted"] is True and job["result"]["recordings"] == []
    TranscribeResult.model_validate(job["result"])
    assert spy.calls == [] and transcripts(conn) == []


@pytest.mark.usefixtures("base")
def test_session_deleted_during_transcription_writes_nothing(
    worker: Worker, conn: Conn, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    add_recording(conn, tmp_path)

    class Deleting(Recording):
        def transcribe(self, audio: Path, **kw: Any) -> list[Segment]:
            conn.execute("UPDATE session SET deleted_at = now()")
            return super().transcribe(audio, **kw)

    use(monkeypatch, Deleting())
    job = run_job(worker, conn)
    assert job["state"] == "fertig"
    assert job["result"]["session_deleted"] is True
    assert transcripts(conn) == []


def test_missing_session_fails_without_retry(worker: Worker, conn: Conn) -> None:
    job = run_job(worker, conn)
    assert (job["state"], job["attempts"], job["error"]) == ("fehler", 1, "Session unbekannt")


@pytest.mark.usefixtures("base")
def test_invalid_payload_fails(worker: Worker, conn: Conn) -> None:
    job = run_job(worker, conn, {"session_id": "keine-uuid"})
    assert job["state"] == "fehler" and job["error"].startswith("ungültiges Payload")


@pytest.mark.usefixtures("base")
def test_unknown_transcriber_fails_immediately(
    worker: Worker, conn: Conn, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SG_TRANSCRIBER", "cloud")
    add_recording(conn, tmp_path)
    job = run_job(worker, conn)
    assert (job["state"], job["attempts"]) == ("fehler", 1)
    assert job["error"].startswith("Transkription nicht verfügbar: unbekannter SG_TRANSCRIBER")
    assert processing(conn) == ("verarbeitet", {"transcribe": "fehler"})


@pytest.mark.usefixtures("base")
def test_unavailable_package_fails_immediately(
    worker: Worker, conn: Conn, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    add_recording(conn, tmp_path)
    use(monkeypatch, Recording(fail_on=1, error=tr.TranscriberUnavailable("mlx fehlt")))
    job = run_job(worker, conn)
    assert (job["state"], job["error"]) == ("fehler", "Transkription nicht verfügbar: mlx fehlt")


@pytest.mark.usefixtures("base")
def test_undecodable_audio_fails_with_recording_id(
    worker: Worker, conn: Conn, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    rec, _ = add_recording(conn, tmp_path)
    use(monkeypatch, Recording(fail_on=1, error=tr.AudioDecodeError("ffmpeg endete mit Code 1")))
    job = run_job(worker, conn)
    assert (job["state"], job["attempts"]) == ("fehler", 1)
    assert str(rec) in job["error"] and str(tmp_path) not in job["error"]


@pytest.mark.usefixtures("base")
def test_os_error_is_retried_without_path(
    worker: Worker, conn: Conn, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    add_recording(conn, tmp_path)
    err = PermissionError(13, "Zugriff verweigert", str(tmp_path / "media" / "x"))
    use(monkeypatch, Recording(fail_on=1, error=err))
    job = run_job(worker, conn)
    assert job["state"] == "wartet" and str(tmp_path) not in job["error"]


@pytest.mark.usefixtures("base")
def test_lock_lost_writes_nothing(
    worker: Worker, conn: Conn, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    add_recording(conn, tmp_path)

    class Stealing(Recording):
        def transcribe(self, audio: Path, **kw: Any) -> list[Segment]:
            conn.execute("UPDATE job SET locked_by = 'anderer' WHERE type = 'transcribe'")
            return super().transcribe(audio, **kw)

    use(monkeypatch, Stealing())
    job = run_job(worker, conn)
    assert (job["state"], job["locked_by"]) == ("laeuft", "anderer")
    assert transcripts(conn) == []


# ---------- Nachbearbeitung über den Handler ----------


@pytest.mark.usefixtures("base")
def test_postprocessing_is_applied(
    worker: Worker, conn: Conn, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    add_recording(conn, tmp_path, started_ms=1_000, duration_ms=60_000)

    class Noisy(Recording):
        def transcribe(self, audio: Path, **kw: Any) -> list[Segment]:
            return [
                Segment(0, 2, "Kurzer", "de", -0.2, 0.1),
                Segment(2, 6, "Anfang.", "de", -0.2, 0.1),
                Segment(6, 8, "Untertitel von erfundener Hand", "de", -1.0, 0.95),
                Segment(9, 15, "Ein Satz.", "de", -0.2, 0.0),
                Segment(16, 22, "ein satz", "de", -0.2, 0.0),
            ]

    use(monkeypatch, Noisy())
    job = run_job(worker, conn)
    assert job["state"] == "fertig", job["error"]
    rows = segments(conn, transcripts(conn)[0]["id"])
    assert [(r["start_ms"], r["end_ms"], r["text"]) for r in rows] == [
        (1_000, 7_000, "Kurzer Anfang."),
        (10_000, 16_000, "Ein Satz."),
    ]
    assert all(r["words"] is None for r in rows)


@pytest.mark.usefixtures("base")
@pytest.mark.parametrize(("body", "state"), [("kill -9 $$", "wartet"), ("exit 1", "fehler")])
def test_ffmpeg_signal_retries_exit_code_fails(
    worker: Worker,
    conn: Conn,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    body: str,
    state: str,
) -> None:
    """mlx-Adapter mit `ffmpeg`-Ersatz: Signal → Retry (§18.2), Fehlercode → sofort `fehler`."""
    add_recording(conn, tmp_path)
    script = tmp_path / "ffmpeg-ersatz"
    script.write_text(f"#!/bin/sh\n{body}\n")
    script.chmod(0o755)
    monkeypatch.setattr(tr, "FFMPEG", str(script))
    monkeypatch.setattr(tr.MlxWhisperTranscriber, "_import", staticmethod(lambda: (None, None)))
    monkeypatch.setattr(tr.MlxWhisperTranscriber, "count_tokens", lambda self, text: 1)
    use(monkeypatch, tr.MlxWhisperTranscriber())
    job = run_job(worker, conn)
    assert (job["state"], job["attempts"]) == (state, 1)
    assert transcripts(conn) == []
