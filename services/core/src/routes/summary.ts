// `GET /sessions/{id}/summary` (VERTRAEGE §20.6, F-NAC-08). Ticket T2-22a. Lokal und aus dem Netz wie die übrigen.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ApiErrorSchema, SessionSummaryViewSchema, UuidSchema } from '@sg/shared';
import type { Db } from '../db/client.ts';
import { getSessionSummary } from '../services/summary.ts';

export interface SummaryRouteDeps {
  db: Db;
}

const IdParams = z.object({ id: UuidSchema });

export async function summaryRoutes(app: FastifyInstance, deps: SummaryRouteDeps): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/sessions/:id/summary',
    {
      schema: {
        tags: ['Sessions'],
        summary: 'Kurzfassung der Vorlesung mit Quellen (F-NAC-08). `summary: null`, wenn es keine gibt',
        params: IdParams,
        response: { 200: SessionSummaryViewSchema, 400: ApiErrorSchema, 404: ApiErrorSchema },
      },
    },
    async (request) => getSessionSummary(deps.db, request.params.id),
  );
}
