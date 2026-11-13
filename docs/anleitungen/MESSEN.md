# Abnahme messen (Phase 2)

Drei Werkzeuge messen die Zahlen, die in `docs/spezifikation/10-UMSETZUNG.md` §3 für Phase 2 verlangt sind:

| Ziel | Werkzeug | Wo es läuft |
|---|---|---|
| ⌘K antwortet in < 300 ms | Lasttest `lasttest-suche.ts` | eigene Test-Datenbank, erfundene Daten |
| Pipeline je Session ≤ 45 min | `pnpm sg messen pipeline` | deine echten Daten, nur lesend |
| Ausrichtung ≥ 85 % gegen den goldenen Datensatz | `pnpm sg messen ausrichtung` | deine echten Daten, nur lesend |

> **Das Repo ist öffentlich.** Die Werkzeuge zeigen Modulnamen, Session-IDs und Zeiten deiner Vorlesungen. Zum Melden im Issue oder PR reichen die Zahlen (p50, p95, Gesamtzeit, Prozent). Die goldene Datei enthält nur Folien­nummern und Zeiten, trotzdem nicht ins Repo legen.

## 1. Lasttest ⌘K (< 300 ms)

Der Lasttest ruft `GET /api/v1/search` auf, so wie ⌘K es tut, und misst die Antwortzeit.

**Er arbeitet nie mit deinen Daten.** Er legt auf dem Datenbank-Server eine eigene Datenbank `sg_perf_…` an, füllt sie mit erfundenen Daten und löscht sie am Ende. Der Server muss laufen (`pnpm sg start` oder ein anderer Postgres mit der Erweiterung `vector`). Der Benutzer in `DATABASE_URL` muss Datenbanken anlegen dürfen (der Benutzer `sg` aus dem Docker-Setup darf das).

```bash
DATABASE_URL=postgres://sg:sg@127.0.0.1:5432/postgres node services/core/test/perf/lasttest-suche.ts
```

Die Datenbank in der URL (hier `postgres`) dient nur zum Anmelden. Es wird dort nichts gelesen oder geändert.

**Datenmenge** (Standard, `--faktor 1`): die Menge aus der Anforderung (`docs/spezifikation/09-NFA.md`: 5 000 Folien, 200 h Transkript), erfunden. 2 Semester, 10 Module, 125 Foliensätze mit 40 Folien (5 000 Folien), 134 Sessions mit je 90 Fenstern à 60 s (12 060 Einträge Gesagtes, 201 h). Konzepte sind nicht im Suchindex und darum nicht Teil des Tests.

**Anfragen** (13, in `services/core/test/perf/daten.ts`): Präfixe (`nor`, `ver`), kurze Begriffe, lange Mehrwort-Anfragen, Filter (`fach:`, `typ:`). Jede Anfrage läuft 3 Mal zum Aufwärmen und danach 40 Mal.

**Optionen**

- `--faktor <x>`: Datenmenge, `0.1` für einen schnellen Probelauf, `2` für die doppelte Menge (Reserve).
- `--laeufe <n>`: Messungen je Anfrage (mindestens 5).

**Ausgabe:** je Anfrage p50, p95 und Maximum, dann je Art und für alle zusammen. Das Ziel gilt als erreicht, wenn p95 über alle Anfragen **und** p95 jeder einzelnen Anfrage unter 300 ms liegen. Der Exit-Code ist 0 (erreicht), 2 (verfehlt) oder 1 (Fehler).

**Dauer:** das Füllen samt Index braucht einige Minuten, die Messung selbst Sekunden.

**Was gemessen wird:** die ganze Route im Core ohne Browser und Netz (Prüfung, Suche, Antwort, JSON). Das Embedding der Anfrage liefert ein Stub mit festen Vektoren, die echte Bedeutungssuche im Worker (bge-m3) kommt also nicht dazu. Im Alltag kommt die Zeit des Embeddings (Zeitlimit 800 ms) obendrauf. Fällt es aus, antwortet ⌘K nur mit der Wortsuche.

Der Lasttest läuft nicht in der CI und wird nicht mit `pnpm test` gestartet.

## 2. Laufzeit je Session (≤ 45 min)

```bash
pnpm sg messen pipeline                  # die letzten 10 Sessions mit Verarbeitung
pnpm sg messen pipeline --letzte 3
pnpm sg messen pipeline --session <id>   # eine Session (UUID der Session; ohne `--session` zeigt die Ausgabe sie hinter jeder Session)
```

Der Befehl liest nur (eine schreibgeschützte Abfrage über `psql`, wie `backup`). Die Datenbank muss laufen.

Beispiel (erfundene Zahlen):

```
Session M1 · Nr. 4 · 2026-11-10 (0198f3a2-1111-7000-8000-000000000001)
  Schritt           Zustand  Laufzeit    Wartezeit  Dauer
  audio.finalize    fertig   40 s        20 s       1 min 00 s
  transcribe        fertig   9 min 00 s  1 min 00 s 10 min 00 s
  align.log         fertig   5 s         10 s       15 s
  concepts.extract  fertig   –           –          ~3 min 00 s
  concepts.resolve  fertig   –           –          ~1 min 10 s
  summary.write     fertig   –           –          ~2 min 10 s
  Gesamt: 17 min 35 s (Ziel ≤ 45 min: erreicht)
```

**Wie die Zeiten entstehen.** Die Tabelle `job` kennt keinen Startzeitpunkt. Darum gilt:

- **Gesamt** = Ende des letzten Schritts minus Anlegen des ersten Jobs. Das ist die Zahl für das Ziel. Sie umfasst alle Schritte der Kette (`audio.finalize`, `transcribe`, `align.log`, `concepts.extract`, `concepts.resolve`, `summary.write`). `search.index` gehört nicht dazu, es hält die Session nicht auf.
- **Dauer** = Ende des Schritts minus „bereit“ (Job angelegt, Wartezeit nach einem Fehlversuch vorbei, Vorgänger fertig). Sie enthält die Zeit, die der Job auf den Worker wartete.
- **Laufzeit** meldet der Worker nur für `audio.finalize`, `transcribe` und `align.log` (`job_duration_ms`). Nur dort lässt sich die **Wartezeit** abtrennen (Dauer minus Laufzeit). Bei den übrigen Schritten steht `–` und die Dauer ist mit `~` markiert.
- Wurde eine Session erneut verarbeitet, zählt je Schritt der neueste Job. Lief die neue Verarbeitung erst ab einem späteren Schritt (z. B. `concepts.extract`), stammen die Schritte aus verschiedenen Läufen. Dann steht „nicht bestimmbar“ statt einer Gesamtzeit, weil sonst die Zeit zwischen den Läufen mitzählen würde.
- Ist ein Schritt noch nicht `fertig` (läuft, wartet, Fehler), steht „noch nicht fertig“ statt einer Gesamtzeit.

Der Befehl endet mit Exit-Code 0, auch wenn das Ziel verfehlt ist (er misst, er bewertet nicht). Bei einer unbekannten Session oder einem Datenbankfehler ist der Code 1.

## 3. Ausrichtung gegen den goldenen Datensatz (≥ 85 %)

Der Befehl vergleicht die gespeicherte Zuordnung „welche Folie lief wann“ (`slide_segment`) mit einer Datei, die du selbst aus einer Vorlesung erstellst.

```bash
pnpm sg messen ausrichtung golden.json                       # Quelle: das Folienlog (source = log)
pnpm sg messen ausrichtung golden.json --quelle ausrichtung  # später: die Ausrichtung nach Inhalt
```

Die Quelle ist `log` (Standard), `ausrichtung` oder `manuell`.

### Format der Datei

Eine JSON-Datei, Zeiten in Millisekunden Sitzungszeit, also ab dem Start der Session (wie in `slide_segment`, VERTRAEGE „Sitzungszeit“). Pausen laufen mit: Nach einer Pause beginnt eine neue Aufnahme, deren Datei nicht bei der Sitzungszeit 0 anfängt. Wer an der Datei mitstoppt, addiert ihren Beginn (`recording.started_ms`). Folien sind 1-basiert (`slide_index`, die Nummer in deinem Foliensatz).

```json
{
  "version": 1,
  "sessions": [
    {
      "session_id": "0198f3a2-1111-7000-8000-000000000001",
      "segments": [
        { "slide_index": 1, "start_ms": 0, "end_ms": 95000 },
        { "slide_index": 2, "start_ms": 95000, "end_ms": 410000 },
        { "slide_index": 3, "start_ms": 410000, "end_ms": 700000 }
      ]
    }
  ]
}
```

Regeln:

- `version` ist 1. `sessions`: 1 bis 50 Einträge, jede `session_id` nur einmal (UUID in Kleinbuchstaben).
- `segments`: 1 bis 2 000 Einträge je Session. `start_ms` ≥ 0, `end_ms` > `start_ms`, beides ganze Zahlen, `slide_index` ≥ 1.
- Segmente einer Session dürfen sich nicht überlappen. **Lücken sind erlaubt**: Zeit ohne Eintrag (Pause, Vorgespräch, Ausschweifung) zählt nicht mit.
- Fehler in der Datei meldet der Befehl mit der Stelle (z. B. `sessions[0].segments[2].end_ms`).

So kommst du an die Zeiten: Höre die Aufnahme (oder schau das Video) an und notiere, wann du auf welche Folie gewechselt hast. Ein Fehler von wenigen Sekunden schadet nicht. Drei Vorlesungen sind das Ziel aus `09-NFA.md`.

### Wie gerechnet wird

Für jede goldene Zeitspanne zählt die Zeit, in der die gespeicherte Zuordnung dieselbe Folie nennt. Ergebnis je Session und insgesamt (nach Zeit gewichtet, also eine lange Vorlesung zählt mehr):

- **richtig**: gleiche Folie.
- **andere Folie**: es gibt ein Segment, aber mit einer anderen Folie.
- **ohne Zuordnung**: in dieser Zeit gibt es kein Segment.

Ziel: „richtig“ gesamt ≥ 85 %. Gibt es zu keiner Session Segmente in der gewählten Quelle, meldet der Befehl das und endet mit Code 1.

## Grenzen

- Gemessen wird auf deinem Mac mit deinen Daten (Pipeline, Ausrichtung) bzw. mit erfundenen Daten (⌘K). Werte aus der Entwicklungsumgebung (Linux, Sandbox) sagen nichts über deinen Mac.
- Der goldene Datensatz ist nur so gut wie deine Notizen. Wenige Sekunden Abweichung an Folienwechseln sind normal und machen bei einer Vorlesung von 90 Minuten nur Bruchteile eines Prozents aus.
