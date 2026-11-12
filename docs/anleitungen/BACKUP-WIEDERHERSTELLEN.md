# Backup wiederherstellen

So sicherst du deine Daten und holst sie bei Bedarf zurück. Ein Backup enthält die Datenbank sowie die Ordner `media/` (Aufnahmen, Fotos) und `vault/` (Material).

> Spiele nur **eigene** Backups ein. Die Stände sind nicht signiert, einem fremden Stand wird vertraut.

## 1. Ziel wählen

1. **Einstellungen → Daten und Papierkorb** öffnen.
2. Bei **Backup-Ziel (absoluter Ordnerpfad)** einen Ordner eintragen, am besten auf einer externen Festplatte, zum Beispiel `/Volumes/Backup/StudienGehirn`.
3. **Uhrzeit** einstellen und **Speichern**.
4. **Jetzt sichern** klicken. Die Tabelle darunter zeigt den Lauf mit Status und Größe.

Über dem Formular steht, wann das letzte Backup lief. Ist es älter als 3 Tage, erscheint „veraltet“.

## 2. Restore-Test lesen

Der Restore-Test spielt dein jüngstes Backup in eine Wegwerf-Datenbank ein, zählt die Objekte und löscht die Datenbank wieder. Deine echten Daten bleiben unberührt. Er läuft einmal im Monat automatisch. Von Hand startest du ihn mit **Jetzt testen**.

- **Letzter Restore-Test: …, erfolgreich:** Das Backup lässt sich wiederherstellen.
- **Achtung: Getestet wurde nicht dein jüngstes Backup …:** Das jüngste Stück war nicht prüfbar. Mach mit **Jetzt sichern** ein neues Backup und teste noch einmal.
- **… fehlgeschlagen:** Darunter steht, was zu tun ist. Meist hilft ein neues Backup mit **Jetzt sichern** und ein erneuter Test. Ist das Ziel nicht erreichbar, schließe die Festplatte an.

Ohne Backup-Ziel gibt es nichts zu testen.

## 3. Wiederherstellen

Das geht nur im Terminal und nur, wenn Core und Worker **nicht** laufen. Es ersetzt deinen aktuellen Stand.

1. Im Repo-Ordner beenden:

   ```bash
   pnpm sg stop
   ```

2. Die Stände ansehen:

   ```bash
   pnpm sg restore
   ```

   Die Liste zeigt die Stände im Backup-Ziel, neueste zuerst. Jede Zeile hat den Namen (zum Beispiel `20261104T030012Z`), den Auslöser und die Größe. Ist kein Ziel bekannt, hänge `--ziel <pfad>` an.
3. Erst testen:

   ```bash
   pnpm sg restore --test 20261104T030012Z
   ```

   Am Ende muss „Test bestanden“ stehen.
4. Wiederherstellen:

   ```bash
   pnpm sg restore 20261104T030012Z
   ```

   Auf die Frage antwortest du mit `ja`. Die aktuellen Daten werden zur Seite gelegt, nicht gelöscht.
5. Starten:

   ```bash
   pnpm sg start
   ```

   Stammt der Stand von einer älteren Version, läuft dabei die Migration.

Die bisherigen Daten bleiben als Sicherheitsnetz liegen: als Datenbank mit dem Zusatz `_vor_restore_…` und als Ordner `media.vor-restore-…` bzw. `vault.vor-restore-…` im Datenordner. Löschen musst du sie selbst.

Ein Stand von einer **neueren** App-Version wird abgelehnt. Mach dann zuerst `git pull` ([UPDATE.md](UPDATE.md)).

Wurde die Wiederherstellung unterbrochen, schließt `pnpm sg start` sie beim nächsten Mal selbst ab oder baut sie zurück.

**iPad nach einer Wiederherstellung:** Das iPad erkennt die Wiederherstellung, sobald es sich wieder mit dem Mac verbindet, und gleicht danach alle Seiten selbst neu ab. Du musst dafür keine Notizbücher öffnen. Auf dem Startbildschirm steht solange die Zeile „Mac wiederhergestellt · N Seiten werden abgeglichen“. Die Zahl zählt herunter, am Ende verschwindet die Zeile.

- **Das iPad verbunden lassen, bis die Zeile weg ist.** Reißt die Verbindung ab, pausiert der Abgleich. Beim nächsten Verbinden macht das iPad dort weiter, wo es aufgehört hat.
- Auch während des Abgleichs kannst du auf dem iPad schreiben. Neue Striche gehen nicht verloren.
- Steht die Zeile nach einer Weile noch da und die Zahl ändert sich nicht, prüfe die Verbindung („Mac ●“ oben rechts).

## 4. Papierkorb

Gelöschte Semester, Module, Foliensätze, Sessions, Notizbücher und mehr bleiben 30 Tage im Papierkorb. Das ist der schnellste Weg, wenn du nur etwas versehentlich gelöscht hast.

1. **Einstellungen → Daten und Papierkorb**, weiter unten **Papierkorb**.
2. Beim Eintrag **Wiederherstellen** klicken. Daneben steht, wie viele Tage er noch da ist.
3. **Endgültig löschen** und **Papierkorb leeren** lassen sich nicht rückgängig machen. Die App fragt vorher nach.
