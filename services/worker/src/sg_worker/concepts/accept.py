"""Annahme von Inbox-Einträgen: A1 (neu), A2 (zusammenführen), A3 (Beziehung bestätigen)
(VERTRAEGE §20.6). Der Worker braucht sie für die Automatik (`ai.auto_accept`, §20.3 Schritt 7),
der Core rechnet dieselben Regeln für die Inbox (`concept-graph.ts`). Beide prüfen gegen
`packages/schemas/fixtures/concepts/decisions.json`.

**Aufrufer** (`concepts.resolve`): innerhalb einer Transaktion, Session gesperrt, danach
`lock_graph` (Advisory-Lock, **vor** jeder Namens- bzw. Kreisprüfung). `accept_item` läuft in
einem Savepoint: Bei `AcceptError` ändert sich nichts. Gesperrt wird in der Reihenfolge aus §20.6
ohne Schritt 2 (den Eintrag sperrt nur der Core): Konzepte nach ID sortiert
`FOR NO KEY UPDATE`, dann Beziehungen.

Ablehnen und Rückgängig gibt es nur im Core.
"""

from __future__ import annotations

import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal

import psycopg
from psycopg.types.json import Jsonb

from ..uuid7 import uuid7
from .cycle import confirmed_edges, find_cycle
from .names import Labels, labels, normalize_name, same_name

Conn = psycopg.Connection[Any]

#: `pg_advisory_xact_lock` für jede Annahme, gleich im Core (`lib/locks.ts`)
CONCEPT_GRAPH_LOCK_KEY = 70070006
#: W-05: `importance` 1 bis 3 → `importance_base`
IMPORTANCE_BASE = {1: 0.8, 2: 1.0, 3: 1.3}
SYMMETRIC = frozenset({"gegensatz", "verwandt"})
RELATION_KINDS = frozenset({"baut_auf", "beispiel_fuer", "angewendet_in"}) | SYMMETRIC
CONCEPT_KINDS = frozenset({"definition", "verfahren", "modell", "satz", "beispiel"})
MAX_ALIASES = 20
MAX_NAME = 200
MAX_ONE_LINER = 500
AUTO_MIN_CONFIDENCE = 0.9

AutoAccept = Literal["aus", "nur_beziehungen", "alles_ab_0_9"]
AUTO_ACCEPT_MODES: tuple[AutoAccept, ...] = ("aus", "nur_beziehungen", "alles_ab_0_9")
DecidedStatus = Literal["angenommen", "automatisch"]


class AcceptError(Exception):
    """Eine Annahme scheitert mit einem Fehlercode aus §20.6/§20.11. Nichts ändert sich."""

    def __init__(self, code: str, details: Mapping[str, Any] | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.details: dict[str, Any] = dict(details or {})


def lock_graph(conn: Conn) -> None:
    """Advisory-Lock des Wissensnetzes bis zum Ende der Transaktion."""
    conn.execute("SELECT pg_advisory_xact_lock(%s)", (CONCEPT_GRAPH_LOCK_KEY,))


def auto_accept_mode(conn: Conn) -> AutoAccept:
    """`ai.auto_accept` aus `setting` (§20.7). Fehlend oder ungültig: `aus`."""
    row = conn.execute(
        "SELECT value FROM setting WHERE key = 'ai' AND deleted_at IS NULL"
    ).fetchone()
    value = row[0].get("auto_accept") if row and isinstance(row[0], dict) else None
    for mode in AUTO_ACCEPT_MODES:
        if value == mode:
            return mode
    return "aus"


def sort_symmetric(kind: str, from_id: uuid.UUID, to_id: uuid.UUID) -> tuple[uuid.UUID, uuid.UUID]:
    """Symmetrische Arten stehen immer mit `from_id < to_id` (§20.1)."""
    if kind in SYMMETRIC and to_id < from_id:
        return to_id, from_id
    return from_id, to_id


def decision(action: str, **values: Any) -> dict[str, Any]:
    """`InboxDecision` mit allen Pflichtfeldern."""
    base: dict[str, Any] = {
        "action": action,
        "concept_id": None,
        "merged_into": None,
        "moved_evidence_ids": [],
        "added_aliases": [],
        "added_module_ids": [],
        "previous": None,
        "relation_kind_before": None,
        "cascade_item_ids": [],
        "duplicate_of": None,
        "triggered_by": None,
    }
    base.update(values)
    return base


@dataclass(frozen=True)
class _Item:
    id: uuid.UUID
    kind: str
    session_id: uuid.UUID | None
    payload: dict[str, Any]
    concept_id: uuid.UUID | None
    target_concept_id: uuid.UUID | None
    relation_id: uuid.UUID | None


@dataclass(frozen=True)
class _Concept:
    id: uuid.UUID
    user_id: uuid.UUID
    name: str
    aliases: list[str]
    one_liner: str | None
    kind: str | None
    status: str
    alive: bool
    exam_relevant: bool


def _decide(conn: Conn, item_id: uuid.UUID, status: str, value: dict[str, Any]) -> None:
    conn.execute(
        "UPDATE inbox_item SET status = %s, decided_at = now(), decision = %s WHERE id = %s",
        (status, Jsonb(value), item_id),
    )


def _lock_concepts(conn: Conn, ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, _Concept]:
    rows = conn.execute(
        "SELECT id, user_id, name, aliases, one_liner, kind, status, deleted_at IS NULL, "
        "exam_relevant FROM concept WHERE id = ANY(%s) ORDER BY id FOR NO KEY UPDATE",
        (sorted(set(ids)),),
    ).fetchall()
    return {
        r[0]: _Concept(r[0], r[1], r[2], list(r[3] or []), r[4], r[5], r[6], bool(r[7]), bool(r[8]))
        for r in rows
    }


def _proposal(item: _Item) -> dict[str, Any]:
    value = item.payload.get("proposal")
    return value if isinstance(value, dict) else {}


# ---------- A3: Beziehung bestätigen ----------


def _confirm_relation(
    conn: Conn,
    item_id: uuid.UUID,
    relation_id: uuid.UUID,
    relation_kind: str | None,
    status: DecidedStatus,
) -> dict[str, Any]:
    row = conn.execute(
        "SELECT from_id, to_id, kind, confirmed FROM concept_relation "
        "WHERE id = %s AND deleted_at IS NULL",
        (relation_id,),
    ).fetchone()
    if row is None or row[3]:
        raise AcceptError("inbox_action_invalid")
    from_id, to_id, kind = row[0], row[1], str(row[2])
    concepts = _lock_concepts(conn, [from_id, to_id])
    for cid in (from_id, to_id):
        concept = concepts.get(cid)
        if concept is None or concept.status != "aktiv" or not concept.alive:
            raise AcceptError("relation_endpoint_pending", {"concept_id": str(cid)})
    conn.execute("SELECT 1 FROM concept_relation WHERE id = %s FOR NO KEY UPDATE", (relation_id,))
    new_kind = kind if relation_kind is None else relation_kind
    before = kind if new_kind != kind else None
    new_from, new_to = sort_symmetric(new_kind, from_id, to_id)
    duplicate = conn.execute(
        "SELECT id, confirmed FROM concept_relation WHERE from_id = %s AND to_id = %s "
        "AND kind = %s AND deleted_at IS NULL AND id <> %s",
        (new_from, new_to, new_kind, relation_id),
    ).fetchone()
    if duplicate is not None:
        # Diese Zeile bleibt unverändert und unbestätigt liegen (nie hart löschen: Kaskade)
        result = decision(
            "beziehung_bestaetigt", relation_kind_before=before, duplicate_of=str(duplicate[0])
        )
        if not duplicate[1]:
            other = conn.execute(
                "SELECT id FROM inbox_item WHERE relation_id = %s AND status = 'offen' "
                "AND deleted_at IS NULL FOR UPDATE SKIP LOCKED",
                (duplicate[0],),
            ).fetchone()
            if other is not None:
                _check_cycle(conn, new_kind, new_from, new_to)
                conn.execute(
                    "UPDATE concept_relation SET confirmed = true, proposal_session_id = NULL "
                    "WHERE id = %s",
                    (duplicate[0],),
                )
                _decide(
                    conn,
                    other[0],
                    status,
                    decision("beziehung_bestaetigt", triggered_by=str(item_id)),
                )
                result["cascade_item_ids"] = [str(other[0])]
        return result
    _check_cycle(conn, new_kind, new_from, new_to)
    conn.execute(
        "UPDATE concept_relation SET kind = %s, from_id = %s, to_id = %s, confirmed = true, "
        "proposal_session_id = NULL WHERE id = %s",
        (new_kind, new_from, new_to, relation_id),
    )
    return decision("beziehung_bestaetigt", relation_kind_before=before)


def _check_cycle(conn: Conn, kind: str, from_id: uuid.UUID, to_id: uuid.UUID) -> None:
    if kind != "baut_auf":
        return
    path = find_cycle(confirmed_edges(conn), from_id, to_id)
    if path is not None:
        raise AcceptError("relation_cycle", {"path": [str(p) for p in path]})


# ---------- A1: neues Konzept ----------


def _apply_edit(concept: _Concept, edit: Mapping[str, Any]) -> tuple[dict[str, Any], bool]:
    """Fassung nach `edit` (normiert) und ob sich Name, Aliase oder One-Liner ändern."""
    name = concept.name
    if "name" in edit:
        name = normalize_name(str(edit["name"]))
        if not name or len(name) > MAX_NAME:
            raise AcceptError("inbox_action_invalid")
    aliases = concept.aliases
    if "aliases" in edit:
        raw = edit["aliases"]
        if not isinstance(raw, list) or len(raw) > MAX_ALIASES:
            raise AcceptError("inbox_action_invalid")
        aliases = []
        seen = {name.lower()}
        for alias in raw:
            value = normalize_name(str(alias))
            if not value or len(value) > MAX_NAME:
                raise AcceptError("inbox_action_invalid")
            if value.lower() not in seen:
                seen.add(value.lower())
                aliases.append(value)
    one_liner = concept.one_liner
    if "one_liner" in edit:
        raw_line = edit["one_liner"]
        one_liner = None if raw_line is None else normalize_name(str(raw_line)) or None
        if one_liner is not None and len(one_liner) > MAX_ONE_LINER:
            raise AcceptError("inbox_action_invalid")
    kind = concept.kind
    if "kind" in edit:
        kind = edit["kind"]
        if kind is not None and kind not in CONCEPT_KINDS:
            raise AcceptError("inbox_action_invalid")
    after = {"name": name, "aliases": aliases, "one_liner": one_liner, "kind": kind}
    changed = (name, aliases, one_liner) != (concept.name, concept.aliases, concept.one_liner)
    return after, changed


def find_same_name(conn: Conn, own: Labels, exclude: uuid.UUID | None) -> uuid.UUID | None:
    """Ein anderes aktives, nicht gelöschtes Konzept, das namensgleich ist (kleinste ID)."""
    rows = conn.execute(
        "SELECT id, name, aliases FROM concept WHERE status = 'aktiv' AND deleted_at IS NULL "
        "ORDER BY id"
    ).fetchall()
    for cid, name, aliases in rows:
        if cid != exclude and same_name(own, labels(name, aliases or [])):
            return uuid.UUID(str(cid))
    return None


def _accept_new(
    conn: Conn,
    item: _Item,
    edit: Mapping[str, Any] | None,
    status: DecidedStatus,
    auto_accept: AutoAccept,
) -> dict[str, Any]:
    assert item.concept_id is not None
    concept = _lock_concepts(conn, [item.concept_id]).get(item.concept_id)
    if concept is None or concept.status != "vorschlag" or not concept.alive:
        raise AcceptError("inbox_action_invalid")
    after, changed = _apply_edit(concept, edit or {})
    other = find_same_name(conn, labels(after["name"], after["aliases"]), concept.id)
    if other is not None:
        raise AcceptError("concept_exists", {"concept_id": str(other)})
    proposal = _proposal(item)
    importance = proposal.get("importance")
    base = IMPORTANCE_BASE.get(importance if isinstance(importance, int) else 2, 1.0)
    conn.execute(
        "UPDATE concept SET name = %s, aliases = %s, one_liner = %s, kind = %s, "
        "status = 'aktiv', proposal_session_id = NULL, importance_base = %s, "
        "exam_relevant = exam_relevant OR %s, "
        "embedding = CASE WHEN %s THEN NULL ELSE embedding END, "
        "embedding_model = CASE WHEN %s THEN NULL ELSE embedding_model END WHERE id = %s",
        (
            after["name"],
            after["aliases"],
            after["one_liner"],
            after["kind"],
            base,
            proposal.get("exam_hint") is True,
            changed,
            changed,
            concept.id,
        ),
    )
    previous = None
    if edit:
        before = {
            "name": concept.name,
            "aliases": concept.aliases,
            "one_liner": concept.one_liner,
            "kind": concept.kind,
        }
        previous = {k: before[k] for k in before if k in edit}
    cascade: list[str] = []
    if auto_accept != "aus":
        # Offene Beziehungen mit diesem Konzept als Endpunkt bestätigen (A3), sobald beide
        # Endpunkte aktiv sind. Scheitert A3 (Endpunkt offen, Kreis), bleibt der Eintrag offen.
        rows = conn.execute(
            "SELECT i.id, i.relation_id, i.payload->'confidence' FROM inbox_item i "
            "JOIN concept_relation r ON r.id = i.relation_id "
            "WHERE i.status = 'offen' AND i.deleted_at IS NULL AND r.deleted_at IS NULL "
            "AND NOT r.confirmed AND (r.from_id = %s OR r.to_id = %s) ORDER BY i.priority, i.id",
            (concept.id, concept.id),
        ).fetchall()
        for other_id, relation_id, confidence in rows:
            if auto_accept == "alles_ab_0_9" and not confident(confidence):
                continue
            try:
                with conn.transaction():
                    follow = _confirm_relation(conn, other_id, relation_id, None, status)
                    follow["triggered_by"] = str(item.id)
                    _decide(conn, other_id, status, follow)
            except AcceptError:
                continue
            cascade.append(str(other_id))
    return decision(
        "angenommen_neu", concept_id=str(concept.id), previous=previous, cascade_item_ids=cascade
    )


def confident(value: Any) -> bool:
    """`confidence ≥ 0,9` (Automatik bei `alles_ab_0_9`). Gerechnet wird mit dem Wert aus der
    Nutzlast, nicht mit der Spalte `real` (0,9 wäre dort knapp darunter)."""
    return (
        isinstance(value, int | float)
        and not isinstance(value, bool)
        and float(value) >= AUTO_MIN_CONFIDENCE
    )


# ---------- A2: zusammenführen ----------


def _merge(conn: Conn, item: _Item, target_id: uuid.UUID | None) -> dict[str, Any]:
    assert item.concept_id is not None
    if target_id is None or target_id == item.concept_id:
        raise AcceptError("merge_target_invalid")
    concepts = _lock_concepts(conn, [item.concept_id, target_id])
    source = concepts.get(item.concept_id)
    target = concepts.get(target_id)
    if target is None or not target.alive:
        raise AcceptError("merge_target_invalid")
    if source is None or source.status != "vorschlag" or not source.alive:
        raise AcceptError("inbox_action_invalid")

    # Belege: an T hängen, eine Dublette (evidence_dedupe_uq) von P hart löschen
    moved: list[str] = []
    for (evidence_id,) in conn.execute(
        "SELECT id FROM evidence WHERE concept_id = %s AND deleted_at IS NULL ORDER BY id",
        (source.id,),
    ).fetchall():
        twin = conn.execute(
            "SELECT 1 FROM evidence t JOIN evidence e ON e.id = %s WHERE t.concept_id = %s "
            "AND t.deleted_at IS NULL AND t.kind = e.kind AND t.ref_id = e.ref_id "
            "AND t.t_start_ms IS NOT DISTINCT FROM e.t_start_ms "
            "AND t.t_end_ms IS NOT DISTINCT FROM e.t_end_ms "
            "AND t.session_id IS NOT DISTINCT FROM e.session_id",
            (evidence_id, target.id),
        ).fetchone()
        if twin is not None:
            conn.execute("DELETE FROM evidence WHERE id = %s", (evidence_id,))
        else:
            conn.execute(
                "UPDATE evidence SET concept_id = %s WHERE id = %s", (target.id, evidence_id)
            )
            moved.append(str(evidence_id))

    # Name und Aliase von P als Aliase an T (ohne namensgleiche, höchstens 20 insgesamt)
    aliases = list(target.aliases)
    known = set(labels(target.name, target.aliases).keys)
    added: list[str] = []
    for label in (source.name, *source.aliases):
        value = normalize_name(label)
        if not value or value.lower() in known or len(aliases) >= MAX_ALIASES:
            continue
        known.add(value.lower())
        aliases.append(value)
        added.append(value)

    # Fehlende Fächer an T
    modules: list[str] = []
    for (module_id,) in conn.execute(
        "SELECT module_id FROM concept_module WHERE concept_id = %s AND deleted_at IS NULL "
        "ORDER BY module_id",
        (source.id,),
    ).fetchall():
        done = conn.execute(
            "INSERT INTO concept_module (id, user_id, concept_id, module_id) "
            "VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING",
            (uuid7(), target.user_id, target.id, module_id),
        )
        if done.rowcount:
            modules.append(str(module_id))

    # Unbestätigte Beziehungen von P mit offenem Eintrag auf T umhängen
    cascade: list[str] = []
    rows = conn.execute(
        "SELECT r.id, r.from_id, r.to_id, r.kind, i.id FROM concept_relation r "
        "JOIN inbox_item i ON i.relation_id = r.id AND i.status = 'offen' "
        "AND i.deleted_at IS NULL WHERE r.deleted_at IS NULL AND NOT r.confirmed "
        "AND (r.from_id = %s OR r.to_id = %s) ORDER BY i.priority, i.id FOR NO KEY UPDATE OF r",
        (source.id, source.id),
    ).fetchall()
    for relation_id, from_id, to_id, kind, other_id in rows:
        new_from = target.id if from_id == source.id else from_id
        new_to = target.id if to_id == source.id else to_id
        new_from, new_to = sort_symmetric(str(kind), new_from, new_to)
        duplicate = None
        if new_from != new_to:
            duplicate = conn.execute(
                "SELECT id FROM concept_relation WHERE from_id = %s AND to_id = %s "
                "AND kind = %s AND deleted_at IS NULL AND id <> %s",
                (new_from, new_to, kind, relation_id),
            ).fetchone()
        if new_from == new_to or duplicate is not None:
            # Die Zeile bleibt unverändert an P liegen (nie hart löschen: Kaskade)
            _decide(
                conn,
                other_id,
                "abgelehnt",
                decision(
                    "abgelehnt",
                    triggered_by=str(item.id),
                    duplicate_of=None if duplicate is None else str(duplicate[0]),
                ),
            )
        else:
            conn.execute(
                "UPDATE concept_relation SET from_id = %s, to_id = %s WHERE id = %s",
                (new_from, new_to, relation_id),
            )
            conn.execute(
                "UPDATE inbox_item SET payload = payload || %s WHERE id = %s",
                (
                    Jsonb({"from_concept_id": str(new_from), "to_concept_id": str(new_to)}),
                    other_id,
                ),
            )
        cascade.append(str(other_id))

    conn.execute(
        "UPDATE concept SET aliases = %s, exam_relevant = exam_relevant OR %s, "
        "embedding = CASE WHEN %s THEN NULL ELSE embedding END, "
        "embedding_model = CASE WHEN %s THEN NULL ELSE embedding_model END WHERE id = %s",
        (aliases, _proposal(item).get("exam_hint") is True, bool(added), bool(added), target.id),
    )
    conn.execute(
        "UPDATE concept SET status = 'zusammengefuehrt', merged_into = %s WHERE id = %s",
        (target.id, source.id),
    )
    return decision(
        "zusammengefuehrt",
        concept_id=str(source.id),
        merged_into=str(target.id),
        moved_evidence_ids=moved,
        added_aliases=added,
        added_module_ids=modules,
        cascade_item_ids=cascade,
    )


# ---------- Einstieg ----------


def accept_item(
    conn: Conn,
    item_id: uuid.UUID,
    *,
    status: DecidedStatus = "automatisch",
    auto_accept: AutoAccept = "aus",
    edit: Mapping[str, Any] | None = None,
    merge_into: uuid.UUID | None = None,
    relation_kind: str | None = None,
    as_new: bool = False,
) -> dict[str, Any]:
    """Nimmt einen offenen Eintrag an und liefert seine `InboxDecision`. `status` ist
    `automatisch` für die Automatik (`angenommen`, wenn die Annahme vom Nutzer kommt, §20.6).
    Wirft `AcceptError` mit dem Fehlercode; dann bleibt alles unverändert."""
    with conn.transaction():
        row = conn.execute(
            "SELECT id, kind, session_id, payload, concept_id, target_concept_id, relation_id, "
            "status FROM inbox_item WHERE id = %s AND deleted_at IS NULL",
            (item_id,),
        ).fetchone()
        if row is None:
            raise AcceptError("inbox_item_not_found")
        if row[7] != "offen":
            raise AcceptError("inbox_item_decided")
        item = _Item(
            row[0], str(row[1]), row[2], row[3] if isinstance(row[3], dict) else {}, *row[4:7]
        )
        if item.kind == "relation":
            if edit is not None or merge_into is not None or as_new or item.relation_id is None:
                raise AcceptError("inbox_action_invalid")
            if relation_kind is not None and relation_kind not in RELATION_KINDS:
                raise AcceptError("inbox_action_invalid")
            result = _confirm_relation(conn, item.id, item.relation_id, relation_kind, status)
        else:
            if relation_kind is not None or item.concept_id is None:
                raise AcceptError("inbox_action_invalid")
            if as_new and (item.kind == "concept_new" or merge_into is not None):
                raise AcceptError("inbox_action_invalid")
            if merge_into is not None or (item.kind == "concept_merge" and not as_new):
                result = _merge(conn, item, merge_into or item.target_concept_id)
            else:
                result = _accept_new(conn, item, edit, status, auto_accept)
        _decide(conn, item.id, status, result)
        return result
