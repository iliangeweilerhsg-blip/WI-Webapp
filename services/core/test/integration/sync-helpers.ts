// Hilfen für die Sync-Tests (T1-08): echte App auf einem freien Port, echter WebSocket-Client.
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { networkInterfaces } from 'node:os';
import type { FastifyRequest } from 'fastify';
import { pino } from 'pino';
import { buildApp, type BuildAppOptions } from '../../src/app.ts';
import type { Config } from '../../src/config.ts';
import { createDb, type DbHandle } from '../../src/db/client.ts';
import { uuidv7 } from '../../src/lib/uuid7.ts';
import { testConfig } from './helpers.ts';

// `ws` kommt als Abhängigkeit von @fastify/websocket mit (kein eigener Eintrag im Lockfile, keine Typen)
const requireFromCore = createRequire(import.meta.url);
const requireFromPlugin = createRequire(requireFromCore.resolve('@fastify/websocket'));

interface WsLike {
  readyState: number;
  send(data: string | Buffer, cb?: (error?: Error) => void): void;
  close(code?: number): void;
  terminate(): void;
  on(event: 'open', fn: () => void): void;
  on(event: 'message', fn: (data: Buffer, isBinary: boolean) => void): void;
  on(event: 'close', fn: (code: number, reason: Buffer) => void): void;
  on(event: 'error', fn: (error: Error) => void): void;
  on(event: 'unexpected-response', fn: (req: unknown, res: { statusCode: number }) => void): void;
}
type WsConstructor = new (
  url: string,
  options?: { headers?: Record<string, string>; maxPayload?: number },
) => WsLike;
const WebSocketClient = requireFromPlugin('ws') as WsConstructor;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(predicate: () => boolean, timeoutMs = 5000, what = 'Bedingung'): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Zeitüberschreitung beim Warten auf ${what}`);
    await sleep(5);
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/** Erste IPv4-Adresse, die nicht Loopback ist (für Verbindungen „aus dem Netz“), sonst `null` */
export function networkAddress(): string | null {
  for (const list of Object.values(networkInterfaces())) {
    for (const info of list ?? []) {
      if (info.family === 'IPv4' && !info.internal) return info.address;
    }
  }
  return null;
}

export interface SyncTestApp {
  config: Config;
  handle: DbHandle;
  port: number;
  close: () => Promise<void>;
}

/** Echte App, die auf `host` lauscht. `devices`: Token → Gerät (simuliert T1-10 über `request.sgDevice`) */
export async function startSyncApp(
  options: { host?: string; devices?: Record<string, string | null>; extra?: Partial<BuildAppOptions> } = {},
): Promise<SyncTestApp> {
  const port = await freePort();
  const config = testConfig({ port });
  const handle = createDb(config.databaseUrl);
  const devices = options.devices;
  const app = await buildApp({
    config,
    db: handle.db,
    logger: pino({ level: 'silent' }),
    ...(devices
      ? {
          // So wird T1-10 den Wächter verdrahten: gültiges Token → request.sgDevice
          verifyDeviceToken: async (token: string, request: FastifyRequest) => {
            if (!(token in devices)) return false;
            const deviceId = devices[token];
            if (deviceId !== null && deviceId !== undefined) {
              (request as FastifyRequest & { sgDevice?: unknown }).sgDevice = { deviceId };
            }
            return true;
          },
        }
      : {}),
    ...options.extra,
  });
  await app.listen({ port, host: options.host ?? '127.0.0.1' });
  return {
    config,
    handle,
    port,
    close: async () => {
      await app.close();
      await handle.close();
    },
  };
}

export type Msg = Record<string, unknown> & { type: string };

export class TestClient {
  readonly ws: WsLike;
  readonly messages: Msg[] = [];
  closeCode: number | null = null;
  closeReason = '';
  httpStatus: number | null = null;
  private opened = false;

  constructor(url: string, headers: Record<string, string> = {}) {
    this.ws = new WebSocketClient(url, { headers, maxPayload: 64 * 1024 * 1024 });
    this.ws.on('open', () => {
      this.opened = true;
    });
    this.ws.on('message', (data) => {
      this.messages.push(JSON.parse(data.toString('utf8')) as Msg);
    });
    this.ws.on('close', (code, reason) => {
      this.closeCode = code;
      this.closeReason = reason.toString('utf8');
    });
    this.ws.on('error', () => {});
    this.ws.on('unexpected-response', (_req, res) => {
      this.httpStatus = res.statusCode;
      this.closeCode = -1;
    });
  }

  static async open(url: string, headers: Record<string, string> = {}): Promise<TestClient> {
    const client = new TestClient(url, headers);
    await waitFor(() => client.opened || client.closeCode !== null, 5000, 'WebSocket offen');
    if (!client.opened)
      throw new Error(`Verbindung abgelehnt: HTTP ${client.httpStatus}, Code ${client.closeCode}`);
    return client;
  }

  send(message: unknown): void {
    this.ws.send(typeof message === 'string' ? message : JSON.stringify(message));
  }

  async hello(streams: unknown[] = [], extra: Record<string, unknown> = {}): Promise<Msg> {
    this.send({ type: 'hello', protocol: 1, client: 'web', app_version: 'test', streams, ...extra });
    return this.next((m) => m.type === 'welcome' || m.type === 'error');
  }

  /** Wartet auf die nächste passende Nachricht (auch schon empfangene, die noch niemand genommen hat) */
  async next(predicate: (m: Msg) => boolean, timeoutMs = 5000): Promise<Msg> {
    let found: Msg | undefined;
    await waitFor(
      () => {
        const index = this.messages.findIndex(predicate);
        if (index < 0) return false;
        found = this.messages.splice(index, 1)[0];
        return true;
      },
      timeoutMs,
      'Nachricht',
    );
    return found!;
  }

  of(type: string): Msg[] {
    return this.messages.filter((m) => m.type === type);
  }

  async closed(timeoutMs = 5000): Promise<number> {
    await waitFor(() => this.closeCode !== null, timeoutMs, 'Schließen');
    return this.closeCode!;
  }

  close(): void {
    if (this.ws.readyState <= 1) this.ws.close();
  }
}

export const sessionStream = (id = uuidv7()) => `session:${id}`;

/** Gültige `marker.add`-Operation im Strom `session:<id>` */
export function markerOp(stream: string, overrides: Record<string, unknown> = {}): Msg {
  const sessionId = stream.slice('session:'.length);
  return {
    type: 'op',
    op_id: uuidv7(),
    stream,
    kind: 'marker.add',
    at: 1_793_800_000_000,
    clock_uncertain: false,
    data: {
      marker_id: uuidv7(),
      session_id: sessionId,
      kind: 'frage',
      t_ms: 1200,
      page_id: null,
      position: null,
      note: null,
      source: 'mac',
    },
    ...overrides,
  };
}
