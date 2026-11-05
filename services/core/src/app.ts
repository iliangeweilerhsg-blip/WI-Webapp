import { readFileSync } from 'node:fs';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import Fastify, { type FastifyBaseLogger, type FastifyInstance, type FastifyReply } from 'fastify';
import { jsonSchemaTransform, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Logger } from 'pino';
import { API_BASE } from '@sg/shared';
import type { Config } from './config.ts';
import type { Db } from './db/client.ts';
import { apiErrorBody, HttpError } from './errors.ts';
import { registerErrorHandler } from './plugins/errors.ts';
import { registerIdempotency } from './plugins/idempotency.ts';
import { createSecurityGuard, registerSecurity, type DeviceTokenVerifier } from './plugins/security.ts';
import { registerWeb } from './plugins/web.ts';
import { calendarRoutes } from './routes/calendar.ts';
import { materialRoutes } from './routes/material.ts';
import { inkRoutes } from './routes/notebooks.ts';
import { organisationRoutes } from './routes/organisation.ts';
import { recordingRoutes } from './routes/recordings.ts';
import { settingsRoutes } from './routes/settings.ts';
import { systemRoutes } from './routes/system.ts';

export interface BuildAppOptions {
  config: Config;
  db: Db;
  logger: Logger;
  /** Prüft Geräte-Tokens. Standard (Phase 0): jedes Token wird abgewiesen. */
  verifyDeviceToken?: DeviceTokenVerifier;
}

function readVersion(): string {
  const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
  return (JSON.parse(raw) as { version: string }).version;
}

/**
 * Baut die Fastify-Anwendung. Neue Fachbereiche (T0-07 …): Routen in `src/routes/<bereich>.ts`,
 * Schema in `src/db/schema/<bereich>.ts`, Logik in `src/services/<bereich>.ts`, hier registrieren.
 */
export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { config, db, logger } = options;
  const version = readVersion();

  const guard = createSecurityGuard({
    config,
    ...(options.verifyDeviceToken ? { verifyDeviceToken: options.verifyDeviceToken } : {}),
  });

  const app: FastifyInstance = Fastify({
    loggerInstance: logger as FastifyBaseLogger,
    // Lokal oder Netz entscheidet allein die Socket-Adresse (VERTRAEGE §5): kein trustProxy
    trustProxy: false,
    // Fehler, die Fastify vor den Hooks abfängt (kaputte URL, ungültiger Content-Type …):
    // auch sie bekommen die Sicherheitsprüfung und das Format ApiError
    frameworkErrors: (error, request, rawReply) => {
      const reply = rawReply as unknown as FastifyReply;
      void (async () => {
        try {
          await guard(request);
        } catch (denied) {
          if (denied instanceof HttpError) {
            return reply.code(denied.statusCode).send(apiErrorBody(denied.code, denied.message));
          }
        }
        const status =
          error.statusCode && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 400;
        return reply.code(status).send(apiErrorBody('bad_request', 'Die Anfrage ist fehlerhaft.'));
      })().catch((failure: unknown) => {
        request.log.error({ err: failure }, 'Framework-Fehler konnte nicht beantwortet werden');
      });
    },
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Reihenfolge: Sicherheitsprüfung vor allem anderen (auch vor CORS-Preflight)
  registerSecurity(app, guard);
  registerErrorHandler(app);
  registerIdempotency(app, db);

  await app.register(cors, {
    // Nur die Entwicklungs-Web-App (SG_DEV_WEB_ORIGIN) bekommt CORS-Header
    origin: config.devWebOrigin ? [config.devWebOrigin] : false,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: { title: 'Studien-Gehirn Core', version, description: 'REST-API des Core (08 §1)' },
      tags: [{ name: 'System' }],
    },
    transform: jsonSchemaTransform,
  });

  await app.register(
    async (api) => {
      api.get('/openapi.json', { schema: { hide: true } }, async () => api.swagger());
      await api.register(systemRoutes, { db, version });
      await api.register(materialRoutes, { db, config });
      await api.register(organisationRoutes, { db });
      await api.register(calendarRoutes, { db });
      await api.register(inkRoutes, { db, config });
      await api.register(recordingRoutes, { db, config });
      await api.register(settingsRoutes, { db, config });
    },
    { prefix: API_BASE },
  );

  // Static Export der Web-App und Not-Found-Handler (muss nach den API-Routen kommen)
  await registerWeb(app, config);

  return app;
}
