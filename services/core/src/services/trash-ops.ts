// Papierkorb: Liste, Löschen mit Server-Operationen, Wiederherstellen mit Server-Operationen, endgültiges
// Löschen (F-DAT-04, VERTRAEGE §7.5, §13, §16.2). T1-18.
//
// Sperrreihenfolge (§16.2): zuerst die Ströme (`sync_stream`, nach Namen sortiert), dann advisory Locks der Fotos,
// dann die Fachzeilen. `softDelete` und `restoreFromTrash` (trash.ts) sperren nur Zeilen und brauchen darum
// diese Hülle, sobald die Kaskade Notizbücher oder Sessions berührt: Ein Op-Handler hält den Strom und will
// danach Zeilen sperren. Sperrten wir zuerst Zeilen und dann den Strom, könnten beide aufeinander warten.
import { rm } from 'node:fs/promises';
import { sql, type SQL } from 'drizzle-orm';
import type { TrashItem, TrashKind, TrashList, TrashParent, TrashRestoreResult } from '@sg/shared';
import type { Db, DbOrTx, Tx } from '../db/client.ts';
import { HttpError } from '../errors.ts';
import { decodeCursor, encodeCursor, type CursorKey } from '../lib/pagination.ts';
import { appendOp } from '../sync/append.ts';
import { resolveDataPath } from './material.ts';
import { CHILDREN, PARENT, restoreFromTrash, softDelete, TITLE, TRASH_KINDS, type Node } from './trash.ts';

/** Aufbewahrung im Papierkorb in Tagen (F-DAT-04). Der Worker (`maintenance.nightly`) nutzt denselben Standard */
export const TRASH_RETENTION_DAYS = 30;

const notebookStream = (id: string) => `notebook:${id}`;
const sessionStream = (id: string) => `session:${id}`;

type Mode = { op: 'delete' } | { op: 'restore'; ts: string };

const deletedMatch = (mode: Mode, column = sql`deleted_at`): SQL =>
  mode.op === 'delete' ? sql`${column} IS NULL` : sql`${column} = ${mode.ts}::timestamptz`;

// ---------------------------------------------------------------------------------------------
// Sperren
// ---------------------------------------------------------------------------------------------

/** Dieselbe Sperre wie `lockSemesters` in organisation.ts (`is_current` ändert sich nur unter ihr) */
const SEMESTER_LOCK_KEY = 70070001;
async function lockSemesters(tx: Tx): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${SEMESTER_LOCK_KEY})`);
}

/**
 * Sperrt die Ströme in fester Reihenfolge (nach Namen). Legt fehlende Stromzeilen an, wie `appendOp`.
 * Die Sperre gilt bis zum Ende der Transaktion.
 */
export async function lockStreams(tx: Tx, streams: Iterable<string>): Promise<void> {
  const sorted = [...new Set(streams)].sort();
  if (sorted.length === 0) return;
  for (const stream of sorted) {
    await tx.execute(
      sql`INSERT INTO sync_stream (stream, head_seq) VALUES (${stream}, 0) ON CONFLICT DO NOTHING`,
    );
  }
  // Gleiche Reihenfolge wie oben, damit zwei Transaktionen mit überlappenden Mengen nicht kreuzen
  await tx.execute(
    sql`SELECT stream FROM sync_stream WHERE stream IN (${sql.join(
      sorted.map((s) => sql`${s}`),
      sql`, `,
    )}) ORDER BY stream FOR UPDATE`,
  );
}

interface Affected {
  notebooks: string[];
  sessions: string[];
}

/**
 * Notizbücher und Sessions, die die Kaskade von `kind`/`id` berührt (nur Zeilen, die zum Modus passen:
 * beim Löschen die noch aktiven, beim Wiederherstellen die mit genau diesem `deleted_at`).
 * Reine Lesezugriffe, ohne Sperren.
 */
async function affectedBy(tx: DbOrTx, kind: TrashKind, id: string, mode: Mode): Promise<Affected> {
  const ids = async (query: SQL): Promise<string[]> =>
    (await tx.execute<{ id: string }>(query)).map((r) => r.id);
  const match = (alias: string) => deletedMatch(mode, sql.raw(`${alias}.deleted_at`));

  switch (kind) {
    case 'notebook':
      return { notebooks: [id], sessions: [] };
    case 'page':
      return {
        notebooks: await ids(sql`SELECT notebook_id AS id FROM page WHERE id = ${id}`),
        sessions: [],
      };
    case 'session':
      return { notebooks: [], sessions: [id] };
    case 'marker':
    case 'photo':
      return {
        notebooks: [],
        sessions: await ids(sql`SELECT session_id AS id FROM ${sql.identifier(kind)} WHERE id = ${id}`),
      };
    case 'semester':
    case 'module': {
      const moduleFilter =
        kind === 'module' ? sql`m.id = ${id}` : sql`m.semester_id = ${id} AND ${match('m')}`;
      return {
        notebooks: await ids(
          sql`SELECT n.id FROM notebook n JOIN module m ON m.id = n.module_id
              WHERE ${moduleFilter} AND ${match('n')}`,
        ),
        sessions: await ids(
          sql`SELECT s.id FROM session s JOIN module m ON m.id = s.module_id
              WHERE ${moduleFilter} AND ${match('s')}`,
        ),
      };
    }
    case 'calendar_source':
      return {
        notebooks: [],
        sessions: await ids(
          sql`SELECT s.id FROM session s JOIN calendar_event e ON e.id = s.calendar_event_id
              WHERE e.source_id = ${id} AND ${match('s')}`,
        ),
      };
    default:
      return { notebooks: [], sessions: [] };
  }
}

/** Sperrt die Ströme der betroffenen Notizbücher und Sessions und gibt sie zurück (Strom vor Zeile) */
async function lockAffected(tx: Tx, kind: TrashKind, id: string, mode: Mode): Promise<Affected> {
  const locked = new Set<string>();
  let affected: Affected = { notebooks: [], sessions: [] };
  // Nach dem Sperren neu lesen: Zwischendurch angelegte Notizbücher/Sessions kommen noch dazu
  for (let round = 0; round < 3; round += 1) {
    affected = await affectedBy(tx, kind, id, mode);
    const streams = [...affected.notebooks.map(notebookStream), ...affected.sessions.map(sessionStream)];
    const fresh = streams.filter((s) => !locked.has(s));
    if (fresh.length === 0) break;
    await lockStreams(tx, fresh);
    for (const s of fresh) locked.add(s);
  }
  return affected;
}

async function appendServerOp(
  tx: Tx,
  notebookId: string,
  kind: 'notebook.delete' | 'notebook.restore' | 'page.restore',
  data: Record<string, string>,
): Promise<void> {
  await appendOp(tx, notebookStream(notebookId), {
    kind,
    data,
    at: Date.now(),
    clockUncertain: false,
    origin: 'server',
  });
}

// ---------------------------------------------------------------------------------------------
// Löschen (Lösch-Routen aus Phase 0 und die Papierkorb-Kaskade)
// ---------------------------------------------------------------------------------------------

/**
 * Weich löschen mit Kaskade (`softDelete`), dazu: Ströme vorher sperren und für jedes mitgelöschte Notizbuch
 * `notebook.delete` in dessen Strom schreiben (Clients blenden es aus). Für `notebook` selbst schreibt
 * `deleteNotebook` (notebooks.ts) die Operation.
 */
export async function softDeleteWithOps(
  db: Db,
  kind: TrashKind,
  id: string,
  /** Läuft zuerst in der Transaktion, z. B. die Semester-Sperre (organisation.ts) */
  before?: (tx: Tx) => Promise<void>,
): Promise<Date> {
  return db.transaction(async (tx) => {
    if (before) await before(tx);
    const affected = await lockAffected(tx, kind, id, { op: 'delete' });
    const ts = await softDelete(tx, kind, id);
    if (kind !== 'notebook') {
      for (const notebookId of affected.notebooks) {
        await appendServerOp(tx, notebookId, 'notebook.delete', { notebook_id: notebookId });
      }
    }
    return ts;
  });
}

// ---------------------------------------------------------------------------------------------
// Wiederherstellen
// ---------------------------------------------------------------------------------------------

type TrashRow = { kind: TrashKind; ts: string };

async function findTrashRow(tx: DbOrTx, id: string): Promise<TrashRow> {
  const lookup = sql.join(
    TRASH_KINDS.map(
      (kind) =>
        sql`SELECT ${kind}::text AS kind, deleted_at::text AS ts FROM ${sql.identifier(kind)}
            WHERE id = ${id} AND deleted_at IS NOT NULL`,
    ),
    sql` UNION ALL `,
  );
  const [found] = await tx.execute<TrashRow>(lookup);
  if (!found) throw new HttpError(404, 'trash_item_not_found', 'Dieses Objekt liegt nicht im Papierkorb.');
  return found;
}

/**
 * Eine Session, die mit ihrer Kalenderquelle gelöscht wurde, hat die Quelle (über den Termin) als Elternobjekt
 * (VERTRAEGE §13, Entscheidung T1-18). `restoreFromTrash` prüft nur das Modul. Hier die Quelle zusätzlich:
 * Liegt der Termin der Session mit gleichem `deleted_at` im Papierkorb, kommt sie nur über die Quelle zurück.
 */
async function sessionParentSource(tx: DbOrTx, id: string, ts: string): Promise<TrashParent | null> {
  const [row] = await tx.execute<{ id: string; title: string }>(
    sql`SELECT cs.id, cs.name AS title
        FROM session s
        JOIN calendar_event e ON e.id = s.calendar_event_id AND e.deleted_at = s.deleted_at
        JOIN calendar_source cs ON cs.id = e.source_id AND cs.deleted_at = s.deleted_at
        WHERE s.id = ${id} AND s.deleted_at = ${ts}::timestamptz`,
  );
  return row ? { id: row.id, kind: 'calendar_source', title: row.title } : null;
}

/**
 * `POST /trash/{id}/restore`: `restoreFromTrash` mit vorher gesperrten Strömen. Danach `notebook.restore` für jedes
 * wiederhergestellte Notizbuch (auch bei Modul und Semester) bzw. `page.restore` für eine einzelne Seite.
 *
 * Fehler: 404 `trash_item_not_found`, 409 `restore_parent_deleted`, 409 `restore_conflict`.
 */
export async function restoreWithOps(db: Db, id: string): Promise<TrashRestoreResult> {
  return db.transaction(async (tx) => {
    const { kind, ts } = await findTrashRow(tx, id);
    if (kind === 'semester') await lockSemesters(tx);
    if (kind === 'session') {
      const source = await sessionParentSource(tx, id, ts);
      if (source) {
        throw new HttpError(
          409,
          'restore_parent_deleted',
          'Die Session wurde mit ihrer Kalenderquelle gelöscht. Stelle zuerst die Quelle wieder her.',
          { parent: source },
        );
      }
    }
    const affected = await lockAffected(tx, kind, id, { op: 'restore', ts });
    const result = await restoreFromTrash(tx, id);
    if (kind === 'page') {
      for (const notebookId of affected.notebooks) {
        await appendServerOp(tx, notebookId, 'page.restore', { page_id: id });
      }
    } else {
      for (const notebookId of affected.notebooks) {
        await appendServerOp(tx, notebookId, 'notebook.restore', { notebook_id: notebookId });
      }
    }
    return result;
  });
}

// ---------------------------------------------------------------------------------------------
// Liste
// ---------------------------------------------------------------------------------------------

/**
 * Bedingung „direkt gelöscht“ für Tabelle `t`: Das Elternobjekt wurde nicht mit demselben Zeitstempel gelöscht
 * (VERTRAEGE §13). Sessions haben zwei mögliche Eltern: das Modul und, bei nie gestarteten Terminen, die
 * Kalenderquelle über den Termin (Entscheidung T1-18).
 */
function isDirect(kind: TrashKind): SQL {
  const parts: SQL[] = [];
  const parent = PARENT[kind];
  if (parent) {
    parts.push(
      sql`NOT EXISTS (SELECT 1 FROM ${sql.identifier(parent.kind)} p
                      WHERE p.id = t.${sql.identifier(parent.fk)} AND p.deleted_at = t.deleted_at)`,
    );
  }
  if (kind === 'session') {
    parts.push(
      sql`NOT EXISTS (SELECT 1 FROM calendar_event e
                      WHERE e.id = t.calendar_event_id AND e.deleted_at = t.deleted_at)`,
    );
  }
  return parts.length > 0 ? sql.join(parts, sql` AND `) : sql`TRUE`;
}

/** Anzahl der mit `ts` mitgelöschten abhängigen Objekte (Kaskade aus trash.ts, ohne die Wurzel) */
async function countDependents(tx: DbOrTx, kind: TrashKind, id: string, ts: string): Promise<number> {
  let total = 0;
  let level: { node: Node; ids: string[] }[] = [{ node: kind, ids: [id] }];
  while (level.length > 0) {
    const next: { node: Node; ids: string[] }[] = [];
    for (const { node, ids } of level) {
      for (const edge of CHILDREN[node]) {
        if (ids.length === 0) continue;
        const rows = await tx.execute<{ id: string }>(
          sql`SELECT id FROM ${sql.identifier(edge.child)}
              WHERE ${sql.identifier(edge.fk)} IN (${sql.join(
                ids.map((i) => sql`${i}`),
                sql`, `,
              )}) AND deleted_at = ${ts}::timestamptz`,
        );
        total += rows.length;
        if (rows.length > 0) next.push({ node: edge.child, ids: rows.map((r) => r.id) });
      }
    }
    level = next;
  }
  return total;
}

export interface ListTrashOptions {
  kind?: TrashKind | undefined;
  cursor?: string | undefined;
  limit: number;
}

/** `GET /trash`: direkt gelöschte Objekte, nach `deleted_at` absteigend (Cursor über `(deleted_at, id)`) */
export async function listTrash(db: DbOrTx, options: ListTrashOptions): Promise<TrashList> {
  const kinds = options.kind ? [options.kind] : TRASH_KINDS;
  const selects = kinds.map((kind) => {
    const parent = PARENT[kind];
    const parentCols = parent
      ? sql`(SELECT p.id FROM ${sql.identifier(parent.kind)} p WHERE p.id = t.${sql.identifier(parent.fk)}) AS parent_id,
            (SELECT ${TITLE[parent.kind]} FROM ${sql.identifier(parent.kind)} WHERE id = t.${sql.identifier(parent.fk)}) AS parent_title`
      : sql`NULL::uuid AS parent_id, NULL::text AS parent_title`;
    return sql`SELECT ${kind}::text AS kind, t.id, ${TITLE[kind]} AS title, t.deleted_at,
                      to_char(t.deleted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS deleted_iso,
                      t.deleted_at::text AS ts, ${parentCols}
               FROM ${sql.identifier(kind)} t
               WHERE t.deleted_at IS NOT NULL AND ${isDirect(kind)}`;
  });
  const cursor: CursorKey | undefined = options.cursor ? decodeCursor(options.cursor) : undefined;
  const rows = await db.execute<{
    kind: TrashKind;
    id: string;
    title: string;
    deleted_iso: string;
    ts: string;
    parent_id: string | null;
    parent_title: string | null;
  }>(
    sql`SELECT * FROM (${sql.join(selects, sql` UNION ALL `)}) u
        ${cursor ? sql`WHERE (u.deleted_at, u.id) < (${cursor.ts}::timestamptz, ${cursor.id}::uuid)` : sql``}
        ORDER BY u.deleted_at DESC, u.id DESC
        LIMIT ${options.limit + 1}`,
  );
  const visible = rows.slice(0, options.limit);
  const items: TrashItem[] = [];
  for (const row of visible) {
    const parentKind = PARENT[row.kind]?.kind;
    const deletedAt = new Date(row.deleted_iso);
    items.push({
      id: row.id,
      kind: row.kind,
      title: row.title,
      deleted_at: deletedAt.toISOString(),
      purge_at: new Date(deletedAt.getTime() + TRASH_RETENTION_DAYS * 86_400_000).toISOString(),
      parent:
        row.parent_id && parentKind
          ? { id: row.parent_id, kind: parentKind, title: row.parent_title ?? '' }
          : null,
      dependent_count: await countDependents(db, row.kind, row.id, row.ts),
    });
  }
  const last = visible.at(-1);
  return {
    items,
    next_cursor: rows.length > options.limit && last ? encodeCursor({ ts: last.ts, id: last.id }) : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Endgültig löschen
// ---------------------------------------------------------------------------------------------

interface Subtree {
  semesters: string[];
  modules: string[];
  decks: string[];
  sheets: string[];
  sessions: string[];
  notebooks: string[];
  pages: string[];
  markers: string[];
  photos: string[];
  sources: string[];
  events: string[];
}

const emptySubtree = (): Subtree => ({
  semesters: [],
  modules: [],
  decks: [],
  sheets: [],
  sessions: [],
  notebooks: [],
  pages: [],
  markers: [],
  photos: [],
  sources: [],
  events: [],
});

const idList = (ids: string[]): SQL =>
  sql.join(
    ids.map((i) => sql`${i}`),
    sql`, `,
  );

/**
 * Alle Zeilen unterhalb der Wurzeln, unabhängig von `deleted_at` (die Eltern sind weg, die Kinder damit unerreichbar).
 * Ausnahme: Sessions einer Kalenderquelle nur, wenn sie mit der Quelle gelöscht wurden. Gestartete Sessions
 * bleiben (ihr Termin-Verweis wird durch den Fremdschlüssel `SET NULL`).
 */
async function collectSubtree(tx: DbOrTx, roots: { kind: TrashKind; id: string }[]): Promise<Subtree> {
  const tree = emptySubtree();
  const add = (list: string[], ids: string[]) => {
    for (const id of ids) if (!list.includes(id)) list.push(id);
  };
  const query = async (q: SQL) => (await tx.execute<{ id: string }>(q)).map((r) => r.id);
  for (const { kind, id } of roots) {
    switch (kind) {
      case 'semester':
        add(tree.semesters, [id]);
        break;
      case 'module':
        add(tree.modules, [id]);
        break;
      case 'slide_deck':
        add(tree.decks, [id]);
        break;
      case 'exercise_sheet':
        add(tree.sheets, [id]);
        break;
      case 'calendar_source':
        add(tree.sources, [id]);
        break;
      case 'session':
        add(tree.sessions, [id]);
        break;
      case 'notebook':
        add(tree.notebooks, [id]);
        break;
      case 'page':
        add(tree.pages, [id]);
        break;
      case 'marker':
        add(tree.markers, [id]);
        break;
      case 'photo':
        add(tree.photos, [id]);
        break;
    }
  }
  if (tree.semesters.length > 0) {
    add(
      tree.modules,
      await query(sql`SELECT id FROM module WHERE semester_id IN (${idList(tree.semesters)})`),
    );
  }
  if (tree.modules.length > 0) {
    const m = idList(tree.modules);
    add(tree.decks, await query(sql`SELECT id FROM slide_deck WHERE module_id IN (${m})`));
    add(tree.sheets, await query(sql`SELECT id FROM exercise_sheet WHERE module_id IN (${m})`));
    add(tree.sessions, await query(sql`SELECT id FROM session WHERE module_id IN (${m})`));
    add(tree.notebooks, await query(sql`SELECT id FROM notebook WHERE module_id IN (${m})`));
  }
  if (tree.sources.length > 0) {
    add(
      tree.events,
      await query(sql`SELECT id FROM calendar_event WHERE source_id IN (${idList(tree.sources)})`),
    );
  }
  if (tree.events.length > 0) {
    add(
      tree.sessions,
      await query(
        sql`SELECT s.id FROM session s JOIN calendar_event e ON e.id = s.calendar_event_id
            WHERE e.id IN (${idList(tree.events)}) AND s.deleted_at IS NOT NULL
              AND s.deleted_at = e.deleted_at AND s.state IN ('geplant','bereit','verpasst')`,
      ),
    );
  }
  if (tree.notebooks.length > 0) {
    add(tree.pages, await query(sql`SELECT id FROM page WHERE notebook_id IN (${idList(tree.notebooks)})`));
  }
  if (tree.sessions.length > 0) {
    const s = idList(tree.sessions);
    add(tree.markers, await query(sql`SELECT id FROM marker WHERE session_id IN (${s})`));
    add(tree.photos, await query(sql`SELECT id FROM photo WHERE session_id IN (${s})`));
  }
  return tree;
}

/** Relative Pfade der Dateien, die zum Teilbaum gehören (Spalten aus der DB plus die Ablage nach VERTRAEGE §4) */
async function collectFiles(tx: DbOrTx, tree: Subtree): Promise<string[]> {
  const files = new Set<string>();
  const column = async (q: SQL) => {
    for (const row of await tx.execute<{ p: string | null }>(q)) if (row.p) files.add(row.p);
  };
  const recordings: string[] = [];
  if (tree.sessions.length > 0) {
    recordings.push(
      ...(
        await tx.execute<{ id: string }>(
          sql`SELECT id FROM recording WHERE session_id IN (${idList(tree.sessions)})`,
        )
      ).map((r) => r.id),
    );
  }
  for (const id of tree.decks) files.add(`media/decks/${id}`);
  for (const id of tree.sheets) files.add(`media/sheets/${id}`);
  for (const id of recordings) files.add(`media/recordings/${id}`);
  if (tree.decks.length > 0) {
    await column(sql`SELECT file_path AS p FROM slide_deck WHERE id IN (${idList(tree.decks)})`);
    await column(
      sql`SELECT image_path AS p FROM slide WHERE deck_id IN (${idList(tree.decks)})
          UNION ALL SELECT thumb_path FROM slide WHERE deck_id IN (${idList(tree.decks)})`,
    );
  }
  if (tree.sheets.length > 0) {
    await column(
      sql`SELECT file_path AS p FROM exercise_sheet WHERE id IN (${idList(tree.sheets)})
          UNION ALL SELECT solution_file_path FROM exercise_sheet WHERE id IN (${idList(tree.sheets)})`,
    );
  }
  if (recordings.length > 0) {
    await column(sql`SELECT file_path AS p FROM audio_chunk WHERE recording_id IN (${idList(recordings)})`);
  }
  if (tree.photos.length > 0) {
    await column(sql`SELECT file_path AS p FROM photo WHERE id IN (${idList(tree.photos)})`);
  }
  // Foto-Dateien liegen nach Typ unter .heic bzw. .jpg (VERTRAEGE §4). Beide Namen entfernen schadet nicht
  for (const id of tree.photos) {
    files.add(`media/photos/${id}.heic`);
    files.add(`media/photos/${id}.jpg`);
  }
  if (tree.pages.length > 0) {
    await column(sql`SELECT pkdrawing_path AS p FROM page WHERE id IN (${idList(tree.pages)})`);
  }
  for (const id of tree.pages) files.add(`media/pages/${id}.pkdrawing`);
  return [...files];
}

export interface PurgeResult {
  /** Gelöschte Zeilen je Tabelle */
  byKind: Record<string, number>;
  filesRemoved: number;
  syncOpsRemoved: number;
}

type PurgeTable =
  | 'marker'
  | 'photo'
  | 'page'
  | 'session'
  | 'slide_deck'
  | 'exercise_sheet'
  | 'notebook'
  | 'calendar_event'
  | 'module'
  | 'semester'
  | 'calendar_source';

/**
 * Löscht die Teilbäume der Wurzeln endgültig (Zeilen, Ströme `sync_op`/`sync_stream` der Notizbücher und
 * Sessions) und danach ihre Dateien (nur über `resolveDataPath`). Die Dateien gehen erst nach dem Commit weg,
 * damit kein Verweis ins Leere zeigt. Reihenfolge der Sperren: Ströme, Fotos, Zeilen.
 *
 * Fehler: 409 `session_active`, wenn eine Session im Teilbaum läuft oder pausiert ist.
 */
export async function purgeTrashItems(
  db: Db,
  dataDir: string,
  roots: { kind: TrashKind; id: string }[],
): Promise<PurgeResult> {
  if (roots.length === 0) return { byKind: {}, filesRemoved: 0, syncOpsRemoved: 0 };
  const outcome = await db.transaction(async (tx) => {
    // 1. Teilbaum lesen, Ströme sperren, Teilbaum unter der Sperre erneut lesen
    const locked = new Set<string>();
    let tree = emptySubtree();
    for (let round = 0; round < 3; round += 1) {
      tree = await collectSubtree(tx, roots);
      const streams = [...tree.notebooks.map(notebookStream), ...tree.sessions.map(sessionStream)];
      const fresh = streams.filter((s) => !locked.has(s));
      if (fresh.length === 0) break;
      await lockStreams(tx, fresh);
      for (const s of fresh) locked.add(s);
    }
    // 2. Foto-Sperren (wie lockPhoto in photos.ts), nach Schlüssel sortiert
    for (const photoId of [...tree.photos].sort()) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`photo:${photoId}`}, 0))`);
    }
    // 3. Zeilen der Wurzeln sperren und prüfen, dass sie noch im Papierkorb liegen
    for (const { kind, id } of roots) {
      const [row] = await tx.execute<{ id: string }>(
        sql`SELECT id FROM ${sql.identifier(kind)} WHERE id = ${id} AND deleted_at IS NOT NULL FOR UPDATE`,
      );
      if (!row) throw new HttpError(404, 'trash_item_not_found', 'Dieses Objekt liegt nicht im Papierkorb.');
    }
    if (tree.sessions.length > 0) {
      const active = await tx.execute<{ id: string }>(
        sql`SELECT id FROM session WHERE id IN (${idList(tree.sessions)}) AND state IN ('laeuft','pausiert')`,
      );
      if (active.length > 0) {
        throw new HttpError(
          409,
          'session_active',
          'Eine laufende oder pausierte Session lässt sich nicht endgültig löschen.',
          { session_ids: active.map((r) => r.id) },
        );
      }
    }
    const files = await collectFiles(tx, tree);

    // 4. Löschen, Kinder vor Eltern (Fremdschlüssel NO ACTION bei module/semester)
    const byKind: Record<string, number> = {};
    const remove = async (table: PurgeTable, ids: string[]) => {
      if (ids.length === 0) return;
      const rows = await tx.execute<{ id: string }>(
        sql`DELETE FROM ${sql.identifier(table)} WHERE id IN (${idList(ids)}) RETURNING id`,
      );
      if (rows.length > 0) byKind[table] = (byKind[table] ?? 0) + rows.length;
    };
    const streams = [...tree.notebooks.map(notebookStream), ...tree.sessions.map(sessionStream)];
    let syncOpsRemoved = 0;
    if (streams.length > 0) {
      const [counted] = await tx.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM sync_op WHERE stream IN (${idList(streams)})`,
      );
      syncOpsRemoved = counted?.n ?? 0;
      // sync_op hängt per ON DELETE CASCADE am Strom
      await tx.execute(sql`DELETE FROM sync_stream WHERE stream IN (${idList(streams)})`);
    }
    // Kinder zuerst, damit sie einzeln mitgezählt werden (Slides, Striche, Chunks … folgen per CASCADE)
    await remove('marker', tree.markers);
    await remove('photo', tree.photos);
    await remove('page', tree.pages);
    await remove('session', tree.sessions);
    await remove('slide_deck', tree.decks);
    await remove('exercise_sheet', tree.sheets);
    await remove('notebook', tree.notebooks);
    await remove('calendar_event', tree.events);
    await remove('module', tree.modules);
    await remove('semester', tree.semesters);
    await remove('calendar_source', tree.sources);
    return { byKind, files, syncOpsRemoved };
  });

  let filesRemoved = 0;
  for (const relative of outcome.files) {
    const full = resolveDataPath(dataDir, relative);
    if (!full) continue;
    try {
      await rm(full, { recursive: true, force: true });
      filesRemoved += 1;
    } catch {
      // Eine nicht löschbare Datei bricht das Löschen nicht ab. Der nächtliche Lauf räumt Reste auf.
    }
  }
  return { byKind: outcome.byKind, filesRemoved, syncOpsRemoved: outcome.syncOpsRemoved };
}

/**
 * Alle direkt gelöschten Objekte (optional einer Art) endgültig löschen: `DELETE /trash` („Papierkorb leeren“).
 * Rückgabe: Anzahl der direkten Objekte (wie in der Liste).
 */
export async function emptyTrash(db: Db, dataDir: string, kind?: TrashKind): Promise<number> {
  const counted = new Set<string>();
  for (;;) {
    const roots = (await listTrashRoots(db, kind)).filter((r) => !counted.has(r.id));
    if (roots.length === 0) break;
    for (const root of roots) {
      try {
        await purgeTrashItems(db, dataDir, [root]);
      } catch (error) {
        // Schon als Teil eines anderen Objekts gelöscht (Teilbaum): zählt trotzdem als direktes Objekt
        if (!(error instanceof HttpError && error.code === 'trash_item_not_found')) throw error;
      }
      counted.add(root.id);
    }
  }
  return counted.size;
}

async function listTrashRoots(db: DbOrTx, kind?: TrashKind): Promise<{ kind: TrashKind; id: string }[]> {
  const kinds = kind ? [kind] : TRASH_KINDS;
  const rows = await db.execute<{ kind: TrashKind; id: string }>(
    sql.join(
      kinds.map(
        (k) =>
          sql`SELECT ${k}::text AS kind, t.id FROM ${sql.identifier(k)} t
              WHERE t.deleted_at IS NOT NULL AND ${isDirect(k)}`,
      ),
      sql` UNION ALL `,
    ),
  );
  return rows;
}

/** `DELETE /trash/{id}`: nur direkt gelöschte Objekte (wie in der Liste). 404 `trash_item_not_found` sonst */
export async function purgeOne(db: Db, dataDir: string, id: string): Promise<PurgeResult> {
  const { kind } = await findTrashRow(db, id);
  const [direct] = await db.execute<{ id: string }>(
    sql`SELECT t.id FROM ${sql.identifier(kind)} t WHERE t.id = ${id} AND ${isDirect(kind)}`,
  );
  if (!direct) throw new HttpError(404, 'trash_item_not_found', 'Dieses Objekt liegt nicht im Papierkorb.');
  return purgeTrashItems(db, dataDir, [{ kind, id }]);
}
