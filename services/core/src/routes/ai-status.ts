// `GET /ai/status` (VERTRAEGE §20.6). Ticket T2-22a. Lokal und aus dem Netz wie die übrigen.
// Die Antwort enthält nie den KI-Schlüssel: Der Core kennt ihn nicht (§20.5).
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AiStatusSchema } from '@sg/shared';
import type { Config } from '../config.ts';
import type { Db } from '../db/client.ts';
import { WorkerClient } from '../lib/worker-client.ts';
import { getAiStatus } from '../services/ai-status.ts';

export interface AiStatusRouteDeps {
  db: Db;
  config: Pick<Config, 'dataDir'>;
  /** Standard: Worker auf `127.0.0.1:<SG_WORKER_PORT>`, Token aus dem Datenordner */
  worker?: Pick<WorkerClient, 'llmStatus'>;
  /** IANA-Zeitzone für die Monatsgrenze. Standard: Ortszeit des Prozesses (§20.5) */
  timeZone?: string;
}

export async function aiStatusRoutes(app: FastifyInstance, deps: AiStatusRouteDeps): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const worker = deps.worker ?? new WorkerClient({ dataDir: deps.config.dataDir });

  typed.get(
    '/ai/status',
    {
      schema: {
        tags: ['KI'],
        summary: 'Ist die KI im Worker eingerichtet, und wie steht das Monatsbudget?',
        response: { 200: AiStatusSchema },
      },
    },
    async () => getAiStatus({ db: deps.db, worker }, deps.timeZone ? { timeZone: deps.timeZone } : {}),
  );
}
