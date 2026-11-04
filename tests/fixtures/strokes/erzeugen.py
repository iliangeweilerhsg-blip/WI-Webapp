#!/usr/bin/env python3
"""Deterministischer Generator für die 7 Strich-Format-Testfälle (08 §4.1 / §4.2).

Erzeugt mit festem Zufalls-Seed:
- 01-handschrift-pen.json
- 02-fountain-und-pencil.json
- 03-monoline-geometrie.json
- 04-textmarker-highlight.json
- 05-lasso-transform.json
- 06-randfaelle.json
- 07-notizseite-200-striche.json

Ausführung:
    python3 tests/fixtures/strokes/erzeugen.py
"""

from __future__ import annotations

import json
import math
import random
from pathlib import Path
from typing import Sequence

from stroke_format import (
    compute_bbox,
    pack_points,
    unpack_points,
    uuid7_from_rng,
)

FIXTURES_DIR = Path(__file__).resolve().parent
BASE_EPOCH_MS = 1762246500000  # 2025-11-04T08:55:00.000Z
BASE_SESSION_MS = 300000       # 5 min in der laufenden Vorlesung

# Vektor-Glyphen im Einheitskasten [0..1] x [0..1] (y=0 oben, y=1 Grundlinie, >1 Unterlänge).
# Jedes Zeichen besteht aus 1..3 Teilstrichen (Listen von (x, y)-Stützpunkten).
GLYPHS: dict[str, list[list[tuple[float, float]]]] = {
    "M": [[(0.0, 1.0), (0.0, 0.0), (0.5, 0.65), (1.0, 0.0), (1.0, 1.0)]],
    "Q": [
        [(0.5, 0.02), (0.12, 0.25), (0.12, 0.78), (0.5, 0.98), (0.88, 0.78), (0.88, 0.25), (0.5, 0.02)],
        [(0.55, 0.68), (0.95, 1.05)],
    ],
    "x": [
        [(0.15, 0.35), (0.85, 1.0)],
        [(0.85, 0.35), (0.15, 1.0)],
    ],
    "j": [
        [(0.55, 0.35), (0.55, 1.25), (0.35, 1.42), (0.15, 1.3)],
        [(0.52, 0.12), (0.58, 0.15)],
    ],
    "a": [[(0.85, 0.45), (0.5, 0.3), (0.1, 0.45), (0.05, 0.8), (0.4, 1.0), (0.8, 0.85), (0.85, 0.35), (0.9, 1.0)]],
    "r": [[(0.15, 0.35), (0.15, 1.0), (0.15, 0.55), (0.45, 0.32), (0.85, 0.38)]],
    "k": [
        [(0.15, 0.0), (0.15, 1.0)],
        [(0.85, 0.35), (0.2, 0.68), (0.9, 1.0)],
    ],
    "t": [
        [(0.45, 0.08), (0.45, 0.92), (0.65, 1.0), (0.85, 0.92)],
        [(0.15, 0.35), (0.8, 0.35)],
    ],
    "g": [[(0.85, 0.4), (0.45, 0.3), (0.1, 0.5), (0.15, 0.9), (0.55, 0.98), (0.85, 0.75), (0.85, 0.35), (0.85, 1.3), (0.45, 1.45), (0.15, 1.3)]],
    "l": [[(0.35, 0.0), (0.35, 0.9), (0.55, 1.0), (0.75, 0.9)]],
    "e": [[(0.1, 0.65), (0.85, 0.6), (0.75, 0.35), (0.35, 0.32), (0.08, 0.6), (0.25, 0.95), (0.75, 0.95)]],
    "i": [
        [(0.45, 0.35), (0.45, 1.0)],
        [(0.42, 0.12), (0.48, 0.15)],
    ],
    "c": [[(0.85, 0.4), (0.45, 0.3), (0.1, 0.55), (0.2, 0.92), (0.6, 1.0), (0.88, 0.9)]],
    "h": [[(0.15, 0.0), (0.15, 1.0), (0.18, 0.55), (0.5, 0.35), (0.82, 0.48), (0.85, 1.0)]],
    "w": [[(0.05, 0.35), (0.25, 1.0), (0.5, 0.5), (0.75, 1.0), (0.95, 0.35)]],
    "N": [[(0.1, 1.0), (0.1, 0.0), (0.9, 1.0), (0.9, 0.0)]],
    "o": [[(0.5, 0.3), (0.12, 0.5), (0.12, 0.85), (0.5, 1.0), (0.88, 0.85), (0.88, 0.5), (0.5, 0.3)]],
    "u": [[(0.15, 0.35), (0.15, 0.85), (0.45, 1.0), (0.82, 0.82), (0.85, 0.35), (0.85, 1.0)]],
    "n": [[(0.15, 0.35), (0.15, 1.0), (0.18, 0.52), (0.52, 0.34), (0.85, 0.48), (0.85, 1.0)]],
    "s": [[(0.82, 0.4), (0.45, 0.3), (0.15, 0.45), (0.5, 0.65), (0.85, 0.82), (0.45, 1.0), (0.12, 0.9)]],
    "d": [[(0.85, 0.5), (0.45, 0.32), (0.12, 0.55), (0.18, 0.95), (0.58, 1.0), (0.85, 0.78), (0.85, 0.0), (0.85, 1.0)]],
    "p": [[(0.15, 0.35), (0.15, 1.4), (0.15, 0.5), (0.55, 0.32), (0.88, 0.55), (0.78, 0.92), (0.4, 1.0), (0.15, 0.85)]],
    "v": [[(0.1, 0.35), (0.5, 1.0), (0.9, 0.35)]],
    "z": [[(0.1, 0.35), (0.9, 0.35), (0.1, 1.0), (0.9, 1.0)]],
    "A": [
        [(0.05, 1.0), (0.5, 0.0), (0.95, 1.0)],
        [(0.22, 0.65), (0.78, 0.65)],
    ],
    "B": [
        [(0.15, 0.0), (0.15, 1.0)],
        [(0.15, 0.0), (0.75, 0.08), (0.82, 0.32), (0.5, 0.48), (0.15, 0.48), (0.8, 0.55), (0.88, 0.82), (0.55, 1.0), (0.15, 1.0)],
    ],
    "D": [
        [(0.15, 0.0), (0.15, 1.0)],
        [(0.15, 0.0), (0.7, 0.1), (0.92, 0.5), (0.7, 0.9), (0.15, 1.0)],
    ],
    "E": [
        [(0.85, 0.0), (0.15, 0.0), (0.15, 1.0), (0.85, 1.0)],
        [(0.15, 0.5), (0.7, 0.5)],
    ],
    "F": [
        [(0.85, 0.0), (0.15, 0.0), (0.15, 1.0)],
        [(0.15, 0.5), (0.7, 0.5)],
    ],
    "G": [[(0.85, 0.2), (0.45, 0.0), (0.1, 0.25), (0.1, 0.8), (0.48, 1.0), (0.88, 0.85), (0.88, 0.55), (0.5, 0.55)]],
    "H": [
        [(0.15, 0.0), (0.15, 1.0)],
        [(0.85, 0.0), (0.85, 1.0)],
        [(0.15, 0.5), (0.85, 0.5)],
    ],
    "I": [[(0.5, 0.0), (0.5, 1.0)]],
    "K": [
        [(0.15, 0.0), (0.15, 1.0)],
        [(0.88, 0.0), (0.2, 0.52), (0.9, 1.0)],
    ],
    "L": [[(0.15, 0.0), (0.15, 1.0), (0.85, 1.0)]],
    "P": [
        [(0.15, 0.0), (0.15, 1.0)],
        [(0.15, 0.0), (0.78, 0.08), (0.88, 0.32), (0.68, 0.52), (0.15, 0.52)],
    ],
    "R": [
        [(0.15, 0.0), (0.15, 1.0)],
        [(0.15, 0.0), (0.78, 0.08), (0.86, 0.3), (0.58, 0.5), (0.15, 0.5), (0.9, 1.0)],
    ],
    "S": [[(0.85, 0.18), (0.48, 0.0), (0.12, 0.2), (0.25, 0.45), (0.78, 0.62), (0.85, 0.85), (0.45, 1.0), (0.1, 0.85)]],
    "T": [
        [(0.05, 0.0), (0.95, 0.0)],
        [(0.5, 0.0), (0.5, 1.0)],
    ],
    "V": [[(0.08, 0.0), (0.5, 1.0), (0.92, 0.0)]],
    "W": [[(0.05, 0.0), (0.28, 1.0), (0.5, 0.35), (0.72, 1.0), (0.95, 0.0)]],
    "Z": [[(0.1, 0.0), (0.9, 0.0), (0.1, 1.0), (0.9, 1.0)]],
    "f": [
        [(0.78, 0.08), (0.52, 0.0), (0.35, 0.18), (0.35, 1.0)],
        [(0.12, 0.42), (0.68, 0.42)],
    ],
    "b": [[(0.15, 0.0), (0.15, 1.0), (0.55, 1.0), (0.88, 0.82), (0.85, 0.48), (0.5, 0.34), (0.15, 0.5)]],
    "m": [[(0.08, 0.35), (0.08, 1.0), (0.1, 0.48), (0.35, 0.34), (0.5, 0.5), (0.5, 1.0), (0.52, 0.48), (0.78, 0.34), (0.92, 0.5), (0.92, 1.0)]],
    "-": [[(0.15, 0.55), (0.85, 0.55)]],
    "=": [
        [(0.12, 0.42), (0.88, 0.42)],
        [(0.12, 0.68), (0.88, 0.68)],
    ],
    "+": [
        [(0.15, 0.55), (0.85, 0.55)],
        [(0.5, 0.2), (0.5, 0.9)],
    ],
    ":": [
        [(0.45, 0.38), (0.5, 0.42)],
        [(0.45, 0.88), (0.5, 0.92)],
    ],
    "1": [[(0.25, 0.22), (0.55, 0.0), (0.55, 1.0)]],
    "2": [[(0.15, 0.25), (0.5, 0.02), (0.85, 0.22), (0.75, 0.52), (0.12, 1.0), (0.9, 1.0)]],
    "3": [[(0.15, 0.18), (0.55, 0.02), (0.85, 0.25), (0.45, 0.48), (0.88, 0.72), (0.52, 1.0), (0.12, 0.85)]],
}


def interpolate_polyline(
    control_pts: Sequence[tuple[float, float]], num_points: int, rng: random.Random, jitter: float = 0.12
) -> list[tuple[float, float]]:
    """Interpoliert einen Polygonzug auf `num_points` Punkte mit leichtem organischem Zittern."""
    if len(control_pts) == 1:
        x0, y0 = control_pts[0]
        return [(x0, y0) for _ in range(num_points)]

    seg_lengths: list[float] = []
    for i in range(len(control_pts) - 1):
        dx = control_pts[i + 1][0] - control_pts[i][0]
        dy = control_pts[i + 1][1] - control_pts[i][1]
        seg_lengths.append(max(1e-4, math.hypot(dx, dy)))
    total_len = sum(seg_lengths)

    result: list[tuple[float, float]] = []
    for idx in range(num_points):
        u = idx / max(1, num_points - 1)
        target = u * total_len
        acc = 0.0
        chosen_seg = len(seg_lengths) - 1
        local_t = 1.0
        for s_idx, slen in enumerate(seg_lengths):
            if acc + slen >= target or s_idx == len(seg_lengths) - 1:
                chosen_seg = s_idx
                local_t = (target - acc) / slen
                break
            acc += slen
        x1, y1 = control_pts[chosen_seg]
        x2, y2 = control_pts[chosen_seg + 1]
        px = x1 + (x2 - x1) * local_t
        py = y1 + (y2 - y1) * local_t
        if 0 < idx < num_points - 1 and jitter > 0.0:
            px += rng.uniform(-jitter, jitter)
            py += rng.uniform(-jitter, jitter)
        result.append((px, py))
    return result


def force_profile(u: float, profile: str) -> float:
    """Berechnet einen realistischen Druckwert in [0, 1] entlang des normierten Strichverlaufs u in [0, 1]."""
    if profile == "natural":
        # Anstieg (0..0.15), Plateau mit leichter Welle (0.15..0.82), Abfall (0.82..1.0)
        if u < 0.15:
            val = 0.18 + (u / 0.15) * 0.50
        elif u <= 0.82:
            val = 0.68 + 0.08 * math.sin((u - 0.15) * math.pi * 2.5)
        else:
            val = 0.68 - ((u - 0.82) / 0.18) * 0.56
        return max(0.05, min(0.95, val))
    if profile == "fountain":
        # Starke Druckvariation zwischen Auf- und Abstrichen (Füller)
        val = 0.52 + 0.38 * math.sin(u * math.pi * 3.0 - 0.3)
        if u < 0.1:
            val *= 0.4 + 0.6 * (u / 0.1)
        elif u > 0.88:
            val *= max(0.15, (1.0 - u) / 0.12)
        return max(0.08, min(0.96, val))
    if profile == "pencil":
        # Gleichmäßigerer Schattierungsdruck beim Bleistift
        val = 0.48 + 0.14 * math.sin(u * math.pi * 1.8)
        return max(0.15, min(0.85, val))
    if profile == "constant":
        return 0.65
    if profile == "marker":
        return 0.75
    return 0.5


def make_stroke(
    rng: random.Random,
    *,
    tool: str,
    layer: str,
    color: str,
    width: float,
    created_at: int,
    t_start_ms: int | None,
    raw_points: Sequence[tuple[float, float, float, float, float, float]],
    transform: Sequence[float] = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0),
) -> dict:
    """Erstellt ein vollständiges Stroke-Objekt nach 08 §4.1 und rundet bbox konsistent zu den Float32-Punkten."""
    b64 = pack_points(raw_points)
    unpacked = unpack_points(b64)
    last_dt = unpacked[-1][2]
    t_end_ms = None if t_start_ms is None else int(round(t_start_ms + last_dt))
    bbox = compute_bbox(unpacked, width, transform)
    return {
        "client_id": uuid7_from_rng(created_at, rng),
        "tool": tool,
        "layer": layer,
        "color": color,
        "width": round(float(width), 2),
        "created_at": int(created_at),
        "t_start_ms": t_start_ms,
        "t_end_ms": t_end_ms,
        "transform": [round(float(v), 4) if isinstance(v, float) and not v.is_integer() else int(v) if float(v).is_integer() else v for v in transform],
        "bbox": bbox,
        "points": b64,
    }


def render_word_strokes(
    word: str,
    *,
    start_x: float,
    baseline_y: float,
    char_width: float,
    char_height: float,
    char_gap: float,
    tool: str,
    layer: str,
    color: str,
    width: float,
    profile: str,
    altitude_base: float,
    azimuth_base: float,
    pts_per_stroke: int,
    epoch_ms: int,
    session_ms: int | None,
    rng: random.Random,
    transform: Sequence[float] = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0),
    join_letters_every: int = 2,
) -> tuple[list[dict], int, int | None, float]:
    """Erzeugt realistische Schreibstriche für ein Wort oder eine Textzeile."""
    strokes: list[dict] = []
    cursor_x = start_x
    cur_epoch = epoch_ms
    cur_sess = session_ms

    # Bündele aufeinanderfolgende Hauptstriche von Kleinbuchstaben zu flüssigen Schreibschrift-Zügen
    pending_ctrl: list[tuple[float, float]] = []
    extra_strokes_ctrl: list[list[tuple[float, float]]] = []
    letters_in_chunk = 0

    def flush_pending() -> None:
        nonlocal pending_ctrl, extra_strokes_ctrl, letters_in_chunk, cur_epoch, cur_sess
        all_polylines: list[list[tuple[float, float]]] = []
        if pending_ctrl:
            all_polylines.append(pending_ctrl)
            pending_ctrl = []
        all_polylines.extend(extra_strokes_ctrl)
        extra_strokes_ctrl = []
        letters_in_chunk = 0

        for poly in all_polylines:
            n_pts = max(42, min(140, int(pts_per_stroke * max(0.75, len(poly) / 6.0))))
            xy_pts = interpolate_polyline(poly, n_pts, rng, jitter=0.14 if tool != "monoline" else 0.0)
            raw_pts: list[tuple[float, float, float, float, float, float]] = []
            dt = 0.0
            for idx, (px, py) in enumerate(xy_pts):
                if idx > 0:
                    # 240 Hz Apple Pencil (~4.16 ms pro Punkt)
                    dt += round(rng.uniform(3.9, 4.4), 2)
                u = idx / max(1, n_pts - 1)
                f = force_profile(u, profile)
                az = round(azimuth_base + rng.uniform(-0.03, 0.03), 4)
                alt = round(max(0.15, min(1.52, altitude_base + rng.uniform(-0.02, 0.02))), 4)
                raw_pts.append((px, py, dt, f, az, alt))

            st = make_stroke(
                rng,
                tool=tool,
                layer=layer,
                color=color,
                width=width,
                created_at=cur_epoch,
                t_start_ms=cur_sess,
                raw_points=raw_pts,
                transform=transform,
            )
            strokes.append(st)
            dur = int(round(raw_pts[-1][2])) + rng.randint(55, 110)
            cur_epoch += dur
            if cur_sess is not None:
                cur_sess += dur

    for ch in word:
        if ch == " ":
            flush_pending()
            cursor_x += char_width * 0.9
            continue
        glyph = GLYPHS.get(ch, GLYPHS.get(ch.lower(), GLYPHS["e"]))
        is_upper = ch.isupper()
        w_scale = char_width * (1.22 if is_upper or ch in "mwMW" else 0.65 if ch in "il1:" else 1.0)
        h_scale = char_height * (1.35 if is_upper or ch in "bdkhfltl" else 1.0)
        top_y = baseline_y - h_scale

        main_poly = [(cursor_x + gx * w_scale, top_y + gy * h_scale) for gx, gy in glyph[0]]
        if is_upper or letters_in_chunk >= join_letters_every:
            flush_pending()

        pending_ctrl.extend(main_poly)
        letters_in_chunk += 1

        for sec in glyph[1:]:
            sec_poly = [(cursor_x + gx * w_scale, top_y + gy * h_scale) for gx, gy in sec]
            extra_strokes_ctrl.append(sec_poly)

        cursor_x += w_scale + char_gap

    flush_pending()
    return strokes, cur_epoch, cur_sess, cursor_x


def build_case_01(rng: random.Random) -> list[dict]:
    """Fall 1: Handschrift-Zeile „Marktgleichgewicht“ mit pen, natürlicher Druckverlauf."""
    strokes, _, _, _ = render_word_strokes(
        "Marktgleichgewicht",
        start_x=58.0,
        baseline_y=160.0,
        char_width=18.5,
        char_height=24.0,
        char_gap=4.2,
        tool="pen",
        layer="ink",
        color="#1E2A44FF",
        width=2.4,
        profile="natural",
        altitude_base=1.12,
        azimuth_base=0.52,
        pts_per_stroke=64,
        epoch_ms=BASE_EPOCH_MS,
        session_ms=BASE_SESSION_MS,
        rng=rng,
        join_letters_every=2,
    )
    return strokes


def build_case_02(rng: random.Random) -> list[dict]:
    """Fall 2: Dasselbe Wort „Marktgleichgewicht“ mit fountain (starke Druckvariation) und pencil (flache altitude -> breiter)."""
    strokes_fountain, next_epoch, next_sess, _ = render_word_strokes(
        "Marktgleichgewicht",
        start_x=58.0,
        baseline_y=150.0,
        char_width=18.5,
        char_height=24.0,
        char_gap=4.2,
        tool="fountain",
        layer="ink",
        color="#0F355CFF",
        width=3.0,
        profile="fountain",
        altitude_base=1.05,
        azimuth_base=0.48,
        pts_per_stroke=68,
        epoch_ms=BASE_EPOCH_MS + 10000,
        session_ms=BASE_SESSION_MS + 10000,
        rng=rng,
        join_letters_every=2,
    )
    strokes_pencil, _, _, _ = render_word_strokes(
        "Marktgleichgewicht",
        start_x=58.0,
        baseline_y=260.0,
        char_width=18.5,
        char_height=24.0,
        char_gap=4.2,
        tool="pencil",
        layer="ink",
        color="#3B3F46D9",
        width=4.6,  # Breiter wegen flacher Stiftneigung
        profile="pencil",
        altitude_base=0.38,  # Flacher Winkel (~22 Grad zur Oberfläche)
        azimuth_base=0.60,
        pts_per_stroke=64,
        epoch_ms=next_epoch + 600,
        session_ms=(next_sess or 0) + 600,
        rng=rng,
        join_letters_every=2,
    )
    return strokes_fountain + strokes_pencil


def build_straight_stroke(
    rng: random.Random,
    control_pts: Sequence[tuple[float, float]],
    *,
    num_points: int,
    tool: str,
    layer: str,
    color: str,
    width: float,
    profile: str,
    epoch_ms: int,
    session_ms: int | None,
    altitude: float = 1.18,
    azimuth: float = 0.45,
) -> tuple[dict, int, int | None]:
    xy = interpolate_polyline(control_pts, num_points, rng, jitter=0.0)
    raw_pts: list[tuple[float, float, float, float, float, float]] = []
    dt = 0.0
    for idx, (x, y) in enumerate(xy):
        if idx > 0:
            dt += 4.0
        u = idx / max(1, num_points - 1)
        raw_pts.append((x, y, dt, force_profile(u, profile), azimuth, altitude))
    st = make_stroke(
        rng,
        tool=tool,
        layer=layer,
        color=color,
        width=width,
        created_at=epoch_ms,
        t_start_ms=session_ms,
        raw_points=raw_pts,
    )
    dur = int(round(dt)) + 90
    return st, epoch_ms + dur, (None if session_ms is None else session_ms + dur)


def build_case_03(rng: random.Random) -> list[dict]:
    """Fall 3: monoline: Kasten, Pfeil, Unterstreichung (gerade Linien mit konstantem Druck)."""
    strokes: list[dict] = []
    ep = BASE_EPOCH_MS + 30000
    ss: int | None = BASE_SESSION_MS + 30000

    # 1. Kasten (geschlossenes Rechteck 80,100 -> 280,180)
    box_st, ep, ss = build_straight_stroke(
        rng,
        [(80.0, 100.0), (280.0, 100.0), (280.0, 180.0), (80.0, 180.0), (80.0, 100.0)],
        num_points=96,
        tool="monoline",
        layer="ink",
        color="#1B4332FF",
        width=2.2,
        profile="constant",
        epoch_ms=ep,
        session_ms=ss,
    )
    strokes.append(box_st)

    # 2. Pfeil-Schaft (300,140 -> 470,140)
    shaft_st, ep, ss = build_straight_stroke(
        rng,
        [(300.0, 140.0), (470.0, 140.0)],
        num_points=56,
        tool="monoline",
        layer="ink",
        color="#1B4332FF",
        width=2.2,
        profile="constant",
        epoch_ms=ep,
        session_ms=ss,
    )
    strokes.append(shaft_st)

    # 3. Pfeil-Spitze (448,124 -> 472,140 -> 448,156)
    head_st, ep, ss = build_straight_stroke(
        rng,
        [(448.0, 124.0), (472.0, 140.0), (448.0, 156.0)],
        num_points=48,
        tool="monoline",
        layer="ink",
        color="#1B4332FF",
        width=2.2,
        profile="constant",
        epoch_ms=ep,
        session_ms=ss,
    )
    strokes.append(head_st)

    # 4. Unterstreichung (80,225 -> 472,225)
    under_st, ep, ss = build_straight_stroke(
        rng,
        [(80.0, 225.0), (472.0, 225.0)],
        num_points=80,
        tool="monoline",
        layer="ink",
        color="#D9480FFF",
        width=2.5,
        profile="constant",
        epoch_ms=ep,
        session_ms=ss,
    )
    strokes.append(under_st)
    return strokes


def build_case_04(rng: random.Random) -> list[dict]:
    """Fall 4: Textmarker (marker, layer: highlight, halbtransparente Farbe) über einer ink-Zeile."""
    ink_strokes, ep, ss, end_x = render_word_strokes(
        "Marktgleichgewicht",
        start_x=65.0,
        baseline_y=180.0,
        char_width=18.5,
        char_height=24.0,
        char_gap=4.2,
        tool="pen",
        layer="ink",
        color="#1E2A44FF",
        width=2.4,
        profile="natural",
        altitude_base=1.10,
        azimuth_base=0.50,
        pts_per_stroke=60,
        epoch_ms=BASE_EPOCH_MS + 45000,
        session_ms=BASE_SESSION_MS + 45000,
        rng=rng,
        join_letters_every=2,
    )
    marker_st, _, _ = build_straight_stroke(
        rng,
        [(58.0, 170.0), (end_x + 6.0, 170.0)],
        num_points=75,
        tool="marker",
        layer="highlight",
        color="#FFE06666",  # Gelb, halbtransparent (Alpha 0x66 = 40 %)
        width=18.0,
        profile="marker",
        epoch_ms=ep + 300,
        session_ms=(ss or 0) + 300,
        altitude=0.85,
    )
    return ink_strokes + [marker_st]


def build_case_05(rng: random.Random) -> list[dict]:
    """Fall 5: Ein Strich mit transform != Identität (Lasso-Verschiebung um +50/+20 pt)."""
    # Zum direkten Sichtvergleich: Referenzstrich vor Verschiebung (grau) + verschobener Strich mit transform=[1,0,0,1,50,20]
    xy_pts = interpolate_polyline(
        [(90.0, 160.0), (140.0, 125.0), (210.0, 175.0), (280.0, 130.0), (340.0, 160.0)],
        72,
        rng,
        jitter=0.1,
    )
    raw_pts: list[tuple[float, float, float, float, float, float]] = []
    dt = 0.0
    for idx, (x, y) in enumerate(xy_pts):
        if idx > 0:
            dt += 4.0
        u = idx / 71.0
        raw_pts.append((x, y, dt, force_profile(u, "natural"), 0.5, 1.1))

    ep = BASE_EPOCH_MS + 60000
    ss = BASE_SESSION_MS + 60000

    # Strich 1: Referenzstrich am ursprünglichen Ort vor Lasso-Verschiebung (transform = [1, 0, 0, 1, 0, 0])
    original_stroke = make_stroke(
        rng,
        tool="pen",
        layer="ink",
        color="#868E9699",
        width=2.4,
        created_at=ep,
        t_start_ms=ss,
        raw_points=raw_pts,
        transform=(1.0, 0.0, 0.0, 1.0, 0.0, 0.0),
    )

    # Strich 2: Derselbe Strich nach Lasso-Verschiebung um +50/+20 pt (transform = [1, 0, 0, 1, 50, 20], gleiche Rohpunkte in points!)
    moved_stroke = make_stroke(
        rng,
        tool="pen",
        layer="ink",
        color="#1864ABFF",
        width=2.8,
        created_at=ep + 500,
        t_start_ms=ss + 500,
        raw_points=raw_pts,
        transform=(1.0, 0.0, 0.0, 1.0, 50.0, 20.0),
    )
    return [original_stroke, moved_stroke]


def build_case_06(rng: random.Random) -> list[dict]:
    """Fall 6: Randfälle (1 Punkt, 2 Punkte, 1000 Punkte, force 0 und 1, ohne Session t_start_ms/t_end_ms = null)."""
    ep = BASE_EPOCH_MS + 75000
    ss = BASE_SESSION_MS + 75000
    strokes: list[dict] = []

    # 6.1: Ein Punkt (Tipp, 1 Punkt)
    st_1pt = make_stroke(
        rng,
        tool="pen",
        layer="ink",
        color="#1E2A44FF",
        width=3.2,
        created_at=ep,
        t_start_ms=ss,
        raw_points=[(80.0, 90.0, 0.0, 0.55, 0.4, 1.2)],
    )
    strokes.append(st_1pt)

    # 6.2: Strich mit genau 2 Punkten
    st_2pt = make_stroke(
        rng,
        tool="pen",
        layer="ink",
        color="#1E2A44FF",
        width=2.4,
        created_at=ep + 500,
        t_start_ms=ss + 500,
        raw_points=[
            (120.0, 90.0, 0.0, 0.45, 0.4, 1.15),
            (185.0, 90.0, 16.0, 0.70, 0.4, 1.15),
        ],
    )
    strokes.append(st_2pt)

    # 6.3: Sehr langer Strich mit genau 1000 Punkten (Spirale / Sinuskurve über die Seite)
    long_pts: list[tuple[float, float, float, float, float, float]] = []
    for idx in range(1000):
        u = idx / 999.0
        x = 70.0 + u * 450.0
        y = 210.0 + 45.0 * math.sin(u * math.pi * 10.0)
        dt = idx * 4.0
        f = force_profile(u, "natural")
        long_pts.append((x, y, dt, f, 0.5, 1.08))
    st_1000 = make_stroke(
        rng,
        tool="pen",
        layer="ink",
        color="#2B8A3EFF",
        width=2.0,
        created_at=ep + 1000,
        t_start_ms=ss + 1000,
        raw_points=long_pts,
    )
    strokes.append(st_1000)

    # 6.4: Extremwerte force = 0.0 und force = 1.0
    force_ext_pts: list[tuple[float, float, float, float, float, float]] = []
    for idx in range(50):
        u = idx / 49.0
        x = 70.0 + u * 350.0
        y = 330.0 + 12.0 * math.cos(u * math.pi * 2.0)
        if idx == 0 or idx == 49:
            f = 0.0
        elif 20 <= idx <= 28:
            f = 1.0
        else:
            f = round(0.2 + 0.6 * math.sin(u * math.pi), 4)
        force_ext_pts.append((x, y, idx * 4.0, f, 0.35, 1.0))
    st_force = make_stroke(
        rng,
        tool="fountain",
        layer="ink",
        color="#C92A2AFF",
        width=3.4,
        created_at=ep + 6000,
        t_start_ms=ss + 6000,
        raw_points=force_ext_pts,
    )
    strokes.append(st_force)

    # 6.5: Strich ohne laufende Session (t_start_ms = null, t_end_ms = null)
    no_sess_xy = interpolate_polyline([(70.0, 420.0), (220.0, 405.0), (380.0, 425.0)], 55, rng, jitter=0.1)
    no_sess_pts = [(x, y, idx * 4.0, force_profile(idx / 54.0, "natural"), 0.5, 1.1) for idx, (x, y) in enumerate(no_sess_xy)]
    st_nosess = make_stroke(
        rng,
        tool="pencil",
        layer="ink",
        color="#495057FF",
        width=2.6,
        created_at=ep + 8000,
        t_start_ms=None,
        raw_points=no_sess_pts,
    )
    strokes.append(st_nosess)
    return strokes


def build_case_07(rng: random.Random) -> list[dict]:
    """Fall 7: Ganze Notizseite mit ca. 200 Strichen aus mehreren Zeilen Handschrift plus 3 Marker-Strichen, Zeiten fortlaufend."""
    lines = [
        ("VL 3 Mikrooekonomie Marktgleichgewicht", "#1E2A44FF", "pen", 2.4, 85.0),
        ("1 Nachfragefunktion P = a - b Q", "#1E2A44FF", "pen", 2.1, 145.0),
        ("2 Angebotsfunktion P = c + d Q", "#1E2A44FF", "pen", 2.1, 200.0),
        ("3 Gleichgewichtspreis und Menge bestimmen", "#0F355CFF", "fountain", 2.5, 255.0),
        ("Konsumentenrente und Produzentenrente", "#1E2A44FF", "pen", 2.1, 310.0),
        ("Wohlfahrtsverlust durch Mindestpreis", "#C92A2AFF", "pen", 2.2, 365.0),
        ("Elastizitaet der Nachfrage am Schnittpunkt", "#1E2A44FF", "pen", 2.1, 420.0),
        ("Verschiebung der Kurve bei Einkommensanstieg", "#1E2A44FF", "pen", 2.1, 475.0),
        ("Kurzfristiges vs langfristiges Gleichgewicht", "#3B3F46D9", "pencil", 2.8, 530.0),
        ("Fazit Marktmechanismus maximiert Gesamtwohlfahrt", "#1E2A44FF", "pen", 2.2, 585.0),
    ]

    all_strokes: list[dict] = []
    ep = BASE_EPOCH_MS + 100000
    ss: int | None = BASE_SESSION_MS + 100000

    for line_idx, (text, color, tool, width, base_y) in enumerate(lines):
        line_strokes, ep, ss, end_x = render_word_strokes(
            text,
            start_x=45.0,
            baseline_y=base_y,
            char_width=8.6,
            char_height=13.5,
            char_gap=2.0,
            tool=tool,
            layer="ink",
            color=color,
            width=width,
            profile="fountain" if tool == "fountain" else "pencil" if tool == "pencil" else "natural",
            altitude_base=0.45 if tool == "pencil" else 1.12,
            azimuth_base=0.5,
            pts_per_stroke=52,
            epoch_ms=ep,
            session_ms=ss,
            rng=rng,
            join_letters_every=3,  # Flüssige Schreibschrift-Züge (~210 Striche auf der Seite)
        )
        all_strokes.extend(line_strokes)

        # Nach Zeile 0, 3 und 5 je einen Textmarker-Strich (insgesamt 3 Marker-Striche) setzen
        if line_idx in (0, 3, 5):
            marker_color = "#FFE06666" if line_idx != 5 else "#FF878759"
            m_st, ep, ss = build_straight_stroke(
                rng,
                [(48.0, base_y - 7.0), (min(545.0, end_x + 4.0), base_y - 7.0)],
                num_points=65,
                tool="marker",
                layer="highlight",
                color=marker_color,
                width=15.0,
                profile="marker",
                epoch_ms=ep + 120,
                session_ms=(ss or 0) + 120,
                altitude=0.82,
            )
            all_strokes.append(m_st)

    return all_strokes


def write_formatted_json(path: Path, strokes: list[dict]) -> None:
    """Schreibt eine Strich-Liste exakt im Prettier-JSON-Format (kompakte Arrays für transform und bbox)."""
    obj_strings: list[str] = []
    for s in strokes:
        tf_str = "[" + ", ".join(json.dumps(v) for v in s["transform"]) + "]"
        bb_str = "[" + ", ".join(json.dumps(v) for v in s["bbox"]) + "]"
        lines = [
            "  {",
            f'    "client_id": {json.dumps(s["client_id"])},',
            f'    "tool": {json.dumps(s["tool"])},',
            f'    "layer": {json.dumps(s["layer"])},',
            f'    "color": {json.dumps(s["color"])},',
            f'    "width": {json.dumps(s["width"])},',
            f'    "created_at": {json.dumps(s["created_at"])},',
            f'    "t_start_ms": {json.dumps(s["t_start_ms"])},',
            f'    "t_end_ms": {json.dumps(s["t_end_ms"])},',
            f'    "transform": {tf_str},',
            f'    "bbox": {bb_str},',
            f'    "points": {json.dumps(s["points"])}',
            "  }",
        ]
        obj_strings.append("\n".join(lines))
    content = "[\n" + ",\n".join(obj_strings) + "\n]\n"
    path.write_text(content, encoding="utf-8")


def main() -> int:
    rng = random.Random(20261104)

    cases = [
        ("01-handschrift-pen.json", build_case_01(rng)),
        ("02-fountain-und-pencil.json", build_case_02(rng)),
        ("03-monoline-geometrie.json", build_case_03(rng)),
        ("04-textmarker-highlight.json", build_case_04(rng)),
        ("05-lasso-transform.json", build_case_05(rng)),
        ("06-randfaelle.json", build_case_06(rng)),
        ("07-notizseite-200-striche.json", build_case_07(rng)),
    ]

    for filename, strokes in cases:
        out_path = FIXTURES_DIR / filename
        write_formatted_json(out_path, strokes)
        total_pts = sum(len(unpack_points(s["points"])) for s in strokes)
        print(f"Erzeugt: {filename:<34} ({len(strokes):>3} Striche, {total_pts:>5} Punkte)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
