// Sitzungszeit nach Serveruhr (VERTRAEGE §9.3, #332). Ein Gerät, das eine Session offline mit eigenem `started_at`
// begonnen hat, rechnet `t_ms`/`t_start_ms` gegen seinen eigenen Start. Der Core speichert die Rohwerte unverändert und
// liefert die umgerechnete Zeit zusätzlich aus: `t_session_ms` an Markern und Fotos, `stroke_offsets_ms` an den
// Strichen einer Seite. Das Gerät einer Zeile kennt nur `sync_op.device_id` der Operation, die sie angelegt hat.
//
// Teuer ist nur der Blick in `sync_op`. Er läuft darum nur, wenn die Session überhaupt einen Eintrag in
// `start_offsets` hat (Normalfall: keiner).
import type { SessionStartOffset } from '@sg/shared';
import { eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client.ts';
import { session } from '../db/schema/index.ts';

/** Gerät → Versatz (ms). Pro Gerät gilt der erste Eintrag (§9.3) */
export type DeviceOffsets = ReadonlyMap<string, number>;

export function deviceOffsets(entries: readonly SessionStartOffset[] | null | undefined): DeviceOffsets {
  const out = new Map<string, number>();
  for (const entry of entries ?? []) {
    const device = entry.device_id.toLowerCase();
    if (!out.has(device) && Number.isInteger(entry.offset_ms)) out.set(device, entry.offset_ms);
  }
  return out;
}

/** Sitzungszeit nach Serveruhr: `t + Versatz`, nie unter 0 (SessionMs) */
export const sessionTime = (t: number, offsetMs: number | undefined): number =>
  Math.max(0, t + (offsetMs ?? 0));

/** Versatz je Objekt-ID: `ids` → Gerät der Operation → Versatz. Nur Einträge mit Versatz ≠ 0 */
function pickOffsets(rows: readonly { id: string; device_id: string | null }[], offsets: DeviceOffsets) {
  const out = new Map<string, number>();
  for (const row of rows) {
    const offset = row.device_id ? offsets.get(row.device_id.toLowerCase()) : undefined;
    if (offset) out.set(row.id, offset);
  }
  return out;
}

/**
 * Versatz der Marker bzw. Fotos einer Session, nach ID. Maßgeblich ist die **erste** Operation je ID im Strom
 * `session:<id>`: `marker.add` und `photo.add` legen die Zeile nur einmal an (`ON CONFLICT DO NOTHING`).
 */
export async function sessionItemOffsets(
  tx: DbOrTx,
  sessionId: string,
  offsets: DeviceOffsets,
  kind: 'marker.add' | 'photo.add',
): Promise<Map<string, number>> {
  if (offsets.size === 0) return new Map();
  // Feste Spaltenausdrücke statt Parameter: DISTINCT ON und ORDER BY müssen derselbe Ausdruck sein
  const key = sql.raw(kind === 'marker.add' ? `data->>'marker_id'` : `data->>'photo_id'`);
  const rows = await tx.execute<{ id: string; device_id: string | null }>(sql`
    SELECT DISTINCT ON (${key}) ${key} AS id, device_id::text AS device_id
    FROM sync_op
    WHERE stream = ${`session:${sessionId}`} AND kind = ${kind}
    ORDER BY ${key}, seq`);
  return pickOffsets(rows, offsets);
}

/** `start_offsets` einer Session (auch einer weich gelöschten), leer, wenn es sie nicht gibt */
export async function sessionOffsets(tx: DbOrTx, sessionId: string | null): Promise<DeviceOffsets> {
  if (!sessionId) return new Map();
  const [row] = await tx
    .select({ startOffsets: session.startOffsets })
    .from(session)
    .where(eq(session.id, sessionId));
  return deviceOffsets(row?.startOffsets);
}

/** Versatz eines einzelnen Fotos bzw. Markers (für `GET /photos/{id}`) */
export async function itemOffset(
  tx: DbOrTx,
  sessionId: string,
  id: string,
  kind: 'marker.add' | 'photo.add',
): Promise<number> {
  const offsets = await sessionOffsets(tx, sessionId);
  if (offsets.size === 0) return 0;
  const key = sql.raw(kind === 'marker.add' ? `data->>'marker_id'` : `data->>'photo_id'`);
  const rows = await tx.execute<{ id: string; device_id: string | null }>(sql`
    SELECT ${key} AS id, device_id::text AS device_id
    FROM sync_op
    WHERE stream = ${`session:${sessionId}`} AND kind = ${kind} AND ${key} = ${id}
    ORDER BY seq
    LIMIT 1`);
  return pickOffsets(rows, offsets).get(id) ?? 0;
}

/**
 * Versatz der Striche einer Seite (`client_id` → ms), aus `start_offsets` der Session der Seite (`page.session_id`).
 * Maßgeblich ist die **letzte** `stroke.add` je `client_id` im Strom des Notizbuchs: Der Upsert übernimmt ihre Werte.
 * Nur Striche, die hier übergeben werden (mit `t_start_ms`), und nur Versatz ≠ 0.
 */
export async function strokeOffsets(
  tx: DbOrTx,
  page: { id: string; notebookId: string; sessionId: string | null },
  clientIds: readonly string[],
): Promise<Record<string, number>> {
  if (clientIds.length === 0) return {};
  const offsets = await sessionOffsets(tx, page.sessionId);
  if (offsets.size === 0) return {};
  const rows = await tx.execute<{ id: string; device_id: string | null }>(sql`
    SELECT DISTINCT ON (data->'stroke'->>'client_id') data->'stroke'->>'client_id' AS id, device_id::text AS device_id
    FROM sync_op
    WHERE stream = ${`notebook:${page.notebookId}`} AND kind = 'stroke.add' AND data->>'page_id' = ${page.id}
    ORDER BY data->'stroke'->>'client_id', seq DESC`);
  const wanted = new Set(clientIds);
  const out: Record<string, number> = {};
  for (const [id, offset] of pickOffsets(rows, offsets)) if (wanted.has(id)) out[id] = offset;
  return out;
}
