// Server-Ereignisse an die Clients (VERTRAEGE §11.6, §16.2). Gerüst aus T1-DB, füllt T1-08.
import type { SyncEvent } from '@sg/shared';
import type { Tx } from '../db/client.ts';

/** Kanal für Ereignisse nach dem Commit (gleicher Weg wie `sg_sync_op` in append.ts) */
export const SYNC_EVENT_CHANNEL = 'sg_event';

/** Größte erlaubte Nutzlast von `publishAfterCommit` in Byte (NOTIFY erlaubt knapp 8000) */
export const MAX_EVENT_PAYLOAD_BYTES = 7000;

/** Ereignis sofort an alle verbundenen Clients senden. `localOnly`: nur lokale Web-Clients (`pairing.requested`) */
export function publishEvent(_event: SyncEvent, _opts?: { localOnly?: boolean }): void {
  throw new Error('nicht umgesetzt');
}

/**
 * Ereignis erst nach dem Commit dieser Transaktion senden, bei Rollback gar nicht.
 *
 * Vorgabe für T1-08 (VERTRAEGE §16.2): `SELECT pg_notify('sg_event', <Event-JSON>)` in `tx`, das Ereignis steht
 * vollständig in der Nutzlast. Ist das JSON größer als `MAX_EVENT_PAYLOAD_BYTES` (UTF-8), wirft die Funktion.
 * Ein Listener auf `sg_event` ruft danach `publishEvent` auf.
 */
export async function publishAfterCommit(_tx: Tx, _event: SyncEvent): Promise<void> {
  throw new Error('nicht umgesetzt');
}
