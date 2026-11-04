import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Config } from '../config.ts';
import { HttpError } from '../errors.ts';

/**
 * Sicherheitsregeln des Core (docs/VERTRAEGE.md §5, 09 §4):
 *
 * 1. „Lokal“ entscheidet allein die Socket-Adresse. `Host` und `X-Forwarded-For` zählen dafür nie,
 *    `trustProxy` bleibt aus (Fastify-Standard).
 * 2. Lokale Anfragen brauchen kein Token, werden aber gegen DNS-Rebinding geprüft: der `Host`-Header
 *    muss `localhost`, `127.0.0.1` oder `[::1]` mit dem Core-Port sein, sonst 421 `host_not_allowed`.
 * 3. Anfragen aus dem Netz brauchen `Authorization: Bearer <device_token>`, sonst 401
 *    `device_token_required`. Es gibt in Phase 0 noch keine Kopplung (T1-10), also weist der
 *    Standard-Prüfer jedes Token ab.
 * 4. Zustandsändernde Anfragen (POST, PUT, PATCH, DELETE) mit `Origin`-Header (Browser) müssen von der
 *    eigenen Herkunft oder `SG_DEV_WEB_ORIGIN` kommen, sonst 403 `origin_not_allowed` (CSRF-Schutz).
 *    Ohne `Origin` (curl, iPad-App) gilt nur die Token-Regel.
 *
 * Die Prüfung steckt in einem „Wächter“ (`SecurityGuard`). Er läuft als onRequest-Hook und zusätzlich
 * bei Framework-Fehlern (z. B. kaputte URL), die Fastify vor den Hooks abfängt.
 */

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const LOOPBACK_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]'];

/** Prüft ein Geräte-Token (ohne „Bearer “). Liefert true, wenn es zu einem gekoppelten Gerät gehört. */
export type DeviceTokenVerifier = (token: string, request: FastifyRequest) => Promise<boolean>;

/** Phase 0: es gibt noch keine gekoppelten Geräte */
export const rejectAllTokens: DeviceTokenVerifier = async () => false;

/** Wirft einen `HttpError`, wenn die Anfrage nicht erlaubt ist */
export type SecurityGuard = (request: FastifyRequest) => Promise<void>;

export function isLoopbackAddress(address: string | undefined): boolean {
  return address !== undefined && LOOPBACK_ADDRESSES.has(address);
}

function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  return match?.[1] ?? null;
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
    const local = isLoopbackAddress(request.socket.remoteAddress);
    const host = request.headers.host?.toLowerCase();
    let allowedOrigins = ownOrigins;

    if (local) {
      if (!host || !allowedLocalHosts.has(host)) {
        throw new HttpError(
          421,
          'host_not_allowed',
          'Der Host-Header ist für lokale Anfragen nicht erlaubt (Schutz vor DNS-Rebinding).',
        );
      }
    } else {
      const token = bearerToken(request.headers.authorization);
      if (!token || !(await verify(token, request))) {
        throw new HttpError(
          401,
          'device_token_required',
          'Für Anfragen aus dem Netz ist ein gültiges Geräte-Token nötig.',
        );
      }
      // Gekoppeltes Gerät: die Seite, über die es den Core erreicht, ist ebenfalls „eigene Herkunft“
      allowedOrigins = new Set([...ownOrigins, ...(host ? [`http://${host}`] : [])]);
    }

    const origin = request.headers.origin;
    if (origin !== undefined && MUTATING_METHODS.has(request.method) && !allowedOrigins.has(origin)) {
      throw new HttpError(403, 'origin_not_allowed', 'Der Origin dieser Anfrage ist nicht erlaubt.');
    }
  };
}

export function registerSecurity(app: FastifyInstance, guard: SecurityGuard): void {
  app.addHook('onRequest', async (request) => {
    await guard(request);
  });
}
