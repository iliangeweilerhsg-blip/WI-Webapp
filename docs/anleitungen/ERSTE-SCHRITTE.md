# Erste Schritte

So bringst du das Studien-Gehirn auf dem Mac zum Laufen und richtest es ein. Dauer: etwa 30 Minuten, ohne die Downloads.
Die Befehle gibst du im **Terminal** ein, im Ordner des Repos. Tippe `cd ` (mit Leerzeichen), zieh den Repo-Ordner aus dem Finder ins Terminal und drück Enter.

## 1. Installieren

Du brauchst einen Mac, am besten mit Apple Silicon. Installiere der Reihe nach:

1. **Docker**: [OrbStack](https://orbstack.dev) oder Docker Desktop installieren und einmal starten.
2. **Node 22.18 oder neuer** (22.x), zum Beispiel mit `nvm install 22`. Die Version steht in `.nvmrc`.
3. **pnpm**: `corepack enable`
4. **uv** (für den Python-Worker): `brew install uv`
5. Abhängigkeiten laden:

   ```bash
   pnpm install
   ```

## 2. Prüfen

```bash
pnpm sg doctor
```

Der Befehl prüft Node, pnpm, uv, Docker, die Ports 4710 und 5432 und den Datenordner (Standard `~/StudienGehirn`). Jede Zeile beginnt mit ✓ (in Ordnung), ✗ (fehlt) oder ℹ (Hinweis). Bei ✗ steht darunter, was zu tun ist. Behebe das und starte `pnpm sg doctor` erneut. Am Ende muss „Alles bereit.“ stehen.

## 3. Erster Start

```bash
pnpm sg start
```

Beim ersten Mal dauert das einige Minuten: Der Befehl startet die Datenbank, baut die Web-App und startet Core und Worker. Auf dem Mac öffnet sich der Browser selbst. Sonst öffne die Adresse, die im Terminal nach „Studien-Gehirn läuft:“ steht.

Lass das Terminal-Fenster offen. Mit `ctrl` + `C` beendest du alles wieder. Aus einem zweiten Fenster geht das mit `pnpm sg stop`.

## 4. Einrichtung

Beim ersten Öffnen erscheint ein Dialog mit zwei Schritten:

1. **Semester:** Der Name genügt, die App schlägt einen vor. **Weiter** führt zu den Modulen.
2. **Module:** Modulnamen eintippen, Enter drücken. **Fertig** schließt den Dialog.

Mit **Später** überspringst du den Dialog. Semester und Module ergänzt du dann unter **Einstellungen → Allgemein**.

Der Dialog endet bei den Modulen. Alles Weitere stellst du selbst ein.

## 5. Danach

| Aufgabe | Wo | Anleitung |
|---|---|---|
| Stundenplan | **Kalender**, Bereich „Stundenplan importieren“: ICS-Datei mit **Datei importieren** oder Adresse mit **Abonnieren** | Eine eigene Anleitung gibt es noch nicht |
| Moodle | Terminal: `pnpm sg moodle login` | [MOODLE.md](MOODLE.md), bei Problemen [MOODLE-TOKEN.md](MOODLE-TOKEN.md) |
| Mikrofon | **Einstellungen → Vorlesung → Mikrofon**. Der Browser fragt beim ersten Aufnehmen nach der Erlaubnis | Einen eigenen Mikrofontest gibt es noch nicht. Mach vor der ersten Vorlesung eine kurze Probe-Session |
| Transkription | Worker-Pakete einmal laden | [TRANSKRIPTION.md](TRANSKRIPTION.md) |
| Backup | **Einstellungen → Daten und Papierkorb**: Backup-Ziel eintragen, **Speichern**, dann **Jetzt sichern** | [BACKUP-WIEDERHERSTELLEN.md](BACKUP-WIEDERHERSTELLEN.md) |
| iPad | App aufspielen, dann **Einstellungen → Geräte** | [IPAD.md](IPAD.md), bei Problemen [IPAD-VERBINDUNG.md](IPAD-VERBINDUNG.md) |
| Suche | ⌘K | [SUCHE.md](SUCHE.md) |

Für den ersten Vorlesungstag lies [VORLESUNGSTAG.md](VORLESUNGSTAG.md). Für spätere Updates [UPDATE.md](UPDATE.md).
