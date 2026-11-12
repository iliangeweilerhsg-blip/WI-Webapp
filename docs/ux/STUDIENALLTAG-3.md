# UX-Durchlauf 3: Studienalltag mit Direktverbindung und Moodle-Abgabe

> **Stand:** 12.11.2026, Commit `135c769` auf `main`. Der Web-Entwurf zur Abgabe (PR #298) ist noch nicht gemergt und wurde nur gelesen.
> **Zweck:** Den Alltag ein drittes Mal durchspielen. Neu sind die Direktverbindung im Hörsaal (UX-12, #274 bis #276), die Aufnahme in der App-Hülle (#210), die Speicherplatz-Anzeige (#285), die iPad-Restpunkte (#291) und der Anfang der Moodle-Abgabe (#288, #294, #299).
> **Methode:** Anleitungen, Pläne, offene `entscheidung`-Issues und Code gelesen. Nichts wurde ausgeführt, nichts am Gerät oder im Hörsaal gemessen.
> Aussagen mit „nicht geprüft“ sind Annahmen. Abschnitt 7 sammelt sie für den Test am Gerät.
> **Vorgänger:** [`STUDIENALLTAG.md`](STUDIENALLTAG.md) (UX-01 bis UX-42) und [`STUDIENALLTAG-2.md`](STUDIENALLTAG-2.md) (UX-43 bis UX-61). Die neuen Befunde beginnen bei UX-301.
> Dieses Dokument enthält keine Vorlesungsinhalte, keine persönlichen Daten und keine Adressen. Die Module heißen „Modul A“ und „Modul B“.

## Inhalt

1. [Szenarien](#1-szenarien)
2. [Stand der Befunde aus Durchlauf 2](#2-stand-der-befunde-aus-durchlauf-2)
3. [Neue Befunde](#3-neue-befunde)
4. [Belege und Vorschläge je Befund](#4-belege-und-vorschläge-je-befund)
5. [Fragen an den Owner](#5-fragen-an-den-owner)
6. [Die 10 wichtigsten nächsten Schritte](#6-die-10-wichtigsten-nächsten-schritte)
7. [Nicht geprüft](#7-nicht-geprüft)
8. [Was jetzt gut trägt](#8-was-jetzt-gut-trägt)

---

## 1. Szenarien

Jeder Schritt nennt: Was muss passieren? Was macht die App heute? Was kann schiefgehen?
Die IDs verweisen auf Abschnitt 3 (neu) oder auf offene Issues.

### 1.1 Erster Tag nach dem Update

| | |
|---|---|
| **Muss** | `git pull`, `pnpm sg stop`, `pnpm sg start`, Firewall-Frage erlauben, `pnpm sg doctor`, iPad-App neu aufspielen, altes Gerät entfernen, neu koppeln. |
| **Heute** | `sg start` baut den Helfer `sg-tunnel` beim ersten Mal selbst und startet ihn nach dem Core. Fehlt Swift oder scheitert der Bau, läuft der Rest weiter, und das Terminal sagt es. `sg doctor` prüft Programm, Prozess, Zustandsdatei, Schlüsseldatei, Geräte ohne Schlüssel und die Firewall. Das iPad zeigt „Bitte einmal neu koppeln“ als Karte. `IPAD.md` hat dafür einen eigenen Abschnitt. |
| **Kann schiefgehen** | Die Web-App sagt zu alldem nichts. Das alte iPad steht unter Einstellungen → Geräte wie immer da (UX-301). `sg start` meldet „läuft“, auch wenn die Firewall den Helfer sperrt oder noch ein Gerät ohne Schlüssel gekoppelt ist. Das zeigt nur `sg doctor` in einem zweiten Terminal (UX-302). Die Schritte stehen an drei Stellen (UX-303). |

### 1.2 Vorlesung im Hörsaal ohne nutzbares WLAN

| | |
|---|---|
| **Muss** | Mac aufklappen, WLAN an beiden Geräten an, iPad-App öffnen, „Mac ●“ wird grün. Aufnahme starten, Folien folgen, Notizen kommen am Mac an. |
| **Heute** | Das iPad sucht den Mac über Bonjour, erst im gemeinsamen WLAN (2 s), dann direkt (bis 10 s). Die Verbindungsdetails nennen den Weg. Die Offline-Zeile in der Schreibfläche nennt wartende Änderungen, danach steht kurz „Alles am Mac“. Die Aufnahme läuft beim Navigieren weiter, unten steht die Aufnahme-Leiste. Die Statusleiste der Vorlesungs-Ansicht hat einen Punkt „iPad“. |
| **Kann schiefgehen** | Das iPad sperrt sich beim Zuhören von selbst. Danach sucht es den Mac neu, so lange folgt „Auf Folie“ nicht (UX-305). Der Punkt „iPad“ fehlt außerhalb der Vorlesungs-Ansicht (UX-306). Wer das Neukoppeln zu Hause vergessen hat, kann es im Hörsaal nicht nachholen: Koppeln braucht ein gemeinsames Netz (UX-301). Die Folien lädt das iPad erst, wenn die Vorlesung läuft (Frage 4 in #219). Starten am iPad fehlt weiter (UX-29). |

### 1.3 Nach der Vorlesung

| | |
|---|---|
| **Muss** | Transkript, Kurzfassung und Konzepte entstehen. Die Vorlesung ist später wieder auffindbar. |
| **Heute** | Der Rückblick zeigt die Schritte und die Kosten der Vorlesung (#279). ⌘K findet Folien und Gesagtes, auch nach Bedeutung. Die Bibliothek listet Konzepte je Modul. |
| **Kann schiefgehen** | Den Rückblick von gestern erreicht man nur über Umwege: „Heute“ lädt nur die Sessions des Tages, das Modul listet Foliensätze, keine Vorlesungen (UX-307). Im Modul sagt der Tab „Konzepte“ immer „Noch keine Konzepte“ (UX-308). ⌘K kennt keine Konzepte (UX-309). War der Mac zehn Minuten zu, fehlt dieser Teil im Rückblick ohne Hinweis (UX-310). Handschrift ist am Mac weiter nur in der laufenden Vorlesung sichtbar (UX-53, offen). |

### 1.4 Abend: Übungsblatt in Moodle abgeben

| | |
|---|---|
| **Muss** | Lösung wählen, als Entwurf speichern, prüfen, endgültig einreichen. Danach ist klar, dass es angekommen ist. |
| **Heute** | Auf `main` gibt es den Rahmen (Bestätigungscodes, Schalter `SG_MOODLE_ACTIONS`, #294) und den Upload-Speicher (#299). Die Handler `assign.*` (PR 3) und die Seite „Abgabe“ (PR #298) fehlen noch. Abgeben geht heute nur in Moodle selbst. Die Fristenliste zeigt die Fristen. |
| **Kann schiefgehen** | Die Lösung liegt als Handschrift im Notizbuch „Übung“. Daraus wird nirgends eine Datei (UX-311). Die Abgabe ist ausgeschaltet, bis ein Schalter in der `.env` steht. Die Anleitung nennt ihn nicht (UX-312). Läuft der Moodle-Zugang am Fristabend ab, führt der Weg über Terminal und, mit Uni-Anmeldung, über die Safari-Konsole (UX-313). Die Fristenliste sagt nicht, was schon abgegeben ist (UX-314). Umfang und Grenzen: #289. |

### 1.5 Prüfungsvorbereitung

| | |
|---|---|
| **Muss** | Alle Vorlesungen eines Moduls der Reihe nach durchgehen. Konzepte, Notizen und Stellen im Ton wiederfinden. |
| **Heute** | Rückblick mit Folie, Transkript und Player. Suche und Bibliothek wie in 1.3. Notizen liegen geordnet auf dem iPad. |
| **Kann schiefgehen** | Ohne Liste der Vorlesungen gibt es kein „der Reihe nach“ (UX-307). Der Tab „Altklausuren“ lässt nichts ablegen (UX-308). „Lernen“ und „Planer“ sind Platzhalter (#207, UX-37). Handschrift ist nicht durchsuchbar (UX-36). |

### 1.6 Fehlerfälle

| Fall | Heute | Offen |
|---|---|---|
| **Mac zugeklappt** | Keine Aufnahme, die Session bleibt „läuft“. Das iPad schreibt weiter und zeigt „Mac nicht gefunden“. | Grundsatz: #201. Die Lücke ist im Rückblick unsichtbar (UX-310). |
| **Mac-Akku leer** | Höchstens die letzten Sekunden fehlen (`VORLESUNGSTAG.md`). | Vorher warnt nichts (UX-315). |
| **iPad-Akku leer** | Alles Geschriebene liegt auf dem iPad und geht nach dem Laden zum Mac. Die Notizen-Spalte am Mac bleibt stehen. | Seiten, die danach offline entstehen: #239. |
| **Speicher am Mac voll** | „Heute“ warnt vor dem Start. In der Aufnahme steht erst beim Scheitern „(Speicher voll?)“. | Während der Session und am Startknopf fehlt der Hinweis (UX-316). |
| **Speicher am iPad voll** | Ein graues Symbol in der Werkzeugleiste. | Kein Text (UX-317). Notizbuch-Liste: #287. |
| **Moodle-Token abgelaufen** | Ruhige Zeile ab 7 Tagen vorher und nach dem Ablauf. | UX-313. |
| **Falsches Modul** | Keine Korrektur. | #205. Die Seiten auf dem iPad lassen sich nicht verschieben (UX-318). |
| **Mac neu aufgesetzt** | Restore holt Datenbank, Medien und Vault zurück. | Die Tunnel-Schlüssel fehlen, das iPad sagt nur „Mac nicht gefunden“ (UX-304). |

---

## 2. Stand der Befunde aus Durchlauf 2

„Geprüft“ heißt: Die Stelle im Code wurde für diesen Durchlauf gelesen. Sonst gilt der Merge.

| ID | Stand | Beleg |
|---|---|---|
| UX-43, UX-44 | erledigt laut #242, #270 | nicht nachgeprüft. Ruhezeit am Gerät offen (#188, Aufgaben) |
| UX-45 | Frage offen | #239 |
| UX-46 | erledigt, geprüft | `HomeTexts.reconcileLine` in `apps/ipad/Sources/Home/HomeView.swift` (#247) |
| UX-47 | erledigt, geprüft | `HomeTexts.deadLetterCard`, „Fehlerablage teilen“ (#244) |
| UX-48 | erledigt, geprüft | Zustände `macReachable` und `appOutdated` in `App/AppModel.swift` (#244) |
| UX-49 | erledigt, geprüft | `Ink/InkPageTitle.swift`: wartende Änderungen und „Alles am Mac“ (#244) |
| UX-50, UX-51, UX-57, UX-61 | erledigt laut #244 | nicht nachgeprüft |
| UX-52 | erledigt, geprüft | `apps/web/src/components/ModuleNotebooks.tsx` (#243) |
| UX-53 | offen | `ModuleNotebooks.tsx` zeigt Titel und Seitenzahl, keine Seiten. Gehört zu E-NAC |
| UX-54 | Frage offen | #240 |
| UX-55, UX-56 | erledigt laut #254 | `IPAD.md` beschreibt das neue Verhalten |
| UX-58 | erledigt | #241, Anleitungen seither mehrfach nachgezogen |
| UX-59 | erledigt | #210 (#264), Koppeln nur zu Hause bleibt |
| UX-60 | offen | Frage 4 in #219, T1-15 |
| UX-03, UX-10 | erledigt | #278 |
| UX-11 | erledigt, geprüft | `today/StorageHint.tsx`, `settings/StorageInfo.tsx` (#285). Rest: UX-316 |
| UX-12 | gebaut, am Gerät nicht geprüft | #274 bis #276. Hörsaal-Test steht in #188 |
| UX-14, UX-16, UX-17 | erledigt, geprüft | `today/FirstSteps.tsx`, Kosten in `rueckblick/ReviewView.tsx`, Hinweis von `sg start` (#279) |
| UX-42 | erledigt | #292 |
| UX-20 bis UX-28 | Fragen offen | #201 bis #209 |

---

## 3. Neue Befunde

Schwere: **hoch** kostet eine Vorlesung, Daten oder eine Frist, oder es stört täglich. **mittel** kostet Zeit oder führt in die Irre. **niedrig** ist ein Schönheitsfehler.
Aufwand: **klein** bis etwa ein halber Tag, **mittel** ein bis zwei Tage, **groß** mehr.

| ID | Situation | Beobachtung | Schwere | Vorschlag | Aufwand | Owner-Frage |
|---|---|---|---|---|---|---|
| UX-301 | Nach dem Update, am Mac | Die Web-App zeigt weder den Zustand der Direktverbindung noch, dass ein Gerät neu gekoppelt werden muss. | hoch | Zeile „Direktverbindung“ und Marke je Gerät unter Einstellungen → Geräte, ruhiger Hinweis auf „Heute“. | mittel | nein |
| UX-302 | `pnpm sg start` nach dem Update | `sg start` prüft nach dem Start nicht, ob der Helfer wirklich erreichbar ist (Firewall, Gerät ohne Schlüssel, WLAN am Mac aus). | hoch | `sg start` führt die Tunnel-Prüfungen einmal selbst aus und druckt eine Zeile. `sg doctor` prüft zusätzlich das WLAN am Mac. | klein bis mittel | nein |
| UX-303 | Erster Tag nach dem Update | Die Schritte stehen in #188, `UPDATE.md` und `IPAD.md`, dazu zwei Terminals. | niedrig | Eine nummerierte Liste an einer Stelle, die anderen verweisen darauf. | klein | nein |
| UX-304 | Mac neu aufgesetzt oder Datenordner verloren | Die Tunnel-Schlüssel sind nicht im Backup. Das iPad zeigt „Mac nicht gefunden“, die Anleitung verspricht einen Abgleich. | mittel | Anleitung und `sg restore` nennen das Neukoppeln. Das iPad unterscheidet „falscher Schlüssel“ von „nicht gefunden“. | klein | nein |
| UX-305 | Zuhören im Hörsaal, Stift liegt | Das iPad sperrt sich. Nach dem Entsperren dauert der Weg zum Mac bis zu 12 s, so lange folgt die Folie nicht. | hoch | Während einer laufenden Vorlesung den Bildschirm wach halten. Den letzten Weg über eine kurze Sperre merken. | klein, mit Merken mittel | ja |
| UX-306 | Aufnahme läuft, man ist auf „Heute“ oder im Modul | Ob das iPad verbunden ist, steht nur in der Statusleiste der Vorlesungs-Ansicht. | niedrig | Der Punkt „iPad“ auch in der Aufnahme-Leiste. | klein | nein |
| UX-307 | Am nächsten Tag, in der Prüfungsphase | Es gibt keine Liste vergangener Vorlesungen. Der Rückblick ist nur über Umwege erreichbar. | hoch | Im Modul eine Liste der Vorlesungen mit Datum, Dauer und Stand. Auf „Heute“ ein Abschnitt „Zuletzt“. | mittel | nein |
| UX-308 | Modul öffnen | Die Tabs „Konzepte“ und „Altklausuren“ zeigen immer den leeren Zustand. | mittel | „Konzepte“ zeigt die Konzepte des Moduls. „Altklausuren“ ausblenden, bis man dort etwas ablegen kann. | klein | nein |
| UX-309 | ⌘K | Die Suche kennt nur Folien und Gesagtes. Konzepte findet nur das Suchfeld der Bibliothek. | mittel | Konzeptnamen als dritte Gruppe in ⌘K. | klein bis mittel | nein |
| UX-310 | Mac war zu, Tab neu geladen, Mikrofon weg | Lücken in der Aufnahme sind im Rückblick unsichtbar. Der Player springt darüber hinweg. | mittel | Im Transkript eine Zeile „Keine Aufnahme 10:12 bis 10:25“. Im Kopf die Summe. | klein bis mittel | nein |
| UX-311 | Übungsblatt auf dem iPad gelöst | Aus einem Notizbuch wird nirgends eine Datei. Die Abgabe nimmt nur Dateien. | hoch | Am Mac „Als PDF sichern“ je Notizbuch oder Seitenauswahl. Auf der Seite „Abgabe“ direkt aus dem Notizbuch wählen. | mittel bis groß | ja |
| UX-312 | Abgabe zum ersten Mal nutzen | Die Abgabe ist ausgeschaltet. Der Schalter steht nur in Plan und Verträgen. Die Seite sagt es erst nach dem Klick. | mittel | Abschnitt in `MOODLE.md`. Die Seite zeigt den Stand oben, mit „In Moodle öffnen“ als Ausweg. | klein | nein |
| UX-313 | Frist heute Abend, Zugang abgelaufen | Erneuern geht nur im Terminal. Der Hinweis kommt 7 Tage vorher, ohne Blick auf die Fristen. | mittel | Früher warnen, wenn eine Frist nach dem Ablauf liegt. Die Seite „Abgabe“ führt dann nach Moodle. | klein | nein |
| UX-314 | Nach dem Einreichen | Die Fristenliste zeigt nicht, was abgegeben ist. | niedrig | Stand in der Fristenliste („Entwurf“, „eingereicht“). | klein bis mittel | nein |
| UX-315 | Lange Vorlesung ohne Steckdose | Der Mac warnt nicht, wenn sein Akku zur Neige geht. | mittel | Ruhige Zeile in Statusleiste und Aufnahme-Leiste unter 15 %. Kein Dialog. | klein | nein |
| UX-316 | Wenig Platz auf dem Mac | Der Hinweis steht nur auf „Heute“ und nie während einer Session. Der Start prüft nichts. | mittel | Zeile direkt am Startknopf, wenn es nicht für eine Vorlesung reicht. Ruhige Zeile in der Statusleiste unter 1 GB. | klein | nein |
| UX-317 | iPad-Speicher voll, Schreiben in der Vorlesung | Scheitert das Speichern einer Seite, erscheint nur ein graues Symbol. | hoch | Ruhige Infozeile mit Text, wie Empfehlung a in #287. | klein | nein |
| UX-318 | Falsches Modul gestartet oder falsches Notizbuch geöffnet | Seiten lassen sich nicht in ein anderes Notizbuch verschieben. | mittel | Zusammen mit #205 entscheiden. „Seite verschieben nach …“ in der Seitenleiste. | mittel | ja, in #205 |
| UX-319 | Texte lesen | Einige Texte stammen aus der Zeit vor der Direktverbindung. | niedrig | Texte nachziehen. | klein | nein |

**Zählung:** 19 Befunde. 5 × hoch, 9 × mittel, 5 × niedrig. Drei brauchen eine Antwort des Owners.

---

## 4. Belege und Vorschläge je Befund

Regel R1 bleibt: kein Dialog während einer Vorlesung. Swift lässt sich im Container nicht bauen, die Prüfung läuft über die macOS-CI und am Gerät.

### UX-301 · Die Web-App schweigt zur Direktverbindung
- **Beleg:** `apps/web/src/components/settings/DevicesSettings.tsx` zeigt je Gerät Name, „verbunden“, „Zuletzt gesehen“ und „Entfernen“. In `apps/web/src` kommt das Wort „tunnel“ nicht vor. `services/core/src/routes/system.ts` hat keine Tunnel-Auskunft. Den Zustand schreibt der Helfer nur in `<Datenordner>/run/tunnel-state.json`, gelesen wird er nur von `infra/sg/src/tunnel-doctor.ts`. Der Einleitungstext der Karte lautet weiter „Das iPad verbindet sich über das WLAN mit diesem Mac.“
- **Folge:** Wer nach dem Update nur die Web-App öffnet, sieht sein iPad in der Liste und hält alles für gut. Dass neu gekoppelt werden muss, erfährt er erst am iPad. Passiert das im Hörsaal, ist es zu spät: Koppeln geht nur im gemeinsamen Netz (`IPAD.md`, „Erstkopplung“).
- **Vorschlag:**
  1. Der Core liefert lokal eine kleine Auskunft: Helfer läuft ja/nein, Dienste bereit, je Gerät „hat Schlüssel“. Quelle sind die Zustandsdatei und die Geräte-IDs aus dem Schlüsselspeicher. Kein Schlüssel verlässt den Core.
  2. Einstellungen → Geräte: eine Zeile „Direktverbindung: bereit“ oder der Grund. Am Gerät ohne Schlüssel die Marke „Neu koppeln nötig“ mit den drei Schritten.
  3. „Heute“: eine ruhige Zeile, solange ein Gerät ohne Schlüssel gekoppelt ist. Nie während einer Session.
- **Offen:** Neue Route, also Vertrag durch den Lead und Sicherheits-Review.

### UX-302 · `sg start` sagt „läuft“, auch wenn das iPad nicht durchkommt
- **Beleg:** `infra/sg/src/commands.ts`, `start()`: Nach „Studien-Gehirn läuft“ startet `superviseTunnel` den Helfer. Geprüft wird nur, ob der Prozess lebt. `runTunnelChecks` ruft allein `doctor()` auf. Die Firewall-Frage kann nach jedem Neubau wiederkommen (`tunnel-doctor.ts`, `checkFirewall`), und `sg start` öffnet im selben Moment den Browser (`spawn('open', …)`). Die Auswertung von `socketfilterfw --getappblocked` ist laut Kommentar an `parseFirewallBlocked` nicht geprüft. Ob am Mac das WLAN eingeschaltet ist, prüft keine Zeile in `doctor.ts` oder `tunnel-doctor.ts`, obwohl `VORLESUNGSTAG.md` es verlangt.
- **Vorschlag:**
  1. `sg start` wartet nach dem Start des Helfers auf die erste Zustandsdatei und führt `runTunnelChecks` einmal aus. Ausgabe: eine Zeile bei Erfolg, sonst nur die Zeilen mit ✗ samt Abhilfe.
  2. Bei „Geräte ohne Schlüssel“ druckt `sg start` die drei Schritte zum Neukoppeln.
  3. Neue Prüfung „WLAN am Mac eingeschaltet“.
  4. Am Gerät den Wortlaut von `socketfilterfw` festhalten und als Testfall ablegen.
- **Hinweis:** Das ist der Schritt, an dem der wichtigste offene Test in #188 scheitern kann, ohne dass es jemand merkt.

### UX-303 · Die Schritte des ersten Tages stehen an drei Stellen
- **Beleg:** #188 („Wichtigster Test“), `docs/anleitungen/UPDATE.md` (letzter Absatz verweist weiter) und `IPAD.md`, Abschnitt „Nach dem Update: einmal neu koppeln“. `sg start` belegt ein Terminal, `sg doctor` braucht ein zweites.
- **Vorschlag:** `UPDATE.md` bekommt die vollständige nummerierte Liste. #188 und `IPAD.md` verweisen darauf. Mit UX-302 entfällt das zweite Terminal.

### UX-304 · Nach dem Restore fehlen die Tunnel-Schlüssel
- **Beleg:** `infra/sg/src/backup.ts`, Kopfkommentar: `secrets/` ist nicht im Stand (Plan UX-12, E3). `tunnel-doctor.ts` nennt den Fall („aus einem Backup wiederhergestellt“). `docs/anleitungen/BACKUP-WIEDERHERSTELLEN.md` sagt dagegen, das iPad gleiche sich ab, „sobald es sich wieder mit dem Mac verbindet“. In `restore.ts` und `backup-commands.ts` steht kein Hinweis. Auf dem iPad tragen `tunnelMacNotFound` und `tunnelHandshakeFailed` denselben Titel „Mac nicht gefunden“ (`apps/ipad/Sources/Core/ConnectionError.swift`).
- **Folge:** Auf einem neuen Mac oder nach verlorenem Datenordner verbindet sich das iPad nie. Der Titel schickt den Nutzer auf die falsche Fährte. Bleibt der Datenordner erhalten, betrifft es nur Geräte, deren Schlüssel fehlt.
- **Vorschlag:** Absatz in der Anleitung. `sg restore` druckt am Ende „iPad zu Hause neu koppeln, wenn `sg doctor` Geräte ohne Schlüssel meldet“. Auf dem iPad bekommt der gescheiterte Handshake nach mehreren Versuchen einen eigenen Titel, etwa „Schlüssel passt nicht mehr“, mit dem Rat zum Neukoppeln. Zusammen mit UX-301 sieht man es auch am Mac.

### UX-305 · Das iPad sperrt sich beim Zuhören
- **Beleg:** In `apps/ipad/Sources` setzt nichts `isIdleTimerDisabled`. `Tunnel/MacRoute.swift`: `RouteState.idle` gilt bei „App im Hintergrund“. Zurückgesetzt wird der Weg, „wenn die App in den Vordergrund kommt“, mit `wifiSeconds = 2` und `directSeconds = 10`. `Tunnel/TunnelDialer.swift`: Der gemerkte Endpunkt wird bei „Vordergrund, Hintergrund“ vergessen.
- **Folge:** Wer zwei Minuten zuhört, findet ein gesperrtes iPad vor. Nach dem Entsperren sucht es erst im WLAN, dann direkt. Im Modus „Auf Folie“ steht so lange die alte Folie. Das wiederholt sich mehrmals je Vorlesung. Die Dauer ist am Gerät nicht geprüft.
- **Vorschlag:**
  1. Solange eine Vorlesung läuft und die Schreibfläche offen ist, bleibt der Bildschirm an. Endet die Vorlesung oder verlässt man die Schreibfläche, gilt wieder die Systemeinstellung.
  2. Den zuletzt erfolgreichen Weg über eine kurze Sperre merken, damit der Umweg über das WLAN entfällt. Das ändert die Wegewahl aus dem Sicherheits-Review und braucht ein neues.
- **Frage an den Owner:** Abschnitt 5.

### UX-306 · iPad-Punkt nur in der Vorlesungs-Ansicht
- **Beleg:** `apps/web/src/components/dashboard/StatusBar.tsx`, `useIpadConnected` und `data-testid="ipad-status"`. `recording/RecordingBar.tsx` kennt das iPad nicht.
- **Vorschlag:** Derselbe Punkt in der Aufnahme-Leiste. Ohne gekoppeltes iPad bleibt er weg.

### UX-307 · Keine Liste vergangener Vorlesungen
- **Beleg:** `listSessions` wird nur in `today/use-today.ts` aufgerufen, mit dem Zeitraum des Tages und für laufende Sessions. `ModulView.tsx`: Der Tab „Vorlesungen“ zeigt `MaterialPanel` mit der Art `folien` (`TAB_KIND`), also Foliensätze. `CalendarView.tsx` und `CalendarWeek.tsx` verlinken keine Session. `rueckblickHref` kommt nur vor in der Start-Karte von heute, in der Statusleiste nach dem Ende, in der Inbox, in den KI-Einstellungen (Kostenliste), in Suchtreffern und in Konzept-Quellen.
- **Folge:** Der Rückblick der Vorlesung von gestern ist nur zu finden, wenn man einen Begriff daraus sucht oder in der Inbox einen Vorschlag dazu hat. Für die Prüfungsvorbereitung fehlt der Einstieg „alle Vorlesungen von Modul A“.
- **Vorschlag:**
  1. Im Modul ein Tab „Vorlesungen“ mit den Sessions: Datum, Dauer, Stand der Verarbeitung, Link zum Rückblick. Die Foliensätze ziehen in einen Tab „Folien“ um. `GET /sessions` kann laut `services/core/src/routes/sessions.ts` nach `module_id` und Zeitraum filtern.
  2. Auf „Heute“ ein Abschnitt „Zuletzt“ mit den Vorlesungen der letzten sieben Tage.
  3. Im Kalender führt ein vergangener Termin mit Session zum Rückblick.
- **Größe:** mittel. Kein neuer Vertrag, wenn der Filter reicht. Das prüft der Lead.

### UX-308 · Leere Tabs im Modul
- **Beleg:** `ModulView.tsx`: `TAB_KIND` kennt nur `vorlesungen` und `uebungen`. Für „Konzepte“ und „Altklausuren“ rendert `ModuleTabs` immer `EmptyState`. `concepts/LibraryView.tsx` gruppiert Konzepte dagegen schon je Modul (`groupByModule`).
- **Vorschlag:** „Konzepte“ zeigt die Konzepte des Moduls aus derselben Quelle wie die Bibliothek. „Altklausuren“ verschwindet, bis es eine Material-Art dafür gibt (Katalog N12).

### UX-309 · ⌘K ohne Konzepte
- **Beleg:** `apps/web/src/lib/search.ts` bildet zwei Gruppen, `slide` und `transcript`. `services/core/src/services/search.ts` filtert `source_kind` auf diese Arten. `LibraryView.tsx` hat ein eigenes Feld „Name oder Alias“.
- **Vorschlag:** ⌘K sucht zusätzlich in Namen und Aliassen der Konzepte und zeigt sie als Gruppe „Konzepte“. Das ist eine reine Textsuche. Handschrift bleibt UX-36.

### UX-310 · Lücken in der Aufnahme sind unsichtbar
- **Beleg:** `apps/web/src/components/rueckblick/use-player.ts`, Kopfkommentar: „Zwischen Aufnahmen springt der Player zum Beginn der nächsten.“ `ReviewView.tsx` und `TranscriptList.tsx` zeigen keine Lücke. Eine Session kann mehrere Aufnahmen haben („Aufnahme neu begonnen“, Mac-Neustart, zugeklappter Deckel).
- **Folge:** Fehlen zehn Minuten, liest sich das Transkript durchgehend. Das fällt erst in der Prüfungsvorbereitung auf.
- **Vorschlag:** Zwischen zwei Aufnahmen mit mehr als einer Minute Abstand steht im Transkript „Keine Aufnahme 10:12 bis 10:25 (13 min)“. Im Kopf des Rückblicks steht die Summe. Die Zeiten liegen in `transcript.recordings` schon vor.

### UX-311 · Aus Handschrift wird keine Abgabe
- **Beleg:** Kein Export in `apps/ipad/Sources` (die einzigen `ShareLink` teilen die Fehlerablage), keiner in `apps/web/src/components` und keiner in den Routen des Core. Die Seite „Abgabe“ in PR #298 nimmt Dateien per Auswahl oder Ziehen. Das iPad legt je Modul ein Notizbuch „Übung“ an.
- **Folge:** Wer das Blatt auf dem iPad löst, muss außerhalb der App einen Weg zur PDF finden. Die Abgabe aus dem Studien-Gehirn nützt dann nur für getippte Lösungen.
- **Vorschlag:**
  1. Web: „Als PDF sichern“ im Abschnitt „Notizbücher“ des Moduls, für ein Notizbuch oder gewählte Seiten. Der Zeichencode liegt in `apps/web/src/components/ink/render.ts` vor.
  2. Seite „Abgabe“: „Aus Notizbuch wählen“ erzeugt die PDF und lädt sie wie eine Datei hoch.
- **Offen:** Vorlage (Linien) mit ausgeben oder nicht. Seitenformat. Größe der Datei bei vielen Seiten.
- **Frage an den Owner:** Abschnitt 5.

### UX-312 · Die Abgabe ist aus, und niemand sagt, wie sie angeht
- **Beleg:** `services/core/src/config.ts`: `SG_MOODLE_ACTIONS` ist leer, also keine Aktion aus T1-24. Der Schalter steht in `docs/VERTRAEGE.md`, in der Spezifikation und im Plan, nicht in `docs/anleitungen/MOODLE.md`. PR #298 nennt unter „Offene Punkte“: Die Seite zeigt den Zustand erst nach dem Klick („Das ist noch nicht freigeschaltet.“).
- **Vorschlag:** Abschnitt „Abgaben freischalten“ in `MOODLE.md`, mit dem Test an einer folgenlosen Aufgabe (Frage 5 in #289). Die Seite „Abgabe“ zeigt oben eine ruhige Zeile, wenn die Aktion aus ist, und bietet „In Moodle öffnen“ als Hauptknopf. Gehört in PR 4 oder einen direkten Nachfolger, kein eigenes Ticket nötig.

### UX-313 · Moodle-Zugang läuft am Fristabend ab
- **Beleg:** `apps/web/src/components/MoodleAccessHint.tsx` und `lib/moodle.ts` (`accessHintText`): eine Zeile ab 7 Tagen vor dem Ablauf, mit dem Befehl `pnpm sg moodle login`. `docs/anleitungen/MOODLE-TOKEN.md`: Mit Uni-Anmeldung führt der Weg über die JavaScript-Konsole von Safari. Das Ablaufdatum ist geschätzt („heute + 12 Wochen“, `MOODLE.md` Abschnitt 4). Nach der Anmeldung meldet der Core bis zu einer Minute den alten Zustand.
- **Vorschlag:**
  1. Liegt eine bekannte Frist nach dem Ablaufdatum, erscheint der Hinweis schon 14 Tage vorher und nennt die Frist.
  2. Nimmt Moodle den Zugang nicht mehr an, zeigt die Seite „Abgabe“ zuerst „In Moodle öffnen“ und darunter den Weg zum Erneuern.
  3. `sg moodle login` stößt am laufenden Core eine sofortige Prüfung an, damit die Minute entfällt.

### UX-314 · Fristenliste ohne Abgabestand
- **Beleg:** `apps/web/src/components/MoodleDeadlines.tsx` zeigt Fristen nach Datum, ohne Stand. PR #298 lädt den Stand nur auf der Seite „Abgabe“ (`GET /moodle/assignments/{id}/submission`).
- **Vorschlag:** Die Fristenliste zeigt „Entwurf“ oder „eingereicht“, sobald der Core den Stand kennt. Erst nach PR 3 und PR 4 sinnvoll.

### UX-315 · Kein Hinweis auf den Mac-Akku
- **Beleg:** `services/core/src/services/keep-awake.ts` hält den Mac wach, liest aber keinen Akkustand. In `services/core/src` und im Recorder der Web-App gibt es keine Akku-Abfrage. `VORLESUNGSTAG.md` beschreibt nur, was nach dem Ausfall zu tun ist.
- **Vorschlag:** Während einer Session liest der Core alle paar Minuten den Akkustand. Unter 15 % ohne Netzteil steht in Statusleiste und Aufnahme-Leiste „Akku 14 % · Netzteil anschließen“. Kein Ton, kein Dialog.

### UX-316 · Speicherhinweis fehlt am Start und in der Session
- **Beleg:** `apps/web/src/components/today/StorageHint.tsx`: Die Zeile erscheint nur auf „Heute“ und laut Kommentar „nie, solange eine Session läuft oder pausiert“. `today/StartCard.tsx` und der Core prüfen beim Start keinen Speicher. `apps/web/src/lib/recorder/recorder.ts` meldet erst beim Scheitern „Ein Teil der Aufnahme konnte nicht zwischengespeichert werden (Speicher voll?)“. Kann der Core nicht schreiben, steht in der Statusleiste laut Code nur „N Teile warten“ (Wiederholung bei 5xx, `uploader.ts`). Am Gerät nicht geprüft.
- **Vorschlag:** Reicht der Platz nicht für eine Vorlesung (`lecturesThatFit < 1`), steht die Zeile direkt am Startknopf. Fällt der freie Platz während der Session unter 1 GB, steht eine ruhige Zeile in der Statusleiste. Der Start bleibt möglich.

### UX-317 · iPad: Speichern scheitert, nur ein Symbol erscheint
- **Beleg:** `apps/ipad/Sources/Ink/InkPageModel.swift`: `saveFailed`. `Ink/InkPageView.swift` zeigt dann in der Werkzeugleiste das Symbol `externaldrive.badge.exclamationmark` in Grau, mit einem Text nur für VoiceOver („Die Seite konnte nicht gespeichert werden“). #287 fragt denselben Fall nur für die Liste der Notizbücher.
- **Folge:** Das ist der einzige Fall, in dem Striche verloren gehen können. Gerade er ist am leisesten.
- **Vorschlag:** Eine ruhige Infozeile über der Schreibfläche: „Diese Seite wird gerade nicht gespeichert. Speicher auf dem iPad prüfen.“ Sie bleibt, bis das Speichern wieder klappt. Das entspricht Empfehlung a in #287 und kann mit dessen Umsetzung zusammen gebaut werden.

### UX-318 · Seiten lassen sich nicht in ein anderes Notizbuch verschieben
- **Beleg:** `apps/ipad/Sources/Library/InkLibraryService.swift`: `movePage(notebookID:from:to:)` sortiert nur innerhalb eines Notizbuchs. `ModuleNotebooks.tsx` kann anlegen, umbenennen und löschen. #205 fragt nur nach dem Umhängen der Aufnahme.
- **Folge:** Startet man Modul B statt Modul A, liegen die Notizen im Notizbuch von Modul B und bleiben dort, auch wenn die Session später umgehängt wird.
- **Vorschlag:** In #205 mit entscheiden: Hängt man die Session um, wandern die Seiten mit dieser Session mit. Zusätzlich „Seite verschieben nach …“ in der Seitenleiste des iPads. Das berührt den Abgleich (Plan Notizbücher §4.4) und braucht ein Review durch Opus.

### UX-319 · Texte aus der Zeit vor der Direktverbindung
- **Beleg:**
  1. `DevicesSettings.tsx`: „Das iPad verbindet sich über das WLAN mit diesem Mac.“
  2. `apps/ipad/Sources/Home/HomeView.swift`, `HomeTexts.newAddressHint`: „Hat der Mac inzwischen eine andere IP-Adresse? … Kopplung aufheben und neu koppeln.“ Die Zeile erscheint nur ohne Wegewahl (`model.routeState == nil`). Ob dieser Zweig noch erreichbar ist, ist nicht geprüft.
  3. `docs/anleitungen/MOODLE.md` und `MOODLE-TOKEN.md` kennen die Abgabe noch nicht (siehe UX-312).
- **Vorschlag:** Text 1 anpassen („zu Hause über das WLAN, unterwegs direkt“). Zweig 2 prüfen und entfernen, wenn er tot ist.

---

## 5. Fragen an den Owner

Der Lead legt daraus nach dem Review `entscheidung`-Issues an oder ergänzt bestehende.

### UX-305 · Soll das iPad in der Vorlesung wach bleiben?
- a) Ja, solange eine Vorlesung läuft und die Schreibfläche offen ist. **(Empfehlung)** Kostet Akku, die Menge ist nicht gemessen.
- b) Ja, aber abschaltbar in den Einstellungen.
- c) Nein, die Sperre des Systems gilt weiter.

### UX-311 · Gibst du handschriftliche Lösungen ab?
Ergänzt Frage 2 in #289.
- a) Ja, oft. Dann kommt „Als PDF sichern“ vor den Foren. **(Empfehlung, wenn es zutrifft)**
- b) Selten. Dann reicht vorerst der Weg über eine andere App.
- c) Nie, nur getippte Dateien.

### UX-318 · Falsches Modul: Sollen die Notizen mitwandern?
Ergänzt #205.
- a) Ja, beim Umhängen der Session wandern ihre Seiten mit. **(Empfehlung)**
- b) Nein, Seiten verschiebt man einzeln von Hand.
- c) Beides.

Weiter offen und für diesen Durchlauf wichtig: #201 (Mac zugeklappt), #202 (Start ohne Terminal), #207 (Lernen vorziehen), #219 Frage 4 (Folien vorab), #239, #240, #271, #287 und #289.

---

## 6. Die 10 wichtigsten nächsten Schritte

Maßstab: Was spürt der Owner im Alltag zuerst? Der erste Tag nach dem Update und der Hörsaal-Test stehen vorn, weil alles Weitere daran hängt.

| Rang | ID | Schritt | Warum an dieser Stelle | Aufwand |
|---|---|---|---|---|
| 1 | UX-302 | `sg start` prüft die Direktverbindung selbst und sagt, was fehlt. | Der erste Start nach dem Update entscheidet, ob der Hörsaal-Test klappt. Heute fällt eine gesperrte Firewall nicht auf. | klein bis mittel |
| 2 | UX-301 | Die Web-App zeigt „Direktverbindung“ und „Neu koppeln nötig“. | Wer das Neukoppeln erst im Hörsaal bemerkt, hat an dem Tag keinen Sync. | mittel |
| 3 | UX-305 | Das iPad bleibt in der Vorlesung wach. | Stört in jeder Vorlesung mehrmals. Der erste Teil ist klein. | klein |
| 4 | UX-317 | iPad sagt in Worten, wenn eine Seite nicht gespeichert wird. | Der einzige Weg, Striche zu verlieren. | klein |
| 5 | UX-307 | Liste der Vorlesungen im Modul und „Zuletzt“ auf „Heute“. | Ab dem zweiten Tag sucht man den Rückblick von gestern. | mittel |
| 6 | UX-310 | Lücken der Aufnahme im Rückblick zeigen. | Macht den Schaden nach „Mac zugeklappt“ sichtbar, solange #201 offen ist. | klein bis mittel |
| 7 | UX-315, UX-316 | Akku und Speicher in der Statusleiste und am Start. | Beides kostet sonst eine Vorlesung, ohne Vorwarnung. | klein |
| 8 | UX-312, UX-313 | Abgabe: Stand oben auf der Seite, Abschnitt in `MOODLE.md`, Zugang früher erneuern. | Wird am ersten Abgabeabend gebraucht. Am besten mit PR 4. | klein |
| 9 | UX-311 | Notizbuch als PDF, direkt in die Abgabe. | Macht die Abgabe für handschriftliche Lösungen nutzbar. Wartet auf die Antwort des Owners. | mittel bis groß |
| 10 | UX-308, UX-309 | Tab „Konzepte“ im Modul füllen, Konzepte in ⌘K. | Kleine Schritte, die die Prüfungsvorbereitung spürbar verkürzen. | klein bis mittel |

Danach: UX-304, UX-318, UX-314, UX-306, UX-303, UX-319.

**Vorschlag für den Zuschnitt.** Höchstens drei Agents gleichzeitig (#277). Bereiche ohne Überschneidung:

| PR | Inhalt | Bereich | Review |
|---|---|---|---|
| 1 | `sg`: UX-302, UX-303, Hinweis aus UX-304 | `infra/sg/src`, `docs/anleitungen/` | Opus |
| 2 | iPad: UX-305 Teil 1, UX-317, Titel aus UX-304, UX-319 Punkt 2 | `apps/ipad/Sources/Ink`, `Core`, `Home` | Opus |
| 3 | Web: UX-307, UX-308 | `ModulView.tsx`, `today/`, `lib/sessions.ts` | Opus |
| 4 | Web: UX-310, UX-306, UX-316 (Web-Teil) | `rueckblick/`, `recording/`, `dashboard/StatusBar.tsx`, `today/StartCard.tsx` | Opus |
| 5 | Core und Web: UX-301 | neue lokale Route, `settings/DevicesSettings.tsx`, `today/` | Opus, dazu Gegen-Review |
| 6 | Core und Web: UX-315, UX-316 (Core-Teil) | `services/core/src/services`, Statusleiste | Opus |
| 7 | Moodle: UX-312, UX-313, später UX-314 | mit PR 4 von T1-24 | wie T1-24 |
| 8 | Suche: UX-309 | `services/core/src/services/search.ts`, `lib/search.ts` | Opus |

PR 1, 2 und 3 können sofort parallel laufen. PR 5 braucht zuerst den Vertrag. UX-311 und UX-318 warten auf die Antworten.

---

## 7. Nicht geprüft

Diese Punkte lassen sich nur am Gerät oder im Hörsaal klären:

- Ob die Direktverbindung im vollen Hörsaal trägt, wie lange der Aufbau dauert und was sie an Akku kostet (Plan UX-12, Abschnitt 9, Test in #188).
- Wie lange das iPad nach dem Entsperren bis zur Verbindung braucht (UX-305). Laut Code bis zu 2 s und danach bis zu 10 s.
- Der Wortlaut von `socketfilterfw --getappblocked` und ob die Firewall-Frage wirklich nach jedem Neubau wiederkommt (UX-302).
- Ob der Helfer nach dem Aufwachen des Macs seine Dienste von selbst wieder anbietet.
- Ob die Aufnahme nach dem Aufklappen des Macs von selbst weiterläuft oder einen Klick braucht.
- Wie schnell der Foliensatz über die Direktverbindung auf dem iPad ist, wenn die Vorlesung beginnt.
- Wie sich die Direktverbindung mit AirDrop, AirPlay oder einem Hotspot am selben Mac verträgt.
- Ob der Zweig mit `newAddressHint` auf dem iPad noch erreichbar ist (UX-319).
- Alles zur Abgabe am echten Moodle (Plan T1-24, Abschnitt 9.1). Auf `main` fehlen die Handler noch.
- Weiter offen aus den Vorgängern: Ablaufdatum der iPad-App lesen (UX-13), Transkription auf 8 GB (UX-40), Ruhezeit beim Folienwechsel (UX-43).

---

## 8. Was jetzt gut trägt

- Die Direktverbindung braucht kein Netz und keinen Hotspot. Das iPad sucht den Mac über einen Namen, nicht über eine Adresse.
- Ohne Tunnel-Schlüssel geht kein Byte raus. Das iPad sagt klar „Bitte einmal neu koppeln“ und behält Token und Notizen.
- `sg doctor` erklärt jeden Fehler des Helfers mit einem nächsten Schritt.
- Fehlt Swift oder scheitert der Bau des Helfers, startet der Rest trotzdem.
- Die Aufnahme läuft über jede Navigation weiter. Die Aufnahme-Leiste zeigt den Zustand überall.
- Die Schreibfläche nennt wartende Änderungen und meldet „Alles am Mac“.
- Der Speicherplatz steht in den Einstellungen, „Heute“ warnt vor dem Start.
- „Erste Schritte“ auf „Heute“ führt durch Stundenplan, Moodle, Mikrofon, Backup und iPad.
- Der Rückblick nennt die Kosten der Vorlesung.
- Notizbücher lassen sich am Mac anlegen, umbenennen und löschen, mit Rückgängig.
- Die Moodle-Abgabe ist so geplant, dass Endgültiges nur mit Bestätigung geschieht und alles aus bleibt, bis es am echten Moodle getestet ist.
- Die Anleitungen sind auf dem Stand der Direktverbindung, bis auf die Punkte in UX-303, UX-304 und UX-312.
