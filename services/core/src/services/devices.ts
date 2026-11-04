// Geräte und Kopplung (VERTRAEGE §5, §12, §16.2). Gerüst aus T1-DB, füllt T1-10.
import type { Db } from '../db/client.ts';

/** `sha256(token)` gegen `device.token_hash` gekoppelter, nicht gelöschter Geräte. `null` = unbekannt oder widerrufen */
export async function verifyDeviceToken(_db: Db, _token: string): Promise<{ deviceId: string } | null> {
  throw new Error('nicht umgesetzt');
}
