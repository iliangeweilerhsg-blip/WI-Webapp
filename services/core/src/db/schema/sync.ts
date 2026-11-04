// Sync-Protokoll (VERTRAEGE §6.1, §11): Ströme, Operationen, Epoche.
// Kein deleted_at: sync_op bleibt erhalten, solange das Objekt des Stroms existiert, auch im Papierkorb.
// maintenance.nightly entfernt sync_stream (und per CASCADE sync_op) endgültig gelöschter Notizbücher und Sessions (§13).
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamptz } from './common.ts';

/** Kopf eines Stroms. `appendOp` sperrt die Zeile (`FOR UPDATE`) und vergibt `head_seq + 1` (§11.2) */
export const syncStream = pgTable('sync_stream', {
  stream: text('stream').primaryKey(), // notebook:<id> | session:<id> | user
  headSeq: bigint('head_seq', { mode: 'number' }).notNull().default(0),
});

/** Eine Operation eines Stroms. `seq` pro Strom lückenlos ab 1, `op_id` global eindeutig (Idempotenz) */
export const syncOp = pgTable(
  'sync_op',
  {
    stream: text('stream')
      .notNull()
      .references(() => syncStream.stream, { onDelete: 'cascade' }),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    opId: uuid('op_id').notNull().unique('sync_op_op_id_uq'),
    kind: text('kind').notNull(),
    at: bigint('at', { mode: 'number' }).notNull(), // EpochMs
    clockUncertain: boolean('clock_uncertain').notNull(),
    data: jsonb('data').$type<unknown>().notNull(),
    origin: text('origin').notNull(), // ipad | web | server
    deviceId: uuid('device_id'), // Gerät aus dem Token. Kein FK: der Verlauf bleibt auch nach dem Entfernen des Geräts lesbar
    receivedAt: timestamptz('received_at').notNull().defaultNow(),
  },
  (t) => [
    // UNIQUE (stream, seq) aus VERTRAEGE §6.1, als Primärschlüssel
    primaryKey({ name: 'sync_op_pkey', columns: [t.stream, t.seq] }),
    check('sync_op_seq_chk', sql`${t.seq} >= 1`),
    check('sync_op_origin_chk', sql`${t.origin} IN ('ipad','web','server')`),
  ],
);

/** Genau eine Zeile: Epoche der Datenbank für `welcome.db_epoch` (§11.1). `sg restore` setzt sie neu */
export const syncMeta = pgTable(
  'sync_meta',
  {
    id: smallint('id').primaryKey().default(1),
    dbEpoch: uuid('db_epoch').notNull(),
  },
  (t) => [check('sync_meta_single_row_chk', sql`${t.id} = 1`)],
);
