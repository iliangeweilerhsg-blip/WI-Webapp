// Backups (VERTRAEGE §7.5, §13, F-DAT-01): `GET /backups`, `POST /backup`
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { ApiErrorSchema, BackupOverviewSchema, BackupRunSchema } from '@sg/shared';
import type { Config } from '../config.ts';
import type { Db } from '../db/client.ts';
import { PageQuerySchema } from '../lib/pagination.ts';
import { listBackups, startBackup } from '../services/backups.ts';

export interface BackupRouteDeps {
  db: Db;
  config: Config;
}

export async function backupRoutes(app: FastifyInstance, deps: BackupRouteDeps): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const { db, config } = deps;

  typed.get(
    '/backups',
    {
      schema: {
        tags: ['Daten'],
        summary: 'Backup-Status und Läufe, neueste zuerst',
        querystring: PageQuerySchema,
        response: { 200: BackupOverviewSchema, 400: ApiErrorSchema },
      },
    },
    async (request) => listBackups(db, config, { cursor: request.query.cursor, limit: request.query.limit }),
  );

  typed.post(
    '/backup',
    {
      schema: {
        tags: ['Daten'],
        summary:
          'Backup jetzt starten (`pnpm sg backup` im Hintergrund). 409 `backup_running` / `backup_target_missing`',
        response: { 202: BackupRunSchema, 409: ApiErrorSchema },
      },
    },
    async (request, reply) => reply.code(202).send(await startBackup(db, config, 'manuell')),
  );
}
