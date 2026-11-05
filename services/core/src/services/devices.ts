// Geräte (VERTRAEGE §5, §7.5, §12, §16.2): Token prüfen, auflisten, anlegen, widerrufen.
import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { SINGLE_USER_ID, type Device, type DeviceKind, type DeviceList } from '@sg/shared';
import type { Db } from '../db/client.ts';
import { device } from '../db/schema/index.ts';
import { HttpError } from '../errors.ts';
import { afterCursor, cursorTs, decodeCursor, keysetOrder, toPage } from '../lib/pagination.ts';
import { uuidv7 } from '../lib/uuid7.ts';

type DeviceRow = typeof device.$inferSelect;

/** Geräte-Token: 32 Byte Zufall, base64url ohne Padding = genau 43 Zeichen (`PairResponse.device_token`) */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** `last_seen_at` wird höchstens so oft geschrieben (VERTRAEGE §5) */
export const LAST_SEEN_INTERVAL_MS = 60_000;

/** Neues Geräte-Token aus `crypto.randomBytes` (256 Bit). Wird nur einmal ausgegeben, nie gespeichert oder geloggt */
export function generateDeviceToken(): string {
  return randomBytes(32).toString('base64url');
}

/** `sha256(token)` als Hex, so steht es in `device.token_hash` */
export function hashDeviceToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * `sha256(token)` gegen `device.token_hash` gekoppelter, nicht gelöschter Geräte. `null` = unbekannt oder
 * widerrufen. Kein Cache: Ein widerrufenes Gerät ist mit dem Commit von `revokeDevice` sofort ungültig.
 *
 * Die Suche läuft über den Hash (Unique-Index). Ein Zeitunterschied verrät höchstens etwas über Hashes, nicht
 * über Tokens; ein Vergleich in konstanter Zeit ist hier darum nicht nötig.
 */
export async function verifyDeviceToken(db: Db, token: string): Promise<{ deviceId: string } | null> {
  if (!TOKEN_RE.test(token)) return null;
  const [row] = await db
    .select({ id: device.id })
    .from(device)
    .where(and(eq(device.tokenHash, hashDeviceToken(token)), isNull(device.deletedAt)))
    .limit(1);
  return row ? { deviceId: row.id } : null;
}

/**
 * Setzt `last_seen_at` höchstens einmal pro Minute und Gerät (VERTRAEGE §5). Merkt sich den letzten Schreibzeitpunkt
 * im Speicher und prüft ihn zusätzlich in SQL, damit auch mehrere Instanzen (Tests) nicht öfter schreiben.
 */
export class LastSeenTracker {
  private readonly written = new Map<string, number>();
  private readonly db: Db;
  private readonly now: () => number;

  constructor(db: Db, now: () => number = Date.now) {
    this.db = db;
    this.now = now;
  }

  /** `true`, wenn geschrieben wurde. Fehler wirft die Funktion weiter (der Aufrufer protokolliert sie) */
  async touch(deviceId: string): Promise<boolean> {
    const now = this.now();
    const last = this.written.get(deviceId);
    if (last !== undefined && now - last < LAST_SEEN_INTERVAL_MS) return false;
    this.written.set(deviceId, now);
    if (this.written.size > 1000) this.prune(now);
    const rows = await this.db
      .update(device)
      .set({ lastSeenAt: sql`now()` })
      .where(
        and(
          eq(device.id, deviceId),
          isNull(device.deletedAt),
          sql`(${device.lastSeenAt} IS NULL OR ${device.lastSeenAt} < now() - make_interval(secs => ${LAST_SEEN_INTERVAL_MS / 1000}))`,
        ),
      )
      .returning({ id: device.id });
    return rows.length > 0;
  }

  private prune(now: number): void {
    for (const [id, at] of this.written) if (now - at >= LAST_SEEN_INTERVAL_MS) this.written.delete(id);
  }
}

function toApiDevice(row: DeviceRow, connected: boolean): Device {
  return {
    id: row.id,
    user_id: row.userId,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    deleted_at: row.deletedAt?.toISOString() ?? null,
    name: row.name,
    kind: row.kind as DeviceKind,
    last_seen_at: row.lastSeenAt?.toISOString() ?? null,
    clock_offset_ms: row.clockOffsetMs,
    app_version: row.appVersion,
    connected,
  };
}

/** Gekoppelte Geräte, älteste zuerst. `isConnected` liefert das abgeleitete Feld `connected` */
export async function listDevices(
  db: Db,
  query: { cursor?: string | undefined; limit: number },
  isConnected: (deviceId: string) => boolean,
): Promise<DeviceList> {
  const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
  const rows = await db
    .select({ row: device, ts: cursorTs(device.createdAt) })
    .from(device)
    .where(and(isNull(device.deletedAt), afterCursor(device.createdAt, device.id, cursor, 'asc')))
    .orderBy(...keysetOrder(device.createdAt, device.id, 'asc'))
    .limit(query.limit + 1);
  return toPage(
    rows,
    query.limit,
    (r) => ({ ts: r.ts, id: r.row.id }),
    (r) => toApiDevice(r.row, isConnected(r.row.id)),
  );
}

/** Legt ein gekoppeltes Gerät an. Rückgabe: das Gerät und das Token (nur dieses eine Mal im Klartext) */
export async function createDevice(
  db: Db,
  input: { name: string; kind: DeviceKind; appVersion: string | null },
): Promise<{ device: Device; token: string }> {
  const token = generateDeviceToken();
  const [row] = await db
    .insert(device)
    .values({
      id: uuidv7(),
      userId: SINGLE_USER_ID,
      name: input.name,
      kind: input.kind,
      tokenHash: hashDeviceToken(token),
      appVersion: input.appVersion,
      lastSeenAt: sql`now()`,
    })
    .returning();
  if (!row) throw new Error('Gerät wurde nicht angelegt');
  return { device: toApiDevice(row, false), token };
}

const revoked = new EventEmitter();
// Viele Zuhörer sind in Tests normal (eine App pro Datei)
revoked.setMaxListeners(100);

/**
 * Hook für den Sync-Server (VERTRAEGE §16.2): wird nach dem Commit von `revokeDevice` aufgerufen, synchron und
 * genau einmal je Widerruf. Rückgabe: Abmelden. Fehler eines Zuhörers werden protokolliert (über `onError`)
 * und stören weder andere Zuhörer noch die Antwort.
 */
export function onDeviceRevoked(listener: (deviceId: string) => void): () => void {
  revoked.on('revoked', listener);
  return () => {
    revoked.off('revoked', listener);
  };
}

/** Ruft alle Zuhörer von `onDeviceRevoked` auf. Rückgabe: die aufgetretenen Fehler */
export function emitDeviceRevoked(deviceId: string): unknown[] {
  const errors: unknown[] = [];
  for (const listener of revoked.listeners('revoked') as ((id: string) => void)[]) {
    try {
      listener(deviceId);
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

/**
 * Widerruft ein Gerät (`DELETE /devices/{id}`): `deleted_at` setzen. Ab dem Commit ist das Token ungültig
 * (`verifyDeviceToken` liest ohne Cache). Geräte kommen nicht in den Papierkorb (kein `TrashKind`): Ein
 * Wiederherstellen würde ein widerrufenes Token wieder gültig machen.
 */
export async function revokeDevice(db: Db, id: string): Promise<void> {
  const rows = await db
    .update(device)
    .set({ deletedAt: sql`now()` })
    .where(and(eq(device.id, id), isNull(device.deletedAt)))
    .returning({ id: device.id });
  if (rows.length === 0) throw new HttpError(404, 'device_not_found', 'Dieses Gerät gibt es nicht.');
}
