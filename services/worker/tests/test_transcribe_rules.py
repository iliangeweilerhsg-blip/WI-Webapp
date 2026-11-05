"""Reine Regeln von `transcribe` (VERTRAEGE §18.2, §18.6): Nachbearbeitung, Prompt, Fensterung,
Fake-Transcriber, `input_hash`. Ohne DB. Alle Texte sind erfunden."""

from __future__ import annotations

import hashlib
import importlib.util
import itertools
from pathlib import Path
from typing import Any

import pytest

from sg_worker.ai import postprocess as pp
from sg_worker.ai import prompt as pr
from sg_worker.ai import transcriber as tr
from sg_worker.ai.interfaces import Segment, Word
from sg_worker.handlers.transcribe import PIPELINE_VERSION, input_hash


def seg(
    start: float,
    end: float,
    text: str,
    *,
    nsp: float | None = 0.0,
    lp: float | None = -0.2,
    words: tuple[Word, ...] = (),
    lang: str | None = "de",
) -> Segment:
    return Segment(start, end, text, lang, lp, nsp, words)


def run(segments: list[Segment], started_ms: int = 0) -> list[pp.SegmentRow]:
    return pp.postprocess(segments, started_ms=started_ms, language="de")


# ---------- Nachbearbeitung: Halluzinationen ----------


def test_no_speech_above_threshold_is_dropped_at_threshold_kept() -> None:
    rows = run(
        [seg(0, 6, "Erster Satz.", nsp=0.61), seg(10, 16, "Zweiter Satz.", nsp=0.6)],
    )
    assert [r.text for r in rows] == ["Zweiter Satz."]


def test_empty_text_is_dropped() -> None:
    assert run([seg(0, 6, "   "), seg(10, 16, "")]) == []


def test_repetition_of_last_kept_is_dropped() -> None:
    rows = run(
        [
            seg(0, 6, "Danke fürs Zuhören."),
            seg(7, 7.5, "danke  fürs zuhören"),  # normiert gleich, Lücke 1 s
            seg(8, 9, "Danke, fürs Zuhören!"),  # auch, Lücke zum behaltenen 2 s
        ]
    )
    assert [r.text for r in rows] == ["Danke fürs Zuhören."]


def test_repetition_only_within_two_seconds() -> None:
    """Gleicher Text mit größerer Lücke ist keine Halluzination (Review von #148)."""
    rows = run([seg(0, 1, "Okay."), seg(600, 601, "Okay."), seg(603, 604, "okay")])
    assert [(r.start_ms, r.text) for r in rows] == [(0, "Okay."), (600_000, "Okay.")]
    rows = run([seg(0, 1, "Okay."), seg(3, 4, "Okay.")])  # Lücke genau 2 s: verworfen
    assert [r.text for r in rows] == ["Okay."]
    rows = run([seg(0, 1, "Okay."), seg(3.001, 4, "Okay.")])  # 2,001 s: bleibt
    assert len(rows) == 2


def test_repetition_compares_only_with_last_kept() -> None:
    rows = run([seg(0, 6, "Satz A."), seg(10, 16, "Satz B."), seg(20, 26, "Satz A.")])
    assert [r.text for r in rows] == ["Satz A.", "Satz B.", "Satz A."]


def test_repetition_after_dropped_silence_is_still_detected() -> None:
    """Regel 2 vergleicht mit dem zuletzt *behaltenen*, nicht mit dem verworfenen Abschnitt."""
    rows = run(
        [seg(0, 6, "Satz A."), seg(6.5, 7.5, "Satz X.", nsp=0.9), seg(8, 14, "Satz A.")],
    )
    assert [r.text for r in rows] == ["Satz A."]


# ---------- Nachbearbeitung: Satzgrenzen 5 bis 30 s ----------


def test_short_pieces_are_merged_until_sentence_end_after_five_seconds() -> None:
    rows = run(
        [
            seg(0.0, 2.0, "Das ist"),
            seg(2.0, 4.0, "ein Satz."),  # Gruppe 4 s: zu kurz, weiter anhängen
            seg(4.5, 7.0, "Und noch einer."),  # danach 7 s mit Punkt: Gruppe zu
            seg(7.5, 9.0, "Neu."),
        ]
    )
    assert [(r.start_ms, r.end_ms, r.text) for r in rows] == [
        (0, 7000, "Das ist ein Satz. Und noch einer."),
        (7500, 9000, "Neu."),
    ]


def test_group_without_sentence_end_keeps_growing() -> None:
    rows = run([seg(0, 6, "ohne Ende"), seg(6, 12, "geht es weiter."), seg(12, 13, "Neu.")])
    assert [r.text for r in rows] == ["ohne Ende geht es weiter.", "Neu."]


def test_gap_over_two_seconds_starts_new_group() -> None:
    rows = run([seg(0, 2, "eins"), seg(4.001, 6, "zwei"), seg(8, 9, "drei")])
    assert [r.text for r in rows] == ["eins", "zwei drei"]


def test_group_never_exceeds_thirty_seconds() -> None:
    pieces = [seg(i * 4.0, i * 4.0 + 4.0, f"teil {i}") for i in range(10)]
    rows = run(pieces)
    assert all(r.end_ms - r.start_ms <= 30_000 for r in rows)
    assert [(r.start_ms, r.end_ms) for r in rows] == [(0, 28_000), (28_000, 40_000)]


def test_sentence_end_marks() -> None:
    for mark in (".", "?", "!", "…"):
        rows = run([seg(0, 6, f"Satz{mark}"), seg(6, 8, "Neu")])
        assert len(rows) == 2, mark
    assert len(run([seg(0, 6, "Satz,"), seg(6, 8, "neu")])) == 1


def test_group_values_words_and_session_time() -> None:
    words_a = (Word(1.0, 1.4, " Das", 0.9), Word(1.4, 2.0, " ist", 1.2), Word(2.0, 2.1, "  ", 0.5))
    words_b = (Word(2.5, 9.0, " gut.", -0.3),)
    rows = pp.postprocess(
        [
            seg(1.0, 2.0, " Das ist ", lp=-0.5, nsp=0.1, words=words_a),
            seg(2.5, 4.0, "gut.", lp=-1.0, nsp=0.3, words=words_b),
        ],
        started_ms=60_000,
        language="de",
    )
    assert len(rows) == 1
    row = rows[0]
    assert (row.start_ms, row.end_ms, row.text, row.lang) == (61_000, 64_000, "Das ist gut.", "de")
    assert row.avg_logprob == pytest.approx((-0.5 * 1000 + -1.0 * 1500) / 2500)
    assert row.no_speech_prob == 0.3
    assert row.words == [
        {"text": "Das", "start_ms": 61_000, "end_ms": 61_400, "prob": 0.9},
        {"text": "ist", "start_ms": 61_400, "end_ms": 62_000, "prob": 1.0},
        {"text": "gut.", "start_ms": 62_500, "end_ms": 64_000, "prob": 0.0},  # geklemmt
    ]
    assert row.word_count == 3


def test_words_none_without_word_timestamps() -> None:
    rows = run([seg(0, 6, "Ohne Wörter hier.")])
    assert rows[0].words is None
    assert rows[0].word_count == 3


def test_invalid_language_becomes_null() -> None:
    rows = pp.postprocess([seg(0, 6, "Satz.")], started_ms=0, language="Deutsch")
    assert rows[0].lang is None


def test_recording_language_by_duration() -> None:
    segments = [seg(0, 5, "a", lang="en"), seg(5, 20, "b", lang="de"), seg(20, 22, "c", lang="en")]
    assert pp.recording_language(segments, None) == "de"
    assert pp.recording_language([seg(0, 5, "a", lang=None)], "en") == "en"


# ---------- Prompt ----------

DECK = ["Einführung", "  Graphen  ", "graphen", "", None, "Kürzeste Wege"]
TEXTS = [
    "Kante Kante Kante Knoten Knoten Zyklus Zyklus Matrix",
    "kante KNOTEN Baum Baum Baum Baum aber aber aber Graphen Graphen 1234 ab_c",
]


def test_prompt_form_german() -> None:
    prompt = pr.build_initial_prompt(
        module_name="Algorithmen", module_lang="de", deck_titles=DECK, module_texts=TEXTS
    )
    # Häufigkeiten: baum 4, kante 4, knoten 3, zyklus 2. Matrix (1x), Stoppwort und
    # Titelwort (Graphen) fallen weg. Aufsteigend, Gleichstand alphabetisch absteigend.
    assert prompt == (
        "Vorlesung Algorithmen. Begriffe: Zyklus, Knoten, Kante, Baum. "
        "Folien: Einführung, Graphen, Kürzeste Wege."
    )


def test_prompt_form_english_and_empty_parts() -> None:
    assert (
        pr.build_initial_prompt(
            module_name="Databases", module_lang="en", deck_titles=[], module_texts=[]
        )
        == "Lecture Databases."
    )
    assert (
        pr.build_initial_prompt(
            module_name="", module_lang="mixed", deck_titles=["A"], module_texts=[]
        )
        == "Folien: A."
    )
    assert (
        pr.build_initial_prompt(module_name=None, module_lang=None, deck_titles=[], module_texts=[])
        is None
    )


def test_prompt_language_mapping() -> None:
    assert [pr.prompt_language(x) for x in ("de", "en", "mixed", None)] == ["de", "en", None, None]


def test_terms_at_most_fifty_most_frequent_last() -> None:
    texts = [
        " ".join(f"wort{chr(97 + i % 26)}{chr(97 + i // 26)}" for _ in range(i + 2))
        for i in range(60)
    ]
    terms = pr.extract_terms(texts, [])
    assert len(terms) == 50
    assert terms[-1] == "worthc"  # i = 59 kommt am häufigsten vor
    assert "wortaa" not in terms  # die seltensten fallen weg


def test_most_frequent_spelling_is_shown() -> None:
    assert pr.extract_terms(["SQL-Abfrage sql-abfrage sql-abfrage"], []) == ["sql-abfrage"]


def test_estimate_tokens() -> None:
    assert tr.estimate_tokens("") == 0
    assert tr.estimate_tokens("abcd") == 2
    assert tr.estimate_tokens("äöü") == 2  # 6 Bytes


def test_shortening_removes_rarest_terms_first_then_titles_then_module() -> None:
    parts = pr.PromptParts("Modul", ["selten", "mittel", "haeufig"], ["T1", "T2"], False)

    def limit_to(n: int) -> Any:
        return lambda text: 0 if len(text) <= n else 10_000

    full = pr.render_prompt(parts)
    assert pr.shorten(parts, limit_to(len(full))) == full
    assert pr.shorten(parts, limit_to(len(full) - 1)) == (
        "Vorlesung Modul. Begriffe: mittel, haeufig. Folien: T1, T2."
    )
    assert pr.shorten(parts, limit_to(30)) == "Vorlesung Modul. Folien: T2."
    assert pr.shorten(parts, limit_to(16)) == "Vorlesung Modul."
    assert pr.shorten(parts, limit_to(5)) is None


def test_prompt_respects_token_limit() -> None:
    texts = [" ".join(f"Fachbegriff{i:03d} Fachbegriff{i:03d}" for i in range(50))]
    titles = [f"Folientitel Nummer {i}" for i in range(80)]
    prompt = pr.build_initial_prompt(
        module_name="Modul", module_lang="de", deck_titles=titles, module_texts=texts
    )
    assert prompt is not None
    assert tr.estimate_tokens(prompt) <= pr.MAX_PROMPT_TOKENS
    assert prompt.endswith("Folientitel Nummer 79.")  # das Ende bleibt
    assert "Begriffe" not in prompt  # Begriffe fallen vor den Titeln


def test_prompt_respects_char_limit_even_with_few_tokens() -> None:
    """Nachtrag N1: ≤ 2 000 Zeichen gilt zusätzlich zur Token-Grenze."""
    titles = [f"Titel {i:04d}" for i in range(400)]
    prompt = pr.build_initial_prompt(
        module_name="M",
        module_lang="de",
        deck_titles=titles,
        module_texts=[],
        count_tokens=lambda t: 1,
    )
    assert prompt is not None
    assert len(prompt) <= pr.MAX_PROMPT_CHARS
    assert len(prompt) > pr.MAX_PROMPT_CHARS - 20


# ---------- Fensterung (Hinweis in jedem 30-s-Fenster) ----------


def test_plan_window_last_keeps_all() -> None:
    segs = [seg(0, 10, "a"), seg(20, 30, "b")]
    assert tr.plan_window(segs, 0, 30, last=True) == (segs, 30)


def test_plan_window_drops_segment_touching_window_end() -> None:
    segs = [seg(30, 40, "a."), seg(41, 59.5, "abgeschni")]
    kept, nxt = tr.plan_window(segs, 30, 60, last=False)
    assert kept == segs[:1] and nxt == 41


def test_plan_window_keeps_early_segment_to_guarantee_progress() -> None:
    segs = [seg(0, 29.8, "sehr lang")]
    assert tr.plan_window(segs, 0, 30, last=False) == (segs, 30)


def test_shift_segment_clamps_into_window() -> None:
    s = seg(-0.5, 31.0, "x", words=(Word(1.0, 40.0, "x", 1.0),))
    shifted = tr.shift_segment(s, 30.0, 55.0)
    assert (shifted.start, shifted.end) == (30.0, 55.0)
    assert (shifted.words[0].start, shifted.words[0].end) == (31.0, 55.0)


class FakeWhisper:
    """Ersatz für `mlx_whisper`: merkt sich die Aufrufe, liefert je Fenster zwei Abschnitte."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def transcribe(self, audio: Any, **kwargs: Any) -> dict[str, Any]:
        length = float(audio)
        self.calls.append({"length": length, **kwargs})
        half = length / 2
        return {
            "language": "de",
            "segments": [
                {"start": 0.0, "end": half, "text": " vorn.", "avg_logprob": -0.1,
                 "no_speech_prob": 0.0, "words": [{"word": " vorn.", "start": 0.0, "end": half,
                                                    "probability": 0.8}]},
                {"start": half, "end": length, "text": " hinten", "avg_logprob": -0.1,
                 "no_speech_prob": 0.0, "words": []},
            ],
        }  # fmt: skip


def test_mlx_adapter_passes_prompt_to_every_window(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    whisper = FakeWhisper()
    seconds = 75
    monkeypatch.setattr(tr.MlxWhisperTranscriber, "_import", staticmethod(lambda: (whisper, None)))
    monkeypatch.setattr(tr, "decode_pcm16", lambda audio: bytes(2 * tr.SAMPLE_RATE * seconds))
    monkeypatch.setattr(tr, "pcm_to_float", lambda np, pcm: len(pcm) / 2 / tr.SAMPLE_RATE)
    t = tr.MlxWhisperTranscriber(model="modell-x")
    out = t.transcribe(tmp_path / "a.m4a", language=None, initial_prompt="Hinweis.", duration_ms=0)

    assert len(whisper.calls) >= 3
    for call in whisper.calls:
        assert call["initial_prompt"] == "Hinweis."
        assert call["path_or_hf_repo"] == "modell-x"
        assert call["language"] is None
        for key, value in tr.WHISPER_OPTIONS.items():
            assert call[key] == value
        assert call["length"] <= tr.WINDOW_S
    # Zeiten beziehen sich auf die ganze Datei, lückenlos und aufsteigend bis zum Ende
    assert out[0].start == 0.0
    assert out[-1].end == pytest.approx(seconds)
    assert all(a.end <= b.start + 1e-9 for a, b in itertools.pairwise(out))
    assert out[0].words[0].text == " vorn." and out[0].language == "de"
    # Das zweite Fenster beginnt beim verworfenen Abschnitt des ersten (15 s), nicht bei 30 s
    assert out[1].start == pytest.approx(15.0)


def test_mlx_adapter_decode_error(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(tr.MlxWhisperTranscriber, "_import", staticmethod(lambda: (None, None)))
    bad = tmp_path / "kaputt.m4a"
    bad.write_bytes(b"kein audio")
    if not _ffmpeg_available():
        pytest.skip("ffmpeg fehlt")
    with pytest.raises(tr.AudioDecodeError) as info:
        tr.MlxWhisperTranscriber().transcribe(
            bad, language=None, initial_prompt=None, duration_ms=1
        )
    assert str(tmp_path) not in str(info.value)


def _ffmpeg_available() -> bool:
    import shutil

    return shutil.which("ffmpeg") is not None


@pytest.mark.skipif(importlib.util.find_spec("mlx_whisper") is not None, reason="mlx installiert")
def test_mlx_unavailable_without_package(tmp_path: Path) -> None:
    t = tr.MlxWhisperTranscriber()
    with pytest.raises(tr.TranscriberUnavailable, match="mlx_whisper nicht importierbar"):
        t.transcribe(tmp_path / "a.m4a", language=None, initial_prompt=None, duration_ms=1)
    with pytest.raises(tr.TranscriberUnavailable):
        t.count_tokens("x")


def test_segment_from_whisper() -> None:
    s = tr.segment_from_whisper(
        {"start": 1, "end": 2.5, "text": " a", "avg_logprob": None, "no_speech_prob": 0.2,
         "words": [{"word": " a", "start": 1, "end": 2, "probability": 0.5}]},
        "en",
    )  # fmt: skip
    assert s == Segment(1.0, 2.5, " a", "en", None, 0.2, (Word(1.0, 2.0, " a", 0.5),))


# ---------- Auswahl und Fake ----------


def test_make_transcriber() -> None:
    assert isinstance(tr.make_transcriber({"SG_TRANSCRIBER": "fake"}), tr.FakeTranscriber)
    mlx = tr.make_transcriber({"SG_WHISPER_MODEL": "m"})
    assert isinstance(mlx, tr.MlxWhisperTranscriber)
    assert (mlx.provider, mlx.model) == ("mlx-whisper", "m")
    assert tr.make_transcriber({}).model == tr.DEFAULT_WHISPER_MODEL  # type: ignore[union-attr]
    with pytest.raises(tr.TranscriberUnavailable, match="unbekannter SG_TRANSCRIBER"):
        tr.make_transcriber({"SG_TRANSCRIBER": "cloud"})
    assert tr.config_error({"SG_TRANSCRIBER": "cloud"}) is not None
    assert tr.config_error({"SG_TRANSCRIBER": "fake"}) is None


def test_fake_transcriber_contract(tmp_path: Path) -> None:
    fake = tr.FakeTranscriber()
    assert (fake.provider, fake.model) == ("fake", "fake-1")
    out = fake.transcribe(
        tmp_path / "fehlt.m4a", language=None, initial_prompt=None, duration_ms=25_000
    )
    assert [(s.start, s.end) for s in out] == [(0, 10), (10, 20), (20, 25)]
    assert out[1].text == "Testabschnitt 2 mit erfundenem Inhalt."
    assert [w.text for w in out[1].words] == ["Testabschnitt", "2", "mit", "erfundenem", "Inhalt."]
    assert out[2].words[0].start == 20 and out[2].words[-1].end == 25
    assert all(s.language == "de" and s.avg_logprob == -0.1 and s.no_speech_prob == 0 for s in out)
    assert (
        fake.transcribe(tmp_path, language="en", initial_prompt=None, duration_ms=1)[0].language
        == "en"
    )
    # Nach der Nachbearbeitung bleibt jeder Abschnitt einzeln (§18.6)
    assert len(pp.postprocess(out, started_ms=0, language="de")) == 3


# ---------- input_hash ----------


def test_input_hash_formula_and_pipeline_version() -> None:
    args: dict[str, Any] = {
        "audio_sha256": "a" * 64,
        "provider": "fake",
        "model": "fake-1",
        "language": None,
        "initial_prompt": "Hinweis.",
    }
    expected = hashlib.sha256(
        f"{PIPELINE_VERSION}\n{'a' * 64}\nfake\nfake-1\n\nHinweis.".encode()
    ).hexdigest()
    assert input_hash(**args) == expected
    assert input_hash(**args, pipeline_version="p4-v2") != expected
    assert input_hash(**{**args, "language": "de"}) != expected
    assert input_hash(**{**args, "initial_prompt": None}) != expected


# ---------- echtes ffmpeg: Dekodieren und Messwerkzeug ----------


def _silence_m4a(path: Path, seconds: int) -> None:
    import subprocess

    subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono",
         "-t", str(seconds), "-c:a", "aac", "-f", "mp4", str(path)],
        check=True,
    )  # fmt: skip


@pytest.mark.skipif(not _ffmpeg_available(), reason="ffmpeg fehlt")
def test_decode_pcm16_gives_16khz_mono(tmp_path: Path) -> None:
    audio = tmp_path / "full.m4a"
    _silence_m4a(audio, 3)
    pcm = tr.decode_pcm16(audio)
    assert abs(len(pcm) / 2 / tr.SAMPLE_RATE - 3) < 0.1


@pytest.mark.skipif(not _ffmpeg_available(), reason="ffmpeg fehlt")
def test_bench_with_fake(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    from sg_worker.ai import bench

    monkeypatch.setenv("SG_TRANSCRIBER", "fake")
    audio = tmp_path / "probe.m4a"
    _silence_m4a(audio, 25)
    assert bench.main([str(audio), "--show", "1"]) == 0
    out = capsys.readouterr().out
    assert "Transcriber:  fake (fake-1)" in out
    assert "Abschnitte:   3 roh, 3 nach der Nachbearbeitung" in out
    assert "Testabschnitt 1" in out
    assert bench.main([str(tmp_path / "fehlt.m4a")]) == 2


def _fake_ffmpeg(tmp_path: Path, body: str) -> str:
    script = tmp_path / "ffmpeg-ersatz"
    script.write_text(f"#!/bin/sh\n{body}\n")
    script.chmod(0o755)
    return str(script)


def test_decode_killed_by_signal_is_retryable(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """§18.2: Ein Abbruch per Signal sagt nichts über die Datei, darum Retry statt `fehler`."""
    monkeypatch.setattr(tr, "FFMPEG", _fake_ffmpeg(tmp_path, "kill -9 $$"))
    with pytest.raises(RuntimeError, match="Signal 9") as info:
        tr.decode_pcm16(tmp_path / "full.m4a")
    assert not isinstance(info.value, tr.AudioDecodeError)


def test_decode_exit_code_is_decode_error(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(tr, "FFMPEG", _fake_ffmpeg(tmp_path, "exit 1"))
    with pytest.raises(tr.AudioDecodeError, match="Code 1"):
        tr.decode_pcm16(tmp_path / "full.m4a")
