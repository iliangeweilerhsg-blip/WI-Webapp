// `GET /costs/summary` (VERTRAEGE §20.6, F-DAT-05). Ticket T2-22a. Lokal und aus dem Netz wie die übrigen.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ApiErrorSchema, CostSummarySchema } from '@sg/shared';
import type { Db } from '../db/client.ts';
import { getCostSummary } from '../services/costs.ts';

export interface CostsRouteDeps {
  db: Db;
  /** IANA-Zeitzone für die Monatsgrenze. Standard: Ortszeit des Prozesses (§20.5) */
  timeZone?: string;
}

const CostsQuerySchema = z.object({
  month: z
    .string()
    .regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/, { message: 'month muss die Form YYYY-MM haben' })
    .optional(),
});

export async function costsRoutes(app: FastifyInstance, deps: CostsRouteDeps): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/costs/summary',
    {
      schema: {
        tags: ['KI'],
        summary: 'KI-Kosten eines Monats: Summe gegen das Budget, je Aufgabe, je Modell, teuerste Sessions',
        querystring: CostsQuerySchema,
        response: { 200: CostSummarySchema, 400: ApiErrorSchema },
      },
    },
    async (request) =>
      getCostSummary(
        deps.db,
        { month: request.query.month },
        deps.timeZone ? { timeZone: deps.timeZone } : {},
      ),
  );
}
