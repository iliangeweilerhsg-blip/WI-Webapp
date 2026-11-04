# 10 · Umsetzung

## 1. Repository-Struktur (Monorepo)

```
WI-Webapp/
├── apps/
│   ├── web/                    Next.js (Static Export), React, TS, Tailwind
│   └── ipad/StudienGehirn.swiftpm   SwiftUI + PencilKit (Swift Playgrounds / Xcode)
├── services/
│   ├── core/                   Node 22, Fastify, ws, Drizzle, ts-fsrs, Planer, Vault-Schreiber
│   └── worker/                 Python 3.12 (uv): Pipeline-Jobs, prompts/<task>/v<n>.md
├── packages/
│   ├── schemas/                JSON Schemas (Quelle der Wahrheit) + Codegen-Skripte
│   ├── shared/                 generierte TS-Typen/Zod, gemeinsame Hilfsfunktionen
│   └── ui-tokens/              Design-Tokens (JSON → CSS-Variablen, Swift)
├── infra/
│   ├── docker-compose.yml      PostgreSQL 16 + pgvector
│   └── sg/                     CLI „sg": start, stop, migrate, backup, restore, doctor
├── docs/                       Konzept, Spezifikation, Tests (Hörsaal-Protokolle), Referenz-Analysen
└── .github/workflows/          CI: Lint, Typen, Tests, Codegen-Prüfung, Secret-Scanning
```

| Werkzeug | Festlegung |
|---|---|
| Paketverwaltung | `pnpm` Workspaces (TS), `uv` (Python), Swift Package im `.swiftpm` |
| Codegen | `pnpm schemas:gen` erzeugt TS/Zod, Swift (`quicktype`), Pydantic (`datamodel-code-generator`). CI prüft, dass generierte Dateien aktuell sind. |
| CI | GitHub Actions: Lint, Typecheck, Unit- und Contract-Tests, Integrationstests mit Postgres-Service, Playwright (headless). Swift-Tests lokal auf dem Mac (macOS-Runner optional). |
| Branches | `main` geschützt, Feature-Branches `feat/F-XXX-nn-kurz`, Squash-Merge |
| Commits | Deutsch, mit Funktions-ID: `F-INK-14: Ausgangswarteschlange beim App-Abbruch sichern` |

## 2. Rollen (Vorschlag für ein kleines Team)

| Rolle | Schwerpunkt |
|---|---|
| iOS | iPad-App (INK, SYN-Client, Kopplung), Spike S1 |
| Fullstack TS (1–2) | Core (API, Sync, Sessions, Lernen, Planer, Vault), Web-App |
| KI/Python | Worker, Pipeline, Prompts, goldener Datensatz, Qualitätsmessung |
| Design (Teilzeit) | Bildschirme nach Kap. 07, Tokens, Hörsaal-Tests mit dem Nutzer |
| Produkt (= Nutzer) | Abnahme, Hörsaal-Tests, Entscheidungen bei offenen Fragen |

## 3. Phasen, Ziele, Abnahme

Richtwerte für ein Team von 3–4 Personen.

| Phase | Dauer (Richtwert) | Ziel | Abnahmekriterien |
|---|---|---|---|
| **0 · Fundament** | 1–2 Wochen | Lauffähiges Gerüst, Folien und Übungen ablegen und ansehen | `sg start` läuft auf dem Mac des Nutzers · F-ORG-01 bis -04 erfüllt · CI grün |
| **1 · Vorlesung** | 4–6 Wochen | **In echten Vorlesungen alles an einem Ort** | Spikes S1–S4 entschieden · Blindvergleich Schreibgefühl ≥ GoodNotes (F-INK-01) · 3 echte Vorlesungen ohne Strichverlust, Audioverlust ≤ 30 s · Start ≤ 10 s · Backup + Restore geprüft |
| **2 · Nacharbeitung** | 4–6 Wochen | Jede Vorlesung wird zu verlinkten Wissensnotizen | Pipeline ≤ 45 min · Ausrichtung ≥ 85 % (goldener Datensatz) · Nacharbeitung Median ≤ 15 min · Vault in Obsidian fehlerfrei · ⌘K < 300 ms |
| **3 · Lernen** | 4–6 Wochen | Klausurvorbereitung läuft über die App | FSRS + Lernsitzung + Probeklausur nutzbar · Kartenqualität ≥ 75 % „behalten" · Readiness-Abweichung zur Probeklausur ≤ 15 Pp. · Wiederholung offline auf dem iPad |
| **4 · Planen** | 3–4 Wochen | Die Woche plant sich selbst | Plan für 14 Tage < 500 ms · keine Überschneidung mit Terminen · Vorbereitungs-Check vor jeder Vorlesung mit Folien · Nutzer nickt den Sonntagsplan in ≤ 5 min ab |
| **5 · Videos** | 3–4 Wochen | Schwächen mit Videos schließen | V0-Clips für alle Konzepte mit Belegen · V1/V2 für Testkonzepte mit Quellen je Abschnitt · Prüffragen nach jedem V2-Video |

**Zeitlicher Hinweis:** Das laufende Semester endet mit der Klausurphase. Wird Phase 3 vor den Klausuren nicht fertig, wird Phase 1 + ein **Minimal-Lernen** vorgezogen: Karten aus der Nacharbeitung + FSRS-Wiederholung ohne Planer.

## 4. Spikes (zu Beginn von Phase 1, jeweils ≤ 3 Tage)

| ID | Frage | Vorgehen | Entscheidung danach |
|---|---|---|---|
| **S1** | Läuft die iPad-App in **Swift Playgrounds** mit allem, was wir brauchen? | Minimal-App als `.swiftpm`: zwei PencilKit-Ebenen, `UIPencilInteraction`, Kamera, Bonjour-Suche + WebSocket ins lokale Netz (Local-Network-Freigabe), Speichern beim Beenden | Ja → Weg A. Nein → Weg B (Xcode, 7-Tage-Signatur, ggf. AltStore). Dokumentieren in `docs/entscheidungen/S1.md`. |
| **S2** | Erlaubt das Uni-WLAN Verbindungen zwischen iPad und Mac? | Kleiner WebSocket-Echo-Test im Hörsaal (Core auf dem Mac, Client auf dem iPad) | Ja → normaler Betrieb. Nein → Offline-Weg ist der Hörsaal-Standard. Hotspot-Empfehlung im Einrichtungsdialog. |
| **S3** | Erreichen wir ≤ 1 s Strich-Spiegelung und eine originalgetreue Darstellung am Mac? | PencilKit → neutrales Format → perfect-freehand. 10 min Testschrift, Vergleich als Bild | Parameter für Breite/Druck festlegen. Ggf. Strichbild als Fallback. |
| **S4** | Ist die Audioaufnahme in Safari **und** Chrome stabil (Chunks, Ruhezustand, Wake Lock, Hintergrund-Tab)? | 2-h-Aufnahme je Browser, Deckel-zu-Test, Tab-Wechsel | Empfohlener Browser + Hinweise im Einrichtungsdialog |
| **S5** | Wie schnell ist lokale Transkription auf dem Mac des Nutzers? | `mlx-whisper large-v3-turbo` auf 90 min Testaudio | Lokal als Standard (≤ 15 min) oder Cloud-Standard |

## 5. Erstes Backlog

Größen: **S** ≤ 1 Tag · **M** 2–3 Tage · **L** 4–5 Tage.

### Phase 0
| Ticket | Inhalt | Funktion | Größe |
|---|---|---|---|
| T0-01 | Monorepo, pnpm, Lint/Format, CI-Grundgerüst, Secret-Scanning | – | M |
| T0-02 | `packages/schemas` + Codegen nach TS/Swift/Python, Contract-Test-Rahmen | – | M |
| T0-03 | `infra`: Postgres+pgvector per Docker, `sg`-CLI (start, stop, migrate, doctor) | – | M |
| T0-04 | Core-Gerüst: Fastify, Drizzle, Migrationen für Organisation & Material (03 §3–4), OpenAPI | – | M |
| T0-05 | Worker-Gerüst: Job-Schleife (`SKIP LOCKED` + `LISTEN/NOTIFY`), Logging, LLM-Schnittstelle (02 §7) | – | M |
| T0-06 | Web-Gerüst: Static Export, Navigation (07 §2), Design-Tokens, Hell/Dunkel | – | M |
| T0-07 | Semester & Module (API + UI), Einrichtungsdialog | F-ORG-01 | M |
| T0-08 | Folien-Upload, Zuordnung, `pdf.ingest` (ohne Vision) | F-ORG-02 | L |
| T0-09 | Übungsblatt-Upload | F-ORG-03 | S |
| T0-10 | PDF-Anzeige mit Seitenleiste, Zoom, Suche | F-ORG-04 | M |

### Phase 1
| Ticket | Inhalt | Funktion | Größe |
|---|---|---|---|
| T1-00 | Spikes S1–S5 | – | 5 × M |
| T1-01 | ICS-Import, Serienauflösung, Abgleich, Modulzuordnung | F-KAL-01, -02 | L |
| T1-02 | Session-Modell, Zustandsautomat, API, Absturzregeln | F-SES-01, -04, -05 | M |
| T1-03 | Heute-Bildschirm mit Start-Karte | F-SES-02, 07 §3.1 | M |
| T1-04 | Live-Dashboard: Layout, Vorlagen, Statusleiste | F-DSH-01, -06 | L |
| T1-05 | Folien blättern, `slide_event`, Tastenkürzel | F-DSH-02 | S |
| T1-06 | Audioaufnahme: Chunks, IndexedDB-Puffer, Upload, Zusammenfügen | F-AUD-01, -02 | L |
| T1-07 | Auto-Stopp inkl. Sprachaktivität und Hinweis | F-SES-03 | M |
| T1-08 | Sync-Server: Ströme, `seq`, `ack`, Resume, Idempotenz, Keepalive | F-SYN-01, -03 | L |
| T1-09 | Uhrabgleich (Server + Clients) | F-SYN-02 | S |
| T1-10 | Kopplung: Bonjour, Code, QR, Token, Geräteverwaltung | F-INK-13 | M |
| T1-11 | iPad: App-Gerüst, Startbildschirm, Notizbücher | F-INK-02 | M |
| T1-12 | iPad: Canvas mit zwei Ebenen, Werkzeuge, Pencil-Gesten, Rückgängig | F-INK-01 | L |
| T1-13 | iPad: Seiten, Vorlagen, Schreibmodi, Folie als Hintergrund | F-INK-02, -03 | L |
| T1-14 | iPad: lokaler Speicher, Ausgangswarteschlange, Strich-Diff → Operationen | F-INK-14, 08 §4.3 | L |
| T1-15 | iPad: Marker-Stempel, Tafel-Foto, Folie blättern per Wisch, Lasso | F-INK-04 bis -07 | L |
| T1-16 | Web: Notizen-Spalte (Rendering, Seitenfolge, Offline-Hinweis) | F-DSH-04 | M |
| T1-17 | Marker vom Mac | F-DSH-05 | S |
| T1-18 | Backups, Wiederherstellung, Papierkorb, Rückgängig-Toast | F-DAT-01, -02, -04 | L |
| T1-19 | Einstellungen (Allgemein, Geräte, Vorlesung, Stift, Daten) | F-EIN-01 | M |
| T1-20 | Hörsaal-Test-Protokoll + 3 begleitete Vorlesungen | 09 §6 | M |

### Phase 2–5 (Epics)
| Epic | Inhalt |
|---|---|
| E-NAC | Transkription, Ausrichtung (log + Inhalt), Rückblick, Audio-Wiedergabe der Notizen, geführte Nacharbeitung, Inbox, Klausurhinweis-Detektor, Zusammenfassung |
| E-BIB | Vault-Schreiber mit Blockregeln, Datei-Watcher, Konzeptansicht, Zusammenführen/Teilen, Fachübersicht |
| E-SUC | Suchindex, ⌘K, Frag deine Vorlesung |
| E-LRN | Kartentypen, Erzeugung, FSRS, Lernsitzung, Bewertung, Fehleranalyse, Markieren/Lasso → Karte, Bildverdeckung, Abdeckband, Probeklausur, Readiness, Feynman, Übungsmodus, Altklausuren, Wiederholung auf dem iPad |
| E-GRA | Graph, Glossar, Fächerbrücken |
| E-PLN | Google-Kalender, Semesterstart-Assistent, Planer, Jetzt sinnvoll, Vorbereitungs-Check, Briefing, Abschluss, Sonntagsplanung |
| E-VID | V0, V1, V2, Videothek |

## 6. Definition of Done (für jedes Ticket)

- [ ] Akzeptanzkriterien der Funktion erfüllt und durch Tests belegt (wo automatisierbar)
- [ ] Leitprinzipien und Interaktionsregeln R1–R18 geprüft (kurze Checkliste im PR)
- [ ] Kein neuer modaler Dialog während einer Session (R1)
- [ ] Datenformate nur über `packages/schemas`, Codegen aktuell
- [ ] Offline-Verhalten geprüft (Verbindung trennen, Aktion ausführen, verbinden)
- [ ] Texte nach 07 §7 (Ton) geprüft
- [ ] Hell- und Dunkelmodus geprüft
- [ ] Doku aktualisiert (diese Spezifikation, falls Verhalten abweicht – mit Begründung)

## 7. Risiken

| Risiko | Wahrscheinlichkeit | Auswirkung | Gegenmaßnahme |
|---|---|---|---|
| Swift Playgrounds kann etwas Wichtiges nicht (Kamera, lokales Netz) | mittel | mittel | Spike S1, Weg B (Xcode) ist ohne Umbau möglich |
| Schreibgefühl reicht nicht an GoodNotes heran | niedrig (PencilKit) | sehr hoch | Blindtest als Freigabekriterium, früh in Phase 1 |
| Uni-WLAN isoliert Geräte | hoch | niedrig | Offline-Weg ist voll funktionsfähig, Hotspot optional |
| Transkription bei schlechter Akustik ungenau | mittel | mittel | Ansteckmikro empfehlen, Vokabular-Hinweis, Cloud-Alternative |
| KI-Konzepte zu grob oder zu fein, schlechte Karten | mittel | hoch | Inbox statt Automatik, goldener Datensatz, Annahmequote beobachten |
| Umfang wächst (zu viele Funktionen gleichzeitig) | hoch | hoch | Phasen strikt, jede Funktion braucht einen Alltagsmoment (LP11), P2 bleibt P2 |
| Klausurphase kommt vor Phase 3 | hoch | mittel | Minimal-Lernen vorziehen (§3) |
| Kosten der Cloud-KI | niedrig | niedrig | Lokal vor Cloud, Budget mit Drosselung, Cache |

## 8. Offene Fragen & Annahmen

**Annahmen (gelten, bis widerlegt)**
- Mac mit Apple Silicon.
- Der Stundenplan ist als ICS exportierbar.
- Vorlesungen sind deutsch, englisch oder gemischt.
- Folien kommen als PDF.

**Offene Fragen (blockieren Phase 0/1 nicht)**

| # | Frage | Wer | Bis |
|---|---|---|---|
| Q1 | Welches iPad-Modell und welcher Apple Pencil? (Squeeze/Hover) | Nutzer | Start Phase 1 |
| Q2 | Woher kommen Folien/Übungen (LMS, Mail)? Ist ein ICS-Export vorhanden? | Nutzer | Start Phase 1 |
| Q3 | Gibt es ein iPhone? (Hotspot im Hörsaal, Wiederholung unterwegs) | Nutzer | Ende Phase 1 |
| Q4 | Sprache der Vorlesungen pro Modul | Nutzer | Start Phase 2 |
| Q5 | Backup-Ziel (externe Platte, iCloud Drive) | Nutzer | Ende Phase 1 |
| Q6 | Welche Altklausuren sind verfügbar? | Nutzer | Start Phase 3 |
