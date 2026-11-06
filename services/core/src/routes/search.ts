// `GET /search` (VERTRAEGE §19.6, F-SUC-01). Ticket T2-12. Erlaubt für lokal und Netz wie die übrigen Lese-Routen.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ApiErrorSchema, SearchResponseSchema, UuidSchema } from '@sg/shared';
import type { Config } from '../config.ts';
import type { Db } from '../db/client.ts';
import { WorkerClient } from '../lib/worker-client.ts';
import { search } from '../services/search.ts';

export interface SearchRouteDeps {
  db: Db;
  config: Pick<Config, 'dataDir'>;
  /** Standard: Worker auf `127.0.0.1:<SG_WORKER_PORT>`, Token aus dem Datenordner */
  worker?: Pick<WorkerClient, 'embed'>;
}

/** `q`: Pflicht, 1–200 Zeichen nach `trim` (Leerraum am Ende bleibt erhalten, er steuert das Präfix `:*`) */
const QSchema = z.string().refine(
  (value) => {
    const length = [...value.trim()].length;
    return length >= 1 && length <= 200;
  },
  { message: 'q muss nach trim 1 bis 200 Zeichen lang sein' },
);

const SearchQuerySchema = z.object({
  q: QSchema,
  module_id: UuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export async function searchRoutes(app: FastifyInstance, deps: SearchRouteDeps): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const { db } = deps;
  const worker = deps.worker ?? new WorkerClient({ dataDir: deps.config.dataDir });

  typed.get(
    '/search',
    {
      schema: {
        tags: ['Suche'],
        summary: 'Folien und Gesagtes durchsuchen, im Wortlaut und nach Bedeutung (F-SUC-01)',
        querystring: SearchQuerySchema,
        response: { 200: SearchResponseSchema, 400: ApiErrorSchema },
      },
    },
    async (request) =>
      search(
        { db, worker },
        { q: request.query.q, moduleId: request.query.module_id, limit: request.query.limit },
      ),
  );
}
