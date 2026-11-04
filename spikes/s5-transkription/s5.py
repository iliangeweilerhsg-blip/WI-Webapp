#!/usr/bin/env python3
# /// script
# requires-python = "==3.12.*"
# dependencies = [
#   "mlx-whisper==0.4.3",
# ]
# ///
"""Spike S5: Lokale 90-Minuten-Transkription mit mlx-whisper (whisper-large-v3-turbo) auf Apple Silicon.

Aufruf:
    uv run spikes/s5-transkription/s5.py [audiodatei]
    python3 spikes/s5-transkription/s5.py --selbsttest

Alle temporären Audiodateien und Transkripte werden ausschließlich außerhalb des Repos
unter ~/StudienGehirn/spikes/s5/ abgelegt.
"""

from __future__ import annotations

import argparse
import datetime
import json
import math
import os
import platform
import re
import resource
import shutil
import subprocess
import sys
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
BEISPIELTEXT_PFAD = SCRIPT_DIR / "beispieltext.txt"
SCRATCH_DIR = Path.home() / "StudienGehirn" / "spikes" / "s5"
HF_MODEL_REPO = "mlx-community/whisper-large-v3-turbo"
ZIEL_DAUER_SEKUNDEN = 5400.0  # Genau 90 Minuten (5400 s)
GRENZWERT_LOKAL_MIN = 15.0    # <= 15 min laut 10-UMSETZUNG.md §4 / 09-NFA.md §1
GRENZWERT_GRENZWERTIG_MIN = 22.5


def normalize_words(text: str) -> list[str]:
    """Normalisiert einen Text in kleingeschriebene Wort-Tokens ohne Satzzeichen für die WER-Berechnung."""
    cleaned = re.sub(r"[^\w\sÄÖÜäöüß]", " ", text.lower(), flags=re.UNICODE)
    cleaned = cleaned.replace("_", " ")
    return [w for w in cleaned.split() if w]


def compute_wer(reference_text: str, hypothesis_text: str) -> tuple[float, int, int]:
    """Berechnet die Wortfehlerrate (WER) per Levenshtein-Distanz auf Wortebene ohne Zusatzbibliothek.

    Gibt `(wer_float, edit_distance, ref_word_count)` zurück.
    Speichereffizient in O(min(N, M)) Speicher implementiert.
    """
    ref = normalize_words(reference_text)
    hyp = normalize_words(hypothesis_text)
    if not ref:
        return (0.0 if not hyp else 1.0), len(hyp), 0

    n = len(ref)
    m = len(hyp)
    prev_row = list(range(m + 1))
    curr_row = [0] * (m + 1)

    for i in range(1, n + 1):
        curr_row[0] = i
        ref_w = ref[i - 1]
        for j in range(1, m + 1):
            cost = 0 if ref_w == hyp[j - 1] else 1
            curr_row[j] = min(
                prev_row[j] + 1,          # Löschung
                curr_row[j - 1] + 1,      # Einfügung
                prev_row[j - 1] + cost,   # Ersetzung / Treffer
            )
        prev_row, curr_row = curr_row, prev_row

    dist = prev_row[m]
    return dist / n, dist, n


def check_apple_silicon() -> tuple[bool, str]:
    """Prüft, ob das System macOS auf Apple Silicon (arm64) ist."""
    sys_name = platform.system()
    machine = platform.machine()
    if sys_name != "Darwin":
        return (
            False,
            f"Abbruch: Spike S5 benötigt macOS auf Apple Silicon (erkannt: {sys_name} / {machine}). "
            "mlx-whisper nutzt Apples Metal-GPU und läuft nicht unter Linux/Windows.",
        )
    if machine != "arm64":
        return (
            False,
            f"Abbruch: Spike S5 benötigt einen Mac mit Apple Silicon arm64 (erkannt: {machine}).",
        )
    return True, "OK"


def get_mac_hardware_info() -> dict[str, str]:
    """Liest Mac-Modellname (ohne Seriennummer!), Chip und Gesamtspeicher sowie macOS-Version aus."""
    chip = "Unbekannt"
    try:
        res = subprocess.run(
            ["sysctl", "-n", "machdep.cpu.brand_string"],
            capture_output=True,
            text=True,
            check=False,
            timeout=5,
        )
        if res.returncode == 0 and res.stdout.strip():
            chip = res.stdout.strip()
    except Exception:
        pass

    model_name = "Mac"
    ram_str = "Unbekannt"
    try:
        res = subprocess.run(
            ["system_profiler", "SPHardwareDataType"],
            capture_output=True,
            text=True,
            check=False,
            timeout=10,
        )
        if res.returncode == 0:
            m_name = ""
            m_ident = ""
            for line in res.stdout.splitlines():
                s = line.strip()
                if s.startswith("Model Name:"):
                    m_name = s.split(":", 1)[1].strip()
                elif s.startswith("Model Identifier:"):
                    m_ident = s.split(":", 1)[1].strip()
                elif s.startswith("Memory:"):
                    ram_str = s.split(":", 1)[1].strip()
            if m_name and m_ident:
                model_name = f"{m_name} ({m_ident})"
            elif m_name or m_ident:
                model_name = m_name or m_ident
    except Exception:
        pass

    macos_ver = platform.mac_ver()[0] or platform.release()
    return {
        "model": model_name,
        "chip": chip,
        "ram": ram_str,
        "macos": macos_ver,
    }


def get_peak_rss_mb() -> float:
    """Liest den bisherigen Spitzen-RAM-Verbrauch (Maximum Resident Set Size) in MiB aus."""
    ru = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    # Auf macOS liefert ru_maxrss Bytes, auf Linux Kilobytes
    if platform.system() == "Darwin":
        return ru / (1024.0 * 1024.0)
    return ru / 1024.0


def find_german_voice() -> str:
    """Sucht die deutsche macOS-Systemstimme 'Anna' oder eine andere installierte de_DE/de_CH-Stimme."""
    try:
        res = subprocess.run(
            ["say", "-v", "?"],
            capture_output=True,
            text=True,
            check=True,
            timeout=10,
        )
    except Exception as exc:
        raise RuntimeError(f"Das macOS-Werkzeug 'say' konnte nicht ausgeführt werden: {exc}") from exc

    german_voices: list[str] = []
    for line in res.stdout.splitlines():
        match = re.match(r"^(.+?)\s+(de_[A-Z]{2})\s+#", line)
        if match:
            v_name = match.group(1).strip()
            if v_name == "Anna":
                return "Anna"
            german_voices.append(v_name)

    if german_voices:
        return german_voices[0]
    raise RuntimeError(
        "Keine deutsche Systemstimme für 'say' gefunden. Bitte in den macOS-Systemeinstellungen -> "
        "Bedienungshilfen -> Gesprochener Inhalt -> Systemstimme 'Anna (Deutsch)' laden."
    )


def probe_audio_duration(audio_path: Path) -> float:
    """Ermittelt die Dauer einer Audiodatei in Sekunden über ffprobe oder ffmpeg."""
    ffprobe_bin = shutil.which("ffprobe")
    if ffprobe_bin:
        res = subprocess.run(
            [
                ffprobe_bin,
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(audio_path),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if res.returncode == 0 and res.stdout.strip():
            return float(res.stdout.strip())

    ffmpeg_bin = shutil.which("ffmpeg")
    if not ffmpeg_bin:
        raise RuntimeError("Weder ffprobe noch ffmpeg im PATH gefunden.")
    res = subprocess.run(
        [ffmpeg_bin, "-i", str(audio_path)],
        capture_output=True,
        text=True,
        check=False,
    )
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", res.stderr)
    if not m:
        raise RuntimeError(f"Konnte Audiodauer von {audio_path} nicht bestimmen.")
    h, mins, secs = int(m.group(1)), int(m.group(2)), float(m.group(3))
    return h * 3600.0 + mins * 60.0 + secs


def build_synthetic_audio(
    target_dir: Path,
    target_duration_sec: float = ZIEL_DAUER_SEKUNDEN,
) -> tuple[Path, str, str]:
    """Erzeugt mit `say` und `ffmpeg` eine synthetische deutsche Vorlesungsaufnahme von exakt `target_duration_sec`.

    Gibt `(pfad_zur_audiodatei, erwarteter_volltext, verwendete_stimme)` zurück.
    """
    if not shutil.which("ffmpeg"):
        raise RuntimeError(
            "Das Programm 'ffmpeg' fehlt auf diesem Mac.\n"
            "Bitte einmalig im Terminal installieren mit:\n"
            "    brew install ffmpeg"
        )

    if not BEISPIELTEXT_PFAD.exists():
        raise RuntimeError(f"Beispieltext nicht gefunden: {BEISPIELTEXT_PFAD}")

    base_text = BEISPIELTEXT_PFAD.read_text(encoding="utf-8").strip()
    voice = find_german_voice()
    target_dir.mkdir(parents=True, exist_ok=True)

    block_aiff = target_dir / "s5_redeblock_5min.aiff"
    block_wav = target_dir / "s5_redeblock_16k.wav"
    silence_wav = target_dir / "s5_pause_15s_16k.wav"
    concat_list = target_dir / "s5_concat.txt"
    out_m4a = target_dir / f"s5_synthetisch_{int(target_duration_sec)}s.m4a"

    print(f"[1/4] Erzeuge deutschen Vorlesungsblock mit macOS-Stimme '{voice}' ...")
    subprocess.run(
        ["say", "-v", voice, "-r", "150", "-f", str(BEISPIELTEXT_PFAD), "-o", str(block_aiff)],
        check=True,
    )

    # Konvertiere den Sprachblock nach 16 kHz Mono PCM WAV
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-loglevel",
            "error",
            "-i",
            str(block_aiff),
            "-ar",
            "16000",
            "-ac",
            "1",
            str(block_wav),
        ],
        check=True,
    )
    block_dur = probe_audio_duration(block_wav)
    if block_dur <= 1.0:
        raise RuntimeError(f"Erzeugter Sprachblock ist zu kurz ({block_dur:.2f} s).")

    # Erzeuge 15 s Stille (simuliert Tafelanschrieb / Vorlesungspause für Halluzinations-Check)
    pause_dur = 15.0
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "anullsrc=r=16000:cl=mono",
            "-t",
            str(pause_dur),
            "-ar",
            "16000",
            "-ac",
            "1",
            str(silence_wav),
        ],
        check=True,
    )

    cycle_dur = block_dur + pause_dur
    full_cycles = max(1, int(math.ceil(target_duration_sec / cycle_dur)))

    # Berechne auch den erwarteten Referenztext für die exakte Dauer `target_duration_sec`
    base_words = normalize_words(base_text)
    expected_words_all: list[str] = []
    remaining = target_duration_sec
    concat_lines: list[str] = []

    for _ in range(full_cycles):
        concat_lines.append(f"file '{block_wav.name}'")
        concat_lines.append(f"file '{silence_wav.name}'")
        if remaining >= block_dur:
            expected_words_all.extend(base_words)
            remaining -= block_dur
        elif remaining > 0:
            frac = remaining / block_dur
            take_n = max(1, int(round(len(base_words) * frac)))
            expected_words_all.extend(base_words[:take_n])
            remaining = 0.0
        remaining = max(0.0, remaining - pause_dur)

    concat_list.write_text("\n".join(concat_lines) + "\n", encoding="utf-8")

    print(
        f"[2/4] Baue mit ffmpeg Vorlesungsdatei von exakt {target_duration_sec / 60.0:.1f} min "
        f"(inkl. 15-s-Stillephasen) -> {out_m4a} ..."
    )
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-loglevel",
            "error",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_list),
            "-t",
            f"{target_duration_sec:.3f}",
            "-c:a",
            "aac",
            "-b:a",
            "48k",
            "-ar",
            "16000",
            "-ac",
            "1",
            str(out_m4a),
        ],
        check=True,
    )

    # Räume temporäre WAV/AIFF-Zwischendateien auf, um Plattenplatz zu sparen
    for tmp_f in (block_aiff, block_wav, silence_wav, concat_list):
        tmp_f.unlink(missing_ok=True)

    return out_m4a, " ".join(expected_words_all), voice


def classify_runtime(transcribe_sec: float, audio_sec: float) -> str:
    """Klassifiziert die gemessene Laufzeit auf 90-Minuten-Äquivalent skaliert."""
    if audio_sec <= 0:
        return "unbekannt"
    projected_90min_sec = transcribe_sec * (ZIEL_DAUER_SEKUNDEN / audio_sec)
    projected_min = projected_90min_sec / 60.0
    if projected_min <= GRENZWERT_LOKAL_MIN:
        return f"lokal geeignet (<= 15 min; hochgerechnet auf 90 min: {projected_min:.2f} min)"
    if projected_min <= GRENZWERT_GRENZWERTIG_MIN:
        return f"grenzwertig (15–22,5 min; hochgerechnet auf 90 min: {projected_min:.2f} min)"
    return f"zu langsam (> 22,5 min; hochgerechnet auf 90 min: {projected_min:.2f} min)"


def run_selftest() -> int:
    """Führt plattformunabhängige Unit-Tests für Normalisierung, WER, Laufzeit-Bewertung und Argument-Parser aus."""
    print("Starte Selbsttest (--selbsttest) ...")

    # 1. Text-Normalisierung
    norm = normalize_words("Marktgleichgewicht, Preis-Elastizität & 3NF!")
    assert norm == ["marktgleichgewicht", "preis", "elastizität", "3nf"], f"Unerwartet: {norm}"

    # 2. WER-Berechnung: identisch -> 0.0
    wer0, dist0, n0 = compute_wer("Das Marktgleichgewicht ist stabil.", "das marktgleichgewicht ist stabil")
    assert wer0 == 0.0 and dist0 == 0 and n0 == 4, f"WER0 fehlgeschlagen: {wer0}, {dist0}, {n0}"

    # 3. WER-Berechnung: 1 Ersetzung + 1 Einfügung bei 4 Referenzwörtern -> Distanz 2 -> WER 0.5
    wer_half, dist2, n4 = compute_wer("eins zwei drei vier", "eins ZWO drei vier fünf")
    assert abs(wer_half - 0.5) < 1e-9 and dist2 == 2 and n4 == 4, f"WER 0.5 fehlgeschlagen: {wer_half}"

    # 4. Beispieltext-Prüfung (~700 Wörter)
    assert BEISPIELTEXT_PFAD.exists(), f"Fehlt: {BEISPIELTEXT_PFAD}"
    words_beispiel = normalize_words(BEISPIELTEXT_PFAD.read_text(encoding="utf-8"))
    assert 600 <= len(words_beispiel) <= 850, f"Wortanzahl außerhalb Zielbereich: {len(words_beispiel)}"

    # 5. Klassifikationslogik
    assert classify_runtime(600.0, 5400.0).startswith("lokal geeignet")
    assert classify_runtime(1080.0, 5400.0).startswith("grenzwertig")
    assert classify_runtime(1800.0, 5400.0).startswith("zu langsam")

    print(
        f"[OK] Selbsttest erfolgreich: Normalisierung, WER-Levenshtein, Beispieltext ({len(words_beispiel)} Wörter) "
        "und Schwellenwert-Bewertung geprüft."
    )
    return 0


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Spike S5: Benchmark für lokale 90-min-Vorlesungstranskription mit mlx-whisper."
    )
    parser.add_argument(
        "audiodatei",
        nargs="?",
        help="Optionaler Pfad zu einer eigenen Vorlesungsaufnahme (z. B. .m4a, .mp3, .wav). "
        "Ohne Angabe wird automatisch eine 90-minütige synthetische Vorlesung erzeugt.",
    )
    parser.add_argument(
        "--dauer-minuten",
        type=float,
        default=90.0,
        help="Dauer des synthetisch erzeugten Testaudios in Minuten (Standard: 90).",
    )
    parser.add_argument(
        "--selbsttest",
        action="store_true",
        help="Führt die eingebauten Unit-Tests (WER, Textaufbereitung, Argumente) aus und beendet sich.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.selbsttest:
        return run_selftest()

    ok_arch, arch_msg = check_apple_silicon()
    if not ok_arch:
        print(arch_msg, file=sys.stderr)
        return 1

    if not shutil.which("ffmpeg"):
        print(
            "FEHLER: 'ffmpeg' wurde nicht gefunden (wird von mlx-whisper zum Audio-Laden benötigt).\n"
            "Bitte einmalig im Terminal installieren mit:\n"
            "    brew install ffmpeg",
            file=sys.stderr,
        )
        return 1

    SCRATCH_DIR.mkdir(parents=True, exist_ok=True)
    hw = get_mac_hardware_info()

    is_synthetic = args.audiodatei is None
    reference_text = ""
    voice_used = "-"

    if is_synthetic:
        target_sec = max(10.0, float(args.dauer_minuten) * 60.0)
        try:
            audio_path, reference_text, voice_used = build_synthetic_audio(SCRATCH_DIR, target_sec)
        except Exception as exc:
            print(f"FEHLER bei der Audio-Erzeugung: {exc}", file=sys.stderr)
            return 1
    else:
        audio_path = Path(args.audiodatei).expanduser().resolve()
        if not audio_path.exists():
            print(f"FEHLER: Audiodatei nicht gefunden: {audio_path}", file=sys.stderr)
            return 1
        print(f"[1/4] Verwende angegebene Audiodatei (bleibt lokal, wird nicht kopiert): {audio_path}")

    audio_duration_sec = probe_audio_duration(audio_path)

    # Schritt 3: Modell-Download / Bereitstellung separat messen
    print(f"[3/4] Prüfe / lade Modell '{HF_MODEL_REPO}' (beim ersten Mal ca. 1,6 GB Download) ...")
    t_dl_start = time.perf_counter()
    try:
        from huggingface_hub import snapshot_download  # Kommt über mlx-whisper mit

        model_local_dir = snapshot_download(repo_id=HF_MODEL_REPO)
    except Exception:
        model_local_dir = HF_MODEL_REPO
    download_sec = time.perf_counter() - t_dl_start

    # Schritt 4: Transkription mit den empfohlenen Parametern aus RECHERCHE-SPIKES.md (S5)
    print(
        f"[4/4] Starte lokale Transkription ({audio_duration_sec / 60.0:.1f} min Audio) auf Metal/GPU ...\n"
        "      Bitte den Mac am Strom lassen und nicht zuklappen."
    )
    import mlx_whisper

    vocab_prompt = (
        "Vorlesung Mikroökonomie, Wirtschaftsinformatik, Marktgleichgewicht, "
        "Preiselastizität, Konsumentenrente, Produzentenrente, Harberger-Dreieck, Steuerinzidenz."
    )

    t_trans_start = time.perf_counter()
    result = mlx_whisper.transcribe(
        str(audio_path),
        path_or_hf_repo=model_local_dir,
        language="de",
        word_timestamps=True,
        condition_on_previous_text=False,
        hallucination_silence_threshold=2.0,
        no_speech_threshold=0.6,
        compression_ratio_threshold=2.4,
        initial_prompt=vocab_prompt,
    )
    transcribe_sec = time.perf_counter() - t_trans_start
    peak_ram_mb = get_peak_rss_mb()

    transcript_text = str(result.get("text", "")).strip()
    segments = result.get("segments", [])
    rtf = audio_duration_sec / max(0.001, transcribe_sec)
    bewertung = classify_runtime(transcribe_sec, audio_duration_sec)

    wer_str = "nicht anwendbar (eigene Audiodatei ohne Referenztranskript)"
    if is_synthetic and reference_text:
        wer_val, edit_dist, ref_len = compute_wer(reference_text, transcript_text)
        wer_str = f"{wer_val * 100.0:.2f} % (Distanz {edit_dist} bei {ref_len} Referenzwörtern)"

    ts_label = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    out_txt = SCRATCH_DIR / f"transkript-{ts_label}.txt"
    out_json = SCRATCH_DIR / f"transkript-{ts_label}.json"
    out_txt.write_text(transcript_text + "\n", encoding="utf-8")
    out_json.write_text(
        json.dumps(
            {
                "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "hardware": hw,
                "audio_duration_sec": round(audio_duration_sec, 2),
                "download_sec": round(download_sec, 2),
                "transcribe_sec": round(transcribe_sec, 2),
                "realtime_factor": round(rtf, 2),
                "peak_ram_mb": round(peak_ram_mb, 1),
                "segment_count": len(segments),
                "wer": wer_str,
                "result": bewertung,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    print("\n" + "=" * 74)
    print("SPIKE S5 – ERGEBNISBERICHT (bitte komplett kopieren und an Claude senden)")
    print("=" * 74)
    print(f"Datum / Uhrzeit:         {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Mac-Modell:              {hw['model']}")
    print(f"Chip:                    {hw['chip']}")
    print(f"Arbeitsspeicher (Mac):   {hw['ram']}")
    print(f"macOS-Version:           {hw['macos']}")
    print(f"Modell:                  {HF_MODEL_REPO} (mlx-whisper==0.4.3)")
    print(
        f"Audio-Quelle:            {'Synthetisch (say -v ' + voice_used + ' + Stillephasen)' if is_synthetic else 'Eigene Audiodatei (lokal)'}"
    )
    print(f"Audiodauer:              {audio_duration_sec / 60.0:.2f} min ({audio_duration_sec:.1f} s)")
    print(f"Modell-Download/-Check:  {download_sec:.1f} s")
    print(f"Transkriptionsdauer:     {transcribe_sec / 60.0:.2f} min ({transcribe_sec:.1f} s)")
    print(f"Echtzeitfaktor (RTF):    {rtf:.1f}x Echtzeit")
    print(f"Spitzen-RAM (Prozess):   {peak_ram_mb:.0f} MiB ({peak_ram_mb / 1024.0:.2f} GiB)")
    print(f"Erkannte Segmente:       {len(segments)}")
    print(f"Wortfehlerrate (WER):    {wer_str}")
    print(f"Bewertung (Ziel <=15m):  {bewertung}")
    print(f"Gespeichertes Transkript:{out_txt}")
    print("=" * 74)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
