# Produktspezifikation „Studien-Gehirn" (WI-Webapp)

| | |
|---|---|
| **Version** | 1.0 – Umsetzungsgrundlage |
| **Stand** | 04.11.2026 |
| **Status** | Freigegeben zur Umsetzung von Phase 0 und 1, spätere Phasen als Zielbild |
| **Leser** | Entwicklerteam (Web, iOS, Backend, KI/ML), Design, Produktverantwortung |
| **Sprache** | Deutsch (Doku, UI, Commits). Code-Bezeichner auf Englisch |

## Wozu dieses Dokument da ist

Diese Spezifikation beschreibt das Produkt so vollständig, dass ein Team ohne weitere Rückfragen mit der Umsetzung beginnen kann. Sie fasst die Entscheidungen aus `docs/KONZEPT.md`, `docs/STUDIENALLTAG.md`, `docs/FEATURE-KATALOG.md` und `docs/LERNMODELL.md` zusammen und konkretisiert sie bis auf die Ebene von Datenfeldern, Abläufen, Schnittstellen und Akzeptanzkriterien.

**Bei Widersprüchen gilt diese Spezifikation.** Die älteren Dokumente erklären das *Warum*, diese hier legt das *Was* und *Wie* fest.

## Kapitel

| # | Kapitel | Inhalt | Hauptsächlich für |
|---|---|---|---|
| 01 | [Produkt](01-PRODUKT.md) | Vision, Nutzer, Ziele, Nicht-Ziele, Leitprinzipien, Rahmenbedingungen | alle |
| 02 | [Architektur](02-ARCHITEKTUR.md) | Komponenten, Datenflüsse, Betrieb auf dem Mac, Technologie-Entscheidungen | Backend, iOS, Web |
| 03 | [Datenmodell](03-DATENMODELL.md) | Alle Entitäten mit Feldern, Beziehungen, Invarianten | Backend |
| 04 | [Funktionen](04-FUNKTIONEN.md) | Jede Funktion mit Ablauf, Regeln, Sonderfällen und Akzeptanzkriterien | alle |
| 05 | [KI-Pipeline](05-KI-PIPELINE.md) | Alle Verarbeitungsschritte, Algorithmen, Prompt-Vorgaben, Qualitätsregeln | KI/ML, Backend |
| 06 | [Lernmodell & Planer](06-LERNMODELL-PLANER.md) | FSRS-Einbindung, Formeln, Planungsalgorithmus | Backend |
| 07 | [UX & Oberfläche](07-UX.md) | Bildschirme, Navigation, Interaktionsregeln, Zustände, Texte | Design, Web, iOS |
| 08 | [Schnittstellen](08-SCHNITTSTELLEN.md) | REST-API, Sync-Protokoll, Strich-Format, Job-Verträge, Vault-Format | Backend, iOS, Web |
| 09 | [Nicht-funktionale Anforderungen](09-NFA.md) | Leistung, Zuverlässigkeit, Datenschutz, Kosten, Tests | alle |
| 10 | [Umsetzung](10-UMSETZUNG.md) | Repo-Struktur, Phasen, Epics, erstes Backlog, Spikes, Definition of Done | alle |

## Lesereihenfolge

- **Neu im Team:** 01 → 07 (Bildschirme ansehen) → 04 → 10
- **Backend:** 02 → 03 → 08 → 05 → 06
- **iOS (iPad-App):** 02 → 04 (Abschnitte SES, INK, SYN) → 08 (Sync, Strich-Format) → 07 (iPad)
- **Web:** 07 → 04 → 08

## Konventionen in diesem Dokument

| Kennzeichnung | Bedeutung |
|---|---|
| `F-XXX-nn` | Funktions-ID, z. B. `F-INK-03`. Wird in Tickets, Commits und Tests referenziert. |
| **P0 / P1 / P2** | P0 = ohne das kein nutzbares Produkt · P1 = gehört zum Zielbild, kann nach P0 kommen · P2 = später, Architektur soll es nicht verbauen |
| **Phase 0–5** | Umsetzungsphase laut [Kapitel 10](10-UMSETZUNG.md) |
| ○ | Optionale Funktion (vom Nutzer als „schön, aber optional" bestätigt) |
| **M1–M13** | Alltagsmomente aus `docs/STUDIENALLTAG.md`, an denen sich eine Funktion messen lassen muss |
| **LP1–LP12** | Leitprinzipien (siehe [01-PRODUKT](01-PRODUKT.md#5-leitprinzipien)) |
| **MUSS / SOLL / KANN** | Verbindlichkeit einzelner Anforderungen |

## Bereichskürzel der Funktions-IDs

| Kürzel | Bereich |
|---|---|
| ORG | Organisation: Semester, Module, Uploads |
| KAL | Stundenplan & Kalender |
| MDL | Moodle-Anbindung: Inhalte lesen, Abgleich, Aktionen |
| SES | Vorlesungs-Session (Start, Stopp, Zustände) |
| DSH | Dashboard auf dem Mac |
| INK | Schreib-App auf dem iPad |
| SYN | Synchronisation & Uhrzeit |
| AUD | Audioaufnahme |
| NAC | Nacharbeitung & Rückblick |
| BIB | Wissensbibliothek |
| LRN | Lernen |
| PLN | Wochenplaner |
| VID | Lernvideos |
| SUC | Suche & „Frag deine Vorlesung" |
| DAT | Daten, Backups, Export, Kosten |
| EIN | Einstellungen |

## Glossar

| Begriff | Bedeutung |
|---|---|
| **Modul** | Eine Lehrveranstaltung im Semester (z. B. „Datenbanksysteme"), enthält Vorlesungen, Übungen, Klausur |
| **Termin** | Ein Kalendereintrag einer Vorlesung, Übung oder eines Tutoriums |
| **Session** | Die tatsächliche Durchführung eines Termins mit Aufnahme, Notizen und Folienwechseln |
| **Foliensatz / Folie** | Das PDF einer Vorlesung bzw. eine Seite daraus |
| **Übungsblatt / Aufgabe** | PDF mit Übungen bzw. eine einzelne Teilaufgabe (1a, 1b …) |
| **Notizbuch / Seite / Strich** | Handschriftliche Notizen. Eine Seite hängt an einer Session und optional an einer Folie. |
| **Marker** | ❓ nicht verstanden · ⚠️ klausurrelevant · 🔗 erinnert an … – mit Zeitstempel |
| **Konzept** | Ein Wissensbaustein, z. B. „Normalisierung (Datenbanken)". Liegt als Markdown-Notiz im Vault. |
| **Beleg** | Verknüpfung eines Konzepts mit einer Quelle (Folie, Transkript-Abschnitt, Strich-Bereich, Aufgabe) |
| **Vault** | Ordner mit Markdown-Dateien, Obsidian-kompatibel |
| **Inbox** | Warteschlange von KI-Vorschlägen, die der Nutzer bestätigt oder verwirft |
| **Karte** | Eine abfragbare Lerneinheit (Karteikarte, Lückentext, MC, offene Frage …) |
| **FSRS** | Free Spaced Repetition Scheduler, plant Wiederholungen. Details in [06](06-LERNMODELL-PLANER.md). |
| **Beherrschung** | Wert 0–1 pro Konzept, aus den Karten berechnet |
| **Readiness** | Vorhergesagte Beherrschung eines Fachs am Klausurtag |
| **Lernblock** | Vom Planer eingeplanter Zeitraum mit konkretem Inhalt |
| **Core** | Der lokale Server auf dem Mac (API, Sync, Planer, Lernlogik) |
| **Worker** | Der lokale Python-Prozess für die KI-Pipeline |
| **Sitzungszeit** | Zeitachse in Millisekunden, auf die alle Ereignisse einer Session abgebildet werden |
