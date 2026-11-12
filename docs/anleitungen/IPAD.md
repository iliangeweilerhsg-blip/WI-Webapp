# iPad-App aufspielen und koppeln

So kommt die App „Studien-Gehirn“ auf dein iPad. Du brauchst kein bezahltes Entwicklerkonto. Dauer beim ersten Mal: etwa 20 Minuten.

**Stand:** Die App kann koppeln, zeigt den Verbindungsstatus und listet deine Notizbücher je Modul. Seiten blättern, anlegen, umsortieren und löschen, dazu Vorlagen (liniert, kariert, Punktraster). Schreibmodi und Folien (nur die Vorlesung, die gerade läuft).

## Was du brauchst

- Mac mit **Xcode 16 oder neuer** (kostenlos im App Store)
- iPad mit **iPadOS 17 oder neuer** und ein USB-C-Kabel
- Deine Apple-ID
- [Homebrew](https://brew.sh) auf dem Mac. Noch nicht installiert? Öffne brew.sh, kopiere den Befehl unter „Install Homebrew“ ins Terminal und folge den Hinweisen. Am Ende nennt das Terminal unter „Next steps“ noch zwei oder drei Befehle, die du ebenfalls ausführst.
- Mac und iPad im **selben WLAN**

## 1. Xcode-Projekt erzeugen

Das Xcode-Projekt liegt nicht im Repo. Ein Skript erzeugt es aus `apps/ipad/project.yml`.

Öffne das **Terminal** und wechsle in den Ordner des Repos: Tippe `cd ` (mit Leerzeichen), zieh den Repo-Ordner aus dem Finder ins Terminal-Fenster und drück Enter. Dann:

```bash
bash apps/ipad/scripts/projekt-erzeugen.sh
open apps/ipad/StudienGehirn.xcodeproj
```

Das Skript installiert beim ersten Mal das Werkzeug XcodeGen über Homebrew.

Wiederhole diesen Schritt nach jedem `git pull`. Sonst fehlen neue Dateien im Projekt.

## 2. Mit deiner Apple-ID anmelden

1. In Xcode: **Xcode → Settings → Accounts**.
2. Unten links auf **+** klicken, **Apple ID** wählen, anmelden.

## 3. Team wählen

1. Links in der Seitenleiste ganz oben auf **StudienGehirn** klicken (blaues Symbol).
2. In der Mitte unter **TARGETS** auf **StudienGehirn** klicken.
3. Reiter **Signing & Capabilities** öffnen.
4. Bei **Team** deinen Namen mit dem Zusatz **(Personal Team)** wählen.

Meldet Xcode, dass die Kennung `de.studiengehirn.ipad` schon vergeben ist? Dann hänge im Feld **Bundle Identifier** etwas Eigenes an, zum Beispiel `de.studiengehirn.ipad.meins`.

**Wichtig:** Deine Team-ID gehört nicht ins Repo. Das Xcode-Projekt wird von Git ignoriert, dort ist sie sicher. Trage sie nie in `project.yml` ein.

Nach jedem neuen Erzeugen des Projekts (Schritt 1) musst du das Team neu wählen. Wenn dich das stört: Lege die Datei `apps/ipad/Config/Local.xcconfig` an. Git ignoriert sie. Inhalt, eine Zeile:

```
DEVELOPMENT_TEAM = <deine Team-ID>
```

## 4. iPad anschließen

1. iPad per Kabel an den Mac anschließen und entsperren.
2. Auf dem iPad **Vertrauen** antippen und den Code eingeben.
3. In Xcode oben in der Mitte auf das Gerät neben „StudienGehirn“ klicken und dein iPad wählen.

## 5. Entwicklermodus einschalten (einmalig)

1. Auf dem iPad: **Einstellungen → Datenschutz & Sicherheit → Entwicklermodus**.
2. Einschalten. Das iPad startet neu.
3. Nach dem Neustart **Aktivieren** antippen.

Der Punkt „Entwicklermodus“ erscheint erst, wenn das iPad einmal mit Xcode verbunden war.

## 6. App aufspielen

1. In Xcode auf **▶** klicken (oder `cmd` + `R`).
2. Beim ersten Mal dauert das einige Minuten. Fragt der Mac, ob `codesign` auf deinen Schlüsselbund zugreifen darf, gib dein Mac-Passwort ein und wähle **Immer erlauben**.
3. Startet die App nicht und Xcode meldet einen nicht vertrauenswürdigen Entwickler? Dann auf dem iPad: **Einstellungen → Allgemein → VPN & Geräteverwaltung**. Unter **Entwickler-App** deine Apple-ID antippen und **Vertrauen** wählen. Danach in Xcode noch einmal **▶**.

## 7. „Lokales Netzwerk“ erlauben

Beim ersten Start fragt das iPad, ob die App Geräte im lokalen Netzwerk finden darf. Tippe **Erlauben**.

Ohne diese Erlaubnis erreicht die App den Mac nicht. Nachträglich ändern: **Einstellungen → Datenschutz & Sicherheit → Lokales Netzwerk → Studien-Gehirn**.

## 8. Koppeln

1. **Am Mac:** Studien-Gehirn starten. In der Web-App **Einstellungen → Geräte** öffnen und die Kopplung starten. Der Mac zeigt einen QR-Code, einen Code mit sechs Ziffern und seine Adresse. Das Fenster gilt 5 Minuten.
2. **Am iPad**, empfohlener Weg: **QR-Code scannen** antippen, die Kamera erlauben und den QR-Code am Mac scannen. Das iPad zeigt danach die Adresse aus dem QR-Code. Vergleiche sie mit der Adresse, die der Mac anzeigt. Stimmen beide überein, tippe **Koppeln** an.
   - Steht dort die Warnung **„Diese Adresse liegt nicht in deinem Heimnetz“**, führt die Adresse nicht in ein privates WLAN. Das ist in manchen Uni-WLANs normal, kann aber auch ein fremder QR-Code sein. Kopple nur, wenn der Mac genau diese Adresse anzeigt. Im Zweifel tippe **Abbrechen** an.
3. **Ohne Kamera:** Tippe unter „Im WLAN gefunden“ deinen Mac an. Oder gib unter „Adresse von Hand“ die Adresse ein, die der Mac anzeigt. Tippe dann die sechs Ziffern ein und wähle **Koppeln**.
4. Die Web-App meldet das neue Gerät. Oben rechts in der iPad-App steht **Mac ●** mit grünem Punkt.

Der QR-Code ist der sicherste Weg. Namen in der Liste „Im WLAN gefunden“ sind nicht geprüft.

## Notizbücher wählen

Auf dem Startbildschirm steht je Modul eine Karte mit den Notizbüchern des Moduls („Vorlesung“, „Übung“ und eigene). Tippe ein Notizbuch an, um darin zu schreiben. Die Wahl ist frei und geht auch ohne Verbindung zum Mac.

- **Läuft gerade eine Vorlesung,** steht oben die Karte „Läuft gerade“. Sie öffnet das passende Notizbuch.
- **Eigenes Notizbuch anlegen:** In der Karte des Moduls auf **Notizbuch** tippen, einen Titel eingeben, **Anlegen** wählen. Das neue Notizbuch öffnet sich gleich. Das geht auch offline. Beim nächsten Verbinden erscheint es am Mac. Gibt es den Titel im Modul schon, bleibt **Anlegen** gesperrt, und ein Satz sagt warum. Klappt das Speichern nicht, steht auf dem Startbildschirm „Konnte nicht gespeichert werden“.
- **Ohne Verbindung** steht eine ruhige Zeile „Offline · Stand von …“ da. Du siehst den Stand vom letzten Verbinden. Ist die Liste leer, verbinde das iPad einmal mit dem Mac.
- **Titel der Schreibfläche:** „Modul · Notizbuch“. So siehst du immer, wohin geschrieben wird.
- **Update von einer älteren Version:** Deine bisherigen Seiten und noch nicht gesendete Striche bleiben erhalten. Die App übernimmt sie beim ersten Start in die neue Liste.

**Umbenennen und Löschen** geht am Mac: in der Web-App im Modul unter **Notizbücher**. „Vorlesung“ und „Übung“ lassen sich nur umbenennen. Das iPad zeigt die Änderung, sobald es den Startbildschirm zeigt oder neu verbindet. Schreibst du vorher noch in ein Notizbuch, das am Mac gelöscht wurde, landen diese Striche mit im Papierkorb und kommen beim Wiederherstellen zurück.

## Seiten und Vorlagen

Ein Notizbuch hat viele Seiten. Eine Seite ist sichtbar.

- **Blättern:** Oben steht „‹ Seite 3 / 12 ›“. Tippe auf die Pfeile oder wische mit einem Finger nach links oder rechts. Das Wischen geht nur, solange du nicht hineingezoomt hast. Stört es dich beim Zoomen oder Scrollen, nimm die Pfeile.
- **Neue Seite:** Auf der letzten Seite legt der Pfeil „›“ (oder der Wisch) eine neue Seite an. Das geht nur, wenn die aktuelle Seite mindestens einen Strich hat. Die neue Seite übernimmt die Vorlage der aktuellen. Über **Seiten ▤** und **+** wählst du die Vorlage selbst.
- **Seitenleiste:** **Seiten ▤** öffnet ein Panel mit Vorschaubildern. Tippe ein Bild an, um zur Seite zu springen. Halte ein Bild gedrückt und ziehe es an eine andere Stelle, um die Seite zu verschieben. Gedrückt halten öffnet außerdem das Menü mit **Vorlage** und **Löschen**. Das Panel schließt du mit dem **✕**. Der Stift schreibt auch bei offenem Panel weiter. Steht unten „N weitere Seiten liegen nur am Mac“, hat der Mac Seiten, die dieses iPad nicht hat. Mehr dazu im Abschnitt „Seiten, die nur am Mac liegen“.
- **Vorlage:** Im Menü **⋯** oben (oder in der Seitenleiste) wählst du Blanko, Liniert, Kariert oder Punktraster. Kariert und Punktraster haben ein 5-mm-Raster.
- **Löschen ohne Rückfrage:** **⋯ → Seite löschen** (oder in der Seitenleiste). Die Seite verschwindet sofort. Unten erscheint 5 Sekunden lang **Seite gelöscht · Rückgängig**. Tippst du darauf, ist die Seite wieder da. Sonst landet sie im Papierkorb am Mac, dort als „Seite 3 in Modul A · Vorlesung“. War es die letzte Seite, öffnet sich eine leere Ersatzseite. Tippst du auf **Rückgängig**, verschwindet sie wieder, solange du nicht darauf geschrieben hast. Stellst du die Seite am Mac wieder her, öffne das Notizbuch auf dem iPad neu (zurück zum Startbildschirm und wieder hinein), dann ist sie da. Verlässt du die Schreibfläche, gilt die Frist als abgelaufen. Auf dem iPad bleiben Zeichnung und Vorschaubild noch erhalten.
- **Alles geht offline.** Anlegen, Umsortieren, Vorlage und Löschen werden gemerkt und beim nächsten Verbinden zum Mac geschickt. Haben beide Seiten dieselbe Seite verändert, gewinnt je Feld die Änderung, die zuletzt gemacht wurde und noch nicht beim Mac war: Hast du nur die Vorlage geändert und der Mac nur die Reihenfolge, bleibt beides.

## Schreibmodi und Folien

Oben in der Seitenzeile steht ein Umschalter. Ein Tipp wechselt zwischen **Freie Seite** und **Auf Folie**. Die Wahl gilt pro Modul, bleibt nach einem Neustart erhalten und geht auch ohne Verbindung. Sie wird beim nächsten Verbinden an den Mac gesendet. Ohne eigene Wahl gilt der Standard aus den Einstellungen am Mac.

- **Freie Seite:** Du schreibst auf der Seite, die offen ist. Blättert der Mac weiter, bleibt deine Seite stehen. Neue Seiten merken sich die Folie, die gerade lief.
- **Auf Folie:** Blättert der Mac zur nächsten Folie, öffnet das iPad die Seite zu dieser Folie. Gibt es noch keine, wird sie angelegt und hinten angehängt. Kehrt der Mac zu einer früheren Folie zurück, siehst du deine Notizen dazu wieder. Die Folie liegt als Bild unter deiner Schrift.
- **Mitten im Strich** bleibt die Seite stehen. Erst wenn du den Stift abgesetzt hast, wechselt das iPad zur zuletzt gezeigten Folie.
- **Nur mit laufender Vorlesung:** „Auf Folie“ geht nur, wenn am Mac eine Vorlesung dieses Moduls mit Foliensatz läuft. Sonst ist der Umschalter ausgegraut, und es steht „Folien brauchen eine laufende Vorlesung mit Foliensatz“. Zurück zur freien Seite geht immer.
- **Folien auf dem iPad:** Das iPad lädt nur den Foliensatz der laufenden Vorlesung, und nur vom gekoppelten Mac. Die Datei wird vor der Anzeige geprüft (Größe, Prüfsumme) und liegt dann im App-Speicher, nicht im Backup. Insgesamt höchstens 1 GB, der älteste Satz geht zuerst. Schon geladene Folien erscheinen auch ohne Verbindung unter deinen Notizen. Fehlt eine Folie, steht „Folie wird geladen …“ oder „Folie nicht auf dem iPad“. Schreiben geht trotzdem.
- **Vorab laden und Folien ohne Verbindung wählen** folgt später (T1-15).

## Seiten, die nur am Mac liegen

Das iPad zeigt nur Seiten, die es selbst angelegt hat. Seiten, die nur der Mac kennt, bleiben unsichtbar. Stattdessen steht in der Seitenleiste „N weitere Seiten liegen nur am Mac.“ Das passiert zum Beispiel nach einem neuen oder zweiten iPad oder nachdem du die App gelöscht hast. Am Mac sind diese Seiten außerhalb einer laufenden Vorlesung auch nicht zu sehen.

**Lösche die App nicht und schreibe nicht auf einem anderen iPad weiter.** Sonst sind die alten Seiten nur noch am Mac zu sehen und nicht mehr auf dem iPad.

## Fehlerablage

Auf dem Startbildschirm steht im Abschnitt „Sync“ die Zeile „Wartend: N“ (Änderungen, die noch zum Mac müssen) und „Fehlerablage: N“. Steht dort eine Zahl über 0, konnte der Mac N Änderungen nicht annehmen. Die Zeichnungen sind nicht automatisch weg, sie liegen in einer Datei auf dem iPad. Die betroffene Seite oder das Notizbuch kann aus der Liste verschwinden. Ein Zurückspielen gibt es noch nicht.

Mit **Fehlerablage teilen** schickst du die Datei über das Teilen-Menü zum Mac, damit sie nicht verloren geht. Tritt das öfter auf, melde es.

## Die App läuft nur 7 Tage

Mit dem kostenlosen Personal Team gilt die Signatur **7 Tage**. Danach startet die App nicht mehr.

Abhilfe: iPad anschließen und in Xcode wieder auf **▶** klicken (Schritt 6). Die Kopplung bleibt dabei erhalten. Lösche die App dafür nicht.

**Feste Routine:** Such dir einen Wochentag, an dem keine Vorlesung ist, zum Beispiel den Sonntagabend, und spiel die App immer dann neu auf. So läuft sie nie mitten in der Woche ab.

**Vorwarnung in der App:** Auf dem Startbildschirm steht ein Hinweis, sobald nur noch 2 Tage bleiben („App läuft noch 2 Tage“, am letzten Tag „App läuft heute ab“). Dann am Mac über Xcode neu aufspielen. Siehst du keinen Hinweis, ist noch genug Zeit oder die App kann ihr Ablaufdatum nicht lesen. Verlass dich deshalb nicht allein darauf, sondern halte die Wochenroutine ein.

## Wenn etwas nicht klappt

Tippe in der App oben rechts auf **Mac ●**. Dort steht die Ursache.

| Anzeige | Was hilft |
|---|---|
| Lokales Netzwerk nicht erlaubt | Schritt 7 |
| Kein WLAN | iPad ins selbe WLAN wie den Mac bringen. Auch Schritt 7 prüfen |
| Mac antwortet nicht / Mac nicht gefunden | Läuft Studien-Gehirn am Mac? Stimmt die Adresse? Sonst weiter mit [IPAD-VERBINDUNG.md](IPAD-VERBINDUNG.md) |
| Kopplung am Mac nicht geöffnet | Am Mac die Kopplung neu starten (Schritt 8). Der Code gilt nur 5 Minuten |
| Code stimmt nicht | Code vergleichen. Nach 5 falschen Codes von vorn beginnen |
| Kopplung gesperrt | Am Mac die Kopplung neu starten |
| Kopplung nicht mehr gültig | Das iPad wurde am Mac entfernt. **Neu koppeln** antippen |
| Verbindung vom System blockiert | Fehler in der App. Bitte melden |

Im Uni-WLAN sehen sich Geräte oft nicht gegenseitig. Nimm dann das Heim-WLAN oder den Hotspot deines iPhones.

## Kopplung aufheben

In der App: **Mac ●** antippen, dann **Kopplung aufheben**. Das iPad meldet sich am Mac ab.

War der Mac dabei nicht erreichbar? Dann entferne das iPad zusätzlich am Mac unter **Einstellungen → Geräte**.
