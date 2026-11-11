"""Kreisprüfung für `baut_auf` (VERTRAEGE §20.6 A3, Invariante 4).

Eine neue Beziehung `from baut_auf to` bildet einen Kreis, wenn `to` über **bestätigte**
`baut_auf`-Kanten aktiver Konzepte `from` erreicht. `path` ist der kürzeste Kreis ab `from`
(Breitensuche ab `to`, Nachbarn nach Konzept-ID aufsteigend). Gemeinsame Testfälle:
`packages/schemas/fixtures/concepts/cycle.json`.
"""

from __future__ import annotations

import uuid
from collections import deque
from collections.abc import Iterable
from typing import Any

import psycopg

Conn = psycopg.Connection[Any]

CONFIRMED_EDGES_SQL = """
SELECT r.from_id, r.to_id FROM concept_relation r
JOIN concept a ON a.id = r.from_id AND a.status = 'aktiv' AND a.deleted_at IS NULL
JOIN concept b ON b.id = r.to_id AND b.status = 'aktiv' AND b.deleted_at IS NULL
WHERE r.kind = 'baut_auf' AND r.confirmed AND r.deleted_at IS NULL
"""


def find_cycle[K: (str, uuid.UUID)](
    edges: Iterable[tuple[K, K]], new_from: K, new_to: K
) -> list[K] | None:
    """Kürzester Kreis `[from, to, …, from]`, den die neue Kante schließen würde, sonst None.
    `edges`: die bestätigten `baut_auf`-Kanten als `(from, to)`."""
    adjacent: dict[K, set[K]] = {}
    for a, b in edges:
        adjacent.setdefault(a, set()).add(b)
    parent: dict[K, K | None] = {new_to: None}
    queue: deque[K] = deque([new_to])
    while queue:
        node = queue.popleft()
        if node == new_from:
            back: list[K] = [node]
            while (prev := parent[back[-1]]) is not None:
                back.append(prev)
            path: list[K] = [new_from]
            path.extend(reversed(back))
            return path
        for nxt in sorted(adjacent.get(node, ())):
            if nxt not in parent:
                parent[nxt] = node
                queue.append(nxt)
    return None


def confirmed_edges(conn: Conn) -> list[tuple[uuid.UUID, uuid.UUID]]:
    return [(r[0], r[1]) for r in conn.execute(CONFIRMED_EDGES_SQL).fetchall()]
