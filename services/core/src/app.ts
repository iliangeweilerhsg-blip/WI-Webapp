import { readFileSync } from 'node:fs';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { jsonSchemaTransform, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Logger } from 'pino';
import { API_BASE } from '@sg/shared';
import type { Config } from './config.ts';
import type { Db } from './db/client.ts';
import { registerErrorHandler } from './plugins/errors.ts';
import { registerSecurity, type DeviceTokenVerifier } from './plugins/security.ts';
import { registerWeb } from './plugins/web.ts';
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

  const app: FastifyInstance = Fastify({
    loggerInstance: logger as FastifyBaseLogger,
    // Lokal oder Netz entscheidet allein die Socket-Adresse (VERTRAEGE §5): kein trustProxy
    trustProxy: false,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Reihenfolge: Sicherheitsprüfung vor allem anderen (auch vor CORS-Preflight)
  registerSecurity(app, {
    config,
    ...(options.verifyDeviceToken ? { verifyDeviceToken: options.verifyDeviceToken } : {}),
  });
  registerErrorHandler(app);

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
    },
    { prefix: API_BASE },
  );

  // Static Export der Web-App und Not-Found-Handler (muss nach den API-Routen kommen)
  await registerWeb(app, config);

  return app;
}
