# UX-Durchlauf 2: Studienalltag mit iPad-Notizbüchern

> **Stand:** 12.11.2026, Commit `a69820e` auf `main`.
> **Zweck:** Den Alltag ein zweites Mal durchspielen, jetzt mit den iPad-Notizbüchern (#223 bis #233). Festhalten, was aus Durchlauf 1 erledigt ist und was neu hakt.
> **Methode:** Anleitungen, Verträge, Plan und Code gelesen. Nichts wurde ausgeführt, nichts am Gerät oder im Hörsaal gemessen.
> Aussagen mit „nicht geprüft“ sind Annahmen. Abschnitt 9 sammelt sie für den nächsten Test am Gerät.
> **Vorgänger:** [`STUDIENALLTAG.md`](STUDIENALLTAG.md) mit UX-01 bis UX-42. Die neuen Befunde beginnen bei UX-43.
> Dieses Dokument enthält keine Vorlesungsinhalte und keine persönlichen Daten. Die Module heißen „Modul A“ und „Modul B“.

## Inhalt

1. [Tagesablauf als Szenario](#1-tagesablauf-als-szenario)
2. [iPad-Notizbuch-Abläufe](#2-ipad-notizbuch-abläufe)
3. [Stand der Befunde aus Durchlauf 1](#3-stand-der-befunde-aus-durchlauf-1)
4. [Neue Befunde](#4-neue-befunde)
5. [Kategorie A: Umsetzungspläne](#5-kategorie-a-umsetzungspläne)
6. [Kategorie B: Fragen an den Owner](#6-kategorie-b-fragen-an-den-owner)
7. [Kategorie C: gehört zu geplanten Tickets](#7-kategorie-c-gehört-zu-geplanten-tickets)
8. [Prioritätenliste und PR-Zuschnitt](#8-prioritätenliste-und-pr-zuschnitt)
9. [Nicht geprüft](#9-nicht-geprüft)
10. [Was jetzt gut trägt](#10-was-jetzt-gut-trägt)

---

## 1. Tagesablauf als Szenario

Jeder Schritt nennt: Was muss passieren? Was macht die App heute? Was kann schiefgehen?
Die IDs verweisen auf Abschnitt 3 (alt) und Abschnitt 4 (neu).

### 1.1 Semesterstart

| | |
|---|---|
| **Muss** | Einmal einrichten: Module, Stundenplan, Moodle, Mikrofon, Backup, iPad. |
| **Heute** | Der Dialog fragt Semester und Module ab. Für den Rest gibt es jetzt `docs/anleitungen/ERSTE-SCHRITTE.md` (#215). `pnpm sg doctor` prüft auch ffmpeg und freien Speicher (#216). Auf dem iPad stehen nach dem Koppeln die Notizbücher „Vorlesung“ und „Übung“ je Modul bereit (#224). |
| **Kann schiefgehen** | Die Web-App selbst führt weiter nicht durch die Einrichtung (UX-14 offen). Einen Mikrofon-Test gibt es nicht (Rest von UX-03). Auf dem iPad stehen oben zwei Platzhalter-Karten ohne Funktion (UX-61). |

### 1.2 Vorabend

| | |
|---|---|
| **Muss** | Laden, prüfen, dass Mac und iPad-App starten. Nichts updaten. |
| **Heute** | `VORLESUNGSTAG.md` nennt die Schritte. Die iPad-App warnt ab 2 Tagen Rest auf dem Startbildschirm (#214). |
| **Kann schiefgehen** | Die Warnung steht nur auf dem Startbildschirm. Wer die App in der Schreibfläche lässt, sieht sie nicht (UX-50). Ein fehlendes Backup fällt weiter nur in den Einstellungen auf (UX-10 offen). Die Anleitungen sind an vier Stellen überholt (UX-58). |

### 1.3 Weg zur Uni, Ankunft

| | |
|---|---|
| **Muss** | Mac aufklappen, App läuft. iPad findet den Mac. |
| **Heute** | Nach einem Neustart braucht es Docker und `pnpm sg start` (UX-21, Frage offen). Der Core hält den Mac während einer Session wach (#213). Das iPad verbindet sich von selbst neu, spätestens alle 30 s (`SyncBackoff`). Ohne Verbindung wählt man das Notizbuch frei und schreibt lokal (#224). |
| **Kann schiefgehen** | Im Hotspot hat der Mac eine andere Adresse. Das iPad kennt nur die alte, es bleibt bei „neu koppeln“ (UX-12 offen). Neu koppeln geht am Mac nur unter Einstellungen → Geräte. Wer dafür die Vorlesungs-Ansicht verlässt, beendet die Aufnahme (UX-59). Ist die iPad-App älter als der Mac, zeigt sie trotzdem „Mac ●“ in Grün (UX-48). |

### 1.4 Vorlesung starten

| | |
|---|---|
| **Muss** | Ein Klick, dann läuft die Aufnahme. Das iPad schreibt ins richtige Notizbuch. |
| **Heute** | Der Klick auf „Start“ gilt als Mikrofon-Wunsch, ein zweiter Klick entfällt meist (#212). Ohne Ton steht „Aufnahme starten“ als Hauptknopf da. Das iPad zeigt die Karte „Läuft gerade: Modul A“ und öffnet das Notizbuch der Session (#223, #224). |
| **Kann schiefgehen** | Das iPad öffnet die **letzte** Seite des Notizbuchs. Das ist die Seite der Vorwoche. Wer nicht selbst weiterblättert, schreibt dort weiter (UX-44). Ohne Verbindung fehlt die Karte „Läuft gerade“, und neue Seiten tragen keine Session (UX-45). Falsches Modul gestartet: weiter keine Korrektur (UX-24, Frage offen). |

### 1.5 Mitschreiben mit iPad und Mac

| | |
|---|---|
| **Muss** | Schreiben wie auf Papier. Folien folgen. Nichts stört. |
| **Heute** | Seiten blättern, anlegen, sortieren, Vorlagen (#227). Modus „Auf Folie“: Das iPad folgt dem Folienwechsel am Mac, die Folie liegt unter der Schrift (#228). Der Mac zeigt die Striche live (#211) und die Folie darunter (#229). |
| **Kann schiefgehen** | Der Folienwechsel wartet nur auf das Absetzen des Stifts. Mitten im Wort springt die Seite (UX-43). Blättern kann nur der Mac, das iPad nicht (UX-32, T1-15). Im isolierten Uni-WLAN geht „Auf Folie“ gar nicht (UX-60). Wer am Mac in die Seitenleiste klickt, beendet weiter die Aufnahme, „Heute“ sagt es jetzt aber ehrlich (UX-01 teilweise). In einem eigenen Notizbuch steht dauerhaft ein Banner, das nicht stimmt (UX-51). |

### 1.6 Pause

| | |
|---|---|
| **Muss** | Pause sichtbar, nichts geht verloren. |
| **Heute** | Die Statusleiste zählt die Pause und fragt nach 20 min „Noch Pause?“ (#212). Rückstau und Neustart der Aufnahme sind sichtbar. Schwere Jobs und das Backup warten während der Session (#213, #221). |
| **Kann schiefgehen** | Auf dem iPad sieht man in der Schreibfläche nicht, wie viel noch nicht am Mac ist (UX-49). |

### 1.7 Nächste Vorlesung

| | |
|---|---|
| **Muss** | Modul B starten, iPad wechselt mit. |
| **Heute** | Die Transkription von Modul A wartet, bis Modul B vorbei ist. Der Rückblick sagt das (#222). Das iPad zeigt in der alten Seite den Knopf „Zur laufenden Vorlesung“ (#214). Der Schreibmodus gilt pro Modul (#228). |
| **Kann schiefgehen** | Bleibt das iPad ohne Verbindung im Vordergrund, zeigt es weiter „Läuft gerade: Modul A“ (UX-57). |

### 1.8 Nachbereitung

| | |
|---|---|
| **Muss** | Transkript, Kurzfassung, Vorschläge, eigene Notizen an einem Ort. |
| **Heute** | Rückblick mit Schrittliste. Die Inbox meldet Fehler verständlich und nimmt große Mengen mit Rückgängig an (#235). |
| **Kann schiefgehen** | Die Handschrift sieht man am Mac nur in der Vorlesungs-Ansicht. Im Rückblick und im Modul fehlt sie (UX-53, UX-35). Notizbücher lassen sich am Mac nicht umbenennen oder löschen, obwohl die Anleitung das sagt (UX-52). Kosten je Vorlesung fehlen weiter (UX-16 offen). |

### 1.9 Wochenende, Backup

| | |
|---|---|
| **Muss** | Backup läuft. iPad-App neu aufspielen. Wiederherstellen klappt, wenn es nötig ist. |
| **Heute** | `BACKUP-WIEDERHERSTELLEN.md` führt durch den Restore. Er übernimmt jetzt auch schreibgeschützte Ziele sauber (#236). Das iPad erkennt einen wiederhergestellten Mac an der neuen `db_epoch`. |
| **Kann schiefgehen** | Das iPad sendet nach dem Restore nur die Seiten neu, die man wieder öffnet. Der Rest fehlt am Mac, ohne Hinweis (UX-46). |

### 1.10 Update

| | |
|---|---|
| **Muss** | `git pull`, starten, iPad-App neu aufspielen, wenn nötig. |
| **Heute** | `UPDATE.md` beschreibt beides. |
| **Kann schiefgehen** | Der Mac sagt weiter nicht, wenn die iPad-App nicht mehr passt (UX-17 offen). Das iPad zeigt es nur in einem Popover (UX-48). |

### 1.11 Prüfungsphase

| | |
|---|---|
| **Muss** | Notizen und Vorlesungen wiederfinden, wiederholen. |
| **Heute** | Die eigenen Notizen liegen geordnet auf dem iPad und gehen offline. Rückblick, Suche und Konzepte wie bisher. |
| **Kann schiefgehen** | Lernen und Planer sind weiter Platzhalter (UX-26, UX-37). Handschrift ist nicht durchsuchbar (UX-36). Offline geschriebene Seiten lassen sich später keiner Vorlesung zuordnen (UX-45). |

---

## 2. iPad-Notizbuch-Abläufe

### 2.1 Eigenes Notizbuch anlegen

- **Ablauf:** Startbildschirm, Karte des Moduls, „+ Notizbuch“, Titel, „Anlegen“. Geht offline (`InkLibraryService.createNotebook`).
- **Gut:** Erst gespeichert, dann eingereiht. Kommt die Verbindung, erscheint es am Mac.
- **Hakt:** Nach „Anlegen“ bleibt man auf der Liste. Scheitert das Speichern, passiert sichtbar nichts. Gleiche Titel sind möglich (UX-56). Umbenennen und Löschen geht nirgends in einer Oberfläche (UX-52).

### 2.2 Offline schreiben

- **Ablauf:** Notizbuch wählen, schreiben. Die Zeile „Offline · schreibt in Modul A · Vorlesung“ steht oben.
- **Gut:** Alles liegt erst auf der Platte, dann in der Warteschlange. Nichts geht verloren.
- **Hakt:** Die Zahl der wartenden Änderungen steht nur im Popover „Mac ●“ auf dem Startbildschirm (UX-49). Seiten, die offline entstehen, tragen keine Session (UX-45). Lehnt der Mac später etwas endgültig ab, verschwindet die Seite aus der Liste (UX-47).

### 2.3 Folie wechselt mitten im Strich

- **Ablauf:** Modus „Auf Folie“. Der Mac blättert, während der Stift auf dem Papier ist.
- **Gut:** Die Seite bleibt stehen, bis der Stift absetzt. Mehrere Wechsel ergeben einen (`SlideSwitchGate`).
- **Hakt:** Zwischen zwei Buchstaben ist der Stift kurz oben. Genau dann springt die Seite (UX-43).

### 2.4 Zweites Gerät

- **Ablauf:** Ein zweites iPad wird gekoppelt, oder die App wird nach dem Löschen neu aufgespielt.
- **Gut:** Jedes Gerät gleicht nur Seiten ab, die es selbst angelegt hat. So löscht kein Gerät fremde Striche (Plan §4.4).
- **Hakt:** Fremde Seiten sind auf dem iPad unsichtbar. Es steht nur „N weitere Seiten liegen nur am Mac“ (UX-54). Am Mac sieht man sie außerhalb einer Vorlesung auch nicht (UX-53).

### 2.5 Seite gelöscht und zurückgeholt

- **Ablauf:** „⋯ → Seite löschen“. 5 s lang „Seite gelöscht · Rückgängig“. Danach liegt sie im Papierkorb am Mac.
- **Gut:** Kein Dialog. Zeichnung und Vorschaubild bleiben auf dem iPad. Der Papierkorb hält 30 Tage.
- **Hakt:** Im Papierkorb heißt der Eintrag „Seite 3 in Vorlesung“, ohne Modul. Nach dem Wiederherstellen am Mac erscheint die Seite auf dem iPad erst nach neuem Öffnen oder Verbinden. War es die letzte Seite, bleibt nach „Rückgängig“ eine leere Seite übrig (UX-55).

### 2.6 App läuft ab (7 Tage)

- **Ablauf:** Ab 2 Tagen Rest steht ein Hinweis auf dem Startbildschirm. Am 7. Tag startet die App nicht mehr.
- **Gut:** Daten und Kopplung bleiben, solange die App nicht gelöscht wird (`IPAD.md`).
- **Hakt:** Der Hinweis fehlt in der Schreibfläche und wird nur beim Erscheinen des Startbildschirms berechnet. Er sagt nicht, ob noch Änderungen warten (UX-50). Ob das iPad das Ablaufdatum lesen kann, ist am Gerät nicht geprüft.

### 2.7 Mac neu gestartet während der Vorlesung

- **Ablauf:** Der Mac startet neu. Docker und `pnpm sg start` von Hand. „Heute“ zeigt „Läuft · ohne Aufnahme“ und „Zur Vorlesung“ (#220). Dort beginnt die Aufnahme neu, in Safari nach einem Klick.
- **Gut:** Die Session bleibt „läuft“, bis die Grenze erreicht ist (`VORLESUNGSTAG.md`). Liegengebliebene Teile lädt der Browser nach. Das iPad schreibt weiter und verbindet sich von selbst.
- **Hakt:** Für diesen Fall gibt es keine Schrittfolge in der Anleitung (UX-58). Der Start kostet Minuten (UX-21). Im Modus „Auf Folie“ bleibt das iPad so lange auf der letzten Folie stehen. Bekommt der Mac eine neue Adresse, hilft nur neu koppeln (UX-12, UX-59).

---

## 3. Stand der Befunde aus Durchlauf 1

**Summe:** 13 erledigt, 5 teilweise, 24 offen. Von den 24 offenen warten 9 auf eine Antwort des Owners (#201 bis #209).

### Kategorie A (UX-01 bis UX-19)

| ID | Stand | Beleg |
|---|---|---|
| UX-01 | teilweise | „Heute“ zeigt „Läuft · ohne Aufnahme“ (#220). Der Recorder hängt weiter an `StatusBar.tsx`. Rest in #210. |
| UX-02 | erledigt | `beforeunload` in `use-recording.ts` (#212). |
| UX-03 | teilweise | Start gilt als Mikrofon-Wunsch, Hauptknopf „Aufnahme starten“ (#212). „Mikrofon testen“ in `LectureSettings.tsx` fehlt. |
| UX-04 | erledigt | `caffeinate` über `keep-awake.ts` (#213). Der Hinweis „Tab verdeckt“ wurde bewusst wieder entfernt (#222). |
| UX-05 | erledigt | Schwere Jobs und Backup warten (#213, #221), Hinweis im Rückblick (#222). |
| UX-06 | erledigt | Rückfrage beim Klick im Dashboard (#212) und auf „Heute“ (#220). |
| UX-07 | erledigt | Pausendauer und „Noch Pause?“ (#212). |
| UX-08 | erledigt | „Teile warten“, „Aufnahme neu begonnen“, „Wird gesichert …“ (#212, #220). |
| UX-09 | erledigt | Knopf „Rückblick“ nach dem Ende (#212). |
| UX-10 | offen | Kein Backup-Hinweis unter `components/today/`. |
| UX-11 | teilweise | `sg doctor` prüft den Speicher (#216). Core und Web-App zeigen ihn nicht. |
| UX-12 | offen | `PairedMacStore.swift` speichert weiter Host und Port fest. |
| UX-13 | erledigt | `ProfileExpiry.swift`, Hinweis auf dem Startbildschirm (#214). Lesen des Profils am Gerät nicht geprüft. Nachbesserung: UX-50. |
| UX-14 | offen | `SetupDialog.tsx` unverändert, keine Liste auf „Heute“. |
| UX-15 | erledigt | Vier Anleitungen (#215). Inzwischen teils überholt: UX-58. |
| UX-16 | offen | `ReviewView.tsx` zeigt keine Kosten. |
| UX-17 | offen | `UPDATE.md`: „Einen Hinweis darauf am Mac gibt es noch nicht.“ |
| UX-18 | erledigt | Text mit Verweis auf „Session ohne Termin“ (#220). |
| UX-19 | erledigt | Modulname im Titel, Offline-Zeile, „Zur laufenden Vorlesung“ (#214), freie Wahl (#224). |

### Kategorie B (UX-20 bis UX-28)

Alle neun sind offen. Die Fragen liegen als Issues #201 bis #209 beim Owner, verlinkt in #188. Gebaut ist jeweils nichts Neues.

### Kategorie C (UX-29 bis UX-42)

| ID | Stand | Beleg |
|---|---|---|
| UX-29 | teilweise | Karte „Läuft gerade“ und Notizbuch-Wahl (#224). Starten am iPad fehlt, „Gleich“ ist Platzhalter (`HomeView.swift`). |
| UX-30 | erledigt | Liste je Modul, Wahl und Anlegen offline (#224, #226). |
| UX-31 | erledigt | Seiten und Vorlagen (#227), Schreibmodi und Folie (#228), Web (#229). |
| UX-32 | offen | T1-15. |
| UX-33 bis UX-38 | offen | Epics E-NAC, E-SUC, E-LRN, E-PLN. |
| UX-39 | offen | Hörsaal-Test steht aus (Aufgaben des Owners in #188). |
| UX-40 | offen | Spike S5. |
| UX-41 | teilweise | Monatsbudget 10 € entschieden (#188). Automatik offen (#189). |
| UX-42 | offen | #174. |

---

## 4. Neue Befunde

Kategorien: **A** sofort umsetzbar · **B** Frage an den Owner · **C** gehört zu einem geplanten Ticket.

| ID | Situation | Problem | Auswirkung | Lösungsvorschlag | Kat. |
|---|---|---|---|---|---|
| UX-43 | „Auf Folie“, der Mac blättert, während geschrieben wird | Die Seite wechselt beim ersten Absetzen des Stifts, also mitten im Wort. Ist der Stift gerade oben, wechselt sie sofort. | hoch | Erst nach einer Schreibpause wechseln. Bis dahin eine ruhige Zeile „Folie 13 · Tippen zum Wechseln“. | A |
| UX-44 | Neue Vorlesung, Notizbuch „Vorlesung“ geöffnet | Es öffnet die letzte Seite. Sie gehört zur Vorwoche und trägt deren Session. | mittel | Beginnt eine Vorlesung und hat die offene Seite Striche aus einer anderen Session, eine neue Seite anhängen und öffnen. | A |
| UX-45 | Im Hörsaal ohne Verbindung geschrieben | Neue Seiten bekommen `session_id = null`. Später fehlt der Bezug zur Vorlesung. | mittel | Entscheidung, ob und wie nachträglich zugeordnet wird. | B |
| UX-46 | Mac aus einem Backup wiederhergestellt | Das iPad sendet nur Seiten neu, die man öffnet. Die Anleitung verspricht mehr. | mittel | Nach neuer `db_epoch` alle betroffenen Seiten im Hintergrund abgleichen und den Fortschritt zeigen. | A |
| UX-47 | Der Mac lehnt eine Operation endgültig ab | Seite oder Notizbuch verschwindet aus der Liste. Der Hinweis steht nur als Zahl im Popover. Zurückspielen geht nicht. | mittel | Ruhiger Hinweis auf dem Startbildschirm mit Erklärung. Die Zeichnung bleibt auf dem iPad. | A |
| UX-48 | iPad-App älter als der Mac, oder nur der Live-Sync hängt | „Mac ●“ ist grün, darunter steht „Offline“. Der Grund steht nur im Popover. | mittel | Grün nur, wenn der Sync läuft. „Anderes Protokoll“ als eigene Zeile mit dem nächsten Schritt. | A |
| UX-49 | Offline geschrieben, Verbindung kommt wieder | In der Schreibfläche sieht man nicht, was noch wartet und wann alles am Mac ist. | niedrig | Die Offline-Zeile nennt die Zahl. Nach dem Senden kurz „Alles am Mac“. | A |
| UX-50 | Die App läuft in 2 Tagen ab | Der Hinweis steht nur auf dem Startbildschirm und wird nur dort berechnet. | mittel | Hinweis auch in der Schreibfläche, neu berechnen beim Aktivieren der App, wartende Änderungen nennen. | A |
| UX-51 | Eigenes Notizbuch während der Vorlesung; Modus „Auf Folie“ zu Hause | Zwei Hinweise stehen dauerhaft da. Der erste stimmt im selben Modul nicht. | niedrig | Banner nur bei anderem Modul und ausblendbar. Folien-Hinweis nur kurz nach dem Umschalten. | A |
| UX-52 | Notizbuch falsch benannt oder überflüssig | Die Anleitung sagt „am Mac“. Die Web-App hat dafür keine Oberfläche. | mittel | Im Modul eine Liste der Notizbücher mit Anlegen, Umbenennen, Löschen. | A |
| UX-53 | Nach der Vorlesung am Mac | Handschrift ist nur in der Vorlesungs-Ansicht sichtbar. | mittel | Gehört zu E-NAC (UX-35). Eine lesende Ansicht im Modul ließe sich mit UX-52 vorziehen. | C |
| UX-54 | Zweites iPad, neues iPad, App gelöscht | Seiten, die das Gerät nicht selbst angelegt hat, sind dort unsichtbar. | mittel | Entscheidung: lesend laden, voll übernehmen oder so lassen. | B |
| UX-55 | Seite gelöscht, später vermisst | Papierkorb-Titel ohne Modul. Rückkehr aufs iPad erst nach neuem Öffnen. Leere Restseite nach „Rückgängig“. | niedrig | Titel mit Modul und Notizbuch. Nach „Rückgängig“ die leere Ersatzseite wieder entfernen. | A |
| UX-56 | Eigenes Notizbuch anlegen | Kein Feedback bei Fehlschlag, kein direktes Öffnen, gleiche Titel möglich. | niedrig | Nach dem Anlegen öffnen. Fehlschlag ruhig melden. Gleichen Titel im Modul ablehnen. | A |
| UX-57 | iPad verliert die Verbindung, die Vorlesung endet | „Läuft gerade“ bleibt stehen, bis die App neu startet oder sich verbindet. Neue Seiten erhalten die alte Session. | niedrig | Ohne Verbindung „Lief zuletzt · Stand 10:42“ statt „Läuft gerade“. | A |
| UX-58 | Anleitungen lesen | `VORLESUNGSTAG.md`, `IPAD.md` und `BACKUP-WIEDERHERSTELLEN.md` passen an vier Stellen nicht mehr zum Code. Der Mac-Neustart fehlt. | mittel | Anleitungen nachziehen. | A |
| UX-59 | Im Hörsaal neu koppeln | Der Weg führt über Einstellungen → Geräte. Wer dafür das Dashboard verlässt, beendet die Aufnahme. | hoch | Gehört zu #210 (Recorder in der App-Hülle) und UX-12. Bis dahin: neuer Tab, in der Anleitung genannt. | C |
| UX-60 | Isoliertes Uni-WLAN | „Auf Folie“ braucht die Verbindung. Folien vorab laden und am iPad blättern fehlt. | hoch | T1-15, Frage 4 in #219. | C |
| UX-61 | Startbildschirm des iPads | Zwei Platzhalter-Karten stehen über den Notizbüchern. | niedrig | Ausblenden, bis sie echt sind. | A |

**Zählung:** 14 × A, 2 × B, 3 × C.

---

## 5. Kategorie A: Umsetzungspläne

Für alle iPad-Punkte gilt: Swift lässt sich im Container nicht bauen (Plan §4.3). Die Prüfung läuft über die macOS-CI, das Schreibgefühl prüft der Owner am Gerät.
Regel R1 bleibt: kein Dialog während einer Vorlesung.

### UX-43 · Folienwechsel mitten im Wort
- **Beleg:** `Slides/SlideSupport.swift`, `SlideSwitchGate.finishTool()` gibt den Wechsel beim Absetzen frei. `slideChanged()` wechselt sofort, wenn der Stift nicht aufliegt. `Ink/InkPageView.swift`: `.onChange(of: gate.releases)` ruft `openSlidePage`. `Ink/InkCanvasView.swift`: `canvasViewDidEndUsingTool` meldet jedes Absetzen.
- **Bereich:** `apps/ipad/Sources/Slides/SlideSupport.swift`, `Ink/InkPageView.swift`, `Tests/InkModeTests.swift`.
- **Plan:**
  1. Das Gate merkt sich den Zeitpunkt des letzten Absetzens. Ein Wechsel gilt erst nach einer Ruhezeit ohne neuen Strich. Vorschlag: 2 s, als Konstante.
  2. Solange ein Wechsel wartet, steht eine Infozeile „Folie 13 · Tippen zum Wechseln“. Ein Tipp wechselt sofort.
  3. War seit dem letzten Wechsel kein Strich, bleibt es beim sofortigen Wechsel.
  4. Tests mit eingespritzter Uhr: Strich, Wechsel, weiterer Strich innerhalb der Ruhezeit, dann Ruhe.
- **Offen:** Der Wert 2 s ist geschätzt. Am Gerät prüfen.
- **Größe:** klein bis mittel.

### UX-44 · Neue Vorlesung schreibt auf die Seite der Vorwoche
- **Beleg:** `InkLibraryService.openTarget()` nimmt `lastPageID`. `VERTRAEGE.md` §7.4: „`page.session_id` setzt das iPad nur beim Anlegen“. `InkPaging.step` legt eine neue Seite nur an, wenn man auf der letzten Seite weiterblättert.
- **Bereich:** `apps/ipad/Sources/Library/InkLibraryService.swift`, `Ink/InkPageView.swift` (`open`, `switchToRunningLecture`, `.onChange(of: library.running)`), `Tests/InkPagesTests.swift`.
- **Plan:**
  1. Neue Funktion im Dienst: Schreibziel für die laufende Vorlesung. Hat die letzte Seite Striche und eine andere `sessionID` als die laufende Session des Moduls, wird eine Seite angehängt (Vorlage und Format wie die letzte).
  2. Das gilt beim Öffnen und wenn die Vorlesung bei offener Seite beginnt. Im zweiten Fall wechselt die Ansicht erst nach der Schreibpause aus UX-43.
  3. Leere Seiten werden weiterverwendet. Im Modus „Auf Folie“ ändert sich nichts.
  4. Der Vertrag bleibt unverändert.
- **Größe:** klein bis mittel.

### UX-46 · Nach dem Restore fehlen ungeöffnete Seiten am Mac
- **Beleg:** `SyncEngine.onWelcome()` ruft `markAllNeedReconcile()`. Abgeglichen wird nur in `InkPageView.reconcileIfNeeded()` für die offene Seite. Kommentar in `InkLibraryService.refreshPages()`: „die Striche folgen beim Öffnen der Seite“. `BACKUP-WIEDERHERSTELLEN.md`: „Das iPad erkennt eine Wiederherstellung und gleicht sich danach neu mit dem Mac ab.“
- **Bereich:** `apps/ipad/Sources/Library/InkLibraryService.swift`, `Sync/SyncEngine.swift`, `Home/HomeView.swift` (`SyncStatusRows`), Tests, danach die Anleitung.
- **Plan:**
  1. Nach einem `welcome` mit neuer `db_epoch` geht der Dienst alle Notizbücher durch: `refreshPages`, dann je Seite mit `needsReconcile` ein Abgleich. Das Seitenmodell wird dafür kurz geladen, wie in `adoptLegacyTestPage()`.
  2. Eine Seite nach der anderen, die offene Seite zuerst. Bricht die Verbindung ab, bleibt das Flag stehen und der nächste `welcome` macht weiter.
  3. Der Startbildschirm zeigt währenddessen „Mac wiederhergestellt · 12 Seiten werden abgeglichen“.
  4. Review durch Opus, weil der Abgleich Striche am Core entfernen kann (Plan §4.4).
- **Größe:** mittel.

### UX-47 · Fehlerablage ist unsichtbar
- **Beleg:** `SyncEngine.deadLetter()` ruft `library.removePage` bzw. `removeNotebook`. `HomeView.swift`, `SyncStatusRows`: „Fehlerablage: N“ und „Ein Wiedereinspielen gibt es noch nicht“ (Kommentar). `InkPageView`: „Dieses Notizbuch ist nicht mehr verfügbar.“
- **Bereich:** `apps/ipad/Sources/Home/HomeView.swift`, `Library/LibraryListView.swift`, `docs/anleitungen/IPAD.md`.
- **Plan:**
  1. Ist `deadLetterCount > 0`, steht auf dem Startbildschirm eine ruhige Karte: „N Änderungen konnte der Mac nicht annehmen. Die Zeichnungen liegen noch auf dem iPad.“ Mit Knopf „Fehlerablage teilen“.
  2. Die Anleitung erklärt, was das heißt und was man mit der Datei tut.
- **Offen:** Ein Zurückspielen ist nicht geplant. Das wäre ein eigenes Ticket.
- **Größe:** klein.

### UX-48 · „Mac ●“ grün, obwohl nichts synchronisiert
- **Beleg:** `AppModel.syncStateChanged()` behandelt nur `.online` und `.tokenInvalid`. Bei `.unsupported` und `.waiting` entscheidet `checkHealth`, das Ergebnis ist `.connected`. `ConnectionBadge` färbt danach. `LibraryListView` nimmt dagegen `sync.state == .online`. Der Text „Der Mac spricht ein anderes Protokoll. App aktualisieren.“ steht nur in `SyncStatusRows`.
- **Bereich:** `apps/ipad/Sources/App/AppModel.swift`, `Core/ConnectionError.swift`, `Home/HomeView.swift`, `Tests/AppModelTests.swift`.
- **Plan:**
  1. `.unsupported` wird ein eigener getrennter Zustand mit Titel und Rat: „App passt nicht mehr zum Mac. Am Mac über Xcode neu aufspielen.“
  2. Das Abzeichen ist nur grün, wenn der Sync online ist. Antwortet der Mac, aber der Sync wartet, steht „Mac erreichbar, Sync verbindet …“.
  3. Bei `.unsupported` steht der Hinweis auch als Karte auf dem Startbildschirm, wie der Ablaufhinweis.
- **Größe:** klein.

### UX-49 · Wartende Änderungen in der Schreibfläche
- **Beleg:** `InkPageView.offlineText` nennt nur Modul und Notizbuch. `SyncEngine.pendingCount` wird nur in `SyncStatusRows` gezeigt.
- **Bereich:** `apps/ipad/Sources/Ink/InkPageView.swift`, `Ink/InkPageTitle.swift`, `Tests`.
- **Plan:** Die Offline-Zeile bekommt den Zusatz „· 37 Änderungen warten“. Wird der Sync online und fällt die Zahl auf 0, steht 3 s lang „Alles am Mac“.
- **Größe:** klein.

### UX-50 · Ablaufhinweis nur auf dem Startbildschirm
- **Beleg:** `HomeView.swift`: `expiryNotice = ProfileExpiry.currentNotice()` nur in `.onAppear`. `InkPageView` kennt den Hinweis nicht. `ProfileExpiry.warnDays = 2`.
- **Bereich:** `apps/ipad/Sources/Home/HomeView.swift`, `Ink/InkPageView.swift`, `Core/ProfileExpiry.swift`, `Tests/ProfileExpiryTests.swift`.
- **Plan:**
  1. Den Hinweis beim Aktivieren der App neu berechnen (`scenePhase == .active`), nicht nur beim Erscheinen.
  2. Am letzten Tag und am Tag davor steht er auch als Infozeile in der Schreibfläche.
  3. Warten noch Änderungen, nennt der Hinweis das: „Vorher mit dem Mac verbinden, 37 Änderungen warten.“
- **Größe:** klein.

### UX-51 · Dauerhinweise in der Schreibfläche
- **Beleg:** `InkBindingCheck.differs()` vergleicht nur Notizbuch-IDs. `VERTRAEGE.md` §11.6: Die Notizen-Spalte folgt einem freien Notizbuch desselben Moduls. Der Text „Diese Seite gehört nicht dazu“ stimmt dann nicht. `InkPageView.slideModeHint` steht, solange „Auf Folie“ gewählt ist und keine Vorlesung läuft.
- **Bereich:** `apps/ipad/Sources/Sync/InkBindingStore.swift`, `Ink/InkPageView.swift`, `Tests/InkBindingTests.swift`.
- **Plan:**
  1. Gleiches Modul: kein Banner.
  2. Anderes Modul: Banner mit „✕“. Ausgeblendet gilt für diese Session.
  3. Der Folien-Hinweis erscheint nur 5 s nach einem Tipp auf den Umschalter. Der ausgegraute Umschalter bleibt.
- **Größe:** klein.

### UX-52 · Notizbücher am Mac verwalten
- **Beleg:** `docs/anleitungen/IPAD.md`: „Umbenennen und Löschen von Notizbüchern geht am Mac.“ `apps/web/src/lib/ink.ts` hat nur `GET`-Aufrufe. `ModulView.tsx` nennt keine Notizbücher. `VERTRAEGE.md` §7.4: `POST`, `PATCH`, `DELETE /notebooks/{id}` gibt es im Core. Frage 3 in #219 setzt den Mac voraus.
- **Bereich:** `apps/web/src/lib/ink.ts`, neue Komponente unter `apps/web/src/components/`, `ModulView.tsx`, Tests. Kein Vertrag betroffen.
- **Plan:**
  1. Abschnitt „Notizbücher“ im Modul: Liste mit Titel und Seitenzahl.
  2. Umbenennen in der Zeile. Löschen ohne Dialog mit „Rückgängig“ über den Papierkorb, wie in der Inbox (#235). „Vorlesung“ und „Übung“ haben kein Löschen (`notebook_default`).
  3. „Notizbuch anlegen“ über `POST /notebooks`.
- **Größe:** mittel.

### UX-55 · Gelöschte Seite wiederfinden
- **Beleg:** `services/core/src/services/trash.ts`: `page: 'Seite ' || index`. `TrashSettings.tsx` zeigt „in <Notizbuch>“. `InkLibraryStore.mergePages()` holt eine am Mac wiederhergestellte Seite erst beim nächsten Abruf zurück. `InkPageView.delete()` ruft bei der letzten Seite `openFreshPage()`, `undoDelete()` lässt die neue Seite stehen.
- **Bereich:** `services/core/src/services/trash-ops.ts` (Titel des Elternobjekts), `apps/ipad/Sources/Ink/InkPageView.swift`, Tests.
- **Plan:**
  1. Der Papierkorb zeigt für Seiten „Seite 3 in Modul A · Vorlesung“.
  2. Nach „Rückgängig“ wird die leere Ersatzseite wieder gelöscht, wenn sie keinen Strich hat.
  3. Anleitung: Nach dem Wiederherstellen am Mac das Notizbuch auf dem iPad neu öffnen.
- **Größe:** klein.

### UX-56 · Notizbuch anlegen
- **Beleg:** `LibraryListView.swift`: `_ = library.createNotebook(...)`, das Ergebnis wird verworfen. `createNotebook` prüft nur auf leeren Titel.
- **Bereich:** `apps/ipad/Sources/Library/LibraryListView.swift`, `Library/InkLibraryService.swift`, `Tests/InkLibraryServiceTests.swift`.
- **Plan:** Nach dem Anlegen das Notizbuch öffnen. Bei `nil` eine ruhige Zeile „Konnte nicht gespeichert werden“. Gibt es den Titel im Modul schon, bleibt „Anlegen“ gesperrt und ein Satz sagt warum.
- **Größe:** klein.

### UX-57 · „Läuft gerade“ ohne Verbindung
- **Beleg:** `SessionFollower.load()`: „Ohne Verbindung bleibt der letzte Stand stehen.“ `LibraryListView` zeigt `RunningCard`, sobald `library.running` gesetzt ist, auch offline. `matchingSession()` gibt neuen Seiten diese Session.
- **Bereich:** `apps/ipad/Sources/Library/LibraryListView.swift`, `Library/InkLibraryService.swift`, Tests.
- **Plan:** Ohne Verbindung heißt die Karte „Lief zuletzt: Modul A · Stand 10:42“. Der Dienst merkt sich dafür den Zeitpunkt der letzten Meldung. Im Modus „Auf Folie“ nennt die Offline-Zeile zusätzlich „Folie folgt gerade nicht“.
- **Größe:** klein.

### UX-58 · Anleitungen nachziehen
- **Beleg und Plan, nur Doku:**
  1. `VORLESUNGSTAG.md`, „Energiesparen“: Der Core hält den Mac während einer Session wach (`keep-awake.ts`, #213). Der Satz „Verlass dich nicht darauf“ ist überholt. Deckel offen bleibt richtig.
  2. `VORLESUNGSTAG.md`, „Beenden“: Auch der Klick fragt jetzt nach (#212, #220).
  3. `VORLESUNGSTAG.md`, neu: Die Vorlesungs-Ansicht nicht verlassen. Für Einstellungen einen neuen Tab öffnen (UX-01, UX-59).
  4. `VORLESUNGSTAG.md`, neuer Abschnitt „Wenn der Mac neu startet“: Docker, `pnpm sg start`, „Zur Vorlesung“, REC prüfen, das iPad verbindet sich selbst.
  5. `IPAD.md`: „Umbenennen und Löschen geht am Mac“ streichen, bis UX-52 da ist.
  6. `BACKUP-WIEDERHERSTELLEN.md`: Nach dem Restore auf dem iPad die Notizbücher öffnen, bis UX-46 da ist.
  7. `IPAD.md`: Was „Fehlerablage“ und „N weitere Seiten liegen nur am Mac“ bedeuten.
- **Größe:** klein.

### UX-61 · Platzhalter auf dem iPad-Startbildschirm
- **Beleg:** `HomeView.swift`: zwei `PlaceholderCard` („Gleich“, „Jetzt sinnvoll“) über `LibraryListView`.
- **Plan:** Beide Karten entfernen, bis Kalender und Wiederholung angebunden sind. Die Notizbücher rücken nach oben.
- **Größe:** sehr klein.

---

## 6. Kategorie B: Fragen an den Owner

### UX-45 · Offline geschriebene Seiten und die Vorlesung
- **Beleg:** `InkLibraryService.matchingSession()` kennt die Session nur aus `running`. Ohne Verbindung nach dem App-Start ist `running` leer. `VERTRAEGE.md` §7.4: `page.session_id` wird nur beim Anlegen gesetzt. Der Rückblick soll später Seiten über `session_id` finden (`VERTRAEGE.md`, Abschnitt zum Rückblick).
- **Frage:** Sollen Seiten, die während einer Vorlesung ohne Verbindung entstanden sind, nachträglich zur Vorlesung gehören?
- **Optionen:**
  - a) Der Core ordnet beim Lesen zu: gleiche Modul-Notizbücher, Striche im Zeitfenster der Session. Kein Eingriff in die Daten.
  - b) Das iPad setzt `session_id` nach, sobald es die Session kennt. Das ändert §7.4.
  - c) Nichts tun. Offline-Seiten stehen nur im Notizbuch.
- **Empfehlung:** a), zusammen mit E-NAC. Bis dahin reicht c). Für dich wichtig, wenn das Uni-WLAN die Geräte trennt.

### UX-54 · Seiten von einem anderen Gerät
- **Beleg:** `InkLibraryStore.mergePages()`: „Eine Seite, die nur am Core liegt, wird nicht zur lokalen Seite.“ `InkPageSidebar.remoteOnlyText()`. Plan §4.4 begründet das mit dem Abgleich.
- **Frage:** Was soll ein iPad mit Seiten tun, die es nicht selbst angelegt hat (zweites iPad, neues iPad, App gelöscht)?
- **Optionen:**
  - a) Lesend anzeigen. Schreiben geht dort nicht.
  - b) Voll übernehmen. Das braucht eine neue Abgleich-Regel und ein Sicherheits-Review.
  - c) So lassen. Die Anleitung sagt klar: App nie löschen, alte Seiten liegen sonst nur am Mac.
- **Empfehlung:** c) jetzt (mit UX-58), a) als eigenes Ticket vor dem ersten Gerätewechsel. Nutzt du nur ein iPad, betrifft es dich erst beim Löschen der App.

Die vier Fragen aus #219 (Blättern, Löschen, Verwalten, Folien vorab) bleiben offen. Gebaut ist jeweils die Empfehlung.

---

## 7. Kategorie C: gehört zu geplanten Tickets

| ID | Ticket | Anmerkung aus dem Durchlauf |
|---|---|---|
| UX-53 | Epic E-NAC (wie UX-35) | Beleg: `InkColumn` wird nur in `dashboard/SessionView.tsx` benutzt. Zusammen mit UX-54 heißt das: Geht das iPad verloren, sieht man alte Notizen nirgends. Eine lesende Ansicht im Modul könnte mit UX-52 vorgezogen werden. Das entscheidet der Lead. |
| UX-59 | #210 und UX-12 | Beleg: Kopplung nur unter Einstellungen → Geräte (`IPAD.md`, Schritt 8). Der Recorder hängt an `StatusBar.tsx`. Die Seitenleiste ist auch in der Vorlesungs-Ansicht da (`AppShell.tsx`). Das hebt #210 in der Reihenfolge nach oben. |
| UX-60 | T1-15, Frage 4 in #219 | Beleg: `InkModeResolver.isAvailable()` verlangt eine laufende Session mit bekannter Folie. Plan §4.5: „Isoliertes Uni-WLAN“. |

---

## 8. Prioritätenliste und PR-Zuschnitt

Maßstab wie in Durchlauf 1: Was kostet eine Vorlesung oder Daten? Danach, was täglich stört.
Die Liste enthält auch die offenen A-Punkte aus Durchlauf 1.

| Rang | ID | Warum an dieser Stelle | Größe |
|---|---|---|---|
| 1 | UX-01 Rest (#210) | Ein Klick aus der Vorlesungs-Ansicht beendet weiter die Aufnahme. UX-59 kommt dazu. | mittel |
| 2 | UX-43 | Stört in jeder Vorlesung mit Folien, mehrmals. | klein bis mittel |
| 3 | UX-46 | Nach einem Restore fehlen Notizen am Mac, ohne dass es jemand merkt. | mittel |
| 4 | UX-50, UX-48 | Die App fällt aus oder synchronisiert nicht, und der Hinweis steht am falschen Ort. | klein |
| 5 | UX-44 | Notizen landen auf der Seite der Vorwoche. | klein bis mittel |
| 6 | UX-58 | Drei Anleitungen passen nicht mehr zum Code. Sehr kleiner Aufwand. | klein |
| 7 | UX-47 | Eine Seite verschwindet ohne Erklärung. Selten. | klein |
| 8 | UX-52 | Vertippte Notizbücher bleiben für immer. | mittel |
| 9 | UX-12 | Hotspot im Hörsaal heißt neu koppeln. Braucht erst ein Prüfverfahren. | mittel |
| 10 | UX-03 Rest, UX-10 | Mikrofon-Test und Backup-Hinweis. | klein |

Danach: UX-49, UX-51, UX-57, UX-55, UX-56, UX-61, UX-11 Rest, UX-14, UX-17, UX-16.

**Vorschlag für die PRs.** Höchstens zwei Agents gleichzeitig. iPad-PRs, die `InkPageView.swift` ändern, laufen nacheinander.

| PR | Inhalt | Bereich | Review |
|---|---|---|---|
| 1 | Doku: UX-58 | `docs/anleitungen/` | Sonnet |
| 2 | iPad „Folie und Seite zur Vorlesung“: UX-43, UX-44 | `Slides/SlideSupport.swift`, `Ink/InkPageView.swift`, `Library/InkLibraryService.swift` | Opus |
| 3 | iPad „Ehrliche Hinweise“: UX-47, UX-48, UX-49, UX-50, UX-51, UX-57, UX-61 | `App/`, `Home/`, `Library/LibraryListView.swift`, Infozeilen in `Ink/InkPageView.swift` | Opus |
| 4 | iPad „Abgleich nach Wiederherstellung“: UX-46 | `Library/InkLibraryService.swift`, `Sync/SyncEngine.swift` | Opus, zusätzlich Gegen-Review |
| 5 | iPad und Core „Kleinigkeiten“: UX-55, UX-56 | `Library/`, `Ink/InkPageView.swift`, `services/core/src/services/trash-ops.ts` | Opus |
| 6 | Web „Notizbücher im Modul“: UX-52 | `apps/web/src/lib/ink.ts`, neue Komponente, `ModulView.tsx` | Opus |
| 7 | Web „Recorder in der App-Hülle“: #210 | wie in Durchlauf 1 beschrieben | Opus |

Reihenfolge: PR 1 sofort. PR 2 und PR 6 parallel (iPad und Web, kein gemeinsamer Bereich). Dann PR 3 und PR 7 parallel. Danach PR 4, zuletzt PR 5.
Die beiden B-Fragen (UX-45, UX-54) gehen als `entscheidung`-Issues an den Owner, verlinkt in #188.

---

## 9. Nicht geprüft

Diese Punkte lassen sich nur am Gerät oder im Hörsaal klären:

- Ob die iPad-App ihr Ablaufdatum auf dem Gerät lesen kann (`ProfileExpiry.currentExpiry`). Offen seit UX-13.
- Wie sich der Folienwechsel beim Schreiben anfühlt und welche Ruhezeit passt (UX-43).
- Ob der Ein-Finger-Wisch zum Blättern beim Schreiben stört (Plan §4.6).
- Wie lange das iPad nach einem Mac-Neustart bis zur Verbindung braucht. Laut Code höchstens 30 s Wartezeit je Versuch.
- Ob der Core Striche einer schon beendeten Session ohne Folgen annimmt (UX-57).
- Was beim Umzug auf ein neues iPad per Geräte-Backup mit Kopplung und Warteschlange passiert (UX-54).
- Wie die Notizen-Spalte am Mac reagiert, wenn zwei iPads gleichzeitig `presence` melden.
- Datenverbrauch im iPhone-Hotspot, wenn der Mac nebenbei ins Internet geht.
- Alles aus UX-39 und UX-40: WLAN-Isolation, Akku, Speicherdruck, Dauer der Transkription.

---

## 10. Was jetzt gut trägt

- Die Aufnahme meldet sich: fehlender Ton, Pause, Rückstau, Neustart und „Gesichert“ stehen in der Statusleiste.
- „Beenden“ und Tab schließen fragen nach. „Heute“ sagt ehrlich, ob aufgenommen wird.
- Der Mac bleibt während der Vorlesung wach. Transkription und Backup warten.
- Das iPad ist offline voll nutzbar: Notizbuch wählen und anlegen, Seiten, Vorlagen, Löschen mit Rückgängig.
- Alles steht erst auf der Platte und dann in der Warteschlange. Ein Absturz kostet keine Striche.
- Der Titel der Schreibfläche nennt Modul und Notizbuch. Nichts wird ungefragt verschoben.
- Ein Folienwechsel unterbricht keinen Strich. Folien liegen geprüft und offline auf dem iPad.
- Ein Konflikt zwischen iPad und Mac löst sich feldweise auf, ohne Fehlerablage.
- Das iPad nimmt Downloads nur vom gekoppelten Mac, mit Größengrenze, und folgt keinen Weiterleitungen (#230, #231).
- Der Restore schließt sich nach einem Abbruch selbst ab oder baut zurück.
