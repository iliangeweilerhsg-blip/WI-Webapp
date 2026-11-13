"""`maintenance.nightly` (docs/VERTRAEGE.md §13, T1-18).

1. Papierkorb: direkt gelöschte Objekte mit `deleted_at` älter als `purge_older_than_days` (Standard 30)
   samt Teilbaum endgültig löschen, Kinder vor Eltern, danach ihre Dateien.
2. `sync_op`/`sync_stream` der dabei gelöschten Notizbücher und Sessions entfernen.
3. Verwaiste Dateien: Fotos, `.pkdrawing` und Medienordner ohne Zeile (nach 30 Tagen), Fotos mit anderer
   Datei als in der Zeile (HEIC-Waisen) und `*.part` (nach 1 Tag).

Karten (§21.8) sind eigene Wurzeln, solange ihr Konzept nicht mit demselben `deleted_at` im Papierkorb liegt. Dann
hängen sie an dessen Frist (Konzepte sind noch keine Papierkorb-Art, F-BIB-05) und gehen später über den
Fremdschlüssel mit. `card_state` und `review_log` gehen über `ON DELETE CASCADE` mit der Karte.

Spiegelt `services/core/src/services/trash-ops.ts` (`purgeTrashItems`). Sperrreihenfolge wie im Core:
zuerst die Ströme (nach Namen sortiert), dann die Zeilen. Dateien werden erst nach dem Commit gelöscht und nur
über geprüfte Pfade unterhalb von `SG_DATA_DIR`.
"""

from __future__ import annotations

import logging
import re
import shutil
import time
from pathlib import Path
from typing import Any

import psycopg
from sg_schemas.models import MaintenanceNightlyPayload, MaintenanceNightlyResult

from ..registry import JobContext, handler

DEFAULT_RETENTION_DAYS = 30
ORPHAN_NO_ROW_DAYS = 30
PART_DAYS = 1
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")

#: Art -> (Elterntabelle, Fremdschlüssel) für „direkt gelöscht“ (wie PARENT in trash.ts)
PARENT: dict[str, tuple[str, str]] = {
    "module": ("semester", "semester_id"),
    "slide_deck": ("module", "module_id"),
    "exercise_sheet": ("module", "module_id"),
    "session": ("module", "module_id"),
    "notebook": ("module", "module_id"),
    "page": ("notebook", "notebook_id"),
    "marker": ("session", "session_id"),
    "photo": ("session", "session_id"),
    # §21.8: Das Elternobjekt einer Karte ist ihr Konzept (selbst keine Papierkorb-Art, darum nie Wurzel)
    "card": ("concept", "concept_id"),
}
KINDS = [
    "semester",
    "module",
    "slide_deck",
    "exercise_sheet",
    "calendar_source",
    "session",
    "notebook",
    "page",
    "marker",
    "photo",
    "card",
]
#: Löschreihenfolge (Kinder vor Eltern)
DELETE_ORDER = [
    "marker",
    "photo",
    "card",  # card_state und review_log folgen über ON DELETE CASCADE (Migration 0012)
    "page",
    "session",
    "slide_deck",
    "exercise_sheet",
    "notebook",
    "calendar_event",
    "module",
    "semester",
    "calendar_source",
]


def _resolve(data_dir: Path, relative: str) -> Path | None:
    """Wie `resolveDataPath` im Core: nur Pfade unterhalb des Datenordners."""
    root = data_dir.resolve()
    full = (root / relative).resolve()
    return full if str(full).startswith(str(root) + "/") else None


def _direct_condition(kind: str) -> str:
    parts: list[str] = []
    if kind in PARENT:
        parent, fk = PARENT[kind]
        parts.append(
            f"NOT EXISTS (SELECT 1 FROM {parent} p WHERE p.id = t.{fk} AND p.deleted_at = t.deleted_at)"
        )
    if kind == "session":
        parts.append(
            "NOT EXISTS (SELECT 1 FROM calendar_event e WHERE e.id = t.calendar_event_id"
            " AND e.deleted_at = t.deleted_at)"
        )
    return " AND ".join(parts) or "TRUE"


def _ids(conn: psycopg.Connection[Any], sql: str, params: tuple[Any, ...] = ()) -> list[str]:
    return [str(r[0]) for r in conn.execute(sql, params).fetchall()]


def _subtree(conn: psycopg.Connection[Any], roots: list[tuple[str, str]]) -> dict[str, list[str]]:
    t: dict[str, list[str]] = {
        k: []
        for k in [
            "semester",
            "module",
            "slide_deck",
            "exercise_sheet",
            "session",
            "notebook",
            "page",
            "marker",
            "photo",
            "card",
            "calendar_source",
            "calendar_event",
        ]
    }

    def add(key: str, ids: list[str]) -> None:
        for i in ids:
            if i not in t[key]:
                t[key].append(i)

    for kind, rid in roots:
        add(kind, [rid])
    if t["semester"]:
        add(
            "module",
            _ids(
                conn, "SELECT id FROM module WHERE semester_id = ANY(%s::uuid[])", (t["semester"],)
            ),
        )
    if t["module"]:
        m = (t["module"],)
        add(
            "slide_deck",
            _ids(conn, "SELECT id FROM slide_deck WHERE module_id = ANY(%s::uuid[])", m),
        )
        add(
            "exercise_sheet",
            _ids(conn, "SELECT id FROM exercise_sheet WHERE module_id = ANY(%s::uuid[])", m),
        )
        add("session", _ids(conn, "SELECT id FROM session WHERE module_id = ANY(%s::uuid[])", m))
        add("notebook", _ids(conn, "SELECT id FROM notebook WHERE module_id = ANY(%s::uuid[])", m))
    if t["calendar_source"]:
        add(
            "calendar_event",
            _ids(
                conn,
                "SELECT id FROM calendar_event WHERE source_id = ANY(%s::uuid[])",
                (t["calendar_source"],),
            ),
        )
    if t["calendar_event"]:
        add(
            "session",
            _ids(
                conn,
                "SELECT s.id FROM session s JOIN calendar_event e ON e.id = s.calendar_event_id"
                " WHERE e.id = ANY(%s::uuid[]) AND s.deleted_at IS NOT NULL AND s.deleted_at = e.deleted_at"
                " AND s.state IN ('geplant','bereit','verpasst')",
                (t["calendar_event"],),
            ),
        )
    if t["notebook"]:
        add(
            "page",
            _ids(conn, "SELECT id FROM page WHERE notebook_id = ANY(%s::uuid[])", (t["notebook"],)),
        )
    if t["session"]:
        s = (t["session"],)
        add("marker", _ids(conn, "SELECT id FROM marker WHERE session_id = ANY(%s::uuid[])", s))
        add("photo", _ids(conn, "SELECT id FROM photo WHERE session_id = ANY(%s::uuid[])", s))
    return t


def _files(conn: psycopg.Connection[Any], t: dict[str, list[str]]) -> set[str]:
    files: set[str] = set()

    def col(sql: str, ids: list[str]) -> None:
        if not ids:
            return
        for (p,) in conn.execute(sql, (ids,)).fetchall():
            if p:
                files.add(str(p))

    recordings = (
        _ids(conn, "SELECT id FROM recording WHERE session_id = ANY(%s::uuid[])", (t["session"],))
        if t["session"]
        else []
    )
    files.update(f"media/decks/{i}" for i in t["slide_deck"])
    files.update(f"media/sheets/{i}" for i in t["exercise_sheet"])
    files.update(f"media/recordings/{i}" for i in recordings)
    col("SELECT file_path FROM slide_deck WHERE id = ANY(%s::uuid[])", t["slide_deck"])
    if t["slide_deck"]:
        for sql in (
            "SELECT image_path FROM slide WHERE deck_id = ANY(%s::uuid[])",
            "SELECT thumb_path FROM slide WHERE deck_id = ANY(%s::uuid[])",
        ):
            col(sql, t["slide_deck"])
    col("SELECT file_path FROM exercise_sheet WHERE id = ANY(%s::uuid[])", t["exercise_sheet"])
    col(
        "SELECT solution_file_path FROM exercise_sheet WHERE id = ANY(%s::uuid[])",
        t["exercise_sheet"],
    )
    col("SELECT file_path FROM audio_chunk WHERE recording_id = ANY(%s::uuid[])", recordings)
    col("SELECT file_path FROM photo WHERE id = ANY(%s::uuid[])", t["photo"])
    for i in t["photo"]:
        files.update((f"media/photos/{i}.heic", f"media/photos/{i}.jpg"))
    col("SELECT pkdrawing_path FROM page WHERE id = ANY(%s::uuid[])", t["page"])
    files.update(f"media/pages/{i}.pkdrawing" for i in t["page"])
    return files


def _lock_streams(conn: psycopg.Connection[Any], t: dict[str, list[str]]) -> list[str]:
    streams = sorted(
        [f"notebook:{i}" for i in t["notebook"]] + [f"session:{i}" for i in t["session"]]
    )
    for s in streams:
        conn.execute(
            "INSERT INTO sync_stream (stream, head_seq) VALUES (%s, 0) ON CONFLICT DO NOTHING", (s,)
        )
    if streams:
        conn.execute(
            "SELECT stream FROM sync_stream WHERE stream = ANY(%s) ORDER BY stream FOR UPDATE",
            (streams,),
        )
    return streams


class SkipRoot(Exception):
    """Wurzel wird in diesem Lauf nicht gelöscht (Grund steht in der Meldung)."""


def purge_roots(
    conn: psycopg.Connection[Any],
    roots: list[tuple[str, str]],
    *,
    dry_run: bool,
    days: int = DEFAULT_RETENTION_DAYS,
) -> tuple[dict[str, int], set[str], int]:
    """Teilbaum der Wurzeln löschen. Rückgabe: Zeilen je Tabelle, Dateien, entfernte sync_op.

    Muss in einer eigenen Transaktion laufen. Reihenfolge der Sperren: Ströme, dann die Wurzelzeilen (mit
    erneuter Prüfung, dass sie noch im Papierkorb und alt genug sind). Wurde eine Wurzel inzwischen
    wiederhergestellt, wird sie übersprungen (`SkipRoot`).
    """
    t = _subtree(conn, roots)
    streams = [f"notebook:{i}" for i in t["notebook"]] + [f"session:{i}" for i in t["session"]]
    ops = 0
    if streams:
        row = conn.execute(
            "SELECT count(*) FROM sync_op WHERE stream = ANY(%s)", (streams,)
        ).fetchone()
        ops = int(row[0]) if row else 0
    by_kind = {k: len(t[k]) for k in DELETE_ORDER if t.get(k)}
    if dry_run:
        return by_kind, set(), ops
    _lock_streams(conn, t)
    for kind, rid in roots:
        row = conn.execute(
            f"SELECT 1 FROM {kind} WHERE id = %s AND deleted_at IS NOT NULL"
            " AND deleted_at < now() - make_interval(days => %s) FOR UPDATE",
            (rid, days),
        ).fetchone()
        if row is None:
            raise SkipRoot(f"{kind} {rid} liegt nicht mehr (lange genug) im Papierkorb")
    t = _subtree(conn, roots)  # unter der Sperre erneut lesen
    files = _files(conn, t)
    active = conn.execute(
        "SELECT count(*) FROM session WHERE id = ANY(%s::uuid[]) AND state IN ('laeuft','pausiert')",
        (t["session"],),
    ).fetchone()
    if active and int(active[0]) > 0:
        raise SkipRoot("aktive Session im Teilbaum")
    if streams:
        conn.execute(
            "DELETE FROM sync_stream WHERE stream = ANY(%s)",
            ([*[f"notebook:{i}" for i in t["notebook"]], *[f"session:{i}" for i in t["session"]]],),
        )
    counted: dict[str, int] = {}
    for table in DELETE_ORDER:
        ids = t.get(table) or []
        if not ids:
            continue
        cur = conn.execute(f"DELETE FROM {table} WHERE id = ANY(%s::uuid[])", (ids,))
        if cur.rowcount:
            counted[table] = cur.rowcount
    return counted, files, ops


def _find_roots(conn: psycopg.Connection[Any], days: int) -> list[tuple[str, str]]:
    roots: list[tuple[str, str]] = []
    for kind in KINDS:
        rows = conn.execute(
            f"SELECT t.id FROM {kind} t WHERE t.deleted_at IS NOT NULL"
            f" AND t.deleted_at < now() - make_interval(days => %s) AND {_direct_condition(kind)}",
            (days,),
        ).fetchall()
        roots.extend((kind, str(r[0])) for r in rows)
    return roots


def _remove(data_dir: Path, relative: str) -> bool:
    full = _resolve(data_dir, relative)
    if full is None or not full.exists():
        return False
    if full.is_dir():
        shutil.rmtree(full, ignore_errors=True)
    else:
        full.unlink(missing_ok=True)
    return True


def _older(path: Path, days: float, now: float) -> bool:
    try:
        return now - path.stat().st_mtime > days * 86400
    except OSError:
        return False


def sweep_orphans(
    conn: psycopg.Connection[Any], data_dir: Path, *, dry_run: bool, now: float | None = None
) -> int:
    """Verwaiste Dateien entfernen (VERTRAEGE §13). Rückgabe: Anzahl."""
    now = time.time() if now is None else now
    media = data_dir / "media"
    removed = 0

    def drop(path: Path) -> None:
        nonlocal removed
        removed += 1
        if dry_run:
            return
        if path.is_dir():
            shutil.rmtree(path, ignore_errors=True)
        else:
            path.unlink(missing_ok=True)

    photos = media / "photos"
    if photos.is_dir():
        rows = {str(r[0]): r[1] for r in conn.execute("SELECT id, file_path FROM photo").fetchall()}
        for f in photos.iterdir():
            m = re.fullmatch(r"([0-9a-f-]{36})\.(heic|jpg)", f.name)
            if not m or not UUID_RE.match(m.group(1)) or not f.is_file():
                continue
            row_path = rows.get(m.group(1))
            if m.group(1) not in rows:
                if _older(f, ORPHAN_NO_ROW_DAYS, now):
                    drop(f)
            elif row_path and row_path != f"media/photos/{f.name}" and _older(f, PART_DAYS, now):
                drop(f)  # HEIC-Waise: die Zeile verweist auf eine andere Datei

    pages = media / "pages"
    if pages.is_dir():
        known = {str(r[0]) for r in conn.execute("SELECT id FROM page").fetchall()}
        for f in pages.iterdir():
            m = re.fullmatch(r"([0-9a-f-]{36})\.pkdrawing", f.name)
            if m and m.group(1) not in known and f.is_file() and _older(f, ORPHAN_NO_ROW_DAYS, now):
                drop(f)

    for sub, table in (
        ("decks", "slide_deck"),
        ("sheets", "exercise_sheet"),
        ("recordings", "recording"),
    ):
        base = media / sub
        if not base.is_dir():
            continue
        known = {str(r[0]) for r in conn.execute(f"SELECT id FROM {table}").fetchall()}
        for d in base.iterdir():
            if (
                d.is_dir()
                and UUID_RE.match(d.name)
                and d.name not in known
                and _older(d, ORPHAN_NO_ROW_DAYS, now)
            ):
                drop(d)

    if media.is_dir():
        for f in media.rglob("*.part"):
            if f.is_file() and _older(f, PART_DAYS, now):
                drop(f)
    return removed


def run_nightly(
    conn: psycopg.Connection[Any],
    data_dir: Path,
    payload: MaintenanceNightlyPayload,
    logger: logging.Logger | None = None,
) -> dict[str, Any]:
    started = time.monotonic()
    log = logger or logging.getLogger(__name__)
    days = payload.purge_older_than_days or DEFAULT_RETENTION_DAYS
    dry = bool(payload.dry_run)
    by_kind: dict[str, int] = {}
    sync_ops = 0
    for root in _find_roots(conn, days):
        # Eine Transaktion pro Wurzel: Fehler, Deadlocks und Stromsperren bleiben auf sie beschränkt
        try:
            with conn.transaction():
                counted, files, ops = purge_roots(conn, [root], dry_run=dry, days=days)
        except SkipRoot as skip:
            log.warning("maintenance.nightly: %s übersprungen: %s", root[0], skip)
            continue
        except (psycopg.errors.ForeignKeyViolation, psycopg.errors.DeadlockDetected) as exc:
            log.warning(
                "maintenance.nightly: %s %s übersprungen: %s", root[0], root[1], type(exc).__name__
            )
            continue
        for k, n in counted.items():
            by_kind[k] = by_kind.get(k, 0) + n
        sync_ops += ops
        if not dry:  # Dateien erst nach dem Commit der Wurzel
            for relative in sorted(files):
                _remove(data_dir, relative)
    orphans = sweep_orphans(conn, data_dir, dry_run=dry)
    result = MaintenanceNightlyResult(
        purged_count=sum(by_kind.values()),
        purged_by_kind=by_kind,  # type: ignore[arg-type]
        orphan_files_removed=orphans,
        sync_ops_removed=sync_ops,
        job_duration_ms=int((time.monotonic() - started) * 1000),
    )
    return result.model_dump(mode="json")


@handler("maintenance.nightly", payload_type=MaintenanceNightlyPayload)
def maintenance_nightly(payload: MaintenanceNightlyPayload, ctx: JobContext) -> dict[str, Any]:
    result = run_nightly(ctx.conn, ctx.data_dir, payload, ctx.logger)
    ctx.logger.info("maintenance.nightly: %s", result)
    return result
