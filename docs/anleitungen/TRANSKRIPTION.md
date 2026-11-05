# Transkription auf dem Mac (mlx-whisper)

Nach dem Ende einer Session schreibt der Worker das Transkript der Aufnahmen (Job `transcribe`). Auf dem Mac nutzt er `mlx-whisper` mit dem Modell `whisper-large-v3-turbo`.
Das Audio verlässt den Mac nie. Aus dem Netz kommt nur einmal das Modell von Hugging Face.
Hintergrund: 05 §P4, VERTRAEGE §18.6, Spike S5, T2-02a (#145).

> **Das Repo ist öffentlich.** Transkripttexte, Folientitel oder Ausschnitte echter Vorlesungen nie in Issues, PRs oder Chats einfügen. Zum Melden reichen die Zahlen aus Abschnitt 4.

## Voraussetzungen

- Mac mit Apple Silicon (M1 oder neuer), macOS 14 oder neuer. Auf Intel-Macs und unter Linux wird `mlx-whisper` nicht installiert.
- `ffmpeg` (brauchst du schon für das Audio, `pnpm sg doctor` prüft es).
- Etwa 3 GB freier Platz: das Modell (≈ 1,6 GB) und die Python-Pakete (installiert etwa 1 GB, PyTorch allein ≈ 140 MB als Download).

## 1. Einmalig: Pakete installieren

Im Terminal im Repo-Ordner:

```bash
uv sync --project services/worker
```

Auf einem Apple-Silicon-Mac holt das `mlx-whisper` 0.4.3 mit seinen Abhängigkeiten (`mlx`, `numpy`, `numba`, `tiktoken`, PyTorch u. a.). Die Versionen stehen fest in `services/worker/uv.lock`.
`pnpm sg start` startet den Worker mit `uv run` und würde das beim ersten Start ebenfalls nachholen. Mit dem Befehl oben siehst du aber den Fortschritt.

Prüfen:

```bash
uv run --project services/worker python -c "import mlx_whisper; print(mlx_whisper.__version__)"
```

Erwartet: `0.4.3`.

## 2. Einmalig: Modell laden (≈ 1,6 GB)

Beim ersten `transcribe`-Job lädt `mlx-whisper` das Modell selbst. Vorher laden ist besser, dann misst die erste Transkription nicht den Download mit:

```bash
uv run --project services/worker python -c "from huggingface_hub import snapshot_download; print(snapshot_download('mlx-community/whisper-large-v3-turbo'))"
```

Das dauert je nach Leitung einige Minuten. Das Modell liegt danach in `~/.cache/huggingface/hub` und wird nicht noch einmal geladen.

## 3. Einstellungen (optional)

Ohne Eintrag gelten die Standardwerte. Nur zum Ändern in `~/StudienGehirn/config/.env` eintragen:

```
SG_TRANSCRIBER=mlx-whisper
SG_WHISPER_MODEL=mlx-community/whisper-large-v3-turbo
```

- `SG_TRANSCRIBER=fake` liefert erfundene Testabschnitte ohne Modell (für Tests, nicht für echte Vorlesungen).
- Ein anderer Wert ist ein Fehler: Der Worker schreibt beim Start `Transkription nicht verfügbar` ins Log, und `transcribe`-Jobs enden mit `fehler`.

Der Worker liest die Datei nur beim Start: danach `pnpm sg stop && pnpm sg start`.

## 4. Laufzeit messen (S5)

Ziel: **90 min Audio in höchstens 15 min.**

### a) Mit dem Messwerkzeug (ohne Datenbank)

Eine lange Aufnahme nehmen, am besten eine echte Vorlesung von etwa 90 min. Fertige Aufnahmen liegen unter `~/StudienGehirn/media/recordings/<id>/full.m4a`.

```bash
uv run --project services/worker python -m sg_worker.ai.bench ~/StudienGehirn/media/recordings/<id>/full.m4a --language de
```

Die Ausgabe zeigt Audiolänge, Laufzeit, Faktor gegenüber Echtzeit und die auf 90 min hochgerechnete Dauer. Text erscheint nur mit `--show 10` (die ersten 10 Abschnitte), etwa zum Prüfen der Qualität. Den Vokabular-Hinweis kannst du mit `--prompt "Vorlesung … Begriffe: … Folien: …."` mitgeben und so mit und ohne Hinweis vergleichen.

Während der Messung in der Aktivitätsanzeige beim Prozess `python` die Spalte „Speicher“ ansehen und den höchsten Wert notieren.

### b) Mit einem echten Job

Nach dem Ende einer Session mit Aufnahme läuft `transcribe` von selbst, sobald der Core die Kette anlegt (T2-02b). Die Laufzeit steht danach im Log:

```bash
grep "Aufnahme transkribiert" ~/StudienGehirn/logs/worker.log | tail -3
```

`audio_ms` ist die Länge der Aufnahme, `transcribe_ms` die Laufzeit (beides in Millisekunden).

### Ergebnis melden

Als Kommentar im Issue #145 (oder einem neuen Issue), **nur Zahlen**:

- Mac-Modell und Arbeitsspeicher, z. B. „MacBook Air M2, 16 GB“
- Audiolänge, Laufzeit, Faktor, Speicher-Spitze
- Mit oder ohne `--prompt`
- Eindruck zur Qualität in einem Satz, ohne Zitate („Fachbegriffe meist richtig“)

Liegt die Laufzeit über 15 min, ist das ein Ergebnis und kein Fehler. Dann entscheidet der Lead, ob ein kleineres Modell oder Stücke von 10 min nötig sind.

## Fehlerbilder

| Meldung (Job oder Log) | Ursache | Abhilfe |
|---|---|---|
| `Transkription nicht verfügbar: mlx_whisper nicht importierbar (…)` | Pakete fehlen oder Intel-Mac | Schritt 1 |
| `Transkription nicht verfügbar: unbekannter SG_TRANSCRIBER '…'` | Tippfehler in der `.env` | Schritt 3 |
| Job wiederholt sich und endet mit `fehler`, im Log ein Netzwerkfehler | Erster Modell-Download ohne Netz | Schritt 2, danach im Rückblick „Erneut versuchen“ |
| `Audio der Aufnahme <id> lässt sich nicht dekodieren` | `full.m4a` beschädigt | Audio neu erzeugen („Erneut versuchen“ ab Audio) |
