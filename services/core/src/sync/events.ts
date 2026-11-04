// Server-Ereignisse an die Clients (VERTRAEGE §11.6, §16.2). Gerüst aus T1-DB, füllt T1-08.
import type { SyncEvent } from '@sg/shared';
import type { Tx } from '../db/client.ts';

/** Ereignis sofort an alle verbundenen Clients senden. `localOnly`: nur lokale Web-Clients (`pairing.requested`) */
export function publishEvent(_event: SyncEvent, _opts?: { localOnly?: boolean }): void {
  throw new Error('nicht umgesetzt');
}

/** Ereignis erst nach dem Commit dieser Transaktion senden, bei Rollback gar nicht */
export function publishAfterCommit(_tx: Tx, _event: SyncEvent): void {
  throw new Error('nicht umgesetzt');
}
