#!/usr/bin/env python3
"""Referenz-Packer, -Entpacker und Hilfsfunktionen für das neutrale Strich-Format (08 §4.1 / §4.2).

Verwendet ausschließlich die Python-Standardbibliothek (`struct`, `base64`, `json`, `uuid`).
"""

from __future__ import annotations

import base64
import math
import random
import struct
import uuid
from typing import Iterable, Sequence

POINT_STRUCT = struct.Struct("<6f")
POINT_BYTE_SIZE = POINT_STRUCT.size  # 24 Bytes (6 * Float32 little-endian)

VALID_TOOLS = frozenset({"pen", "pencil", "marker", "monoline", "fountain"})
VALID_LAYERS = frozenset({"ink", "highlight"})

PointTuple = tuple[float, float, float, float, float, float]


def pack_points(points: Iterable[Sequence[float]]) -> str:
    """Packt eine Folge von Punkten (x, y, dt, force, azimuth, altitude) als Base64-String (6 x Float32 LE)."""
    buf = bytearray()
    for pt in points:
        if len(pt) != 6:
            raise ValueError(f"Jeder Punkt muss genau 6 Werte haben, erhalten: {len(pt)}")
        buf.extend(POINT_STRUCT.pack(float(pt[0]), float(pt[1]), float(pt[2]), float(pt[3]), float(pt[4]), float(pt[5])))
    return base64.b64encode(bytes(buf)).decode("ascii")


def unpack_points(b64: str) -> list[PointTuple]:
    """Entpackt einen Base64-String in eine Liste von 6-Tupeln (x, y, dt, force, azimuth, altitude) in Float32-Präzision."""
    raw = base64.b64decode(b64, validate=True)
    if len(raw) % POINT_BYTE_SIZE != 0:
        raise ValueError(
            f"Dekodierte Punkt-Bytelänge ({len(raw)}) ist kein Vielfaches von {POINT_BYTE_SIZE} Byte."
        )
    return list(POINT_STRUCT.iter_unpack(raw))


def uuid7_from_rng(timestamp_ms: int, rng: random.Random) -> str:
    """Erzeugt eine deterministische UUIDv7 nach RFC 9562 aus einem Millisekunden-Zeitstempel und einem RNG.

    Aufbau nach RFC 9562 §5.7:
    - Bits  0..47: unix_ts_ms (48 Bit big-endian)
    - Bits 48..51: ver = 0b0111 (7)
    - Bits 52..63: rand_a (12 Bit)
    - Bits 64..65: var = 0b10 (RFC 9562 Variante)
    - Bits 66..127: rand_b (62 Bit)
    """
    if timestamp_ms < 0 or timestamp_ms >= (1 << 48):
        raise ValueError(f"timestamp_ms außerhalb des 48-Bit-Bereichs: {timestamp_ms}")
    rand_a = rng.getrandbits(12)
    rand_b = rng.getrandbits(62)

    val = (timestamp_ms & ((1 << 48) - 1)) << 80
    val |= 0x7 << 76
    val |= (rand_a & 0xFFF) << 64
    val |= 0b10 << 62
    val |= rand_b & ((1 << 62) - 1)
    return str(uuid.UUID(int=val))


def is_valid_uuid7(val: str) -> bool:
    """Prüft, ob ein String eine syntaktisch gültige UUIDv7 (RFC 9562) in kanonischer Kleinschreibung ist."""
    try:
        u = uuid.UUID(val)
    except (ValueError, AttributeError, TypeError):
        return False
    return str(u) == val and u.version == 7 and u.variant == uuid.RFC_4122


def apply_transform(x: float, y: float, transform: Sequence[float]) -> tuple[float, float]:
    """Wendet die affine 2D-Transformation [a, b, c, d, e, f] (CGAffineTransform) auf (x, y) an."""
    a, b, c, d, e, f = transform
    tx = a * x + c * y + e
    ty = b * x + d * y + f
    return tx, ty


def compute_bbox(points: Sequence[Sequence[float]], width: float, transform: Sequence[float]) -> list[float]:
    """Berechnet die umschließende Bounding-Box [x, y, w, h] der transformierten Punkte inkl. halber Strichbreite."""
    if not points:
        raise ValueError("Mindestens ein Punkt für bbox erforderlich.")
    xs: list[float] = []
    ys: list[float] = []
    for pt in points:
        tx, ty = apply_transform(float(pt[0]), float(pt[1]), transform)
        xs.append(tx)
        ys.append(ty)
    r = float(width) / 2.0
    min_x = min(xs) - r
    min_y = min(ys) - r
    max_x = max(xs) + r
    max_y = max(ys) + r
    return [
        round(min_x, 2),
        round(min_y, 2),
        round(max(0.0, max_x - min_x), 2),
        round(max(0.0, max_y - min_y), 2),
    ]


__all__ = [
    "POINT_BYTE_SIZE",
    "POINT_STRUCT",
    "PointTuple",
    "VALID_LAYERS",
    "VALID_TOOLS",
    "apply_transform",
    "compute_bbox",
    "is_valid_uuid7",
    "pack_points",
    "unpack_points",
    "uuid7_from_rng",
]
