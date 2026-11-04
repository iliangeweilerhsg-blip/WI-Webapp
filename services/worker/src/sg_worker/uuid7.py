"""UUIDv7 (RFC 9562) für neue Zeilen, die der Worker anlegt (IDs erzeugt die Anwendung, 03 §1)."""

from __future__ import annotations

import os
import threading
import time
import uuid

_lock = threading.Lock()
_last_ms = 0
_counter = 0


def uuid7(now_ms: int | None = None) -> uuid.UUID:
    """48 Bit Unix-Millisekunden, 12 Bit Zähler, 62 Bit Zufall.

    Innerhalb derselben Millisekunde wächst der Zähler, so bleibt die Reihenfolge der IDs
    stabil (03 §1: „zeitlich sortierbar“), auch wenn die Uhr stillsteht oder zurückspringt.
    """
    global _last_ms, _counter
    with _lock:
        ms = int(time.time() * 1000) if now_ms is None else now_ms
        if ms <= _last_ms:
            ms = _last_ms
            _counter += 1
            if _counter > 0xFFF:
                ms += 1
                _counter = 0
        else:
            _counter = int.from_bytes(os.urandom(2), "big") & 0x1FF
        _last_ms = ms
        counter = _counter
    rand = bytearray(os.urandom(8))
    rand[0] = (rand[0] & 0x3F) | 0x80  # Variante 10
    value = (
        (ms & 0xFFFFFFFFFFFF) << 80 | (0x7 << 76) | (counter << 64) | int.from_bytes(rand, "big")
    )
    return uuid.UUID(int=value)
