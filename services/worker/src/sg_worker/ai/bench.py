"""Laufzeit der Transkription messen (Spike S5), ohne Datenbank.

    uv run --project services/worker python -m sg_worker.ai.bench <audiodatei> [--language de]
        [--prompt "Vorlesung …"] [--show 5]

Nutzt den Transcriber laut `SG_TRANSCRIBER`/`SG_WHISPER_MODEL` (Standard `mlx-whisper`) und dieselbe
Nachbearbeitung wie der Job. Gibt Audiolänge, Laufzeit, Verhältnis und Zahl der Abschnitte aus.
Text erscheint nur mit `--show` (die ersten n Abschnitte), damit nichts ungewollt im Verlauf
landet. Das Audio verlässt den Rechner nicht.
"""

from __future__ import annotations

import argparse
import sys
import time
from collections.abc import Sequence
from pathlib import Path

from ..handlers.audio_finalize import FfmpegError, probe_duration_ms
from .postprocess import postprocess, recording_language
from .transcriber import make_transcriber


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="sg_worker.ai.bench", description=__doc__.split("\n")[0])
    parser.add_argument("audio", type=Path)
    parser.add_argument("--language", default=None, help="de, en oder leer für automatisch")
    parser.add_argument("--prompt", default=None, help="Vokabular-Hinweis (initial_prompt)")
    parser.add_argument("--show", type=int, default=0, help="die ersten n Abschnitte zeigen")
    args = parser.parse_args(argv)

    if not args.audio.is_file():
        print(f"Datei nicht gefunden: {args.audio}", file=sys.stderr)
        return 2
    try:
        duration_ms = probe_duration_ms(args.audio, args.audio.parent)
    except FfmpegError as exc:
        print(f"Audiolänge nicht lesbar: {exc}", file=sys.stderr)
        return 2
    transcriber = make_transcriber()
    started = time.monotonic()
    segments = transcriber.transcribe(
        args.audio, language=args.language, initial_prompt=args.prompt, duration_ms=duration_ms
    )
    took_s = time.monotonic() - started
    lang = recording_language(segments, args.language)
    rows = postprocess(segments, started_ms=0, language=lang)

    audio_min = duration_ms / 60_000
    print(f"Transcriber:  {transcriber.provider} ({transcriber.model})")
    print(f"Audio:        {audio_min:.1f} min")
    print(f"Laufzeit:     {took_s / 60:.1f} min")
    if took_s > 0:
        print(f"Faktor:       {duration_ms / 1000 / took_s:.1f}x Echtzeit")
        print(f"Hochgerechnet auf 90 min Audio: {took_s / 60 / max(audio_min, 1e-9) * 90:.1f} min")
    print(f"Sprache:      {lang or '-'}")
    print(f"Abschnitte:   {len(segments)} roh, {len(rows)} nach der Nachbearbeitung")
    print(f"Wörter:       {sum(r.word_count for r in rows)}")
    for row in rows[: max(0, args.show)]:
        print(f"  [{row.start_ms / 1000:7.1f} s] {row.text}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
