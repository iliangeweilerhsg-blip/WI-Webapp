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
import type { SyncOp } from '@sg/shared';
import type { Config } from '../config.ts';
import type { Db } from '../db/client.ts';
import { onDeviceRevoked } from '../services/devices.ts';
import { notifySessionUpdated, SESSION_NOTIFY_CHANNEL } from '../services/sessions.ts';
import { listenCommittedOps, setOnOpCommitted } from './append.ts';
import { SyncConnection, type SyncSocket } from './connection.ts';
import { handleEventNotification, SYNC_EVENT_CHANNEL } from './events.ts';
import { registeredOpHandlers, unregisterOpHandler, type OpHandler } from './handlers.ts';
import { registerInkHandlers } from './handlers/ink.ts';
import { registerSessionHandlers } from './handlers/session.ts';
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
 * **Einzige Stelle**, an der der Sync-Server das Gerät einer Verbindung bestimmt (§16.2).
 *
 * Host, Origin und Token prüft der Wächter (`plugins/security.ts`, T1-10) beim Upgrade und setzt
 * `request.sgDevice`: `null` = lokal, `{ deviceId }` = gekoppeltes Gerät. Fehlt `sgDevice` (darf für `/sync` nicht
 * vorkommen, nur Kopplungsrouten aus dem Netz haben es nicht), wird die Verbindung abgelehnt.
 */
export function resolveDevice(request: Pick<FastifyRequest, 'sgDevice'>): ResolvedDevice {
  const sgDevice = request.sgDevice;
  if (sgDevice === null) return null;
  if (sgDevice && typeof sgDevice.deviceId === 'string') return { deviceId: sgDevice.deviceId };
  return 'reject';
}

/**
 * Nur für Tests: wird vor dem Annehmen einer Verbindung abgewartet (nach dem Wächter, vor `hub.add`), um den
 * Widerruf genau in dieser Lücke zu prüfen. In Produktion `null`.
 */
export const syncTestHooks: { beforeAccept: (() => Promise<void>) | null } = { beforeAccept: null };

async function syncPluginImpl(app: FastifyInstance, options: SyncPluginOptions): Promise<void> {
  const { db, config, version } = options;
  const hub = new SyncHub({ db, logger: app.log, version });
  setActiveHub(hub);
  // Widerrufene Geräte merken (T1-10 ruft das nach dem Commit von DELETE /devices/{id} auf)
  const offRevoked = onDeviceRevoked((deviceId) => hub.markRevoked(deviceId));

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
      {
        channels: {
          [SYNC_EVENT_CHANNEL]: handleEventNotification,
          // Der Worker meldet Fortschritt (`processing`, `verarbeitet`) per pg_notify('sg_session', <id>), §3
          [SESSION_NOTIFY_CHANNEL]: (payload) => notifySessionUpdated(db, payload),
        },
      },
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

  // Fach-Handler (VERTRAEGE §16.2). Was eine Registrierung neu anmeldet, wird beim Beenden wieder abgemeldet,
  // damit eine weitere App im selben Prozess (Tests) mit ihrer Konfiguration registrieren kann. Sind die Arten
  // schon belegt (zweite App gleichzeitig), bleibt die bestehende Registrierung unverändert.
  const ownHandlers: [SyncOp['kind'], OpHandler][] = [];
  const registerForApp = (area: string, register: () => void): void => {
    const before = registeredOpHandlers();
    try {
      register();
    } catch (error) {
      for (const [kind, handler] of registeredOpHandlers()) {
        if (before.get(kind) !== handler) unregisterOpHandler(kind, handler);
      }
      app.log.warn({ err: error, area }, 'Sync: Handler schon registriert (zweite App im selben Prozess)');
      return;
    }
    for (const [kind, handler] of registeredOpHandlers()) {
      if (before.get(kind) !== handler) ownHandlers.push([kind, handler]);
    }
  };
  // Core-Ink: notebook.*, page.*, stroke.*, element.*, drawing.snapshot, photo.add
  registerForApp('ink', () => registerInkHandlers({ dataDir: config.dataDir }));
  // T1-02: session.*, slide.change, marker.* (session.* mit preLock, VERTRAEGE §16.2)
  registerForApp('session', () => registerSessionHandlers());

  // Vor dem preClose von @fastify/websocket: eigene Verbindungen mit 1001 schließen
  app.addHook('preClose', async () => {
    hub.closeAll(CLOSE.goingAway, 'server_shutdown');
  });
  app.addHook('onClose', async () => {
    closing = true;
    offRevoked();
    for (const [kind, handler] of ownHandlers) unregisterOpHandler(kind, handler);
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
    // Host, Origin und Token prüft der Wächter (T1-10) im onRequest-Hook, bevor es hier ankommt
    { websocket: true },
    async (socket, request) => {
      const ws = socket as unknown as SyncSocket;
      if (syncTestHooks.beforeAccept) await syncTestHooks.beforeAccept();
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
      const conn = new SyncConnection(hub, ws, device?.deviceId ?? null);
      conn.start();
      // Widerruf zwischen Wächter und hub.add (§11.1): closeDeviceConnections hat diese Verbindung nicht gesehen.
      // Direkt nach hub.add (in start) synchron prüfen. Vor welcome prüft die Verbindung noch einmal per DB.
      if (device !== null && hub.isRevoked(device.deviceId)) conn.rejectRevoked();
    },
  );
}

/** Ohne eigenen Kapselungs-Kontext (wie fastify-plugin), damit @fastify/websocket für alle Routen gilt */
export const syncPlugin = Object.assign(syncPluginImpl, { [Symbol.for('skip-override')]: true });
