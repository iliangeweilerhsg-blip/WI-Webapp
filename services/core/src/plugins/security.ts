import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import { isIP, type Socket } from 'node:net';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.ts';
import { HttpError } from '../errors.ts';
import { sourceKey, type RejectionLog } from './rejection-log.ts';

/**
 * Sicherheitsregeln des Core (docs/VERTRAEGE.md §5, §7, §11.1, §16.2, 09 §4):
 *
 * 1. „Lokal“ entscheidet allein `isLocalRequest`: die Socket-Adresse (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`), aber
 *    **nie** für einen Socket des Tunnel-Eingangs (UX-12, `tunnelSockets`): Der gilt immer als Netz, auch wenn jemand
 *    seine Adresse fälscht. `Host` und `X-Forwarded-For` zählen dafür nie, `trustProxy` bleibt aus (Fastify-Standard).
 *    Außerhalb dieser Datei darf niemand `isLoopbackAddress` aufrufen (Architekturtest): alle Lokal-Prüfungen der
 *    Routen und des Logs gehen über `isLocalRequest`.
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
 *    gültigem Token. Ohne Token gilt vorher Regel 3 (401). Am Tunnel-Eingang sind außerdem die Kopplungsrouten
 *    (`sgAccess = 'pairing'`) gesperrt: 403 `local_only`, mit und ohne Token (gekoppelt wird nur im IP-Netz).
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

/**
 * Alle Sockets, die der Tunnel-Server des Core angenommen hat (UX-12). Der Server legt jeden Socket im Ereignis
 * `connection` hier hinein, vor allem anderen. Die Markierung hängt am Socket-Objekt: Sie gilt für Fastify-Anfragen,
 * rohe Upgrades (`IncomingMessage.socket` ist derselbe Socket), Keep-Alive-Folgeanfragen und die Fehlerpfade
 * (`frameworkErrors`), weil alle über `isLocalRequest` laufen.
 */
export const tunnelSockets = new WeakSet<object>();

/** Hat der Tunnel-Server diesen Socket angenommen? (UX-12) */
export function isTunnelSocket(socket: object | null | undefined): boolean {
  return socket !== null && socket !== undefined && tunnelSockets.has(socket);
}

/**
 * Nur `isLocalRequest` darf diese Funktion aufrufen (Architekturtest, B17 im Plan UX-12). Sie kennt den Tunnel nicht:
 * Wer eine Anfrage als lokal einstuft, muss `isLocalRequest` nehmen.
 */
export function isLoopbackAddress(address: string | undefined): boolean {
  return address !== undefined && LOOPBACK_ADDRESSES.has(address);
}

/**
 * `true` nur für Anfragen, deren Socket-Adresse Loopback ist (nie Host oder X-Forwarded-For) **und** deren Socket
 * nicht vom Tunnel-Eingang stammt. Die Markierung steht vor der Adresse: Auch ein Tunnel-Socket mit gefälschtem
 * `remoteAddress = '127.0.0.1'` gilt als Netz. **Die** Stelle für „lokal“ im ganzen Core.
 */
export function isLocalRequest(request: { socket: { remoteAddress?: string | undefined } }): boolean {
  if (tunnelSockets.has(request.socket)) return false;
  return isLoopbackAddress(request.socket.remoteAddress);
}

/**
 * Quelle einer Anfrage für die Zusammenfassung abgelehnter Netzanfragen (#87): Am Tunnel-Eingang gibt es keine
 * Adresse, alle Tunnel-Anfragen teilen sich die Quelle `tunnel`.
 */
export function rejectionSource(request: {
  socket: { remoteAddress?: string | undefined };
}): string | undefined {
  return tunnelSockets.has(request.socket) ? 'tunnel' : request.socket.remoteAddress;
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

/** Frist, nach der ein abgelehnter Upgrade-Socket hart geschlossen wird, falls der Client seine Seite offen hält */
const REJECTED_UPGRADE_GRACE_MS = 1000;

/**
 * Abgelehnter Upgrade (WebSocket oder jeder andere Upgrade-Header): `Connection: close` setzen und den Socket nach der Antwort schließen.
 * Der Socket gehört nach dem `upgrade`-Ereignis nicht mehr dem HTTP-Server, für ihn gelten weder
 * `keepAliveTimeout` noch `requestTimeout`. Erst `end()` (die Antwort kommt sicher an), dann nach einer
 * kurzen Frist `destroy()`, weil ein Angreifer seine Seite nie schließen würde.
 */
export function closeRejectedUpgrade(
  raw: { headers: IncomingHttpHeaders; socket?: unknown; upgrade?: boolean },
  response: {
    setHeader?: (name: string, value: string) => unknown;
    once: (event: 'finish', cb: () => void) => unknown;
  },
): void {
  // Node löst 'upgrade' für jeden Upgrade-Header aus (auch h2c, mehrfach, unbekannt), sobald `Connection: Upgrade`
  // mitkommt. Dann gehört der Socket nicht mehr dem HTTP-Server, egal ob es ein WebSocket werden sollte
  if (raw.upgrade !== true && !isWebSocketUpgrade(raw.headers)) return;
  const socket = raw.socket as { end?: () => void; destroy?: () => void; destroyed?: boolean } | undefined;
  try {
    response.setHeader?.('connection', 'close');
  } catch {
    // Header schon gesendet: dann nur schließen
  }
  response.once('finish', () => {
    if (!socket || socket.destroyed) return;
    socket.end?.();
    setTimeout(() => {
      if (!socket.destroyed) socket.destroy?.();
    }, REJECTED_UPGRADE_GRACE_MS).unref();
  });
}

/** Was der Verbindungswächter von einem Socket braucht. Passt auf `net.Socket`, Unit-Tests geben Attrappen */
export interface GateSocket {
  readonly remoteAddress?: string | undefined;
  readonly destroyed?: boolean;
  destroy(): void;
  once(event: 'close', listener: () => void): unknown;
}

/** Grenzen des Verbindungswächters. Werden bei jeder Verbindung neu gelesen (Tests ändern das Objekt) */
export interface ConnectionGateLimits {
  /** Offene Verbindungen ohne Vorrang je Quelle (IPv6 je /64) bzw. mit Vorrang je genauer Adresse */
  maxPerSource: number;
  /** Offene Netzverbindungen ohne Vorrang insgesamt */
  maxNetwork: number;
  /** So lange darf eine Verbindung ohne Token-Vorrang bis zu den Headern ihrer ersten Anfrage brauchen */
  firstRequestTimeoutMs: number;
  /** Längste Dauer einer Netzanfrage ohne Token samt Body (nur Kopplungsrouten kommen am Wächter vorbei) */
  tokenlessRequestTimeoutMs: number;
  /** So lange nach der letzten Anfrage mit gültigem Token hat eine Quelladresse Vorrang */
  trustedAddressTtlMs: number;
  /** Höchstens so viele Adressen mit Vorrang; die am längsten nicht bestätigte fällt heraus */
  maxTrustedAddresses: number;
}

interface GateEntry {
  socket: GateSocket;
  /** `sourceKey`: IPv4, IPv6 je /64 */
  key: string;
  /** Genaue Adresse (IPv4-mapped als IPv4) */
  address: string;
  /** Reihenfolge der Annahme, für „älteste zuerst“ */
  seq: number;
  /** `open`: zählt gegen `maxNetwork` und kann verdrängt werden. `protected`: Vorrang (Token oder Adresse) */
  bucket: 'open' | 'protected' | 'gone';
  /** Auf dieser Verbindung kam schon eine Anfrage mit gültigem Token an */
  authenticated: boolean;
  firstRequestTimer?: ReturnType<typeof setTimeout> | undefined;
}

/** Genaue Quelladresse, IPv4-mapped IPv6 als IPv4 (anders als `sourceKey` ohne /64-Zusammenfassung) */
function exactAddress(address: string | undefined): string {
  if (!address) return 'unbekannt';
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  return mapped?.[1] ?? address.toLowerCase();
}

/**
 * Verbindungswächter für Netzverbindungen (#84 M-1, #185). Loopback zählt nie.
 *
 * Ziel: Ein gekoppeltes Gerät kommt immer durch, auch wenn ein Gerät ohne Token im WLAN die Grenzen ausreizt.
 *
 * - **Vorrang an der Verbindung:** Trägt eine Anfrage ein gültiges Token, gilt ihre Verbindung als authentifiziert.
 *   Sie zählt ab dann nicht mehr gegen `maxNetwork` und wird nie verdrängt. Das ist an das Token gebunden und lässt
 *   sich mit einer gefälschten Adresse nicht erschleichen.
 * - **Vorrang an der Adresse (15 min):** Die genaue Quelladresse (IPv6 nicht je /64) einer Anfrage mit gültigem
 *   Token ist danach `trustedAddressTtlMs` lang freigegeben. Neue Verbindungen von dort zählen nicht gegen
 *   `maxNetwork`, je Adresse gelten höchstens `maxPerSource`. So muss eine neue Verbindung des iPads nicht erst um
 *   einen Platz kämpfen, bevor sie ihr Token zeigen kann. Wer die Adresse fälscht (ARP-/NDP-Spoofing), bekommt nur
 *   bis zu `maxPerSource` Plätze außerhalb von `maxNetwork`, aber keinen Zugriff: Jede Anfrage braucht ein Token.
 * - **Verdrängen statt abweisen:** Ist `maxNetwork` voll, wird die älteste Verbindung ohne Vorrang aus der Quelle mit
 *   den meisten solchen Verbindungen geschlossen und die neue angenommen. Ein Angreifer mit vielen Verbindungen
 *   verdrängt so sich selbst, nicht die eine neue Verbindung des iPads. Über `maxPerSource` je Quelle wird weiter
 *   abgewiesen: Das ist das eigene Budget der Quelle.
 * - **Kurze Fristen ohne Token:** Eine Verbindung muss die Header ihrer ersten Anfrage binnen
 *   `firstRequestTimeoutMs` senden, sofern sie nicht schon ein gültiges Token gezeigt hat. Eine Netzanfrage ohne
 *   Token, die der Wächter durchlässt (Kopplung), muss binnen `tokenlessRequestTimeoutMs` samt Body beantwortet
 *   sein. Langsame Uploads gibt es nur mit Token.
 * - Vom Wächter abgelehnte Netzanfragen bekommen `Connection: close` (`registerSecurity`). So hält niemand einen
 *   Platz mit Keep-Alive-401 oder einem tröpfelnden Body nach der 401.
 * - Dasselbe gilt für Antworten an Netzverbindungen ohne gültiges Token, die der Wächter durchgelassen hat
 *   (Kopplungsrouten): siehe `closesTokenlessResponse` (H-1 aus #191).
 */
export class NetworkConnectionGate {
  private readonly entries = new WeakMap<GateSocket, GateEntry>();
  /** Verbindungen ohne Vorrang je Quelle, in Annahme-Reihenfolge */
  private readonly open = new Map<string, Set<GateEntry>>();
  private openCount = 0;
  private readonly protectedPerAddress = new Map<string, number>();
  /** Adresse → Ablaufzeitpunkt, die am längsten nicht bestätigte zuerst */
  private readonly trusted = new Map<string, number>();
  private seq = 0;
  private dropped = 0;
  private evicted = 0;
  private lastWarn = Number.NEGATIVE_INFINITY;
  private readonly now: () => number;
  private readonly limits: ConnectionGateLimits;
  private readonly logger: { warn: (fields: object, message: string) => void } | undefined;

  constructor(
    limits: ConnectionGateLimits,
    logger?: { warn: (fields: object, message: string) => void },
    options: { now?: () => number } = {},
  ) {
    this.limits = limits;
    this.logger = logger;
    this.now = options.now ?? Date.now;
  }

  /** Hängt den Wächter an einen HTTP-Server */
  attach(server: {
    on(event: 'connection', listener: (socket: Socket) => void): unknown;
    on(event: 'request', listener: (request: IncomingMessage) => void): unknown;
  }): void {
    server.on('connection', (socket: Socket) => this.admit(socket));
    server.on('request', (request: IncomingMessage) => this.requestStarted(request.socket));
  }

  /** Offene Netzverbindungen ohne Vorrang (zählen gegen `maxNetwork`) */
  get openConnections(): number {
    return this.openCount;
  }

  /** Neue Verbindung: mit Vorrang annehmen, annehmen, dafür eine andere verdrängen oder sofort schließen */
  admit(socket: GateSocket): void {
    // Loopback zählt nie. Tunnel-Sockets sind nie am Wächter angemeldet (eigene Grenzen am Tunnel-Server), und ohne
    // Adresse würden alle in den Topf `unbekannt` fallen
    if (isLoopbackAddress(socket.remoteAddress) || tunnelSockets.has(socket)) return;
    const entry: GateEntry = {
      socket,
      key: sourceKey(socket.remoteAddress),
      address: exactAddress(socket.remoteAddress),
      seq: ++this.seq,
      bucket: 'gone',
      authenticated: false,
    };
    if (
      this.isTrusted(entry.address) &&
      (this.protectedPerAddress.get(entry.address) ?? 0) < this.limits.maxPerSource
    ) {
      this.addProtected(entry);
    } else {
      if ((this.open.get(entry.key)?.size ?? 0) >= this.limits.maxPerSource) {
        this.reject(socket, entry.key);
        return;
      }
      if (this.openCount >= this.limits.maxNetwork) {
        const victim = this.pickVictim();
        if (!victim) {
          this.reject(socket, entry.key);
          return;
        }
        this.release(victim);
        victim.socket.destroy();
        this.evicted++;
        this.warn(victim.key);
      }
      this.addOpen(entry);
    }
    this.entries.set(socket, entry);
    const timer = setTimeout(() => {
      entry.firstRequestTimer = undefined;
      if (!entry.authenticated && entry.bucket !== 'gone' && !socket.destroyed) socket.destroy();
    }, this.limits.firstRequestTimeoutMs);
    timer.unref?.();
    entry.firstRequestTimer = timer;
    socket.once('close', () => this.release(entry));
  }

  /** Die Header einer Anfrage sind da: Die Frist bis zur ersten Anfrage ist erfüllt */
  requestStarted(socket: GateSocket): void {
    const entry = this.entries.get(socket);
    if (entry) this.clearFirstRequestTimer(entry);
  }

  /** Eine Anfrage auf diesem Socket trug ein gültiges Token: Verbindung und Adresse bekommen Vorrang */
  authenticate(socket: GateSocket): void {
    // Tunnel-Sockets überspringen: sonst würde die Pseudo-Adresse `unbekannt` für 15 min freigegeben (UX-12, S6)
    if (isLoopbackAddress(socket.remoteAddress) || tunnelSockets.has(socket)) return;
    const address = exactAddress(socket.remoteAddress);
    this.trust(address);
    const entry = this.entries.get(socket);
    if (!entry || entry.bucket === 'gone') return;
    entry.authenticated = true;
    this.clearFirstRequestTimer(entry);
    if (entry.bucket === 'open' && (this.protectedPerAddress.get(address) ?? 0) < this.limits.maxPerSource) {
      this.removeOpen(entry);
      this.addProtected(entry);
    }
  }

  /** Netzanfrage ohne Token (Kopplung): Socket schließen, wenn die Antwort nicht binnen der Frist fertig ist */
  limitTokenlessRequest(
    socket: GateSocket,
    response: { once(event: 'close', cb: () => void): unknown },
  ): void {
    const entry = this.entries.get(socket);
    if (!entry || entry.bucket === 'gone') return;
    const timer = setTimeout(() => {
      if (!socket.destroyed) socket.destroy();
    }, this.limits.tokenlessRequestTimeoutMs);
    timer.unref?.();
    response.once('close', () => clearTimeout(timer));
  }

  private isTrusted(address: string): boolean {
    const expires = this.trusted.get(address);
    if (expires === undefined) return false;
    if (expires > this.now()) return true;
    this.trusted.delete(address);
    return false;
  }

  private trust(address: string): void {
    // Neu einsortieren, damit die Map nach letzter Bestätigung geordnet bleibt
    this.trusted.delete(address);
    this.trusted.set(address, this.now() + this.limits.trustedAddressTtlMs);
    while (this.trusted.size > this.limits.maxTrustedAddresses) {
      const oldest = this.trusted.keys().next().value;
      if (oldest === undefined) break;
      this.trusted.delete(oldest);
    }
  }

  /** Älteste nicht authentifizierte Verbindung aus der Quelle mit den meisten solchen Verbindungen */
  private pickVictim(): GateEntry | undefined {
    let victim: GateEntry | undefined;
    let victimCount = 0;
    for (const set of this.open.values()) {
      let count = 0;
      let oldest: GateEntry | undefined;
      for (const entry of set) {
        if (entry.authenticated) continue;
        count++;
        oldest ??= entry;
      }
      if (!oldest) continue;
      if (count > victimCount || (count === victimCount && victim && oldest.seq < victim.seq)) {
        victim = oldest;
        victimCount = count;
      }
    }
    return victim;
  }

  private addOpen(entry: GateEntry): void {
    let set = this.open.get(entry.key);
    if (!set) {
      set = new Set();
      this.open.set(entry.key, set);
    }
    set.add(entry);
    this.openCount++;
    entry.bucket = 'open';
  }

  private removeOpen(entry: GateEntry): void {
    const set = this.open.get(entry.key);
    if (set?.delete(entry)) {
      this.openCount--;
      if (set.size === 0) this.open.delete(entry.key);
    }
    entry.bucket = 'gone';
  }

  private addProtected(entry: GateEntry): void {
    this.protectedPerAddress.set(entry.address, (this.protectedPerAddress.get(entry.address) ?? 0) + 1);
    entry.bucket = 'protected';
  }

  /** Zählt die Verbindung sofort heraus (nicht erst bei `close`, das nach `destroy()` asynchron kommt) */
  private release(entry: GateEntry): void {
    this.clearFirstRequestTimer(entry);
    if (entry.bucket === 'open') {
      this.removeOpen(entry);
    } else if (entry.bucket === 'protected') {
      const left = (this.protectedPerAddress.get(entry.address) ?? 1) - 1;
      if (left > 0) this.protectedPerAddress.set(entry.address, left);
      else this.protectedPerAddress.delete(entry.address);
    }
    entry.bucket = 'gone';
  }

  private clearFirstRequestTimer(entry: GateEntry): void {
    if (entry.firstRequestTimer) clearTimeout(entry.firstRequestTimer);
    entry.firstRequestTimer = undefined;
  }

  private reject(socket: GateSocket, key: string): void {
    socket.destroy();
    this.dropped++;
    this.warn(key);
  }

  /** Keine Zeile je Verbindung (#87): höchstens eine je Minute */
  private warn(source: string): void {
    const now = this.now();
    if (now - this.lastWarn < 60_000) return;
    this.logger?.warn(
      { source, dropped: this.dropped, evicted: this.evicted },
      'Verbindungen aus dem Netz über der Grenze geschlossen',
    );
    this.lastWarn = now;
    this.dropped = 0;
    this.evicted = 0;
  }
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
    // Nur die Socket-Adresse und die Markierung des Tunnel-Eingangs zählen (kein X-Forwarded-For, trustProxy ist aus)
    const local = isLocalRequest(request);
    const tunnel = tunnelSockets.has(request.socket);
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
      // Tunnel-Eingang (UX-12): gekoppelt wird nur im IP-Netz. `pair/start` und `pair/confirm` sind dort gesperrt,
      // mit und ohne Token, und kommen nie ohne Token durch
      if (tunnel && access === 'pairing') {
        throw new HttpError(403, 'local_only', 'Gekoppelt wird nur im IP-Netz, nicht über den Tunnel.');
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
 * Statuscodes, bei denen der Core einer Netzverbindung ohne gültiges Token nach der Antwort `Connection: close`
 * setzt (H-1 aus #191): 400 (ungültige Anfrage), 429 (Rate-Limit), dazu 403 (Kopplungsroute mit `Origin`, also
 * ein Browser) und 413 (Body zu groß, der Rest des Bodys ist ungelesen). Bewusst NICHT dabei: 404, 409, 423 und
 * andere Antworten der Kopplung (Fenster geschlossen, gesperrt), die ein echtes iPad zum Wiederholen oder
 * Anzeigen braucht. Selbst bei den gelisteten Codes kostet das dem iPad nur einen neuen Verbindungsaufbau.
 */
const TOKENLESS_CLOSE_STATUS = new Set([400, 403, 413, 429]);

/**
 * Soll die Verbindung nach dieser Antwort schließen? Nur für Anfragen aus dem Netz (auch Tunnel-Eingang), die
 * kein gültiges Token trugen (`sgDevice` undefiniert). Lokale (`null`) und authentifizierte Anfragen: nie.
 */
export function closesTokenlessResponse(args: {
  local: boolean;
  device: SgDevice | undefined;
  statusCode: number;
}): boolean {
  return !args.local && args.device === undefined && TOKENLESS_CLOSE_STATUS.has(args.statusCode);
}

/**
 * `rejections`: Zähler für abgelehnte Netzanfragen (#87). Ohne ihn loggt jede Anfrage einzeln, wie Fastify es tut.
 * Mit ihm muss Fastify den `RequestLogController` bekommen, der abgelehnte Netzanfragen still lässt.
 */
export function registerSecurity(
  app: FastifyInstance,
  guard: SecurityGuard,
  rejections?: RejectionLog,
  connections?: NetworkConnectionGate,
): void {
  app.decorateRequest('sgDevice', undefined);
  app.decorate('authenticateUpgrade', async (request: GuardRequest) => {
    // Ohne Routing gibt es keine Ausnahme: Kopplungs-Routen sind keine Upgrades
    // (Felder einzeln: bei `IncomingMessage` sind `headers` usw. Getter, ein Spread würde sie verlieren)
    const result = await guard({ method: request.method, headers: request.headers, socket: request.socket });
    if (result && connections && !isLocalRequest(request)) {
      connections.authenticate(request.socket as GateSocket);
    }
    return result ?? null;
  });
  app.addHook('onRequest', async (request, reply) => {
    let device: SgDevice | undefined;
    try {
      device = await guard(request);
    } catch (error) {
      if (!isLocalRequest(request) && error instanceof HttpError) {
        if (rejections) {
          rejections.record(rejectionSource(request), error.statusCode);
          request.sgRejectionCounted = true;
        }
        // Abgelehnte Netzanfrage (401/403/421): Verbindung nach der Antwort schließen (#185). Sonst hält ein Gerät
        // ohne Token seinen Platz mit Keep-Alive-401 oder einem tröpfelnden Body nach der 401
        reply.header('connection', 'close');
      }
      // Abgelehnter WebSocket-Upgrade: Die Antwort geht direkt auf den Socket, den der HTTP-Server nach dem
      // `upgrade`-Ereignis nicht mehr verwaltet. Ohne eigenes Schließen bliebe er serverseitig halb offen hängen
      // (je abgelehntem Versuch ein Socket, Ressourcen-Leck).
      closeRejectedUpgrade(request.raw, reply.raw);
      throw error;
    }
    if (device !== undefined) request.sgDevice = device;
    if (connections && !isLocalRequest(request)) {
      // Gültiges Token: Verbindung und Adresse bekommen Vorrang vor Geräten ohne Token (#185)
      if (device) connections.authenticate(request.raw.socket);
      // Kopplungsroute ohne Token: kurze Frist samt Body, langsame Anfragen gibt es nur mit Token
      else if (device === undefined) connections.limitTokenlessRequest(request.raw.socket, reply.raw);
    }
    // Kopplungsrouten aus dem Netz (`device` undefiniert) sind ohne Token offen: nicht vorab freigeben, sonst
    // flutet jede Anfrage (auch 400/409/429) das Log. Siehe `onResponse` unten.
    if (rejections && device !== undefined) {
      request.sgAdmitted = true;
      // Angenommene Netzanfragen loggen wie bisher; der Request-Log-Controller hat die Zeile bis hierhin zurückgehalten
      if (!isLocalRequest(request)) request.log.info({ req: request }, 'incoming request');
    }
  });
  // Antworten an Netzverbindungen ohne Token (Kopplung): 400/429 usw. schließen die Verbindung (H-1 aus #191).
  // `onSend` läuft vor dem Schreiben der Header, auch für Fehlerantworten aus Handlern und Validierung
  app.addHook('onSend', async (request, reply, payload) => {
    if (
      closesTokenlessResponse({
        local: isLocalRequest(request),
        device: request.sgDevice,
        statusCode: reply.statusCode,
      })
    ) {
      reply.header('connection', 'close');
    }
    return payload;
  });
  if (rejections) {
    app.addHook('onResponse', async (request, reply) => {
      if (request.sgAdmitted || request.sgRejectionCounted || isLocalRequest(request)) return;
      // Netzanfrage ohne Freigabe (Kopplungsroute): ab 4xx nur zählen, sonst einzeln loggen wie bisher
      if (reply.statusCode >= 400) {
        rejections.record(rejectionSource(request), reply.statusCode);
        request.sgRejectionCounted = true;
      } else {
        request.log.info({ req: request }, 'incoming request');
        request.log.info({ res: reply, responseTime: reply.elapsedTime }, 'request completed');
      }
    });
  }
}
