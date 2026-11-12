// System-Endpunkte: /health, /jobs (08 §1 „System“)
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  ApiErrorSchema,
  HealthSchema,
  JobListSchema,
  JobStateSchema,
  SystemStorageSchema,
  UuidSchema,
} from '@sg/shared';
import type { Db } from '../db/client.ts';
import { PageQuerySchema } from '../lib/pagination.ts';
import { HttpError } from '../errors.ts';
import { listJobs } from '../services/jobs.ts';
import { StorageMeter } from '../services/storage.ts';

const HEALTH_DB_TIMEOUT_MS = 3000;

export interface SystemRouteDeps {
  db: Db;
  version: string;
  /** `SG_DATA_DIR`; ohne Angabe gibt es `GET /system/storage` nicht */
  dataDir?: string;
  /** Nur für Tests: eigener Messer (Zeitgrenze, Uhr) */
  storage?: StorageMeter;
}

const JobsQuerySchema = PageQuerySchema.extend({
  session_id: UuidSchema.optional(),
  state: JobStateSchema.optional(),
});

export async function systemRoutes(app: FastifyInstance, deps: SystemRouteDeps): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/health',
    {
      schema: {
        tags: ['System'],
        summary: 'Gesundheitsprüfung (die CLI wartet beim Start darauf)',
        response: { 200: HealthSchema },
      },
    },
    async () => {
      // DB-Antwort höchstens 3 s abwarten, sonst gilt sie als „fehler“
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), HEALTH_DB_TIMEOUT_MS);
      });
      let dbState: 'ok' | 'fehler' = 'ok';
      try {
        await Promise.race([deps.db.execute(sql`SELECT 1`), timeout]);
      } catch {
        dbState = 'fehler';
      } finally {
        clearTimeout(timer);
      }
      return { status: 'ok' as const, db: dbState, version: deps.version };
    },
  );

  typed.get(
    '/jobs',
    {
      schema: {
        tags: ['System'],
        summary: 'Jobs auflisten (neueste zuerst), Cursor-Paginierung',
        querystring: JobsQuerySchema,
        response: { 200: JobListSchema, 400: ApiErrorSchema },
      },
    },
    async (request) =>
      listJobs(deps.db, {
        sessionId: request.query.session_id,
        state: request.query.state,
        cursor: request.query.cursor,
        limit: request.query.limit,
      }),
  );

  const storage =
    deps.storage ??
    (deps.dataDir
      ? new StorageMeter({
          dataDir: deps.dataDir,
          db: deps.db,
          onIncomplete: (sizes) =>
            app.log.warn(
              { bytes: sizes.total },
              'Größe des Datenordners nur teilweise gemessen (Zeit- oder Dateigrenze erreicht)',
            ),
        })
      : null);
  if (storage) {
    // Zugang wie die übrigen Systemrouten: lokal ohne Token, aus dem Netz mit Geräte-Token (kein `sgAccess`)
    typed.get(
      '/system/storage',
      {
        schema: {
          tags: ['System'],
          summary: 'Freier Platz und Größe der Daten (UX-11)',
          response: { 200: SystemStorageSchema, 503: ApiErrorSchema },
        },
      },
      async () => {
        try {
          return await storage.read();
        } catch (error) {
          app.log.warn({ err: error }, 'Speicherplatz nicht lesbar');
          throw new HttpError(
            503,
            'storage_unavailable',
            'Der Speicherplatz des Datenordners ist nicht lesbar.',
          );
        }
      },
    );
  }
}
