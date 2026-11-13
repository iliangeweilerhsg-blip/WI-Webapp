// Verarbeitungskette nach dem Session-Ende (VERTRAEGE §18.2 und §20.2, 05 §2):
// audio.finalize → transcribe und audio.finalize → align.log, danach
// transcribe + align.log → concepts.extract → concepts.resolve → summary.write und daneben
// concepts.resolve → cards.generate (§21.3).
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
import { ensureSearchIndexJob } from './search-backfill.ts';
import { emitSessionUpdated } from './sessions.ts';

type JobRow = typeof job.$inferSelect;

/** Schritte mit der Session als Einheit (alle außer `audio.finalize`) */
type SessionStep = Exclude<PipelineStep, 'audio.finalize'>;

/**
 * Priorität der Jobs (VERTRAEGE §18.2, §20.2): Transkription > Ausrichtung > alles für die Nacharbeitung, und das
 * über `search.index` (5).
 */
const PRIORITY: Record<SessionStep, number> = {
  transcribe: 20,
  'align.log': 10,
  'concepts.extract': 8,
  'concepts.resolve': 7,
  'summary.write': 6,
  // §21.3: niedrigste Priorität der Kette, auch unter `search.index` (5)
  'cards.generate': 4,
};

export interface EnsurePipelineOptions {
  /** Erster Schritt, der neu angelegt wird. Alle späteren laufen mit */
  fromStep: PipelineStep;
  /**
   * `audio.finalize` (fertige Jobs neu anlegen) und `transcribe` (`payload.force`) wie §18.2. Bei den Schritten aus
   * §20.2 nur für den Schritt `fromStep` selbst: Folgeschritte erkennen geänderte Eingaben über ihren `input_hash`
   * und rufen sonst die KI nicht erneut auf (Kosten).
   */
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

/** Die Abhängigkeiten, die noch tragen: Job vorhanden, nicht gelöscht und weder `fehler` noch `abgebrochen` (Reihenfolge bleibt) */
async function usableDependencies(tx: Tx, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await tx
    .select({ id: job.id })
    .from(job)
    .where(
      and(inArray(job.id, ids), isNull(job.deletedAt), inArray(job.state, ['wartet', 'laeuft', 'fertig'])),
    );
  const alive = new Set(rows.map((r) => r.id));
  return ids.filter((id) => alive.has(id));
}

interface SessionJobSpec {
  type: SessionStep;
  /** Vorgänger dieses Aufrufs (angelegt oder wiederverwendet), kommen in `depends_on` */
  predecessors: string[];
  /** `payload.force` setzen (bei einem wartenden Job: `alt ODER neu`) */
  force: boolean;
  /** Weitere Payload-Felder, die auch ein wiederverwendeter Job neu bekommt (`extract_job_id`) */
  extra?: Record<string, unknown>;
}

/**
 * Ein Schritt mit der Session als Einheit (§18.2 Schritte 2 und 3, §20.2 Schritte 5 bis 7). Ein wartender Job wird
 * wiederverwendet: `depends_on` bereinigt und um die Vorgänger ergänzt, `force` wird zu `alt ODER neu`, `extra`
 * überschreibt. Sonst entsteht ein neuer Job, der von den Vorgängern und einem laufenden Job desselben Typs abhängt.
 */
async function ensureSessionJob(tx: Tx, sessionId: string, spec: SessionJobSpec): Promise<JobRow> {
  const { type, predecessors, force } = spec;
  const [waiting] = await sessionJobs(tx, sessionId, type, ['wartet']);
  if (waiting) {
    const payload = { ...waiting.payload, ...spec.extra, ...(force ? { force: true } : {}) };
    // Abhängigkeiten in `fehler`/`abgebrochen` oder gelöscht (bzw. nicht mehr vorhanden) fallen weg, sonst bricht
    // der Worker den Job ab und „Mit vorhandenem Audio fortfahren“ scheitert still (VERTRAEGE §18.2).
    const kept = await usableDependencies(tx, waiting.dependsOn);
    const [updated] = await tx
      .update(job)
      .set({ payload, dependsOn: union(kept, predecessors), updatedAt: sql`now()` })
      .where(eq(job.id, waiting.id))
      .returning();
    return updated ?? waiting;
  }
  const running = await sessionJobs(tx, sessionId, type, ['laeuft']);
  const payload: Record<string, unknown> = {
    session_id: sessionId,
    ...spec.extra,
    ...(force ? { force: true } : {}),
  };
  return insertJob(tx, {
    type,
    payload,
    priority: PRIORITY[type],
    dependsOn: union(
      predecessors,
      running.map((r) => r.id),
    ),
    sessionId,
  });
}

/**
 * Der `concepts.extract`-Job, auf dem `concepts.resolve` bei `fromStep = concepts.resolve` aufsetzt (§20.2): der
 * neueste nicht gelöschte der Session, der noch trägt. Das ist der neueste `fertig`e, außer es wartet oder läuft
 * schon ein neuerer: Dann gehört der wartende `concepts.resolve` zu diesem Lauf und bleibt an ihm hängen (sonst
 * hinge er von dem laufenden Job ab und läse das Ergebnis des älteren). `null`: keiner, die Kette beginnt dann bei
 * `concepts.extract`.
 */
async function latestExtractJob(tx: Tx, sessionId: string): Promise<JobRow | null> {
  const [row] = await sessionJobs(tx, sessionId, 'concepts.extract', ['wartet', 'laeuft', 'fertig']);
  return row ?? null;
}

/**
 * Zusammenfassung des Fortschritts je Job-Typ (VERTRAEGE §18.2, Referenz-SQL): Je Einheit zählt nur der neueste
 * nicht gelöschte Job, ein laufender Job der Einheit macht sie `laeuft`. Einheit ist bei `audio.finalize` die
 * Aufnahme, sonst die Session (auch bei den Schritten aus §20.2). `null`, wenn es keinen Job des Typs gibt (der Schlüssel bleibt dann unverändert).
 * Muss mit `SUMMARY_SQL` im Worker (`progress.py`) übereinstimmen.
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
 * Kette anlegen (VERTRAEGE §18.2, §20.2). Rückgabe: die angelegten oder wiederverwendeten Jobs in Ketten-Reihenfolge
 * (`audio.finalize` je Aufnahme nach ID, `transcribe`, `align.log`, `concepts.extract`, `concepts.resolve`,
 * `summary.write`, `cards.generate`).
 *
 * | `fromStep`         | angelegt bzw. wiederverwendet                                                        |
 * |--------------------|--------------------------------------------------------------------------------------|
 * | `audio.finalize`   | alles                                                                                |
 * | `transcribe`       | ab `transcribe`                                                                      |
 * | `align.log`        | `align.log`, danach die drei Konzept-Schritte                                        |
 * | `concepts.extract` | die drei Konzept-Schritte (`concepts.extract` nur hinter einem laufenden desselben Typs) |
 * | `concepts.resolve` | `concepts.resolve` auf dem neuesten `concepts.extract`, danach `summary.write` und `cards.generate`. Gibt es keinen, wie `concepts.extract` |
 * | `summary.write`    | nur `summary.write`, kein `cards.generate`                                           |
 * | `cards.generate`   | nur `cards.generate` (§21.3), ohne `depends_on` außer einem laufenden Job desselben Typs |
 *
 * Danach wird `session.processing` für jeden berührten Typ neu gerechnet (nie pauschal `wartet`), `updated_at`
 * angehoben und `session.updated` gesendet.
 */
export async function ensurePipelineJobs(
  tx: Tx,
  sessionId: string,
  options: EnsurePipelineOptions,
): Promise<JobRow[]> {
  let fromStep = options.fromStep;
  const force = options.force ?? false;
  const jobs: JobRow[] = [];
  const touched: PipelineStep[] = [];
  const add = (type: PipelineStep, row: JobRow): JobRow => {
    jobs.push(row);
    touched.push(type);
    return row;
  };

  if (fromStep === 'audio.finalize') {
    const finalize = await ensureFinalizeJobs(tx, sessionId, force);
    jobs.push(...finalize);
    if (finalize.length > 0) touched.push('audio.finalize');
  }

  // Schritte 2 und 3 (§18.2). Ihre Jobs sind die Vorgänger von `concepts.extract`
  const inputJobs: string[] = [];
  const fromAudio = fromStep === 'audio.finalize' || fromStep === 'transcribe';
  if (fromAudio || fromStep === 'align.log') {
    // Nach Schritt 1 lesen: auch ein eben angelegter Job ist offen
    const openFinalizeIds = (await sessionJobs(tx, sessionId, 'audio.finalize', ['wartet', 'laeuft']))
      .map((j) => j.id)
      .reverse();
    if (fromAudio) {
      const transcribeJob = add(
        'transcribe',
        await ensureSessionJob(tx, sessionId, { type: 'transcribe', predecessors: openFinalizeIds, force }),
      );
      inputJobs.push(transcribeJob.id);
      // Suchindex des Gesagten nach dem Transkript (§19.5). `job.session_id` bleibt NULL, kein Eintrag in
      // `processing` und nicht in der Rückgabe (die Kette der Session, §18.2/§18.5, bleibt unverändert)
      await ensureSearchIndexJob(tx, { scope: 'session', id: sessionId }, [transcribeJob.id]);
    }
    const alignJob = add(
      'align.log',
      await ensureSessionJob(tx, sessionId, {
        type: 'align.log',
        predecessors: openFinalizeIds,
        force: false,
      }),
    );
    inputJobs.push(alignJob.id);
  }

  if (fromStep === 'cards.generate') {
    // Nur dieser Schritt (§21.3): ohne `depends_on` außer einem laufenden Job desselben Typs, `force` wirkt hier
    add(
      'cards.generate',
      await ensureSessionJob(tx, sessionId, { type: 'cards.generate', predecessors: [], force }),
    );
  } else {
    // Schritte 5 bis 7 (§20.2)
    let summaryAfter: string[] = [];
    let resolveId: string | null = null;
    if (fromStep !== 'summary.write') {
      let extractJob = fromStep === 'concepts.resolve' ? await latestExtractJob(tx, sessionId) : null;
      // Ohne brauchbaren `concepts.extract` gilt `from_step = concepts.extract` (§20.2), auch für `force`
      if (fromStep === 'concepts.resolve' && !extractJob) fromStep = 'concepts.extract';
      extractJob ??= add(
        'concepts.extract',
        await ensureSessionJob(tx, sessionId, {
          type: 'concepts.extract',
          predecessors: inputJobs,
          force: force && fromStep === 'concepts.extract',
        }),
      );
      const resolveJob = add(
        'concepts.resolve',
        await ensureSessionJob(tx, sessionId, {
          type: 'concepts.resolve',
          predecessors: [extractJob.id],
          force: force && fromStep === 'concepts.resolve',
          extra: { extract_job_id: extractJob.id },
        }),
      );
      summaryAfter = [resolveJob.id];
      resolveId = resolveJob.id;
    }
    add(
      'summary.write',
      await ensureSessionJob(tx, sessionId, {
        type: 'summary.write',
        predecessors: summaryAfter,
        force: force && fromStep === 'summary.write',
      }),
    );
    // Schritt 8 (§21.3): Karten zu allen Konzepten der Session, daneben zu `summary.write`. `force` gilt nur für
    // `from_step = cards.generate`, sonst erkennt der Job geänderte Eingaben über den `input_hash`.
    // `summary.write` allein legt keinen Karten-Job an.
    if (resolveId) {
      add(
        'cards.generate',
        await ensureSessionJob(tx, sessionId, {
          type: 'cards.generate',
          predecessors: [resolveId],
          force: false,
        }),
      );
    }
  }

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
