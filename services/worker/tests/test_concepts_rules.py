"""Gemeinsame Regeln für Konzepte gegen die Testfälle aus `packages/schemas/fixtures/concepts/`
(VERTRAEGE §20.3/§20.6, §20.12): Normieren, Namensgleichheit, Kreisprüfung, Annahmen A1 bis A3.
Dieselben Dateien prüft der Core (T2-22b)."""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

import psycopg
import pytest
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from conceptdata import ins, module
from conftest import USER_ID
from sg_worker.concepts import accept, cycle, names

Conn = psycopg.Connection[Any]

FIXTURES = Path(__file__).resolve().parents[3] / "packages" / "schemas" / "fixtures" / "concepts"


def cases(name: str) -> list[dict[str, Any]]:
    data = json.loads((FIXTURES / name).read_text(encoding="utf-8"))
    found: list[dict[str, Any]] = data["cases"]
    assert found
    return found


# ---------- Normieren ----------


@pytest.mark.parametrize("case", cases("normalize.json"), ids=lambda c: repr(c["input"]))
def test_normalize(case: dict[str, Any]) -> None:
    assert names.normalize_name(case["input"]) == case["norm"]
    assert names.name_key(case["input"]) == case["key"]
    assert names.name_base(case["input"]) == case["base"]


def test_key_uses_lower_not_casefold() -> None:
    assert names.name_key("STRAẞE Straße") == "straße straße"


@pytest.mark.parametrize("case", cases("name-match.json"), ids=lambda c: c["a"]["name"])
def test_name_match(case: dict[str, Any]) -> None:
    a = names.labels(case["a"]["name"], case["a"].get("aliases", []))
    b = names.labels(case["b"]["name"], case["b"].get("aliases", []))
    assert names.same_name(a, b) is case["namensgleich"]
    assert names.same_name(b, a) is case["namensgleich"]
    assert names.similar_name(a, b) is case["namensaehnlich"]
    assert names.similar_name(b, a) is case["namensaehnlich"]


def test_extract_uses_shared_rules() -> None:
    from sg_worker.handlers import concepts_extract as ce

    assert ce.normalize_name is names.normalize_name
    assert ce.name_key is names.name_key


# ---------- Kreisprüfung ----------


@pytest.mark.parametrize("case", cases("cycle.json"), ids=lambda c: c["name"])
def test_cycle(case: dict[str, Any]) -> None:
    edges = [(e["from"], e["to"]) for e in case["edges"] if e["confirmed"]]
    assert cycle.find_cycle(edges, case["new"]["from"], case["new"]["to"]) == case["path"]


# ---------- Annahmen A1 bis A3 gegen die Datenbank ----------

DECISIONS = cases("decisions.json")
#: Ablehnen und Rückgängig gibt es nur im Core (§20.6), der Worker nimmt nur an (Automatik)
WORKER_OPS = {"accept"}
CORE_ONLY_OPS = {"reject", "reopen"}


def test_decision_ops_are_known() -> None:
    assert {c["action"]["op"] for c in DECISIONS} <= WORKER_OPS | CORE_ONLY_OPS


class World:
    """Ausgangszustand eines Falls in der Datenbank. IDs in der Reihenfolge der Kurznamen."""

    def __init__(self, conn: Conn, case: dict[str, Any]) -> None:
        self.conn = conn
        self.ids: dict[str, uuid.UUID] = {}
        refs: list[str] = []
        for group in ("concepts", "relations", "items", "evidence"):
            refs += [row["ref"] for row in case.get(group, [])]
        sessions = {
            row["session"]
            for group in ("concepts", "relations", "items", "evidence")
            for row in case.get(group, [])
            if row.get("session")
        }
        for n, ref in enumerate(sorted(set(refs) | sessions), start=1):
            assert ref not in self.ids
            self.ids[ref] = uuid.UUID(int=(0x01960A3C_0000_7000_8000 << 48) + n)
        self.module = module(conn)
        for ref in sorted(sessions):
            ins(conn, "session", id=self.ids[ref], module_id=self.module, state="beendet",
                number=7, title="Erfundene Vorlesung", started_at="2026-11-05 10:00:00+00",
                ended_at="2026-11-05 11:30:00+00")  # fmt: skip
        mode = case.get("settings", {}).get("auto_accept", "aus")
        conn.execute(
            "INSERT INTO setting (key, value, user_id) VALUES ('ai', %s, %s)",
            (Jsonb({"monthly_budget_eur": 10, "auto_accept": mode}), USER_ID),
        )
        for c in case.get("concepts", []):
            ins(
                conn,
                "concept",
                id=self.ids[c["ref"]],
                name=c["name"],
                aliases=c.get("aliases", []),
                status=c["status"],
                proposal_session_id=self.ref(c.get("session")),
                merged_into=self.ref(c.get("merged_into")),
            )
        for r in case.get("relations", []):
            ins(
                conn,
                "concept_relation",
                id=self.ids[r["ref"]],
                from_id=self.ids[r["from"]],
                to_id=self.ids[r["to"]],
                kind=r["kind"],
                source="ki",
                confidence=0.5,
                confirmed=r["confirmed"],
                proposal_session_id=self.ref(r.get("session")),
            )
        for e in case.get("evidence", []):
            assert e["kind"] == "slide"
            ins(
                conn,
                "evidence",
                id=self.ids[e["ref"]],
                concept_id=self.ids[e["concept"]],
                session_id=self.ref(e.get("session")),
                kind="slide",
                ref_id=uuid.uuid5(uuid.NAMESPACE_OID, e["slide"]),
            )
        relations = {r["ref"]: r for r in case.get("relations", [])}
        for i in case.get("items", []):
            status = i.get("status", "offen")
            payload: dict[str, Any] = {"kind": i["kind"]}
            if i["kind"] == "relation":
                rel = relations[i["relation"]]
                payload |= {
                    "from_concept_id": str(self.ids[rel["from"]]),
                    "to_concept_id": str(self.ids[rel["to"]]),
                    "relation_kind": rel["kind"],
                    "why": "Erfundene Begründung.",
                    "confidence": 0.5,
                }
            else:
                payload["proposal"] = i["proposal"]
            ins(
                conn,
                "inbox_item",
                id=self.ids[i["ref"]],
                kind=i["kind"],
                session_id=self.ref(i.get("session")),
                payload=Jsonb(payload),
                status=status,
                decided_at=None if status == "offen" else "2026-11-05 12:00:00+00",
                decision=None if i.get("decision") is None else Jsonb(self.deref(i["decision"])),
                concept_id=self.ref(i.get("concept")),
                target_concept_id=self.ref(i.get("target")),
                relation_id=self.ref(i.get("relation")),
            )

    def ref(self, name: str | None) -> uuid.UUID | None:
        return None if name is None else self.ids[name]

    def deref(self, value: Any) -> Any:
        """Kurznamen in einem erwarteten Wert durch IDs ersetzen."""
        if isinstance(value, str) and value in self.ids:
            return str(self.ids[value])
        if isinstance(value, list):
            return [self.deref(v) for v in value]
        if isinstance(value, dict):
            return {k: self.deref(v) for k, v in value.items()}
        return value

    def rows(self, table: str) -> dict[str, dict[str, Any]]:
        with self.conn.cursor(row_factory=dict_row) as cur:
            cur.execute(f"SELECT * FROM {table} ORDER BY id")  # type: ignore[arg-type]
            return {str(r["id"]): r for r in cur.fetchall()}

    def snapshot(self) -> dict[str, Any]:
        tables = ("concept", "concept_relation", "inbox_item", "evidence", "concept_module")
        return {t: self.rows(t) for t in tables}


def _plain(value: Any) -> Any:
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, list):
        return [_plain(v) for v in value]
    return value


def _subset(world: World, actual: dict[str, Any], expected: dict[str, Any], where: str) -> None:
    """Nur die genannten Felder werden geprüft (README der Testfälle)."""
    columns = {
        "session": "proposal_session_id",
        "from": "from_id",
        "to": "to_id",
        "concept": "concept_id",
    }
    for field, want in expected.items():
        got = actual[columns.get(field, field)]
        if isinstance(want, dict):
            assert isinstance(got, dict), f"{where}.{field}"
            _subset(world, got, want, f"{where}.{field}")
        elif isinstance(want, float):
            assert got == pytest.approx(want), f"{where}.{field}"
        else:
            assert _plain(got) == world.deref(want), f"{where}.{field}"


@pytest.mark.parametrize(
    "case", [c for c in DECISIONS if c["action"]["op"] in WORKER_OPS], ids=lambda c: c["name"]
)
def test_decisions(core_db: Conn, case: dict[str, Any]) -> None:
    world = World(core_db, case)
    body = case["action"].get("body", {})
    before = world.snapshot()
    error: accept.AcceptError | None = None
    with core_db.transaction():
        accept.lock_graph(core_db)
        try:
            # `angenommen`: die Annahme kommt in den Testfällen vom Nutzer (§20.6)
            accept.accept_item(
                core_db,
                world.ids[case["action"]["item"]],
                status="angenommen",
                auto_accept=accept.auto_accept_mode(core_db),
                edit=body.get("edit"),
                merge_into=world.ref(body.get("merge_into")),
                relation_kind=body.get("relation_kind"),
                as_new=body.get("as_new", False),
            )
        except accept.AcceptError as exc:
            error = exc
    expect = case["expect"]
    if expect["error"] is not None:
        assert error is not None and error.code == expect["error"]
        assert error.details == world.deref(expect.get("details", error.details))
        assert world.snapshot() == before  # dann ändert sich nichts
        return
    assert error is None, error
    tables = {
        "concepts": "concept",
        "relations": "concept_relation",
        "items": "inbox_item",
        "evidence": "evidence",
    }
    for group, table in tables.items():
        rows = world.rows(table)
        for ref, want in expect.get(group, {}).items():
            _subset(world, rows[str(world.ids[ref])], want, f"{group}.{ref}")
    for item in world.rows("inbox_item").values():
        assert (item["status"] == "offen") == (item["decided_at"] is None)


# ---------- Ergänzungen zu den gemeinsamen Fällen ----------


def _simple(conn: Conn, mode: str = "aus") -> dict[str, Any]:
    case = {
        "settings": {"auto_accept": mode},
        "concepts": [
            {"ref": "a", "name": "Relation", "status": "aktiv"},
            {"ref": "b", "name": "Tupel", "status": "aktiv"},
            {"ref": "p", "name": "Attribut", "status": "vorschlag", "session": "s1"},
        ],
        "relations": [
            {"ref": "r1", "from": "p", "to": "a", "kind": "baut_auf", "confirmed": False,
             "session": "s1"},
            {"ref": "r2", "from": "a", "to": "p", "kind": "baut_auf", "confirmed": False,
             "session": "s1"},
        ],
        "items": [
            {"ref": "i1", "kind": "concept_new", "concept": "p", "session": "s1",
             "proposal": {"name": "Attribut", "importance": 1, "exam_hint": False}},
            {"ref": "i2", "kind": "relation", "relation": "r1", "session": "s1"},
            {"ref": "i3", "kind": "relation", "relation": "r2", "session": "s1"},
        ],
    }  # fmt: skip
    return {"world": World(conn, case)}


def test_a1_cascade_leaves_cycle_open_and_respects_confidence(core_db: Conn) -> None:
    """A1 bestätigt offene Beziehungen nach der Einstellung. Die zweite schlösse einen Kreis
    und bleibt offen; bei `alles_ab_0_9` zählt die Konfidenz der Nutzlast."""
    world: World = _simple(core_db, "nur_beziehungen")["world"]
    with core_db.transaction():
        accept.lock_graph(core_db)
        result = accept.accept_item(
            core_db, world.ids["i1"], auto_accept=accept.auto_accept_mode(core_db)
        )
    items = world.rows("inbox_item")
    assert result["cascade_item_ids"] == [str(world.ids["i2"])]
    assert items[str(world.ids["i1"])]["status"] == "automatisch"
    assert items[str(world.ids["i2"])]["status"] == "automatisch"
    assert items[str(world.ids["i2"])]["decision"]["triggered_by"] == str(world.ids["i1"])
    assert items[str(world.ids["i3"])]["status"] == "offen"  # Kreis
    concept = world.rows("concept")[str(world.ids["p"])]
    assert concept["importance_base"] == pytest.approx(0.8)


def test_a1_cascade_needs_confidence_with_alles(core_db: Conn) -> None:
    world: World = _simple(core_db, "alles_ab_0_9")["world"]
    core_db.execute(
        "UPDATE inbox_item SET payload = payload || '{\"confidence\": 0.9}' WHERE id = %s",
        (world.ids["i3"],),
    )
    with core_db.transaction():
        accept.lock_graph(core_db)
        result = accept.accept_item(core_db, world.ids["i1"], auto_accept="alles_ab_0_9")
    # i2 hat 0,5 und bleibt offen, i3 hat genau 0,9 und wird bestätigt
    assert result["cascade_item_ids"] == [str(world.ids["i3"])]
    assert world.rows("inbox_item")[str(world.ids["i2"])]["status"] == "offen"


def test_a2_self_reference_is_rejected_and_modules_move(core_db: Conn) -> None:
    world: World = _simple(core_db)["world"]
    ids = world.ids
    ins(core_db, "concept_module", concept_id=ids["p"], module_id=world.module)
    with core_db.transaction():
        accept.lock_graph(core_db)
        result = accept.accept_item(core_db, ids["i1"], merge_into=ids["a"])
    assert result["action"] == "zusammengefuehrt"
    assert result["added_module_ids"] == [str(world.module)]
    assert result["added_aliases"] == ["Attribut"]
    assert result["cascade_item_ids"] == [str(ids["i2"]), str(ids["i3"])]
    items = world.rows("inbox_item")
    for ref in ("i2", "i3"):  # p→a und a→p würden zum Selbstbezug a→a
        assert items[str(ids[ref])]["status"] == "abgelehnt"
        assert items[str(ids[ref])]["decision"]["triggered_by"] == str(ids["i1"])
        assert items[str(ids[ref])]["decision"]["duplicate_of"] is None
    relation = world.rows("concept_relation")[str(ids["r1"])]
    assert (relation["from_id"], relation["to_id"]) == (ids["p"], ids["a"])


def test_a2_moves_relation_and_payload(core_db: Conn) -> None:
    world: World = _simple(core_db)["world"]
    ids = world.ids
    with core_db.transaction():
        accept.lock_graph(core_db)
        accept.accept_item(core_db, ids["i1"], merge_into=ids["b"])
    relation = world.rows("concept_relation")[str(ids["r1"])]
    assert (relation["from_id"], relation["to_id"]) == (ids["b"], ids["a"])
    assert relation["confirmed"] is False
    payload = world.rows("inbox_item")[str(ids["i2"])]["payload"]
    assert payload["from_concept_id"] == str(ids["b"])
    assert payload["to_concept_id"] == str(ids["a"])
    assert world.rows("inbox_item")[str(ids["i2"])]["status"] == "offen"


@pytest.mark.parametrize(
    ("kwargs", "item"),
    [
        ({"relation_kind": "verwandt"}, "i1"),
        ({"edit": {"name": "X"}}, "i2"),
        ({"as_new": True}, "i1"),
        ({"relation_kind": "unbekannt"}, "i2"),
    ],
)
def test_fields_must_fit_the_kind(core_db: Conn, kwargs: dict[str, Any], item: str) -> None:
    world: World = _simple(core_db)["world"]
    with core_db.transaction(), pytest.raises(accept.AcceptError) as info:
        accept.accept_item(core_db, world.ids[item], **kwargs)
    assert info.value.code == "inbox_action_invalid"


def test_decided_item_is_not_accepted_again(core_db: Conn) -> None:
    world: World = _simple(core_db)["world"]
    with core_db.transaction():
        accept.lock_graph(core_db)
        accept.accept_item(core_db, world.ids["i1"])
        with pytest.raises(accept.AcceptError) as info:
            accept.accept_item(core_db, world.ids["i1"])
    assert info.value.code == "inbox_item_decided"


@pytest.mark.parametrize(
    ("value", "mode"),
    [
        (None, "aus"),
        ({"auto_accept": "nur_beziehungen"}, "nur_beziehungen"),
        ({"auto_accept": "alles_ab_0_9"}, "alles_ab_0_9"),
        ({"auto_accept": "alles"}, "aus"),
        ({"auto_accept": True}, "aus"),
        ([], "aus"),
    ],
)
def test_auto_accept_mode(core_db: Conn, value: Any, mode: str) -> None:
    if value is not None:
        core_db.execute(
            "INSERT INTO setting (key, value, user_id) VALUES ('ai', %s, %s)",
            (Jsonb(value), USER_ID),
        )
    assert accept.auto_accept_mode(core_db) == mode
