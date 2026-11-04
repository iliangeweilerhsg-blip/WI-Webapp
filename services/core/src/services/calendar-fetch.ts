// ICS-URL abrufen (VERTRAEGE §8 „URL-Abruf“). Grenzen: 5 MB, 15 s, 3 Weiterleitungen (nur http/https).
//
// SSRF-Schutz: Der Core läuft auf dem Mac des Owners, im lokalen Netz stehen Router, NAS und der Core selbst.
// Eine ICS-URL darf deshalb nie auf private, Loopback- oder Link-Local-Adressen zeigen. Geprüft wird
// - die URL (IP-Adresse im Host, Zugangsdaten),
// - jede aufgelöste Adresse **im Moment des Verbindens** (eigene `lookup`-Funktion): Es wird genau die geprüfte
//   Adresse benutzt, ein zweiter DNS-Abruf (DNS-Rebinding) ist ausgeschlossen,
// - jede Weiterleitung, denn jede Weiterleitung ist eine neue Verbindung mit neuer Prüfung.
import { BlockList, isIP } from 'node:net';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { gunzip, inflate } from 'node:zlib';
import { promisify } from 'node:util';

export const FETCH_MAX_BYTES = 5 * 1024 * 1024;
export const FETCH_TIMEOUT_MS = 15_000;
export const FETCH_MAX_REDIRECTS = 3;

/** `reason` landet in `details.reason` von `502 ics_fetch_failed` */
export type FetchFailureReason =
  | 'too_large'
  | 'timeout'
  | 'too_many_redirects'
  | `status_${number}`
  | 'blocked_address'
  | 'invalid_url'
  | 'unsupported_encoding'
  | 'network_error';

export class IcsFetchError extends Error {
  readonly reason: FetchFailureReason;
  constructor(reason: FetchFailureReason, message: string) {
    super(message);
    this.name = 'IcsFetchError';
    this.reason = reason;
  }
}

/** Die URL selbst ist unbrauchbar (→ 400 `validation_failed`, kein Abruf) */
export class InvalidIcsUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidIcsUrlError';
  }
}

// ---------------------------------------------------------------------------------------------
// Adressen
// ---------------------------------------------------------------------------------------------

const blocked = new BlockList();
const BLOCKED_V4: [string, number][] = [
  ['0.0.0.0', 8], // „dieses Netz“
  ['10.0.0.0', 8], // privat
  ['100.64.0.0', 10], // Carrier-grade NAT
  ['127.0.0.0', 8], // Loopback
  ['169.254.0.0', 16], // Link-Local, Cloud-Metadaten
  ['172.16.0.0', 12], // privat
  ['192.0.0.0', 24], // IETF-Protokolle
  ['192.0.2.0', 24], // Dokumentation
  ['192.88.99.0', 24], // 6to4-Relay
  ['192.168.0.0', 16], // privat
  ['198.18.0.0', 15], // Benchmarks
  ['198.51.100.0', 24], // Dokumentation
  ['203.0.113.0', 24], // Dokumentation
  ['224.0.0.0', 4], // Multicast
  ['240.0.0.0', 4], // reserviert, inkl. Broadcast
];
for (const [net, prefix] of BLOCKED_V4) blocked.addSubnet(net, prefix, 'ipv4');
// IPv6: Erlaubt ist nur 2000::/3 (globale Unicast-Adressen), davon ausgenommen:
const BLOCKED_V6: [string, number][] = [
  ['2001::', 23], // Teredo, IETF-Protokolle, ORCHID
  ['2001:db8::', 32], // Dokumentation
  ['2002::', 16], // 6to4 (enthält eine IPv4-Adresse)
  ['3fff::', 20], // Dokumentation
];
for (const [net, prefix] of BLOCKED_V6) blocked.addSubnet(net, prefix, 'ipv6');
const GLOBAL_V6 = new BlockList();
GLOBAL_V6.addSubnet('2000::', 3, 'ipv6');

/** true, wenn die Adresse im Internet liegt und der Core sie abrufen darf */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  if (family === 6) return GLOBAL_V6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
  return false;
}

// ---------------------------------------------------------------------------------------------
// URL
// ---------------------------------------------------------------------------------------------

/**
 * Prüft und vereinheitlicht eine ICS-URL: `webcal://` wird `https://`, erlaubt sind `http` und `https`
 * (VERTRAEGE §8). Zugangsdaten in der URL werden abgelehnt (sie würden in der Datenbank und in der Anzeige landen).
 */
export function normalizeIcsUrl(raw: string): URL {
  let url: URL;
  try {
    // `webcal:` ist ein Abo-Schema für https
    url = new URL(raw.trim().replace(/^webcal:/i, 'https:'));
  } catch {
    throw new InvalidIcsUrlError('Die Adresse ist keine gültige URL.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new InvalidIcsUrlError('Erlaubt sind nur https://, http:// und webcal://.');
  }
  if (url.username !== '' || url.password !== '') {
    throw new InvalidIcsUrlError('Die Adresse darf keine Zugangsdaten enthalten.');
  }
  if (url.hostname === '') throw new InvalidIcsUrlError('Die Adresse hat keinen Rechnernamen.');
  url.hash = '';
  return url;
}

/** Host einer URL ohne eckige Klammern (IPv6) */
const hostOf = (url: URL) => url.hostname.replace(/^\[|\]$/g, '');

// ---------------------------------------------------------------------------------------------
// Abruf
// ---------------------------------------------------------------------------------------------

export interface FetchIcsOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Welche Zieladressen sind erlaubt? Standard: `isPublicAddress`. Nur für Tests ersetzen. */
  addressPolicy?: (address: string) => boolean;
}

type Lookup = NonNullable<http.RequestOptions['lookup']>;

function guardedLookup(
  policy: (address: string) => boolean,
  onRefuse: (error: IcsFetchError) => void,
): Lookup {
  return ((hostname, options, callback) => {
    dns.lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
      const list = addresses ?? [];
      if (error) return callback(error, '', 4);
      if (list.length === 0 || list.some((entry) => !policy(entry.address))) {
        const refusal = new IcsFetchError(
          'blocked_address',
          'Die Adresse zeigt ins lokale Netz und wird nicht abgerufen.',
        );
        onRefuse(refusal);
        return callback(refusal as unknown as NodeJS.ErrnoException, '', 4);
      }
      const wantsAll = typeof options === 'object' && options !== null && 'all' in options && options.all;
      if (wantsAll) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
      const first = list[0] as dns.LookupAddress;
      return callback(null, first.address, first.family);
    });
  }) as Lookup;
}

const gunzipAsync = promisify(gunzip);
const inflateAsync = promisify(inflate);

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

function requestOnce(
  url: URL,
  policy: (address: string) => boolean,
  maxBytes: number,
  signal: AbortSignal,
): Promise<RawResponse> {
  return new Promise<RawResponse>((resolve, reject) => {
    const host = hostOf(url);
    // IP-Adressen im Host löst niemand auf, `lookup` wird dann nicht gerufen: hier selbst prüfen
    if (isIP(host) !== 0 && !policy(host)) {
      reject(
        new IcsFetchError('blocked_address', 'Die Adresse zeigt ins lokale Netz und wird nicht abgerufen.'),
      );
      return;
    }
    const client = url.protocol === 'https:' ? https : http;
    // Die Sperre aus `lookup` kommt je nach Node-Version verpackt an: hier merken und unverpackt weitergeben
    let refusal: IcsFetchError | null = null;
    const req = client.request(
      url,
      {
        method: 'GET',
        // Kein Agent: keine wiederverwendeten Verbindungen zu einer früher geprüften Adresse
        agent: false,
        lookup: guardedLookup(policy, (error) => (refusal = error)),
        signal,
        headers: {
          Accept: 'text/calendar, text/plain;q=0.8, */*;q=0.5',
          'Accept-Encoding': 'identity',
          'User-Agent': 'StudienGehirn-Core/1 (ICS-Abgleich)',
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        // Weiterleitungen und Fehler brauchen keinen Inhalt
        if (status < 200 || status >= 300) {
          res.resume();
          resolve({ status, headers: res.headers, body: Buffer.alloc(0) });
          return;
        }
        const declared = Number(res.headers['content-length']);
        if (Number.isFinite(declared) && declared > maxBytes) {
          reject(new IcsFetchError('too_large', 'Die Datei ist zu groß.'));
          res.destroy();
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            // Erst melden, dann trennen: das Trennen löst selbst ein „aborted“ aus
            reject(new IcsFetchError('too_large', 'Die Datei ist zu groß.'));
            res.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on('error', reject);
        res.on('aborted', () =>
          reject(new IcsFetchError('network_error', 'Die Verbindung wurde unterbrochen.')),
        );
      },
    );
    req.on('error', (error) => reject(refusal ?? error));
    req.end();
  });
}

async function decodeBody(response: RawResponse, maxBytes: number): Promise<string> {
  const encoding = String(response.headers['content-encoding'] ?? 'identity').toLowerCase();
  let body = response.body;
  if (encoding === 'gzip' || encoding === 'x-gzip' || encoding === 'deflate') {
    try {
      const options = { maxOutputLength: maxBytes };
      body = encoding === 'deflate' ? await inflateAsync(body, options) : await gunzipAsync(body, options);
    } catch {
      throw new IcsFetchError('too_large', 'Die Datei ist entpackt zu groß oder beschädigt.');
    }
  } else if (encoding !== 'identity' && encoding !== '') {
    throw new IcsFetchError('unsupported_encoding', `Die Kodierung „${encoding}“ wird nicht unterstützt.`);
  }
  return new TextDecoder('utf-8').decode(body);
}

/**
 * Lädt eine ICS-Datei von einer URL. Wirft `IcsFetchError` (→ 502 `ics_fetch_failed`) mit `reason`.
 * Das Zeitlimit gilt für den ganzen Abruf einschließlich der Weiterleitungen.
 */
export async function fetchIcs(rawUrl: string | URL, options: FetchIcsOptions = {}): Promise<string> {
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? FETCH_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? FETCH_MAX_REDIRECTS;
  const policy = options.addressPolicy ?? isPublicAddress;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let url: URL;
    try {
      url = typeof rawUrl === 'string' ? normalizeIcsUrl(rawUrl) : rawUrl;
    } catch (error) {
      throw new IcsFetchError('invalid_url', error instanceof Error ? error.message : 'Ungültige URL.');
    }
    for (let hop = 0; ; hop += 1) {
      const response = await requestOnce(url, policy, maxBytes, controller.signal);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.location;
        if (hop >= maxRedirects) {
          throw new IcsFetchError('too_many_redirects', 'Zu viele Weiterleitungen.');
        }
        if (!location) throw new IcsFetchError(`status_${response.status}`, 'Weiterleitung ohne Ziel.');
        let next: URL;
        try {
          next = new URL(location, url);
        } catch {
          throw new IcsFetchError('invalid_url', 'Die Weiterleitung hat ein ungültiges Ziel.');
        }
        if (next.protocol !== 'https:' && next.protocol !== 'http:') {
          throw new IcsFetchError('invalid_url', 'Weiterleitungen sind nur auf http und https erlaubt.');
        }
        if (next.username !== '' || next.password !== '') {
          throw new IcsFetchError('invalid_url', 'Die Weiterleitung enthält Zugangsdaten.');
        }
        url = next;
        continue;
      }
      if (response.status < 200 || response.status >= 300) {
        throw new IcsFetchError(
          `status_${response.status}`,
          `Der Server antwortet mit Status ${response.status}.`,
        );
      }
      return await decodeBody(response, maxBytes);
    }
  } catch (error) {
    if (error instanceof IcsFetchError) throw error;
    if (controller.signal.aborted)
      throw new IcsFetchError('timeout', 'Der Server antwortet nicht rechtzeitig.');
    throw new IcsFetchError(
      'network_error',
      `Der Server ist nicht erreichbar${error instanceof Error && 'code' in error ? ` (${String((error as { code: unknown }).code)})` : ''}.`,
    );
  } finally {
    clearTimeout(timer);
  }
}
