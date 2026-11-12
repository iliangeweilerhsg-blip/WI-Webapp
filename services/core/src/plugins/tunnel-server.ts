// Tunnel-Eingang des Core (UX-12, docs/plaene/UX-12-MAC-WIEDERFINDEN.md E2, §5.1; VERTRAEGE §5 und §12 Schritt 8).
//
// Ein zweiter HTTP-Server auf einem **Unix-Socket** (`<SG_DATA_DIR>/run/tunnel.sock`, Rechte 0600, Ordner 0700). Der
// Mac-Helfer `sg-tunnel` (PR 3) reicht dorthin die Bytes durch, die am TLS-PSK-Tunnel angekommen sind. Er bedient
// dieselben Routen und denselben WebSocket wie der Haupteingang (`app.routing`, die `upgrade`-Listener von
// `@fastify/websocket`), aber:
//
// - **Jede Anfrage gilt als Netz, nie als lokal.** Der Server legt jeden angenommenen Socket als Erstes in
//   `tunnelSockets` (`plugins/security.ts`). `isLocalRequest` prüft das vor der Adresse. Token ist Pflicht, lokale
//   Routen und `pair/*` sind gesperrt, `localOnly`-Ereignisse kommen nie an. Die Einstufung hängt nicht an der
//   Socket-Adresse (ein Unix-Socket hat ohnehin keine, das ist nur die zweite Sicherung).
// - **Nie ein TCP-Port.** Ein zweiter Port auf 127.0.0.1 wäre für jede adressbasierte Prüfung „lokal“.
// - **Eigene Grenzen statt `NetworkConnectionGate`** (ohne Adresse landeten alle Verbindungen in einem Topf):
//   `maxConnections = 32 × gekoppelte Geräte`, höchstens 128, dazu dieselben Zeitgrenzen wie am Haupteingang.
import http from 'node:http';
import { chmod, lstat, mkdir, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import { tunnelSockets } from './security.ts';
import { TunnelKeyStore, tunnelSocketPath } from '../services/tunnel.ts';

/** Verbindungen je Gerät am Tunnel-Eingang */
export const TUNNEL_CONNECTIONS_PER_DEVICE = 32;
/** Harte Obergrenze aller Verbindungen am Tunnel-Eingang */
export const TUNNEL_MAX_CONNECTIONS = 128;

/**
 * Längster Pfad eines Unix-Sockets: `sun_path` fasst 104 Byte (macOS) bzw. 108 (Linux) samt Endmarke. Ein längerer
 * Pfad ließe sich nicht binden; dann startet der Tunnel-Eingang nicht, statt einen abgeschnittenen Pfad zu nehmen.
 */
const MAX_SOCKET_PATH_BYTES = 103;

/** Zeitgrenzen wie am Haupteingang (`connectionLimits` in `app.ts`). Werden beim Start gelesen */
export interface TunnelServerLimits {
  connectionTimeoutMs: number;
  keepAliveTimeoutMs: number;
  requestTimeoutMs: number;
  maxRequestsPerSocket: number;
}

export interface TunnelEntranceOptions {
  app: FastifyInstance;
  dataDir: string;
  /** `false` (`SG_TUNNEL=0`): kein Socket, keine Schlüsseldatei (sie wird beim Start gelöscht) */
  enabled: boolean;
  /** Schlüsseldatei. `null` bei `enabled = false` */
  keys: TunnelKeyStore | null;
  /** Aktive (gekoppelte, nicht entfernte) Geräte für den Abgleich der Schlüsseldatei beim Start */
  activeDeviceIds: () => Promise<string[]>;
  limits: TunnelServerLimits;
  logger: Logger;
}

/** Zulässige Verbindungen: 32 je Gerät mit Schlüssel (mindestens ein Gerät gerechnet), höchstens 128 */
export function tunnelConnectionLimit(deviceCount: number): number {
  return Math.min(TUNNEL_MAX_CONNECTIONS, TUNNEL_CONNECTIONS_PER_DEVICE * Math.max(1, deviceCount));
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Tunnel-Eingang (UX-12). `main.ts` startet ihn nach dem erfolgreichen `listen` */
    tunnel: TunnelEntrance;
  }
}

export class TunnelEntrance {
  readonly socketPath: string;
  private server: http.Server | null = null;
  private stopListening: (() => void) | null = null;
  private dropped = 0;
  private lastDropWarn = Number.NEGATIVE_INFINITY;
  private readonly options: TunnelEntranceOptions;

  constructor(options: TunnelEntranceOptions) {
    this.options = options;
    this.socketPath = tunnelSocketPath(options.dataDir);
  }

  /** Die Schlüsseldatei des Core (`null` bei `SG_TUNNEL=0`) */
  get keys(): TunnelKeyStore | null {
    return this.options.keys;
  }

  /** Der laufende Server (Tests), sonst `null` */
  get httpServer(): http.Server | null {
    return this.server;
  }

  get listening(): boolean {
    return this.server?.listening === true;
  }

  /**
   * Startet den Tunnel-Eingang: Schlüsseldatei laden und abgleichen, dann den Unix-Socket binden.
   * Mit `SG_TUNNEL=0` stattdessen aufräumen (Schlüsseldatei und Socket-Datei löschen). Wirft bei Fehlern; der Aufrufer
   * (`main.ts`) protokolliert sie, der Core läuft dann ohne Tunnel weiter (sicherer Ausfall: kein Eingang).
   */
  async start(): Promise<void> {
    const { enabled, keys, logger } = this.options;
    if (!enabled || !keys) {
      await this.removeDisabledLeftovers();
      return;
    }
    if (this.server) return;
    await this.prepareKeys(keys);
    await this.listen(keys);
    logger.info({ socket: 'run/tunnel.sock' }, 'Tunnel-Eingang lauscht (Unix-Socket, zählt als Netz)');
  }

  /** Schlüsseldatei laden und mit den aktiven Geräten abgleichen (E3, §5.1 „Abgleich beim Start“) */
  private async prepareKeys(keys: TunnelKeyStore): Promise<void> {
    const { logger, activeDeviceIds } = this.options;
    await keys.load();
    let active: string[];
    try {
      active = await activeDeviceIds();
    } catch (error) {
      // Ohne Datenbank kein Abgleich: die Einträge bleiben, der Core prüft das Token ohnehin bei jeder Anfrage
      logger.warn({ err: error }, 'Abgleich der Tunnel-Schlüssel nicht möglich (Datenbank nicht erreichbar)');
      return;
    }
    const { removed, withoutKey } = await keys.reconcile(active);
    if (removed > 0)
      logger.info({ removed }, 'Tunnel-Schlüssel entfernter Geräte aus der Schlüsseldatei gelöscht');
    if (withoutKey > 0) {
      logger.warn(
        { devices: withoutKey },
        'Gekoppelte Geräte ohne Tunnel-Schlüssel (vor UX-12 gekoppelt oder wiederhergestellt): einmal neu koppeln',
      );
    }
  }

  private async listen(keys: TunnelKeyStore): Promise<void> {
    const { app, logger, limits } = this.options;
    if (Buffer.byteLength(this.socketPath) > MAX_SOCKET_PATH_BYTES) {
      throw new Error(
        `Der Pfad des Tunnel-Sockets ist zu lang (über ${MAX_SOCKET_PATH_BYTES} Byte). Ein kürzerer SG_DATA_DIR oder SG_TUNNEL=0 hilft.`,
      );
    }
    await this.prepareRunDir();
    await this.removeStaleSocket();

    const server = http.createServer((req, res) => {
      app.routing(req, res);
    });
    // **Als Erstes**: jeden Socket als Tunnel-Socket markieren, vor jedem anderen Listener. Ab da gilt jede Anfrage auf
    // ihm als Netz (`isLocalRequest`)
    server.prependListener('connection', (socket) => {
      tunnelSockets.add(socket);
    });
    // Zeitgrenzen wie am Haupteingang (Fastify setzt sie ebenso auf seinem Server)
    server.keepAliveTimeout = limits.keepAliveTimeoutMs;
    server.requestTimeout = limits.requestTimeoutMs;
    server.setTimeout(limits.connectionTimeoutMs);
    if (limits.maxRequestsPerSocket > 0) server.maxRequestsPerSocket = limits.maxRequestsPerSocket;
    // Fehlerbehandlung und WebSocket-Upgrade teilen sich Haupt- und Tunnel-Server: Fastifys `clientError`-Handler
    // und der `upgrade`-Listener von @fastify/websocket hängen am Haupt-Server (bereit nach `app.ready()`)
    for (const listener of app.server.listeners('clientError')) {
      server.on('clientError', listener as (...args: unknown[]) => void);
    }
    for (const listener of app.server.listeners('upgrade')) {
      server.on('upgrade', listener as (...args: unknown[]) => void);
    }
    // Eigene Grenze: 32 je Gerät, höchstens 128. Node zählt `maxConnections` bei jeder neuen Verbindung neu
    const applyLimit = (): void => {
      server.maxConnections = tunnelConnectionLimit(keys.size);
    };
    applyLimit();
    this.stopListening = keys.onChange(applyLimit);
    server.on('drop', () => this.warnDropped());
    server.on('error', (error) => logger.error({ err: error }, 'Tunnel-Eingang: Serverfehler'));

    try {
      await new Promise<void>((resolve, reject) => {
        const failed = (error: Error): void => reject(error);
        server.once('error', failed);
        server.listen(this.socketPath, () => {
          server.off('error', failed);
          resolve();
        });
      });
    } catch (error) {
      this.stopListening?.();
      this.stopListening = null;
      throw error;
    }
    this.server = server;
    try {
      // Der Ordner `run/` (0700) schützt schon; die Datei selbst bekommt zusätzlich ausdrücklich 0600
      await chmod(this.socketPath, 0o600);
      const info = await lstat(this.socketPath);
      if (!info.isSocket() || (info.mode & 0o777) !== 0o600) {
        throw new Error('Die Socket-Datei des Tunnel-Eingangs hat nicht die Rechte 0600.');
      }
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  /** `run/` muss ein echter Ordner sein (kein Symlink), uns gehören und 0700 haben; fehlt er, wird er angelegt */
  private async prepareRunDir(): Promise<void> {
    const dir = dirname(this.socketPath);
    const info = await lstat(dir).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (info === null) await mkdir(dir, { mode: 0o700, recursive: true });
    const checked = await lstat(dir);
    if (checked.isSymbolicLink() || !checked.isDirectory()) {
      throw new Error('run/ ist kein echter Ordner (Symlink?). Der Tunnel-Eingang startet dort nicht.');
    }
    const uid = process.getuid?.();
    if (uid !== undefined && checked.uid !== uid) {
      throw new Error('run/ gehört einem anderen Benutzer. Der Tunnel-Eingang startet dort nicht.');
    }
    await chmod(dir, 0o700);
  }

  /** Eine alte Socket-Datei (z. B. nach einem Absturz) wird entfernt, ein Symlink dort selbst, nie sein Ziel */
  private async removeStaleSocket(): Promise<void> {
    const info = await lstat(this.socketPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (info === null) return;
    if (info.isDirectory()) throw new Error('An der Stelle des Tunnel-Sockets liegt ein Ordner.');
    await rm(this.socketPath, { force: true });
  }

  /** `SG_TUNNEL=0`: weder Socket noch Schlüsseldatei. Beides wird beim Start entfernt, falls es sie gibt */
  private async removeDisabledLeftovers(): Promise<void> {
    const { keys, dataDir, logger } = this.options;
    try {
      if (keys) await keys.deleteFile();
      else await rm(new TunnelKeyStore({ dataDir }).file, { force: true });
      const info = await lstat(this.socketPath).catch(() => null);
      if (info && !info.isDirectory()) await rm(this.socketPath, { force: true });
    } catch (error) {
      logger.warn({ err: error }, 'SG_TUNNEL=0: Aufräumen von Schlüsseldatei und Socket ist fehlgeschlagen');
    }
  }

  /** Höchstens eine Warnung je Minute (#87): Überzählige Verbindungen am Tunnel-Eingang werden sofort geschlossen */
  private warnDropped(): void {
    this.dropped++;
    const now = Date.now();
    if (now - this.lastDropWarn < 60_000) return;
    this.options.logger.warn(
      { dropped: this.dropped },
      'Verbindungen am Tunnel-Eingang über der Grenze geschlossen',
    );
    this.lastDropWarn = now;
    this.dropped = 0;
  }

  /** Schließt den Eingang und alle seine Verbindungen (nach den WebSockets, die der Hub mit 1001 beendet) */
  async stop(): Promise<void> {
    this.stopListening?.();
    this.stopListening = null;
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }
}

/** Legt den Tunnel-Eingang an und hängt ihn an die App (`app.tunnel`, schließt beim Beenden) */
export function registerTunnel(
  app: FastifyInstance,
  options: Omit<TunnelEntranceOptions, 'app'>,
): TunnelEntrance {
  const entrance = new TunnelEntrance({ ...options, app });
  app.decorate('tunnel', entrance);
  app.addHook('onClose', async () => {
    await entrance.stop();
  });
  return entrance;
}
