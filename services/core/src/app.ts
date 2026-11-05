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
import { createRejectionLog, RequestLogController } from './plugins/rejection-log.ts';
import {
  createSecurityGuard,
  isLocalRequest,
  registerSecurity,
  type DeviceTokenVerifier,
} from './plugins/security.ts';
import { registerWeb } from './plugins/web.ts';
import { createMoodleServices, type MoodleServices } from './moodle/index.ts';
import { backupRoutes } from './routes/backups.ts';
import { calendarRoutes } from './routes/calendar.ts';
import { devicesRoutes } from './routes/devices.ts';
import { materialRoutes } from './routes/material.ts';
import { moodleRoutes } from './routes/moodle.ts';
import { inkRoutes } from './routes/notebooks.ts';
import { organisationRoutes } from './routes/organisation.ts';
import { recordingRoutes } from './routes/recordings.ts';
import { settingsRoutes } from './routes/settings.ts';
import { systemRoutes } from './routes/system.ts';
import { trashRoutes } from './routes/trash.ts';
import { LastSeenTracker, verifyDeviceToken } from './services/devices.ts';
import { pickPairingHost } from './services/discovery.ts';
import { PairingManager } from './services/pairing.ts';
import { syncPlugin } from './sync/server.ts';

export interface BuildAppOptions {
  config: Config;
  db: Db;
  logger: Logger;
  /** Prüft Geräte-Tokens. Standard: gegen `device.token_hash` (T1-10), mit `last_seen_at` höchstens einmal pro Minute */
  verifyDeviceToken?: DeviceTokenVerifier;
  /** Moodle-Anbindung (08 §9). Standard: aus `SG_MOODLE_URL` und dem Schlüsselbund */
  moodle?: MoodleServices;
  /** Kopplungsfenster im Speicher (§12). Standard: ein eigenes pro App. Tests geben eins mit gestellter Uhr vor */
  pairing?: PairingManager;
  /** IPv4 für `PairingCode.host`. Standard: aktive Schnittstelle, bevorzugt `en0` */
  pairingHost?: () => string;
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
  const moodle =
    options.moodle ?? createMoodleServices({ config, logger: logger.child({ module: 'moodle' }) });

  const lastSeen = new LastSeenTracker(db);
  const verifyToken: DeviceTokenVerifier =
    options.verifyDeviceToken ??
    (async (token) => {
      const verified = await verifyDeviceToken(db, token);
      if (verified) {
        // Nicht abwarten: die Anfrage soll nicht auf das Schreiben von last_seen_at warten
        lastSeen.touch(verified.deviceId).catch((error: unknown) => {
          logger.warn({ err: error }, 'last_seen_at konnte nicht gesetzt werden');
        });
      }
      return verified;
    });
  const guard = createSecurityGuard({ config, verifyDeviceToken: verifyToken });
  const pairing = options.pairing ?? new PairingManager();
  const pairingHost = options.pairingHost ?? (() => pickPairingHost());

  const app: FastifyInstance = Fastify({
    loggerInstance: logger as FastifyBaseLogger,
    // Lokal oder Netz entscheidet allein die Socket-Adresse (VERTRAEGE §5): kein trustProxy
    trustProxy: false,
    // Abgelehnte Netzanfragen werden zusammengefasst statt einzeln geloggt (#87)
    logController: new RequestLogController(),
    // Fehler, die Fastify vor den Hooks abfängt (kaputte URL, ungültiger Content-Type …):
    // auch sie bekommen die Sicherheitsprüfung und das Format ApiError
    frameworkErrors: (error, request, rawReply) => {
      const reply = rawReply as unknown as FastifyReply;
      void (async () => {
        try {
          await guard(request);
        } catch (denied) {
          if (denied instanceof HttpError) {
            if (!isLocalRequest(request)) rejections.record(request.socket.remoteAddress, denied.statusCode);
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

  const rejections = createRejectionLog(app);

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Reihenfolge: Sicherheitsprüfung vor allem anderen (auch vor CORS-Preflight)
  registerSecurity(app, guard, rejections);
  registerErrorHandler(app);
  registerIdempotency(app, db);
  // WebSocket /sync (T1-08). Vor allen Routen, damit Upgrades auf andere Pfade geschlossen werden
  await app.register(syncPlugin, { db, config, version });

  await app.register(cors, {
    // Nur die Entwicklungs-Web-App (SG_DEV_WEB_ORIGIN) bekommt CORS-Header
    origin: config.devWebOrigin ? [config.devWebOrigin] : false,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: { title: 'Studien-Gehirn Core', version, description: 'REST-API des Core (08 §1)' },
      tags: [{ name: 'System' }, { name: 'Moodle' }],
    },
    transform: jsonSchemaTransform,
  });

  await app.register(
    async (api) => {
      api.get('/openapi.json', { schema: { hide: true } }, async () => api.swagger());
      await api.register(systemRoutes, { db, version });
      await api.register(materialRoutes, { db, config });
      await api.register(organisationRoutes, { db });
      await api.register(moodleRoutes, { moodle });
      await api.register(calendarRoutes, { db });
      await api.register(inkRoutes, { db, config });
      await api.register(recordingRoutes, { db, config });
      await api.register(backupRoutes, { db, config });
      await api.register(trashRoutes, { db, config });
      await api.register(settingsRoutes, { db, config });
      await api.register(devicesRoutes, { db, config, pairing, pairingHost });
    },
    { prefix: API_BASE },
  );

  // Static Export der Web-App und Not-Found-Handler (muss nach den API-Routen kommen)
  await registerWeb(app, config);

  return app;
}
