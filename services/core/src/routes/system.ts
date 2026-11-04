// System-Endpunkte: /health, /jobs (08 §1 „System“)
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { ApiErrorSchema, HealthSchema, JobListSchema, JobStateSchema, UuidSchema } from '@sg/shared';
import type { Db } from '../db/client.ts';
import { PageQuerySchema } from '../lib/pagination.ts';
import { listJobs } from '../services/jobs.ts';

export interface SystemRouteDeps {
  db: Db;
  version: string;
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
      let dbState: 'ok' | 'fehler' = 'ok';
      try {
        await deps.db.execute(sql`SELECT 1`);
      } catch {
        dbState = 'fehler';
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
}
