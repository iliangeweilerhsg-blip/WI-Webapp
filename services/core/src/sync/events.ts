// Server-Ereignisse an die Clients (VERTRAEGE §11.6, §16.2).
import { sql } from 'drizzle-orm';
import { SyncEventSchema, type SyncEvent } from '@sg/shared';
import type { Tx } from '../db/client.ts';
import { getActiveHub } from './hub.ts';

/** Kanal für Ereignisse nach dem Commit (gleicher Weg wie `sg_sync_op` in append.ts) */
export const SYNC_EVENT_CHANNEL = 'sg_event';

/** Größte erlaubte Nutzlast von `publishAfterCommit` in Byte (NOTIFY erlaubt knapp 8000) */
export const MAX_EVENT_PAYLOAD_BYTES = 7000;

/**
 * Ereignis sofort an alle verbundenen Clients senden (nach `welcome`). Ereignisse werden nicht nachgeliefert.
 *
 * `localOnly`: nur an lokale Clients (`request.sgDevice === null`, also die Web-App am Mac).
 * `pairing.requested` geht immer nur lokal (§12), auch ohne die Option.
 * Läuft kein Sync-Server (Unit-Tests, Skripte), passiert nichts.
 */
export function publishEvent(event: SyncEvent, opts?: { localOnly?: boolean }): void {
  const hub = getActiveHub();
  if (!hub) return;
  const localOnly = opts?.localOnly === true || event.name === 'pairing.requested';
  hub.broadcastEvent(event, { localOnly });
}

/**
 * Ereignis erst nach dem Commit dieser Transaktion senden, bei Rollback gar nicht.
 *
 * `SELECT pg_notify('sg_event', <Event-JSON>)` in `tx`. Postgres stellt die Benachrichtigung nach dem Commit zu,
 * der Listener (server.ts) ruft dann `publishEvent` auf, und zwar über dieselbe serielle Kette wie die
 * Operationen: Ein Ereignis kommt nie vor den Operationen derselben Transaktion an.
 * Ist das JSON größer als `MAX_EVENT_PAYLOAD_BYTES` (UTF-8), wirft die Funktion.
 */
export async function publishAfterCommit(tx: Tx, event: SyncEvent): Promise<void> {
  const json = JSON.stringify(event);
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes > MAX_EVENT_PAYLOAD_BYTES) {
    throw new Error(
      `Ereignis ${event.name} ist zu groß für NOTIFY (${bytes} > ${MAX_EVENT_PAYLOAD_BYTES} Byte)`,
    );
  }
  await tx.execute(sql`SELECT pg_notify(${SYNC_EVENT_CHANNEL}, ${json})`);
}

/** Benachrichtigung auf `sg_event` → `publishEvent`. Ungültige Nutzlast wird protokolliert und verworfen */
export function handleEventNotification(payload: string): void {
  const hub = getActiveHub();
  let parsed: ReturnType<typeof SyncEventSchema.safeParse>;
  try {
    parsed = SyncEventSchema.safeParse(JSON.parse(payload));
  } catch (error) {
    hub?.logger.error({ err: error }, 'Sync: Ereignis aus sg_event ist kein JSON');
    return;
  }
  if (!parsed.success) {
    hub?.logger.error(
      { issues: parsed.error.issues.slice(0, 3) },
      'Sync: Ereignis aus sg_event ist ungültig',
    );
    return;
  }
  publishEvent(parsed.data);
}
