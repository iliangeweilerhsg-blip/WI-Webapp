"""Namen von Konzepten vergleichen (VERTRAEGE §20.3 „Gemeinsame Regeln“).

Dieselben Regeln rechnet der Core (`services/core/src/services/concept-graph.ts`). Beide prüfen
gegen `packages/schemas/fixtures/concepts/{normalize,name-match}.json`.

- **Normform:** NFC, Steuer- und Formatzeichen entfernen (wie §19.3), Leerraum zusammenfassen,
  trimmen.
- **Vergleichsform** `key`: Normform in Kleinbuchstaben (`str.lower()`, nicht `casefold()`, damit
  Worker und Core gleich rechnen).
- **Basisform** `base`: `key` ohne einen Klammerzusatz am Ende (einmal), leer → `key`.
- **Namensgleich:** eine `key` eines Namens oder Alias des einen gleich einer `key` des anderen.
- **Namensähnlich:** dasselbe mit `key` oder `base`.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass

_PAREN = re.compile(r"\s*\([^()]*\)$")


def normalize_name(text: str) -> str:
    """NFC, Steuer- und Formatzeichen entfernen (wie §19.3), Leerraum zusammenfassen, trimmen."""
    # Spät importiert: `handlers/__init__` lädt `concepts_extract`, das dieses Modul braucht.
    from ..handlers.search_index import clean_text

    return clean_text(text)


def name_key(text: str) -> str:
    """Vergleichsform: Normform in Kleinbuchstaben (`str.lower()`, nicht `casefold()`)."""
    return normalize_name(text).lower()


def name_base(text: str) -> str:
    """Basisform: `key` ohne einen Klammerzusatz am Ende. Bleibt nichts übrig, gilt `key`."""
    key = name_key(text)
    return _PAREN.sub("", key, count=1) or key


@dataclass(frozen=True)
class Labels:
    """Vergleichsformen aller Namen eines Konzepts (Name und Aliase)."""

    keys: frozenset[str]
    bases: frozenset[str]

    @property
    def loose(self) -> frozenset[str]:
        return self.keys | self.bases


def labels(name: str, aliases: Iterable[str] = ()) -> Labels:
    names = (name, *aliases)
    keys = {name_key(s) for s in names} - {""}
    bases = {name_base(s) for s in names} - {""}
    return Labels(frozenset(keys), frozenset(bases))


def same_name(a: Labels, b: Labels) -> bool:
    """Namensgleich (§20.3)."""
    return not a.keys.isdisjoint(b.keys)


def similar_name(a: Labels, b: Labels) -> bool:
    """Namensähnlich (§20.3): Treffer über `key` oder `base`."""
    return not a.loose.isdisjoint(b.loose)
