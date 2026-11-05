import type { IncomingHttpHeaders } from 'node:http';
import { isIP } from 'node:net';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.ts';
import { HttpError } from '../errors.ts';
import type { RejectionLog } from './rejection-log.ts';

/**
 * Sicherheitsregeln des Core (docs/VERTRAEGE.md §5, §7, §11.1, §16.2, 09 §4):
 *
 * 1. „Lokal“ entscheidet allein die Socket-Adresse (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`). `Host` und
 *    `X-Forwarded-For` zählen dafür nie, `trustProxy` bleibt aus (Fastify-Standard).
 * 2. Lokale Anfragen brauchen kein Token, werden aber gegen DNS-Rebinding geprüft: der `Host`-Header
 *    muss `localhost`, `127.0.0.1` oder `[::1]` mit dem Core-Port sein, sonst 421 `host_not_allowed`.
 *    Der Wächter setzt `request.sgDevice = null`.
 * 3. Anfragen aus dem Netz (Schutz vor DNS-Rebinding auf die LAN-IP): Der `Host` muss ein IP-Literal (IPv4 oder
 *    `[IPv6]`, Port optional) oder ein `*.local`-Name sein, sonst 421 `host_not_allowed`. Eine Webseite, die ihren
 *    Namen auf die IP des Macs umbiegt, sendet ihren eigenen Namen als `Host` und wird so abgewiesen.
 *    Anfragen aus dem Netz brauchen `Authorization: Bearer <device_token>`. Fehlt es: 401
 *    `device_token_required`. Ist es unbekannt oder widerrufen: 401 `device_token_invalid`. Bei Erfolg
 *    setzt der Wächter `request.sgDevice = { deviceId }`.
 *    Ausnahme: Routen mit `config.sgAccess = 'pairing'` (nur `POST /devices/pair/start|confirm`) sind aus dem
 *    Netz ohne Token erreichbar. Dort bleibt `request.sgDevice` **undefiniert** (weder lokal noch Gerät). Diese
 *    Routen lehnen jeden `Origin`-Header mit 403 `origin_not_allowed` ab: Die iPad-App sendet keinen, ein Browser
 *    immer. So kann keine Webseite die Kopplung anstoßen oder Codes raten.
 * 4. Routen mit `config.sgAccess = 'local'` lehnen Anfragen aus dem Netz mit 403 `local_only` ab, auch mit
 *    gültigem Token. Ohne Token gilt vorher Regel 3 (401).
 * 5. Zustandsändernde Anfragen (POST, PUT, PATCH, DELETE) und WebSocket-Upgrades mit `Origin`-Header (Browser)
 *    müssen von der eigenen Herkunft oder `SG_DEV_WEB_ORIGIN` kommen, sonst 403 `origin_not_allowed`
 *    (CSRF bzw. Cross-Site WebSocket Hijacking). Ohne `Origin` (curl, iPad-App) gilt nur die Token-Regel.
 *
 * Welche Route gemeint ist, bestimmt Fastify beim Routing (`request.routeOptions.config`), nicht ein
 * Textvergleich mit der URL. So helfen `//`, `..`, Groß-/Kleinschreibung oder Query-Strings nicht, eine Route
 * ohne Token zu erreichen. Unbekannte Pfade haben keine Ausnahme und brauchen aus dem Netz ein Token.
 *
 * Die Prüfung steckt in einem „Wächter“ (`SecurityGuard`). Er läuft als onRequest-Hook, zusätzlich bei
 * Framework-Fehlern (z. B. kaputte URL), die Fastify vor den Hooks abfängt, und lässt sich für einen rohen
 * `upgrade`-Handler als `app.authenticateUpgrade(req)` aufrufen.
 */

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const LOOPBACK_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]'];

/** Zugangsart einer Route (Route-Option `config.sgAccess`) */
export type RouteAccess = 'local' | 'pairing';

/** Ergebnis der Prüfung: `null` = lokal, `{ deviceId }` = gekoppeltes Gerät, `undefined` = Kopplungsroute aus dem Netz */
export type SgDevice = { deviceId: string } | null;

declare module 'fastify' {
  interface FastifyContextConfig {
    /** `local`: nur vom Mac selbst (403 `local_only` aus dem Netz). `pairing`: aus dem Netz ohne Token (nur POST) */
    sgAccess?: RouteAccess;
  }
  interface FastifyRequest {
    /** Vom Wächter gesetzt (VERTRAEGE §16.2): `null` = lokal, `{ deviceId }` = Gerät. Fehlt bei `pair/*` aus dem Netz */
    sgDevice?: SgDevice;
  }
  interface FastifyInstance {
    /**
     * Prüft einen WebSocket-Upgrade (oder jede andere Anfrage) außerhalb des Fastify-Routings, z. B. in einem
     * rohen `server.on('upgrade')`-Handler: Host, Origin und Token wie bei einer Route ohne Ausnahme.
     * Wirft `HttpError` (421, 403, 401), sonst `null` (lokal) bzw. `{ deviceId }`.
     */
    authenticateUpgrade: (request: GuardRequest) => Promise<SgDevice>;
  }
}

/**
 * Prüft ein Geräte-Token (ohne „Bearer “). Liefert das Gerät oder `null`, wenn das Token unbekannt oder
 * widerrufen ist (VERTRAEGE §16.2).
 */
export type DeviceTokenVerifier = (token: string) => Promise<{ deviceId: string } | null>;

/** Ohne Datenbank (Tests, Skripte): es gibt keine gekoppelten Geräte */
export const rejectAllTokens: DeviceTokenVerifier = async () => null;

/** Was der Wächter von einer Anfrage braucht. Passt auf `FastifyRequest` und auf `http.IncomingMessage` */
export interface GuardRequest {
  method?: string | undefined;
  headers: IncomingHttpHeaders;
  socket: { remoteAddress?: string | undefined };
  /** Nur bei Fastify-Anfragen nach dem Routing */
  routeOptions?: { config?: { sgAccess?: RouteAccess } } | undefined;
}

/** Wirft einen `HttpError`, wenn die Anfrage nicht erlaubt ist. Rückgabe wie `request.sgDevice` */
export type SecurityGuard = (request: GuardRequest) => Promise<SgDevice | undefined>;

export function isLoopbackAddress(address: string | undefined): boolean {
  return address !== undefined && LOOPBACK_ADDRESSES.has(address);
}

/** `true` nur für Anfragen, deren Socket-Adresse Loopback ist (nie Host oder X-Forwarded-For) */
export function isLocalRequest(request: { socket: { remoteAddress?: string | undefined } }): boolean {
  return isLoopbackAddress(request.socket.remoteAddress);
}

function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(header ?? '');
  return match?.[1] ?? null;
}

const LOCAL_NAME_RE =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.local\.?$/;
const PORT_RE = /^[0-9]{1,5}$/;

/**
 * `Host` einer Anfrage aus dem Netz: nur IP-Literal (`192.168.1.20`, `[fe80::1]`, jeweils mit optionalem Port)
 * oder `<name>.local` (Bonjour). Erwartet den Header schon in Kleinbuchstaben.
 */
export function isAllowedNetworkHost(host: string | undefined): boolean {
  if (!host) return false;
  let name: string;
  let port: string | undefined;
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    if (end < 0) return false;
    name = host.slice(1, end);
    const rest = host.slice(end + 1);
    if (rest !== '' && !rest.startsWith(':')) return false;
    port = rest ? rest.slice(1) : undefined;
    if (isIP(name) !== 6) return false;
  } else {
    const colon = host.lastIndexOf(':');
    name = colon >= 0 ? host.slice(0, colon) : host;
    port = colon >= 0 ? host.slice(colon + 1) : undefined;
    if (name.includes(':')) return false;
    if (isIP(name) !== 4 && !LOCAL_NAME_RE.test(name)) return false;
  }
  return port === undefined || PORT_RE.test(port);
}

function isWebSocketUpgrade(headers: IncomingHttpHeaders): boolean {
  return (headers.upgrade ?? '').toLowerCase() === 'websocket';
}

export interface SecurityOptions {
  config: Pick<Config, 'port' | 'devWebOrigin'>;
  verifyDeviceToken?: DeviceTokenVerifier;
}

export function createSecurityGuard(options: SecurityOptions): SecurityGuard {
  const { port, devWebOrigin } = options.config;
  const verify = options.verifyDeviceToken ?? rejectAllTokens;
  const allowedLocalHosts = new Set(LOOPBACK_HOSTNAMES.map((name) => `${name}:${port}`));
  const ownOrigins = new Set(LOOPBACK_HOSTNAMES.map((name) => `http://${name}:${port}`));
  if (devWebOrigin) ownOrigins.add(devWebOrigin);

  return async (request) => {
    // Nur die Socket-Adresse zählt (kein X-Forwarded-For, trustProxy ist aus)
    const local = isLocalRequest(request);
    const host = request.headers.host?.toLowerCase();
    const access = request.routeOptions?.config?.sgAccess;
    let allowedOrigins = ownOrigins;
    let device: SgDevice | undefined;

    if (local) {
      if (!host || !allowedLocalHosts.has(host)) {
        throw new HttpError(
          421,
          'host_not_allowed',
          'Der Host-Header ist für lokale Anfragen nicht erlaubt (Schutz vor DNS-Rebinding).',
        );
      }
      device = null;
    } else {
      if (!isAllowedNetworkHost(host)) {
        throw new HttpError(
          421,
          'host_not_allowed',
          'Aus dem Netz ist der Core nur über seine IP-Adresse oder seinen .local-Namen erreichbar (Schutz vor DNS-Rebinding).',
        );
      }
      // Kopplung (§12): nur POST auf genau diese Routen, ohne Token. Ein mitgesendetes Token wird ignoriert.
      const pairing =
        access === 'pairing' && request.method === 'POST' && !isWebSocketUpgrade(request.headers);
      if (pairing && request.headers.origin !== undefined) {
        // Die iPad-App sendet keinen Origin, ein Browser immer: keine Webseite darf koppeln oder raten
        throw new HttpError(403, 'origin_not_allowed', 'Kopplung aus dem Browser ist nicht erlaubt.');
      }
      if (!pairing) {
        const token = bearerToken(request.headers.authorization);
        if (!token) {
          throw new HttpError(
            401,
            'device_token_required',
            'Für Anfragen aus dem Netz ist ein Geräte-Token nötig.',
          );
        }
        const verified = await verify(token);
        if (!verified) {
          throw new HttpError(
            401,
            'device_token_invalid',
            'Das Geräte-Token ist unbekannt oder wurde widerrufen. Bitte das Gerät neu koppeln.',
          );
        }
        device = { deviceId: verified.deviceId };
        if (access === 'local') {
          throw new HttpError(403, 'local_only', 'Das geht nur am Mac selbst.');
        }
      }
      // Gekoppeltes Gerät: die Seite, über die es den Core erreicht, ist ebenfalls „eigene Herkunft“
      allowedOrigins = new Set([...ownOrigins, ...(host ? [`http://${host}`] : [])]);
    }

    const origin = request.headers.origin;
    const checksOrigin = MUTATING_METHODS.has(request.method ?? '') || isWebSocketUpgrade(request.headers);
    if (origin !== undefined && checksOrigin && !allowedOrigins.has(origin)) {
      throw new HttpError(403, 'origin_not_allowed', 'Der Origin dieser Anfrage ist nicht erlaubt.');
    }
    return device;
  };
}

/**
 * `rejections`: Zähler für abgelehnte Netzanfragen (#87). Ohne ihn loggt jede Anfrage einzeln, wie Fastify es tut.
 * Mit ihm muss Fastify den `RequestLogController` bekommen, der abgelehnte Netzanfragen still lässt.
 */
export function registerSecurity(
  app: FastifyInstance,
  guard: SecurityGuard,
  rejections?: RejectionLog,
): void {
  app.decorateRequest('sgDevice', undefined);
  app.decorate('authenticateUpgrade', async (request: GuardRequest) => {
    // Ohne Routing gibt es keine Ausnahme: Kopplungs-Routen sind keine Upgrades
    // (Felder einzeln: bei `IncomingMessage` sind `headers` usw. Getter, ein Spread würde sie verlieren)
    const result = await guard({ method: request.method, headers: request.headers, socket: request.socket });
    return result ?? null;
  });
  app.addHook('onRequest', async (request, reply) => {
    let device: SgDevice | undefined;
    try {
      device = await guard(request);
    } catch (error) {
      if (rejections && !isLocalRequest(request) && error instanceof HttpError) {
        rejections.record(request.socket.remoteAddress, error.statusCode);
      }
      // Abgelehnter WebSocket-Upgrade: Die Antwort geht direkt auf den Socket, den der HTTP-Server nach dem
      // `upgrade`-Ereignis nicht mehr verwaltet. Ohne eigenes Schließen bliebe er serverseitig halb offen hängen
      // (je abgelehntem Versuch ein Socket, Ressourcen-Leck).
      if (isWebSocketUpgrade(request.headers)) {
        reply.header('connection', 'close');
        const socket = request.raw.socket as { end?: () => void; destroyed?: boolean } | undefined;
        reply.raw.once('finish', () => {
          if (socket && typeof socket.end === 'function' && !socket.destroyed) socket.end();
        });
      }
      throw error;
    }
    if (device !== undefined) request.sgDevice = device;
    if (rejections) {
      request.sgAdmitted = true;
      // Angenommene Netzanfragen loggen wie bisher; der Request-Log-Controller hat die Zeile bis hierhin zurückgehalten
      if (!isLocalRequest(request)) request.log.info({ req: request }, 'incoming request');
    }
  });
}
