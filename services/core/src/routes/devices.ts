// Geräte und Kopplung (VERTRAEGE §7.5, §12)
import type { FastifyInstance, FastifyBaseLogger } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ApiErrorSchema,
  DeviceListSchema,
  PairConfirmRequestSchema,
  PairingCodeSchema,
  PairingRequestListSchema,
  PairResponseSchema,
  PairStartRequestSchema,
  PairStartResponseSchema,
  UuidSchema,
  type PairingCode,
  type PairingRequest,
} from '@sg/shared';
import type { Config } from '../config.ts';
import type { Db } from '../db/client.ts';
import { HttpError } from '../errors.ts';
import { PageQuerySchema } from '../lib/pagination.ts';
import { uuidv7 } from '../lib/uuid7.ts';
import { createDevice, emitDeviceRevoked, listDevices, revokeDevice } from '../services/devices.ts';
import { cleanDeviceName, cleanDeviceText, type PairingManager } from '../services/pairing.ts';
import { generateTunnelKey, type TunnelKeyStore } from '../services/tunnel.ts';
import { closeDeviceConnections, isDeviceConnected } from '../sync/connections.ts';
import { publishEvent } from '../sync/events.ts';

/** `device.app_version` wird auf so viele Zeichen gekürzt (wie `maxAppVersionLength` in T1-08) */
export const MAX_APP_VERSION_LENGTH = 64;

/** WebSocket-Schließcode für ein widerrufenes Token (§15) */
export const CLOSE_TOKEN_REVOKED = 4401;

/** Header an `GET /devices/pairings/requests`: Zustand des Fensters (`PairingState`) und seine `pairing_id` */
export const PAIRING_STATE_HEADER = 'sg-pairing-state';
export const PAIRING_ID_HEADER = 'sg-pairing-id';

export interface DevicesRouteDeps {
  db: Db;
  config: Pick<Config, 'port'>;
  pairing: PairingManager;
  /** IPv4 des Macs im lokalen Netz für `PairingCode.host` */
  pairingHost: () => string;
  /** Tunnel-Schlüsseldatei (UX-12). `null` bei `SG_TUNNEL=0`: kein Schlüssel, `PairResponse` ohne `tunnel_key` */
  tunnelKeys?: TunnelKeyStore | null;
}

const IdParams = z.object({ id: UuidSchema });
const RequestParams = z.object({ request_id: UuidSchema });

/**
 * Ruft eine Funktion des Sync-Servers auf, die es vor T1-08 nur als Gerüst gibt (`throw new Error('nicht
 * umgesetzt')`). Bis dahin gibt es keine Verbindungen; danach werden echte Fehler protokolliert.
 */
function callSync<T>(log: FastifyBaseLogger, fallback: T, fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (!(error instanceof Error && error.message === 'nicht umgesetzt')) {
      log.warn({ err: error }, 'Sync-Server: Aufruf aus der Geräteverwaltung fehlgeschlagen');
    }
    return fallback;
  }
}

export async function devicesRoutes(app: FastifyInstance, deps: DevicesRouteDeps): Promise<void> {
  const { db, config, pairing } = deps;
  const tunnelKeys = deps.tunnelKeys ?? null;
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const connected = (id: string) => callSync(app.log, false, () => isDeviceConnected(id));

  typed.get(
    '/devices',
    {
      schema: {
        tags: ['Geräte'],
        summary: 'Gekoppelte Geräte, älteste zuerst',
        querystring: PageQuerySchema,
        response: { 200: DeviceListSchema, 400: ApiErrorSchema },
      },
    },
    async (request) => listDevices(db, request.query, connected),
  );

  typed.delete(
    '/devices/:id',
    {
      schema: {
        tags: ['Geräte'],
        summary: 'Gerät entfernen: Token sofort ungültig, offene WebSockets werden mit 4401 geschlossen',
        params: IdParams,
        response: { 204: z.null(), 400: ApiErrorSchema, 403: ApiErrorSchema, 404: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      // Aus dem Netz darf ein Gerät nur sich selbst entfernen (Nachtrag §7.5). Geprüft vor der Suche, damit die
      // Antwort nicht verrät, ob es die ID gibt.
      const caller = request.sgDevice;
      if (caller && caller.deviceId !== id) {
        throw new HttpError(403, 'local_only', 'Andere Geräte lassen sich nur am Mac entfernen.');
      }
      await revokeDevice(db, id);
      // Nach dem Commit (das Token ist ab hier ungültig): Tunnel-Schlüssel entfernen. Scheitert das, steht der Fehler
      // im Log und der Abgleich beim nächsten Start holt es nach. Der Core lehnt das Token so oder so ab
      if (tunnelKeys) {
        await tunnelKeys.remove(id).catch((error: unknown) => {
          request.log.error({ err: error, deviceId: id }, 'Tunnel-Schlüssel konnte nicht entfernt werden');
        });
      }
      // Nach dem Commit: Verbindungen des Geräts schließen (§7.5) und weitere Zuhörer benachrichtigen
      callSync(request.log, undefined, () => closeDeviceConnections(id, CLOSE_TOKEN_REVOKED));
      for (const error of emitDeviceRevoked(id)) {
        request.log.error({ err: error, deviceId: id }, 'Zuhörer von onDeviceRevoked ist fehlgeschlagen');
      }
      return reply.code(204).send(null);
    },
  );

  typed.post(
    '/devices/pairings',
    {
      // Code und Fenster gibt es nur am Mac. Keine Idempotenz: die Antwort enthält den Code (nie in die DB, §12)
      config: { sgAccess: 'local', idempotency: false },
      schema: {
        tags: ['Geräte'],
        summary: 'Kopplungsfenster öffnen (nur lokal). Ersetzt ein offenes Fenster und hebt eine Sperre auf',
        response: { 201: PairingCodeSchema, 403: ApiErrorSchema },
      },
    },
    async (_request, reply) => {
      const opened = pairing.open();
      const host = deps.pairingHost();
      const body: PairingCode = {
        pairing_id: opened.pairingId,
        code: opened.code,
        expires_at: opened.expiresAt.toISOString(),
        host,
        port: config.port,
        qr_url: `sg://pair?v=1&host=${encodeURIComponent(host)}&port=${config.port}&pairing_id=${opened.pairingId}&code=${opened.code}`,
      };
      // Der Code darf in keinem Zwischenspeicher landen
      return reply.code(201).header('cache-control', 'no-store').send(body);
    },
  );

  typed.delete(
    '/devices/pairings',
    {
      config: { sgAccess: 'local' },
      schema: {
        tags: ['Geräte'],
        summary:
          'Kopplungsfenster sofort schließen (nur lokal), offene Anfragen verwerfen. Idempotent. Mit ?pairing_id nur dieses Fenster',
        querystring: z.object({ pairing_id: UuidSchema.optional() }),
        response: { 204: z.null(), 400: ApiErrorSchema, 403: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      pairing.close(request.query.pairing_id);
      return reply.code(204).send(null);
    },
  );

  typed.get(
    '/devices/pairings/requests',
    {
      config: { sgAccess: 'local' },
      schema: {
        tags: ['Geräte'],
        summary:
          'Offene Kopplungsanfragen des aktuellen Fensters (nur lokal). Header SG-Pairing-State/SG-Pairing-Id: Zustand des Fensters',
        response: { 200: PairingRequestListSchema, 403: ApiErrorSchema },
      },
    },
    async (_request, reply) => {
      const status = pairing.status();
      reply
        .header('cache-control', 'no-store')
        .header(PAIRING_STATE_HEADER, status.state)
        // Für die Entwicklungs-Web-App (CORS): Header lesbar machen
        .header('access-control-expose-headers', `${PAIRING_STATE_HEADER}, ${PAIRING_ID_HEADER}`);
      if (status.pairingId) reply.header(PAIRING_ID_HEADER, status.pairingId);
      return { items: pairing.listRequests() };
    },
  );

  typed.delete(
    '/devices/pairings/requests/:request_id',
    {
      config: { sgAccess: 'local' },
      schema: {
        tags: ['Geräte'],
        summary: 'Kopplungsanfrage ablehnen (nur lokal). Ihre Nonce wird danach abgewiesen',
        params: RequestParams,
        response: { 204: z.null(), 400: ApiErrorSchema, 403: ApiErrorSchema, 404: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      pairing.reject(request.params.request_id);
      return reply.code(204).send(null);
    },
  );

  typed.post(
    '/devices/pair/start',
    {
      config: { sgAccess: 'pairing', idempotency: false },
      schema: {
        tags: ['Geräte'],
        summary: 'Kopplungsanfrage eines Geräts (aus dem Netz ohne Token, nur bei offenem Fenster)',
        body: PairStartRequestSchema,
        response: {
          201: PairStartResponseSchema,
          400: ApiErrorSchema,
          409: ApiErrorSchema,
          423: ApiErrorSchema,
          429: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const result = pairing.start(request.body, request.socket.remoteAddress);
      if (result.created) announce(request.log, result.created);
      return reply.code(201).send(result.response);
    },
  );

  typed.post(
    '/devices/pair/confirm',
    {
      // Keine Idempotenz: Die Antwort enthält das Token, es darf nie gespeichert werden (§12)
      config: { sgAccess: 'pairing', idempotency: false },
      schema: {
        tags: ['Geräte'],
        summary:
          'Kopplung mit dem Code bestätigen (aus dem Netz ohne Token). Liefert das Geräte-Token einmalig',
        body: PairConfirmRequestSchema,
        response: {
          201: PairResponseSchema,
          400: ApiErrorSchema,
          403: ApiErrorSchema,
          409: ApiErrorSchema,
          423: ApiErrorSchema,
          429: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const body = request.body;
      const grant = pairing.beginConfirm(body, request.socket.remoteAddress);
      // UX-12: Der Tunnel-Schlüssel kommt **vor** dem Gerät in die Schlüsseldatei (VERTRAEGE §12 Schritt 8). Scheitert
      // das Schreiben, scheitert die Kopplung und das Fenster ist wieder offen. Scheitert danach das Anlegen, bleibt
      // höchstens ein verwaister Eintrag (wird entfernt, sonst räumt ihn der Abgleich beim Start ab)
      const deviceId = uuidv7();
      let tunnelKey: string | undefined;
      let created: Awaited<ReturnType<typeof createDevice>>;
      try {
        if (tunnelKeys) {
          tunnelKey = generateTunnelKey();
          await tunnelKeys.add(deviceId, tunnelKey);
        }
        created = await createDevice(db, {
          id: deviceId,
          name: cleanDeviceName(body.device_name) ?? 'Unbenanntes Gerät',
          kind: body.kind,
          // Wie der Sync-Server (T1-08, `maxAppVersionLength`): höchstens 64 Zeichen, ohne unsichtbare Zeichen
          appVersion:
            body.app_version === undefined ? null : cleanDeviceText(body.app_version, MAX_APP_VERSION_LENGTH),
        });
      } catch (error) {
        grant.abort();
        if (tunnelKeys && tunnelKey !== undefined) {
          await tunnelKeys.remove(deviceId).catch(() => undefined);
        }
        // Weder Schlüssel noch Token gehören in eine Fehlermeldung: der Fehler enthält sie nie
        throw error;
      }
      grant.commit();
      request.log.info({ deviceId: created.device.id, path: grant.path }, 'Gerät gekoppelt');
      return reply
        .code(201)
        .header('cache-control', 'no-store')
        .send({
          device: created.device,
          device_token: created.token,
          ...(tunnelKey !== undefined ? { tunnel_key: tunnelKey } : {}),
        });
    },
  );
}

/** `pairing.requested` nur an lokale Web-Clients (§12). Ohne Sync-Server (vor T1-08) passiert nichts */
function announce(log: FastifyBaseLogger, request: PairingRequest): void {
  callSync(log, undefined, () =>
    publishEvent({ type: 'event', name: 'pairing.requested', data: request }, { localOnly: true }),
  );
}
