// Jobs `search.index` anlegen und nachholen (VERTRAEGE §19.5). Ticket T2-12.
//
// - `ensureSearchIndexJob`: von `material.ts` (Foliensatz, nach `pdf.ingest`) und `pipeline.ts` (Session, nach
//   `transcribe`) in deren Transaktion aufgerufen. Ein wartender Job des Ziels wird wiederverwendet.
// - `runSearchBackfill`: beim Start des Core und danach alle 10 min. Holt fehlende oder veraltete Indizes nach.
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import { SearchIndexPayloadSchema, type SearchIndexPayload } from '@sg/shared';
import type { Config } from '../config.ts';
import type { Db, Tx } from '../db/client.ts';
import { job } from '../db/schema/index.ts';
import { WorkerClient } from '../lib/worker-client.ts';
import { enqueueJob, JOB_NOTIFY_CHANNEL } from './jobs.ts';

/** Muss mit `SEARCH_INDEX_VERSION` im Worker übereinstimmen (§19.3). Wer ihn ändert, ändert ihn an beiden Stellen und in §19.5 */
export const SEARCH_INDEX_VERSION = 1;
/** Priorität beim Anlegen nach `pdf.ingest`/`transcribe` (§19.3) */
export const SEARCH_INDEX_PRIORITY = 5;
/** Priorität nachgeholter Jobs: hält die Kette nach einer Vorlesung nicht auf (§19.5) */
export const BACKFILL_PRIORITY = -5;
/** Höchstens so viele neue Jobs je Lauf (§19.5) */
export const BACKFILL_MAX_JOBS = 50;
export const BACKFILL_INTERVAL_MS = 10 * 60 * 1000;

type JobRow = typeof job.$inferSelect;

/** Abhängigkeiten, die noch tragen: vorhanden, nicht gelöscht, weder `fehler` noch `abgebrochen` (wie `pipeline.ts`) */
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

/**
 * `search.index` für ein Ziel anlegen oder einen wartenden wiederverwenden (§19.5). Beim Wiederverwenden (Zeile
 * `FOR UPDATE`) fallen zuerst tote Abhängigkeiten weg (`fehler`, `abgebrochen`, gelöscht, nicht vorhanden), dann
 * kommen `dependsOn` dazu; die Priorität wird höchstens angehoben. `job.session_id` bleibt immer `NULL` (§19.3).
 */
export async function ensureSearchIndexJob(
  tx: Tx,
  target: SearchIndexPayload,
  dependsOn: string[],
  priority: number = SEARCH_INDEX_PRIORITY,
): Promise<JobRow> {
  const payload = SearchIndexPayloadSchema.parse(target);
  const [waiting] = await tx
    .select()
    .from(job)
    .where(
      and(
        eq(job.type, 'search.index'),
        eq(job.state, 'wartet'),
        isNull(job.deletedAt),
        sql`${job.payload}->>'scope' = ${payload.scope}`,
        sql`${job.payload}->>'id' = ${payload.id}`,
      ),
    )
    .orderBy(desc(job.createdAt), desc(job.id))
    .limit(1)
    .for('update');
  if (waiting) {
    const kept = await usableDependencies(tx, waiting.dependsOn);
    const [updated] = await tx
      .update(job)
      .set({
        dependsOn: [...new Set([...kept, ...dependsOn])],
        priority: sql`greatest(${job.priority}, ${priority})`,
        updatedAt: sql`now()`,
      })
      .where(eq(job.id, waiting.id))
      .returning();
    await tx.execute(sql`SELECT pg_notify(${JOB_NOTIFY_CHANNEL}, ${waiting.id})`);
    return updated ?? waiting;
  }
  const id = await enqueueJob(tx, { type: 'search.index', payload, priority, dependsOn });
  const [created] = await tx.select().from(job).where(eq(job.id, id));
  if (!created) throw new Error('Job nach dem Anlegen nicht lesbar');
  return created;
}

export interface BackfillDeps {
  db: Db;
  /** Für `GET /health`. Ist der Worker nicht erreichbar, entfällt die Modell-Bedingung */
  worker: Pick<WorkerClient, 'health'>;
}

export interface BackfillResult {
  /** Modell des Embedders, falls er laut `/health` `bereit` war, sonst `null` */
  model: string | null;
  created: SearchIndexPayload[];
}

/** Modell des Embedders, wenn er `bereit` ist; sonst (nicht erreichbar, lädt, nicht verfügbar) `null` */
async function readyModel(worker: Pick<WorkerClient, 'health'>): Promise<string | null> {
  try {
    const health = await worker.health();
    return health.embedder.state === 'bereit' ? health.embedder.model : null;
  } catch {
    return null;
  }
}

/**
 * Ein Lauf des Nachholens (§19.5). Ziele: nicht gelöschte Foliensätze mit `ingest_state = 'verarbeitet'` und nicht
 * gelöschte Sessions mit mindestens einem nicht gelöschten Transkript, jeweils mit nicht gelöschtem Modul.
 * Maßgeblich ist der neueste nicht gelöschte `search.index` des Ziels. Höchstens `BACKFILL_MAX_JOBS` neue Jobs,
 * ältestes Ziel zuerst, `priority = -5`.
 */
export async function runSearchBackfill(deps: BackfillDeps): Promise<BackfillResult> {
  const model = await readyModel(deps.worker);
  const modelCondition = model
    ? sql`OR (l.result->>'embedding_model') IS DISTINCT FROM ${model}::text`
    : sql``;
  return deps.db.transaction(async (tx) => {
    const due = await tx.execute<{ scope: 'deck' | 'session'; id: string }>(sql`
      WITH targets AS (
        SELECT 'deck'::text AS scope, d.id, d.created_at
        FROM slide_deck d JOIN module m ON m.id = d.module_id
        WHERE d.deleted_at IS NULL AND m.deleted_at IS NULL AND d.ingest_state = 'verarbeitet'
        UNION ALL
        SELECT 'session'::text, s.id, s.created_at
        FROM session s JOIN module m ON m.id = s.module_id
        WHERE s.deleted_at IS NULL AND m.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM transcript t WHERE t.session_id = s.id AND t.deleted_at IS NULL)
      ), latest AS (
        SELECT DISTINCT ON (payload->>'scope', payload->>'id')
               payload->>'scope' AS scope, payload->>'id' AS id, state, result, updated_at
        FROM job
        WHERE type = 'search.index' AND deleted_at IS NULL
        ORDER BY payload->>'scope', payload->>'id', created_at DESC, id DESC
      )
      SELECT t.scope, t.id
      FROM targets t
      LEFT JOIN latest l ON l.scope = t.scope AND l.id = t.id::text
      WHERE l.state IS NULL
         OR (l.state = 'fertig' AND (
              l.result->>'deleted' = 'true'
              OR l.result->>'missing' = 'true'
              OR (l.result->>'index_version') IS DISTINCT FROM ${String(SEARCH_INDEX_VERSION)}::text
              ${modelCondition}))
         OR (l.state IN ('fehler', 'abgebrochen') AND l.updated_at < now() - interval '24 hours')
      ORDER BY t.created_at, t.id
      LIMIT ${BACKFILL_MAX_JOBS}`);
    const created: SearchIndexPayload[] = [];
    for (const row of due) {
      const payload = SearchIndexPayloadSchema.parse({ scope: row.scope, id: row.id });
      await enqueueJob(tx, { type: 'search.index', payload, priority: BACKFILL_PRIORITY });
      created.push(payload);
    }
    return { model, created };
  });
}

export interface SearchBackfillHandle {
  /** Stoppt den Takt und wartet auf einen laufenden Lauf */
  stop: () => Promise<void>;
}

/** Startet das Nachholen: sofort einmal, danach alle `intervalMs`. Läufe überlappen nie */
export function startSearchBackfill(
  deps: BackfillDeps & { logger: Logger },
  intervalMs: number = BACKFILL_INTERVAL_MS,
): SearchBackfillHandle {
  let running: Promise<void> | null = null;
  let stopped = false;
  const tick = () => {
    if (stopped || running) return;
    running = runSearchBackfill(deps)
      .then((result) => {
        if (result.created.length > 0) {
          deps.logger.info(
            { count: result.created.length, model: result.model },
            'Suchindex: Jobs nachgeholt',
          );
        }
      })
      .catch((error: unknown) => deps.logger.warn({ err: error }, 'Suchindex: Nachholen fehlgeschlagen'))
      .finally(() => {
        running = null;
      });
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  tick();
  return {
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      await running;
    },
  };
}

/**
 * In `buildApp`: startet das Nachholen erst nach erfolgreichem `listen` (Hook `onListen`, nicht
 * `onReady`, das vor dem Binden läuft: ein Core mit `EADDRINUSE` legt so keine Jobs an) und beendet
 * es mit `close()`. Mit `inject` allein (Tests) startet es nicht.
 */
export function registerSearchBackfill(
  app: FastifyInstance,
  deps: { db: Db; config: Pick<Config, 'dataDir'>; logger: Logger },
): void {
  let handle: SearchBackfillHandle | undefined;
  app.addHook('onListen', async () => {
    handle ??= startSearchBackfill({
      db: deps.db,
      worker: new WorkerClient({ dataDir: deps.config.dataDir }),
      logger: deps.logger.child({ module: 'search-backfill' }),
    });
  });
  app.addHook('onClose', async () => {
    await handle?.stop();
  });
}
