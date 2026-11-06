# Suche (⌘K) auf dem Mac testen

Mit ⌘K durchsuchst du deine Folien und das, was in der Vorlesung gesagt wurde, im Wortlaut und nach Bedeutung.
Die Bedeutungssuche nutzt das Modell `BAAI/bge-m3`. Es läuft lokal im Worker, Texte verlassen den Mac nicht. Aus dem Netz kommt nur einmal das Modell von Hugging Face.
Hintergrund: F-SUC-01, VERTRAEGE §19, PRs #162–#165.

> **Das Repo ist öffentlich.** Suchtexte, Folieninhalte oder Ausschnitte echter Vorlesungen nie in Issues, PRs oder Chats einfügen. Zum Melden reichen die Zahlen aus Abschnitt 5.

## Voraussetzungen

- Mac mit Apple Silicon (M1 oder neuer). Auf Intel-Macs und unter Linux gibt es nur die Wortsuche.
- Etwa 3 GB freier Platz: das Modell (≈ 2,3 GB) und zusätzliche Python-Pakete (`sentence-transformers`, `transformers`).
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

Beim ersten Start lädt der Worker das Modell selbst, im Hintergrund. Vorher laden ist besser, dann ist die Bedeutungssuche sofort bereit:

```bash
uv run --project services/worker python -c "from huggingface_hub import snapshot_download; print(snapshot_download('BAAI/bge-m3'))"
```

Das dauert je nach Leitung einige Minuten. Das Modell liegt danach in `~/.cache/huggingface/hub`.

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

## 4. Vorhandenes Material indizieren

Das passiert von selbst. Der Core holt beim Start und danach alle 10 Minuten nach, was noch nicht im Suchindex steht: alle verarbeiteten Foliensätze und alle Vorlesungen mit Transkript. Neue Foliensätze und neue Transkripte kommen ab jetzt automatisch dazu.

```bash
grep "Suchindex: Jobs nachgeholt" ~/StudienGehirn/logs/core.log | tail -3
```

Je Lauf werden höchstens 50 Foliensätze bzw. Vorlesungen angestoßen. Bei viel Material dauert der erste Durchgang also ein paar Läufe zu je 10 Minuten.

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
- Speicher des Prozesses `python` in der Aktivitätsanzeige, nachdem das Modell geladen ist

## Einstellungen (optional)

Ohne Eintrag gelten die Standardwerte. Nur zum Ändern in `~/StudienGehirn/config/.env`:

```
SG_EMBEDDER=bge-m3
SG_EMBED_MODEL=BAAI/bge-m3
SG_WORKER_PORT=4711
```

- `SG_EMBEDDER=fake` liefert erfundene Vektoren ohne Modell (für Tests, nicht für den Alltag).
- `SG_WORKER_PORT` ändern, falls Port 4711 schon belegt ist. Core und Worker lesen denselben Wert.

Core und Worker lesen die Datei nur beim Start: danach `pnpm sg stop` und `pnpm sg start`.

## Wenn etwas nicht klappt

| Zeichen | Ursache und Abhilfe |
|---|---|
| Keine Treffer, obwohl der Begriff auf einer Folie steht | Der Foliensatz ist noch nicht indiziert. Bis zu 10 Minuten warten (Abschnitt 4) oder Core neu starten |
| Immer „Nur Wortsuche“ | Worker-Log prüfen (Abschnitt 3). Häufig: Modell noch nicht geladen oder Download ohne Netz gescheitert |
| „Suche gerade nicht erreichbar“ | Der Core läuft nicht. `pnpm sg start` |
| `Loopback-Endpunkt` fehlt im Log | Port 4711 ist belegt (etwa ein zweiter Worker). `pnpm sg stop`, dann `pnpm sg start` |
