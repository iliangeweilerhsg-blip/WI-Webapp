import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { ZodType } from 'zod';
import {
  AlignLogPayloadSchema,
  AudioFinalizePayloadSchema,
  ConceptsExtractPayloadSchema,
  ConceptsResolvePayloadSchema,
  PdfIngestPayloadSchema,
  SearchIndexPayloadSchema,
  SINGLE_USER_ID,
  SummaryWritePayloadSchema,
  TranscribePayloadSchema,
  type Job,
  type JobState,
  type JobType,
} from '@sg/shared';
import type { DbOrTx, Tx } from '../db/client.ts';
import { job } from '../db/schema/index.ts';
import { notDeleted } from '../db/schema/common.ts';
import { uuidv7 } from '../lib/uuid7.ts';
import { afterCursor, cursorTs, decodeCursor, keysetOrder, toPage, type Page } from '../lib/pagination.ts';

/** NOTIFY-Kanal, auf dem der Worker lauscht (docs/VERTRAEGE.md §3) */
export const JOB_NOTIFY_CHANNEL = 'sg_jobs';

/**
 * Zod-Schemas der Job-Payloads (08 §5). `enqueueJob` prüft damit vor dem INSERT.
 * Für Typen ohne Eintrag gibt es in @sg/shared noch kein Schema: ihr Payload wird vorerst nicht geprüft.
 * Neue Schemas hier ergänzen, sobald der Job-Typ gebaut wird.
 */
export const JOB_PAYLOAD_SCHEMAS: Partial<Record<JobType, ZodType>> = {
  'pdf.ingest': PdfIngestPayloadSchema,
  'audio.finalize': AudioFinalizePayloadSchema,
  transcribe: TranscribePayloadSchema,
  'align.log': AlignLogPayloadSchema,
  'search.index': SearchIndexPayloadSchema,
  // Konzept-Kette (VERTRAEGE §20.2)
  'concepts.extract': ConceptsExtractPayloadSchema,
  'concepts.resolve': ConceptsResolvePayloadSchema,
  'summary.write': SummaryWritePayloadSchema,
};

export interface EnqueueJobInput {
  type: JobType;
  payload: Record<string, unknown>;
  priority?: number;
  /** IDs von Jobs, die zuerst `fertig` sein müssen */
  dependsOn?: string[];
  sessionId?: string;
  maxAttempts?: number;
  runAfter?: Date;
}

/**
 * Legt einen Job in der übergebenen Transaktion an, zusammen mit der fachlichen Änderung
 * (VERTRAEGE §3). Die Benachrichtigung `pg_notify('sg_jobs', <id>)` läuft in derselben
 * Transaktion: Postgres stellt NOTIFY erst beim Commit zu und verwirft es bei einem Rollback.
 * So bekommt der Worker nie eine Meldung zu einem Job, den es (noch) nicht gibt.
 *
 * Gibt die ID des Jobs zurück. Muss in `db.transaction(async (tx) => …)` aufgerufen werden.
 */
export async function enqueueJob(tx: Tx, input: EnqueueJobInput): Promise<string> {
  const schema = JOB_PAYLOAD_SCHEMAS[input.type];
  if (schema) {
    const parsed = schema.safeParse(input.payload);
    if (!parsed.success) {
      throw new Error(`Ungültiges Payload für Job ${input.type}: ${parsed.error.message}`);
    }
  }
  const id = uuidv7();
  await tx.insert(job).values({
    id,
    userId: SINGLE_USER_ID,
    type: input.type,
    payload: input.payload,
    priority: input.priority ?? 0,
    dependsOn: input.dependsOn ?? [],
    sessionId: input.sessionId ?? null,
    ...(input.maxAttempts !== undefined ? { maxAttempts: input.maxAttempts } : {}),
    runAfter: input.runAfter ?? null,
  });
  await tx.execute(sql`SELECT pg_notify(${JOB_NOTIFY_CHANNEL}, ${id})`);
  return id;
}

type JobRow = typeof job.$inferSelect;

/** Datenbankzeile → API-Typ `Job` (Zeitstempel als ISO 8601) */
export function toApiJob(row: JobRow): Job {
  return {
    id: row.id,
    user_id: row.userId,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    deleted_at: row.deletedAt?.toISOString() ?? null,
    type: row.type as JobType,
    payload: row.payload,
    state: row.state as JobState,
    priority: row.priority,
    attempts: row.attempts,
    max_attempts: row.maxAttempts,
    depends_on: row.dependsOn,
    session_id: row.sessionId,
    locked_by: row.lockedBy,
    locked_at: row.lockedAt?.toISOString() ?? null,
    error: row.error,
    result: row.result ?? null,
    run_after: row.runAfter?.toISOString() ?? null,
  };
}

export interface ListJobsOptions {
  sessionId?: string | undefined;
  state?: JobState | undefined;
  cursor?: string | undefined;
  limit: number;
}

/** Jobs, neueste zuerst, mit Cursor-Paginierung */
export async function listJobs(db: DbOrTx, options: ListJobsOptions): Promise<Page<Job>> {
  const conditions: (SQL | undefined)[] = [
    notDeleted(job),
    options.sessionId ? eq(job.sessionId, options.sessionId) : undefined,
    options.state ? eq(job.state, options.state) : undefined,
    afterCursor(job.createdAt, job.id, options.cursor ? decodeCursor(options.cursor) : undefined, 'desc'),
  ];
  const rows = await db
    .select({ row: job, ts: cursorTs(job.createdAt) })
    .from(job)
    .where(and(...conditions))
    .orderBy(...keysetOrder(job.createdAt, job.id, 'desc'))
    .limit(options.limit + 1);
  return toPage(
    rows,
    options.limit,
    (r) => ({ ts: r.ts, id: r.row.id }),
    (r) => toApiJob(r.row),
  );
}
