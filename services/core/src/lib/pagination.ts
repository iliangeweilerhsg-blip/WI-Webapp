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

const TS_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?[+-](\d{2})(?::(\d{2}))?$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Prüft Format und Gültigkeit des Zeitstempels (`created_at::text`). Nur so scheitert der Cast
 * `::timestamptz` nie in Postgres (sonst 500 statt 400): echtes Kalenderdatum, Jahr 1..9999,
 * Uhrzeit 00:00:00..23:59:59 und Offset bis ±15:59 (Postgres-Grenze). Bleibt als Text erhalten,
 * damit Mikrosekunden verlustfrei bleiben.
 */
export function isValidTimestamp(ts: string): boolean {
  const m = TS_RE.exec(ts);
  if (!m) return false;
  const [year, month, day, hour, minute, second, offHour, offMinute] = [
    m[1],
    m[2],
    m[3],
    m[4],
    m[5],
    m[6],
    m[7],
    m[8] ?? '0',
  ].map(Number) as [number, number, number, number, number, number, number, number];
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
  if (day > daysInMonth) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  return offHour <= 15 && offMinute <= 59;
}

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
  if (typeof ts !== 'string' || typeof id !== 'string' || !isValidTimestamp(ts) || !UUID_RE.test(id)) {
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
