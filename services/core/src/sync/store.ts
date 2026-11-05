// DB-Zugriffe des Sync-Servers: Epoche, Resume-Prüfung (§11.1), Nachlieferung, Geräte-Angaben.
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import type { SyncResume, SyncStreamPosition } from '@sg/shared';
import type { DbOrTx } from '../db/client.ts';
import { device, syncMeta, syncOp, syncStream } from '../db/schema/index.ts';
import { toCommitted, type CommittedOp } from './append.ts';

/** JSON mit sortierten Schlüsseln: gleiche Daten ergeben denselben Text, egal in welcher Reihenfolge (jsonb sortiert um) */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export async function readDbEpoch(db: DbOrTx): Promise<string> {
  const [row] = await db.select({ dbEpoch: syncMeta.dbEpoch }).from(syncMeta).where(eq(syncMeta.id, 1));
  if (!row) throw new Error('sync_meta hat keine Zeile (Migration fehlt?)');
  return row.dbEpoch;
}

/** Aktuelle Köpfe aller Ströme (Startwert der Cursor) */
export async function readStreamHeads(db: DbOrTx): Promise<Map<string, number>> {
  const heads = new Map<string, number>();
  for (const row of await db.select().from(syncStream)) heads.set(row.stream, row.headSeq);
  return heads;
}

/**
 * Resume-Tabelle aus VERTRAEGE §11.1, Zeile für Zeile:
 *
 * | Client meldet                     | Server hat                                       | Antwort                    |
 * | `last_seq = 0`, `last_op_id=null` | beliebig                                         | `from_seq = 1`, kein reset |
 * | `last_seq = n`, `last_op_id = x`  | Operation `n` mit `op_id = x`                    | `from_seq = n + 1`         |
 * | `last_seq = n`                    | `head_seq < n` oder Operation `n` mit anderer ID | `from_seq = 1`, `reset`    |
 *
 * Lücke im Vertrag: `last_seq = 0` mit einer `last_op_id` passt zu keiner Zeile. Sicherere Wahl: `reset`
 * (der Client lädt per REST, der Server sendet nichts). `last_seq = n > 0` mit `last_op_id = null` ist
 * „andere op_id“, also ebenfalls `reset`.
 */
export async function computeResume(db: DbOrTx, positions: SyncStreamPosition[]): Promise<SyncResume[]> {
  if (positions.length === 0) return [];
  // Ströme sind per Schema geprüft (nur [a-z0-9:-]), Zahlen ganzzahlig: das Array-Literal ist sicher
  const streams = `{${positions.map((p) => p.stream).join(',')}}`;
  const seqs = `{${positions.map((p) => String(p.last_seq)).join(',')}}`;
  const rows = await db.execute<{ stream: string; head_seq: string | number; op_id: string | null }>(sql`
    SELECT p.stream, coalesce(s.head_seq, 0) AS head_seq, o.op_id
    FROM unnest(${streams}::text[], ${seqs}::int8[]) AS p(stream, seq)
    LEFT JOIN sync_stream s ON s.stream = p.stream
    LEFT JOIN sync_op o ON o.stream = p.stream AND o.seq = p.seq`);
  const byStream = new Map<string, { head: number; opId: string | null }>();
  for (const row of rows) byStream.set(row.stream, { head: Number(row.head_seq), opId: row.op_id });

  return positions.map((p) => {
    const found = byStream.get(p.stream) ?? { head: 0, opId: null };
    const reset = { stream: p.stream, from_seq: 1, head_seq: found.head, reset: true };
    if (p.last_seq === 0) {
      return p.last_op_id === null ? { ...reset, reset: false } : reset;
    }
    if (found.head < p.last_seq || found.opId === null || found.opId !== p.last_op_id) return reset;
    return { stream: p.stream, from_seq: p.last_seq + 1, head_seq: found.head, reset: false };
  });
}

/** Operationen eines Stroms mit `seq > afterSeq`, aufsteigend, höchstens `limit` */
export async function loadOpsAfter(
  db: DbOrTx,
  stream: string,
  afterSeq: number,
  limit: number,
): Promise<CommittedOp[]> {
  const rows = await db
    .select()
    .from(syncOp)
    .where(and(eq(syncOp.stream, stream), gt(syncOp.seq, afterSeq)))
    .orderBy(asc(syncOp.seq))
    .limit(limit);
  return rows.map(toCommitted);
}

/** Name des Geräts für `presence` (gelöschte Geräte: `null`) */
export async function readDeviceName(db: DbOrTx, deviceId: string): Promise<string | null> {
  const [row] = await db
    .select({ name: device.name })
    .from(device)
    .where(and(eq(device.id, deviceId), sql`${device.deletedAt} IS NULL`));
  return row?.name ?? null;
}

/** `hello.app_version` am Gerät vermerken */
export async function storeAppVersion(db: DbOrTx, deviceId: string, appVersion: string): Promise<void> {
  await db
    .update(device)
    .set({ appVersion, updatedAt: new Date() })
    .where(and(eq(device.id, deviceId), sql`${device.appVersion} IS DISTINCT FROM ${appVersion}`));
}

/** `time.offset` in `device.clock_offset_ms` speichern (§11.5) */
export async function storeClockOffset(db: DbOrTx, deviceId: string, offsetMs: number): Promise<void> {
  await db
    .update(device)
    .set({ clockOffsetMs: offsetMs, updatedAt: new Date() })
    .where(eq(device.id, deviceId));
}
