#!/usr/bin/env python3
"""Erzeugt einfache SVG-Vorschauen (`vorschau/NN-name.svg`) zur Sichtkontrolle der Strich-Testdaten.

Eigenschaften:
- Seitenformat A4 hoch (595 x 842 pt) mit leichtem Linienraster
- Zwei Ebenen: zuerst `highlight` (Textmarker unter der Schrift), darüber `ink` (Schrift)
- Affine Transformation `transform` ([a, b, c, d, e, f]) auf alle Punkte angewandt
- Darstellung als Segmente mit Farbe, Deckkraft (`#RRGGBBAA`) und druckabhängiger Breite (`width * force`, bei `monoline`/`marker` konstant)

Ausführung:
    python3 tests/fixtures/strokes/vorschau.py
"""

from __future__ import annotations

import json
from pathlib import Path

from stroke_format import apply_transform, unpack_points

FIXTURES_DIR = Path(__file__).resolve().parent
VORSCHAU_DIR = FIXTURES_DIR / "vorschau"

PAGE_WIDTH = 595
PAGE_HEIGHT = 842


def parse_rgba(hex_color: str) -> tuple[str, float]:
    """Zerlegt `#RRGGBBAA` in (`#RRGGBB`, opacity_float)."""
    rgb = hex_color[:7]
    alpha_int = int(hex_color[7:9], 16)
    return rgb, round(alpha_int / 255.0, 3)


def render_stroke_svg(stroke: dict) -> list[str]:
    """Rendert einen einzelnen Strich als SVG-Elemente (mit angewandter `transform`)."""
    points = unpack_points(stroke["points"])
    transform = stroke["transform"]
    width = float(stroke["width"])
    tool = stroke["tool"]
    rgb, opacity = parse_rgba(stroke["color"])

    transformed_pts = [
        (apply_transform(px, py, transform)[0], apply_transform(px, py, transform)[1], force)
        for (px, py, _dt, force, _az, _alt) in points
    ]

    elems: list[str] = []
    if len(transformed_pts) == 1:
        x0, y0, f0 = transformed_pts[0]
        eff_w = width if tool in ("monoline", "marker") else max(0.4, width * max(0.2, f0))
        elems.append(
            f'    <circle cx="{x0:.2f}" cy="{y0:.2f}" r="{eff_w / 2.0:.2f}" '
            f'fill="{rgb}" fill-opacity="{opacity}" />'
        )
        return elems

    # Für monoline und marker reicht eine einzelne <polyline>, da die Breite konstant ist
    if tool in ("monoline", "marker"):
        pts_attr = " ".join(f"{x:.2f},{y:.2f}" for x, y, _ in transformed_pts)
        cap = "butt" if tool == "marker" else "round"
        elems.append(
            f'    <polyline points="{pts_attr}" fill="none" stroke="{rgb}" '
            f'stroke-opacity="{opacity}" stroke-width="{width:.2f}" '
            f'stroke-linecap="{cap}" stroke-linejoin="round" />'
        )
        return elems

    # Für druckabhängige Werkzeuge (pen, fountain, pencil): gebündelte Teilsegmente mit Breite = width * force
    chunk_size = 4
    n = len(transformed_pts)
    for start in range(0, n - 1, chunk_size):
        end = min(n, start + chunk_size + 1)
        sub = transformed_pts[start:end]
        avg_force = sum(p[2] for p in sub) / len(sub)
        eff_w = max(0.35, width * max(0.12, avg_force))
        pts_attr = " ".join(f"{x:.2f},{y:.2f}" for x, y, _ in sub)
        elems.append(
            f'    <polyline points="{pts_attr}" fill="none" stroke="{rgb}" '
            f'stroke-opacity="{opacity}" stroke-width="{eff_w:.2f}" '
            f'stroke-linecap="round" stroke-linejoin="round" />'
        )
    return elems


def build_svg(title: str, strokes: list[dict]) -> str:
    """Erstellt ein vollständiges A4-SVG-Dokument mit Hintergrundlinien, `highlight`- und `ink`-Ebene."""
    lines: list[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {PAGE_WIDTH} {PAGE_HEIGHT}" width="{PAGE_WIDTH}" height="{PAGE_HEIGHT}">',
        f"  <title>{title}</title>",
        f'  <rect width="{PAGE_WIDTH}" height="{PAGE_HEIGHT}" fill="#FAF9F5" />',
        '  <g id="page-grid" stroke="#E9ECEF" stroke-width="0.7">',
    ]
    for y in range(60, PAGE_HEIGHT - 30, 30):
        lines.append(f'    <line x1="40" y1="{y}" x2="{PAGE_WIDTH - 40}" y2="{y}" />')
    lines.append("  </g>")

    highlight_strokes = [s for s in strokes if s["layer"] == "highlight"]
    ink_strokes = [s for s in strokes if s["layer"] == "ink"]

    lines.append('  <g id="layer-highlight" style="mix-blend-mode: multiply;">')
    for st in highlight_strokes:
        lines.extend(render_stroke_svg(st))
    lines.append("  </g>")

    lines.append('  <g id="layer-ink">')
    for st in ink_strokes:
        lines.extend(render_stroke_svg(st))
    lines.append("  </g>")

    # Bei Fall 05 zusätzlich die Bounding-Boxen gestrichelt einzeichnen, um die Transformation (+50/+20 pt) sichtbar zu machen
    if title.startswith("05-"):
        lines.append('  <g id="debug-bboxes" fill="none" stroke-dasharray="4 3" stroke-width="1.0">')
        for idx, st in enumerate(strokes):
            bx, by, bw, bh = st["bbox"]
            b_col = "#868E96" if idx == 0 else "#1864AB"
            lines.append(
                f'    <rect x="{bx:.2f}" y="{by:.2f}" width="{bw:.2f}" height="{bh:.2f}" stroke="{b_col}" />'
            )
        lines.append("  </g>")

    lines.append("</svg>")
    return "\n".join(lines) + "\n"


def main() -> int:
    VORSCHAU_DIR.mkdir(parents=True, exist_ok=True)
    json_files = sorted(FIXTURES_DIR.glob("*.json"))
    for jf in json_files:
        strokes = json.loads(jf.read_text(encoding="utf-8"))
        svg_content = build_svg(jf.stem, strokes)
        svg_path = VORSCHAU_DIR / f"{jf.stem}.svg"
        svg_path.write_text(svg_content, encoding="utf-8")
        print(f"Vorschau erzeugt: vorschau/{svg_path.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
