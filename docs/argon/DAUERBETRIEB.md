# Argon im Dauerbetrieb

Ziel: Der Owner startet Argon **einmal** (z. B. morgens), danach arbeitet Argon selbstständig weiter.
Sobald Claude neue Issues anlegt oder Nacharbeit anfordert, legt Argon innerhalb von ca. 5 Minuten los.

## Wie es funktioniert

1. Argon arbeitet die Queue ab (wie im normalen Start-Prompt).
2. Ist die Queue leer, startet Argon `scripts/argon-watch.sh` als Hintergrund-Task und beendet seinen Turn.
   Das Skript fragt GitHub alle 5 Minuten ab. Das kostet **kein** Gemini-Kontingent, denn es ist nur ein Shell-Befehl.
3. Liegt neue Arbeit vor, beendet sich das Skript. Antigravity weckt Argon automatisch, und es geht bei Schritt 1 weiter.

**Voraussetzungen:**
- Antigravity bleibt offen.
- Der Mac ist an und nicht im Ruhezustand. Am besten am Strom, mit offenem Deckel. Wird der Deckel zugeklappt, schläft der Mac trotzdem ein.
- Nach spätestens 12 Stunden ohne neue Arbeit endet der Dauerbetrieb von selbst.
- Ist Argons Kontingent aufgebraucht, übernimmt Claude (siehe `docs/KOLLABORATION.md`, Abschnitt 5a).

**Noch nicht getestet:** Ob Antigravity sehr lange Hintergrund-Tasks (Stunden) zuverlässig laufen lässt und Argon danach weckt.
Belegt ist bisher nur, dass Argon nach Hintergrund-Tasks von wenigen Sekunden geweckt wird.
Der erste Dauerbetrieb ist deshalb gleichzeitig der Test. Argon soll seine Beobachtungen in `docs/argon/UMGEBUNG.md` nachtragen.

## Start (einmal pro Tag)

Neuen Chat in Antigravity öffnen, im selben Workspace. Ordner und GitHub-Login bleiben eingerichtet.
Modell **Gemini 4 Argon (Medium)** wählen und diesen Text einfügen:

```text
Du bist Argon. Prüfe zuerst mit "gh auth status", ob der GitHub-Login aktiv ist,
und ob GEMINI.md und AGENTS.md im Repo-Root existieren (nach git pull auf main).
Falls nicht: abbrechen und mir Bescheid geben.

Lies GEMINI.md, AGENTS.md und docs/argon/DAUERBETRIEB.md und halte dich strikt daran.

Arbeite im DAUERBETRIEB:
1. Arbeite die Queue ab, genau wie in GEMINI.md beschrieben.
2. Ist die Queue leer: starte "bash scripts/argon-watch.sh" als Hintergrund-Task und
   beende deinen Turn. Nicht selbst mit sleep pollen.
3. Wenn das Skript endet:
   - Ausgabe "ARBEIT": git checkout main && git pull, dann weiter bei Schritt 1.
   - Ausgabe "FEHLER": mir Bescheid geben (GitHub-Login prüfen) und stoppen.
   - Ausgabe "ENDE": kurze Zusammenfassung des Tages und stoppen.
4. Merkst du, dass dein Kontingent knapp wird: wie in GEMINI.md beschrieben
   Zwischenstand pushen, argon:limit setzen, stoppen.

Jeder Kommentar von dir beginnt mit **[Argon]**. Arbeite selbstständig, ohne mich zu fragen,
solange du innerhalb der Regeln bleibst.
```

Stoppen: Im Antigravity-Chat auf Stopp klicken oder schreiben „Dauerbetrieb beenden“.
