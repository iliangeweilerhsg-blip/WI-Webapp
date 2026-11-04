// System (03 §13, Job-Tabelle verbindlich nach docs/VERTRAEGE.md §3)
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  real,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { baseColumns, timestamptz } from './common.ts';

export const job = pgTable(
  'job',
  {
    ...baseColumns(),
    type: text('type').notNull(),
    payload: jsonb('payload')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    state: text('state').notNull().default('wartet'),
    priority: integer('priority').notNull().default(0), // höher = früher
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    dependsOn: uuid('depends_on')
      .array()
      .notNull()
      .default(sql`'{}'`),
    sessionId: uuid('session_id'),
    lockedBy: text('locked_by'),
    lockedAt: timestamptz('locked_at'),
    error: text('error'),
    result: jsonb('result').$type<Record<string, unknown>>(),
    runAfter: timestamptz('run_after'),
  },
  (t) => [
    check('job_state_chk', sql`${t.state} IN ('wartet','laeuft','fertig','fehler','abgebrochen')`),
    index('job_pick_idx')
      .on(t.priority.desc().nullsFirst(), t.createdAt)
      .where(sql`${t.state} = 'wartet' AND ${t.deletedAt} IS NULL`),
    index('job_session_idx').on(t.sessionId),
    // Listen (GET /jobs): Cursor über (created_at, id)
    index('job_created_idx').on(t.createdAt.desc().nullsFirst(), t.id.desc().nullsFirst()),
  ],
);

export const setting = pgTable('setting', {
  // `key` ist der Primärschlüssel (03 §13), darum ohne eigene `id`
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  userId: uuid('user_id').notNull(),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  deletedAt: timestamptz('deleted_at'),
});

export const device = pgTable('device', {
  ...baseColumns(),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  tokenHash: text('token_hash').notNull().unique(), // SHA-256 des Geräte-Tokens
  lastSeenAt: timestamptz('last_seen_at'),
  clockOffsetMs: integer('clock_offset_ms').notNull().default(0),
  appVersion: text('app_version'),
});

export const backupRun = pgTable('backup_run', {
  ...baseColumns(),
  startedAt: timestamptz('started_at').notNull(),
  finishedAt: timestamptz('finished_at'),
  target: text('target').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }),
  state: text('state').notNull(),
  error: text('error'),
});

export const costEntry = pgTable(
  'cost_entry',
  {
    ...baseColumns(),
    jobId: uuid('job_id').references(() => job.id, { onDelete: 'set null' }),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    task: text('task').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    audioSeconds: real('audio_seconds').notNull().default(0),
    costEstimateEur: numeric('cost_estimate_eur', { mode: 'number' }).notNull().default(0),
  },
  (t) => [index('cost_entry_job_idx').on(t.jobId), index('cost_entry_created_idx').on(t.createdAt)],
);

/** Gespeicherte erste Antworten für `Idempotency-Key` (08 §1). Einträge älter als 24 h werden beim Start gelöscht. */
export const idempotencyKey = pgTable(
  'idempotency_key',
  {
    key: uuid('key').notNull(),
    method: text('method').notNull(),
    path: text('path').notNull(),
    requestHash: text('request_hash').notNull(),
    status: integer('status').notNull(),
    response: jsonb('response').$type<unknown>(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.key, t.method, t.path] }),
    index('idempotency_key_created_idx').on(t.createdAt),
  ],
);
