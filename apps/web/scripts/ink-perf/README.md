# Ink-Leistungsmessung (Issue #79)

`measure.cjs` misst die Frame-Zeit (p50, p95, max) des Ink-Renderers bei **Zoom 1** und **Zoom 2** mit vielen Strichen.
Es bündelt `harness.tsx` (rendert `<InkPage>`) mit esbuild, öffnet es in Playwright und liest die Abstände zwischen
`requestAnimationFrame`-Aufrufen. Zwei Fälle je Zoom:

- `append`: pro Frame kommt ein Strich dazu (Live-Schreiben, inkrementelle Zeichnung der Tinte-Ebene).
- `idle`: nichts ändert sich, es wird nur komponiert (die drei Canvas-Ebenen).

Ziel laut Issue: p95 bei Zoom 2 höchstens 16,7 ms (60 Hz). Liegt der Wert darüber, entscheidet der Owner/Claude, ob die
Ebenen zusammengelegt werden. Die Architektur wird nicht auf Verdacht geändert.

## Auf dem Mac starten

Voraussetzung: Node 22 und `pnpm install` im Repo-Wurzelordner. Playwright muss einmalig vorhanden sein:

```bash
cd WI-Webapp
pnpm install
npx playwright install chromium webkit   # lädt die Browser, einmalig
```

Falls `require('playwright')` nicht gefunden wird: `npm install --no-save playwright` im Repo-Wurzelordner (nicht
committen) oder global `npm i -g playwright` mit `export NODE_PATH=$(npm root -g)`.

### Einfache Variante: im echten Browser per Knopfdruck (empfohlen für Mac-GPU)

```bash
node apps/web/scripts/ink-perf/measure.cjs --serve
```

Das Skript bündelt die Harness und startet einen kleinen Server. Dann **http://localhost:8123/#manual** öffnen, und zwar
nacheinander in **Chrome** und in **Safari** (Safari-Fenster normal groß lassen, nicht im Hintergrund-Tab messen). Oben
rechts auf „Zoom 1 messen“ klicken, danach auf einer frisch geladenen Seite „Zoom 2 messen“ (Seite zwischen den Messungen
neu laden, damit sich nichts überlagert). Die Zeile zeigt p50, p95 und max in Millisekunden. Beenden mit Strg+C.
Das ist die aussagekräftigste Messung, weil sie die echte GPU und den echten Compositor nutzt.

### Automatisch per Playwright

```bash
node apps/web/scripts/ink-perf/measure.cjs --browser chromium   # Chrome-Engine, headless
node apps/web/scripts/ink-perf/measure.cjs --browser webkit     # Safari-Engine, headless
```

Headless läuft ohne echte GPU und ist deshalb nur ein Vergleich Zoom 1 gegen Zoom 2, kein Absolutwert.

## Optionen

| Option | Standard | Bedeutung |
|---|---|---|
| `--browser` | `chromium` | `chromium`, `webkit` oder `firefox` |
| `--strokes` | `1500` | Striche auf der Seite vor der Messung |
| `--frames` | `120` | gemessene Frames je Fall |
| `--throttle` | `1` | CPU-Drosselung (nur Chromium); `4` entspricht der Messung in Issue #79 |
| `--dpr` | `2` | Geräte-Pixel-Verhältnis (Retina) |
| `--width` | `700` | CSS-Breite der Seite bei Zoom 1 (bei Zoom 2 doppelt) |
| `--json` | aus | Ausgabe als JSON |
| `--serve` | aus | Handbetrieb im eigenen Browser (Port 8123) |

## Lesen der Ausgabe

`p95 ms` ist der Wert, der unter 16,7 liegen soll. `Frames>25ms` zählt deutlich verpasste Frames. Bitte die Ausgabe (Chrome und Safari, Zoom 1 und Zoom 2) ins Issue #79 kopieren.
