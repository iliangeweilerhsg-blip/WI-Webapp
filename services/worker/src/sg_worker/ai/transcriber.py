"""Transcriber (VERTRAEGE §18.6): `mlx-whisper` (Standard, nur macOS arm64) und `fake` (CI, Linux).

Auswahl über `SG_TRANSCRIBER` (`mlx-whisper` | `fake`, Standard `mlx-whisper`), Modell über
`SG_WHISPER_MODEL` (Standard `mlx-community/whisper-large-v3-turbo`).

**Hinweis in jedem 30-s-Fenster:** `mlx_whisper.transcribe` gibt `initial_prompt` bei
`condition_on_previous_text=False` nur dem ersten Fenster mit. Der Adapter baut darum eine eigene
Fensterschleife: Er dekodiert die Datei einmal nach 16 kHz mono und ruft `mlx_whisper.transcribe`
je Fenster (≤ 30 s) mit dem Hinweis auf. Die Zeiten werden um den Fensterbeginn verschoben, so dass
sie sich wieder auf die ganze Datei beziehen. Abschnitte, die am Fensterende anstoßen, können
abgeschnitten sein: Sie werden verworfen und mit dem nächsten Fenster ab ihrem Beginn neu
transkribiert (`plan_window`). Ändert sich diese Fensterung, steigt `PIPELINE_VERSION`.

`mlx_whisper` (und numpy) werden erst beim ersten Gebrauch importiert. Unter Linux und in der CI
ist das Paket nicht installiert. Ein Importfehler wird zu `TranscriberUnavailable`.
"""

from __future__ import annotations

import functools
import math
import os
import subprocess
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

from .interfaces import Segment, Transcriber, Word

PROVIDER_MLX = "mlx-whisper"
PROVIDER_FAKE = "fake"
DEFAULT_PROVIDER = PROVIDER_MLX
DEFAULT_WHISPER_MODEL = "mlx-community/whisper-large-v3-turbo"
FAKE_MODEL = "fake-1"

#: Fensterlänge von Whisper (Sekunden)
WINDOW_S = 30.0
#: Ein Abschnitt, der näher als das am Fensterende endet, gilt als womöglich abgeschnitten
TAIL_GUARD_S = 1.0
#: Mindestvorschub je Fenster: Abschnitte, die früher beginnen, werden nie verworfen
MIN_ADVANCE_S = 10.0
#: Ein Rest unter dieser Länge wird nicht mehr transkribiert
MIN_WINDOW_S = 0.2

SAMPLE_RATE = 16_000
DECODE_TIMEOUT_S = 900
FFMPEG = "ffmpeg"

#: Parameter für `mlx_whisper.transcribe` laut §18.6
WHISPER_OPTIONS: Mapping[str, Any] = {
    "word_timestamps": True,
    "condition_on_previous_text": False,
    "hallucination_silence_threshold": 2.0,
    "no_speech_threshold": 0.6,
    "compression_ratio_threshold": 2.4,
}


class TranscriberUnavailable(Exception):
    """Transkription nicht möglich (Paket fehlt, unbekannter `SG_TRANSCRIBER`).
    Nicht wiederholbar."""


class AudioDecodeError(Exception):
    """Die Audiodatei lässt sich nicht dekodieren (deterministisch). Meldung ohne Pfad."""


# ---------- Token-Schätzung ----------


def estimate_tokens(text: str) -> int:
    """Schätzung ohne Tokenizer (§18.6): `ceil(UTF-8-Bytes / 3)`."""
    return math.ceil(len(text.encode("utf-8")) / 3)


def token_counter(transcriber: Transcriber) -> Callable[[str], int]:
    """Zähler des Transcribers (`count_tokens`), sonst die Schätzung."""
    count = getattr(transcriber, "count_tokens", None)
    return count if callable(count) else estimate_tokens


# ---------- Fake ----------


@dataclass
class FakeTranscriber:
    """Deterministisch, ohne ffmpeg, liest die Datei nicht (§18.6)."""

    provider: str = PROVIDER_FAKE
    model: str = FAKE_MODEL

    def transcribe(
        self, audio: Path, *, language: str | None, initial_prompt: str | None, duration_ms: int
    ) -> list[Segment]:
        total_s = max(0, duration_ms) / 1000
        segments: list[Segment] = []
        for k in range(math.ceil(max(0, duration_ms) / 10_000)):
            start = 10.0 * k
            end = min(10.0 * k + 10, total_s)
            text = f"Testabschnitt {k + 1} mit erfundenem Inhalt."
            parts = text.split(" ")
            step = (end - start) / len(parts)
            words = tuple(
                Word(start + i * step, start + (i + 1) * step, part, 1.0)
                for i, part in enumerate(parts)
            )
            segments.append(
                Segment(
                    start=start,
                    end=end,
                    text=text,
                    language=language or "de",
                    avg_logprob=-0.1,
                    no_speech_prob=0.0,
                    words=words,
                )
            )
        return segments


# ---------- Fensterung (rein, testbar) ----------


def shift_segment(raw: Segment, offset: float, limit: float) -> Segment:
    """Verschiebt Zeiten um den Fensterbeginn und klemmt sie auf `[offset, limit]`."""

    def at(t: float) -> float:
        return min(max(offset + t, offset), limit)

    start = at(raw.start)
    end = max(at(raw.end), start)
    words = tuple(replace(w, start=at(w.start), end=max(at(w.end), at(w.start))) for w in raw.words)
    return replace(raw, start=start, end=end, words=words)


def plan_window(
    segments: Sequence[Segment], window_start: float, window_end: float, *, last: bool
) -> tuple[list[Segment], float]:
    """Was von einem Fenster bleibt und wo das nächste beginnt (Zeiten ab Dateibeginn).

    Im letzten Fenster bleibt alles. Sonst werden Abschnitte am Ende verworfen, die weniger als
    `TAIL_GUARD_S` vor dem Fensterende enden (womöglich mitten im Wort abgeschnitten) und nicht
    früher als `MIN_ADVANCE_S` nach dem Fensterbeginn anfangen. Das nächste Fenster beginnt beim
    ersten verworfenen Abschnitt, sonst am Fensterende. Es geht immer um mindestens
    `MIN_ADVANCE_S` (bzw. bis zum Fensterende) voran, die Schleife endet also.
    """
    kept = sorted(segments, key=lambda s: (s.start, s.end))
    if last:
        return kept, window_end
    next_start = window_end
    while (
        kept
        and kept[-1].end > window_end - TAIL_GUARD_S
        and kept[-1].start >= window_start + MIN_ADVANCE_S
    ):
        next_start = kept.pop().start
    return kept, next_start


def windows_transcribe(
    total_s: float, transcribe_window: Callable[[float, float], list[Segment]]
) -> list[Segment]:
    """Fensterschleife: `transcribe_window(start, end)` liefert Abschnitte mit Zeiten relativ zum
    Fensterbeginn. Ergebnis mit Zeiten ab Dateibeginn, nach Beginn sortiert."""
    out: list[Segment] = []
    start = 0.0
    while total_s - start >= MIN_WINDOW_S:
        end = min(start + WINDOW_S, total_s)
        last = end >= total_s
        shifted = [shift_segment(s, start, end) for s in transcribe_window(start, end)]
        kept, next_start = plan_window(shifted, start, end, last=last)
        out.extend(kept)
        if last:
            break
        start = max(next_start, start + MIN_WINDOW_S)
    return out


# ---------- mlx-whisper ----------


def segment_from_whisper(raw: Mapping[str, Any], language: str | None) -> Segment:
    """Ein Abschnitt aus dem Ergebnis von `mlx_whisper.transcribe` (Zeiten relativ zum Fenster)."""
    words = tuple(
        Word(
            float(w.get("start", 0.0)),
            float(w.get("end", 0.0)),
            str(w.get("word", "")),
            float(w.get("probability", 0.0)),
        )
        for w in raw.get("words") or ()
    )

    def opt(key: str) -> float | None:
        value = raw.get(key)
        return None if value is None else float(value)

    return Segment(
        start=float(raw.get("start", 0.0)),
        end=float(raw.get("end", 0.0)),
        text=str(raw.get("text", "")),
        language=language,
        avg_logprob=opt("avg_logprob"),
        no_speech_prob=opt("no_speech_prob"),
        words=words,
    )


def decode_pcm16(audio: Path, timeout: float = DECODE_TIMEOUT_S) -> bytes:
    """Dekodiert nach s16le, 16 kHz, mono. Ohne Shell, mit Zeitlimit, nur Protokoll `file`,
    Eingabeformat fest (`full.m4a` ist MP4)."""
    args = [
        FFMPEG, "-nostdin", "-v", "error", "-protocol_whitelist", "file", "-f", "mov",
        "-i", str(audio), "-vn", "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "s16le", "-",
    ]  # fmt: skip
    try:
        done = subprocess.run(
            args, stdin=subprocess.DEVNULL, capture_output=True, timeout=timeout, check=False
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"ffmpeg: Zeitlimit von {int(timeout)} s überschritten") from exc
    except FileNotFoundError as exc:
        raise RuntimeError("ffmpeg nicht gefunden") from exc
    if done.returncode < 0:
        # Abbruch per Signal (Speicher, Neustart): kein Befund über die Datei, Retry nach §18.2
        raise RuntimeError(f"ffmpeg durch Signal {-done.returncode} beendet")
    if done.returncode != 0:
        raise AudioDecodeError(f"ffmpeg endete mit Code {done.returncode}")
    return done.stdout


def pcm_to_float(np: Any, pcm: bytes) -> Any:
    """s16le → float32 in [-1, 1) (numpy), wie `mlx_whisper.audio.load_audio`."""
    return np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0


@functools.cache
def _whisper_tokenizer() -> Any:
    from mlx_whisper.tokenizer import (  # type: ignore[import-not-found,unused-ignore]
        get_tokenizer,
    )

    return get_tokenizer(multilingual=True)


@dataclass
class MlxWhisperTranscriber:
    """`mlx-whisper` mit eigener Fensterschleife (Modul-Doku). Nur macOS arm64."""

    model: str = DEFAULT_WHISPER_MODEL
    provider: str = PROVIDER_MLX

    @staticmethod
    def _import() -> tuple[Any, Any]:
        try:
            import mlx_whisper  # type: ignore[import-not-found,unused-ignore]
            import numpy  # type: ignore[import-not-found,unused-ignore]
        except ImportError as exc:  # auch fehlende Abhängigkeiten von mlx
            raise TranscriberUnavailable(f"mlx_whisper nicht importierbar ({exc.name})") from exc
        return mlx_whisper, numpy

    def count_tokens(self, text: str) -> int:
        """Tokens des multilingualen Whisper-Tokenizers, so wie `mlx_whisper` den Hinweis
        kodiert (mit führendem Leerzeichen)."""
        self._import()
        return len(_whisper_tokenizer().encode(" " + text.strip()))

    def transcribe(
        self, audio: Path, *, language: str | None, initial_prompt: str | None, duration_ms: int
    ) -> list[Segment]:
        mlx_whisper, np = self._import()
        pcm = decode_pcm16(audio)  # s16le: 2 Bytes je Abtastwert
        total_s = len(pcm) / 2 / SAMPLE_RATE

        def window(start: float, end: float) -> list[Segment]:
            piece = pcm[2 * round(start * SAMPLE_RATE) : 2 * round(end * SAMPLE_RATE)]
            result = mlx_whisper.transcribe(
                pcm_to_float(np, piece),
                path_or_hf_repo=self.model,
                language=language,
                initial_prompt=initial_prompt,
                **WHISPER_OPTIONS,
            )
            detected = result.get("language") or language
            return [segment_from_whisper(s, detected) for s in result.get("segments") or ()]

        return windows_transcribe(total_s, window)


# ---------- Auswahl ----------


def make_transcriber(environ: Mapping[str, str] | None = None) -> Transcriber:
    """Transcriber laut `SG_TRANSCRIBER`. Unbekannter Wert: `TranscriberUnavailable`."""
    env = os.environ if environ is None else environ
    name = (env.get("SG_TRANSCRIBER") or DEFAULT_PROVIDER).strip()
    if name == PROVIDER_FAKE:
        return FakeTranscriber()
    if name == PROVIDER_MLX:
        return MlxWhisperTranscriber(model=env.get("SG_WHISPER_MODEL") or DEFAULT_WHISPER_MODEL)
    raise TranscriberUnavailable(f"unbekannter SG_TRANSCRIBER {name[:40]!r}")


def config_error(environ: Mapping[str, str] | None = None) -> str | None:
    """Fehlertext für das Startprotokoll, wenn `SG_TRANSCRIBER` unbekannt ist, sonst None."""
    try:
        make_transcriber(environ)
    except TranscriberUnavailable as exc:
        return str(exc)
    return None
