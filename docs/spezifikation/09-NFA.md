# 09 · Nicht-funktionale Anforderungen

## 1. Leistung

| Messpunkt | Ziel | Messbedingung |
|---|---|---|
| App öffnen → Heute-Bildschirm | < 2 s | Web-App, Core läuft bereits |
| Öffnen → Aufnahme läuft | ≤ 10 s, 1 Tipp | Termin im Zustand `bereit` |
| Folienwechsel Mac → iPad | < 300 ms | gleiches WLAN |
| Strich iPad → Mac sichtbar | ≤ 1 s nach Absetzen | gleiches WLAN |
| Schreiblatenz iPad | wie PencilKit nativ (keine zusätzliche Verzögerung durch die App) | Instruments-Messung |
| Rückblick: Folie anklicken → Transkript + Notizen | < 500 ms | 90-min-Session |
| ⌘K erste Ergebnisse | < 300 ms | 5 000 Folien, 200 h Transkript |
| Transkription 90 min | ≤ 15 min | Apple M-Prozessor, lokal |
| Gesamte Pipeline 90 min | ≤ 45 min | mit Cloud-LLM |
| Planer-Durchlauf 14 Tage | < 500 ms | 6 Module, 2 000 fällige Karten |
| Karte bewerten → nächste Karte | < 100 ms | lokal; KI-Bewertung offener Antworten ≤ 3 s |
| Graph mit 2 000 Knoten | ≥ 30 fps | MacBook Air |

## 2. Zuverlässigkeit & Datensicherheit

| Anforderung | Ziel |
|---|---|
| Strichverlust | **0** (Ausgangswarteschlange mit Bestätigung, lokale Speicherung ≤ 1 s nach Änderung) |
| Audioverlust bei Browser-Absturz | ≤ 30 s |
| Audioverlust bei Netzunterbrechung zum Core ≤ 30 min | 0 |
| Datenverlust bei Mac-Defekt | ≤ 24 h (tägliches Backup auf anderes Medium) |
| Backup-Wiederherstellung | monatlich automatisch getestet |
| Job-Fehler | nie still: sichtbar an der Session, mit „erneut versuchen" |
| Migrationen | vorwärts und rückwärts getestet. Vor jeder Migration automatisches Backup. |
| iPad-App-Ablauf (7-Tage-Signatur) | darf keine Daten kosten. Daten liegen im App-Container und werden beim erneuten Aufspielen übernommen. Zusätzlich liegt alles auf dem Mac. |

## 3. Verfügbarkeit ohne Netz

- iPad ohne Mac: Schreiben, Marker, Fotos, Folien blättern (bereits geladene Folien), Session starten/stoppen, Wiederholung (Phase 3).
- Mac ohne Internet: alles außer Cloud-KI-Aufgaben. Diese warten und laufen automatisch nach.
- **Kein Bildschirm und keine Aktion darf wegen fehlender Verbindung blockieren** (R14).

## 4. Datenschutz & Sicherheit

| Thema | Festlegung |
|---|---|
| Datenhaltung | Ausschließlich lokal auf dem Mac (und Backup-Ziel). Keine eigene Cloud, keine Telemetrie. |
| Netzwerk | Core nur im lokalen Netz erreichbar, Geräte-Token-Pflicht für Nicht-localhost. Kein Port-Forwarding, kein UPnP. |
| Cloud-KI | Gesendet werden nur die für die Aufgabe nötigen Ausschnitte (Texte, Folienbilder, eigene Antworten). Audio nur bei gewählter Cloud-Transkription. Jeder Aufruf ist im Kostenzähler mit Aufgabe und Datenumfang nachvollziehbar. |
| Modus „nur lokal" | Schaltet alle Cloud-Aufrufe ab. Die App bleibt nutzbar (Aufnahme, Notizen, Transkript, Suche, Wiederholung vorhandener Karten). |
| Geheimnisse | API-Schlüssel in `config/.env` (600) bzw. Schlüsselbund. Nie in Logs, nie im Repo (Secret-Scanning im CI). |
| Backups | Optional verschlüsselt (`age`). Bei Ziel iCloud-Drive **empfohlen** verschlüsselt. |
| Aufnahmen Dritter | Für eine spätere Weitergabe der Software: Hinweis beim ersten Start, dass Aufnahmen die Einwilligung der Sprechenden voraussetzen (DE § 201 StGB, CH Art. 179bis ff. StGB). |
| Fremde Inhalte | Folien und Übungen bleiben lokal und werden nicht geteilt (Urheberrecht). Export ist für den Eigengebrauch gedacht. |
| Referenz-Apps | Nur Funktionsweisen aus öffentlichen Quellen übernehmen. Kein fremder Code, keine fremden Grafiken oder Marken. |

## 5. Kosten

- Lokal vor Cloud: Transkription, Embeddings und Suche laufen lokal und kostenlos.
- Richtwert Cloud-LLM pro 90-min-Vorlesung (Konzepte, Zusammenfassung, Karten, Detektor): niedriger einstelliger Cent- bis unterer Euro-Bereich. Messen und im Kostenzähler ausweisen statt schätzen.
- Monatsbudget mit Drosselung (F-DAT-05).
- Große Eingaben werden vorab gekürzt (nur relevante Folien/Abschnitte). Wiederholte Aufrufe mit identischer Eingabe werden aus einem lokalen Cache bedient (Hash von Prompt-Version + Eingabe).

## 6. Qualität & Tests

| Ebene | Was | Werkzeug |
|---|---|---|
| Unit | FSRS-Erweiterungen, Kennzahlen (06 §2), Planer, Normalisierung getippter Antworten, Vault-Blockmerge, Strich-Packung | Vitest (TS), pytest (Python), XCTest (Swift) |
| Contract | Schemas in `packages/schemas` gegen TS-, Swift- und Python-Modelle. Beispielnachrichten des Sync-Protokolls laufen durch alle drei. | eigene Contract-Tests |
| Integration | Core + Postgres (Testcontainer), Sync-Szenarien: Offline-Phase, Doppelversand, Reihenfolge, 90 min Strich-Last | Vitest + `ws`-Testclient |
| Pipeline | **Goldener Datensatz:** 3 eigene Vorlesungen (Audio, Folien, Folienlog, handgeprüfte Konzepte, 30 bewertete Karten) | pytest, Qualitätsgrenzen siehe 05 §4 |
| E2E Web | Kritische Abläufe: Start → Aufnahme → Stopp, Upload → Anzeige, Nacharbeitung, Wiederholung | Playwright |
| iPad | Strichumwandlung PencilKit → neutral → zurück (Rundlauf), Ausgangswarteschlange bei App-Abbruch | XCTest |
| Hörsaal-Test | Vor Freigabe jeder Phase-1-Version: eine echte Vorlesung mit Checkliste (Startzeit, Verluste, Schreibgefühl, Ablenkung) | Protokoll in `docs/tests/hoersaal/` |

**Datensatz-Hinweis:** Der goldene Datensatz besteht aus eigenen, erlaubten Aufnahmen und bleibt lokal. Er wird nicht ins Repo eingecheckt. Ins Repo kommt nur ein synthetischer Mini-Datensatz (TTS-Audio + eigene Folien) für CI.

## 7. Wartbarkeit

- TypeScript `strict`, ESLint + Prettier. Python: `ruff`, `mypy --strict` für Pipeline-Module. Swift: `swift-format`.
- Alle Datenformate nur über `packages/schemas` (generiert, nie von Hand dupliziert).
- Feature-IDs (`F-XXX-nn`) in Commit-Nachrichten und Testnamen.
- Prompts versioniert als Dateien, Änderungen nur mit Lauf des goldenen Datensatzes.
- Logs strukturiert (JSON), mit `session_id`/`job_id`, rotierend 14 Tage. Ein Diagnose-Bildschirm in den Einstellungen (Jobs, letzte Fehler, Geräte, Uhrversatz).

## 8. Kompatibilität

| Plattform | Mindestversion |
|---|---|
| macOS | aktuelle und vorherige Hauptversion, Apple Silicon (Intel: ohne lokale MLX-Transkription → Cloud oder whisper.cpp CPU) |
| Browser am Mac | Safari und Chrome, jeweils aktuelle Version |
| iPadOS | aktuelle und vorherige Hauptversion, **soweit von Swift Playgrounds unterstützt** (Spike S1) |
| Apple Pencil | 2. Generation, USB-C, Pro. Squeeze und Hover nur, wo die Hardware es kann. |

## 9. Sprache & Lokalisierung

- UI-Texte zentral (ICU-Message-Format), Deutsch als einzige Sprache in v1. Struktur bereit für Englisch.
- Inhalte: Deutsch, Englisch, gemischt. Volltextsuche mit passender Sprachkonfiguration pro Abschnitt. Embeddings mehrsprachig (bge-m3), deshalb findet eine deutsche Suche auch englische Folien.
- Datum/Zeit: deutsches Format, 24 h, Woche beginnt Montag.
