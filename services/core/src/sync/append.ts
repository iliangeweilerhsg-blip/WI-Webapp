// Operation an einen Strom anhängen (VERTRAEGE §11.2, §16.2). Fertig gebaut in T1-DB.
//
// Ablauf in der Transaktion des Aufrufers:
//   1. sync_stream-Zeile anlegen (falls neu) und mit SELECT … FOR UPDATE sperren,
//   2. unter der Sperre die op_id prüfen (Duplikat → ursprüngliche seq, nichts schreiben),
//   3. sync_op mit head_seq + 1 schreiben, Kopf hochzählen,
//   4. pg_notify('sg_sync_op', …) – Postgres stellt die Benachrichtigung erst NACH dem Commit zu, bei Rollback nie.
// `listenCommittedOps` (startet T1-08 beim Core-Start) hört darauf und ruft den Hook `onOpCommitted` auf.
// Jede `db.transaction` funktioniert, kein eigener Transaktions-Wrapper nötig.
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import type postgres from 'postgres';
import type { SyncOp, SyncOrigin } from '@sg/shared';
import type { DbOrTx, Tx } from '../db/client.ts';
import { syncOp, syncStream } from '../db/schema/index.ts';
import { uuidv7 } from '../lib/uuid7.ts';
import { SyncOpError } from './handlers.ts';

/** Kanal für `pg_notify` nach dem Commit einer Operation. Payload: `{"stream":"…","seq":n}` */
export const SYNC_OP_CHANNEL = 'sg_sync_op';

/** Strom-ID wie `SyncStreamId` im Schema */
const STREAM_PATTERN =
  /^((notebook|session):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|user)$/;

export interface AppendOpInput {
  kind: SyncOp['kind'];
  data: unknown;
  /** `at` der Operation (EpochMs, Entstehungszeit auf dem Gerät) */
  at: number;
  clockUncertain: boolean;
  origin: SyncOrigin;
  /** Vom Client vergeben. Fehlt sie (Server-Operation), erzeugt appendOp eine UUIDv7 */
  opId?: string;
  deviceId?: string | null;
}

export interface AppendOpResult {
  seq: number;
  opId: string;
  /** true: Die op_id war mit gleichem Strom, gleicher Art und gleichen Daten schon gespeichert. Nichts geschrieben */
  duplicate: boolean;
}

/** Gespeicherte Operation, wie sie der Hook nach dem Commit bekommt */
export interface CommittedOp {
  stream: string;
  seq: number;
  opId: string;
  kind: SyncOp['kind'];
  at: number;
  clockUncertain: boolean;
  data: unknown;
  origin: SyncOrigin;
  deviceId: string | null;
  receivedAt: Date;
}

export type OpCommittedHook = (op: CommittedOp) => void | Promise<void>;

const noop: OpCommittedHook = () => {};
let onOpCommitted: OpCommittedHook = noop;
let activeListeners = 0;

/**
 * Hook für den Versand nach dem Commit setzen (T1-08). `null` setzt den Standard (nichts tun) zurück.
 * Aufgerufen wird er nur, solange `listenCommittedOps` läuft. Darum zuerst den Listener starten.
 */
export function setOnOpCommitted(hook: OpCommittedHook | null): void {
  onOpCommitted = hook ?? noop;
  if (hook && activeListeners === 0) {
    console.warn(
      'setOnOpCommitted: Es läuft kein listenCommittedOps. Der Hook wird erst aufgerufen, wenn der Listener gestartet ist.',
    );
  }
}

type SyncOpRow = typeof syncOp.$inferSelect;

function toCommitted(row: SyncOpRow): CommittedOp {
  return {
    stream: row.stream,
    seq: row.seq,
    opId: row.opId,
    kind: row.kind as SyncOp['kind'],
    at: row.at,
    clockUncertain: row.clockUncertain,
    data: row.data,
    origin: row.origin as SyncOrigin,
    deviceId: row.deviceId,
    receivedAt: row.receivedAt,
  };
}

/**
 * Gespeicherte Operation zu einer `op_id` oder `null`. Der Dispatcher von T1-08 ruft das **zentral vor dem
 * Handler** auf (§16.2): gleiche Operation → ursprüngliches `ack`, abweichende → `op_id_reused`.
 */
export async function findOpById(db: DbOrTx, opId: string): Promise<CommittedOp | null> {
  const [row] = await db.select().from(syncOp).where(eq(syncOp.opId, opId));
  return row ? toCommitted(row) : null;
}

/** true, wenn `error` (auch verpackt) ein Unique-Verstoß auf `constraint` ist */
function isUniqueViolation(error: unknown, constraint: string): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 3; depth += 1) {
    const info = e as { code?: unknown; constraint_name?: unknown };
    if (info.code === '23505' && info.constraint_name === constraint) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Hängt eine Operation an `stream` an.
 *
 * - `seq` ist pro Strom lückenlos: Die Zeile in `sync_stream` bleibt bis zum Ende der Transaktion gesperrt,
 *   die Reihenfolge der `seq` entspricht damit der Commit-Reihenfolge.
 * - **Idempotenz:** Gibt es die `op_id` schon mit gleichem Strom, gleicher Art und gleichen Daten, liefert
 *   appendOp die ursprüngliche `seq` mit `duplicate = true` und schreibt nichts. Abweichend:
 *   `SyncOpError('op_id_reused', false)`. Dieselbe neue `op_id` gleichzeitig in zwei Strömen:
 *   `SyncOpError('internal_error', true)`, der Client sendet erneut und bekommt dann das Duplikat.
 * - Nach dem Commit ruft `listenCommittedOps` den Hook `onOpCommitted` auf, bei Rollback nie.
 */
export async function appendOp(tx: Tx, stream: string, op: AppendOpInput): Promise<AppendOpResult> {
  if (!STREAM_PATTERN.test(stream)) throw new Error(`Ungültige Strom-ID: ${stream}`);
  if (op.data === undefined) throw new Error('Operation ohne data');
  const dataJson = JSON.stringify(op.data);

  // 1. Strom anlegen und sperren. Zuerst sperren, dann die op_id prüfen: Zwei Transaktionen mit derselben
  //    op_id im selben Strom laufen so nacheinander, die zweite sieht die erste als Duplikat.
  await tx.insert(syncStream).values({ stream, headSeq: 0 }).onConflictDoNothing();
  const [head] = await tx
    .select({ headSeq: syncStream.headSeq })
    .from(syncStream)
    .where(eq(syncStream.stream, stream))
    .for('update');
  if (!head) throw new Error(`Strom ${stream} ließ sich nicht sperren`);

  // 2. Idempotenz
  if (op.opId !== undefined) {
    const [existing] = await tx
      .select({
        stream: syncOp.stream,
        seq: syncOp.seq,
        kind: syncOp.kind,
        sameData: sql<boolean>`${syncOp.data} = ${dataJson}::jsonb`,
      })
      .from(syncOp)
      .where(eq(syncOp.opId, op.opId));
    if (existing) {
      if (existing.stream !== stream || existing.kind !== op.kind || !existing.sameData) {
        throw new SyncOpError('op_id_reused', false, { op_id: op.opId });
      }
      return { seq: existing.seq, opId: op.opId, duplicate: true };
    }
  }

  // 3. Schreiben
  const seq = head.headSeq + 1;
  const opId = op.opId ?? uuidv7();
  try {
    await tx.insert(syncOp).values({
      stream,
      seq,
      opId,
      kind: op.kind,
      at: op.at,
      clockUncertain: op.clockUncertain,
      data: sql`${dataJson}::jsonb`,
      origin: op.origin,
      deviceId: op.deviceId ?? null,
    });
  } catch (error) {
    if (isUniqueViolation(error, 'sync_op_op_id_uq')) {
      throw new SyncOpError('internal_error', true, { op_id: opId, reason: 'op_id_gleichzeitig' });
    }
    throw error;
  }
  await tx.update(syncStream).set({ headSeq: seq }).where(eq(syncStream.stream, stream));

  // 4. Benachrichtigung nach dem Commit
  await tx.execute(sql`SELECT pg_notify(${SYNC_OP_CHANNEL}, ${JSON.stringify({ stream, seq })})`);
  return { seq, opId, duplicate: false };
}

/**
 * Hört auf committete Operationen und ruft für jede den Hook `onOpCommitted` auf, je Strom lückenlos in
 * `seq`-Reihenfolge und nacheinander.
 *
 * - Je Strom gibt es einen Cursor (zuletzt ausgelieferte `seq`). Eine Benachrichtigung liest alle Operationen
 *   des Stroms mit `seq > Cursor`.
 * - Beim Start werden die Cursor auf den aktuellen `head_seq` gesetzt (ältere Operationen kommen nicht).
 *   Nach jedem (Neu-)Aufbau der LISTEN-Verbindung gleicht der Listener alle Ströme mit `head_seq` ab und
 *   holt Verpasstes nach. Benachrichtigungen während einer Unterbrechung gehen so nicht verloren.
 * - Wirft der Hook, bleibt der Cursor stehen. Die nächste Benachrichtigung bzw. der nächste Abgleich versucht es erneut.
 *
 * `sqlClient` öffnet dafür eine eigene LISTEN-Verbindung. Rückgabe: Funktion zum Beenden.
 */
export async function listenCommittedOps(
  sqlClient: postgres.Sql,
  db: DbOrTx,
  onError: (error: unknown) => void = () => {},
): Promise<() => Promise<void>> {
  const cursors = new Map<string, number>();
  for (const h of await db.select().from(syncStream)) cursors.set(h.stream, h.headSeq);

  let chain: Promise<void> = Promise.resolve();
  const enqueue = (task: () => Promise<void>) => {
    chain = chain.then(task).catch(onError);
  };

  /** Alle Operationen eines Stroms nach dem Cursor ausliefern. Wirft der Hook, bleibt der Cursor stehen */
  async function dispatch(stream: string): Promise<void> {
    const rows = await db
      .select()
      .from(syncOp)
      .where(and(eq(syncOp.stream, stream), gt(syncOp.seq, cursors.get(stream) ?? 0)))
      .orderBy(asc(syncOp.seq));
    for (const row of rows) {
      await onOpCommitted(toCommitted(row));
      cursors.set(stream, row.seq);
    }
  }

  async function catchUp(): Promise<void> {
    for (const h of await db.select().from(syncStream)) {
      if (h.headSeq > (cursors.get(h.stream) ?? 0)) {
        try {
          await dispatch(h.stream);
        } catch (error) {
          onError(error);
        }
      }
    }
  }

  const subscription = await sqlClient.listen(
    SYNC_OP_CHANNEL,
    (payload) => {
      enqueue(async () => {
        const { stream } = JSON.parse(payload) as { stream: string; seq: number };
        await dispatch(stream);
      });
    },
    // Beim ersten LISTEN und nach jedem Neuverbinden
    () => enqueue(catchUp),
  );
  activeListeners += 1;
  return async () => {
    activeListeners -= 1;
    await subscription.unlisten();
    await chain;
  };
}
