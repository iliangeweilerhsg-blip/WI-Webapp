# Plan: Folien in der Vorlesung

Stand: 17. November 2026 · Basis: `main`. Vertrag: [`docs/VERTRAEGE.md` §22](../VERTRAEGE.md).

## 1. Ziel

Eine Vorlesung soll ohne Zutun mit den richtigen Folien laufen. Heute läuft jede „ohne Folien“, obwohl der Core die Verknüpfung kann.

## 2. Entscheidungen des Owners (17.11.2026)

1. **Vorschlag beim Start.** Der neueste noch freie Foliensatz des Moduls ist vorgewählt, sichtbar auf der Start-Karte, mit einem Klick änderbar oder „Ohne Folien“. Der Ein-Tipp-Start (F-SES-02, LP1) bleibt: kein Dialog. Auch während der Vorlesung können Folien gewählt oder hochgeladen werden.
2. **Quelle meist Moodle.** Sätze aus dem Moodle-Abgleich erscheinen als Vorschlag. Kommt ein neuer Satz, während eine Vorlesung des Moduls ohne Folien läuft, bietet die Live-Ansicht ihn ruhig an. Sie wechselt nie von selbst.
3. **Nachträglich (Session beendet):** nicht in diesem Schnitt, siehe §7.

## 3. Was heute da ist (im Code geprüft)

| Stelle | Stand |
|---|---|
| `services/core/src/services/sessions.ts` | `createSession`, `transitionSession` (Start) und `updateSession` (`PATCH`) nehmen `slide_deck_id` an. `PATCH` prüfte weder Zustand noch Folienwechsel und sperrte nichts (mit F1 geändert). `linkDeckToSession` setzt `slide_deck.session_id` nur, wenn es leer ist, und räumt es nie auf |
| `services/core/src/services/material.ts` | `createSlideDeck` mit `sessionId` ruft `attachDeckToSession` (setzt nur, wenn die Session keinen Satz hat). Sperrt den Satz vor der Session |
| `services/core/src/moodle/sync.ts` | `createSlideDeck` ohne Session. Kein Abgleich zum Vorlesungsbeginn (heutige Anlässe: Core-Start, alle 2 h, Knopf, nach Zuordnung und nach Inbox-Entscheidung, §17.4) |
| `apps/web/src/lib/sessions.ts`, `today/StartCard.tsx` | Start über `POST /sessions/{id}/start` nur mit `started_from`. Spontan: `POST /sessions` nur mit `module_id`, dann Start. Kein Aufruf setzt einen Satz |
| `apps/web/.../slides/SlidesPanel.tsx` | Ohne Satz nur der Hinweis „Folien kommen später – einfach mitschreiben“. `slide.change` nur mit geladenem Satz |
| `apps/ipad/Sources/Sync/SessionFollower.swift` | Übernimmt `slide_deck_id` aus jedem `session.updated` der verfolgten Session. Sendet kein `slide.change` |
| Sync-Ereignisse | `session.updated`, `presence`, `device.connection`, `notebook.changed`, `pairing.requested`. Kein Ereignis für Material |
| Worker `align.log` | Löst Folien über den Satz der Session und `slide_index` auf, nicht über `slide_id` |

## 4. Festlegungen (Kurzfassung, verbindlich ist §22)

- **Maßgeblich** ist nur `session.slide_deck_id`. `slide_deck.session_id` bleibt ein Hinweis.
- **Frei** = wählbar (nicht gelöscht, `ingest_state ≠ fehler`) und von keiner anderen nicht gelöschten Session außer `verpasst` getragen. Der aktuelle Satz der Session steht immer in der Liste, auch bei `fehler`. `used_by` ist ein eigener kleiner Typ `DeckUse`.
- **Vorschlag** = neuester freier Satz nach `available_at` (Moodle-`timemodified`, sonst `uploaded_at`). Auch ohne Session (spontaner Start) gilt dieselbe Regel.
- **Abruf:** `GET /modules/{id}/deck-options?session_id` → `DeckOptions` (ein Endpunkt für Start-Karte, spontanen Start und Live-Ansicht).
- **Setzen, wechseln, leeren:** `PATCH /sessions/{id}` in `geplant`, `bereit`, `laeuft`, `pausiert`. Wechseln und Leeren nur vor dem ersten Folienwechsel, sonst `409 slide_deck_locked` (maßgeblich ist der Zeiger, auch bei gelöschtem Satz). `title` und `slide_deck_id` in einem Aufruf: alles oder nichts. Abgeschlossen: `409 slide_deck_session_closed`.
- **Start:** Der Core wählt nie selbst. Die Web-App schickt den Vorschlag als `slide_deck_id` mit und startet im Zweifel ohne Satz.
- **Upload:** `POST /slide-decks` mit `session_id` setzt nur, ersetzt nie (ein Zeiger auf einen gelöschten Satz ohne `slide_event` zählt als „kein Satz“).
- **Moodle:** Der Abgleich verknüpft nichts. Die Live-Ansicht fragt `deck-options` ab (kein neues Ereignis). Neu (§17.8): Abgleich der Kurse des Moduls 15 min vor Beginn, im ersten Takt nach dem Start (höchstens 60 s danach, auch Geräte-Start) und alle 10 min in einer laufenden Session ohne Folien. Nur für Sessions ohne gültigen Satz, Drossel 10 min je Modul im Speicher (in der Praxis etwa 10 bis 11 min Abstand). Der Core-Takt meldet den Bedarf nach seinem Commit, `startSession` bleibt unverändert. Der Anlass `vorlesung` ist intern (kein Wert im Schema), ein solcher Lauf überschreibt `last_run` nicht.
- **iPad, Worker:** keine Änderung.

## 5. Tickets

Scope je Ticket (Dateien) steht in §22.11. Hier Reihenfolge, Modell und Tests.

| Ticket | Inhalt | Code | Review | Tests |
|---|---|---|---|---|
| **F1** Core + Schemas | Typen, `deck-options`, Regeln und Sperren für `PATCH`, Upload mit `session_id` | Sonnet | Opus | Vorschlagsregel (frei, `verpasst`, Fassungen, Moodle-Datum, gelöschter Satz), alle Zeilen der Tabelle in §22.4, Aufräumen von `slide_deck.session_id`, Nebenläufigkeit `PATCH` ↔ `slide.change` und `PATCH` ↔ Upload ohne `40P01`, `session.updated` genau einmal |
| **F2** Web | Start-Karte, spontaner Start, Live-Ansicht, Modulseite | Sonnet | Opus | Ein Tipp startet mit Vorschlag. Start ohne geladene Optionen. Wiederholung nach `slide_deck_not_found`. „Ohne Folien“ bleibt nach Neuladen. Angebot und „Nicht jetzt“. Tastatur und Fokus der Liste. Kein Rot, kein Zähler |
| **F3a** Moodle | Interner Anlass `vorlesung` (kein Schema), `MoodleSync.runForLecture`, `lastLectureRun`, `activeCourseIdsOfModule`, `LectureSync` mit Drossel (§17.8). Noch ohne Aufrufer | Sonnet | Opus | Drossel (Dauer, je Modul, gleichzeitige Anstöße, Uhr, Aufräumen), kein Lauf ohne Zugang oder Kurs, gedeckt und angehängt nach §17.4, nie zwei Läufe, `vorlesung` weicht jedem anderen Anlass, `last_run` bleibt, Kursabfrage gegen Postgres |
| **F3b** Takt | `runSessionTick` meldet den Bedarf, `afterTick` nach dem Commit, Verdrahtung in `buildApp` (`lectureSync`, `sessionTickIntervalMs`) | Sonnet | Opus | Drei Anlässe, nie vor dem Commit, Start und Takt scheitern nicht bei Moodle-Fehler, Verdrahtung in `buildApp` (Start-Takt mit `startup: true`, normaler Takt mit `startup: false` und den richtigen Modulen), Ende zu Ende mit Moodle-Fake: Satz wird Vorschlag, die Session bleibt ohne Satz |
| **F4** iPad | Nur Tests für `session.updated` mit neuem, anderem und leerem `slide_deck_id` | Sonnet | Sonnet | – |
| **F5** Abschluss | Ende-zu-Ende-Test, Anleitung, Prüfliste | Sonnet | Sonnet | – |

**Reihenfolge:** F1 zuerst. F2 und F4 können parallel zu F1 beginnen (F2 gegen Beispiele und Fake-Core), F2 wird nach F1 gemergt. F3a nach F1, F3b nach F3a (F3b ändert `sessions.ts` und braucht `LectureSync`). F3a und F3b berühren die Web-App nicht und warten nicht auf F2. F5 zuletzt.

## 6. Abnahme

1. Moodle hat neue Folien, der Termin steht auf „Heute“: Die Start-Karte zeigt „Folien: ‹Titel› aus Moodle“. Ein Tipp startet, die Live-Ansicht zeigt Folie 1, das iPad kennt den Satz.
2. „Ändern“ → anderer Satz oder „Ohne Folien“: ein Klick, kein Dialog, die Wahl übersteht ein Neuladen.
3. Vorlesung läuft ohne Folien, der Dozent lädt hoch: Spätestens nach dem nächsten Abgleich (etwa 10 bis 11 min) und der nächsten Abfrage der Live-Ansicht (60 s) steht in der Folien-Spalte „Neue Folien aus Moodle: ‹Titel›“. Nichts wechselt von selbst. „Übernehmen“ setzt den Satz, ohne die Aufnahme zu berühren.
4. Falscher Satz gewählt, noch nicht geblättert: wechseln geht. Nach dem ersten Blättern geht es nicht mehr, mit ruhigem Hinweis.
5. PDF in der Live-Ansicht hochladen: Der Satz hängt an der Session, „Folien werden verarbeitet …“ und danach Folie 1.
6. Start ohne Netz zu Moodle, ohne Moodle-Login oder mit ausgefallenem Abgleich: startet wie bisher, ohne Verzögerung. Der Core versucht es je Modul höchstens alle 10 min wieder.
7. Rückblick einer Session, die nach 10 min Folien bekam: Transkript liegt auf den Folien, der Anfang auf der ersten gezeigten Folie.

## 7. Spätere Stufe: Folien nachträglich

Eine beendete Session bekommt einen Foliensatz, oder ein falscher Satz wird nach dem Blättern getauscht. Dafür braucht es:

- `align.content` (F-NAC-03): Ausrichtung des Transkripts an den Folieninhalt, weil Folienwechsel fehlen oder zum alten Satz gehören.
- Eine Regel für vorhandene `slide_event` und für iPad-Seiten, die an Folien des alten Satzes hängen (verwerfen, behalten oder abbilden, vgl. F-ORG-02).
- `reprocess` ab `align.log` bzw. `align.content` und alles, was danach kommt (Konzepte, Zusammenfassung, Karten mit Belegen auf Folien).
- Einen eigenen Weg im Rückblick. `slide_deck_session_closed` und `slide_deck_locked` fallen dann für diesen Weg weg.

## 8. Offene Punkte für den Lead

Die Punkte 3 und 11 bis 14 sind entschieden (Lead, 17.11., Kommentar an PR #371). Die übrigen sind weiter offen.

1. **Vorschlag bei Dozenten, die alle Sätze vorab hochladen.** „Neuester freier“ trifft dann den Satz der letzten Vorlesung. Mögliche Verfeinerung ohne Schema-Änderung: zuerst der freie Satz, dessen Titel die Nummer der Vorlesung (`session.number`) trägt, sonst der neueste. Nicht festgeschrieben, weil der Owner „neuester“ entschieden hat.
2. **Neue Fassung als falscher Vorschlag** (§22.2). Der Core kennt die Verbindung alt ↔ neu nicht. Abhilfe wäre eine Spalte „ersetzt“ am Satz (Schema, mit F-ORG-02). Bis dahin korrigiert ein Klick.
3. **Abgleich zur Vorlesung, Wiederholung alle 10 min: entschieden (Lead, 17.11.), bleibt.** Der Abgleich (§22.6, ausgearbeitet in §17.8) ist ergänzt, weil er sonst nur alle 2 h läuft und das Angebot im Hörsaal zu spät käme. Die Wiederholung steht so im Plan, den der Owner am 17.11. abgenommen hat, und Abnahme 3 hängt daran. Last für Moodle: die Kurse eines Moduls, höchstens alle 10 min, nur bei laufender Session ohne Folien.
4. **Abfrage statt Ereignis** (§22.6): 60 s Verzögerung nach dem Abgleich. Ein Ereignis `deck.changed` wäre sofort, kostet aber eine Änderung am Sync-Schema und eine Prüfung der iPad-Decoder.
5. **Sperre nach dem ersten Folienwechsel** ist streng: Wer den falschen Satz wählt und einmal blättert, bleibt bis zur späteren Stufe dabei. Alternative: Wechsel erlauben und die bisherigen `slide_event` weich löschen. Das ändert Daten, die das iPad schon gesehen hat, und ist darum nicht gewählt.
6. **`geplant` und `verpasst`:** `PATCH` ist in `geplant` erlaubt (über den Auftrag hinaus, die Start-Karte braucht es). `verpasst` ist mit den beendeten Zuständen gesperrt.
7. **Upload mit `session_id` einer abgeschlossenen Session** antwortet neu mit 409 statt den Satz still anzuhängen. Kein Client nutzt das heute. Der spätere Import (F-SES-06) braucht dann einen eigenen Weg.
8. **iPad nicht am Gerät geprüft.** Die Aussage „keine Änderung“ stützt sich auf den Code (`SessionFollower.apply(sessionUpdate:)`, `InkLibraryService.follow`). Offen ist, ob eine offene Seite „Auf Folie“ sauber zurückfällt, wenn der Satz geleert wird. Vor dem ersten Folienwechsel kann sie nicht aktiv sein, darum sollte nichts passieren.
9. **Gelöschter Satz an laufender Session:** `DELETE /slide-decks/{id}` lässt `session.slide_deck_id` stehen. §22 behandelt das wie „kein Satz“, löst aber kein `session.updated` aus. Die Live-Ansicht zeigt dann „Folien sind gerade nicht erreichbar.“ Nicht Teil dieses Schnitts.
10. **`SessionRef` in `DeckOption.used_by`:** erledigt. Der Verweis über Schema-Dateien hinweg geht mit dem Generator (gemeinsamer Namensraum). Entschieden ist trotzdem ein eigener kleiner Typ `DeckUse` (`session_id`, `number`, `title`), weil die Anzeige weder Modul noch Startzeit braucht.
11. **Start-Anstoß bis zu 60 s später: entschieden (Lead, 17.11.), angenommen.** Der Abgleich „beim Start“ hat keinen eigenen Aufruf in `startSession`, er kommt mit dem ersten Core-Takt nach dem Start (§17.8). Er liegt so sicher nach dem Commit, braucht keinen Eingriff in den Zustandsautomaten und holt sich nach einem Fehler von selbst nach. Wirkt das Angebot im Hörsaal zu träge, folgt ein kleines Ticket mit `pg_notify` (wie `publishAfterCommit`).
12. **Lücke zwischen „15 min vorher“ und dem Start: entschieden (Lead, 17.11.), vorerst keine Änderung.** In diesem Fenster gibt es keinen weiteren Abgleich. Lädt der Dozent dann hoch, zeigt die Start-Karte den Satz noch nicht, die Live-Ansicht bietet ihn rund ein bis zwei Minuten nach dem Start an. Was der Owner im Hörsaal erlebt, entscheidet: Erst danach kommt gegebenenfalls ein Abgleich 5 min vor Beginn. Der Owner bekommt die Lücke als Hinweis in der Test-Checkliste (F5). In dasselbe Fenster fallen ein Core-Neustart und Sessions, die der Kalender-Import direkt in `bereit` anlegt (§17.8, „Fälle ohne Anlass 1“).
13. **Neuer Moodle-Login während der Vorlesung: entschieden (Lead, 17.11.), zur Kenntnis genommen.** Er greift für den Abgleich zur Vorlesung erst nach bis zu 10 min (die Drossel zählt auch Anstöße ohne Zugang, damit nichts im Minutentakt prüft). „Jetzt abgleichen“ in Einstellungen › Moodle wirkt sofort.
14. **Der Lauf gleicht auch Übungsblätter und Fristen ab: entschieden (Lead, 17.11.), zur Kenntnis genommen.** Der Lauf zur Vorlesung gleicht den ganzen Kurs ab, nicht nur Folien (§17.8, „Was der Lauf tut“). Ein eigener Zweig „nur Folien“ ist nicht vorgesehen.
15. **`last_run` und Schema: entschieden nach Review (17.11.).** Ein Lauf `vorlesung` überschreibt `last_run` nicht (Lead), er steht nur im Protokoll und intern in `lastLectureRun`. Darum ist `vorlesung` kein Wert in `MoodleSyncTrigger`: Er wäre über die API nie sichtbar (§17.8, „Schema“). Den Verzicht auf den Enum-Wert hat der Subagent entschieden, bitte gegenlesen: Die erste Fassung sah den Wert vor.
