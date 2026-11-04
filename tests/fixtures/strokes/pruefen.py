#!/usr/bin/env python3
"""Prüfskript für die Strich-Format-Testdaten (08 §4.1 / §4.2, T1-14, T1-16, Spike S3).

Prüft für jede JSON-Datei in `tests/fixtures/strokes/`:
- Schema-Felder und Wertebereiche (`tool`, `layer`, `color`, `width`, `transform`, `bbox`, `created_at`, `t_start_ms`, `t_end_ms`)
- Punktwertebereiche (`force` in [0, 1], `altitude` in [0, pi/2], `azimuth` in [-pi, pi])
- Base64-Dekodierbarkeit und Bytelänge als Vielfaches von 24 Byte (6 x Float32 LE)
- Monoton steigendes `dt` (ab `dt >= 0`)
- `bbox` umschließt alle transformierten Punkte (Toleranz 0,5 pt, plus halbe Breite)
- `t_end_ms - t_start_ms` ≈ letzter `dt` (±5 ms) bzw. beide `null` bei Strichen ohne Session
- `client_id` ist eine gültige UUIDv7 (RFC 9562) und pro Datei eindeutig
- Packen und Entpacken (`pack_points` / `unpack_points`) ist Float32-genau identisch (Roundtrip)

Ausführung:
    python3 tests/fixtures/strokes/pruefen.py
"""

from __future__ import annotations

import base64
import json
import math
import re
import sys
from pathlib import Path

from stroke_format import (
    POINT_BYTE_SIZE,
    VALID_LAYERS,
    VALID_TOOLS,
    apply_transform,
    is_valid_uuid7,
    pack_points,
    unpack_points,
)

FIXTURES_DIR = Path(__file__).resolve().parent
COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{8}$")
REQUIRED_KEYS = {
    "client_id",
    "tool",
    "layer",
    "color",
    "width",
    "created_at",
    "t_start_ms",
    "t_end_ms",
    "transform",
    "bbox",
    "points",
}


def validate_file(json_path: Path) -> tuple[list[str], int, int]:
    """Prüft eine einzelne JSON-Datei und gibt (fehler_liste, anzahl_striche, anzahl_punkte) zurück."""
    errors: list[str] = []
    try:
        data = json.loads(json_path.read_text(encoding="utf-8"))
    except Exception as exc:
        return [f"JSON-Parse-Fehler: {exc}"], 0, 0

    if not isinstance(data, list) or not data:
        return ["Datei muss eine nicht-leere JSON-Liste von Strichen enthalten."], 0, 0

    seen_ids: set[str] = set()
    total_points = 0

    for idx, stroke in enumerate(data):
        prefix = f"Strich #{idx + 1}"
        if not isinstance(stroke, dict):
            errors.append(f"{prefix}: Kein JSON-Objekt.")
            continue

        missing = REQUIRED_KEYS - set(stroke.keys())
        extra = set(stroke.keys()) - REQUIRED_KEYS
        if missing:
            errors.append(f"{prefix}: Fehlende Pflichtfelder: {sorted(missing)}")
            continue
        if extra:
            errors.append(f"{prefix}: Unbekannte Zusatzfelder: {sorted(extra)}")

        # 1. client_id (UUIDv7 + Eindeutigkeit)
        cid = stroke["client_id"]
        if not isinstance(cid, str) or not is_valid_uuid7(cid):
            errors.append(f"{prefix}: Ungültige UUIDv7 in client_id={cid!r}")
        elif cid in seen_ids:
            errors.append(f"{prefix}: Doppelte client_id={cid!r} innerhalb derselben Datei.")
        else:
            seen_ids.add(cid)

        # 2. tool, layer, color, width
        tool = stroke["tool"]
        if tool not in VALID_TOOLS:
            errors.append(f"{prefix}: Ungültiges tool={tool!r} (erlaubt: {sorted(VALID_TOOLS)})")

        layer = stroke["layer"]
        if layer not in VALID_LAYERS:
            errors.append(f"{prefix}: Ungültiger layer={layer!r} (erlaubt: {sorted(VALID_LAYERS)})")

        color = stroke["color"]
        if not isinstance(color, str) or not COLOR_RE.match(color):
            errors.append(f"{prefix}: Ungültiges Farbformat color={color!r} (erwartet #RRGGBBAA)")

        width = stroke["width"]
        if not isinstance(width, (int, float)) or width <= 0:
            errors.append(f"{prefix}: Ungültige Strichbreite width={width!r}")
            width = 1.0

        # 3. transform (6 Zahlen) und bbox (4 Zahlen)
        transform = stroke["transform"]
        if (
            not isinstance(transform, list)
            or len(transform) != 6
            or not all(isinstance(v, (int, float)) for v in transform)
        ):
            errors.append(f"{prefix}: transform muss eine Liste aus 6 Zahlen sein: {transform!r}")
            transform = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]

        bbox = stroke["bbox"]
        if (
            not isinstance(bbox, list)
            or len(bbox) != 4
            or not all(isinstance(v, (int, float)) for v in bbox)
        ):
            errors.append(f"{prefix}: bbox muss [x, y, w, h] sein: {bbox!r}")
            bbox = [0.0, 0.0, 0.0, 0.0]

        # 4. created_at, t_start_ms, t_end_ms
        created_at = stroke["created_at"]
        if not isinstance(created_at, int) or created_at <= 0:
            errors.append(f"{prefix}: created_at muss ein positiver Epochen-ms-Integer sein: {created_at!r}")

        t_start = stroke["t_start_ms"]
        t_end = stroke["t_end_ms"]
        if (t_start is None) != (t_end is None):
            errors.append(
                f"{prefix}: t_start_ms ({t_start!r}) und t_end_ms ({t_end!r}) müssen entweder beide gesetzt oder beide null sein."
            )
        elif t_start is not None and (not isinstance(t_start, int) or not isinstance(t_end, int)):
            errors.append(f"{prefix}: t_start_ms und t_end_ms müssen Integer oder null sein.")

        # 5. Base64-Dekodierung & Punkt-Packung (Vielfaches von 24 Byte)
        b64 = stroke["points"]
        if not isinstance(b64, str) or not b64:
            errors.append(f"{prefix}: points darf nicht leer sein.")
            continue

        try:
            raw = base64.b64decode(b64, validate=True)
        except Exception as exc:
            errors.append(f"{prefix}: Base64-Dekodierung fehlgeschlagen: {exc}")
            continue

        if len(raw) == 0 or len(raw) % POINT_BYTE_SIZE != 0:
            errors.append(
                f"{prefix}: Dekodierte Bytelänge ({len(raw)}) ist kein positives Vielfaches von {POINT_BYTE_SIZE}."
            )
            continue

        points = unpack_points(b64)
        total_points += len(points)

        # 6. Roundtrip-Test (Float32-genau)
        repacked_b64 = pack_points(points)
        reunpacked = unpack_points(repacked_b64)
        if repacked_b64 != b64 or reunpacked != points:
            errors.append(f"{prefix}: Pack/Unpack-Roundtrip ist nicht Float32-identisch.")

        # 7. Punktwertebereiche & monotones dt prüfen
        prev_dt = -1e-6
        tx_list: list[float] = []
        ty_list: list[float] = []
        half_pi = math.pi / 2.0 + 1e-5

        for p_idx, (px, py, dt, force, azimuth, altitude) in enumerate(points):
            if any(math.isnan(v) or math.isinf(v) for v in (px, py, dt, force, azimuth, altitude)):
                errors.append(f"{prefix} Punkt #{p_idx + 1}: Enthält NaN oder Inf.")
                break
            if dt < -1e-5 or dt + 1e-5 < prev_dt:
                errors.append(
                    f"{prefix} Punkt #{p_idx + 1}: dt ist nicht monoton steigend ({prev_dt:.3f} -> {dt:.3f})."
                )
            prev_dt = dt
            if force < -1e-6 or force > 1.0 + 1e-6:
                errors.append(f"{prefix} Punkt #{p_idx + 1}: force={force:.4f} außerhalb [0, 1].")
            if altitude < -1e-6 or altitude > half_pi:
                errors.append(
                    f"{prefix} Punkt #{p_idx + 1}: altitude={altitude:.4f} außerhalb [0, pi/2]."
                )
            if azimuth < -math.pi - 1e-4 or azimuth > math.pi * 2.0 + 1e-4:
                errors.append(
                    f"{prefix} Punkt #{p_idx + 1}: azimuth={azimuth:.4f} außerhalb gültigem Radiant-Bereich."
                )

            tx, ty = apply_transform(px, py, transform)
            tx_list.append(tx)
            ty_list.append(ty)

        # 8. t_end_ms - t_start_ms ≈ letzter dt (±5 ms)
        last_dt = points[-1][2]
        if isinstance(t_start, int) and isinstance(t_end, int):
            duration = t_end - t_start
            if abs(duration - last_dt) > 5.0:
                errors.append(
                    f"{prefix}: (t_end_ms - t_start_ms) = {duration} ms weicht um mehr als ±5 ms vom letzten dt ({last_dt:.2f} ms) ab."
                )

        # 9. bbox umschließt alle transformierten Punkte (Toleranz 0,5 pt, plus halbe Breite)
        half_w = float(width) / 2.0
        exp_min_x = min(tx_list) - half_w
        exp_min_y = min(ty_list) - half_w
        exp_max_x = max(tx_list) + half_w
        exp_max_y = max(ty_list) + half_w

        bx, by, bw, bh = [float(v) for v in bbox]
        b_max_x = bx + bw
        b_max_y = by + bh
        tol = 0.5
        if (
            abs(bx - exp_min_x) > tol
            or abs(by - exp_min_y) > tol
            or abs(b_max_x - exp_max_x) > tol
            or abs(b_max_y - exp_max_y) > tol
        ):
            errors.append(
                f"{prefix}: bbox={bbox} weicht um > {tol} pt vom erwarteten Bereich "
                f"[{exp_min_x:.2f}, {exp_min_y:.2f}, {exp_max_x - exp_min_x:.2f}, {exp_max_y - exp_min_y:.2f}] ab."
            )

    return errors, len(data), total_points


def main() -> int:
    json_files = sorted(FIXTURES_DIR.glob("*.json"))
    if not json_files:
        print("FEHLER: Keine .json-Dateien in tests/fixtures/strokes/ gefunden.", file=sys.stderr)
        return 1

    print(f"Prüfe {len(json_files)} Strich-Testdateien in tests/fixtures/strokes ...\n")

    all_errors: list[str] = []
    total_strokes_all = 0
    total_points_all = 0

    for jf in json_files:
        errs, n_strokes, n_points = validate_file(jf)
        total_strokes_all += n_strokes
        total_points_all += n_points
        if errs:
            print(f"[FEHLER] {jf.name:<34} -> {len(errs)} Fehler")
            all_errors.extend(f"{jf.name}: {e}" for e in errs)
        else:
            print(
                f"[OK]     {jf.name:<34} -> {n_strokes:>3} Striche, {n_points:>5} Punkte (Roundtrip & Schema OK)"
            )

    if all_errors:
        print("\nGefundene Abweichungen:", file=sys.stderr)
        for err in all_errors:
            print(f"  - {err}", file=sys.stderr)
        return 1

    print(
        f"\nErgebnis: Alle {len(json_files)} Dateien ({total_strokes_all} Striche, {total_points_all} Punkte) sind fehlerfrei (0 Fehler)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
