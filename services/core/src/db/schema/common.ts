import { isNull, type SQL } from 'drizzle-orm';
import { timestamp, uuid, vector, type AnyPgColumn } from 'drizzle-orm/pg-core';

/** Zeitstempel mit Zeitzone (UTC, 03 §1) */
export const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

/** `embedding vector(1024)` (bge-m3, 03 §1). Index dazu: HNSW mit Cosinus (`vector_cosine_ops`). */
export const embedding = () => vector('embedding', { dimensions: 1024 });

/** Pflichtfelder jeder Tabelle (03 §1). IDs (UUIDv7) erzeugt die Anwendung, nicht die DB. */
export function baseColumns() {
  return {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    deletedAt: timestamptz('deleted_at'),
  };
}

/** Soft-Delete-Filter: nur aktive Zeilen (`deleted_at IS NULL`). */
export function notDeleted(table: { deletedAt: AnyPgColumn }): SQL {
  return isNull(table.deletedAt);
}
