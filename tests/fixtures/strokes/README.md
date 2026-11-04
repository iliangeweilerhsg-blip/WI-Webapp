# Testdaten für das neutrale Strich-Format (08 §4 · T1-14, T1-16, Spike S3)

Dieses Verzeichnis enthält deterministisch erzeugte Referenz-Testdaten (`*.json`), den Python-Referenz-Packer/-Entpacker (`stroke_format.py`), das Prüfskript (`pruefen.py`), den Generator (`erzeugen.py`) sowie einfache SVG-Vorschauen (`vorschau/*.svg`) für das neutrale Strich-Format aus [`docs/spezifikation/08-SCHNITTSTELLEN.md`](../../../docs/spezifikation/08-SCHNITTSTELLEN.md) (§4.1 und §4.2).

## Format-Kurzbeschreibung (`08 §4.1` / `§4.2`)

Jede Datei `NN-name.json` enthält ein JSON-Array der Striche einer A4-Hochformat-Seite (`595 × 842 pt`, Ursprung oben links):

- **`client_id`:** Vom Client (iPad) vergebene, stabile **UUIDv7** nach RFC 9562.
- **`tool`:** `"pen" | "pencil" | "marker" | "monoline" | "fountain"` (Zuordnung zu PencilKit `PKInkingTool.InkType` siehe `08 §4.3` und `docs/entscheidungen/RECHERCHE-SPIKES.md` Abschnitt S3).
- **`layer`:** `"ink"` (obere Schriftebene) oder `"highlight"` (untere Textmarker-Ebene).
- **`color`:** 8-stelliger Hex-Farbwert `#RRGGBBAA` (inkl. Alpha-Kanal).
- **`width`:** Grundbreite des Werkzeugs in Punkt (`pt`).
- **`created_at`:** Synchronisierte Startzeit des Strichs in Epochen-Millisekunden (`int`).
- **`t_start_ms` / `t_end_ms`:** Sitzungszeit in Millisekunden seit `session.started_at` oder `null` bei Strichen außerhalb einer laufenden Session.
- **`transform`:** 6 Werte `[a, b, c, d, e, f]` einer affinen 2D-Transformation (`CGAffineTransform`, Identität `[1, 0, 0, 1, 0, 0]`). Die gepackten Rohpunkte in `points` bleiben bei einer Lasso-Verschiebung unverändert; `transform` wird beim Rendern und für `bbox` angewandt (`x' = a·x + c·y + e`, `y' = b·x + d·y + f`).
- **`bbox`:** Umschließendes Rechteck `[x, y, w, h]` in Seitenkoordinaten (`pt`) **nach** Anwendung von `transform` (inkl. halber Strichbreite).
- **`points`:** Base64-kodierter Binärpuffer. Pro Punkt genau **24 Byte** (`6 × Float32` little-endian, `struct`-Format `<6f`):
  1. `x` (`pt`)
  2. `y` (`pt`)
  3. `dt` (`ms` seit `created_at`, monoton steigend ab `0.0`)
  4. `force` (`0.0` bis `1.0`, normierter Stiftdruck)
  5. `azimuth` (`rad`, Richtungswinkel in `[-π, π]`)
  6. `altitude` (`rad`, Neigungswinkel zur Oberfläche in `[0, π/2]`, `0` = flach, `π/2` = senkrecht)

## Übersicht der 7 Testfälle

| Fall | JSON-Datei | SVG-Vorschau | Beschreibung |
| :--- | :--- | :--- | :--- |
| **1** | `01-handschrift-pen.json` | [`vorschau/01-handschrift-pen.svg`](vorschau/01-handschrift-pen.svg) | Handschrift-Zeile *„Marktgleichgewicht"* mit `pen` (`#1E2A44FF`, `2.4 pt`, 14 Striche) und natürlichem Druckverlauf (Anstieg am Strichanfang, Plateau, Abfall beim Absetzen). |
| **2** | `02-fountain-und-pencil.json` | [`vorschau/02-fountain-und-pencil.svg`](vorschau/02-fountain-und-pencil.svg) | Dasselbe Wort *„Marktgleichgewicht"* zweimal untereinander: oben mit `fountain` (Füller, starke Druckvariation zwischen Auf- und Abstrichen), unten mit `pencil` (Bleistift, flache Stiftneigung `altitude ≈ 0.38 rad` → breiterer Strich `4.6 pt`). |
| **3** | `03-monoline-geometrie.json` | [`vorschau/03-monoline-geometrie.svg`](vorschau/03-monoline-geometrie.svg) | Geometrische Skizze mit `monoline` und konstantem Druck (`force = 0.65`): geschlossener Kasten, horizontaler Pfeil (Schaft + Spitze) und farbige Unterstreichung. |
| **4** | `04-textmarker-highlight.json` | [`vorschau/04-textmarker-highlight.svg`](vorschau/04-textmarker-highlight.svg) | Halbtransparenter gelber Textmarker (`tool: "marker"`, `layer: "highlight"`, `color: "#FFE06666"`, `width: 18.0 pt`) über einer mit `pen` (`layer: "ink"`) geschriebenen Zeile *„Marktgleichgewicht"*. |
| **5** | `05-lasso-transform.json` | [`vorschau/05-lasso-transform.svg`](vorschau/05-lasso-transform.svg) | Direkter Vergleich vor/nach einer Lasso-Verschiebung: Strich 1 am Ursprungsort (`transform: [1, 0, 0, 1, 0, 0]`), Strich 2 mit identischen Rohpunkten in `points`, aber `transform: [1, 0, 0, 1, 50, 20]` (um `+50 pt` nach rechts und `+20 pt` nach unten verschoben) und entsprechend verschobener `bbox`. |
| **6** | `06-randfaelle.json` | [`vorschau/06-randfaelle.svg`](vorschau/06-randfaelle.svg) | Fünf technische Randfälle in einer Datei: (1) 1-Punkt-Tipp, (2) 2-Punkte-Kurzstrich, (3) sehr langer Strich mit exakt `1 000` Punkten, (4) Strich mit den Extremwerten `force = 0.0` und `force = 1.0`, (5) Strich außerhalb einer Session (`t_start_ms: null`, `t_end_ms: null`). |
| **7** | `07-notizseite-200-striche.json` | [`vorschau/07-notizseite-200-striche.svg`](vorschau/07-notizseite-200-striche.svg) | Ganze A4-Vorlesungsnotizseite mit `231` Strichen (`19 801` Punkte) aus 10 Handschrift-Zeilen (`pen`, `fountain`, `pencil`) und `3` Textmarker-Hervorhebungen (`marker`, `layer: "highlight"`) mit streng fortlaufenden Zeitstempeln. |

## Befehle

Alle Skripte nutzen **ausschließlich die Python-3-Standardbibliothek** (`struct`, `base64`, `json`, `uuid`, `math`, `random`) und benötigen keine externen Pakete:

```bash
# 1. Testdaten deterministisch neu erzeugen (fester Seed)
python3 tests/fixtures/strokes/erzeugen.py

# 2. Alle 7 JSON-Dateien gegen Schema, Wertebereiche, Bounding-Box und Float32-Roundtrip prüfen
python3 tests/fixtures/strokes/pruefen.py

# 3. SVG-Vorschauen in tests/fixtures/strokes/vorschau/ neu generieren
python3 tests/fixtures/strokes/vorschau.py
```
