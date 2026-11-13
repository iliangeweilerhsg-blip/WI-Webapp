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
  | 'transcript'
  | 'transcript_segment'
  | 'slide_segment'
  | 'search_chunk'
  | 'inbox_item'
  | 'evidence'
  | 'concept'
  | 'concept_module'
  | 'concept_relation'
  | 'session_summary'
  | 'notebook'
  | 'page'
  | 'stroke'
  | 'page_element'
  // Karten (§21.8): Zustand und Bewertungen hängen an der Karte und gehen mit ihr
  | 'card'
  | 'card_state'
  | 'review_log';

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
    // §20.8: nur die Zuordnung, die Konzepte selbst bleiben (sie gehören keinem Fach allein)
    { child: 'concept_module', fk: 'module_id' },
  ],
  slide_deck: [
    { child: 'slide', fk: 'deck_id' },
    // Suchindex der Folien (§19.1), gleicher Zeitstempel. Endgültiges Löschen nimmt ihn über den FK mit
    { child: 'search_chunk', fk: 'deck_id' },
  ],
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
    // Phase 2 (§18.1): Maschinenausgaben der Session, gleicher Zeitstempel. `transcript_segment` hängt am Transkript
    // und an der Session; der Fremdschlüssel `session_id` genügt, die Kante vom Transkript braucht es nicht.
    { child: 'transcript', fk: 'session_id' },
    { child: 'transcript_segment', fk: 'session_id' },
    { child: 'slide_segment', fk: 'session_id' },
    // Suchindex des Gesagten (§19.1)
    { child: 'search_chunk', fk: 'session_id' },
    // Konzepte und Inbox (§20.8): Vorschläge und Hüllen der Session (`proposal_session_id`) samt ihren Zuordnungen,
    // unbestätigte Beziehungen, Belege, Inbox-Einträge und die Zusammenfassung. Aktive Konzepte und bestätigte
    // Beziehungen haben keine `proposal_session_id` und bleiben, auch ohne Beleg.
    { child: 'inbox_item', fk: 'session_id' },
    { child: 'evidence', fk: 'session_id' },
    { child: 'concept', fk: 'proposal_session_id' },
    { child: 'concept_relation', fk: 'proposal_session_id' },
    { child: 'session_summary', fk: 'session_id' },
  ],
  slide_event: [],
  marker: [],
  photo: [],
  recording: [{ child: 'audio_chunk', fk: 'recording_id' }],
  audio_chunk: [],
  transcript: [],
  transcript_segment: [],
  slide_segment: [],
  search_chunk: [],
  inbox_item: [],
  evidence: [],
  concept: [
    { child: 'concept_module', fk: 'concept_id' },
    // §21.8: Wirkt schon heute, über Session → Vorschlag-Konzept (`proposal_session_id`) → Karte. An solchen Konzepten
    // hängen kaum Karten (A1-`reopen` sperrt, §21.7), eine vorhandene geht aber mit, mit demselben Zeitstempel
    { child: 'card', fk: 'concept_id' },
  ],
  concept_module: [],
  concept_relation: [],
  session_summary: [],
  notebook: [{ child: 'page', fk: 'notebook_id' }],
  page: [
    { child: 'stroke', fk: 'page_id' },
    { child: 'page_element', fk: 'page_id' },
  ],
  stroke: [],
  page_element: [],
  card: [
    { child: 'card_state', fk: 'card_id' },
    { child: 'review_log', fk: 'card_id' },
  ],
  card_state: [],
  review_log: [],
};

/** Direktes Elternobjekt je Papierkorb-Art (für `restore_parent_deleted`) */
export const PARENT: Partial<Record<TrashKind, { kind: TrashKind | 'concept'; fk: string }>> = {
  module: { kind: 'semester', fk: 'semester_id' },
  slide_deck: { kind: 'module', fk: 'module_id' },
  exercise_sheet: { kind: 'module', fk: 'module_id' },
  session: { kind: 'module', fk: 'module_id' },
  notebook: { kind: 'module', fk: 'module_id' },
  page: { kind: 'notebook', fk: 'notebook_id' },
  marker: { kind: 'session', fk: 'session_id' },
  photo: { kind: 'session', fk: 'session_id' },
  // Das Elternobjekt einer Karte ist ein Konzept, das selbst keine `TrashKind` ist (§21.8)
  card: { kind: 'concept', fk: 'concept_id' },
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
  // Die ersten 80 Zeichen der Vorderseite, bei `cloze` mit […] statt der Lücken (§21.8)
  card: sql`left(
    CASE WHEN kind = 'cloze'
      THEN regexp_replace(front->>'text_md', ${'\\{\\{c[0-9]+::[^{}]*\\}\\}'}, '[…]', 'g')
      ELSE front->>'text_md' END, 80)`,
};

/**
 * Anzeigename, wenn die Art als Elternobjekt erscheint (Liste und `restore_parent_deleted`). Ein Notizbuch nennt dort
 * sein Modul („Modul A · Vorlesung“), damit man eine gelöschte Seite im Papierkorb wiederfindet. Ohne Modul bleibt der Titel.
 * Unqualifizierte Spalten, damit der Ausdruck mit und ohne Alias der Notizbuch-Tabelle funktioniert.
 */
export function parentTitle(kind: TrashKind | 'concept'): SQL {
  if (kind === 'concept') return sql`name`;
  if (kind === 'notebook') {
    return sql`coalesce((SELECT m.name FROM module m WHERE m.id = module_id) || ' · ', '') || title`;
  }
  return TITLE[kind];
}

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
  'card',
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

/**
 * Sessions: `updated_at` streng monoton anheben, damit das `session.updated` nach Löschen und Wiederherstellen einen
 * neueren Stand trägt (Clients verwerfen ältere Fassungen über `updated_at`, VERTRAEGE §11.6). Andere Tabellen: unverändert.
 */
function touch(table: string): SQL {
  return table === 'session'
    ? sql`, updated_at = greatest(clock_timestamp(), updated_at + interval '1 millisecond')`
    : sql``;
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

/**
 * Maschinenausgaben weichen beim Wiederherstellen, statt zu blockieren (VERTRAEGE §20.8): Kollidiert eine
 * wiederhergestellte Zeile `r` mit einer inzwischen vorhandenen aktiven Zeile `a` im genannten partiellen
 * Unique-Index, wird `r` in derselben Transaktion **hart gelöscht** statt `409 restore_conflict`. Läuft für alle
 * Kinder eines Knotens vor `checkRestoreConflicts` und vor dem Zurücksetzen von `deleted_at`.
 *
 * - `concept_relation` (`concept_relation_uq`): die unbestätigten Beziehungen der Session. Ihr Inbox-Eintrag geht
 *   über den FK `inbox_item.relation_id` (`ON DELETE CASCADE`) mit.
 * - `evidence` (`evidence_dedupe_uq`): die Belege der Session, verglichen mit denselben Ausdrücken wie der Index.
 *
 * Andere Konflikte (Inbox-Indizes, `session_summary_session_uq`) bleiben `409 restore_conflict`.
 */
const RESTORE_YIELD: Partial<Record<Node, (r: string, a: string) => SQL>> = {
  concept_relation: (r, a) =>
    sql`${col(a, 'from_id')} = ${col(r, 'from_id')} AND ${col(a, 'to_id')} = ${col(r, 'to_id')}
        AND ${col(a, 'kind')} = ${col(r, 'kind')} AND NOT ${col(r, 'confirmed')}`,
  evidence: (r, a) =>
    sql`${col(a, 'concept_id')} = ${col(r, 'concept_id')} AND ${col(a, 'kind')} = ${col(r, 'kind')}
        AND ${col(a, 'ref_id')} = ${col(r, 'ref_id')}
        AND coalesce(${col(a, 't_start_ms')}, -1) = coalesce(${col(r, 't_start_ms')}, -1)
        AND coalesce(${col(a, 't_end_ms')}, -1) = coalesce(${col(r, 't_end_ms')}, -1)
        AND ${col(a, 'session_id')} IS NOT DISTINCT FROM ${col(r, 'session_id')}`,
};

/** Wiederhergestellte Zeilen `restored(r)` aus `table`, die nach `RESTORE_YIELD` kollidieren, hart löschen */
async function yieldOnRestore(tx: Tx, table: Node, restored: (alias: string) => SQL): Promise<void> {
  const collides = RESTORE_YIELD[table];
  if (!collides) return;
  await tx.execute(
    sql`DELETE FROM ${sql.identifier(table)} r USING ${sql.identifier(table)} a
        WHERE ${restored('r')} AND ${col('a', 'deleted_at')} IS NULL AND ${col('a', 'id')} <> ${col('r', 'id')}
          AND ${collides('r', 'a')}`,
  );
}

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
  const whereOf =
    (edge: Edge) =>
    (alias: string | null): SQL => {
      const parts: SQL[] = [inArray(col(alias, edge.fk), ids), matchCondition(mode, alias)];
      if (mode.op === 'delete' && edge.deleteFilter) parts.push(edge.deleteFilter);
      return sql.join(parts, sql` AND `);
    };
  // Weichen vor allem anderen (§20.8): Das harte Löschen einer Beziehung nimmt über den FK ihren Inbox-Eintrag mit.
  // So zählt `restored_count` nur, was wirklich zurückkommt, unabhängig von der Reihenfolge der Kanten
  if (mode.op === 'restore') {
    for (const edge of CHILDREN[node]) await yieldOnRestore(tx, edge.child, whereOf(edge));
  }
  for (const edge of CHILDREN[node]) {
    const where = whereOf(edge);

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
      sql`UPDATE ${sql.identifier(edge.child)} SET deleted_at = ${newValue(mode)}${touch(edge.child)}
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
    } AS extra FROM ${table} WHERE id = ${id} AND deleted_at IS NULL ${
      // Karte: `FOR NO KEY UPDATE` (§21.7), wie das `UPDATE deleted_at` selbst und wie `undoCardBatch`. Die Reihenfolge ist
      // überall `card` vor `card_state`. `FOR UPDATE` hielte die Bewertung auf (`review_log` nimmt `FOR KEY SHARE` an `card`,
      // während sie `card_state` hält) und könnte mit ihr verklemmen
      kind === 'card' ? sql`FOR NO KEY UPDATE` : sql`FOR UPDATE`
    }`,
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
  await tx.execute(sql`UPDATE ${table} SET deleted_at = ${newValue(mode)}${touch(kind)} WHERE id = ${id}`);
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
export async function restoreFromTrash(
  tx: Tx,
  id: string,
  /**
   * Art und Zeitstempel, falls der Aufrufer sie schon gelesen und danach seine Ströme gesperrt hat
   * (`restoreWithOps`, #352): Dann arbeiten Ströme und Kaskade mit genau derselben Menge. Ohne Angabe liest die
   * Funktion beide selbst.
   */
  known?: { kind: TrashKind; ts: string },
): Promise<TrashRestoreResult> {
  let found = known;
  if (!found) {
    const lookup = sql.join(
      TRASH_KINDS.map(
        (kind) =>
          sql`SELECT ${kind}::text AS kind, deleted_at::text AS ts FROM ${sql.identifier(kind)}
            WHERE id = ${id} AND deleted_at IS NOT NULL`,
      ),
      sql` UNION ALL `,
    );
    [found] = await tx.execute<{ kind: TrashKind; ts: string }>(lookup);
  }
  if (!found) throw new HttpError(404, 'trash_item_not_found', 'Dieses Objekt liegt nicht im Papierkorb.');
  const { kind, ts } = found;

  const parentRef = PARENT[kind];
  if (parentRef) {
    // Eine Karte kommt nur zu einem aktiven Konzept zurück (§21.8): gelöscht oder nicht mehr `aktiv` blockiert
    const inactive = parentRef.kind === 'concept' ? sql`p.status <> 'aktiv'` : sql`FALSE`;
    // Elternobjekt sperren (#352), vor der Wurzel: Ein gleichzeitiges `softDelete` des Elternteils (`FOR UPDATE`) wartet,
    // bis das Kind wieder steht (oder der Restore sieht den Elternteil danach gelöscht: 409). Konzept (§21.7): `FOR SHARE`,
    // dieselbe Sperre wie in `createCard`: Ein gleichzeitiges `reopen` von A1 wartet, bis die Karte wieder steht. Alle
    // anderen Eltern nur `FOR KEY SHARE`: Das kollidiert mit `FOR UPDATE` (Löschen, Kaskade, Purge), aber nicht mit
    // `FOR NO KEY UPDATE` und normalen UPDATEs. Wichtig bei Marker/Foto: Die Session-Zeile darf nicht stärker gesperrt
    // werden als `transitionSession` und `runSessionTick` es tun (Session `FOR NO KEY UPDATE`, dann Strom, §16.2),
    // sonst kreuzt sich das mit dem Strom, den der Restore schon hält (40P01).
    // Reihenfolge überall Semester-Sperre → Ströme → Elternteil → Wurzel → Kinder, auch in `softDelete`.
    const lock = parentRef.kind === 'concept' ? sql`FOR SHARE OF p` : sql`FOR KEY SHARE OF p`;
    const [parent] = await tx.execute<{ id: string; deleted: boolean; inactive: boolean; title: string }>(
      sql`SELECT p.id, p.deleted_at IS NOT NULL AS deleted, ${inactive} AS inactive,
                 ${parentTitle(parentRef.kind)} AS title
          FROM ${sql.identifier(parentRef.kind)} p
          WHERE p.id = (SELECT ${sql.identifier(parentRef.fk)} FROM ${sql.identifier(kind)} WHERE id = ${id})
          ${lock}`,
    );
    if (parent?.deleted || parent?.inactive) {
      const details: TrashParent = { id: parent.id, kind: parentRef.kind, title: parent.title };
      throw new HttpError(
        409,
        'restore_parent_deleted',
        parent.deleted
          ? 'Das übergeordnete Objekt ist selbst gelöscht. Stelle es zuerst wieder her.'
          : 'Das Konzept der Karte ist nicht mehr aktiv.',
        { parent: details },
      );
    }
  }

  // Wurzel zuerst sperren, dann die Kinder (#348). Der Purge (trash-ops.ts) sperrt ebenfalls erst die Wurzel und
  // erreicht die Kinder über die Kaskade; schriebe der Restore zuerst die Kinder, könnten beide sich verklemmen
  // (40P01). Karte: `FOR NO KEY UPDATE` (§21.7, wie `softDelete`), sonst `FOR UPDATE`. Bei der Karte steht das
  // Konzept `FOR SHARE` oben davor: Dieselbe Reihenfolge wie `createCard` und `reopen` (Konzept vor Karte).
  // Die Zeile muss noch mit genau diesem Zeitstempel im Papierkorb liegen. Hat sie inzwischen ein `reopen` hart
  // gelöscht oder ein anderer Restore geholt, trifft das 0 Zeilen: 404, bevor ein Kind angefasst wurde. Die Transaktion
  // des Aufrufers rollt beim Fehler zurück.
  const rootLocked = await tx.execute<{ id: string }>(
    sql`SELECT id FROM ${sql.identifier(kind)} WHERE id = ${id} AND deleted_at = ${ts}::timestamptz
        ${kind === 'card' ? sql`FOR NO KEY UPDATE` : sql`FOR UPDATE`}`,
  );
  if (rootLocked.length === 0) {
    throw new HttpError(404, 'trash_item_not_found', 'Dieses Objekt liegt nicht im Papierkorb.');
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
        await sp.execute(
          sql`UPDATE ${sql.identifier(kind)} SET deleted_at = NULL${touch(kind)} WHERE id = ${id}`,
        );
      }
      return { id, kind, restored_count: restored + 1 };
    });
  } catch (error) {
    const constraint = uniqueViolation(error);
    if (constraint) throw restoreConflict(constraint, null);
    throw error;
  }
}
