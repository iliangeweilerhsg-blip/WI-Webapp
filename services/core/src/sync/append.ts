// Operation an einen Strom anhängen (VERTRAEGE §11.2, §16.2). Fertig gebaut in T1-DB.
//
// Ablauf in der Transaktion des Aufrufers:
//   1. sync_stream-Zeile anlegen bzw. sperren und head_seq + 1 vergeben (ein Upsert, die Zeilensperre gilt bis zum Commit),
//   2. sync_op schreiben,
//   3. pg_notify('sg_sync_op', …) – Postgres stellt die Benachrichtigung erst NACH dem Commit zu, bei Rollback nie.
// `listenCommittedOps` (startet T1-08 beim Core-Start) hört darauf und ruft den Hook `onOpCommitted` auf.
// So braucht kein Aufrufer einen eigenen Transaktions-Wrapper: jede `db.transaction` funktioniert.
import { and, eq, sql } from 'drizzle-orm';
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

/** Hook für den Versand nach dem Commit setzen (T1-08). `null` setzt den Standard (nichts tun) zurück. */
export function setOnOpCommitted(hook: OpCommittedHook | null): void {
  onOpCommitted = hook ?? noop;
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

/** Gespeicherte Operation zu einer `op_id` oder `null` (z. B. für das erneute `ack`, §11.2) */
export async function findOpById(db: DbOrTx, opId: string): Promise<CommittedOp | null> {
  const [row] = await db.select().from(syncOp).where(eq(syncOp.opId, opId));
  return row ? toCommitted(row) : null;
}

/**
 * Hängt eine Operation an `stream` an und gibt `seq` und `op_id` zurück.
 *
 * - `seq` ist pro Strom lückenlos: Die Zeile in `sync_stream` bleibt bis zum Ende der Transaktion gesperrt,
 *   die Reihenfolge der `seq` entspricht damit der Commit-Reihenfolge.
 * - **Idempotenz:** Gibt es die `op_id` schon mit gleichem Strom, gleicher Art und gleichen Daten, liefert
 *   appendOp die ursprüngliche `seq` und schreibt nichts. Sonst `SyncOpError('op_id_reused', false)`.
 *   Die fachliche Änderung prüft der Aufrufer vorher selbst (`findOpById`), sonst liefe sie doppelt.
 * - Nach dem Commit ruft `listenCommittedOps` den Hook `onOpCommitted` auf, bei Rollback nie.
 */
export async function appendOp(
  tx: Tx,
  stream: string,
  op: AppendOpInput,
): Promise<{ seq: number; opId: string }> {
  if (!STREAM_PATTERN.test(stream)) throw new Error(`Ungültige Strom-ID: ${stream}`);
  if (op.data === undefined) throw new Error('Operation ohne data');
  const dataJson = JSON.stringify(op.data);

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
      return { seq: existing.seq, opId: op.opId };
    }
  }

  // Anlegen oder sperren und hochzählen in einem Schritt. ON CONFLICT DO UPDATE sperrt die Zeile wie SELECT … FOR UPDATE.
  const [head] = await tx
    .insert(syncStream)
    .values({ stream, headSeq: 1 })
    .onConflictDoUpdate({ target: syncStream.stream, set: { headSeq: sql`${syncStream.headSeq} + 1` } })
    .returning({ headSeq: syncStream.headSeq });
  if (!head) throw new Error(`Strom ${stream} ließ sich nicht sperren`);
  const seq = head.headSeq;
  const opId = op.opId ?? uuidv7();

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
  await tx.execute(sql`SELECT pg_notify(${SYNC_OP_CHANNEL}, ${JSON.stringify({ stream, seq })})`);
  return { seq, opId };
}

/**
 * Hört auf committete Operationen und ruft für jede den Hook `onOpCommitted` auf, in Commit-Reihenfolge
 * und nacheinander. `sqlClient` öffnet dafür eine eigene LISTEN-Verbindung.
 * Rückgabe: Funktion zum Beenden (wartet auf laufende Hook-Aufrufe).
 */
export async function listenCommittedOps(
  sqlClient: postgres.Sql,
  db: DbOrTx,
  onError: (error: unknown) => void = () => {},
): Promise<() => Promise<void>> {
  let chain: Promise<void> = Promise.resolve();
  const subscription = await sqlClient.listen(SYNC_OP_CHANNEL, (payload) => {
    chain = chain.then(async () => {
      try {
        const { stream, seq } = JSON.parse(payload) as { stream: string; seq: number };
        const [row] = await db
          .select()
          .from(syncOp)
          .where(and(eq(syncOp.stream, stream), eq(syncOp.seq, seq)));
        if (!row) return; // inzwischen endgültig gelöscht
        await onOpCommitted(toCommitted(row));
      } catch (error) {
        onError(error);
      }
    });
  });
  return async () => {
    await subscription.unlisten();
    await chain;
  };
}
