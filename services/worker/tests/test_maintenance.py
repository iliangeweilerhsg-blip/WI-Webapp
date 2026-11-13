"""`maintenance.nightly` gegen das echte Schema des Core (dessen Migrationen werden in ein Test-Schema gespielt)."""

from __future__ import annotations

import logging
import os
import time
import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import psycopg
import pytest
from sg_schemas.models import MaintenanceNightlyPayload, MaintenanceNightlyResult

from conftest import USER_ID
from sg_worker.handlers.maintenance import maintenance_nightly, run_nightly
from sg_worker.registry import JobContext

DRIZZLE = Path(__file__).resolve().parents[2] / "core" / "drizzle"


def _migrations() -> list[str]:
    sql: list[str] = []
    for f in sorted(DRIZZLE.glob("*.sql")):
        sql.extend(part for part in f.read_text().split("--> statement-breakpoint") if part.strip())
    return sql


@pytest.fixture
def core(database_url: str) -> Iterator[psycopg.Connection[Any]]:
    name = f"m_{uuid.uuid4().hex[:12]}"
    with psycopg.connect(database_url, autocommit=True) as c:
        c.execute("CREATE EXTENSION IF NOT EXISTS vector")
        c.execute(f'CREATE SCHEMA "{name}"')
        c.execute(f'SET search_path TO "{name}", public')
        for statement in _migrations():
            if "CREATE EXTENSION" in statement:
                continue
            c.execute(statement.replace('"public".', f'"{name}".'))  # type: ignore[call-overload]
        try:
            yield c
        finally:
            c.execute(f'DROP SCHEMA "{name}" CASCADE')


def ins(conn: psycopg.Connection[Any], table: str, **cols: Any) -> str:
    cols.setdefault("id", str(uuid.uuid4()))
    cols.setdefault("user_id", str(USER_ID))
    keys = ", ".join(cols)
    marks = ", ".join(["%s"] * len(cols))
    conn.execute(f"INSERT INTO {table} ({keys}) VALUES ({marks})", list(cols.values()))  # type: ignore[call-overload]
    return str(cols["id"])


def put(data_dir: Path, rel: str, age_days: float = 0) -> Path:
    p = data_dir / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("x")
    if age_days:
        t = time.time() - age_days * 86400
        os.utime(p, (t, t))
    return p


def count(conn: psycopg.Connection[Any], table: str) -> int:
    row = conn.execute(f"SELECT count(*) FROM {table}").fetchone()  # type: ignore[call-overload]
    assert row is not None
    return int(row[0])


def seed(conn: psycopg.Connection[Any], data_dir: Path, deleted_days: int | None) -> dict[str, str]:
    """Semester, Modul mit Foliensatz, Notizbuch (mit Strom), Session mit Foto. `deleted_days`: Alter der Löschung."""
    d = None
    if deleted_days is not None:  # ein Zeitstempel für alle Zeilen (Kaskade: gleiches deleted_at)
        row = conn.execute("SELECT now() - make_interval(days => %s)", (deleted_days,)).fetchone()
        assert row is not None
        d = row[0]
    ids: dict[str, str] = {}
    ids["sem"] = ins(conn, "semester", name="HS")
    ids["mod"] = ins(conn, "module", semester_id=ids["sem"], name="DBS", color="mod-01")
    ids["deck"] = ins(
        conn,
        "slide_deck",
        module_id=ids["mod"],
        title="VL",
        file_path="media/decks/x/o.pdf",
        sha256="a" * 64,
    )
    ids["slide"] = ins(conn, "slide", deck_id=ids["deck"], index=1, width_pt=1, height_pt=1)
    ids["nb"] = ins(conn, "notebook", module_id=ids["mod"], title="Frei")
    ids["page"] = ins(
        conn,
        "page",
        notebook_id=ids["nb"],
        index=1,
        template="blanko",
        width_pt=1,
        height_pt=1,
        pkdrawing_path="placeholder",
    )
    ids["sess"] = ins(conn, "session", module_id=ids["mod"], state="beendet")
    ids["photo"] = ins(
        conn,
        "photo",
        session_id=ids["sess"],
        t_ms=1,
        mime="image/jpeg",
        sha256="b" * 64,
        size_bytes=1,
    )
    conn.execute(
        "UPDATE page SET pkdrawing_path = %s WHERE id = %s",
        (f"media/pages/{ids['page']}.pkdrawing", ids["page"]),
    )
    conn.execute(
        "UPDATE photo SET file_path = %s WHERE id = %s",
        (f"media/photos/{ids['photo']}.jpg", ids["photo"]),
    )
    for stream in (f"notebook:{ids['nb']}", f"session:{ids['sess']}"):
        conn.execute("INSERT INTO sync_stream (stream, head_seq) VALUES (%s, 1)", (stream,))
        conn.execute(
            "INSERT INTO sync_op (stream, seq, op_id, kind, at, clock_uncertain, data, origin)"
            " VALUES (%s, 1, %s, 'notebook.update', 1, false, '{}'::jsonb, 'server')",
            (stream, str(uuid.uuid4())),
        )
    put(data_dir, f"media/decks/{ids['deck']}/original.pdf")
    put(data_dir, f"media/photos/{ids['photo']}.jpg")
    put(data_dir, f"media/pages/{ids['page']}.pkdrawing")
    if d:
        key = {
            "slide_deck": "deck",
            "semester": "sem",
            "module": "mod",
            "notebook": "nb",
            "session": "sess",
        }
        for table in (
            "slide",
            "slide_deck",
            "page",
            "notebook",
            "photo",
            "session",
            "module",
            "semester",
        ):
            conn.execute(
                f"UPDATE {table} SET deleted_at = %s WHERE id = %s",  # type: ignore[call-overload]
                (d, ids[key.get(table, table)]),
            )
    return ids


def test_purges_old_trash_with_files_and_streams(
    core: psycopg.Connection[Any], tmp_path: Path
) -> None:
    ids = seed(core, tmp_path, 40)
    keep = seed(core, tmp_path, None)
    result = run_nightly(core, tmp_path, MaintenanceNightlyPayload())
    MaintenanceNightlyResult.model_validate(result)
    assert result["purged_by_kind"]["semester"] == 1
    assert result["purged_by_kind"]["module"] == 1
    assert result["sync_ops_removed"] == 2
    assert count(core, "semester") == 1 and count(core, "slide") == 1 and count(core, "page") == 1
    assert count(core, "sync_stream") == 0 or all(
        s[0] in (f"notebook:{keep['nb']}", f"session:{keep['sess']}")
        for s in core.execute("SELECT stream FROM sync_stream").fetchall()
    )
    assert not (tmp_path / "media" / "decks" / ids["deck"]).exists()
    assert not (tmp_path / "media" / "photos" / f"{ids['photo']}.jpg").exists()
    assert not (tmp_path / "media" / "pages" / f"{ids['page']}.pkdrawing").exists()
    assert (tmp_path / "media" / "decks" / keep["deck"] / "original.pdf").exists()
    assert (tmp_path / "media" / "photos" / f"{keep['photo']}.jpg").exists()


def test_young_trash_and_dry_run_keep_everything(
    core: psycopg.Connection[Any], tmp_path: Path
) -> None:
    seed(core, tmp_path, 5)
    assert run_nightly(core, tmp_path, MaintenanceNightlyPayload())["purged_count"] == 0
    old = seed(core, tmp_path, 40)
    dry = run_nightly(core, tmp_path, MaintenanceNightlyPayload(dry_run=True))
    assert dry["purged_count"] > 0
    assert count(core, "semester") == 2
    assert (tmp_path / "media" / "decks" / old["deck"] / "original.pdf").exists()
    custom = run_nightly(core, tmp_path, MaintenanceNightlyPayload(purge_older_than_days=3))
    assert custom["purged_by_kind"]["semester"] == 2
    assert count(core, "semester") == 0


def test_child_deleted_earlier_is_purged_by_own_age(
    core: psycopg.Connection[Any], tmp_path: Path
) -> None:
    ids = seed(core, tmp_path, None)
    core.execute(
        "UPDATE slide_deck SET deleted_at = now() - interval '45 days' WHERE id = %s",
        (ids["deck"],),
    )
    result = run_nightly(core, tmp_path, MaintenanceNightlyPayload())
    assert result["purged_by_kind"] == {"slide_deck": 1}
    assert count(core, "module") == 1


def test_path_escape_is_ignored(core: psycopg.Connection[Any], tmp_path: Path) -> None:
    outside = tmp_path / "außen.txt"
    outside.write_text("bleibt")
    data = tmp_path / "data"
    ids = seed(core, data, 40)
    core.execute("UPDATE photo SET file_path = %s WHERE id = %s", ("../außen.txt", ids["photo"]))
    run_nightly(core, data, MaintenanceNightlyPayload())
    assert outside.exists()


def test_orphan_files(core: psycopg.Connection[Any], tmp_path: Path) -> None:
    ids = seed(core, tmp_path, None)
    stray = str(uuid.uuid4())
    old_orphan = put(tmp_path, f"media/photos/{stray}.heic", 40)
    young_orphan = put(tmp_path, f"media/photos/{uuid.uuid4()}.jpg", 2)
    # HEIC-Waise: Zeile verweist auf .jpg, daneben liegt eine ältere .heic
    waise = put(tmp_path, f"media/photos/{ids['photo']}.heic", 3)
    good = tmp_path / "media" / "photos" / f"{ids['photo']}.jpg"
    old_part = put(tmp_path, "media/decks/x/halb.part", 2)
    new_part = put(tmp_path, "media/decks/y/neu.part", 0)
    old_dir = put(tmp_path, f"media/recordings/{uuid.uuid4()}/chunks/0.webm", 40).parent.parent
    t40 = time.time() - 40 * 86400
    os.utime(old_dir, (t40, t40))
    orphan_pk = put(tmp_path, f"media/pages/{uuid.uuid4()}.pkdrawing", 40)
    result = run_nightly(core, tmp_path, MaintenanceNightlyPayload())
    assert result["orphan_files_removed"] == 5
    for gone in (old_orphan, waise, old_part, old_dir, orphan_pk):
        assert not gone.exists(), gone
    for kept in (young_orphan, new_part, good):
        assert kept.exists(), kept


def test_handler_via_job_context(core: psycopg.Connection[Any], tmp_path: Path) -> None:
    seed(core, tmp_path, 40)
    ctx = JobContext(
        conn=core, data_dir=tmp_path, logger=logging.getLogger("t"), job_id="j", session_id=None
    )
    result = maintenance_nightly(MaintenanceNightlyPayload(), ctx)
    assert result["purged_count"] > 0


def test_restored_root_is_not_purged(core: psycopg.Connection[Any], tmp_path: Path) -> None:
    """Wurzel gefunden, dann wiederhergestellt: der Purge überspringt sie (Review B1)."""
    from sg_worker.handlers import maintenance as m

    ids = seed(core, tmp_path, 40)
    roots = m._find_roots(core, 30)
    assert ("semester", ids["sem"]) in roots
    for table in (
        "semester",
        "module",
        "slide_deck",
        "slide",
        "notebook",
        "page",
        "session",
        "photo",
    ):
        core.execute(f"UPDATE {table} SET deleted_at = NULL")
    with pytest.raises(m.SkipRoot), core.transaction():
        m.purge_roots(core, [("semester", ids["sem"])], dry_run=False)
    assert count(core, "semester") == 1 and count(core, "notebook") == 1
    assert (tmp_path / "media" / "decks" / ids["deck"] / "original.pdf").exists()


def test_active_session_skips_only_its_root(core: psycopg.Connection[Any], tmp_path: Path) -> None:
    ids = seed(core, tmp_path, 40)
    core.execute(
        "INSERT INTO semester (id, user_id, name, deleted_at)"
        " VALUES (gen_random_uuid(), %s, 'X', now() - interval '40 days')",
        (str(USER_ID),),
    )
    core.execute("UPDATE session SET state = 'laeuft' WHERE id = %s", (ids["sess"],))
    result = run_nightly(core, tmp_path, MaintenanceNightlyPayload())
    assert result["purged_by_kind"] == {"semester": 1}
    assert count(core, "session") == 1


def _card(conn: psycopg.Connection[Any], concept: str, deleted_at: Any) -> str:
    """Karte mit Zustand und einer Bewertung; alle Zeilen mit demselben `deleted_at` (Kaskade §21.8)."""
    cid = ins(
        conn,
        "card",
        concept_id=concept,
        kind="basic",
        front='{"text_md": "F"}',
        back='{"text_md": "B"}',
        sources='[{"type": "transcript"}]',
        origin="manuell",
        deleted_at=deleted_at,
    )
    ins(conn, "card_state", card_id=cid, due=deleted_at or "2026-01-01", deleted_at=deleted_at)
    ins(
        conn,
        "review_log",
        card_id=cid,
        reviewed_at="2026-01-02",
        rating=3,
        duration_ms=1000,
        state_before="{}",
        state_after="{}",
        deleted_at=deleted_at,
    )
    return cid


def _concept(conn: psycopg.Connection[Any], deleted_at: Any = None) -> str:
    return ins(conn, "concept", name="K", status="aktiv", deleted_at=deleted_at)


def _ago(conn: psycopg.Connection[Any], days: int) -> Any:
    row = conn.execute("SELECT now() - make_interval(days => %s)", (days,)).fetchone()
    assert row is not None
    return row[0]


def test_old_card_is_purged_with_state_and_log(
    core: psycopg.Connection[Any], tmp_path: Path
) -> None:
    concept = _concept(core)
    _card(core, concept, _ago(core, 40))
    result = run_nightly(core, tmp_path, MaintenanceNightlyPayload())
    assert result["purged_by_kind"] == {"card": 1}
    assert count(core, "card") == 0
    assert count(core, "card_state") == 0 and count(core, "review_log") == 0
    assert count(core, "concept") == 1


def test_card_within_retention_stays(core: psycopg.Connection[Any], tmp_path: Path) -> None:
    concept = _concept(core)
    _card(core, concept, _ago(core, 5))
    _card(core, concept, None)
    assert run_nightly(core, tmp_path, MaintenanceNightlyPayload())["purged_count"] == 0
    assert count(core, "card") == 2 and count(core, "card_state") == 2
    dry = run_nightly(
        core, tmp_path, MaintenanceNightlyPayload(purge_older_than_days=3, dry_run=True)
    )
    assert dry["purged_by_kind"] == {"card": 1}
    assert count(core, "card") == 2


def test_card_follows_deleted_concept(core: psycopg.Connection[Any], tmp_path: Path) -> None:
    old = _ago(core, 40)
    concept = _concept(core, old)
    _card(core, concept, old)  # gleiches deleted_at: hängt am Konzept, ist keine eigene Wurzel
    assert run_nightly(core, tmp_path, MaintenanceNightlyPayload())["purged_count"] == 0
    assert count(core, "card") == 1 and count(core, "review_log") == 1
    # Karte früher gelöscht als das Konzept: eigene Frist, gelöscht wird nur die Karte
    other = _concept(core, _ago(core, 2))
    _card(core, other, _ago(core, 40))
    result = run_nightly(core, tmp_path, MaintenanceNightlyPayload())
    assert result["purged_by_kind"] == {"card": 1}
    assert count(core, "card") == 1 and count(core, "concept") == 2


def test_card_of_session_proposal(core: psycopg.Connection[Any], tmp_path: Path) -> None:
    """Heute bekommt ein Konzept `deleted_at` nur als Vorschlag oder Hülle mit seiner Session (§20.8)."""
    sem = ins(core, "semester", name="HS")
    mod = ins(core, "module", semester_id=sem, name="DBS", color="mod-01")
    old, new = _ago(core, 40), _ago(core, 2)

    def proposal(deleted_at: Any) -> str:
        s = ins(core, "session", module_id=mod, state="beendet", deleted_at=deleted_at)
        return ins(
            core,
            "concept",
            name="K",
            status="vorschlag",
            proposal_session_id=s,
            deleted_at=deleted_at,
        )

    # Session, Konzept und Karte alt mit demselben deleted_at: die Karte geht über die FKs mit der Session
    _card(core, proposal(old), old)
    # dasselbe innerhalb der Frist: nichts wird gelöscht
    c_new = proposal(new)
    keep = _card(core, c_new, new)
    # Karte alt, Konzept später mit seiner Session gelöscht: nur die Karte (eigene Frist)
    c_later = proposal(new)
    _card(core, c_later, old)
    # aktive Karte an aktivem Konzept
    c_live = _concept(core)
    live = _card(core, c_live, None)
    dry = run_nightly(core, tmp_path, MaintenanceNightlyPayload(dry_run=True))
    res = run_nightly(core, tmp_path, MaintenanceNightlyPayload())
    assert dry["purged_by_kind"] == res["purged_by_kind"] == {"session": 1, "card": 1}
    left = {str(r[0]) for r in core.execute("SELECT id FROM card").fetchall()}
    assert left == {keep, live}
    assert count(core, "card_state") == 2 and count(core, "review_log") == 2
    assert {str(r[0]) for r in core.execute("SELECT id FROM concept").fetchall()} == {
        c_new,
        c_later,
        c_live,
    }
