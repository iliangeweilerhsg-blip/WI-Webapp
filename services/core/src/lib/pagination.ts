import { asc, desc, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { HttpError } from '../errors.ts';

/**
 * Cursor-Paginierung (08 §1), stabil über `(created_at, id)`.
 *
 * Der Zeitstempel im Cursor ist der Datenbank-Text (`created_at::text`, Mikrosekunden-genau),
 * nicht ein JS-Date. Sonst würden Zeilen mit gleicher Millisekunde doppelt oder gar nicht geliefert.
 */
export interface CursorKey {
  ts: string;
  id: string;
}

export type SortDir = 'asc' | 'desc';

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

/** Query-Parameter `?cursor&limit` für Listen-Endpunkte */
export const PageQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
});

const TS_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function encodeCursor(key: CursorKey): string {
  return Buffer.from(JSON.stringify([key.ts, key.id]), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): CursorKey {
  const invalid = () => new HttpError(400, 'invalid_cursor', 'Der Cursor ist ungültig.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) throw invalid();
  const [ts, id] = parsed as unknown[];
  if (typeof ts !== 'string' || typeof id !== 'string' || !TS_RE.test(ts) || !UUID_RE.test(id)) {
    throw invalid();
  }
  return { ts, id };
}

/** Zusatzspalte fürs SELECT: `created_at` als Text für den Cursor */
export function cursorTs(createdAt: AnyPgColumn): SQL<string> {
  return sql<string>`${createdAt}::text`;
}

/** WHERE-Bedingung „hinter dem Cursor“; `undefined` ohne Cursor */
export function afterCursor(
  createdAt: AnyPgColumn,
  id: AnyPgColumn,
  cursor: CursorKey | undefined,
  dir: SortDir,
): SQL | undefined {
  if (!cursor) return undefined;
  const op = dir === 'desc' ? sql`<` : sql`>`;
  return sql`(${createdAt}, ${id}) ${op} (${cursor.ts}::timestamptz, ${cursor.id}::uuid)`;
}

/** ORDER BY (created_at, id) */
export function keysetOrder(createdAt: AnyPgColumn, id: AnyPgColumn, dir: SortDir): SQL[] {
  const by = dir === 'desc' ? desc : asc;
  return [by(createdAt), by(id)];
}

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

/**
 * Schneidet die um eins zu lange Ergebnisliste (`LIMIT limit + 1`) auf `limit` zurück und
 * bildet den Cursor aus der letzten gelieferten Zeile.
 */
export function toPage<R, T>(
  rows: R[],
  limit: number,
  keyOf: (row: R) => CursorKey,
  mapItem: (row: R) => T,
): Page<T> {
  const hasMore = rows.length > limit;
  const visible = hasMore ? rows.slice(0, limit) : rows;
  const last = visible.at(-1);
  return {
    items: visible.map(mapItem),
    next_cursor: hasMore && last ? encodeCursor(keyOf(last)) : null,
  };
}
