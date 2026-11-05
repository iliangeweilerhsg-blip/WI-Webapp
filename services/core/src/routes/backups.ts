// Backups (VERTRAEGE §7.5, §13, F-DAT-01/02): `GET /backups`, `POST /backup`, `POST /restore-test`
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { ApiErrorSchema, BackupOverviewSchema, BackupRunSchema, RestoreTestSchema } from '@sg/shared';
import type { Config } from '../config.ts';
import type { Db } from '../db/client.ts';
import { PageQuerySchema } from '../lib/pagination.ts';
import { listBackups, startBackup } from '../services/backups.ts';
import { startRestoreTest } from '../services/restore-test.ts';

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
      // Nur am Mac selbst: ein gekoppeltes Gerät soll keine Backups in Folge auslösen (sie verdrängen auch den
      // monatlichen Restore-Test, der einem laufenden Backup ausweicht; VERTRAEGE §13, #113)
      config: { sgAccess: 'local' },
      schema: {
        tags: ['Daten'],
        summary:
          'Backup jetzt starten (`pnpm sg backup` im Hintergrund, nur lokal). 403 `local_only`, 409 `backup_running` / `backup_target_missing` / `restore_test_running`',
        response: { 202: BackupRunSchema, 409: ApiErrorSchema },
      },
    },
    async (request, reply) => reply.code(202).send(await startBackup(db, config, 'manuell')),
  );

  typed.post(
    '/restore-test',
    {
      // Nur am Mac selbst: der Test spielt einen Dump als Datenbank-Superuser ein (VERTRAEGE §13)
      config: { sgAccess: 'local' },
      schema: {
        tags: ['Daten'],
        summary:
          'Restore-Test jetzt starten (`pnpm sg restore --automatisch` im Hintergrund, nur eigene Stände, nur lokal). 403 `local_only`, 409 `restore_test_running` / `backup_running` / `backup_target_missing` / `restore_test_no_backup`',
        response: { 202: RestoreTestSchema, 409: ApiErrorSchema },
      },
    },
    async (request, reply) => reply.code(202).send(await startRestoreTest(db, config, 'manuell')),
  );
}
