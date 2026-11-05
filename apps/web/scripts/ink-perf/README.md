# Ink-Leistungsmessung (Issue #79)

Das Skript `measure.cjs` misst, wie flüssig der Ink-Renderer bei **Zoom 1** und **Zoom 2** mit vielen Strichen (1500) läuft.
Gemessen wird die Zeit pro Frame (p50, p95, max). Zwei Fälle je Zoom:

- `append`: pro Frame kommt ein Strich dazu (Live-Schreiben).
- `idle`: nichts ändert sich, es wird nur komponiert.

**Was ist „gut“?** Der p95-Wert bei Zoom 2 soll höchstens **16,7 ms** betragen (60 Bilder pro Sekunde). Liegt er darüber,
entscheiden wir danach, ob die Ebenen zusammengelegt werden. Die Architektur wird nicht auf Verdacht geändert.

## 1. Einfachster Weg: im eigenen Browser, ohne Playwright

Voraussetzung: Node und `pnpm install` im Repo-Ordner (ist schon erledigt, wenn die App bei dir läuft).

1. **Mac auf hellen Modus stellen** (Systemeinstellungen > Erscheinungsbild > Hell). Die Messseite erzwingt zwar das
   helle Theme, aber so sind die Werte sicher vergleichbar.
2. Im Terminal, im Repo-Ordner:

   ```bash
   node apps/web/scripts/ink-perf/measure.cjs --serve
   ```

3. Die ausgegebene Adresse öffnen, normalerweise **http://127.0.0.1:8123/#manual**, zuerst in **Chrome**, danach in
   **Safari**. Das Fenster normal groß und im Vordergrund lassen, keine anderen schweren Programme laufen lassen.
4. Oben rechts auf **„Zoom 1 messen“** klicken, kurz warten. Dann die Seite neu laden (Cmd+R) und **„Zoom 2 messen“**
   klicken. Pro Messung erscheint eine Zeile mit p50, p95 und max in Millisekunden, für `append` und `idle`.
5. Mit **ctrl+C** im Terminal beenden.

Ist der Port belegt, kommt eine Meldung. Dann einen anderen nehmen: `--serve --port 8124`.

## 2. Optional: automatisch mit Playwright

Nur nötig, wenn du die Werte ohne Klicken (headless) willst. Playwright kommt in einen **eigenen Ordner**, nicht ins Repo
(kein `npm install` im Repo-Ordner, das kann pnpm-Pakete entfernen):

```bash
mkdir ~/ink-perf && cd ~/ink-perf && npm i playwright && npx playwright install chromium webkit
```

Danach im Repo-Ordner:

```bash
NODE_PATH=~/ink-perf/node_modules node apps/web/scripts/ink-perf/measure.cjs --browser chromium   # Chrome-Engine
NODE_PATH=~/ink-perf/node_modules node apps/web/scripts/ink-perf/measure.cjs --browser webkit     # Safari-Engine
```

Headless läuft ohne echte GPU. Diese Werte taugen nur zum Vergleich Zoom 1 gegen Zoom 2, nicht als Absolutwert. Für die
echte Mac-GPU zählt Weg 1.

## Optionen

| Option | Standard | Bedeutung |
|---|---|---|
| `--serve` | aus | Handbetrieb im eigenen Browser (kein Playwright nötig) |
| `--port` | `8123` | Port für `--serve` |
| `--browser` | `chromium` | `chromium`, `webkit` oder `firefox` (Playwright) |
| `--strokes` | `1500` | Striche auf der Seite vor der Messung |
| `--frames` | `120` | gemessene Frames je Fall |
| `--throttle` | `1` | CPU-Drosselung (nur Chromium); `4` entspricht der Messung in Issue #79 |
| `--dpr` | `2` | Geräte-Pixel-Verhältnis (Retina) |
| `--width` | `700` | CSS-Breite der Seite bei Zoom 1 (bei Zoom 2 doppelt) |
| `--json` | aus | Ausgabe als JSON |

## Was zurückmelden?

Bitte die Werte (Chrome und Safari, Zoom 1 und Zoom 2, jeweils `append` und `idle`) als **Kommentar in Issue #79**
eintragen, am besten als Tabelle, dazu Mac-Modell und Browser-Version. Ein Foto oder Screenshot der Messzeilen reicht auch.
