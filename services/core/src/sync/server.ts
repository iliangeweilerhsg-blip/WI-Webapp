// WebSocket-Endpunkt `/sync` (VERTRAEGE §11, T1-08) als Fastify-Plugin.
//
// - Registriert @fastify/websocket auf oberster Ebene (Upgrades auf andere Pfade werden geschlossen).
// - Startet beim Core-Start zuerst `listenCommittedOps` (mit dem Kanal `sg_event` auf derselben seriellen Kette)
//   und setzt danach den Hook für Versand und `ack`. Beim Herunterfahren: Verbindungen schließen (1001),
//   Listener beenden, Hook zurücksetzen.
// - Ist die Datenbank beim Start nicht erreichbar, startet der Core trotzdem. Der Listener wird im Hintergrund
//   wiederholt, bis dahin lehnt `/sync` jedes `hello` mit `internal_error` (4503) ab.
import websocket from '@fastify/websocket';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import postgres from 'postgres';
import type { Config } from '../config.ts';
import type { Db } from '../db/client.ts';
import { HttpError } from '../errors.ts';
import { isLoopbackAddress } from '../plugins/security.ts';
import { listenCommittedOps, setOnOpCommitted } from './append.ts';
import { SyncConnection, type SyncSocket } from './connection.ts';
import { handleEventNotification, SYNC_EVENT_CHANNEL } from './events.ts';
import { getOpRegistration, unregisterOpHandler, type OpHandler } from './handlers.ts';
import { createInkHandlers, registerInkHandlers } from './handlers/ink.ts';
import { getActiveHub, setActiveHub, SyncHub } from './hub.ts';
import { CLOSE, syncLimits } from './limits.ts';
import { readStreamHeads } from './store.ts';

export interface SyncPluginOptions {
  db: Db;
  config: Config;
  version: string;
}

/** Pfad des WebSockets, außerhalb von `/api/v1` (§11.1) */
export const SYNC_PATH = '/sync';

/** Gerät der Verbindung: `{ deviceId }` (gekoppelt), `null` (lokal) oder `'reject'` (Schließen mit 4401) */
export type ResolvedDevice = { deviceId: string } | null | 'reject';

/**
 * **Einzige Stelle**, an der der Sync-Server das Gerät einer Verbindung bestimmt.
 *
 * Ab T1-10 setzt der Sicherheits-Wächter `request.sgDevice: { deviceId } | null` (`null` = lokal) und prüft dabei
 * Token und Origin. Bis dahin (Fallback): Loopback gilt als lokal, eine Verbindung aus dem Netz ohne
 * `sgDevice` wird mit 4401 geschlossen. Nach T1-10 bleibt der Fallback als Schutz bestehen.
 */
export function resolveDevice(request: FastifyRequest): ResolvedDevice {
  const sgDevice = (request as FastifyRequest & { sgDevice?: { deviceId: string } | null }).sgDevice;
  if (sgDevice === null) return null;
  if (sgDevice !== undefined) {
    return typeof sgDevice.deviceId === 'string' ? { deviceId: sgDevice.deviceId } : 'reject';
  }
  return isLoopbackAddress(request.socket.remoteAddress) ? null : 'reject';
}

/**
 * Origin-Prüfung beim Upgrade (§11.1, Schutz gegen Cross-Site WebSocket Hijacking). Laut §16.2 macht das
 * künftig der Wächter (T1-10). Bis dahin prüft der Sync-Server selbst, danach doppelt (harmlos).
 * Ohne `Origin` (iPad-App) gilt nur die Token-Regel.
 */
function checkOrigin(request: FastifyRequest, config: Config): void {
  const origin = request.headers.origin;
  if (origin === undefined) return;
  const allowed = new Set(['localhost', '127.0.0.1', '[::1]'].map((h) => `http://${h}:${config.port}`));
  if (config.devWebOrigin) allowed.add(config.devWebOrigin);
  if (!isLoopbackAddress(request.socket.remoteAddress) && request.headers.host) {
    allowed.add(`http://${request.headers.host.toLowerCase()}`);
  }
  if (!allowed.has(origin)) {
    throw new HttpError(403, 'origin_not_allowed', 'Der Origin dieser Anfrage ist nicht erlaubt.');
  }
}

async function syncPluginImpl(app: FastifyInstance, options: SyncPluginOptions): Promise<void> {
  const { db, config, version } = options;
  const hub = new SyncHub({ db, logger: app.log, version });
  setActiveHub(hub);

  // Eigene Verbindung für LISTEN (die App-Verbindungen bleiben frei)
  const listenSql = postgres(config.databaseUrl, { max: 1, connect_timeout: 5, onnotice: () => {} });
  let stopListener: (() => Promise<void>) | null = null;
  let retryTimer: NodeJS.Timeout | null = null;
  let closing = false;
  let retryDelay = 1_000;

  const startListener = async (): Promise<void> => {
    const stop = await listenCommittedOps(
      listenSql,
      db,
      (error) => app.log.error({ err: error }, 'Sync: Fehler im Listener'),
      { channels: { [SYNC_EVENT_CHANNEL]: handleEventNotification } },
    );
    if (closing) {
      await stop();
      return;
    }
    stopListener = stop;
    hub.initDelivered(await readStreamHeads(db));
    setOnOpCommitted(hub.onOpCommitted);
    hub.listenerReady = true;
  };

  const tryStart = async (): Promise<void> => {
    try {
      await startListener();
    } catch (error) {
      if (closing) return;
      app.log.warn(
        { err: error, retryInMs: retryDelay },
        'Sync: Listener startet nicht, neuer Versuch folgt',
      );
      retryTimer = setTimeout(() => void tryStart(), retryDelay);
      retryTimer.unref();
      retryDelay = Math.min(retryDelay * 2, 30_000);
    }
  };
  await tryStart();

  // Fach-Handler (VERTRAEGE §16.2): Core-Ink mit dem Datenordner dieser Instanz. Beim Beenden wieder abmelden,
  // damit eine weitere App im selben Prozess (Tests) mit ihrem Datenordner registrieren kann
  const inkKinds = Object.keys(createInkHandlers({ dataDir: config.dataDir })) as (keyof ReturnType<
    typeof createInkHandlers
  >)[];
  let inkHandlers: [keyof ReturnType<typeof createInkHandlers>, OpHandler][] = [];
  if (inkKinds.some((kind) => getOpRegistration(kind))) {
    app.log.warn(
      'Sync: Ink-Handler sind schon registriert (zweite App im selben Prozess), bleiben unverändert',
    );
  } else {
    registerInkHandlers({ dataDir: config.dataDir });
    inkHandlers = inkKinds.map((kind) => [kind, getOpRegistration(kind)!.handler]);
  }

  // Vor dem preClose von @fastify/websocket: eigene Verbindungen mit 1001 schließen
  app.addHook('preClose', async () => {
    hub.closeAll(CLOSE.goingAway, 'server_shutdown');
  });
  app.addHook('onClose', async () => {
    closing = true;
    for (const [kind, handler] of inkHandlers) unregisterOpHandler(kind, handler);
    if (retryTimer) clearTimeout(retryTimer);
    hub.listenerReady = false;
    if (getActiveHub() === hub) {
      setOnOpCommitted(null);
      setActiveHub(null);
    }
    hub.dispose();
    try {
      if (stopListener) await stopListener();
    } finally {
      await listenSql.end({ timeout: 5 });
    }
  });

  // Ein abgelehntes Upgrade (z. B. 401/421 vom Wächter, der vor @fastify/websocket läuft) hat einen vom
  // HTTP-Server gelösten Socket. Nach der Antwort schließen, sonst bleibt er offen (Ressourcen, app.close hängt)
  app.addHook('onResponse', async (request) => {
    // `raw.upgrade` setzt Node nur für Anfragen, die über das Ereignis 'upgrade' kamen
    const raw = request.raw as typeof request.raw & { upgrade?: boolean };
    if (raw.upgrade === true && !raw.socket.destroyed) raw.socket.destroy();
  });

  await app.register(websocket, {
    options: {
      maxPayload: syncLimits.maxMessageBytes,
      perMessageDeflate: false,
    },
  });

  app.get(
    SYNC_PATH,
    {
      websocket: true,
      onRequest: async (request) => {
        checkOrigin(request, config);
      },
    },
    (socket, request) => {
      const ws = socket as unknown as SyncSocket;
      const device = resolveDevice(request);
      if (device === 'reject') {
        ws.send(
          JSON.stringify({
            type: 'error',
            code: 'device_token_invalid',
            message: 'Für Verbindungen aus dem Netz ist ein gültiges Geräte-Token nötig.',
            retryable: false,
            fatal: true,
          }),
        );
        ws.close(CLOSE.tokenInvalid, 'device_token_invalid');
        return;
      }
      new SyncConnection(hub, ws, device?.deviceId ?? null).start();
    },
  );
}

/** Ohne eigenen Kapselungs-Kontext (wie fastify-plugin), damit @fastify/websocket für alle Routen gilt */
export const syncPlugin = Object.assign(syncPluginImpl, { [Symbol.for('skip-override')]: true });
