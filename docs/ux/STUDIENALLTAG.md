# UX-Durchlauf: Studienalltag

> **Stand:** 11.11.2026, Commit `29b3603` auf `main`.
> **Zweck:** Den Alltag mit dem Studien-Gehirn Schritt für Schritt durchspielen und festhalten, wo es hakt.
> **Methode:** Spezifikation, Verträge, Anleitungen und den Code gelesen. Nichts wurde ausgeführt und nichts im Hörsaal gemessen.
> Aussagen mit „nicht geprüft“ sind Annahmen. Sie gehören in den nächsten Hörsaal-Test (`docs/tests/hoersaal/VORLAGE.md`).
> **Geräte:** MacBook Air mit 8 GB, iPad Air mit Apple Pencil 2.
> Dieses Dokument enthält keine Vorlesungsinhalte und keine Geheimnisse. Die Module heißen hier „Modul A“ und „Modul B“.

## Inhalt

1. [Tagesablauf als Szenario](#1-tagesablauf-als-szenario)
2. [Befundtabelle](#2-befundtabelle)
3. [Kategorie A: Umsetzungspläne](#3-kategorie-a-umsetzungspläne)
4. [Kategorie B: Fragen an den Owner](#4-kategorie-b-fragen-an-den-owner)
5. [Kategorie C: schon geplante Tickets](#5-kategorie-c-schon-geplante-tickets)
6. [Prioritätenliste Kategorie A](#6-prioritätenliste-kategorie-a)
7. [Was heute schon gut trägt](#7-was-heute-schon-gut-trägt)

---

## 1. Tagesablauf als Szenario

Jeder Schritt beantwortet drei Fragen: Was erwartet der Nutzer? Was macht die App heute? Was kann schiefgehen?
Die IDs in Klammern verweisen auf die Befundtabelle.

### 1.1 Semesterstart

| | |
|---|---|
| **Erwartung** | Einmal einrichten: Fächer, Stundenplan, Moodle, iPad, Backup. Danach läuft es. |
| **Heute** | Beim ersten Start fragt ein Dialog nach Semester und Modulen. Der Kalender nimmt eine ICS-Datei oder eine abonnierte Adresse und schlägt Module vor. Moodle braucht einmal `pnpm sg moodle login` im Terminal. Das iPad koppelt per QR-Code. Das Backup-Ziel steht unter Einstellungen → Daten. |
| **Risiken** | Der Einrichtungsdialog endet nach den Modulen. Kalender, Moodle, Mikrofon, Backup und iPad muss man selbst finden (UX-14). Für Installation, Update und Wiederherstellen gibt es keine Anleitung für den Nutzer (UX-15). Ein geführter Semesterstart ist erst geplant (UX-38). |

### 1.2 Morgen vor der Uni

| | |
|---|---|
| **Erwartung** | Mac aufklappen, App ist da, die heutige Vorlesung steht oben. |
| **Heute** | War der Mac aus, laufen Core, Worker und Datenbank nicht. Der Nutzer öffnet das Terminal und tippt `pnpm sg start`. Docker muss vorher laufen. Die Web-App zeigt sonst „Core nicht erreichbar“ mit dem Startbefehl. |
| **Risiken** | „Startklar in 10 s“ (M2) klappt nach einem Neustart nicht (UX-21). Docker Desktop belegt auf 8 GB spürbar Speicher, nicht geprüft (UX-22). Nach dem Aufwachen holt der Core das nächtliche Backup nach, der Worker verarbeitet Liegengebliebenes. Beides kann in die erste Vorlesung fallen (UX-05). Wer morgens noch schnell `git pull` macht, hat danach womöglich eine iPad-App, die nicht mehr zum Mac passt (UX-17). |

### 1.3 Ankunft im Hörsaal

| | |
|---|---|
| **Erwartung** | Mac und iPad auspacken, beide finden sich. Der Mac darf auch im Rucksack bleiben. |
| **Heute** | Die Web-App spricht nur mit dem Core auf demselben Mac. Das Uni-WLAN ist dafür egal. Das iPad braucht eine Verbindung zum Mac. Isoliert das Uni-WLAN die Geräte, schreibt das iPad lokal und sendet später. Aufgenommen wird nur im Browser auf dem Mac. |
| **Risiken** | Zugeklappt nimmt der Mac nichts auf (UX-20). Im Hotspot hat der Mac eine andere Adresse als zu Hause. Das iPad kennt nur die alte und muss neu gekoppelt werden (UX-12). Ohne Verbindung schreibt das iPad in das **zuletzt benutzte** Notizbuch, also womöglich in das falsche Modul (UX-19, UX-30). Die iPad-App startet nach 7 Tagen nicht mehr (UX-13, UX-25). Der Akku des Macs wird nirgends erwähnt (UX-15). Der Filter des Uni-VPN kann das iPad aussperren. Das steht schon in `docs/anleitungen/IPAD-VERBINDUNG.md`. |

### 1.4 Vorlesung starten

| | |
|---|---|
| **Erwartung** | Ein Tipp auf „Start“, und es wird aufgenommen. |
| **Heute** | Die Start-Karte auf „Heute“ startet die Session und öffnet das Dashboard. Fehlen Folien, geht es ohne. Eine vergessene Session beendet der Core beim Start. Die Aufnahme beginnt von selbst, wenn der Browser das Mikrofon schon freigegeben hat. Sonst steht in der Statusleiste „Mikrofon aus“ und ein Knopf „Aufnahme starten“. |
| **Risiken** | In Safari ist nach „Start“ ein zweiter Klick nötig. Wer ihn übersieht, hat eine Session ohne Ton (UX-03, UX-28). **Falsche Vorlesung erwischt:** Die Session lässt sich nicht in ein anderes Modul umhängen. Beenden stößt die Verarbeitung an und kostet KI-Budget (UX-24). **Zu spät gestartet:** Innerhalb des Termins heißt der Knopf „Jetzt starten“, das passt. Nach Terminende steht nur „Nicht aufgenommen“, ohne nächsten Schritt (UX-18, UX-33). |

### 1.5 Mitschreiben, Folien, Marker

| | |
|---|---|
| **Erwartung** | Auf dem iPad schreiben wie auf Papier. Folien wischen. Marker mit einem Tipp. Der Mac stört nicht. |
| **Heute** | Mac: Folien mit Pfeiltasten und Leertaste, Marker per Taste, ⌘Z nimmt den letzten zurück. Die Notizen-Spalte zeigt die Striche vom iPad. ⌘K sucht, Treffer öffnen in einem neuen Tab. iPad: eine Schreibfläche mit Werkzeugen, Rückgängig und Live-Sync. |
| **Risiken** | Das iPad hat eine Seite je Notizbuch, keine Folie im Hintergrund, keine Marker, kein Foto (UX-31, UX-32). Wer am Mac in der Seitenleiste auf „Heute“ oder „Bibliothek“ klickt, verlässt das Dashboard. Die Aufnahme endet dann still, die Session läuft weiter (UX-01). Die Taste `P` pausiert sofort, auch aus Versehen (UX-07). Vergessene Folienwechsel lassen sich noch nicht korrigieren (UX-34). |

### 1.6 Pause und Störungen

| | |
|---|---|
| **Erwartung** | Nichts geht verloren. Fällt etwas aus, sagt die App das ruhig und macht von selbst weiter. |
| **Heute** | Die Aufnahme liegt in 30-s-Stücken erst im Browser, dann beim Core. Nach Ruhezustand oder getrenntem Mikrofon beginnt der Recorder neu. Der Bildschirm bleibt wach, solange der Tab sichtbar ist. Fällt der Core aus, puffert der Browser weiter. |
| **Risiken** | **Pause:** „Fortsetzen“ vergessen heißt zweite Hälfte ohne Ton. Die Statusleiste zeigt nur grau „Pausiert“ (UX-07). **Tab geschlossen:** keine Rückfrage, die Session läuft ohne Ton weiter (UX-02). **Mac schläft ein:** Liegt ein anderes Fenster vorn, hält nichts den Mac wach (UX-04). **Akku leer:** Verloren gehen höchstens die letzten Sekunden, der Core beendet die Session beim nächsten Start. Das weiß der Nutzer nicht (UX-15). **WLAN weg:** Für den Mac egal, das iPad puffert. **Neustarts und Rückstau** der Aufnahme sieht man nicht (UX-08). |

### 1.7 Ende der Vorlesung

| | |
|---|---|
| **Erwartung** | Zuklappen und gehen. Die App stoppt selbst. |
| **Heute** | „Beenden“ in der Statusleiste oder ⌘⇧S. Der Auto-Stopp greift nach Kalenderende ohne Sprache, spätestens 30 min danach, nach 15 min Stille oder nach 4 h. Der Core setzt die harte Grenze auch dann durch, wenn der Browser zu ist. Vorher steht 60 s lang „Stoppt gleich · weiter aufnehmen“. |
| **Risiken** | Ein Klick auf „Beenden“ fragt nicht nach. Nur das Tastenkürzel tut das. Eine beendete Session lässt sich nicht fortsetzen (UX-06). Nach dem Stopp können noch Teile der Aufnahme im Browser liegen. Wer sofort zuklappt, sieht das nicht (UX-08). Vom beendeten Dashboard führt kein Knopf zum Rückblick (UX-09). |

### 1.8 Danach: Transkript, Konzepte, Inbox, Kosten

| | |
|---|---|
| **Erwartung** | Am Nachmittag ist alles da. Die Kosten bleiben überschaubar. |
| **Heute** | Nach dem Stopp laufen Audio zusammenfügen, Transkription (lokal mit `mlx-whisper`) und Konzepte (Claude-API, Monatsbudget). Der Rückblick zeigt eine ruhige Schrittliste mit „Erneut versuchen“. Vorschläge landen in der Inbox. Die Kosten stehen unter Einstellungen → KI. |
| **Risiken** | Folgt direkt die nächste Vorlesung, transkribiert der Mac die erste, während er die zweite aufnimmt. Auf 8 GB und Akku ist das riskant (UX-05, UX-23). Dauer und Speicherbedarf der Transkription sind auf diesem Mac nicht gemessen (UX-40). Die Kosten je Vorlesung sieht man nicht dort, wo man die Vorlesung ansieht (UX-16). Budget und automatisches Annehmen sind noch nicht entschieden (UX-41). |

### 1.9 Abends lernen

| | |
|---|---|
| **Erwartung** | Vorlesung noch einmal durchgehen, etwas nachschlagen, Konzepte ansehen. |
| **Heute** | Rückblick mit Folie, Transkript, Kurzfassung mit Quellen und Abspielen ab jeder Stelle. ⌘K findet Folien und Gesagtes. Die Bibliothek zeigt Konzepte mit Quellen. |
| **Risiken** | Die eigenen Notizen, Marker und Fotos fehlen im Rückblick (UX-35). Die Suche kennt keine Handschrift (UX-36). „Lernen“ und „Planer“ sind Platzhalter (UX-37, UX-38). |

### 1.10 Prüfungsphase

| | |
|---|---|
| **Erwartung** | Karten, Probeklausur, ehrlicher Stand je Fach. |
| **Heute** | Nichts davon. Es gibt Rückblick, Suche und Konzepte. |
| **Risiken** | Die Klausuren kommen vor Phase 3. Ob ein „Minimal-Lernen“ vorgezogen wird, ist offen (UX-26). |

### 1.11 Betrieb: Speicher, Backup, Update

| | |
|---|---|
| **Erwartung** | Die App meldet sich, bevor es eng wird. Ein Update ist ein Befehl. |
| **Heute** | Tägliches Backup in den Zielordner, monatlicher Restore-Test, Papierkorb. `pnpm sg start` installiert nach `git pull` fehlende Pakete, baut die Web-App und migriert mit Backup davor. |
| **Risiken** | Freien Speicher prüft nichts (UX-11). Fehlt die Backup-Platte, steht das nur unter Einstellungen → Daten (UX-10). Backups sind unverschlüsselt, das Ziel ist noch nicht festgelegt (UX-27). Nach einem Update muss die iPad-App über Xcode neu aufgespielt werden (UX-17). |

### 1.12 Erste Nutzung, Fehler, Wiederherstellen

| | |
|---|---|
| **Erwartung** | Verständliche Meldungen mit dem nächsten Schritt. Ein Weg zurück, wenn etwas kaputt ist. |
| **Heute** | Fehlermeldungen sind ruhig und nennen meist den nächsten Schritt. Das iPad erklärt Verbindungsfehler gut. Wiederherstellen geht nur im Terminal mit `pnpm sg restore`. |
| **Risiken** | Die erste echte Aufnahme ist zugleich der erste Mikrofon-Test (UX-03, UX-14). Für das Wiederherstellen gibt es keine Schritt-für-Schritt-Anleitung (UX-15). |

---

## 2. Befundtabelle

Kategorien: **A** sofort umsetzbar · **B** braucht eine Owner-Entscheidung · **C** gehört zu einem geplanten Ticket.
Die Details zu A stehen in Abschnitt 3, zu B in Abschnitt 4, zu C in Abschnitt 5.

| ID | Situation | Problem | Auswirkung | Lösungsvorschlag | Kat. |
|---|---|---|---|---|---|
| UX-01 | In der Vorlesung am Mac auf „Heute“, „Bibliothek“ oder „Kalender“ geklickt | Die Aufnahme lebt nur im Dashboard. Beim Verlassen endet sie still. „Heute“ zeigt weiter „Läuft“ mit rotem Punkt. | hoch | Recorder in die App-Hülle heben. Sofort: ehrliche Anzeige auf „Heute“. | A |
| UX-02 | Tab oder Fenster während der Aufnahme geschlossen | Keine Rückfrage. Die Session läuft ohne Ton bis zum Auto-Stopp. | hoch | Rückfrage des Browsers beim Schließen, solange aufgenommen wird. | A |
| UX-03 | Start in Safari oder nach zurückgesetzter Freigabe | Nach „Start“ ist ein zweiter Klick „Aufnahme starten“ nötig. „Mikrofon aus“ steht unauffällig grau da. | hoch | Mikrofon schon beim Klick auf „Start“ anfragen. Zustand ohne Ton deutlich zeigen. Mikrofon-Test in den Einstellungen. | A |
| UX-04 | Anderes Fenster liegt vorn, der Nutzer schreibt nur am iPad | Die Wachhalte-Sperre gilt nur im sichtbaren Tab. Der Mac kann einschlafen, die Aufnahme bricht ab. | hoch | Core hält den Mac während einer aktiven Session mit `caffeinate` wach. Hinweis bei verdecktem Tab. | A |
| UX-05 | Zwei Vorlesungen hintereinander, oder Mac morgens aufgeklappt | Worker und Backup starten ohne Rücksicht auf eine laufende Session. Transkription und Aufnahme teilen sich 8 GB. | hoch | Schwere Jobs und geplantes Backup warten, solange eine Session läuft oder pausiert. | A |
| UX-06 | „Beenden“ statt „Pause“ getroffen | Klick beendet sofort. Nur ⌘⇧S fragt nach. Beendet ist endgültig. | mittel | Die vorhandene Rückfrage auch beim Klick zeigen, im Dashboard und auf „Heute“. | A |
| UX-07 | Pause gedrückt (auch versehentlich mit `P`), Fortsetzen vergessen | „Pausiert“ steht grau und ohne Dauer da. Stille-Regel greift in der Pause nicht. | hoch | Pause sichtbar machen: Dauer zählen, nach 20 min ruhiger Hinweis in der Statusleiste. | A |
| UX-08 | Core kurz weg, Mikrofon neu verbunden, Mac war im Ruhezustand | Rückstau, Neustarts und Lücken der Aufnahme zeigt die Statusleiste nicht. Nach dem Stopp fehlt „noch nicht alles gesichert“. | mittel | Kurzer Status „3 Teile warten“ und „Aufnahme neu begonnen“. Nach dem Stopp: „Wird gesichert …“ bis alles oben ist. | A |
| UX-09 | Vorlesung beendet, Dashboard noch offen | Nur „Zu Heute“ und „Zum Modul“. Der Rückblick fehlt als Ziel. | niedrig | Knopf „Rückblick“ in der Statusleiste nach dem Ende. | A |
| UX-10 | Backup-Platte seit Tagen nicht angeschlossen | Der Fehlschlag steht nur unter Einstellungen → Daten. | mittel | Ruhiger Hinweis auf „Heute“, nie während einer Session. | A |
| UX-11 | Platte des Macs fast voll (Aufnahmen, Modell, Docker, Backups) | Niemand prüft den freien Platz. Fehler zeigen sich erst als gescheiterte Jobs. | mittel | Freien Platz in `sg doctor`, in Einstellungen → Daten und als Hinweis auf „Heute“ unter 5 GB. | A |
| UX-12 | Zu Hause gekoppelt, im Hörsaal über den Hotspot verbunden | Das iPad speichert eine feste Adresse. Nach Netzwechsel hilft nur neu koppeln. | mittel | Bei „nicht erreichbar“ den Mac per Bonjour neu suchen und die Adresse aktualisieren. Sicherheits-Review nötig. | A |
| UX-13 | Siebter Tag nach dem Aufspielen der iPad-App | Die App startet nicht mehr. Es gibt keine Vorwarnung. | hoch | Restlaufzeit in der iPad-App anzeigen. Wochenroutine in die Anleitung. | A |
| UX-14 | Erster Start | Nach Semester und Modulen ist Schluss. Kalender, Moodle, Mikrofon, Backup und iPad fehlen als nächste Schritte. | mittel | Liste „Erste Schritte“ auf „Heute“, die sich selbst abhakt und dann verschwindet. | A |
| UX-15 | Installation, Vorlesungstag, Update, Wiederherstellen | Dafür gibt es keine Anleitung für den Nutzer. Netzteil, offener Deckel und Hotspot stehen nirgends. | mittel | Vier kurze Anleitungen unter `docs/anleitungen/`. | A |
| UX-16 | Nach der Verarbeitung | Kosten je Vorlesung stehen nur unter Einstellungen → KI. | niedrig | Eine Zeile im Rückblick: „KI-Kosten dieser Vorlesung: ca. … €“. | A |
| UX-17 | `git pull` kurz vor der Uni | Die iPad-App passt womöglich nicht mehr zum Mac und braucht Xcode. Der Mac warnt nicht. | mittel | `sg start` meldet nach einem Update, wenn die iPad-App neu aufgespielt werden muss. Regel in die Anleitung. | A |
| UX-18 | Termin vorbei, nichts aufgenommen | Die Karte sagt „Nicht aufgenommen“ und bietet nichts an. | niedrig | Satz ergänzen und auf „Session ohne Termin“ zeigen. | A |
| UX-19 | iPad ohne Verbindung geöffnet, oder vor dem Start am Mac | Die Schreibfläche bindet sich nur einmal beim Öffnen. Ohne Verbindung nimmt sie das letzte Notizbuch. Der Titel heißt immer „Vorlesung“. | hoch | Bindung bei neuer Verbindung erneut auflösen. Modulnamen und „offline“ anzeigen. | A |
| UX-20 | Mac bleibt im Rucksack oder wird zugeklappt | Keine Aufnahme. macOS schläft bei geschlossenem Deckel. | hoch | Entscheidung, wie im Hörsaal aufgenommen wird. | B |
| UX-21 | Morgens nach einem Neustart des Macs | Terminal und `pnpm sg start` nötig. Das kostet Minuten. | mittel | Entscheidung über Autostart oder Start per Symbol. | B |
| UX-22 | 8 GB Arbeitsspeicher | Docker Desktop, Browser, Worker und Transkription konkurrieren. Nicht gemessen. | mittel | Entscheidung: Datenbank in Docker oder nativ. | B |
| UX-23 | Verarbeitung nach der Vorlesung auf Akku | Die Transkription startet sofort, auch unterwegs. | mittel | Entscheidung, wann verarbeitet wird. | B |
| UX-24 | Falsche Vorlesung gestartet | Kein Umhängen möglich. Beenden löst Verarbeitung und Kosten aus. | mittel | Entscheidung: umhängen, verwerfen oder beides. | B |
| UX-25 | iPad-App mit 7-Tage-Signatur | Wöchentliches Aufspielen per Kabel und Xcode. | mittel | Entscheidung über ein bezahltes Entwicklerkonto. | B |
| UX-26 | Prüfungsphase | Lernfunktionen fehlen bis Phase 3. | hoch | Entscheidung: Minimal-Lernen vorziehen. | B |
| UX-27 | Backup | Ziel offen (Frage Q5), Sicherung unverschlüsselt. | mittel | Entscheidung über Ziel und Verschlüsselung. | B |
| UX-28 | Browser für die Aufnahme | `sg start` öffnet den Standardbrowser. Safari und Chrome verhalten sich beim Mikrofon verschieden. | mittel | Entscheidung für einen empfohlenen Browser. | B |
| UX-29 | Am iPad starten wollen | Der Startbildschirm zeigt Platzhalter. Start und Notizbuch-Wahl fehlen. | hoch | Geplant. | C |
| UX-30 | Ohne Verbindung im richtigen Modul schreiben | Das iPad kennt keine Liste der Notizbücher. | hoch | Geplant. | C |
| UX-31 | Länger mitschreiben, auf der Folie schreiben | Eine Seite je Notizbuch, keine Vorlagen, keine Folie im Hintergrund. | hoch | Geplant. | C |
| UX-32 | Marker, Tafel-Foto, Folie wischen am iPad | Fehlt. | mittel | Geplant. | C |
| UX-33 | Zu spät gekommen oder Vorlesung verpasst | Fremde oder eigene Aufnahme lässt sich nicht importieren. | mittel | Geplant. | C |
| UX-34 | Folienwechsel am Mac vergessen | Keine nachträgliche Korrektur. | mittel | Geplant. | C |
| UX-35 | Abends im Rückblick | Notizen, Marker und Fotos fehlen dort. Keine geführte Nacharbeitung. | mittel | Geplant. | C |
| UX-36 | Suche | Findet keine Handschrift. Keine Fragen an das eigene Material. | niedrig | Geplant. | C |
| UX-37 | Lernen und Prüfung | Karten, Wiederholung, Probeklausur, Stand je Fach fehlen. | hoch | Geplant. | C |
| UX-38 | Planung und Semesterstart | Planer, Tagesbriefing und Semesterstart-Assistent fehlen. | mittel | Geplant. | C |
| UX-39 | Hörsaal | WLAN-Isolation, Akku, Deckel und Browser sind nicht im Hörsaal gemessen. | hoch | Geplant. | C |
| UX-40 | Transkription auf 8 GB | Dauer und Speicherbedarf auf diesem Mac sind offen. | hoch | Geplant. | C |
| UX-41 | KI-Kosten | Monatsbudget und automatisches Annehmen sind nicht entschieden. | mittel | Liegt als Entscheidung vor. | C |
| UX-42 | `pnpm sg start` zweimal getippt | Ein zweiter Core startet neben dem ersten. | niedrig | Geplant. | C |

---

## 3. Kategorie A: Umsetzungspläne

Alle Punkte halten Regel R1 ein: kein modaler Dialog während einer Session. Hinweise stehen in der Statusleiste.
Wo ein Vertrag oder Schema betroffen ist, legt der Lead die Änderung vorher fest.

### UX-01 · Aufnahme endet beim Verlassen des Dashboards
- **Beleg:** `useSessionRecording` wird nur in `components/dashboard/StatusBar.tsx` benutzt. Beim Abbau räumt der Effekt in `use-recording.ts` den Recorder ab.
- **Bereich:** `apps/web/src/components/dashboard/use-recording.ts`, `StatusBar.tsx`, `AppShell.tsx`, `today/StartCard.tsx`.
- **Plan:**
  1. Recorder und Leader-Steuerung in einen Provider in der App-Hülle heben. Er hängt an der aktiven Session, nicht an der Route.
  2. `StatusBar` liest nur noch den Zustand aus dem Provider.
  3. Die Start-Karte zeigt denselben Zustand: „Läuft · REC“ oder „Läuft · ohne Aufnahme“.
  4. Test: Route wechseln, Aufnahme läuft weiter, Stück-Zähler steigt.
- **Größe:** mittel.

### UX-02 · Tab schließen ohne Rückfrage
- **Beleg:** Im Web-Code gibt es kein `beforeunload`.
- **Bereich:** `apps/web/src/components/dashboard/use-recording.ts` oder der Provider aus UX-01.
- **Plan:** `beforeunload` nur registrieren, solange dieser Tab aufnimmt. Beim Ende der Aufnahme wieder entfernen. Die Rückfrage kommt vom Browser und erscheint nur beim Schließen.
- **Größe:** klein.

### UX-03 · Session ohne Ton nach dem Start
- **Beleg:** `use-recording.ts`: Ohne Freigabe ist der Zustand `needs-start`. Safari kennt die Abfrage der Freigabe nicht, steht dort als Kommentar. Die Statusleiste nutzt außer dem roten Punkt keine Farbe.
- **Bereich:** `today/StartCard.tsx`, `today/SpontaneousStart.tsx`, `dashboard/use-recording.ts`, `dashboard/StatusBar.tsx`, `settings/LectureSettings.tsx`.
- **Plan:**
  1. Der Klick auf „Start“ fragt das Mikrofon an. Das ist eine Nutzeraktion, der Browser erlaubt die Abfrage.
  2. Läuft die Session ohne Ton, steht der Knopf „Aufnahme starten“ als Hauptknopf links in der Statusleiste.
  3. Einstellungen → Vorlesung bekommt „Mikrofon testen“ mit Pegelanzeige.
- **Offen:** Ob die Freigabe in Safari den Wechsel auf das Dashboard übersteht, ist nicht geprüft. Hängt an UX-01 und UX-28.
- **Größe:** klein bis mittel.

### UX-04 · Mac schläft bei verdecktem Tab ein
- **Beleg:** `lib/recorder/wake-lock.ts`: Die Sperre wirkt nur im sichtbaren Tab. `tabHidden` wird gemeldet, aber nicht angezeigt.
- **Bereich:** `services/core/src/services/sessions.ts`, neuer kleiner Dienst im Core, `dashboard/StatusBar.tsx`.
- **Plan:**
  1. Der Core startet `caffeinate -i`, sobald eine Session läuft oder pausiert, und beendet es mit der Session. Nur auf macOS.
  2. Beim Core-Start aufräumen, falls ein alter Prozess übrig ist.
  3. Die Statusleiste zeigt bei verdecktem Tab „Tab verdeckt“.
- **Grenze:** Gegen den geschlossenen Deckel hilft das nicht, siehe UX-20.
- **Größe:** klein bis mittel.

### UX-05 · Schwere Arbeit während einer laufenden Session
- **Beleg:** Die Abhol-Abfrage in `services/worker/src/sg_worker/jobs.py` kennt keine Sessions. `tickBackup` in `services/core/src/services/scheduler.ts` prüft nur Backup und Restore-Test.
- **Bereich:** `services/worker/src/sg_worker/jobs.py`, `services/core/src/services/scheduler.ts`, `docs/VERTRAEGE.md` (§13 und §18, durch den Lead).
- **Plan:**
  1. Der Worker holt `transcribe`, Konzept-Jobs und `maintenance.nightly` nicht ab, solange eine Session `laeuft` oder `pausiert` ist. `audio.finalize` bleibt erlaubt.
  2. Das geplante Backup und der Restore-Test warten genauso. Ein späterer Takt holt sie nach.
  3. Die Schrittliste im Rückblick sagt dann „wartet, bis die Vorlesung vorbei ist“.
- **Größe:** klein bis mittel.

### UX-06 · „Beenden“ ohne Rückfrage
- **Beleg:** `StatusBar.tsx` und `StartCard.tsx` rufen bei Klick direkt `stop` auf. `StopConfirm.tsx` gibt es schon, aber nur für ⌘⇧S.
- **Bereich:** `dashboard/StatusBar.tsx`, `dashboard/SessionView.tsx`, `today/StartCard.tsx`.
- **Plan:** Der Klick öffnet dieselbe Zeile „Session beenden? · Weiter aufnehmen · Session beenden“. Die Aufnahme läuft bis zur Bestätigung weiter.
- **Größe:** klein.

### UX-07 · Vergessene Pause
- **Beleg:** `StatusBar.tsx`: In der Pause steht „Pausiert“ ohne Dauer. `SessionView.tsx`: Taste `P` pausiert ohne weitere Taste.
- **Bereich:** `dashboard/StatusBar.tsx`, `dashboard/use-session.ts`.
- **Plan:**
  1. Den Beginn der Pause im Browser merken und die Dauer zeigen: „Pausiert 12:40“.
  2. Nach 20 min bekommt die Zeile den Zusatz „noch Pause?“. Kein Dialog, kein Ton.
  3. Prüfen, ob `P` ohne Zusatztaste bleiben soll. Vorschlag: bleibt, weil die Pause jetzt sichtbar ist.
- **Größe:** klein.

### UX-08 · Unsichtbarer Rückstau der Aufnahme
- **Beleg:** `RecorderStatus` enthält `upload.pendingChunks`, `restarts` und `error`. `StatusBar.tsx` zeigt die Meldung nur, wenn gerade nicht aufgenommen wird.
- **Bereich:** `dashboard/StatusBar.tsx`.
- **Plan:**
  1. Bei Rückstau: „3 Teile warten“. Nach einem Neustart für 30 s: „Aufnahme neu begonnen“.
  2. Nach dem Stopp: „Wird gesichert …“, danach „Gesichert“. Erst dann ist Zuklappen sicher.
- **Größe:** klein.

### UX-09 · Kein Weg zum Rückblick nach dem Ende
- **Bereich:** `dashboard/StatusBar.tsx`.
- **Plan:** Dritter Knopf „Rückblick“ neben „Zu Heute“ und „Zum Modul“.
- **Größe:** klein.

### UX-10 · Fehlendes Backup bleibt unbemerkt
- **Beleg:** „Backup“ kommt in der Web-App nur in `settings/DataSettings.tsx` vor.
- **Bereich:** `today/HeuteScreen.tsx`, neuer kleiner Hinweis, vorhandene Abfrage `GET /backups`.
- **Plan:** Ist ein Ziel gesetzt und das letzte gelungene Backup älter als 3 Tage, steht auf „Heute“ eine ruhige Zeile mit Link zu Einstellungen → Daten. Nicht, solange eine Session aktiv ist.
- **Größe:** klein.

### UX-11 · Freier Speicher
- **Beleg:** `infra/sg/src/staging.ts` misst freien Platz nur beim Restore. `doctor.ts` prüft ihn nicht.
- **Bereich:** `infra/sg/src/doctor.ts`, `services/core/src/routes/system.ts`, `packages/schemas` (durch den Lead), `settings/DataSettings.tsx`, `today/HeuteScreen.tsx`.
- **Plan:**
  1. `sg doctor` warnt unter 10 GB frei im Datenordner.
  2. Der Core meldet freien Platz und Größe des Datenordners.
  3. Einstellungen → Daten zeigt beide Zahlen. „Heute“ warnt unter 5 GB.
- **Größe:** mittel.

### UX-12 · iPad findet den Mac nach Netzwechsel nicht
- **Beleg:** `apps/ipad/Sources/Core/PairedMacStore.swift` speichert Host und Port fest.
- **Bereich:** `apps/ipad/Sources/Core/PairedMacStore.swift`, `App/AppModel.swift`, `Pairing/MacBrowser.swift`.
- **Plan:** Ist der Mac nicht erreichbar, sucht das iPad per Bonjour und probiert die gefundene Adresse. Die neue Adresse wird erst gespeichert, wenn der Mac sich als der gekoppelte ausweist.
- **Achtung:** Das Token darf nie an einen fremden Rechner gehen. Namen im WLAN sind nicht geprüft. Darum zuerst das Prüfverfahren festlegen, dann ein Sicherheits-Gegen-Review.
- **Größe:** mittel.

### UX-13 · iPad-App läuft nach 7 Tagen ab
- **Beleg:** `docs/anleitungen/IPAD.md`, Abschnitt „Die App läuft nur 7 Tage“. In der App steht dazu nichts.
- **Bereich:** `apps/ipad/Sources/Home/HomeView.swift`, kleine Hilfsdatei, `docs/anleitungen/IPAD.md`.
- **Plan:** Die App liest das Ablaufdatum ihres Profils und zeigt ab 2 Tagen Rest „App läuft noch 2 Tage“. Die Anleitung empfiehlt einen festen Wochentag zum Aufspielen.
- **Offen:** Ob das Profil auf dem Gerät lesbar ist, ist nicht geprüft.
- **Größe:** klein.

### UX-14 · Erste Schritte
- **Beleg:** `SetupDialog.tsx` kennt nur Semester und Module.
- **Bereich:** `today/HeuteScreen.tsx`, neue Komponente unter `today/`.
- **Plan:** Liste mit fünf Punkten: Stundenplan, Moodle, Mikrofon testen, Backup-Ziel, iPad koppeln. Jeder Punkt hakt sich aus vorhandenen Abfragen selbst ab und führt zur passenden Seite. Die Liste lässt sich ausblenden und erscheint nie während einer Session.
- **Größe:** mittel.

### UX-15 · Fehlende Anleitungen
- **Bereich:** `docs/anleitungen/`, nur Doku.
- **Plan:** Vier kurze Dateien:
  1. `ERSTE-SCHRITTE.md`: Installation, `sg doctor`, erster Start, Einrichtung.
  2. `VORLESUNGSTAG.md`: Am Vorabend laden. Netzteil mitnehmen. Deckel offen lassen. Hotspot statt Uni-WLAN, wenn das iPad live spiegeln soll. Nicht am Vorlesungstag updaten. Was bei leerem Akku passiert.
  3. `UPDATE.md`: `git pull`, `pnpm sg start`, iPad-App neu aufspielen.
  4. `BACKUP-WIEDERHERSTELLEN.md`: Ziel wählen, Restore-Test lesen, `pnpm sg restore` Schritt für Schritt, Papierkorb.
- **Größe:** klein.

### UX-16 · Kosten je Vorlesung
- **Beleg:** `CostSummary.by_session` gibt es im Schema. Der Rückblick zeigt keine Kosten.
- **Bereich:** `rueckblick/ReviewView.tsx`, `lib/costs.ts`.
- **Plan:** Unter der Schrittliste eine Zeile mit den geschätzten Kosten dieser Session und Link zu Einstellungen → KI.
- **Größe:** klein.

### UX-17 · Update kurz vor der Uni
- **Beleg:** `HomeView.swift`: „Der Mac spricht ein anderes Protokoll. App aktualisieren.“ Auf dem Mac gibt es keinen Hinweis.
- **Bereich:** `infra/sg/src/commands.ts`, `docs/anleitungen/UPDATE.md`.
- **Plan:** `sg start` merkt sich die Protokollversion des letzten Starts. Hat sie sich geändert, steht im Terminal: „iPad-App neu aufspielen, siehe Anleitung.“
- **Größe:** klein.

### UX-18 · „Nicht aufgenommen“ ohne nächsten Schritt
- **Bereich:** `today/StartCard.tsx`.
- **Plan:** Satz ergänzen: „Läuft die Veranstaltung noch? Dann starte unten eine Session ohne Termin.“ Der Import kommt mit UX-33.
- **Größe:** klein.

### UX-19 · iPad schreibt ins letzte Notizbuch
- **Beleg:** `SyncEngine.resolveBinding()`: „Ohne Verbindung gilt das zuletzt verwendete Notizbuch.“ `InkPageView.open()` löst die Bindung genau einmal auf. Der Titel ist fest „Vorlesung“.
- **Bereich:** `apps/ipad/Sources/Ink/InkPageView.swift`, `Sync/SyncEngine.swift`, `Sync/InkBindingStore.swift`.
- **Plan:**
  1. Den Modulnamen in der Bindung speichern und als Titel zeigen.
  2. Ohne Verbindung eine Zeile: „Offline · schreibt in Modul A“.
  3. Kommt die Verbindung, wird die Bindung neu aufgelöst. Weicht sie ab, bleibt die Seite stehen und ein Knopf „Zur laufenden Vorlesung“ erscheint. Nichts wird ungefragt verschoben.
- **Grenze:** Die freie Wahl des Notizbuchs ohne Verbindung kommt mit UX-30.
- **Größe:** mittel.

---

## 4. Kategorie B: Fragen an den Owner

### UX-20 · Wie nimmst du im Hörsaal auf?
- **Frage:** Soll die Aufnahme auch gehen, wenn der Mac zugeklappt im Rucksack liegt?
- **Optionen:**
  - a) Der Mac steht offen auf dem Tisch. So ist es heute.
  - b) Das iPad nimmt den Ton auf und gibt ihn später an den Mac. Das ist eine neue Funktion mit eigenem Vertrag.
  - c) Ein iPhone oder Aufnahmegerät nimmt auf, die Datei wird importiert (F-SES-06).
- **Empfehlung:** a) für dieses Semester, in der Anleitung klar gesagt. b) als Ticket nach T1-15 prüfen, weil das iPad ohnehin vor dir liegt.

### UX-21 · Start am Morgen
- **Frage:** Soll das Studien-Gehirn ohne Terminal starten?
- **Optionen:**
  - a) Automatisch beim Anmelden am Mac.
  - b) Ein Symbol im Dock oder ein Kurzbefehl startet `pnpm sg start`.
  - c) Terminal wie bisher.
- **Empfehlung:** b). Auf 8 GB soll nichts dauerhaft laufen, was du gerade nicht brauchst.

### UX-22 · Datenbank auf 8 GB
- **Frage:** Bleibt die Datenbank in Docker, oder läuft sie nativ auf dem Mac?
- **Optionen:**
  - a) Docker wie bisher.
  - b) PostgreSQL nativ, Docker entfällt im Alltag.
- **Empfehlung:** Erst messen: im nächsten Hörsaal-Test den Speicherdruck in der Aktivitätsanzeige notieren. Ist er gelb oder rot, dann b).

### UX-23 · Wann wird verarbeitet?
- **Frage:** Soll die Transkription sofort nach der Vorlesung starten, auch auf Akku?
- **Optionen:**
  - a) Sofort, wie heute.
  - b) Nur am Netzteil, mit Knopf „Jetzt trotzdem“ im Rückblick.
  - c) Zu einer festen Uhrzeit am Abend.
- **Empfehlung:** b). Der Akku reicht dann für die nächste Vorlesung. UX-05 gilt unabhängig davon.

### UX-24 · Falsche Vorlesung gestartet
- **Frage:** Was soll passieren, wenn du das falsche Modul erwischt hast?
- **Optionen:**
  - a) Die Session lässt sich nachträglich einem anderen Modul zuordnen. Das braucht eine Vertragsänderung und zieht Notizbuch und Folien nach.
  - b) „Verwerfen“ statt „Beenden“: keine Verarbeitung, keine Kosten, Session im Papierkorb.
  - c) Nichts ändern: beenden, löschen, neu starten.
- **Empfehlung:** b) jetzt, weil es klein ist. a) später zusammen mit der nachträglichen Folienzuordnung.

### UX-25 · iPad-App: bezahltes Entwicklerkonto?
- **Frage:** Bleibst du beim kostenlosen Konto mit 7 Tagen Laufzeit?
- **Optionen:**
  - a) Kostenlos bleiben, wöchentlich neu aufspielen, mit Vorwarnung aus UX-13.
  - b) Bezahltes Konto: die App läuft ein Jahr, das Aufspielen geht ohne Kabel.
- **Empfehlung:** a) bis zum ersten Ausfall im Hörsaal. Passiert er, dann b).

### UX-26 · Lernen vor der Prüfungsphase
- **Frage:** Wird ein Minimal-Lernen vorgezogen (Karten aus den Konzepten und Wiederholung, ohne Planer)? `10-UMSETZUNG.md` §3 sieht das als Möglichkeit vor.
- **Optionen:**
  - a) Ja, vor den restlichen Punkten aus Phase 2.
  - b) Nein, Reihenfolge bleibt.
- **Empfehlung:** a), sobald die Punkte aus Abschnitt 6 erledigt sind. Sonst hilft die App in der ersten Klausurphase nicht beim Lernen.

### UX-27 · Backup-Ziel und Verschlüsselung
- **Frage:** Wohin sichert die App, und reicht eine unverschlüsselte Sicherung?
- **Optionen:**
  - a) Externe Platte, mit macOS verschlüsselt formatiert.
  - b) Ordner in iCloud Drive. Die Aufnahmen liegen dann bei einem Dritten.
  - c) Warten, bis die App selbst verschlüsselt.
- **Empfehlung:** a). Die Platte schützt den Inhalt, die App muss dafür nichts können. Dazu UX-10, damit eine fehlende Platte auffällt.

### UX-28 · Empfohlener Browser
- **Frage:** Safari oder Chrome für die Aufnahme?
- **Optionen:**
  - a) Safari, der Standard auf dem Mac.
  - b) Chrome. Er merkt sich die Mikrofon-Freigabe für die Adresse.
  - c) Beide gleich behandeln.
- **Empfehlung:** Nach dem Test aus Spike S4 einen Browser festlegen. `sg start` öffnet dann genau diesen. Bis dahin b), nicht geprüft.

---

## 5. Kategorie C: schon geplante Tickets

| ID | Ticket | Anmerkung aus dem Durchlauf |
|---|---|---|
| UX-29 | T1-11 (Issue #138) | Start-Karte auf dem iPad fehlt. Bis dahin startet nur der Mac. |
| UX-30 | T1-11 (Issue #138) | Notizbuch-Liste auf dem iPad. Wichtig für das isolierte Uni-WLAN, siehe UX-19. |
| UX-31 | T1-13 | Seiten, Vorlagen, Schreibmodi, Folie als Hintergrund. |
| UX-32 | T1-15 | Marker-Stempel, Tafel-Foto, Folie wischen, Lasso. |
| UX-33 | F-SES-06 (Epic E-NAC) | Aufnahme importieren. |
| UX-34 | F-NAC-03 (Epic E-NAC) | Folienzuordnung nachträglich korrigieren. |
| UX-35 | Epic E-NAC | Rechte Spalte im Rückblick, geführte Nacharbeitung. |
| UX-36 | Epic E-SUC | Handschriftsuche, „Frag deine Vorlesung“. |
| UX-37 | Epic E-LRN | Siehe auch UX-26. |
| UX-38 | Epic E-PLN | Enthält den Semesterstart-Assistenten (N19). |
| UX-39 | T1-20, Spikes T1-00 (S2, S4) | Die Punkte UX-03, UX-04 und UX-12 gehören in das Protokoll. |
| UX-40 | Spike S5 (Issue #145) | Messung auf dem 8-GB-Mac steht aus. Hängt mit UX-05, UX-22 und UX-23 zusammen. |
| UX-41 | Issue #189 | Entscheidung zu Monatsbudget und Automatik. |
| UX-42 | Issue #174 | Zweiten Core-Start früh stoppen. |

---

## 6. Prioritätenliste Kategorie A

Maßstab: Was kostet eine ganze Vorlesung oder Daten? Das kommt zuerst. Danach, was jeden Tag stört.

| Rang | ID | Warum an dieser Stelle | Größe |
|---|---|---|---|
| 1 | UX-03 | Eine Session ohne Ton fällt erst abends auf. | klein bis mittel |
| 2 | UX-01 | Ein Klick in die Seitenleiste beendet die Aufnahme still. | mittel |
| 3 | UX-02 | Ein geschlossener Tab ebenso. Sehr kleine Änderung. | klein |
| 4 | UX-04 | Der Mac schläft ein, während nur am iPad geschrieben wird. | klein bis mittel |
| 5 | UX-07 | Vergessene Pause kostet die halbe Vorlesung. | klein |
| 6 | UX-05 | Schützt die Aufnahme auf 8 GB bei zwei Vorlesungen hintereinander. | klein bis mittel |
| 7 | UX-19 | Notizen landen ohne Verbindung im falschen Modul. | mittel |
| 8 | UX-06 | Versehentliches Beenden ist endgültig. | klein |
| 9 | UX-08 | Zuklappen vor dem Sichern der letzten Teile. | klein |
| 10 | UX-13 | Die iPad-App fällt ohne Vorwarnung aus. | klein |

Danach in dieser Reihenfolge: UX-15, UX-10, UX-14, UX-11, UX-12, UX-17, UX-09, UX-16, UX-18.

**Vorschlag für den Zuschnitt:**
- Ein PR „Aufnahme absichern“: UX-01, UX-02, UX-03, UX-08, UX-09.
- Ein PR „Statusleiste: Pause und Beenden“: UX-06, UX-07.
- Ein PR „Core und Worker: Ruhe in der Vorlesung“: UX-04, UX-05.
- Ein PR „iPad: Bindung und Ablaufdatum“: UX-13, UX-19.
- Ein Doku-PR: UX-15.

---

## 7. Was heute schon gut trägt

Damit die Befunde richtig eingeordnet werden:

- Die Aufnahme übersteht Core-Ausfall, Neuladen, getrenntes Mikrofon und Ruhezustand. Sie beginnt von selbst neu.
- Der Auto-Stopp hat eine harte Grenze im Core. Eine vergessene Session endet auch ohne Browser.
- Eine vergessene Session blockiert den nächsten Start nicht.
- In der Session gibt es keine Dialoge. Die Suche öffnet Treffer in einem neuen Tab.
- Das iPad puffert ohne Verbindung und erklärt Verbindungsfehler verständlich.
- Fehlende Folien, fehlende KI und erreichtes Budget sind ruhige Zustände, keine Fehler.
- `pnpm sg start` erledigt nach `git pull` Pakete, Build und Migration mit Backup davor.
- Der monatliche Restore-Test prüft, ob das Backup wirklich taugt.
