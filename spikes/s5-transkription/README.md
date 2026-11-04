# Spike S5 – Transkriptions-Benchmark (mlx-whisper)

Dieses Werkzeug misst für **Spike S5** (`R-03`, `F-AI-02`, `NF-01`), wie schnell und zuverlässig dein Mac eine **90-minütige deutschsprachige Vorlesung** lokal mit `mlx-whisper` (`mlx-community/whisper-large-v3-turbo`) transkribiert – inklusive Wort-Zeitstempeln, Anti-Halluzinations-Einstellungen und Wortfehlerrate (WER).

---

## 1. Einmalige Vorbereitung

Öffne das Terminal und prüfe bzw. installiere `ffmpeg` einmalig über Homebrew:

```bash
brew install ffmpeg
```

*(Alle weiteren Python-Abhängigkeiten wie `mlx-whisper==0.4.3` lädt `uv` beim Start automatisch in einer isolierten Umgebung herunter – du musst nichts im Projekt installieren.)*

**Wichtige Hinweise vor dem Start:**

- **Stromnetz:** Schließe deinen Mac während des Tests an das Ladegerät an.
- **Kein Ruhezustand:** Klappe den Mac-Deckel während des Laufs **nicht** zu.
- **Dauer:** Plane insgesamt **ca. 15 bis 30 Minuten** ein (beim allerersten Lauf lädt `mlx-whisper` einmalig das ~1,6 GB große Sprachmodell von HuggingFace herunter; der eigentliche Benchmark-Lauf dauert auf Apple Silicon typischerweise 5 bis 15 Minuten).

---

## 2. Benchmark starten

Führe den Befehl aus dem Hauptverzeichnis des Repositories (`WI-Webapp`) aus.

### Variante A: Automatischer Test mit synthetischer 90-Minuten-Vorlesung (Standard)

Wenn du keine eigene Audiodatei angibst, erzeugt das Skript aus `beispieltext.txt` (700 Wörter Mikroökonomie-Vorlesung) mit der macOS-Systemstimme (`say -v Anna`) und `ffmpeg` automatisch eine 90-minütige `.m4a`-Vorlesungsdatei inklusive 15-Sekunden-Stillephasen (Tafelanschrieb-Simulation) unter `~/StudienGehirn/spikes/s5/`:

```bash
uv run spikes/s5-transkription/s5.py
```

### Variante B: Test mit einer eigenen Vorlesungsaufnahme

Du kannst auch eine echte eigene Vorlesungsaufnahme (`.m4a`, `.mp3` oder `.wav`) übergeben. Die Datei bleibt ausschließlich lokal auf deinem Mac und wird **niemals** in das Git-Repository kopiert:

```bash
uv run spikes/s5-transkription/s5.py /pfad/zur/aufnahme.m4a
```

Optional kannst du bei einer eigenen Aufnahme eine Textdatei als Referenz für die Wortfehlerrate (WER) angeben:

```bash
uv run spikes/s5-transkription/s5.py /pfad/zur/aufnahme.m4a --referenz /pfad/zur/referenz.txt
```

---

## 3. Was wird gemessen und geprüft?

| Kriterium                       | Zielwert (`NF-01` / `F-AI-02`)     | Beschreibung                                                                        |
| ------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------- |
| **Echtzeitfaktor (RTF)**        | `< 0,167` (< 15 min für 90 min)    | Verhältnis aus Transkriptionszeit (`Wall-Clock`) und Audiodauer                     |
| **Peak-Speicherverbrauch (RSS)**| Dokumentiert für 8-GB-/16-GB-Gerät | Maximaler RAM-Bedarf des Prozesses (`ru_maxrss`)                                    |
| **Wort-Zeitstempel**            | Pflicht (`word_timestamps=True`)   | Jedes erkannte Wort besitzt `start`- und `end`-Zeitstempel für `F-SYN-02`           |
| **Halluzinations-Schutz**       | `0` Endlosschleifen in Stille      | Prüft `condition_on_previous_text=False` und `hallucination_silence_threshold=2.0`  |
| **Wortfehlerrate (WER)**        | `< 12 %` (Referenztext)            | Levenshtein-Distanz auf Wortebene (Ziffern- und Interpunktions-bereinigt)           |

---

## 4. Ergebnis an Claude übermitteln

Am Ende gibt das Skript im Terminal einen Block **`SPIKE S5 – ERGEBNISBERICHT`** aus und speichert zusätzlich alle Details unter:

- `~/StudienGehirn/spikes/s5/ergebnis-s5.txt` (Textbericht)
- `~/StudienGehirn/spikes/s5/ergebnis-s5.json` (Maschinenlesbare Messwerte + Transkript-Auszug)

Kopiere einfach den im Terminal ausgegebenen Block **`SPIKE S5 – ERGEBNISBERICHT`** und schicke ihn hier im Chat an Claude.

---

## 5. Kurz-Selbsttest (ohne Audio / ohne Modell-Download)

Um die Berechnungslogik (WER-Normalisierung, Halluzinations-Detektor, RTF-Auswertung und System-Checks) in unter einer Sekunde zu prüfen:

```bash
python3 spikes/s5-transkription/s5.py --selbsttest
```
