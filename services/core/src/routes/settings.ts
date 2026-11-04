// Einstellungen (VERTRAEGE §7.5 und §14): GET und PATCH /settings
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { ApiErrorSchema, SettingsSchema, SettingsUpdateSchema } from '@sg/shared';
import type { Config } from '../config.ts';
import type { Db } from '../db/client.ts';
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
        response: { 200: SettingsSchema, 400: ApiErrorSchema },
      },
    },
    async (request) => updateSettings(db, config, request.body),
  );
}
