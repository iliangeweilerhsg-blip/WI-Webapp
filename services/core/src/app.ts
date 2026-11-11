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
import { createRejectionLog, RequestLogController, sourceKey } from './plugins/rejection-log.ts';
import {
  closeRejectedUpgrade,
  createSecurityGuard,
  isLocalRequest,
  isLoopbackAddress,
  registerSecurity,
  type DeviceTokenVerifier,
} from './plugins/security.ts';
import { registerWeb } from './plugins/web.ts';
import { createMoodleServices, type MoodleServices } from './moodle/index.ts';
import { MoodleSync } from './moodle/sync.ts';
import { backupRoutes } from './routes/backups.ts';
import { calendarRoutes } from './routes/calendar.ts';
import { devicesRoutes } from './routes/devices.ts';
import { materialRoutes } from './routes/material.ts';
import { moodleRoutes } from './routes/moodle.ts';
import { inkRoutes } from './routes/notebooks.ts';
import { organisationRoutes } from './routes/organisation.ts';
import { recordingRoutes } from './routes/recordings.ts';
import { sessionRoutes } from './routes/sessions.ts';
import { settingsRoutes } from './routes/settings.ts';
import { systemRoutes } from './routes/system.ts';
import { searchRoutes } from './routes/search.ts';
import { trashRoutes } from './routes/trash.ts';
import { transcriptRoutes } from './routes/transcript.ts';
import { LastSeenTracker, verifyDeviceToken } from './services/devices.ts';
import { pickPairingHost } from './services/discovery.ts';
import { PairingManager } from './services/pairing.ts';
import { registerSearchBackfill } from './services/search-backfill.ts';
import { startSessionTicker, type SessionTicker } from './services/sessions.ts';
import { syncPlugin } from './sync/server.ts';

export interface BuildAppOptions {
  config: Config;
  db: Db;
  logger: Logger;
  /** Prüft Geräte-Tokens. Standard: gegen `device.token_hash` (T1-10), mit `last_seen_at` höchstens einmal pro Minute */
  verifyDeviceToken?: DeviceTokenVerifier;
  /** Core-Takt für Sessions (VERTRAEGE §9.1). Standard: an. Tests schalten ihn mit `false` aus. */
  sessionTicker?: boolean;
  /** Uhr für die Session-Routen und den Takt. Standard: Systemzeit */
  now?: () => Date;
  /** Moodle-Anbindung (08 §9). Standard: aus `SG_MOODLE_URL` und dem Schlüsselbund */
  moodle?: MoodleServices;
  /** Moodle-Abgleich (T1-23). Standard: einer auf `moodle` und der Datenbank */
  moodleSync?: MoodleSync;
  /** Abgleich beim Start und alle 2 h (F-MDL-04). Standard: aus; `main.ts` schaltet ihn ein */
  moodleSchedule?: boolean;
  /** Höchstens so lange wartet das Beenden auf einen laufenden Abgleich. Standard: `SHUTDOWN_WAIT_MS` (7 s) */
  moodleShutdownWaitMs?: number;
  /** Kopplungsfenster im Speicher (§12). Standard: ein eigenes pro App. Tests geben eins mit gestellter Uhr vor */
  pairing?: PairingManager;
  /** IPv4 für `PairingCode.host`. Standard: aktive Schnittstelle, bevorzugt `en0` */
  pairingHost?: () => string;
  /** Nachholen des Suchindex beim Start und alle 10 min (VERTRAEGE §19.5). Standard: aus; `main.ts` schaltet es ein */
  searchBackfill?: boolean;
}

function readVersion(): string {
  const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
  return (JSON.parse(raw) as { version: string }).version;
}

/**
 * Grenzen für HTTP-Verbindungen (#84 M-1). Ohne sie kann ein Gerät im WLAN ohne Token beliebig viele leere oder
 * Keep-Alive-Verbindungen offen halten, bis der Core keine Dateien mehr öffnen kann (`EMFILE`).
 * - `connectionTimeoutMs`: Ein Socket ohne jeden Verkehr in beide Richtungen wird geschlossen (`server.setTimeout`).
 *   Aktive Uploads und Downloads setzen die Uhr mit jedem Paket zurück. Großzügig, weil Handler wie der
 *   Moodle-Datei-Proxy bis zu 30 s auf Moodle warten dürfen, ohne dass Bytes fließen. Für den WebSocket `/sync`
 *   gilt die Grenze nicht: Node nimmt sie beim Upgrade vom Socket, der Sync-Server hat eigene (VERTRAEGE §11.4).
 * - `keepAliveTimeoutMs`: Leerlauf zwischen zwei Anfragen auf derselben Verbindung (Fastify-Standard: 72 s).
 * - `requestTimeoutMs`: Längste Zeit, um eine ganze Anfrage samt Body zu empfangen (gegen Tröpfeln). Ein Upload bis
 *   200 MB (`MAX_UPLOAD_BYTES`) braucht so nur etwa 1 Mbit/s.
 * - `maxPerSource` und `maxNetwork`: offene Verbindungen je Quelle (IPv6 je /64) bzw. aus dem Netz insgesamt.
 *   Überzählige werden sofort geschlossen. Loopback ist ausgenommen, damit die Web-App auf dem Mac immer geht.
 * Tests dürfen das Objekt vor `buildApp` ändern (kürzere Zeiten).
 */
export const connectionLimits = {
  connectionTimeoutMs: 120_000,
  keepAliveTimeoutMs: 10_000,
  requestTimeoutMs: 30 * 60_000,
  maxPerSource: 32,
  maxNetwork: 256,
};

/** Zählt offene Verbindungen aus dem Netz und schließt die über `maxPerSource`/`maxNetwork`. Loopback zählt nie */
function limitNetworkConnections(
  app: FastifyInstance,
  logger: Logger,
  limits: typeof connectionLimits,
): void {
  const perSource = new Map<string, number>();
  let network = 0;
  let dropped = 0;
  let lastWarn = 0;
  app.server.on('connection', (socket) => {
    if (isLoopbackAddress(socket.remoteAddress)) return;
    const key = sourceKey(socket.remoteAddress);
    const count = perSource.get(key) ?? 0;
    if (count >= limits.maxPerSource || network >= limits.maxNetwork) {
      socket.destroy();
      dropped++;
      // Keine Zeile je Verbindung (#87): höchstens eine je Minute
      const now = Date.now();
      if (now - lastWarn >= 60_000) {
        logger.warn({ source: key, dropped }, 'Verbindungen aus dem Netz über der Grenze geschlossen');
        lastWarn = now;
        dropped = 0;
      }
      return;
    }
    perSource.set(key, count + 1);
    network++;
    socket.once('close', () => {
      network--;
      const left = (perSource.get(key) ?? 1) - 1;
      if (left > 0) perSource.set(key, left);
      else perSource.delete(key);
    });
  });
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

  const moodleSync =
    options.moodleSync ??
    new MoodleSync({
      db,
      dataDir: config.dataDir,
      moodle,
      logger: logger.child({ module: 'moodle-sync' }),
      ...(options.now ? { now: options.now } : {}),
    });

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
    // Verbindungs-Timeouts gegen offen gehaltene Sockets (#84 M-1), Begründung bei `connectionLimits`
    connectionTimeout: connectionLimits.connectionTimeoutMs,
    keepAliveTimeout: connectionLimits.keepAliveTimeoutMs,
    requestTimeout: connectionLimits.requestTimeoutMs,
    // Abgelehnte Netzanfragen werden zusammengefasst statt einzeln geloggt (#87)
    logController: new RequestLogController(),
    // Fehler, die Fastify vor den Hooks abfängt (kaputte URL, ungültiger Content-Type …):
    // auch sie bekommen die Sicherheitsprüfung und das Format ApiError
    frameworkErrors: (error, request, rawReply) => {
      const reply = rawReply as unknown as FastifyReply;
      // Hier laufen weder onRequest- noch onResponse-Hooks. Ein abgelehnter WebSocket-Upgrade (z. B. kaputte URL)
      // muss darum selbst geschlossen werden, sonst bleibt sein Socket offen (VERTRAEGE §5, Gegen-Review #84 S-1)
      closeRejectedUpgrade(request.raw, reply.raw);
      void (async () => {
        try {
          await guard(request);
        } catch (denied) {
          if (denied instanceof HttpError) {
            if (!isLocalRequest(request) && !request.sgRejectionCounted) {
              rejections.record(request.socket.remoteAddress, denied.statusCode);
              request.sgRejectionCounted = true;
            }
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
  limitNetworkConnections(app, logger, connectionLimits);

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
      await api.register(sessionRoutes, { db, config, ...(options.now ? { now: options.now } : {}) });
      await api.register(moodleRoutes, {
        moodle,
        db,
        sync: moodleSync,
        ...(options.now ? { now: options.now } : {}),
      });
      await api.register(calendarRoutes, { db });
      await api.register(inkRoutes, { db, config });
      await api.register(recordingRoutes, { db, config });
      await api.register(transcriptRoutes, { db });
      await api.register(searchRoutes, { db, config });
      await api.register(backupRoutes, { db, config });
      await api.register(trashRoutes, { db, config });
      await api.register(settingsRoutes, { db, config });
      await api.register(devicesRoutes, { db, config, pairing, pairingHost });
    },
    { prefix: API_BASE },
  );

  // Start-Hooks mit Nebenwirkungen laufen erst nach erfolgreichem `listen` (`onListen`, nicht `onReady`, das vor dem
  // Binden läuft): Ein zweiter Core, der mit `EADDRINUSE` scheitert, ändert so nichts (#170). Mit `inject` allein
  // (Tests) starten sie nicht.

  // Takt: geplant → bereit → verpasst und Auto-Stopp-Rückfallebene, beim Start einmal mit Absturz-Erkennung.
  // Die Absturz-Erkennung darf nur der Core auslösen, der wirklich läuft: Ein zweiter Core würde sonst die
  // Sessions des ersten als abgestürzt beenden (F-SES-05)
  if (options.sessionTicker !== false) {
    let ticker: SessionTicker | undefined;
    app.addHook('onListen', async () => {
      ticker ??= startSessionTicker({
        db,
        config,
        onError: (error) => logger.error({ err: error }, 'Session-Takt fehlgeschlagen'),
        ...(options.now ? { now: options.now } : {}),
      });
    });
    app.addHook('onClose', async () => {
      await ticker?.stop();
    });
  }

  // Moodle-Abgleich: beim Start und alle 2 h (F-MDL-04). Beim Beenden den laufenden Abgleich abwarten
  let stopMoodleSchedule: (() => void) | undefined;
  if (options.moodleSchedule) {
    app.addHook('onListen', async () => {
      stopMoodleSchedule ??= moodleSync.startSchedule();
    });
  }
  app.addHook('onClose', async () => {
    stopMoodleSchedule?.();
    // Laufenden Abgleich an der nächsten Stelle abbrechen und höchstens kurz warten (Review #133, S3)
    await moodleSync.stop(options.moodleShutdownWaitMs);
  });

  if (options.searchBackfill) registerSearchBackfill(app, { db, config, logger });

  // Static Export der Web-App und Not-Found-Handler (muss nach den API-Routen kommen)
  await registerWeb(app, config);

  return app;
}
