# CLAUDE.md – Projekt-Memory WI-Webapp

Diese Datei liest Claude in jeder Session zuerst. Sie hält fest, **für wen** wir bauen, **was entschieden ist** und **nach welchen Prinzipien** wir arbeiten.

## Worum es geht

Persönliche Lern- und Wissensplattform für mein Studium (Wirtschaftsinformatik). Primär für mich selbst; ein späterer Verkauf soll architektonisch nicht verbaut werden, ist aber kein Ziel.
**Verbindliche Spezifikation für die Umsetzung: `docs/spezifikation/` (gilt bei Widersprüchen).**
Gesamtkonzept: `docs/KONZEPT.md` · Alltag & Leitprinzipien: `docs/STUDIENALLTAG.md` · Funktionen: `docs/FEATURE-KATALOG.md` · Lernalgorithmus: `docs/LERNMODELL.md`

## Fakten über den Nutzer (Stand 03.11.2026)

- Geräte: **MacBook + iPad mit Apple Pencil.**
- Vorlesungen **dürfen aufgenommen werden.**
- Nutzt bisher GoodNotes. Obsidian ist bekannt, aber es gibt **kein bestehendes Lernsystem** darin; die Vault-Struktur ist unser eigener Entwurf (KONZEPT §5.2).
- **Kein Apple-Developer-Account.** Die iPad-App läuft über Swift Playgrounds oder Xcode mit 7-Tage-Signatur.
- **Erst nur lokal testen:** Der Sync-Server läuft auf dem Mac, kein Internet-Server.
- Vorbilder für einzelne Funktionen: GoodNotes, StudySmarter, Quizlet. Es zählen **nur Funktionen, die gebraucht werden oder wirklich nützlich sind.**
- Sprache im Projekt: **Deutsch** (Doku, UI-Texte, Commit-Messages).

## Getroffene Entscheidungen

| # | Entscheidung | Wo begründet |
|---|---|---|
| E1 | iPad-Schreib-App **nativ** (SwiftUI + PencilKit). Alles andere ist Web-App (Next.js/TypeScript). Striche werden als neutrales JSON übertragen. | KONZEPT §6 |
| E2 | Lokal speichern zuerst. Sync-Server in Phase 1 lokal auf dem Mac, später ggf. im Internet (Uni-WLAN isoliert Geräte oft). Uhrabgleich für Strich ↔ Audio. | KONZEPT §6 |
| E3 | Wissensnotizen als Markdown mit `[[Wikilinks]]`, Obsidian-kompatibel. | KONZEPT §6 |
| E4 | KI-Anbieter hinter einer internen Schnittstelle (Whisper, Claude API, TTS austauschbar). | KONZEPT §6 |
| E5 | Spaced Repetition mit **FSRS**, erweitert um Konzept-Beherrschung, Schwächen-Score und Klausur-Readiness. | LERNMODELL |
| E6 | Lernvideos in Stufen: V0 Vorlesungs-Clips → V1 Recap → V2 Schwächen-Videos. | KONZEPT §5.6 |
| E7 | Reihenfolge: zuerst das Vorlesungs-Dashboard (sofort nutzbar), Videos zuletzt. | KONZEPT §9 |
| E8 | iPad-App als `.swiftpm`-App-Playground: läuft in Swift Playgrounds (ohne Ablauf) oder über Xcode. | KONZEPT §6 E1 |
| E9 | **Keine Live-Auto-Folienverfolgung** (abgelehnt, zu aufwendig). Vergessene Folienwechsel werden nach der Vorlesung korrigiert. | FEATURE-KATALOG N1 |

## Leitprinzipien – bei jeder Entscheidung prüfen

1. **Null-Reibung in der Vorlesung.** Start mit einem Tipp. Einzige Pflicht-Interaktion: schreiben.
2. **Schreibgefühl ist nicht verhandelbar.** Schlechter als GoodNotes = wird nicht benutzt.
3. **Nichts darf verloren gehen.** Lokal zuerst, Aufnahme in Stücken, offline-fest, Backups.
4. **Disziplin nicht voraussetzen.** Die App repariert Lücken (vergessener Folienwechsel, vergessenes Stopp, fehlende Folien, verpasste Lernblöcke).
5. **Ruhe in der Vorlesung, Intelligenz danach.** Keine KI-Popups oder Benachrichtigungen während der Vorlesung.
6. **Aktiv statt passiv.** Abrufen, Erklären, Anwenden statt Durchlesen.
7. **Häppchen von 5–15 Minuten**, jederzeit unterbrechbar.
8. **Immer mit Quelle.** Jede KI-Aussage verlinkt auf Folie, Audio-Stelle oder Notiz.
9. **Ehrlicher Fortschritt, kein Schuld-UI.** Prognosen statt Streak-Druck; Verpasstes still neu verteilen.
10. **Ein Wissensnetz fürs ganze Studium**, über Semester und Fächer hinweg.
11. **Nur übernehmen, was einen Alltagsmoment (M1–M13) verbessert.**
12. **Mein Wissen gehört mir.** Markdown, Export, kein Lock-in.

## Arbeitsweise: Funktionen aus Referenz-Apps übernehmen

Der Nutzer nennt nur die App bzw. Funktion. **Claude recherchiert selbst** (Details: FEATURE-KATALOG §1):
1. Öffentliche Infos (Hilfe-Center, Changelogs, Tutorial-Videos/YouTube-Transkripte)
2. Open-Source-Pendants (Anki/FSRS, Saber, Xournal++, perfect-freehand …)
3. Bei Bedarf eine kurze Beobachtung des Nutzers (z. B. Bildschirmaufnahme)
4. Nur für Restfragen der Skill **`rea-reverse-engineering`**: nur hochgeladene Dateien (z. B. GoodNotes-`.app` als ZIP vom Mac), nur statisch, keine Aufrufe fremder Server. Web-Apps (Quizlet, StudySmarter) **nicht** selbst herunterladen und zerlegen.

Danach: Nutzen-Gate (P0/P1/P2) → an unser Datenmodell anpassen (Folie ↔ Audio ↔ Konzept ↔ Übung) → selbst bauen → Katalog aktualisieren.
- Nur **Funktionsweisen** übernehmen, nie fremden Code, Design, Icons oder Marken.
- Ergebnisse ablegen unter `docs/referenz-analysen/<app>.md`.

## Wenn neue Funktionen vorgeschlagen werden

Immer zuerst einordnen: Welcher Moment aus `docs/STUDIENALLTAG.md`? Welche Priorität? Was lassen wir dafür weg? Danach in `docs/FEATURE-KATALOG.md` eintragen.
