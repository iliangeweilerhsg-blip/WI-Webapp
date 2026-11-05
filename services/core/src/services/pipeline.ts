// Verarbeitungskette nach dem Session-Ende (VERTRAEGE §18.2, 05 §2):
// audio.finalize → transcribe und audio.finalize → align.log.
//
// `ensurePipelineJobs` legt die Jobs an oder verwendet wartende wieder und rechnet `session.processing` mit
// derselben Regel wie der Worker („neuester Job je Einheit“, `summarizeProcessing`). Der Aufrufer hält die
// Session-Zeile (`FOR NO KEY UPDATE`). Sperrreihenfolge wie §16.2: Session → `lockRecording` (nur bei
// `fromStep = audio.finalize`, nach ID sortiert) → Job-Zeilen.
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { AudioFinalizePayloadSchema, type JobState, type PipelineStep } from '@sg/shared';
import type { Tx } from '../db/client.ts';
import { audioChunk, job, recording, session } from '../db/schema/index.ts';
import { enqueueJob, JOB_NOTIFY_CHANNEL } from './jobs.ts';
import { lockRecording } from './recordings.ts';
import { emitSessionUpdated } from './sessions.ts';

type JobRow = typeof job.$inferSelect;

/** Priorität der Jobs (VERTRAEGE §18.2): `transcribe` wird bei freiem Worker vor `align.log` geholt */
const PRIORITY = { transcribe: 20, 'align.log': 10 } as const;

export interface EnsurePipelineOptions {
  /** Erster Schritt, der neu angelegt wird. Alle späteren laufen mit */
  fromStep: PipelineStep;
  /** Nur für `audio.finalize` (fertige Jobs neu anlegen) und `transcribe` (`payload.force`) */
  force?: boolean;
  /** `false`: kein `session.updated` senden (der Aufrufer sendet es selbst, z. B. `finishSession`) */
  emit?: boolean;
}

/** Aufnahmen der Session (nicht gelöscht) mit mindestens einem nicht gelöschten Chunk, nach ID sortiert */
export async function recordingsWithChunks(tx: Tx, sessionId: string): Promise<string[]> {
  const rows = await tx
    .select({ id: recording.id })
    .from(recording)
    .where(
      and(
        eq(recording.sessionId, sessionId),
        isNull(recording.deletedAt),
        sql`EXISTS (SELECT 1 FROM ${audioChunk} WHERE ${audioChunk.recordingId} = ${recording.id} AND ${audioChunk.deletedAt} IS NULL)`,
      ),
    )
    .orderBy(asc(recording.id));
  return rows.map((r) => r.id);
}

/** Neuester nicht gelöschter `audio.finalize`-Job der Aufnahme, gesperrt (der Worker holt mit SKIP LOCKED) */
async function latestFinalizeJob(tx: Tx, recordingId: string): Promise<JobRow | null> {
  const [row] = await tx
    .select()
    .from(job)
    .where(
      and(
        eq(job.type, 'audio.finalize'),
        sql`${job.payload}->>'recording_id' = ${recordingId}`,
        isNull(job.deletedAt),
      ),
    )
    .orderBy(desc(job.createdAt), desc(job.id))
    .limit(1)
    .for('update');
  return row ?? null;
}

async function insertJob(tx: Tx, input: Parameters<typeof enqueueJob>[1]): Promise<JobRow> {
  const id = await enqueueJob(tx, input);
  const [created] = await tx.select().from(job).where(eq(job.id, id));
  if (!created) throw new Error('Job nach dem Anlegen nicht lesbar');
  return created;
}

/** Schritt 1: je Aufnahme mit Chunks der neueste `audio.finalize`-Job (§18.2). Rückgabe: angelegte oder wiederverwendete Jobs */
async function ensureFinalizeJobs(tx: Tx, sessionId: string, force: boolean): Promise<JobRow[]> {
  const result: JobRow[] = [];
  for (const recordingId of await recordingsWithChunks(tx, sessionId)) {
    await lockRecording(tx, recordingId);
    const latest = await latestFinalizeJob(tx, recordingId);
    if (latest?.state === 'wartet') {
      const [updated] = await tx
        .update(job)
        .set({ runAfter: sql`now()`, updatedAt: sql`now()` })
        .where(eq(job.id, latest.id))
        .returning();
      await tx.execute(sql`SELECT pg_notify(${JOB_NOTIFY_CHANNEL}, ${latest.id})`);
      result.push(updated ?? latest);
    } else if (latest?.state === 'laeuft') {
      result.push(latest);
    } else if (latest?.state === 'fertig' && !force) {
      // Das Audio ist aktuell: nichts neu erzeugen
    } else {
      const payload = { recording_id: recordingId };
      AudioFinalizePayloadSchema.parse(payload);
      result.push(await insertJob(tx, { type: 'audio.finalize', payload, sessionId }));
    }
  }
  return result;
}

/** Jobs eines Typs der Session in einem der Zustände (nicht gelöscht), neueste zuerst, gesperrt */
async function sessionJobs(tx: Tx, sessionId: string, type: string, states: JobState[]): Promise<JobRow[]> {
  return tx
    .select()
    .from(job)
    .where(
      and(
        eq(job.sessionId, sessionId),
        eq(job.type, type),
        inArray(job.state, states),
        isNull(job.deletedAt),
      ),
    )
    .orderBy(desc(job.createdAt), desc(job.id))
    .for('update');
}

const union = (...lists: string[][]): string[] => [...new Set(lists.flat())];

/**
 * Schritte 2 und 3: `transcribe` bzw. `align.log` der Session. Ein wartender Job wird wiederverwendet (`depends_on`
 * um die offenen `audio.finalize`-Jobs ergänzt, bei `transcribe` wird `force` zu `alt ODER neu`). Sonst entsteht ein
 * neuer Job, der von den offenen `audio.finalize`-Jobs und einem laufenden Job desselben Typs abhängt.
 */
async function ensureSessionJob(
  tx: Tx,
  sessionId: string,
  type: 'transcribe' | 'align.log',
  openFinalizeIds: string[],
  force: boolean,
): Promise<JobRow> {
  const [waiting] = await sessionJobs(tx, sessionId, type, ['wartet']);
  if (waiting) {
    const payload = type === 'transcribe' && force ? { ...waiting.payload, force: true } : waiting.payload;
    const [updated] = await tx
      .update(job)
      .set({ payload, dependsOn: union(waiting.dependsOn, openFinalizeIds), updatedAt: sql`now()` })
      .where(eq(job.id, waiting.id))
      .returning();
    return updated ?? waiting;
  }
  const running = await sessionJobs(tx, sessionId, type, ['laeuft']);
  const payload: Record<string, unknown> =
    type === 'transcribe' && force ? { session_id: sessionId, force: true } : { session_id: sessionId };
  return insertJob(tx, {
    type,
    payload,
    priority: PRIORITY[type],
    dependsOn: union(
      openFinalizeIds,
      running.map((r) => r.id),
    ),
    sessionId,
  });
}

/**
 * Zusammenfassung des Fortschritts je Job-Typ (VERTRAEGE §18.2, Referenz-SQL): Je Einheit zählt nur der neueste
 * nicht gelöschte Job, ein laufender Job der Einheit macht sie `laeuft`. Einheit ist bei `audio.finalize` die
 * Aufnahme, sonst die Session. `null`, wenn es keinen Job des Typs gibt (der Schlüssel bleibt dann unverändert).
 * Muss mit `_SUMMARY_SQL` im Worker (`progress.py`) übereinstimmen.
 */
export async function summarizeProcessing(
  tx: Tx,
  sessionId: string,
  type: PipelineStep,
): Promise<JobState | null> {
  const rows = await tx.execute<{ state: JobState | null }>(sql`
    WITH j AS (
      SELECT state, created_at, id,
             CASE WHEN type = 'audio.finalize' THEN payload->>'recording_id' ELSE '' END AS unit
      FROM job WHERE session_id = ${sessionId} AND type = ${type} AND deleted_at IS NULL
    ), u AS (
      SELECT DISTINCT ON (unit)
             CASE WHEN bool_or(state = 'laeuft') OVER (PARTITION BY unit) THEN 'laeuft' ELSE state END AS state
      FROM j ORDER BY unit, created_at DESC, id DESC
    )
    SELECT CASE WHEN count(*) = 0 THEN NULL
                WHEN bool_or(state = 'fehler') THEN 'fehler'
                WHEN bool_or(state = 'laeuft') THEN 'laeuft'
                WHEN bool_or(state = 'wartet') THEN 'wartet'
                WHEN bool_or(state = 'fertig') THEN 'fertig'
                ELSE 'abgebrochen' END AS state
    FROM u`);
  return rows[0]?.state ?? null;
}

/**
 * Kette anlegen (VERTRAEGE §18.2). Rückgabe: die angelegten oder wiederverwendeten Jobs in Ketten-Reihenfolge
 * (`audio.finalize` je Aufnahme nach ID, `transcribe`, `align.log`).
 *
 * `fromStep = audio.finalize`: auch `audio.finalize`. `transcribe`: ab `transcribe`. `align.log`: nur `align.log`.
 * Danach wird `session.processing` für jeden berührten Typ neu gerechnet (nie pauschal `wartet`), `updated_at`
 * angehoben und `session.updated` gesendet.
 */
export async function ensurePipelineJobs(
  tx: Tx,
  sessionId: string,
  options: EnsurePipelineOptions,
): Promise<JobRow[]> {
  const { fromStep } = options;
  const force = options.force ?? false;
  const jobs: JobRow[] = [];
  const touched: PipelineStep[] = [];

  if (fromStep === 'audio.finalize') {
    const finalize = await ensureFinalizeJobs(tx, sessionId, force);
    jobs.push(...finalize);
    if (finalize.length > 0) touched.push('audio.finalize');
  }
  // Nach Schritt 1 lesen: auch ein eben angelegter Job ist offen
  const openFinalizeIds = (await sessionJobs(tx, sessionId, 'audio.finalize', ['wartet', 'laeuft']))
    .map((j) => j.id)
    .reverse();

  if (fromStep === 'audio.finalize' || fromStep === 'transcribe') {
    jobs.push(await ensureSessionJob(tx, sessionId, 'transcribe', openFinalizeIds, force));
    touched.push('transcribe');
  }
  jobs.push(await ensureSessionJob(tx, sessionId, 'align.log', openFinalizeIds, false));
  touched.push('align.log');

  const patch: Record<string, JobState> = {};
  for (const type of touched) {
    const state = await summarizeProcessing(tx, sessionId, type);
    if (state) patch[type] = state;
  }
  await tx
    .update(session)
    .set({
      processing: sql`coalesce(${session.processing}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
      updatedAt: sql`greatest(clock_timestamp(), ${session.updatedAt} + interval '1 millisecond')`,
    })
    .where(eq(session.id, sessionId));
  if (options.emit !== false) await emitSessionUpdated(tx, sessionId);
  return jobs;
}
