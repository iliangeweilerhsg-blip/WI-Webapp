// Inbox (VERTRAEGE §20.6, F-NAC-06): lesen, annehmen, ablehnen, rückgängig, Massenaktionen. Ticket T2-22b.
//
// Sperrreihenfolge jeder Entscheidung (§20.6 „Sperren“):
//   1. Session des Eintrags `FOR SHARE` (davor oder danach liegt `concepts.resolve`, das sie `FOR NO KEY UPDATE` hält)
//   2. Eintrag `FOR UPDATE`, Status unter der Sperre prüfen
//   3. `pg_advisory_xact_lock(CONCEPT_GRAPH_LOCK_KEY)` für jede Annahme und jede Rücknahme
//   4. betroffene Konzepte nach ID sortiert `FOR NO KEY UPDATE`   5. Beziehungen
// Folge-Einträge (mitentschiedene Beziehungen) werden erst nach Schritt 3 gegriffen. Dort wird nie gewartet
// (`SKIP LOCKED`, `lockItems`): Wer so einen Eintrag hält, wartet selbst auf die Graph-Sperre. Darf ein Folge-Eintrag
// nicht übersprungen werden, rollt die Entscheidung zurück und läuft neu (`withRetry`).
import { and, asc, eq, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import type {
  AutoAcceptMode,
  Concept,
  ConceptEdit,
  ConceptRelationKind,
  InboxAcceptRequest,
  InboxBlockedReason,
  InboxBulkRequest,
  InboxBulkResult,
  InboxDecision,
  InboxDecisionResult,
  InboxItem,
  InboxItemList,
  InboxKind,
  InboxOverview,
  InboxStatus,
} from '@sg/shared';
import type { Db, DbOrTx, Tx } from '../db/client.ts';
import { concept, conceptRelation, inboxItem, notDeleted, session } from '../db/schema/index.ts';
import { HttpError } from '../errors.ts';
import {
  acceptMerge,
  acceptNew,
  BusyError,
  confirmRelation,
  lockConceptGraph,
  markItem,
  readAutoAccept,
  rejectItem,
  undoAcceptNew,
  undoMerge,
  undoReject,
  undoRelation,
  type ItemRow,
} from './concept-graph.ts';
import { loadApiConcept, loadSessionRefs } from './concepts.ts';
import { isoTs, requireSession } from './sessions.ts';

const notFound = () => new HttpError(404, 'inbox_item_not_found', 'Der Eintrag wurde nicht gefunden.');

// --- Lesen -------------------------------------------------------------------------------------------------

/** `blocked` je offenem Beziehungs-Eintrag: ein Endpunkt ist noch Vorschlag (offen bzw. abgelehnt) */
async function loadBlocked(db: DbOrTx, rows: readonly ItemRow[]): Promise<Map<string, InboxBlockedReason>> {
  const result = new Map<string, InboxBlockedReason>();
  const relationIds = rows.flatMap((row) =>
    row.status === 'offen' && row.relationId ? [row.relationId] : [],
  );
  if (relationIds.length === 0) return result;
  const endpoints = await db
    .select({
      relationId: conceptRelation.id,
      // Status des Eintrags, an dem der Vorschlag hängt
      proposalItemStatus: inboxItem.status,
    })
    .from(conceptRelation)
    .innerJoin(
      concept,
      and(
        or(eq(concept.id, conceptRelation.fromId), eq(concept.id, conceptRelation.toId)),
        eq(concept.status, 'vorschlag'),
      ),
    )
    .innerJoin(inboxItem, and(eq(inboxItem.conceptId, concept.id), notDeleted(inboxItem)))
    .where(inArray(conceptRelation.id, relationIds));
  for (const row of endpoints) {
    if (row.proposalItemStatus === 'abgelehnt') result.set(row.relationId, 'endpunkt_abgelehnt');
    else if (row.proposalItemStatus === 'offen' && !result.has(row.relationId)) {
      result.set(row.relationId, 'endpunkt_offen');
    }
  }
  return result;
}

export async function toApiItems(db: DbOrTx, rows: readonly ItemRow[]): Promise<InboxItem[]> {
  const sessions = await loadSessionRefs(
    db,
    rows.flatMap((row) => (row.sessionId ? [row.sessionId] : [])),
  );
  const blocked = await loadBlocked(db, rows);
  return rows.map((row) => ({
    id: row.id,
    created_at: isoTs(row.createdAt),
    updated_at: isoTs(row.updatedAt),
    kind: row.kind as InboxKind,
    status: row.status as InboxStatus,
    session: (row.sessionId && sessions.get(row.sessionId)) || null,
    job_id: row.jobId,
    priority: row.priority,
    decided_at: row.decidedAt ? isoTs(row.decidedAt) : null,
    payload: row.payload,
    concept_id: row.conceptId,
    target_concept_id: row.targetConceptId,
    relation_id: row.relationId,
    blocked: (row.relationId && blocked.get(row.relationId)) || null,
  }));
}

export interface ListInboxOptions {
  status: 'offen' | 'entschieden' | 'alle';
  sessionId?: string | undefined;
  kinds?: readonly InboxKind[] | undefined;
  cursor?: string | undefined;
  limit: number;
}

const TS_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface InboxCursor {
  ts: string;
  priority: number;
  id: string;
}

function decodeInboxCursor(raw: string): InboxCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (Array.isArray(parsed) && parsed.length === 3) {
      const [ts, priority, id] = parsed as unknown[];
      if (
        typeof ts === 'string' &&
        TS_RE.test(ts) &&
        typeof priority === 'number' &&
        Number.isSafeInteger(priority) &&
        typeof id === 'string' &&
        UUID_RE.test(id)
      ) {
        return { ts, priority, id };
      }
    }
  } catch {
    // unten
  }
  throw new HttpError(400, 'invalid_cursor', 'Der Cursor ist ungültig.');
}

/** Einträge gelöschter Sessions gibt es nicht, auch wenn ihr eigenes `deleted_at` (noch) fehlt */
const sessionAlive = sql`(${inboxItem.sessionId} IS NULL OR EXISTS (
  SELECT 1 FROM session s WHERE s.id = ${inboxItem.sessionId} AND s.deleted_at IS NULL))`;

/** `GET /inbox`: Sortierung `(created_at DESC, priority, id)`, Einträge eines Laufs stehen nach `priority` */
export async function listInbox(db: DbOrTx, options: ListInboxOptions): Promise<InboxItemList> {
  const conditions: (SQL | undefined)[] = [notDeleted(inboxItem), sessionAlive];
  if (options.status === 'offen') conditions.push(eq(inboxItem.status, 'offen'));
  else if (options.status === 'entschieden') conditions.push(ne(inboxItem.status, 'offen'));
  if (options.sessionId) conditions.push(eq(inboxItem.sessionId, options.sessionId));
  if (options.kinds && options.kinds.length > 0) conditions.push(inArray(inboxItem.kind, [...options.kinds]));
  if (options.cursor) {
    const c = decodeInboxCursor(options.cursor);
    conditions.push(sql`(${inboxItem.createdAt} < ${c.ts}::timestamptz OR (${inboxItem.createdAt} = ${c.ts}::timestamptz
      AND (${inboxItem.priority}, ${inboxItem.id}) > (${c.priority}, ${c.id}::uuid)))`);
  }
  const rows = await db
    .select({ row: inboxItem, ts: sql<string>`${inboxItem.createdAt}::text` })
    .from(inboxItem)
    .where(and(...conditions))
    .orderBy(sql`${inboxItem.createdAt} DESC`, asc(inboxItem.priority), asc(inboxItem.id))
    .limit(options.limit + 1);
  const hasMore = rows.length > options.limit;
  const visible = hasMore ? rows.slice(0, options.limit) : rows;
  const last = visible.at(-1);
  return {
    items: await toApiItems(
      db,
      visible.map((entry) => entry.row),
    ),
    next_cursor:
      hasMore && last
        ? Buffer.from(JSON.stringify([last.ts, last.row.priority, last.row.id]), 'utf8').toString('base64url')
        : null,
  };
}

/** Ab diesem Alter zählt ein offener Eintrag als „älter“ (F-NAC-06) */
export const OLDER_AFTER_DAYS = 14;

/** `GET /inbox/overview`: Zähler und Gruppen je Session, neueste Session zuerst, Einträge ohne Session zuletzt */
export async function getInboxOverview(db: DbOrTx): Promise<InboxOverview> {
  const groups = await db
    .select({
      sessionId: inboxItem.sessionId,
      open: sql<number>`count(*)::int`,
      older: sql<number>`(count(*) FILTER (WHERE ${inboxItem.createdAt}
        < now() - make_interval(days => ${OLDER_AFTER_DAYS})))::int`,
      oldest: sql<Date>`min(${inboxItem.createdAt})`,
    })
    .from(inboxItem)
    .leftJoin(session, eq(session.id, inboxItem.sessionId))
    .where(
      and(
        eq(inboxItem.status, 'offen'),
        notDeleted(inboxItem),
        or(isNull(inboxItem.sessionId), isNull(session.deletedAt)),
      ),
    )
    .groupBy(inboxItem.sessionId, session.startedAt, session.createdAt)
    .orderBy(
      sql`(${inboxItem.sessionId} IS NULL)`,
      sql`coalesce(${session.startedAt}, ${session.createdAt}) DESC`,
      sql`${inboxItem.sessionId} DESC`,
    );
  const sessions = await loadSessionRefs(
    db,
    groups.flatMap((group) => (group.sessionId ? [group.sessionId] : [])),
  );
  return {
    open_count: groups.reduce((sum, group) => sum + group.open, 0),
    older_count: groups.reduce((sum, group) => sum + group.older, 0),
    sessions: groups.map((group) => ({
      session: (group.sessionId && sessions.get(group.sessionId)) || null,
      open_count: group.open,
      oldest_at: isoTs(new Date(group.oldest)),
    })),
  };
}

// --- Entscheiden -------------------------------------------------------------------------------------------

export type InboxOp = 'accept' | 'reject' | 'reopen';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** Zusammen rund 1,7 s: wer einen Folge-Eintrag hält, wartet nur auf die Graph-Sperre und ist danach schnell fertig */
const MAX_ATTEMPTS = 20;

function isDeadlock(error: unknown): boolean {
  for (let at: unknown = error, depth = 0; at && depth < 4; depth += 1) {
    if ((at as { code?: unknown }).code === '40P01') return true;
    at = (at as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Wiederholt eine ganze Entscheidung, wenn ein Folge-Eintrag gerade gesperrt war (`BusyError`) oder Postgres eine
 * Verklemmung aufgelöst hat. Nach dem Rollback kommt die andere Transaktion an die Graph-Sperre und wird fertig.
 */
async function withRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (!(error instanceof BusyError) && !isDeadlock(error)) throw error;
      if (attempt >= MAX_ATTEMPTS) {
        // 5xx: der `Idempotency-Key` wird wieder frei, der Client kann es erneut versuchen
        throw new HttpError(503, 'inbox_busy', 'Die Inbox ist gerade beschäftigt. Bitte erneut versuchen.');
      }
      await sleep(Math.min(20 * attempt, 100) + Math.random() * 20);
    }
  }
}

type AcceptPlan =
  | { type: 'new'; edit: ConceptEdit | undefined }
  | { type: 'merge'; targetId: string }
  | { type: 'relation'; relationKind: ConceptRelationKind | undefined };

/** Welche Felder zu welcher Art passen (§20.6), sonst `400 inbox_action_invalid` */
export function planAccept(
  item: Pick<ItemRow, 'kind' | 'targetConceptId'>,
  body: InboxAcceptRequest,
): AcceptPlan {
  const invalid = (field: string) =>
    new HttpError(400, 'inbox_action_invalid', `Das Feld ${field} passt nicht zu diesem Vorschlag.`, {
      field,
    });
  if (item.kind === 'relation') {
    for (const field of ['edit', 'merge_into', 'as_new'] as const) {
      if (body[field] !== undefined) throw invalid(field);
    }
    return { type: 'relation', relationKind: body.relation_kind };
  }
  if (body.relation_kind !== undefined) throw invalid('relation_kind');
  if (item.kind === 'concept_new') {
    if (body.as_new !== undefined) throw invalid('as_new');
    if (body.merge_into === undefined) return { type: 'new', edit: body.edit };
  } else {
    if (body.as_new === true) {
      if (body.merge_into !== undefined) throw invalid('as_new');
      return { type: 'new', edit: body.edit };
    }
  }
  // Zusammenführen übernimmt keine Änderungen am Vorschlag
  if (body.edit !== undefined) throw invalid('edit');
  return { type: 'merge', targetId: body.merge_into ?? item.targetConceptId! };
}

interface OpState {
  autoAccept: AutoAcceptMode;
  /** Die Graph-Sperre gilt bis zum Ende der Transaktion und wird nur einmal genommen */
  graphLocked: boolean;
}

interface OpOutcome {
  /** Konzept für die Antwort */
  conceptId: string | null;
  /** Einträge, die diese Entscheidung mitentschieden bzw. mit geöffnet hat */
  alsoChanged: string[];
}

/** Folge-Einträge, die der Eintrag `itemId` mitentschieden hat (nicht die nur umgehängten aus A2) */
async function triggeredItems(tx: Tx, ids: readonly string[], itemId: string): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await tx
    .select({ id: inboxItem.id })
    .from(inboxItem)
    .where(
      and(
        inArray(inboxItem.id, [...ids]),
        ne(inboxItem.status, 'offen'),
        sql`${inboxItem.decision}->>'triggered_by' = ${itemId}`,
      ),
    )
    .orderBy(asc(inboxItem.priority), asc(inboxItem.id));
  return rows.map((row) => row.id);
}

/**
 * Eine Entscheidung auf einem gesperrten Eintrag (Schritte 2–5). Wirft `HttpError` vor dem ersten Schreiben oder so,
 * dass der Aufrufer zurückrollt (Transaktion bzw. Savepoint).
 */
async function applyOp(
  tx: Tx,
  item: ItemRow,
  op: InboxOp,
  body: InboxAcceptRequest,
  state: OpState,
): Promise<OpOutcome> {
  const lockGraph = async () => {
    if (state.graphLocked) return;
    await lockConceptGraph(tx);
    state.graphLocked = true;
  };

  if (op === 'reopen') {
    // Ein Eintrag ohne Session lässt sich nicht wieder öffnen
    if (!item.sessionId) throw notFound();
    if (item.status === 'offen') {
      throw new HttpError(409, 'inbox_item_not_decided', 'Der Eintrag ist noch offen.');
    }
    const decision = item.decision;
    if (!decision) throw new HttpError(409, 'inbox_reopen_conflict', 'Die Entscheidung ist nicht bekannt.');
    if (decision.triggered_by) {
      throw new HttpError(
        409,
        'inbox_reopen_conflict',
        'Der Eintrag wurde mit einem anderen entschieden und lässt sich nur über diesen wieder öffnen.',
        { triggered_by: decision.triggered_by },
      );
    }
    await lockGraph();
    const alsoChanged = await triggeredItems(tx, decision.cascade_item_ids, item.id);
    if (decision.action === 'abgelehnt') await undoReject(tx, item, decision);
    else if (decision.action === 'angenommen_neu') await undoAcceptNew(tx, item, decision);
    else if (decision.action === 'zusammengefuehrt') await undoMerge(tx, item, decision);
    else await undoRelation(tx, item, decision);
    await markItem(tx, item.id, 'offen', null);
    return { conceptId: item.conceptId, alsoChanged };
  }

  if (item.status !== 'offen') {
    throw new HttpError(409, 'inbox_item_decided', 'Der Eintrag ist schon entschieden.', {
      status: item.status,
    });
  }

  let decision: InboxDecision;
  let conceptId = item.conceptId;
  if (op === 'reject') {
    decision = await rejectItem(tx, item);
    await markItem(tx, item.id, 'abgelehnt', decision);
  } else {
    const plan = planAccept(item, body);
    await lockGraph();
    if (plan.type === 'new') decision = await acceptNew(tx, item, plan.edit, state.autoAccept);
    else if (plan.type === 'merge') {
      decision = await acceptMerge(tx, item, plan.targetId);
      conceptId = plan.targetId;
    } else decision = await confirmRelation(tx, item, plan.relationKind);
    await markItem(tx, item.id, 'angenommen', decision);
  }
  return { conceptId, alsoChanged: await triggeredItems(tx, decision.cascade_item_ids, item.id) };
}

/** Schritte 1 und 2: Session des Eintrags `FOR SHARE`, dann der Eintrag `FOR UPDATE` */
async function lockItemWithSession(tx: Tx, id: string): Promise<ItemRow> {
  const [peek] = await tx
    .select({ sessionId: inboxItem.sessionId })
    .from(inboxItem)
    .where(and(eq(inboxItem.id, id), notDeleted(inboxItem)));
  if (!peek) throw notFound();
  if (peek.sessionId) await lockSessions(tx, [peek.sessionId]);
  const [item] = await tx
    .select()
    .from(inboxItem)
    .where(and(eq(inboxItem.id, id), notDeleted(inboxItem), sessionAlive))
    .for('update');
  if (!item) throw notFound();
  return item;
}

/** Sessions nach ID sortiert `FOR SHARE` sperren (auch gelöschte Zeilen; fehlende gibt es nicht mehr) */
async function lockSessions(tx: Tx, ids: readonly string[]): Promise<void> {
  const unique = [...new Set(ids)].sort();
  if (unique.length === 0) return;
  await tx
    .select({ id: session.id })
    .from(session)
    .where(inArray(session.id, unique))
    .orderBy(asc(session.id))
    .for('share');
}

/** `POST /inbox/{id}/accept|reject|reopen` */
export async function decideInboxItem(
  db: Db,
  id: string,
  op: InboxOp,
  body: InboxAcceptRequest = {},
): Promise<InboxDecisionResult> {
  return withRetry(() =>
    db.transaction(async (tx) => {
      const item = await lockItemWithSession(tx, id);
      const state: OpState = {
        autoAccept: op === 'accept' ? await readAutoAccept(tx) : 'aus',
        graphLocked: false,
      };
      const outcome = await applyOp(tx, item, op, body, state);
      const [fresh] = await tx.select().from(inboxItem).where(eq(inboxItem.id, id));
      const [view] = await toApiItems(tx, fresh ? [fresh] : []);
      if (!view) throw notFound();
      const result: Concept | null = outcome.conceptId ? await loadApiConcept(tx, outcome.conceptId) : null;
      return { item: view, concept: result };
    }),
  );
}

// --- Massenaktionen ----------------------------------------------------------------------------------------

const CONCEPT_KINDS: readonly string[] = ['concept_new', 'concept_merge'];

/** Reihenfolge: erst Konzepte nach `priority`, dann Beziehungen. `reopen` läuft in umgekehrter Reihenfolge */
function bulkOrder(rows: ItemRow[], op: InboxOp): ItemRow[] {
  const rank = (row: ItemRow) => (CONCEPT_KINDS.includes(row.kind) ? 0 : 1);
  const sorted = [...rows].sort(
    (a, b) => rank(a) - rank(b) || a.priority - b.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return op === 'reopen' ? sorted.reverse() : sorted;
}

/**
 * `POST /inbox/bulk`: genau eins von `ids` und `session_id`. Jeder Eintrag läuft in einem eigenen Savepoint, Fehler
 * landen mit ihrem Code in `skipped`. Einträge, die eine frühere Entscheidung derselben Aktion mitentschieden hat,
 * stehen in `decided` (nicht in `skipped`).
 */
export async function bulkInbox(db: Db, request: InboxBulkRequest): Promise<InboxBulkResult> {
  if ((request.ids === undefined) === (request.session_id === undefined)) {
    throw new HttpError(400, 'validation_failed', 'Genau eins von ids und session_id ist anzugeben.');
  }
  const op: InboxOp = request.action;
  return withRetry(() =>
    db.transaction(async (tx) => {
      const skipped: InboxBulkResult['skipped'] = [];
      let wanted: string[];
      let sessionIds: string[];
      if (request.session_id !== undefined) {
        await requireSession(tx, request.session_id);
        sessionIds = [request.session_id];
        wanted = [];
      } else {
        wanted = [...new Set(request.ids)];
        const peek = await tx
          .select({ sessionId: inboxItem.sessionId })
          .from(inboxItem)
          .where(and(inArray(inboxItem.id, wanted), notDeleted(inboxItem)));
        sessionIds = peek.flatMap((row) => (row.sessionId ? [row.sessionId] : []));
      }

      // Erst alle Sessions, dann alle Einträge, je nach ID sortiert
      await lockSessions(tx, sessionIds);
      const scope =
        request.session_id !== undefined
          ? and(
              eq(inboxItem.sessionId, request.session_id),
              op === 'reopen' ? ne(inboxItem.status, 'offen') : eq(inboxItem.status, 'offen'),
            )
          : inArray(inboxItem.id, wanted);
      const locked = await tx
        .select()
        .from(inboxItem)
        .where(and(scope, notDeleted(inboxItem), sessionAlive))
        .orderBy(asc(inboxItem.id))
        .for('update');
      const lockedIds = new Set(locked.map((row) => row.id));
      for (const id of wanted) {
        if (!lockedIds.has(id)) skipped.push({ id, code: 'inbox_item_not_found' });
      }

      const state: OpState = {
        autoAccept: op === 'accept' ? await readAutoAccept(tx) : 'aus',
        graphLocked: false,
      };
      // Außerhalb der Savepoints: eine dort genommene Sperre fiele mit deren Rollback weg
      if (op !== 'reject' && locked.length > 0) {
        await lockConceptGraph(tx);
        state.graphLocked = true;
      }

      const decided: string[] = [];
      const done = new Set<string>();
      const deferred: string[] = [];
      for (const { id } of bulkOrder(locked, op)) {
        if (done.has(id)) continue;
        // Frühere Entscheidungen dieser Aktion können den Eintrag geändert haben
        const [item] = await tx.select().from(inboxItem).where(eq(inboxItem.id, id));
        if (!item) continue;
        const trigger = item.decision?.triggered_by;
        if (op === 'reopen' && trigger && lockedIds.has(trigger)) {
          // Öffnet sich mit seinem Auslöser, der ebenfalls dran ist
          deferred.push(id);
          continue;
        }
        try {
          const outcome = await tx.transaction((sp) => applyOp(sp, item, op, {}, state));
          for (const changed of [id, ...outcome.alsoChanged]) {
            if (done.has(changed)) continue;
            done.add(changed);
            decided.push(changed);
          }
        } catch (error) {
          if (!(error instanceof HttpError)) throw error;
          skipped.push({ id, code: error.code });
        }
      }
      for (const id of deferred) {
        if (!done.has(id)) skipped.push({ id, code: 'inbox_reopen_conflict' });
      }
      return { decided, skipped };
    }),
  );
}
