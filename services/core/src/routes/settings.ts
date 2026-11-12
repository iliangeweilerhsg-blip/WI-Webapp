// Einstellungen (VERTRAEGE §7.5 und §14): GET und PATCH /settings
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { ApiErrorSchema, SettingsSchema, SettingsUpdateSchema } from '@sg/shared';
import type { Config } from '../config.ts';
import type { Db } from '../db/client.ts';
import { HttpError } from '../errors.ts';
import { isLocalRequest } from '../plugins/security.ts';
import { getSettings, updateSettings } from '../services/settings.ts';

export interface SettingsRouteDeps {
  db: Db;
  config: Pick<Config, 'dataDir'>;
}

export async function settingsRoutes(app: FastifyInstance, deps: SettingsRouteDeps): Promise<void> {
  const { db, config } = deps;
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/settings',
    {
      schema: {
        tags: ['Einstellungen'],
        summary: 'Alle Einstellungen, fehlende Werte mit Standards aufgefüllt',
        response: { 200: SettingsSchema },
      },
    },
    async () => getSettings(db, config),
  );

  typed.patch(
    '/settings',
    {
      schema: {
        tags: ['Einstellungen'],
        summary: 'Einstellungen ändern: nur die angegebenen Felder, Bereich für Bereich zusammengeführt',
        body: SettingsUpdateSchema,
        response: { 200: SettingsSchema, 400: ApiErrorSchema, 403: ApiErrorSchema },
      },
    },
    async (request) => {
      // Das Backup-Ziel bestimmt, wohin der Core schreibt: nur vom Mac selbst (VERTRAEGE §7.5)
      if (request.body.data?.backup_target !== undefined && !isLocalRequest(request)) {
        throw new HttpError(403, 'local_only', 'Das Backup-Ziel lässt sich nur am Mac selbst ändern.');
      }
      return updateSettings(db, config, request.body);
    },
  );
}
