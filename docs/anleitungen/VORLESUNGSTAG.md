# Vorlesungstag

Diese Liste hilft, dass die Aufnahme in der Vorlesung durchläuft. Sie gilt für den Mac, auf dem das Studien-Gehirn läuft.

## Am Vorabend

1. Mac und iPad laden. Nimm das **Netzteil** mit.
2. **Nicht am Vorlesungstag updaten.** Kein `git pull`, keine neue iPad-App. Ein Update kann neue Fehler mitbringen und migriert die Datenbank. Updates machst du am Wochenende ([UPDATE.md](UPDATE.md)).
3. Prüfe, dass alles läuft: `pnpm sg start`, dann im Browser die Seite **Heute** öffnen.
4. Startet die iPad-App noch? Mit dem kostenlosen Apple-Konto läuft sie nur 7 Tage ([IPAD.md](IPAD.md), Abschnitt „Die App läuft nur 7 Tage“).

## In der Uni

1. Mac ans Netzteil. **Deckel offen lassen.** Zugeklappt nimmt der Mac nichts auf.
2. **Energiesparen:** Solange eine Session läuft oder pausiert, hält der Core den Mac wach (macOS-Werkzeug `caffeinate`). Der Bildschirm darf ausgehen. Das gilt nur, solange der Core läuft, und nur auf dem Mac. Der Deckel muss trotzdem offen bleiben (Schritt 1).
3. **WLAN:** Soll das iPad live mitspiegeln, nimm den **Hotspot deines iPhones** statt des Uni-WLANs. Im Uni-WLAN sehen sich Geräte oft nicht. Verbinde Mac und iPad mit dem Hotspot. Findet das iPad den Mac nicht, hilft [IPAD-VERBINDUNG.md](IPAD-VERBINDUNG.md). Im Zweifel koppelst du neu ([IPAD.md](IPAD.md), Schritt 8).
4. Die Aufnahme läuft im Browser am Mac und braucht kein Internet.

## Aufnahme

1. **Starten:** Auf **Heute** gibt es für den Termin einen Knopf **Jetzt starten** (je nach Zeit auch **Start** oder **Früher starten**). Ohne Termin: **Session starten** und ein Modul wählen.
2. Erlaube dem Browser das Mikrofon. Fragt er nicht, erscheint in der Statusleiste **Aufnahme starten**. Klicke darauf.
3. Prüfe in der Statusleiste die Anzeige **REC** mit Laufzeit. Steht dort etwas anderes, zum Beispiel **Zugriff verweigert**, **Mikrofon fehlt**, **Aufnahme gestört**, **Pausiert** oder ein Hinweis, dass nicht aufgenommen wird, dann wird nichts aufgenommen.
4. **Pausieren:** **Pause**. Danach unbedingt **Fortsetzen**, sonst bleibt der Rest ohne Ton.
5. **Beenden:** **Beenden** oder das Tastenkürzel ⌘⇧S. Beides fragt vorher nach („Session beenden?“) und antwortet mit **Weiter aufnehmen** oder **Session beenden**. Das Kürzel gilt nur in der Vorlesungs-Ansicht. Auf **Heute** gibt es den Knopf **Beenden**, die Frage heißt dort **Weiterlaufen lassen** oder **Session beenden**.
6. Schließe den Tab der Vorlesung nicht. Ohne den Tab wird nichts aufgenommen, die Session läuft ohne Ton weiter.
7. **Bleib in der Vorlesungs-Ansicht.** Die Aufnahme hängt an dieser Ansicht. Wechselst du in der Seitenleiste zu **Heute**, zu den Einstellungen oder in ein Modul, verlässt du die Ansicht und ihre Aufnahme endet. Auf **Heute** steht dann „Läuft · ohne Aufnahme“. Kehrst du über **Zur Vorlesung** zurück, beginnt die Aufnahme neu. Zeigt die Statusleiste **Aufnahme starten**, klicke darauf. Dazwischen fehlt der Ton. Brauchst du die Einstellungen, öffne die App dafür in einem zweiten Tab und lass den ersten Tab in der Vorlesungs-Ansicht.

Die App beendet die Session auch selbst: spätestens 30 Minuten nach dem Kalenderende (**Einstellungen → Vorlesung → Spätestens nach Kalenderende**) und nach höchstens 4 Stunden (**Höchstdauer**). Vorher erscheint ein Hinweis „weiter aufnehmen?“, mit dem du verlängerst.

## Wenn der Akku leer wird

1. Die Aufnahme wird in Stücken von 10 Sekunden gespeichert. Es gehen höchstens die letzten Sekunden verloren.
2. Lade den Mac und starte `pnpm sg start`. Ist die Grenze aus dem Absatz oben dann schon überschritten (Kalenderende plus 30 Minuten, höchstens 4 Stunden), beendet der Core die Session beim Start selbst. Als Ende gilt die letzte Aufnahme.
3. Ist die Grenze noch nicht erreicht, bleibt die Session auf „läuft“, obwohl nichts aufgenommen wird. Öffne **Heute** und klicke **Beenden**. Sonst beendet der Core sie selbst, sobald die Grenze erreicht ist.

## Wenn der Mac neu startet

Die Session bleibt „läuft“, bis die Grenze aus dem Absatz oben erreicht ist. Eine Aufnahme läuft aber erst wieder, wenn du sie neu startest.

1. Öffne die **Docker**-App, falls sie nicht läuft. Die Datenbank läuft in Docker.
2. Starte im Repo-Ordner `pnpm sg start`. Das startet die Datenbank, falls nötig, und den Core. Das dauert etwas. Läuft es nicht, prüft `pnpm sg doctor` die Voraussetzungen.
3. Öffne im Browser **Heute**. Dort steht „Läuft · ohne Aufnahme“. Klicke **Zur Vorlesung**.
4. Prüfe in der Statusleiste die Anzeige **REC** mit Laufzeit. Fehlt sie, klicke **Aufnahme starten** (Aufnahme, Schritt 2 und 3).
5. Das iPad verbindet sich von selbst wieder. Was du dazwischen geschrieben hast, wartet in der Warteschlange und geht danach zum Mac. Zeigt das iPad den Mac nicht, hilft [IPAD-VERBINDUNG.md](IPAD-VERBINDUNG.md).

Im Modus **Auf Folie** bleibt das iPad so lange auf der letzten Folie stehen, bis der Mac wieder da ist.
