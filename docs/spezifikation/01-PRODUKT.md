# 01 · Produkt

## 1. Vision

> **Eine App, die jede Vorlesung vollständig erfasst, daraus ein verlinktes Wissensnetz über das ganze Studium baut und mich anhand meines Stundenplans gezielt dort lernen lässt, wo ich schwach bin.**

Das Studien-Gehirn ersetzt das Nebeneinander von LMS-Downloads, GoodNotes, Karteikarten-App, Kalender und losen Notizen. Es verbindet vier Dinge, die heute getrennt sind:

1. **Erfassen** – Folie, Übung, Handschrift und Audio einer Vorlesung, auf eine gemeinsame Zeitachse gebracht.
2. **Verstehen** – Die KI zerlegt das Erfasste in Konzepte und verknüpft sie über Fächer und Semester hinweg.
3. **Behalten** – Fragen und Wiederholung nach FSRS, gemessen pro Konzept.
4. **Planen** – Lernblöcke in den echten freien Lücken der Woche, vorbereitend und nacharbeitend.

## 2. Zielnutzer

**Primärer Nutzer (v1): genau eine Person.** Studierende(r) der Wirtschaftsinformatik, MacBook + iPad mit Apple Pencil. Schreibt bisher in GoodNotes mit und kennt Obsidian. Vorlesungen sind teils deutsch, teils englisch (Annahme, siehe [offene Fragen](10-UMSETZUNG.md#8-offene-fragen--annahmen)). Die Vorlesungen dürfen aufgenommen werden.

**Persona-Kern:**
- Will in der Vorlesung **mitdenken und mitschreiben**, nicht die App bedienen.
- Hat zwischen den Terminen **kurze Lücken** (15–45 min) und will sie sinnvoll nutzen, ohne nachzudenken, was dran ist.
- Ist abends oft müde. Pläne brechen, Abgaben und Klausuren häufen sich zum Semesterende.
- Will ehrlich wissen, **wie gut vorbereitet** er oder sie für eine Klausur ist, ohne Schuldgefühle.

**Später (nicht v1):** weitere Studierende. Das Datenmodell trägt deshalb von Anfang an eine `user_id`, und die Architektur trennt Gerät, Server und Inhalte sauber. Ein Mehrbenutzerbetrieb wird aber nicht gebaut.

## 3. Problem

| Heute | Folge |
|---|---|
| Folien, Übungen, Notizen und Audio liegen getrennt | Zu einer Folie findet man Notiz, Erklärung und Aufgabe nur mühsam |
| Das Gesagte des Profs wird nicht festgehalten | Erklärungen und Klausurhinweise gehen verloren |
| Verbindungen zwischen Fächern stellt man selbst her | Vorwissen wird nicht genutzt, Lücken bleiben unentdeckt |
| Lernen nach Gefühl, kurz vor der Klausur | Viel Aufwand, schlechtes Behalten, keine Kenntnis der eigenen Schwächen |
| Stundenplan und Lernplan sind getrennt | Freie Zeit wird nicht oder falsch genutzt |

## 4. Ziele & Messgrößen

| ID | Ziel | Messgröße | Zielwert | Messung |
|---|---|---|---|---|
| Z1 | In der Vorlesung alles an einem Ort | Anteil Sessions ohne Wechsel in eine andere App (Selbstauskunft im Tagesabschluss) | ≥ 90 % | Wochenrückblick |
| Z2 | Nichts geht verloren | Strich- oder Audioverlust pro Session | 0 Striche · ≤ 30 s Audio | Sync-Protokoll, Audio-Lücken |
| Z3 | Schnell finden | Zeit von Suche bis zur gesuchten Folie/Notiz/Audio-Stelle | < 30 s | Stichproben |
| Z4 | Nacharbeitung wird Gewohnheit | Anteil Vorlesungen, die innerhalb von 24 h nachgearbeitet sind | ≥ 80 % | Session-Status |
| Z5 | Wiederholung bleibt klein | Mittlere tägliche Wiederholungszeit im Semester | ≤ 20 min | Review-Log |
| Z6 | Ehrliche Vorbereitung | Abweichung der Readiness-Prognose vom Ergebnis der Probeklausur | ≤ 15 Prozentpunkte | Probeklausuren |
| Z7 | Startklar in der Vorlesung | Zeit vom Öffnen bis zur laufenden Aufnahme | ≤ 10 s | Telemetrie lokal |

Alle Messgrößen werden **lokal** erfasst. Es gibt keine Telemetrie nach außen.

## 5. Leitprinzipien

Jede Funktion, jeder Bildschirm und jede technische Entscheidung wird gegen diese Prinzipien geprüft. Im Konfliktfall gewinnt das Prinzip mit der kleineren Nummer.

| # | Prinzip | Konsequenz für die Umsetzung |
|---|---|---|
| LP1 | **Null-Reibung in der Vorlesung** | Start mit einem Tipp. Zwischen Start und Stopp ist Schreiben die einzige Pflicht-Interaktion. |
| LP2 | **Schreibgefühl ist nicht verhandelbar** | Native iPad-App mit PencilKit. Latenz, Handballenerkennung und Gesten auf GoodNotes-Niveau. |
| LP3 | **Nichts darf verloren gehen** | Lokal zuerst. Ausgangswarteschlange mit Bestätigung, Aufnahme in Stücken, tägliche Backups, Papierkorb. |
| LP4 | **Disziplin nicht voraussetzen** | Auto-Stopp, folienloser Modus, nachträgliche Folienkorrektur, stilles Neuverteilen verpasster Blöcke |
| LP5 | **Ruhe in der Vorlesung, Intelligenz danach** | Keine Dialoge, Benachrichtigungen oder KI-Ausgaben während einer laufenden Session |
| LP6 | **Aktiv statt passiv** | Nacharbeitung und Lernen bestehen aus Abrufen, Erklären und Anwenden |
| LP7 | **Häppchen von 5–15 Minuten** | Jede Lerneinheit ist unterbrechbar und an der Abbruchstelle fortsetzbar |
| LP8 | **Immer mit Quelle** | Jede KI-Aussage trägt mindestens einen Beleg (Folie, Audio-Stelle, Notiz, Aufgabe) |
| LP9 | **Ehrlicher Fortschritt, kein Schuld-UI** | Keine Streaks, keine roten Rückstandszahlen. Prognosen mit sichtbarer Unsicherheit. |
| LP10 | **Ein Wissensnetz fürs ganze Studium** | Konzepte gehören keinem einzelnen Fach. Links über Semester hinweg. |
| LP11 | **Nur einbauen, was einen Alltagsmoment verbessert** | Jede Funktion nennt ihren Moment M1–M13 |
| LP12 | **Mein Wissen gehört mir** | Markdown-Vault, vollständiger Export, keine proprietären Formate ohne Export |

## 6. Rahmenbedingungen

| Rahmen | Festlegung |
|---|---|
| Geräte | MacBook (Apple Silicon angenommen) + iPad mit Apple Pencil |
| Betrieb | **Lokal auf dem Mac.** Kein Internet-Server in v1. Internet nur für Cloud-KI (abschaltbar). |
| iPad-Verteilung | **Kein Apple-Developer-Account.** iPad-App als `.swiftpm`-Projekt, läuft in Swift Playgrounds oder per Xcode mit 7-Tage-Signatur |
| Netzwerk | Uni-WLAN kann Geräte voneinander isolieren. Die App muss ohne Verbindung zwischen iPad und Mac voll benutzbar bleiben. |
| Aufnahme | Erlaubt. Für spätere Weitergabe an Dritte: Hinweis auf Einwilligungspflicht. |
| Referenz-Apps | Funktionsweisen von GoodNotes, StudySmarter, Quizlet, Anki und Notability werden über öffentliche Quellen recherchiert und **selbst** umgesetzt. Kein fremder Code, kein fremdes Design, keine fremden Marken. |
| Sprache | UI auf Deutsch. Inhalte deutsch und englisch, Fachbegriffe zweisprachig. |
| Budget | Möglichst lokal und kostenlos. Cloud-KI-Kosten pro Vorlesung sichtbar und begrenzbar. |

## 7. Nicht-Ziele (v1)

| Nicht-Ziel | Begründung |
|---|---|
| Mehrbenutzer, Konten, Bezahlung | Zuerst muss es für eine Person funktionieren |
| Zusammenarbeit, Teilen von Notizbüchern | Kein Alltagsmoment verlangt danach |
| Live-Auto-Folienverfolgung | Vom Nutzer abgelehnt (Aufwand für Live-Betrieb). Ersatz: nachträgliche Korrektur ([F-NAC-03](04-FUNKTIONEN.md#f-nac-03--folienzuordnung-nachträglich-korrigieren)) |
| Streaks, Punkte, Gamification | Widerspricht LP9 |
| Community-Lernsets | Eigenes Material ist die Quelle |
| Zweites Moodle (eigene Abgaben, Noten, Foren) | Moodle bleibt der Ort dafür. Die App liest Moodle und bietet einzelne Aktionen an ([F-MDL](04-FUNKTIONEN.md#mdl--moodle-anbindung)). Seit 04.11.2026 ist der automatische Abgleich mit Moodle kein Nicht-Ziel mehr (Owner-Entscheidung) |
| Automatische Quiz-Versuche in Moodle | Prüfungs- bzw. Studienleistung, wird nie automatisiert |
| Android-, Windows-Tablets | Strich-Format ist geräteneutral, aber v1 nur iPad |
| KI-Avatare, „Hollywood"-Videos | Erzählte, animierte Folien reichen didaktisch |
| Laserpointer, Präsentationsmodus, Lernspiele | Kein Lerneffekt im Alltag |

## 8. Alltagsmomente (Kurzfassung)

Ausführlich in `docs/STUDIENALLTAG.md`. Jede Funktion in [Kapitel 04](04-FUNKTIONEN.md) verweist auf diese Momente.

| ID | Moment | Kernanforderung |
|---|---|---|
| M1 | Totzeit nutzen (Zug, Wartezeit) | Wiederholung offline, einhändig, < 5 s startbereit |
| M2 | Startklar in 10 s | Ein Tipp auf „Start", fehlende Folien sind kein Blocker |
| M3 | Mitschreiben ohne Reibung | GoodNotes-Schreibgefühl, Folie blättern per Wisch, Tafel-Foto |
| M4 | Merken, nicht klären | Marker mit einem Tipp |
| M5 | Kurz nachschlagen | ⌘K-Suche in der eigenen Bibliothek |
| M6 | Einfach gehen können | Auto-Stopp, Hintergrundverarbeitung, robust bei Deckel zu |
| M7 | „Sag mir, was jetzt sinnvoll ist" | Ein Vorschlag, geführte Nacharbeitung in Häppchen |
| M8 | Übung ist kein Anhang | Übungsmodus, Lösungsvergleich, Abgaben |
| M9 | Den Tag abschließen | 1-Minuten-Abschluss ohne Rückstandsberg |
| M10 | Sonntagsplanung | Wochenplan zum Abnicken |
| M11 | Plan bricht | Stille Neuplanung |
| M12 | Abhängigkeiten | Warnung, wenn Voraussetzungen fehlen |
| M13 | Verpasste Vorlesung | Fremde/offizielle Aufnahme importieren |
