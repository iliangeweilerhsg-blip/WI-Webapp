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

1. **Starten:** Auf **Heute** gibt es für den Termin einen Knopf **Jetzt starten** (je nach Zeit auch **Start** oder **Früher starten**). Ohne Termin: **Session starten** und ein Modul wählen. Die Folien stehen im Abschnitt „Folien“ unten.
2. Erlaube dem Browser das Mikrofon. Fragt er nicht, erscheint unten **Aufnahme starten** (Statusleiste oder Aufnahme-Leiste). Klicke darauf.
3. Prüfe in der Statusleiste die Anzeige **REC** mit Laufzeit. Steht dort etwas anderes, zum Beispiel **Zugriff verweigert**, **Mikrofon fehlt**, **Aufnahme gestört**, **Pausiert** oder ein Hinweis, dass nicht aufgenommen wird, dann wird nichts aufgenommen.
4. **Pausieren:** **Pause**. Danach unbedingt **Fortsetzen**, sonst bleibt der Rest ohne Ton.
5. **Beenden:** **Beenden** oder das Tastenkürzel ⌘⇧S. Beides fragt vorher nach („Session beenden?“) und antwortet mit **Weiter aufnehmen** oder **Session beenden**. Das Kürzel gilt nur in der Vorlesungs-Ansicht. Auf **Heute** gibt es den Knopf **Beenden**, die Frage heißt dort **Weiter aufnehmen** (solange aufgenommen wird, sonst **Weiterlaufen lassen**) oder **Session beenden**.
6. Schließe den Tab nicht und lade ihn nicht neu. Ohne den Tab wird nichts aufgenommen, die Session läuft ohne Ton weiter. Der Browser fragt vorher nach. Arbeite in **einem** Tab.
7. **Du kannst die Vorlesungs-Ansicht verlassen.** Die Aufnahme läuft weiter, auch auf **Heute**, in den Einstellungen oder in einem Modul. Unten steht dann eine schmale Leiste mit **REC** und der Laufzeit. **Zur Vorlesung** bringt dich zurück. Steht dort etwas anderes als **REC**, wird nicht aufgenommen. Zeigt die Leiste **Aufnahme starten**, klicke darauf.

Die App beendet die Session auch selbst: spätestens 30 Minuten nach dem Kalenderende (**Einstellungen → Vorlesung → Spätestens nach Kalenderende**) und nach höchstens 4 Stunden (**Höchstdauer**). Vorher erscheint ein Hinweis „weiter aufnehmen?“, mit dem du verlängerst.

## Folien

Die Folien einer Vorlesung kommen meist aus Moodle. Du musst vorher nichts einstellen. Der Start wartet nie auf die Folien: Ein Tipp startet, auch wenn gerade keine da sind.

1. **Vor dem Start:** Auf **Heute** steht unter dem Titel der Karte eine Zeile.
   - **Folien: ‹Titel›** (bei Moodle mit „aus Moodle“): Dieser Satz ist der Vorschlag, der neueste, den noch keine andere Vorlesung trägt. Ein Tipp auf **Start** nimmt ihn mit.
   - **Ohne Folien**: Es gibt keinen freien Satz, oder du hast **Ohne Folien** gewählt.
   - **Ändern** klappt eine Liste auf: alle Foliensätze des Moduls (bei belegten steht „schon in VL 6“), **Ohne Folien** und **PDF hochladen …**. Eine Wahl gilt sofort. **Esc** schließt die Liste.
   - Fehlt die Zeile, hat der Core die Folien noch nicht geliefert. Starte trotzdem, die Vorlesungs-Ansicht bietet sie danach an.
   - Die Start-Karte zeigt neue Sätze innerhalb etwa einer Minute oder sobald du den Tab wieder öffnest.
2. **Ohne Termin** (**Session starten**): Unter dem Modul steht derselbe Vorschlag. **Ohne Folien** nimmt ihn weg. Einen anderen Satz wählst du in der Vorlesungs-Ansicht.
3. **Während der Vorlesung** (Spalte **Folie** der Vorlesungs-Ansicht), solange die Session keine Folien hat:
   - Ohne Satz steht dort „Folien kommen später – einfach mitschreiben“. Gibt es einen freien Satz, folgt „Vorschlag: ‹Titel›“ mit **Übernehmen**.
   - **Neue Folien aus Moodle: ‹Titel›** mit **Übernehmen** und **Nicht jetzt**. Das erscheint von selbst, wenn der Dozent kurz vor oder während der Vorlesung hochlädt. Wie schnell, steht im Absatz „Moodle-Abgleich zur Vorlesung“ unten. Die Ansicht fragt danach alle 60 Sekunden nach. Nichts wechselt von selbst: Erst **Übernehmen** setzt den Satz. **Nicht jetzt** blendet diesen Satz aus, ein noch neuerer wird wieder angeboten.
   - **Folien wählen** öffnet dieselbe Liste wie auf **Heute**. **PDF hochladen** nimmt eine Datei vom Mac und hängt sie an diese Vorlesung. Bis die Datei gelesen ist, steht dort „Folien werden verarbeitet …“.
   - Das Setzen blättert nicht. Am Mac steht danach Folie 1, bis du blätterst.
4. **Falscher Satz?** Solange du **noch nicht geblättert** hast, wählst du unter den Folien **Anderen Foliensatz wählen** oder **Ohne Folien**. Nach dem ersten Blättern am Mac geht das nicht mehr: Die Leiste mit der Auswahl verschwindet im selben Tab ohne Hinweis, der Satz ist fest. Das iPad zählt dabei nicht, es meldet keinen Folienwechsel. Nur wenn ein zweiter Tab trotzdem wählt, sagt die App: „Der Foliensatz bleibt, weil in dieser Vorlesung schon geblättert wurde.“
5. **Gelöscht:** Löschst du den Foliensatz der laufenden Vorlesung, steht dort „Die Folien dieser Vorlesung sind gelöscht.“. Mit **Folien wählen** nimmst du einen anderen, solange du nicht geblättert hast.
6. **PDF im Voraus:** Auf der Modulseite (Tab **Vorlesungen**) wählst du beim Hochladen **Für Vorlesung**. Zur Wahl stehen die heutigen Vorlesungen ohne Folien (Standard: die laufende, sonst **keine**). So ist der Satz schon da, wenn du startest. Eine beendete Vorlesung nimmt keine Folien mehr an.
7. **Moodle-Abgleich zur Vorlesung:** Damit neue Folien rechtzeitig da sind, sieht der Core in Moodle nach, ohne dass du etwas tust. Das passiert, sobald die Vorlesung auf **bereit** springt (etwa 15 Minuten vor Beginn), meist kurz nach dem Start und danach, solange die Vorlesung ohne Folien läuft. Je Modul gilt eine Drossel von 10 Minuten, gezählt ab dem letzten Anstoß, auch ab dem beim Sprung auf **bereit**. Wer früh startet (weniger als 10 Minuten nach **bereit**), wartet daher bis etwa 10 Minuten nach **bereit** auf den nächsten Abgleich. Dazu kommen die Dauer des Abgleichs und bis zu 60 Sekunden bis zur nächsten Abfrage. Rechne mit meist wenigen Minuten, spätestens etwa 10 bis 12 Minuten nach dem letzten Abgleich. Hat die Vorlesung Folien, sieht er nicht mehr nach. Das geht nur mit Moodle-Zugang und einem zugeordneten Kurs ([MOODLE.md](MOODLE.md)). Ohne Zugang oder bei einem Fehler startet alles wie sonst, es gibt keine Meldung. Der Abgleich holt den ganzen Kurs, nicht nur die Folien. Mit **Jetzt abgleichen** unter **Einstellungen → Moodle** geht es sofort.
   - Lädt der Dozent erst nach dem Zeitpunkt „15 Minuten vorher“ hoch, fehlt der Satz auf der Start-Karte. Das Angebot in der Vorlesungs-Ansicht kommt dann meist ein bis zwei Minuten nach dem Start, bei frühem Start bis etwa 10 Minuten nach **bereit** (Drossel, siehe oben).
8. Das iPad kennt eine Folie erst, wenn der Mac zum ersten Mal geblättert hat. Vorher zeigt es keine Folie, und **Auf die Folie schreiben** ist gesperrt. Danach folgt es dem Satz der Vorlesung und zeigt die aktuelle Folie.

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
