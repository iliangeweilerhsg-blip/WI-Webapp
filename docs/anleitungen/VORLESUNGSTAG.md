# Vorlesungstag

Diese Liste hilft, dass die Aufnahme in der Vorlesung durchläuft. Sie gilt für den Mac, auf dem das Studien-Gehirn läuft.

## Am Vorabend

1. Mac und iPad laden. Nimm das **Netzteil** mit.
2. **Nicht am Vorlesungstag updaten.** Kein `git pull`, keine neue iPad-App. Ein Update kann neue Fehler mitbringen und migriert die Datenbank. Updates machst du am Wochenende ([UPDATE.md](UPDATE.md)).
3. Prüfe, dass alles läuft: `pnpm sg start`, dann im Browser die Seite **Heute** öffnen.
4. Startet die iPad-App noch? Mit dem kostenlosen Apple-Konto läuft sie nur 7 Tage ([IPAD.md](IPAD.md), Abschnitt „Die App läuft nur 7 Tage“).
5. Läuft der Mac-Helfer? `pnpm sg doctor` zeigt es (Zeilen „Tunnel-Helfer“). Ohne ihn gibt es keinen Sync mit dem iPad, auch nicht zu Hause. Dein Schreiben bleibt trotzdem auf dem iPad.

## In der Uni

1. Mac ans Netzteil. **Deckel offen lassen.** Zugeklappt nimmt der Mac nichts auf.
2. **Energiesparen:** Solange eine Session läuft oder pausiert, hält der Core den Mac wach (macOS-Werkzeug `caffeinate`). Der Bildschirm darf ausgehen. Das gilt nur, solange der Core läuft, und nur auf dem Mac. Der Deckel muss trotzdem offen bleiben (Schritt 1).
3. **WLAN:** Schalte **WLAN an beiden Geräten ein**. Ein gemeinsames Netz und ein Hotspot sind nicht nötig: Im Uni-WLAN sehen sich Geräte oft nicht, das iPad verbindet sich dann direkt mit dem Mac (Wi-Fi peer-to-peer, siehe [IPAD.md](IPAD.md), Abschnitt „Im Hörsaal ohne gemeinsames Netz“). Öffne die App am iPad und warte, bis **Mac ●** grün ist. Tippst du auf **Mac ●**, steht dort „Direkt verbunden, ohne WLAN-Netz“ oder „Verbunden über das WLAN“. Steht dort „Bitte einmal neu koppeln“, koppelst du **zu Hause** einmal neu ([IPAD.md](IPAD.md), Abschnitt „Nach dem Update: einmal neu koppeln“), nicht in der Uni. Findet das iPad den Mac nicht, hilft [IPAD-VERBINDUNG.md](IPAD-VERBINDUNG.md), Abschnitt 6.
4. Die Aufnahme läuft im Browser am Mac und braucht kein Internet.

## Aufnahme

1. **Starten:** Auf **Heute** gibt es für den Termin einen Knopf **Jetzt starten** (je nach Zeit auch **Start** oder **Früher starten**). Ohne Termin: **Session starten** und ein Modul wählen.
2. Erlaube dem Browser das Mikrofon. Fragt er nicht, erscheint unten **Aufnahme starten** (Statusleiste oder Aufnahme-Leiste). Klicke darauf.
3. Prüfe in der Statusleiste die Anzeige **REC** mit Laufzeit. Steht dort etwas anderes, zum Beispiel **Zugriff verweigert**, **Mikrofon fehlt**, **Aufnahme gestört**, **Pausiert** oder ein Hinweis, dass nicht aufgenommen wird, dann wird nichts aufgenommen.
4. **Pausieren:** **Pause**. Danach unbedingt **Fortsetzen**, sonst bleibt der Rest ohne Ton.
5. **Beenden:** **Beenden** oder das Tastenkürzel ⌘⇧S. Beides fragt vorher nach („Session beenden?“) und antwortet mit **Weiter aufnehmen** oder **Session beenden**. Das Kürzel gilt nur in der Vorlesungs-Ansicht. Auf **Heute** gibt es den Knopf **Beenden**, die Frage heißt dort **Weiter aufnehmen** (solange aufgenommen wird, sonst **Weiterlaufen lassen**) oder **Session beenden**.
6. Schließe den Tab nicht und lade ihn nicht neu. Ohne den Tab wird nichts aufgenommen, die Session läuft ohne Ton weiter. Der Browser fragt vorher nach. Arbeite in **einem** Tab.
7. **Du kannst die Vorlesungs-Ansicht verlassen.** Die Aufnahme läuft weiter, auch auf **Heute**, in den Einstellungen oder in einem Modul. Unten steht dann eine schmale Leiste mit **REC** und der Laufzeit. **Zur Vorlesung** bringt dich zurück. Steht dort etwas anderes als **REC**, wird nicht aufgenommen. Zeigt die Leiste **Aufnahme starten**, klicke darauf.

Die App beendet die Session auch selbst: spätestens 30 Minuten nach dem Kalenderende (**Einstellungen → Vorlesung → Spätestens nach Kalenderende**) und nach höchstens 4 Stunden (**Höchstdauer**). Vorher erscheint ein Hinweis „weiter aufnehmen?“, mit dem du verlängerst.

## Wenn der Akku leer wird

1. Die Aufnahme wird in Stücken von 10 Sekunden gespeichert. Es gehen höchstens die letzten Sekunden verloren.
2. Lade den Mac und starte `pnpm sg start`. Ist die Grenze aus dem Absatz oben dann schon überschritten (Kalenderende plus 30 Minuten, höchstens 4 Stunden), beendet der Core die Session beim Start selbst. Als Ende gilt die letzte Aufnahme.
3. Ist die Grenze noch nicht erreicht, bleibt die Session auf „läuft“, obwohl nichts aufgenommen wird. Öffne **Heute** und klicke **Beenden**. Sonst beendet der Core sie selbst, sobald die Grenze erreicht ist.

## Wenn der Mac neu startet

Die Session bleibt „läuft“, bis die Grenze aus dem Absatz oben erreicht ist. Eine Aufnahme läuft aber erst wieder, wenn du sie neu startest.

1. Öffne die **Docker**-App, falls sie nicht läuft. Die Datenbank läuft in Docker.
2. Starte im Repo-Ordner `pnpm sg start`. Das startet die Datenbank, falls nötig, und den Core. Das dauert etwas. Läuft es nicht, prüft `pnpm sg doctor` die Voraussetzungen.
3. Öffne im Browser **Heute**. Steht dort „Läuft · ohne Aufnahme“, klicke in der Karte **Aufnahme starten**. Danach steht „Läuft · Aufnahme“ und unten **REC**.
4. Prüfe, dass unten **REC** mit Laufzeit steht (Aufnahme, Schritt 3). Auf **Heute** ist das die Aufnahme-Leiste, in der Vorlesungs-Ansicht die Statusleiste.
5. Das iPad verbindet sich von selbst wieder. Was du dazwischen geschrieben hast, wartet in der Warteschlange und geht danach zum Mac. Zeigt das iPad den Mac nicht, hilft [IPAD-VERBINDUNG.md](IPAD-VERBINDUNG.md).

Im Modus **Auf Folie** bleibt das iPad so lange auf der letzten Folie stehen, bis der Mac wieder da ist.
