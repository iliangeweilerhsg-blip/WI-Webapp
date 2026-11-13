import { readFileSync } from 'node:fs';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyReply,
  type RouteOptions,
} from 'fastify';
import { jsonSchemaTransform, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Logger } from 'pino';
import { API_BASE } from '@sg/shared';
import type { Config } from './config.ts';
import type { Db } from './db/client.ts';
import { apiErrorBody, HttpError } from './errors.ts';
import { registerErrorHandler } from './plugins/errors.ts';
import { registerIdempotency } from './plugins/idempotency.ts';
import { registerTunnel } from './plugins/tunnel-server.ts';
import { createRejectionLog, RequestLogController } from './plugins/rejection-log.ts';
import {
  closeRejectedUpgrade,
  createSecurityGuard,
  isLocalRequest,
  NetworkConnectionGate,
  registerSecurity,
  rejectionSource,
  type DeviceTokenVerifier,
} from './plugins/security.ts';
import { registerWeb } from './plugins/web.ts';
import { localTimeZone } from './learning/day.ts';
import { createScheduler } from './learning/params.ts';
import { createMoodleServices, type MoodleServices } from './moodle/index.ts';
import { MoodleSync } from './moodle/sync.ts';
import { aiStatusRoutes } from './routes/ai-status.ts';
import { backupRoutes } from './routes/backups.ts';
import { calendarRoutes } from './routes/calendar.ts';
import { cardRoutes } from './routes/cards.ts';
import { conceptRoutes } from './routes/concepts.ts';
import { costsRoutes } from './routes/costs.ts';
import { devicesRoutes } from './routes/devices.ts';
import { inboxRoutes } from './routes/inbox.ts';
import { materialRoutes } from './routes/material.ts';
import { moodleRoutes } from './routes/moodle.ts';
import { inkRoutes } from './routes/notebooks.ts';
import { organisationRoutes } from './routes/organisation.ts';
import { recordingRoutes } from './routes/recordings.ts';
import { reviewRoutes } from './routes/review.ts';
import { sessionRoutes } from './routes/sessions.ts';
import { settingsRoutes } from './routes/settings.ts';
import { summaryRoutes } from './routes/summary.ts';
import { systemRoutes } from './routes/system.ts';
import { searchRoutes } from './routes/search.ts';
import { trashRoutes } from './routes/trash.ts';
import { transcriptRoutes } from './routes/transcript.ts';
import { LastSeenTracker, listActiveDeviceIds, verifyDeviceToken } from './services/devices.ts';
import { pickPairingHost } from './services/discovery.ts';
import { PairingManager } from './services/pairing.ts';
import { registerKeepAwake } from './services/keep-awake.ts';
import { registerSearchBackfill } from './services/search-backfill.ts';
import { startSessionTicker, type SessionTicker } from './services/sessions.ts';
import { TunnelKeyStore } from './services/tunnel.ts';
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
  /** Ortszeit des Macs für den Lerntag der Wiederholung (IANA-Name, VERTRAEGE §21.5). Standard: die des Prozesses */
  learningTimeZone?: string;
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
  /** Mac während einer Session wach halten (`caffeinate`, UX-04). Standard: aus; `main.ts` schaltet es ein */
  keepAwake?: boolean;
  /**
   * Nur für Tests: sieht jede registrierte Route samt `config` (`sgAccess`). So läuft der Tunnel-Test über die
   * Routentabelle statt über eine Liste von Hand (UX-12, PR 2).
   */
  onRoute?: (route: RouteOptions) => void;
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
 * - `maxRequestsPerSocket`: Nach so vielen Anfragen schließt der Core die Keep-Alive-Verbindung (`Connection: close`),
 *   der Client verbindet neu. Begrenzt, wie lange eine einzelne Verbindung mit tröpfelnden Anfragen lebt. Hoch genug,
 *   dass Bursts (Seitenlisten, Vorschaubilder, Audio-Chunks einer Live-Aufnahme) kaum neu verbinden müssen.
 * - `maxPerSource` und `maxNetwork`: offene Netzverbindungen ohne Vorrang je Quelle (IPv6 je /64) bzw. insgesamt.
 *   Über `maxPerSource` wird sofort geschlossen. Ist `maxNetwork` voll, verdrängt die neue Verbindung die älteste
 *   ohne Vorrang aus der größten Quelle (#185). Loopback ist ausgenommen, damit die Web-App auf dem Mac immer geht.
 * - Vorrang (#185): Verbindungen, die schon ein gültiges Token gezeigt haben, und neue Verbindungen von einer Adresse
 *   mit gültigem Token in den letzten `trustedAddressTtlMs` zählen nicht gegen `maxNetwork` und werden nie
 *   verdrängt. Je Adresse gelten für sie höchstens `maxPerSource`. Gemerkt werden höchstens `maxTrustedAddresses`.
 * - `firstRequestTimeoutMs`: Eine Netzverbindung ohne Token-Vorrang muss ihre ersten Header so schnell senden.
 * - `tokenlessRequestTimeoutMs`: Längste Dauer einer Netzanfrage ohne Token (Kopplung) samt Body.
 * - `maxConnections`: harte Obergrenze aller offenen Verbindungen samt Loopback und WebSockets
 *   (`server.maxConnections`), weit unter dem FD-Limit des Prozesses, damit DB und Dateien immer noch öffnen.
 * Tests dürfen das Objekt vor `buildApp` ändern (kürzere Zeiten).
 */
export const connectionLimits = {
  connectionTimeoutMs: 120_000,
  keepAliveTimeoutMs: 10_000,
  requestTimeoutMs: 30 * 60_000,
  maxRequestsPerSocket: 1000,
  maxPerSource: 32,
  maxNetwork: 256,
  maxConnections: 1024,
  firstRequestTimeoutMs: 15_000,
  tokenlessRequestTimeoutMs: 10_000,
  trustedAddressTtlMs: 15 * 60_000,
  maxTrustedAddresses: 64,
};

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
  // Verbindungsgrenzen und Vorrang gekoppelter Geräte (#84 M-1, #185)
  const connections = new NetworkConnectionGate(connectionLimits, logger);
  const pairing = options.pairing ?? new PairingManager();
  const pairingHost = options.pairingHost ?? (() => pickPairingHost());
  // Tunnel-Schlüsseldatei (UX-12, E3). Mit `SG_TUNNEL=0` gibt es sie nicht
  const tunnelKeys = config.tunnel
    ? new TunnelKeyStore({ dataDir: config.dataDir, logger: logger.child({ module: 'tunnel' }) })
    : null;

  const app: FastifyInstance = Fastify({
    loggerInstance: logger as FastifyBaseLogger,
    // Lokal oder Netz entscheidet allein die Socket-Adresse (VERTRAEGE §5): kein trustProxy
    trustProxy: false,
    // Verbindungs-Timeouts gegen offen gehaltene Sockets (#84 M-1), Begründung bei `connectionLimits`
    connectionTimeout: connectionLimits.connectionTimeoutMs,
    keepAliveTimeout: connectionLimits.keepAliveTimeoutMs,
    requestTimeout: connectionLimits.requestTimeoutMs,
    maxRequestsPerSocket: connectionLimits.maxRequestsPerSocket,
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
            if (!isLocalRequest(request)) {
              if (!request.sgRejectionCounted) {
                rejections.record(rejectionSource(request), denied.statusCode);
                request.sgRejectionCounted = true;
              }
              // Wie im onRequest-Hook: abgelehnte Netzanfrage schließt die Verbindung (#185)
              reply.header('connection', 'close');
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

  if (options.onRoute) app.addHook('onRoute', options.onRoute);

  const rejections = createRejectionLog(app);
  app.server.maxConnections = connectionLimits.maxConnections;
  connections.attach(app.server);
  // Tunnel-Eingang (UX-12): zweiter Server auf einem Unix-Socket. Gestartet wird er erst von `main.ts` nach dem
  // erfolgreichen `listen` (wie die anderen Start-Hooks, #170); er teilt Routen und Wächter, nicht die Verbindungsgrenzen
  registerTunnel(app, {
    dataDir: config.dataDir,
    enabled: config.tunnel,
    keys: tunnelKeys,
    activeDeviceIds: () => listActiveDeviceIds(db),
    limits: connectionLimits,
    logger: logger.child({ module: 'tunnel' }),
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Reihenfolge: Sicherheitsprüfung vor allem anderen (auch vor CORS-Preflight)
  registerSecurity(app, guard, rejections, connections);
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
      await api.register(systemRoutes, { db, version, dataDir: config.dataDir });
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
      // Kurzfassung, KI-Kosten und KI-Status (VERTRAEGE §20.6, T2-22a)
      await api.register(summaryRoutes, { db });
      await api.register(costsRoutes, { db });
      await api.register(aiStatusRoutes, { db, config });
      // Inbox und Konzepte (VERTRAEGE §20.6, T2-22b)
      await api.register(inboxRoutes, { db });
      await api.register(conceptRoutes, { db });
      // Karten und Wiederholung (VERTRAEGE §21.4, B2)
      await api.register(cardRoutes, { db, ...(options.now ? { now: options.now } : {}) });
      await api.register(reviewRoutes, {
        db,
        scheduler: createScheduler(),
        tz: options.learningTimeZone ?? localTimeZone(),
        ...(options.now ? { now: options.now } : {}),
      });
      await api.register(backupRoutes, { db, config });
      await api.register(trashRoutes, { db, config });
      await api.register(settingsRoutes, { db, config });
      await api.register(devicesRoutes, { db, config, pairing, pairingHost, tunnelKeys });
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
  if (options.keepAwake) registerKeepAwake(app, { db, logger });

  // Static Export der Web-App und Not-Found-Handler (muss nach den API-Routen kommen)
  await registerWeb(app, config);

  return app;
}
