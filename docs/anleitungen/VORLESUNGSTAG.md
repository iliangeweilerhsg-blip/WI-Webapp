# Vorlesungstag

Diese Liste hilft, dass die Aufnahme in der Vorlesung durchläuft. Sie gilt für den Mac, auf dem das Studien-Gehirn läuft.

## Am Vorabend

1. Mac und iPad laden. Nimm das **Netzteil** mit.
2. **Nicht am Vorlesungstag updaten.** Kein `git pull`, keine neue iPad-App. Ein Update kann neue Fehler mitbringen und migriert die Datenbank. Updates machst du am Wochenende ([UPDATE.md](UPDATE.md)).
3. Prüfe, dass alles läuft: `pnpm sg start`, dann im Browser die Seite **Heute** öffnen.
4. Startet die iPad-App noch? Mit dem kostenlosen Apple-Konto läuft sie nur 7 Tage ([IPAD.md](IPAD.md), Abschnitt „Die App läuft nur 7 Tage“).

## In der Uni

1. Mac ans Netzteil. **Deckel offen lassen.** Zugeklappt nimmt der Mac nichts auf.
2. **Energiesparen:** Stelle es in den Systemeinstellungen so ein, dass der Mac am Netzteil nicht schläft, oder lass das Fenster der App vorn. Die App fordert beim Aufnehmen zwar eine Bildschirm-Wachsperre an, sie wirkt aber nur im sichtbaren Tab. Verlass dich nicht darauf, dass der Mac von selbst wach bleibt.
3. **WLAN:** Soll das iPad live mitspiegeln, nimm den **Hotspot deines iPhones** statt des Uni-WLANs. Im Uni-WLAN sehen sich Geräte oft nicht. Verbinde Mac und iPad mit dem Hotspot. Findet das iPad den Mac nicht, hilft [IPAD-VERBINDUNG.md](IPAD-VERBINDUNG.md). Im Zweifel koppelst du neu ([IPAD.md](IPAD.md), Schritt 8).
4. Die Aufnahme läuft im Browser am Mac und braucht kein Internet.

## Aufnahme

1. **Starten:** Auf **Heute** gibt es für den Termin einen Knopf **Jetzt starten** (je nach Zeit auch **Start** oder **Früher starten**). Ohne Termin: **Session starten** und ein Modul wählen.
2. Erlaube dem Browser das Mikrofon. Fragt er nicht, erscheint in der Statusleiste **Aufnahme starten**. Klicke darauf.
3. Prüfe in der Statusleiste die Anzeige **REC** mit Laufzeit. Steht dort etwas anderes, zum Beispiel **Zugriff verweigert**, **Mikrofon fehlt**, **Aufnahme gestört**, **Pausiert** oder ein Hinweis, dass nicht aufgenommen wird, dann wird nichts aufgenommen.
4. **Pausieren:** **Pause**. Danach unbedingt **Fortsetzen**, sonst bleibt der Rest ohne Ton.
5. **Beenden:** **Beenden**. Das Tastenkürzel ⌘⇧S fragt vorher nach („Session beenden?“ mit **Weiter aufnehmen** oder **Session beenden**).
6. Schließe den Tab der Vorlesung nicht. Ohne den Tab wird nichts aufgenommen, die Session läuft ohne Ton weiter.

Die App beendet die Session auch selbst: spätestens 30 Minuten nach dem Kalenderende (**Einstellungen → Vorlesung → Spätestens nach Kalenderende**) und nach höchstens 4 Stunden (**Höchstdauer**). Vorher erscheint ein Hinweis „weiter aufnehmen?“, mit dem du verlängerst.

## Wenn der Akku leer wird

1. Die Aufnahme wird in Stücken von 10 Sekunden gespeichert. Es gehen höchstens die letzten Sekunden verloren.
2. Lade den Mac und starte `pnpm sg start`. Ist die Grenze aus dem Absatz oben dann schon überschritten (Kalenderende plus 30 Minuten, höchstens 4 Stunden), beendet der Core die Session beim Start selbst. Als Ende gilt die letzte Aufnahme.
3. Ist die Grenze noch nicht erreicht, bleibt die Session auf „läuft“, obwohl nichts aufgenommen wird. Öffne **Heute** und klicke **Beenden**. Sonst beendet der Core sie selbst, sobald die Grenze erreicht ist.
