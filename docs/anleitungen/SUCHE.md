# Suche (⌘K) auf dem Mac testen

Mit ⌘K durchsuchst du deine Folien und das, was in der Vorlesung gesagt wurde, im Wortlaut und nach Bedeutung.
Die Bedeutungssuche nutzt das Modell `BAAI/bge-m3`. Es läuft lokal im Worker, Texte verlassen den Mac nicht. Aus dem Netz kommt nur einmal das Modell von Hugging Face.
Hintergrund: F-SUC-01, VERTRAEGE §19, PRs #162–#165.

> **Das Repo ist öffentlich.** Suchtexte, Folieninhalte oder Ausschnitte echter Vorlesungen nie in Issues, PRs oder Chats einfügen. Zum Melden reichen die Zahlen aus Abschnitt 5.

## Voraussetzungen

- Mac mit Apple Silicon (M1 oder neuer). Auf Intel-Macs und unter Linux gibt es nur die Wortsuche.
- Etwa 5 GB freier Platz: das Modell (≈ 2,3 GB), zusätzliche Python-Pakete (`sentence-transformers`, `transformers`) und etwas Reserve.
- Ein aktueller Stand: `git pull` im Repo-Ordner.

## 1. Einmalig: Pakete installieren

Im Terminal im Repo-Ordner:

```bash
uv sync --project services/worker
```

Prüfen:

```bash
uv run --project services/worker python -c "import sentence_transformers; print(sentence_transformers.__version__)"
```

Erwartet: `6.2.0`.

## 2. Einmalig: Modell laden (≈ 2,3 GB)

Beim ersten Start lädt der Worker das Modell selbst, im Hintergrund. Vorher laden ist besser, dann ist die Bedeutungssuche sofort bereit. Der Befehl lädt genau die Dateien, die der Worker braucht, und prüft gleich, ob sich das Modell öffnen lässt:

```bash
uv run --project services/worker python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('BAAI/bge-m3'); print('Modell bereit')"
```

Das dauert je nach Leitung einige Minuten und braucht etwas Arbeitsspeicher. Am Ende steht `Modell bereit`. Das Modell liegt danach in `~/.cache/huggingface/hub`.

## 3. Neu starten

```bash
pnpm sg stop
```

```bash
pnpm sg start
```

Danach im Worker-Log nachsehen, ob das Modell bereit ist:

```bash
grep -E "Embedder (bereit|nicht verfügbar)|Loopback-Endpunkt" ~/StudienGehirn/logs/worker.log | tail -3
```

- `Embedder bereit` mit `"device": "mps"` und `load_ms`: alles gut. Notiere `load_ms`.
- `Embedder nicht verfügbar`: Der Grund steht in der Zeile. Die Suche funktioniert dann trotzdem, aber nur im Wortlaut.
- `Loopback-Endpunkt gestartet`: Der Core kann den Worker für Suchanfragen erreichen.
- `Loopback-Endpunkt nicht gestartet …`: Achtung, das steckt auch „gestartet“ drin. Der Port ist belegt oder das Token ließ sich nicht schreiben. Die Suche läuft dann nur im Wortlaut (siehe Tabelle unten).

## 4. Vorhandenes Material indizieren

Das passiert von selbst. Der Core holt beim Start und danach alle 10 Minuten nach, was noch nicht im Suchindex steht: alle verarbeiteten Foliensätze und alle Vorlesungen mit Transkript. Neue Foliensätze und neue Transkripte kommen ab jetzt automatisch dazu.

```bash
grep "Suchindex: Jobs nachgeholt" ~/StudienGehirn/logs/core.log | tail -3
```

Bleibt die Ausgabe leer, gibt es nichts nachzuholen, oder der Core läuft noch nicht lange (er legt die Jobs beim Start und danach alle 10 Minuten an).

Je Lauf werden höchstens 50 Foliensätze bzw. Vorlesungen angestoßen. Bei viel Material dauert der erste Durchgang also ein paar Läufe zu je 10 Minuten.

Wurde Material indiziert, bevor das Modell bereit war, läuft es automatisch noch einmal durch, sobald das Modell bereit ist. Dann ist es auch nach Bedeutung auffindbar.

## 5. Ausprobieren und messen

In der Web-App ⌘K drücken (oder unten links auf „Suche“).

1. **Ein Begriff von einer Folie:** Er erscheint unter „Folien“. Enter öffnet den Foliensatz auf der richtigen Seite.
2. **Ein Begriff, den der Prof nur gesagt hat:** Er erscheint unter „Gesagtes“ mit Zeit. Enter öffnet den Rückblick an dieser Stelle (ohne automatisch abzuspielen).
3. **Halb getippt:** Treffer erscheinen schon beim Tippen, etwa bei `normalisie`.
4. **Nach Bedeutung:** Suche mit anderen Worten als auf der Folie, etwa ein Synonym oder die englische Übersetzung. Sinnvolle Treffer zeigen, dass die Bedeutungssuche arbeitet.
5. **Filter:** `fach:<Kürzel> begriff` sucht nur in einem Fach, `typ:folie` bzw. `typ:gesagtes` nur in einer Art.
6. **Während einer Vorlesung:** ⌘K im Live-Dashboard öffnet die Suche über der Notizen-Spalte. Tippen darf die Aufnahme nicht beeinflussen, Enter öffnet einen neuen Tab.

Steht unten in der Suche „Nur Wortsuche · Bedeutungssuche startet noch“, lädt das Modell noch. Steht dort „… nicht verfügbar“, siehe Abschnitt 3.

**Bitte melden** (nur Zahlen und ja/nein, keine Inhalte):
- `load_ms` aus dem Log (Abschnitt 3)
- Fühlt sich die Suche beim Tippen sofort an? (Ziel: erste Ergebnisse unter 0,3 s)
- Klappen die Punkte 1 bis 6 jeweils (ja/nein)?
- Speicher in der Aktivitätsanzeige, nachdem das Modell geladen ist: der höchste Wert der Spalte „Speicher“ unter allen `python`-Prozessen

## Einstellungen (optional)

Ohne Eintrag gelten die Standardwerte. Nur zum Ändern in `~/StudienGehirn/config/.env`:

```
SG_EMBEDDER=bge-m3
SG_EMBED_MODEL=BAAI/bge-m3
SG_WORKER_PORT=4711
SG_WORKER_NICE=10
SG_EMBED_THREADS=4
SG_EMBED_PAUSE_MS=75
```

- `SG_EMBEDDER=fake` liefert erfundene Vektoren ohne Modell (für Tests, nicht für den Alltag).
- `SG_WORKER_PORT` ändern, falls Port 4711 schon belegt ist. Core und Worker lesen denselben Wert.
- `SG_WORKER_NICE` (0 bis 19, Standard 10): So weit senkt der Worker beim Start seine Priorität, damit andere Programme Vorrang haben. `0` schaltet das ab.
- `SG_EMBED_THREADS` (Standard: die Hälfte der Kerne, mindestens 1): So viele Prozessor-Threads nutzt das Modell.
- `SG_EMBED_PAUSE_MS` (0 bis 5000, Standard 75): Pause in Millisekunden zwischen zwei Stapeln beim Aufbau des Suchindex. Die Suche selbst (⌘K) wird nie gebremst.

**Macs mit 8 GB:** Die Standardwerte sind dafür gewählt. Das Modell lädt auf Apple-Chips mit halber Genauigkeit (fp16, etwa 1,1 statt 2,3 GB), die Treffer bleiben praktisch gleich. Ruckelt der Mac trotzdem, während der Index entsteht, `SG_EMBED_PAUSE_MS=250` und `SG_EMBED_THREADS=2` setzen. Der Index braucht dann länger, die Suche bleibt gleich schnell.

Core und Worker lesen die Datei nur beim Start: danach `pnpm sg stop` und `pnpm sg start`.

## Wenn etwas nicht klappt

| Zeichen | Ursache und Abhilfe |
|---|---|
| Keine Treffer, obwohl der Begriff auf einer Folie steht | Der Foliensatz ist noch nicht indiziert. Bis zu 10 Minuten warten (Abschnitt 4) oder Core neu starten |
| Immer „Nur Wortsuche“ | Worker-Log prüfen (Abschnitt 3). Häufig: Modell noch nicht geladen oder Download ohne Netz gescheitert |
| „Suche gerade nicht erreichbar“ | Der Core läuft nicht oder ist nicht erreichbar. `pnpm sg doctor` zeigt, was fehlt, dann `pnpm sg start` |
| `Loopback-Endpunkt nicht gestartet` im Log oder die Zeile fehlt | Port 4711 ist belegt (etwa ein zweiter Worker), oder in `SG_WORKER_PORT` steht ein anderer Port. `pnpm sg stop`, dann `pnpm sg start` |
