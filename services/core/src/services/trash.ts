// Papierkorb (F-DAT-04, VERTRAEGE §13, §16.2). softDelete/restoreFromTrash aus T1-DB; Routen und
// Server-Operationen bei der Wiederherstellung (notebook.restore, page.restore) baut T1-18.
//
// Löschen setzt `deleted_at` am Objekt und an allen noch nicht gelöschten Teilen mit DEMSELBEN Zeitstempel.
// Wiederherstellen setzt genau die Zeilen mit diesem Zeitstempel zurück. Schon vorher gelöschte Teile
// (anderer Zeitstempel) bleiben im Papierkorb.
import { inArray, sql, type SQL } from 'drizzle-orm';
import type { TrashKind, TrashParent, TrashRestoreResult } from '@sg/shared';
import type { Tx } from '../db/client.ts';
import { HttpError } from '../errors.ts';

/** Tabellen der Kaskade. Der Knotenname ist der Tabellenname. */
type Node =
  | 'semester'
  | 'module'
  | 'slide_deck'
  | 'slide'
  | 'exercise_sheet'
  | 'task'
  | 'calendar_source'
  | 'calendar_event'
  | 'session'
  | 'slide_event'
  | 'marker'
  | 'photo'
  | 'recording'
  | 'audio_chunk'
  | 'notebook'
  | 'page'
  | 'stroke'
  | 'page_element';

interface Edge {
  child: Node;
  /** Fremdschlüssel im Kind */
  fk: string;
  /** Zusätzliche Bedingung nur beim Löschen (beim Wiederherstellen entscheidet allein der Zeitstempel) */
  deleteFilter?: SQL;
}

/** Bei Sessions nie gestartet (VERTRAEGE §13, Zeile `calendar_source`) */
const NEVER_STARTED = sql`state IN ('geplant','bereit','verpasst')`;
const ACTIVE = sql`state IN ('laeuft','pausiert')`;

/** Kaskaden nach VERTRAEGE §13. Was hier fehlt, bleibt unverändert (z. B. Kalendertermine eines Moduls, Seiten einer Session). */
const CHILDREN: Record<Node, Edge[]> = {
  semester: [{ child: 'module', fk: 'semester_id' }],
  module: [
    { child: 'slide_deck', fk: 'module_id' },
    { child: 'exercise_sheet', fk: 'module_id' },
    { child: 'session', fk: 'module_id' },
    { child: 'notebook', fk: 'module_id' },
  ],
  slide_deck: [{ child: 'slide', fk: 'deck_id' }],
  slide: [],
  exercise_sheet: [{ child: 'task', fk: 'sheet_id' }],
  task: [],
  calendar_source: [{ child: 'calendar_event', fk: 'source_id' }],
  calendar_event: [{ child: 'session', fk: 'calendar_event_id', deleteFilter: NEVER_STARTED }],
  session: [
    { child: 'slide_event', fk: 'session_id' },
    { child: 'marker', fk: 'session_id' },
    { child: 'photo', fk: 'session_id' },
    { child: 'recording', fk: 'session_id' },
  ],
  slide_event: [],
  marker: [],
  photo: [],
  recording: [{ child: 'audio_chunk', fk: 'recording_id' }],
  audio_chunk: [],
  notebook: [{ child: 'page', fk: 'notebook_id' }],
  page: [
    { child: 'stroke', fk: 'page_id' },
    { child: 'page_element', fk: 'page_id' },
  ],
  stroke: [],
  page_element: [],
};

/** Direktes Elternobjekt je Papierkorb-Art (für `restore_parent_deleted`) */
const PARENT: Partial<Record<TrashKind, { kind: TrashKind; fk: string }>> = {
  module: { kind: 'semester', fk: 'semester_id' },
  slide_deck: { kind: 'module', fk: 'module_id' },
  exercise_sheet: { kind: 'module', fk: 'module_id' },
  session: { kind: 'module', fk: 'module_id' },
  notebook: { kind: 'module', fk: 'module_id' },
  page: { kind: 'notebook', fk: 'notebook_id' },
  marker: { kind: 'session', fk: 'session_id' },
  photo: { kind: 'session', fk: 'session_id' },
};

/** Anzeigename je Art (SQL-Ausdruck über die Zeile) */
const TITLE: Record<TrashKind, SQL> = {
  semester: sql`name`,
  module: sql`name`,
  slide_deck: sql`title`,
  exercise_sheet: sql`title`,
  calendar_source: sql`name`,
  session: sql`coalesce(title, CASE WHEN number IS NOT NULL THEN 'VL ' || number ELSE 'Session' END)`,
  notebook: sql`title`,
  page: sql`'Seite ' || index`,
  marker: sql`'Marker'`,
  photo: sql`'Foto'`,
};

export const TRASH_KINDS: readonly TrashKind[] = [
  'semester',
  'module',
  'slide_deck',
  'exercise_sheet',
  'calendar_source',
  'session',
  'notebook',
  'page',
  'marker',
  'photo',
];

const notFound = (kind: TrashKind) =>
  new HttpError(404, `${kind}_not_found`, 'Das Objekt gibt es nicht oder es ist schon gelöscht.');
const sessionActive = (ids: string[]) =>
  new HttpError(409, 'session_active', 'Eine laufende oder pausierte Session lässt sich nicht löschen.', {
    session_ids: ids,
  });

type Mode = { op: 'delete'; ts: Date } | { op: 'restore'; ts: string };

function matchCondition(mode: Mode): SQL {
  return mode.op === 'delete' ? sql`deleted_at IS NULL` : sql`deleted_at = ${mode.ts}::timestamptz`;
}

function newValue(mode: Mode): SQL {
  return mode.op === 'delete' ? sql`${mode.ts.toISOString()}::timestamptz` : sql`NULL`;
}

/** Kinder von `node` mit den IDs `ids` löschen bzw. wiederherstellen, rekursiv. Rückgabe: Anzahl geänderter Zeilen */
async function cascade(tx: Tx, node: Node, ids: string[], mode: Mode): Promise<number> {
  if (ids.length === 0) return 0;
  let count = 0;
  for (const edge of CHILDREN[node]) {
    const where: SQL[] = [inArray(sql.identifier(edge.fk), ids), matchCondition(mode)];
    if (mode.op === 'delete' && edge.deleteFilter) where.push(edge.deleteFilter);
    const condition = sql.join(where, sql` AND `);

    if (mode.op === 'delete' && edge.child === 'session') {
      // Aktive Sessions werden nie mitgelöscht. Die Transaktion des Aufrufers bricht dann ab.
      const active = await tx.execute<{ id: string }>(
        sql`SELECT id FROM session WHERE ${condition} AND ${ACTIVE}`,
      );
      if (active.length > 0) throw sessionActive(active.map((r) => r.id));
    }

    const rows = await tx.execute<{ id: string }>(
      sql`UPDATE ${sql.identifier(edge.child)} SET deleted_at = ${newValue(mode)}
          WHERE ${condition} RETURNING id`,
    );
    count += rows.length;
    if (CHILDREN[edge.child].length > 0) {
      count += await cascade(
        tx,
        edge.child,
        rows.map((r) => r.id),
        mode,
      );
    }
  }
  return count;
}

/**
 * Objekt weich löschen, mit der Kaskade aus VERTRAEGE §13. Alle Teile bekommen denselben `deleted_at`.
 * Rückgabe: dieser Zeitstempel (Millisekunden-genau, damit ihn Handler unverändert weitergeben können).
 *
 * Fehler (HttpError): 404 `<kind>_not_found` (fehlt oder schon gelöscht), 409 `session_active`
 * (Session läuft oder ist pausiert, auch innerhalb der Kaskade eines Moduls oder Semesters),
 * 409 `notebook_default` (Notizbücher „Vorlesung“ und „Übung“ nur mit ihrem Modul).
 */
export async function softDelete(tx: Tx, kind: TrashKind, id: string): Promise<Date> {
  const table = sql.identifier(kind);
  const [row] = await tx.execute<{ id: string; extra: string | null }>(
    sql`SELECT id, ${
      kind === 'session' ? sql`state` : kind === 'notebook' ? sql`kind` : sql`NULL::text`
    } AS extra FROM ${table} WHERE id = ${id} AND deleted_at IS NULL FOR UPDATE`,
  );
  if (!row) throw notFound(kind);
  if (kind === 'session' && (row.extra === 'laeuft' || row.extra === 'pausiert')) throw sessionActive([id]);
  if (kind === 'notebook' && (row.extra === 'vorlesung' || row.extra === 'uebung')) {
    throw new HttpError(
      409,
      'notebook_default',
      'Die Notizbücher „Vorlesung“ und „Übung“ eines Moduls lassen sich nicht löschen.',
    );
  }

  const mode: Mode = { op: 'delete', ts: new Date() };
  await tx.execute(sql`UPDATE ${table} SET deleted_at = ${newValue(mode)} WHERE id = ${id}`);
  await cascade(tx, kind, [id], mode);
  return mode.ts;
}

/**
 * Objekt aus dem Papierkorb holen, samt aller Teile mit genau seinem `deleted_at`.
 * Die ID ist die Objekt-ID (UUIDs sind tabellenübergreifend eindeutig).
 *
 * Fehler (HttpError): 404 `trash_item_not_found`, 409 `restore_parent_deleted` mit `details.parent` (`TrashParent`).
 */
export async function restoreFromTrash(tx: Tx, id: string): Promise<TrashRestoreResult> {
  const lookup = sql.join(
    TRASH_KINDS.map(
      (kind) =>
        sql`SELECT ${kind}::text AS kind, deleted_at::text AS ts FROM ${sql.identifier(kind)}
            WHERE id = ${id} AND deleted_at IS NOT NULL`,
    ),
    sql` UNION ALL `,
  );
  const [found] = await tx.execute<{ kind: TrashKind; ts: string }>(lookup);
  if (!found) throw new HttpError(404, 'trash_item_not_found', 'Dieses Objekt liegt nicht im Papierkorb.');
  const { kind, ts } = found;

  const parentRef = PARENT[kind];
  if (parentRef) {
    const [parent] = await tx.execute<{ id: string; deleted: boolean; title: string }>(
      sql`SELECT p.id, p.deleted_at IS NOT NULL AS deleted, ${TITLE[parentRef.kind]} AS title
          FROM ${sql.identifier(parentRef.kind)} p
          WHERE p.id = (SELECT ${sql.identifier(parentRef.fk)} FROM ${sql.identifier(kind)} WHERE id = ${id})`,
    );
    if (parent?.deleted) {
      const details: TrashParent = { id: parent.id, kind: parentRef.kind, title: parent.title };
      throw new HttpError(
        409,
        'restore_parent_deleted',
        'Das übergeordnete Objekt ist selbst gelöscht. Stelle es zuerst wieder her.',
        { parent: details },
      );
    }
  }

  const mode: Mode = { op: 'restore', ts };
  const restored = await cascade(tx, kind, [id], mode);
  await tx.execute(sql`UPDATE ${sql.identifier(kind)} SET deleted_at = NULL WHERE id = ${id}`);
  return { id, kind, restored_count: restored + 1 };
}
