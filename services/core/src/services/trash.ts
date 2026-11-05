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
export type Node =
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

export interface Edge {
  child: Node;
  /** Fremdschlüssel im Kind */
  fk: string;
  /** Zusätzliche Bedingung nur beim Löschen (beim Wiederherstellen entscheidet allein der Zeitstempel) */
  deleteFilter?: SQL;
}

/** Bei Sessions nie gestartet (VERTRAEGE §13, Zeile `calendar_source`) */
export const NEVER_STARTED = sql`state IN ('geplant','bereit','verpasst')`;

/** Kaskaden nach VERTRAEGE §13. Was hier fehlt, bleibt unverändert (z. B. Kalendertermine eines Moduls, Seiten einer Session). */
export const CHILDREN: Record<Node, Edge[]> = {
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
export const PARENT: Partial<Record<TrashKind, { kind: TrashKind; fk: string }>> = {
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
export const TITLE: Record<TrashKind, SQL> = {
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

/** Spalte, optional mit Tabellenalias (`r.module_id`) */
function col(alias: string | null, name: string): SQL {
  return alias ? sql`${sql.raw(alias)}.${sql.identifier(name)}` : sql`${sql.identifier(name)}`;
}

function matchCondition(mode: Mode, alias: string | null = null): SQL {
  return mode.op === 'delete'
    ? sql`${col(alias, 'deleted_at')} IS NULL`
    : sql`${col(alias, 'deleted_at')} = ${mode.ts}::timestamptz`;
}

function newValue(mode: Mode): SQL {
  return mode.op === 'delete' ? sql`${mode.ts.toISOString()}::timestamptz` : sql`NULL`;
}

/**
 * Partielle Unique-Indizes (`… WHERE deleted_at IS NULL`), die beim Wiederherstellen verletzt werden können.
 * `semester_current_uq` regelt restoreFromTrash gesondert (Semester kommt dann als nicht aktuell zurück).
 */
const UNIQUE_CHECKS: Partial<
  Record<Node, { constraint: string; cols: string[]; where?: (alias: string) => SQL }[]>
> = {
  session: [
    {
      constraint: 'session_event_uq',
      cols: ['calendar_event_id'],
      where: (a) => sql`${col(a, 'calendar_event_id')} IS NOT NULL`,
    },
    {
      constraint: 'session_one_active_uq',
      cols: ['user_id'],
      where: (a) => sql`${col(a, 'state')} IN ('laeuft','pausiert')`,
    },
  ],
  notebook: [
    {
      constraint: 'notebook_default_uq',
      cols: ['module_id', 'kind'],
      where: (a) => sql`${col(a, 'kind')} IN ('vorlesung','uebung')`,
    },
  ],
  slide: [{ constraint: 'slide_deck_index_uq', cols: ['deck_id', 'index'] }],
};

const restoreConflict = (constraint: string, conflictingId: string | null) =>
  new HttpError(
    409,
    'restore_conflict',
    'Das Objekt lässt sich nicht wiederherstellen, weil inzwischen ein gleichwertiges existiert.',
    { constraint, conflicting_id: conflictingId },
  );

/**
 * Prüft vor dem Wiederherstellen der Zeilen `restored(r)` aus `table`, ob ein aktives Gegenstück den
 * partiellen Unique-Index verletzen würde. Dann `409 restore_conflict`.
 */
async function checkRestoreConflicts(tx: Tx, table: Node, restored: (alias: string) => SQL): Promise<void> {
  for (const check of UNIQUE_CHECKS[table] ?? []) {
    const conditions: SQL[] = [
      restored('r'),
      sql`${col('a', 'deleted_at')} IS NULL`,
      sql`${col('a', 'id')} <> ${col('r', 'id')}`,
      ...check.cols.map((c) => sql`${col('a', c)} = ${col('r', c)}`),
      ...(check.where ? [check.where('r'), check.where('a')] : []),
    ];
    const [hit] = await tx.execute<{ conflicting_id: string }>(
      sql`SELECT a.id AS conflicting_id FROM ${sql.identifier(table)} r, ${sql.identifier(table)} a
          WHERE ${sql.join(conditions, sql` AND `)} LIMIT 1`,
    );
    if (hit) throw restoreConflict(check.constraint, hit.conflicting_id);
  }
}

/** Kinder von `node` mit den IDs `ids` löschen bzw. wiederherstellen, rekursiv. Rückgabe: Anzahl geänderter Zeilen */
async function cascade(tx: Tx, node: Node, ids: string[], mode: Mode): Promise<number> {
  if (ids.length === 0) return 0;
  let count = 0;
  for (const edge of CHILDREN[node]) {
    const where = (alias: string | null): SQL => {
      const parts: SQL[] = [inArray(col(alias, edge.fk), ids), matchCondition(mode, alias)];
      if (mode.op === 'delete' && edge.deleteFilter) parts.push(edge.deleteFilter);
      return sql.join(parts, sql` AND `);
    };

    if (mode.op === 'delete' && edge.child === 'session') {
      // Aktive Sessions werden nie mitgelöscht. FOR UPDATE sperrt die Sessions gegen einen gleichzeitigen Start:
      // Ein laufender Start wird abgewartet und dann hier gesehen. Die Transaktion des Aufrufers bricht dann ab.
      const sessions = await tx.execute<{ id: string; state: string }>(
        sql`SELECT id, state FROM session WHERE ${where(null)} ORDER BY id FOR UPDATE`,
      );
      const active = sessions.filter((s) => s.state === 'laeuft' || s.state === 'pausiert');
      if (active.length > 0) throw sessionActive(active.map((r) => r.id));
    }
    if (mode.op === 'restore') await checkRestoreConflicts(tx, edge.child, where);

    const rows = await tx.execute<{ id: string }>(
      sql`UPDATE ${sql.identifier(edge.child)} SET deleted_at = ${newValue(mode)}
          WHERE ${where(null)} RETURNING id`,
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

/** Name des verletzten Unique-Constraints, falls `error` (auch verpackt) ein 23505 ist */
function uniqueViolation(error: unknown): string | null {
  for (let e: unknown = error, depth = 0; e && depth < 3; depth += 1) {
    const info = e as { code?: unknown; constraint_name?: unknown };
    if (info.code === '23505')
      return typeof info.constraint_name === 'string' ? info.constraint_name : 'unbekannt';
    e = (e as { cause?: unknown }).cause;
  }
  return null;
}

/**
 * Objekt weich löschen, mit der Kaskade aus VERTRAEGE §13. Alle Teile bekommen denselben `deleted_at`.
 * Rückgabe: dieser Zeitstempel (Millisekunden-genau, damit ihn Handler unverändert weitergeben können).
 *
 * Fehler (HttpError): 404 `<kind>_not_found` (fehlt oder schon gelöscht), 409 `session_active` mit
 * `details.session_ids` (Session läuft oder ist pausiert, auch innerhalb der Kaskade eines Moduls oder
 * Semesters), 409 `notebook_default` (Notizbücher „Vorlesung“ und „Übung“ nur mit ihrem Modul).
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
 * Ist beim Wiederherstellen eines aktuellen Semesters schon ein anderes aktuell, kommt es als nicht aktuell zurück.
 *
 * Fehler (HttpError): 404 `trash_item_not_found`, 409 `restore_parent_deleted` mit `details.parent` (`TrashParent`),
 * 409 `restore_conflict` mit `details: { constraint, conflicting_id }` (ein gleichwertiges Objekt ist inzwischen
 * aktiv, z. B. eine neue Session zum selben Termin). Bei einem Fehler bleibt nichts halb wiederhergestellt.
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
  try {
    // Savepoint: Ein unerwarteter Unique-Verstoß lässt die Transaktion des Aufrufers benutzbar
    return await tx.transaction(async (sp) => {
      await checkRestoreConflicts(sp, kind, (a) => sql`${col(a, 'id')} = ${id}`);
      const restored = await cascade(sp, kind, [id], mode);
      if (kind === 'semester') {
        // Höchstens ein aktuelles Semester: Ist inzwischen ein anderes aktuell, kommt dieses als nicht aktuell zurück
        await sp.execute(
          sql`UPDATE semester SET deleted_at = NULL, is_current = is_current AND NOT EXISTS (
                SELECT 1 FROM semester o WHERE o.is_current AND o.deleted_at IS NULL AND o.id <> ${id})
              WHERE id = ${id}`,
        );
      } else {
        await sp.execute(sql`UPDATE ${sql.identifier(kind)} SET deleted_at = NULL WHERE id = ${id}`);
      }
      return { id, kind, restored_count: restored + 1 };
    });
  } catch (error) {
    const constraint = uniqueViolation(error);
    if (constraint) throw restoreConflict(constraint, null);
    throw error;
  }
}
