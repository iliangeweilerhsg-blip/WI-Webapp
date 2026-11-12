// Tunnel-Eingang des Core (UX-12, PR 2; Plan E2, E3, E8, §5.1, Review-Befunde S5, S6): Eine Anfrage am Tunnel-Eingang
// (Unix-Socket) gilt **nie** als lokal. Alle Tests sprechen mit einem echten Unix-Socket, nicht mit `inject`.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { sql } from 'drizzle-orm';
import type { RouteOptions } from 'fastify';
import { pino } from 'pino';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ApiErrorSchema,
  DeviceListSchema,
  PairingCodeSchema,
  PairResponseSchema,
  type PairResponse,
} from '@sg/shared';
import { connectionLimits } from '../../src/app.ts';
import { loggerOptions } from '../../src/logger.ts';
import { publishEvent } from '../../src/sync/events.ts';
import {
  generateTunnelKey,
  tunnelPsk,
  tunnelServiceName,
  TunnelKeyStore,
} from '../../src/services/tunnel.ts';
import { startTestApp, TEST_PORT, testConfig, type TestApp } from './helpers.ts';
import { sleep, TestClient, waitFor } from './sync-helpers.ts';

const API = '/api/v1';
const MAC_IP = '192.168.1.5';
/** Host, den das iPad am Tunnel sendet: der Weiterleiter auf Loopback (IP-Literal, §5.1) */
const FORWARDER_HOST = '127.0.0.1:51234';

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  json: () => unknown;
}

/** Anfrage über den Unix-Socket des Tunnel-Eingangs */
function viaTunnel(
  socketPath: string,
  options: { method?: string; path: string; headers?: Record<string, string>; token?: string; body?: string },
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath,
        method: options.method ?? 'GET',
        path: options.path,
        agent: false,
        headers: {
          host: FORWARDER_HOST,
          ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
          ...(options.body !== undefined
            ? {
                'content-type': 'application/json',
                'content-length': String(Buffer.byteLength(options.body)),
              }
            : {}),
          ...options.headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body,
            json: () => JSON.parse(body) as unknown,
          });
        });
      },
    );
    req.on('error', reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

const errorCode = (reply: Reply): string => ApiErrorSchema.parse(reply.json()).error.code;

let ipCounter = 0;
const freshIp = () => `192.168.20.${++ipCounter}`;

/** Kopplung wie das iPad: Fenster lokal öffnen, dann `pair/confirm` aus dem IP-Netz */
async function pair(
  t: TestApp,
): Promise<{ response: PairResponse; deviceId: string; token: string; key: string }> {
  const opened = await t.request({ method: 'POST', url: `${API}/devices/pairings` });
  expect(opened.statusCode).toBe(201);
  const code = PairingCodeSchema.parse(opened.json());
  const res = await t.app.inject({
    method: 'POST',
    url: `${API}/devices/pair/confirm`,
    remoteAddress: freshIp(),
    headers: { host: `${MAC_IP}:${TEST_PORT}` },
    payload: {
      pairing_id: code.pairing_id,
      code: code.code,
      device_name: 'iPad von Ilian',
      kind: 'ipad',
      public_nonce: randomBytes(18).toString('base64url'),
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  const response = PairResponseSchema.parse(res.json());
  return {
    response,
    deviceId: response.device.id,
    token: response.device_token,
    key: response.tunnel_key ?? '',
  };
}

async function startTunnelApp(
  overrides: Parameters<typeof startTestApp>[0] = {},
  extra: Parameters<typeof startTestApp>[1] = {},
): Promise<TestApp & { sock: string; keys: TunnelKeyStore }> {
  const t = await startTestApp(overrides, extra);
  await t.app.tunnel.start();
  return { ...t, sock: t.app.tunnel.socketPath, keys: t.app.tunnel.keys as TunnelKeyStore };
}

const mode = (path: string) => lstatSync(path).mode & 0o777;

/** Alle Routen der App samt `sgAccess` (aus dem `onRoute`-Hook, nicht von Hand gepflegt) */
const routes: RouteOptions[] = [];
const methodsOf = (route: RouteOptions): string[] =>
  (Array.isArray(route.method) ? route.method : [route.method]).filter(
    (m) => m !== 'HEAD' && m !== 'OPTIONS',
  );
const concretePath = (url: string): string =>
  url
    .replace(/:index\b/g, '1')
    .replace(/:[A-Za-z_]+/g, '019a4e14-0000-7000-8000-0000000000ee')
    .replace(/\*/g, 'x');

describe('Tunnel-Eingang: Socket und Start', () => {
  let t: Awaited<ReturnType<typeof startTunnelApp>>;
  beforeAll(async () => {
    t = await startTunnelApp();
  });
  afterAll(async () => {
    await t.close();
  });

  it('der Socket liegt in run/ (Datei 0600, Ordner 0700) und lauscht', () => {
    expect(t.app.tunnel.listening).toBe(true);
    expect(t.sock).toBe(join(t.config.dataDir, 'run', 'tunnel.sock'));
    expect(lstatSync(t.sock).isSocket()).toBe(true);
    expect(mode(t.sock)).toBe(0o600);
    expect(mode(join(t.config.dataDir, 'run'))).toBe(0o700);
  });

  it('der Tunnel-Server ist ein Unix-Socket, nie ein TCP-Port', () => {
    const address = t.app.tunnel.httpServer?.address();
    expect(typeof address).toBe('string');
    expect(address).toBe(t.sock);
  });

  it('erneutes start() ändert nichts', async () => {
    const server = t.app.tunnel.httpServer;
    await t.app.tunnel.start();
    expect(t.app.tunnel.httpServer).toBe(server);
  });

  it('GET /health über den Tunnel (Token Pflicht) liefert den Core', async () => {
    const { token } = await pair(t);
    const res = await viaTunnel(t.sock, { path: `${API}/health`, token });
    expect(res.status).toBe(200);
  });
});

describe('Tunnel-Eingang: Datei- und Startfälle', () => {
  const apps: TestApp[] = [];
  afterEach(async () => {
    for (const t of apps.splice(0)) await t.close();
  });
  async function app(
    overrides: Parameters<typeof startTestApp>[0] = {},
    prepare?: (dataDir: string) => void,
  ): Promise<TestApp> {
    const dataDir = mkdtempSync(join(tmpdir(), 'sg-tun-'));
    prepare?.(dataDir);
    const t = await startTestApp({ dataDir, ...overrides });
    apps.push(t);
    return t;
  }

  it('eine alte Socket-Datei (hier: reguläre Datei) wird ersetzt, run/ mit 0755 wird 0700', async () => {
    const t = await app({}, (dir) => {
      mkdirSync(join(dir, 'run'), { mode: 0o755 });
      writeFileSync(join(dir, 'run', 'tunnel.sock'), 'alt');
    });
    await t.app.tunnel.start();
    expect(lstatSync(t.app.tunnel.socketPath).isSocket()).toBe(true);
    expect(mode(t.app.tunnel.socketPath)).toBe(0o600);
    expect(mode(join(t.config.dataDir, 'run'))).toBe(0o700);
  });

  it('ein Symlink an der Stelle des Sockets wird ersetzt, sein Ziel bleibt unberührt', async () => {
    let victim = '';
    const t = await app({}, (dir) => {
      victim = join(dir, 'opfer.txt');
      writeFileSync(victim, 'OPFER');
      mkdirSync(join(dir, 'run'), { mode: 0o700 });
      symlinkSync(victim, join(dir, 'run', 'tunnel.sock'));
    });
    await t.app.tunnel.start();
    expect(readFileSync(victim, 'utf8')).toBe('OPFER');
    expect(lstatSync(t.app.tunnel.socketPath).isSocket()).toBe(true);
  });

  it('run/ als Symlink: der Tunnel-Eingang startet nicht', async () => {
    const t = await app({}, (dir) => {
      mkdirSync(join(dir, 'woanders'));
      symlinkSync(join(dir, 'woanders'), join(dir, 'run'));
    });
    await expect(t.app.tunnel.start()).rejects.toThrow(/kein echter Ordner/);
    expect(t.app.tunnel.listening).toBe(false);
  });

  it('ein zu langer Socket-Pfad: der Tunnel-Eingang startet nicht, mit klarer Meldung', async () => {
    const t = await app({ dataDir: join(tmpdir(), `sg-${'x'.repeat(110)}`) });
    await expect(t.app.tunnel.start()).rejects.toThrow(/zu lang/);
  });

  it('beim Beenden verschwindet die Socket-Datei', async () => {
    const t = await app();
    await t.app.tunnel.start();
    const sock = t.app.tunnel.socketPath;
    expect(lstatSync(sock).isSocket()).toBe(true);
    await t.app.close();
    expect(lstatSync(sock, { throwIfNoEntry: false })).toBeUndefined();
    // `close()` des Helfers ruft app.close() ein zweites Mal auf: das ist erlaubt
  });

  it('SG_TUNNEL=0: kein Socket, keine Schlüsseldatei (vorhandene werden beim Start gelöscht)', async () => {
    const t = await app({ tunnel: false }, (dir) => {
      mkdirSync(join(dir, 'secrets'), { mode: 0o700 });
      writeFileSync(join(dir, 'secrets', 'tunnel-keys.json'), '{"v":1,"devices":[]}', { mode: 0o600 });
      mkdirSync(join(dir, 'run'), { mode: 0o700 });
      writeFileSync(join(dir, 'run', 'tunnel.sock'), 'alt');
    });
    expect(t.app.tunnel.keys).toBeNull();
    await t.app.tunnel.start();
    expect(t.app.tunnel.listening).toBe(false);
    expect(
      lstatSync(join(t.config.dataDir, 'secrets', 'tunnel-keys.json'), { throwIfNoEntry: false }),
    ).toBeUndefined();
    expect(
      lstatSync(join(t.config.dataDir, 'run', 'tunnel.sock'), { throwIfNoEntry: false }),
    ).toBeUndefined();
    // Eine Kopplung gibt dann keinen Schlüssel aus und schreibt keine Datei
    const paired = await pair(t);
    expect(paired.response.tunnel_key).toBeUndefined();
    expect(
      lstatSync(join(t.config.dataDir, 'secrets', 'tunnel-keys.json'), { throwIfNoEntry: false }),
    ).toBeUndefined();
  });
});

describe('Tunnel-Eingang: Wächter und Routentabelle', () => {
  let t: Awaited<ReturnType<typeof startTunnelApp>>;
  let token: string;
  beforeAll(async () => {
    routes.length = 0;
    t = await startTunnelApp({}, { onRoute: (route) => routes.push(route) });
    token = (await pair(t)).token;
  });
  afterAll(async () => {
    await t.close();
  });

  it('ohne Token → 401 device_token_required, ungültiges Token → 401 device_token_invalid, gültiges → 200', async () => {
    const none = await viaTunnel(t.sock, { path: `${API}/health` });
    expect(none.status).toBe(401);
    expect(errorCode(none)).toBe('device_token_required');
    const bad = await viaTunnel(t.sock, { path: `${API}/health`, token: 'abc' });
    expect(bad.status).toBe(401);
    expect(errorCode(bad)).toBe('device_token_invalid');
    const unknown = await viaTunnel(t.sock, {
      path: `${API}/health`,
      token: randomBytes(32).toString('base64url'),
    });
    expect(unknown.status).toBe(401);
    expect(errorCode(unknown)).toBe('device_token_invalid');
    const good = await viaTunnel(t.sock, { path: `${API}/health`, token });
    expect(good.status).toBe(200);
  });

  it('GET /system/storage über den Tunnel: nur mit Token, nie als lokal, ohne Pfade (UX-11)', async () => {
    const storage = routes.find((r) => r.url === `${API}/system/storage`);
    expect(storage?.config?.sgAccess).toBeUndefined();
    const none = await viaTunnel(t.sock, { path: `${API}/system/storage` });
    expect(none.status).toBe(401);
    expect(errorCode(none)).toBe('device_token_required');
    const good = await viaTunnel(t.sock, { path: `${API}/system/storage`, token });
    expect(good.status).toBe(200);
    expect(good.body).not.toContain(t.config.dataDir);
  });

  it('abgelehnte Tunnel-Anfragen bekommen Connection: close', async () => {
    const none = await viaTunnel(t.sock, { path: `${API}/health` });
    expect(none.headers.connection).toBe('close');
  });

  it('die Routentabelle ist vollständig erfasst (kein leerer Test)', () => {
    const table = routes.flatMap((r) => methodsOf(r).map((m) => `${m} ${r.url}`));
    expect(table.length).toBeGreaterThan(80);
    for (const known of [
      `POST ${API}/backup`,
      `POST ${API}/restore-test`,
      `POST ${API}/devices/pairings`,
      `DELETE ${API}/devices/pairings`,
      `GET ${API}/devices/pairings/requests`,
      `DELETE ${API}/devices/pairings/requests/:request_id`,
      `POST ${API}/devices/pair/start`,
      `POST ${API}/devices/pair/confirm`,
      `GET ${API}/health`,
      `GET ${API}/system/storage`,
    ]) {
      expect(table, known).toContain(known);
    }
    expect(routes.filter((r) => r.config?.sgAccess === 'local').length).toBeGreaterThanOrEqual(6);
    expect(routes.filter((r) => r.config?.sgAccess === 'pairing')).toHaveLength(2);
  });

  it('JEDE Route der Tabelle ohne Token: 401 device_token_required (pair/* gesperrt: 403 local_only)', async () => {
    const failures: string[] = [];
    for (const route of routes) {
      for (const method of methodsOf(route)) {
        const res = await viaTunnel(t.sock, { method, path: concretePath(route.url) });
        const pairing = route.config?.sgAccess === 'pairing';
        const expected = pairing ? [403, 'local_only'] : [401, 'device_token_required'];
        const code = res.headers['content-type']?.includes('json') ? errorCode(res) : '';
        if (res.status !== expected[0] || code !== expected[1])
          failures.push(`${method} ${route.url}: ${res.status} ${code}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('JEDE als lokal markierte Route mit gültigem Token: 403 local_only', async () => {
    const local = routes.filter((r) => r.config?.sgAccess === 'local');
    const failures: string[] = [];
    for (const route of local) {
      for (const method of methodsOf(route)) {
        const res = await viaTunnel(t.sock, { method, path: concretePath(route.url), token });
        if (res.status !== 403 || errorCode(res) !== 'local_only')
          failures.push(`${method} ${route.url}: ${res.status}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('JEDE Kopplungsroute (pair/start, pair/confirm) mit und ohne Token: 403 local_only', async () => {
    for (const route of routes.filter((r) => r.config?.sgAccess === 'pairing')) {
      for (const withToken of [false, true]) {
        const res = await viaTunnel(t.sock, {
          method: 'POST',
          path: route.url,
          ...(withToken ? { token } : {}),
          body: '{}',
        });
        expect(res.status, `${route.url} withToken=${withToken}`).toBe(403);
        expect(errorCode(res)).toBe('local_only');
      }
    }
  });

  it('pair/confirm mit dem richtigen Code über den Tunnel koppelt nichts und schließt das Fenster nicht', async () => {
    const opened = PairingCodeSchema.parse(
      (await t.request({ method: 'POST', url: `${API}/devices/pairings` })).json(),
    );
    const before = DeviceListSchema.parse((await t.request({ url: `${API}/devices` })).json()).items.length;
    const res = await viaTunnel(t.sock, {
      method: 'POST',
      path: `${API}/devices/pair/confirm`,
      body: JSON.stringify({
        pairing_id: opened.pairing_id,
        code: opened.code,
        device_name: 'Fremdes Gerät',
        kind: 'ipad',
        public_nonce: randomBytes(18).toString('base64url'),
      }),
    });
    expect(res.status).toBe(403);
    expect(errorCode(res)).toBe('local_only');
    const after = DeviceListSchema.parse((await t.request({ url: `${API}/devices` })).json()).items.length;
    expect(after).toBe(before);
    // Das Fenster ist weiter offen: der Code wurde nicht verbraucht
    const state = await t.request({ url: `${API}/devices/pairings/requests` });
    expect(state.headers['sg-pairing-state']).toBe('open');
  });

  it('B17: PATCH /settings mit backup_target über den Tunnel (gültiges Token) → 403 local_only', async () => {
    const res = await viaTunnel(t.sock, {
      method: 'PATCH',
      path: `${API}/settings`,
      token,
      body: JSON.stringify({ data: { backup_target: tmpdir() } }),
    });
    expect(res.status).toBe(403);
    expect(errorCode(res)).toBe('local_only');
  });

  it('B17: POST /calendar/reassign über den Tunnel (gültiges Token) → 403, lokal dagegen 200', async () => {
    const res = await viaTunnel(t.sock, { method: 'POST', path: `${API}/calendar/reassign`, token });
    expect(res.status).toBe(403);
    expect(errorCode(res)).toBe('local_only');
    const local = await t.request({ method: 'POST', url: `${API}/calendar/reassign` });
    expect(local.statusCode).toBe(200);
  });

  it('Host: localhost:<Core-Port> und X-Forwarded-Host/-Proto ändern nichts: 421 bzw. Token Pflicht', async () => {
    const localhost = await viaTunnel(t.sock, {
      path: `${API}/health`,
      headers: { host: `localhost:${TEST_PORT}` },
    });
    expect(localhost.status).toBe(421);
    expect(errorCode(localhost)).toBe('host_not_allowed');
    // Auch mit gültigem Token: „localhost“ ist aus dem Netz (und damit vom Tunnel) nie ein erlaubter Host
    const withToken = await viaTunnel(t.sock, {
      path: `${API}/health`,
      token,
      headers: { host: `localhost:${TEST_PORT}` },
    });
    expect(withToken.status).toBe(421);
    const loopbackIp = await viaTunnel(t.sock, {
      path: `${API}/health`,
      headers: {
        host: `127.0.0.1:${TEST_PORT}`,
        'x-forwarded-host': `localhost:${TEST_PORT}`,
        'x-forwarded-proto': 'http',
      },
    });
    expect(loopbackIp.status).toBe(401);
    expect(errorCode(loopbackIp)).toBe('device_token_required');
  });

  it('X-Forwarded-For: 127.0.0.1 (und ::1, Forwarded) macht eine Tunnel-Anfrage nicht lokal', async () => {
    const variants: Record<string, string>[] = [
      { 'x-forwarded-for': '127.0.0.1' },
      { 'x-forwarded-for': '::1' },
      { 'x-forwarded-for': '127.0.0.1, 10.0.0.1', forwarded: 'for=127.0.0.1' },
      { 'x-real-ip': '127.0.0.1' },
    ];
    for (const headers of variants) {
      const noToken = await viaTunnel(t.sock, { path: `${API}/health`, headers });
      expect(noToken.status, JSON.stringify(headers)).toBe(401);
      const localRoute = await viaTunnel(t.sock, { method: 'POST', path: `${API}/backup`, token, headers });
      expect(localRoute.status, JSON.stringify(headers)).toBe(403);
      expect(errorCode(localRoute)).toBe('local_only');
    }
  });

  it('frameworkErrors: eine kaputte URL am Tunnel-Eingang wird als Netz behandelt (401/421 statt 400)', async () => {
    const none = await viaTunnel(t.sock, { path: '/%E0%A4%A' });
    expect(none.status).toBe(401);
    expect(errorCode(none)).toBe('device_token_required');
    expect(none.headers.connection).toBe('close');
    const wrongHost = await viaTunnel(t.sock, {
      path: '/%E0%A4%A',
      headers: { host: `localhost:${TEST_PORT}` },
    });
    expect(wrongHost.status).toBe(421);
    // Mit gültigem Token besteht die Anfrage den Wächter und scheitert erst als fehlerhafte Anfrage
    const withToken = await viaTunnel(t.sock, { path: '/%E0%A4%A', token });
    expect(withToken.status).toBe(400);
    expect(errorCode(withToken)).toBe('bad_request');
  });

  it('Keep-Alive-Folgeanfragen auf demselben Socket bleiben Netz (Markierung hängt am Socket)', async () => {
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    const call = (path: string, method = 'GET', auth?: string) =>
      new Promise<number>((resolve, reject) => {
        const req = http.request(
          {
            socketPath: t.sock,
            path,
            method,
            agent,
            headers: { host: FORWARDER_HOST, ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
          },
          (res) => {
            res.resume();
            res.on('end', () => resolve(res.statusCode ?? 0));
          },
        );
        req.on('error', reject);
        req.end();
      });
    try {
      expect(await call(`${API}/health`, 'GET', token)).toBe(200);
      expect(await call(`${API}/backup`, 'POST', token)).toBe(403);
      expect(await call(`${API}/health`, 'GET', token)).toBe(200);
      expect(await call(`${API}/health`)).toBe(401);
    } finally {
      agent.destroy();
    }
  });
});

describe('Tunnel-Eingang: gefälschtes remoteAddress', () => {
  it('ein Tunnel-Socket mit remoteAddress 127.0.0.1 gilt trotzdem als Netz: die Markierung schlägt die Adresse', async () => {
    const t = await startTunnelApp();
    try {
      const { token } = await pair(t);
      const server = t.app.tunnel.httpServer;
      expect(server).not.toBeNull();
      // Nach dem Listener, der den Socket markiert: die Adresse fälschen (Attrappe)
      server?.on('connection', (socket: net.Socket) => {
        Object.defineProperty(socket, 'remoteAddress', { value: '127.0.0.1' });
        Object.defineProperty(socket, 'remoteFamily', { value: 'IPv4' });
      });
      const noToken = await viaTunnel(t.sock, { path: `${API}/health` });
      expect(noToken.status).toBe(401);
      const onlyLoopbackHost = await viaTunnel(t.sock, {
        path: `${API}/health`,
        headers: { host: `localhost:${TEST_PORT}` },
      });
      // Als lokal gälte „localhost:<Port>“ und das Token wäre nicht nötig (200)
      expect(onlyLoopbackHost.status).toBe(421);
      const localRoute = await viaTunnel(t.sock, { method: 'POST', path: `${API}/backup`, token });
      expect(localRoute.status).toBe(403);
      expect(errorCode(localRoute)).toBe('local_only');
      const patch = await viaTunnel(t.sock, {
        method: 'PATCH',
        path: `${API}/settings`,
        token,
        body: JSON.stringify({ data: { backup_target: tmpdir() } }),
      });
      expect(patch.status).toBe(403);
      const reassign = await viaTunnel(t.sock, { method: 'POST', path: `${API}/calendar/reassign`, token });
      expect(reassign.status).toBe(403);
    } finally {
      await t.close();
    }
  });
});

describe('Tunnel-Eingang: WebSocket /sync', () => {
  let t: Awaited<ReturnType<typeof startTunnelApp>>;
  let localPort: number;
  let token: string;
  let deviceId: string;
  beforeAll(async () => {
    t = await startTunnelApp();
    await t.app.listen({ port: 0, host: '127.0.0.1' });
    localPort = (t.app.server.address() as AddressInfo).port;
    ({ token, deviceId } = await pair(t));
  });
  afterAll(async () => {
    await t.close();
  });

  const wsUrl = () => `ws+unix://${t.sock}:/sync`;

  it('Upgrade ohne Token wird abgelehnt (401), mit unbekanntem ebenso', async () => {
    const none = new TestClient(wsUrl(), { host: FORWARDER_HOST });
    await none.closed();
    expect(none.httpStatus).toBe(401);
    const bad = new TestClient(wsUrl(), { host: FORWARDER_HOST, authorization: 'Bearer abc' });
    await bad.closed();
    expect(bad.httpStatus).toBe(401);
  });

  it('Upgrade mit Host localhost wird abgelehnt (421), auch mit gültigem Token', async () => {
    const client = new TestClient(wsUrl(), {
      host: `localhost:${TEST_PORT}`,
      authorization: `Bearer ${token}`,
    });
    await client.closed();
    expect(client.httpStatus).toBe(421);
  });

  it('mit gültigem Token: welcome.device_id gesetzt (nie als lokaler Client)', async () => {
    const client = await TestClient.open(wsUrl(), { host: FORWARDER_HOST, authorization: `Bearer ${token}` });
    try {
      const welcome = await client.hello();
      expect(welcome.type).toBe('welcome');
      expect(welcome.device_id).toBe(deviceId);
    } finally {
      client.close();
    }
  });

  it('localOnly-Ereignisse (pairing.requested) kommen am Tunnel nie an, am lokalen Client schon', async () => {
    const tunnelClient = await TestClient.open(wsUrl(), {
      host: FORWARDER_HOST,
      authorization: `Bearer ${token}`,
    });
    const localClient = await TestClient.open(`ws://127.0.0.1:${localPort}/sync`, {
      host: `127.0.0.1:${TEST_PORT}`,
    });
    try {
      expect((await tunnelClient.hello()).device_id).toBe(deviceId);
      expect((await localClient.hello()).device_id).toBeNull();
      const request = {
        request_id: '019a4e14-0000-7000-8000-000000000082',
        pairing_id: '019a4e14-0000-7000-8000-000000000081',
        device_name: 'iPad von Ilian',
        kind: 'ipad' as const,
        requested_at: '2026-11-04T07:16:00Z',
      };
      publishEvent({ type: 'event', name: 'pairing.requested', data: request }, { localOnly: true });
      // Zur Kontrolle ein Ereignis ohne localOnly: Es erreicht beide
      publishEvent({
        type: 'event',
        name: 'connection',
        data: { client: 'web', device_id: null, connected: true },
      } as never);
      await localClient.next((m) => m.type === 'event' && m.name === 'pairing.requested');
      await tunnelClient.next((m) => m.type === 'event' && m.name === 'connection');
      await sleep(200);
      expect(tunnelClient.messages.filter((m) => m.name === 'pairing.requested')).toEqual([]);
    } finally {
      tunnelClient.close();
      localClient.close();
    }
  });

  it('das Entfernen des Geräts schließt seine Tunnel-Verbindung mit 4401', async () => {
    const other = await pair(t);
    const client = await TestClient.open(wsUrl(), {
      host: FORWARDER_HOST,
      authorization: `Bearer ${other.token}`,
    });
    await client.hello();
    const res = await t.request({ method: 'DELETE', url: `${API}/devices/${other.deviceId}` });
    expect(res.statusCode).toBe(204);
    expect(await client.closed()).toBe(4401);
  });

  it('der Widerruf schließt den WebSocket sofort, auch wenn die Schlüsseldatei noch nicht geschrieben ist', async () => {
    const other = await pair(t);
    const client = await TestClient.open(wsUrl(), {
      host: FORWARDER_HOST,
      authorization: `Bearer ${other.token}`,
    });
    await client.hello();
    // Hängende Platte: Das Entfernen aus der Schlüsseldatei wartet, bis der Test es freigibt
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const remove = t.keys.remove.bind(t.keys);
    const spy = vi.spyOn(t.keys, 'remove').mockImplementationOnce(async (id: string) => {
      await held;
      return remove(id);
    });
    const pending = t.request({ method: 'DELETE', url: `${API}/devices/${other.deviceId}` });
    try {
      expect(await client.closed()).toBe(4401);
      expect(spy).toHaveBeenCalledWith(other.deviceId);
    } finally {
      release();
    }
    expect((await pending).statusCode).toBe(204);
    expect(t.keys.deviceIds()).not.toContain(other.deviceId);
    spy.mockRestore();
  });
});

describe('Kopplung und Schlüsseldatei', () => {
  let t: Awaited<ReturnType<typeof startTunnelApp>>;
  const logLines: string[] = [];
  beforeAll(async () => {
    const logStream = new Writable({
      write(chunk: Buffer, _enc, done) {
        logLines.push(chunk.toString('utf8'));
        done();
      },
    });
    // Dieselben Logger-Optionen wie im Betrieb, Stufe trace: so zeigt der Test, was wirklich im Log landen könnte
    t = await startTunnelApp({}, { logger: pino(loggerOptions({ logLevel: 'trace' }), logStream) });
  });
  afterAll(async () => {
    await t.close();
  });
  afterEach(() => vi.restoreAllMocks());

  const fileEntries = (): { device_id: string; tunnel_key: string }[] =>
    (
      JSON.parse(readFileSync(t.keys.file, 'utf8')) as {
        devices: { device_id: string; tunnel_key: string }[];
      }
    ).devices;

  it('pair/confirm liefert tunnel_key (43 Zeichen) neben device_token, mit Cache-Control: no-store', async () => {
    const opened = PairingCodeSchema.parse(
      (await t.request({ method: 'POST', url: `${API}/devices/pairings` })).json(),
    );
    const res = await t.app.inject({
      method: 'POST',
      url: `${API}/devices/pair/confirm`,
      remoteAddress: freshIp(),
      headers: { host: `${MAC_IP}:${TEST_PORT}` },
      payload: {
        pairing_id: opened.pairing_id,
        code: opened.code,
        device_name: 'iPad',
        kind: 'ipad',
        public_nonce: randomBytes(18).toString('base64url'),
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = PairResponseSchema.parse(res.json());
    expect(body.tunnel_key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.tunnel_key).not.toBe(body.device_token);
    expect(Buffer.from(body.tunnel_key ?? '', 'base64url')).toHaveLength(32);
  });

  it('der Schlüssel steht in der Schlüsseldatei (0600, Ordner 0700) und ist daraus ableitbar', async () => {
    const { deviceId, key } = await pair(t);
    expect(mode(t.keys.file)).toBe(0o600);
    expect(mode(t.keys.dir)).toBe(0o700);
    expect(fileEntries()).toContainEqual({ device_id: deviceId, tunnel_key: key });
    expect(tunnelServiceName(key)).toMatch(/^sg-[0-9a-f]{16}$/);
    expect(tunnelPsk(key)).toHaveLength(32);
  });

  it('der Eintrag in der Schlüsseldatei entsteht VOR dem Gerät in Postgres', async () => {
    let deviceExistedWhenKeyWritten: boolean | null = null;
    const original = t.keys.add.bind(t.keys);
    vi.spyOn(t.keys, 'add').mockImplementation(async (deviceId, key) => {
      await original(deviceId, key);
      const rows = await t.handle.db.execute(sql`SELECT 1 FROM device WHERE id = ${deviceId}`);
      deviceExistedWhenKeyWritten = rows.length > 0;
    });
    const { deviceId } = await pair(t);
    expect(deviceExistedWhenKeyWritten).toBe(false);
    const rows = await t.handle.db.execute(sql`SELECT 1 FROM device WHERE id = ${deviceId}`);
    expect(rows.length).toBe(1);
  });

  it('Schreibfehler → die Kopplung scheitert (500), es entsteht kein Gerät, das Fenster ist wieder offen', async () => {
    const before = DeviceListSchema.parse((await t.request({ url: `${API}/devices` })).json()).items.length;
    const opened = PairingCodeSchema.parse(
      (await t.request({ method: 'POST', url: `${API}/devices/pairings` })).json(),
    );
    const body = {
      pairing_id: opened.pairing_id,
      code: opened.code,
      device_name: 'iPad',
      kind: 'ipad',
      public_nonce: randomBytes(18).toString('base64url'),
    };
    vi.spyOn(t.keys, 'add').mockRejectedValueOnce(new Error('Platte voll'));
    const failed = await t.app.inject({
      method: 'POST',
      url: `${API}/devices/pair/confirm`,
      remoteAddress: freshIp(),
      headers: { host: `${MAC_IP}:${TEST_PORT}` },
      payload: body,
    });
    expect(failed.statusCode).toBe(500);
    expect(failed.body).not.toMatch(/tunnel_key|device_token/);
    expect(DeviceListSchema.parse((await t.request({ url: `${API}/devices` })).json()).items.length).toBe(
      before,
    );
    expect((await t.request({ url: `${API}/devices/pairings/requests` })).headers['sg-pairing-state']).toBe(
      'open',
    );
    // Gleiches Fenster, gleicher Code: jetzt gelingt es
    const again = await t.app.inject({
      method: 'POST',
      url: `${API}/devices/pair/confirm`,
      remoteAddress: freshIp(),
      headers: { host: `${MAC_IP}:${TEST_PORT}` },
      payload: body,
    });
    expect(again.statusCode, again.body).toBe(201);
  });

  it('secrets/ als Symlink: die Kopplung scheitert, nichts wird ins Ziel geschrieben', async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'sg-sym-'));
    const aside = `${t.keys.dir}.beiseite`;
    renameSync(t.keys.dir, aside);
    symlinkSync(elsewhere, t.keys.dir);
    try {
      const opened = PairingCodeSchema.parse(
        (await t.request({ method: 'POST', url: `${API}/devices/pairings` })).json(),
      );
      const res = await t.app.inject({
        method: 'POST',
        url: `${API}/devices/pair/confirm`,
        remoteAddress: freshIp(),
        headers: { host: `${MAC_IP}:${TEST_PORT}` },
        payload: {
          pairing_id: opened.pairing_id,
          code: opened.code,
          device_name: 'iPad',
          kind: 'ipad',
          public_nonce: randomBytes(18).toString('base64url'),
        },
      });
      expect(res.statusCode).toBe(500);
      expect(lstatSync(elsewhere).isDirectory()).toBe(true);
      expect(readdirSync(elsewhere)).toEqual([]);
    } finally {
      rmSync(t.keys.dir, { force: true });
      renameSync(aside, t.keys.dir);
    }
  });

  it('DELETE /devices/{id} (lokal) entfernt den Schlüssel nach dem Commit; das Token ist sofort ungültig', async () => {
    const { deviceId, token } = await pair(t);
    expect(fileEntries().map((e) => e.device_id)).toContain(deviceId);
    const res = await t.request({ method: 'DELETE', url: `${API}/devices/${deviceId}` });
    expect(res.statusCode).toBe(204);
    expect(fileEntries().map((e) => e.device_id)).not.toContain(deviceId);
    const after = await viaTunnel(t.sock, { path: `${API}/health`, token });
    expect(after.status).toBe(401);
    expect(errorCode(after)).toBe('device_token_invalid');
  });

  it('ein Gerät darf sich über den Tunnel selbst entfernen; fremde Geräte nicht (403)', async () => {
    const mine = await pair(t);
    const other = await pair(t);
    const foreign = await viaTunnel(t.sock, {
      method: 'DELETE',
      path: `${API}/devices/${other.deviceId}`,
      token: mine.token,
    });
    expect(foreign.status).toBe(403);
    expect(fileEntries().map((e) => e.device_id)).toContain(other.deviceId);
    const self = await viaTunnel(t.sock, {
      method: 'DELETE',
      path: `${API}/devices/${mine.deviceId}`,
      token: mine.token,
    });
    expect(self.status).toBe(204);
    expect(fileEntries().map((e) => e.device_id)).not.toContain(mine.deviceId);
    expect(fileEntries().map((e) => e.device_id)).toContain(other.deviceId);
  });

  it('scheitert das Entfernen des Schlüssels, bleibt das Token trotzdem ungültig (204, Fehler im Log)', async () => {
    const { deviceId, token } = await pair(t);
    vi.spyOn(t.keys, 'remove').mockRejectedValueOnce(new Error('Platte kaputt'));
    const res = await t.request({ method: 'DELETE', url: `${API}/devices/${deviceId}` });
    expect(res.statusCode).toBe(204);
    const after = await viaTunnel(t.sock, { path: `${API}/health`, token });
    expect(after.status).toBe(401);
  });

  it('tunnel_key steht in keiner Logausgabe, keinem idempotency_key und nirgends in Postgres', async () => {
    const { key, token } = await pair(t);
    // Anfragen über den Tunnel und über den Haupteingang, damit das Log nicht leer ist
    await viaTunnel(t.sock, { path: `${API}/health`, token });
    await viaTunnel(t.sock, { path: `${API}/health` });
    await t.request({ url: `${API}/devices` });
    const all = logLines.join('\n');
    expect(logLines.length).toBeGreaterThan(5);
    expect(all).not.toContain(key);
    expect(all).not.toContain(token);
    // Postgres: keine Spalte „tunnel“, und der Schlüssel steht in keiner Zeile irgendeiner Tabelle
    const columns = await t.handle.db.execute(
      sql`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema() AND column_name ILIKE '%tunnel%'`,
    );
    expect(columns.length).toBe(0);
    const tables = (await t.handle.db.execute(
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'`,
    )) as unknown as { table_name: string }[];
    expect(tables.length).toBeGreaterThan(10);
    for (const { table_name: name } of tables) {
      const hits = await t.handle.db.execute(
        sql`SELECT count(*)::int AS n FROM ${sql.identifier(name)} AS r WHERE r::text LIKE ${`%${key}%`}`,
      );
      expect((hits[0] as { n: number }).n, name).toBe(0);
    }
    const idem = await t.handle.db.execute(sql`SELECT count(*)::int AS n FROM idempotency_key`);
    expect((idem[0] as { n: number }).n).toBeGreaterThanOrEqual(0);
  });

  it('GET /devices verrät keinen Schlüssel', async () => {
    const { key } = await pair(t);
    const list = await t.request({ url: `${API}/devices` });
    expect(list.body).not.toContain(key);
    expect(list.body).not.toMatch(/tunnel_key/);
  });

  it('das Token ist nicht aus dem Schlüssel ableitbar und umgekehrt (kein token_hash als Schlüsselmaterial)', async () => {
    const { key, token } = await pair(t);
    const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');
    expect(key).not.toBe(token);
    expect(Buffer.from(key, 'base64url').toString('hex')).not.toBe(tokenHash);
    expect(tunnelPsk(key).toString('hex')).not.toBe(tokenHash);
  });
});

describe('Abgleich beim Start', () => {
  it('verwaiste Einträge fliegen raus, aktive Geräte ohne Eintrag bekommen keinen neuen Schlüssel', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'sg-tun-'));
    const first = await startTunnelApp({ dataDir });
    const active = await pair(first);
    const removed = await pair(first);
    // Altgerät: vor UX-12 gekoppelt (kein Eintrag in der Schlüsseldatei)
    const legacyId = randomUUID();
    await first.handle.db.execute(sql`
      INSERT INTO device (id, user_id, name, kind, token_hash)
      SELECT ${legacyId}::uuid, user_id, 'Altgerät', 'ipad', ${'0'.repeat(64)} FROM device WHERE id = ${active.deviceId}::uuid`);
    await first.close();
    // Zwischen zwei Läufen verschwindet ein Gerät aus der Datenbank, sein Schlüssel bleibt in der Datei liegen
    const second = await startTestApp({ dataDir, databaseUrl: first.config.databaseUrl });
    try {
      await second.handle.db.execute(
        sql`UPDATE device SET deleted_at = now() WHERE id = ${removed.deviceId}::uuid`,
      );
      await second.app.tunnel.start();
      const ids = second.app.tunnel.keys?.deviceIds() ?? [];
      expect(ids).toContain(active.deviceId);
      expect(ids).not.toContain(removed.deviceId);
      expect(ids).not.toContain(legacyId);
      const onDisk = JSON.parse(readFileSync(second.app.tunnel.keys?.file ?? '', 'utf8')) as {
        devices: { device_id: string }[];
      };
      expect(onDisk.devices.map((d) => d.device_id)).toEqual([active.deviceId]);
    } finally {
      await second.close();
    }
  });
});

describe('Grenzen des Tunnel-Eingangs', () => {
  const saved = { ...connectionLimits };
  afterEach(() => Object.assign(connectionLimits, saved));

  const connect = (sock: string) =>
    new Promise<net.Socket>((resolve, reject) => {
      const s = net.connect(sock);
      s.once('connect', () => resolve(s));
      s.once('error', reject);
    });
  const serverConnections = (server: net.Server) =>
    new Promise<number>((resolve) => server.getConnections((_e, n) => resolve(n)));
  const waitForCount = async (server: net.Server, count: number): Promise<void> => {
    const start = Date.now();
    while ((await serverConnections(server)) !== count) {
      if (Date.now() - start > 5000) throw new Error(`Server zählt nicht ${count} Verbindungen`);
      await sleep(10);
    }
  };

  it('die 129. Verbindung am Tunnel-Eingang wird abgewiesen, der Haupteingang bleibt erreichbar', async () => {
    const t = await startTunnelApp();
    const sockets: net.Socket[] = [];
    try {
      // 4 Geräte mit Schlüssel → 4 × 32 = 128
      for (let i = 0; i < 4; i++) await t.keys.add(randomUUID(), generateTunnelKey());
      await t.app.listen({ port: 0, host: '127.0.0.1' });
      const port = (t.app.server.address() as AddressInfo).port;
      const server = t.app.tunnel.httpServer as net.Server;
      for (let i = 0; i < 128; i++) sockets.push(await connect(t.sock));
      await waitForCount(server, 128);
      expect(await serverConnections(server)).toBe(128);
      const extra = await connect(t.sock);
      sockets.push(extra);
      let closed = false;
      extra.once('close', () => (closed = true));
      await waitFor(() => closed, 3000, 'Schließen der 129. Verbindung');
      expect(await serverConnections(server)).toBe(128);
      // Haupteingang: lokal über Loopback weiter erreichbar
      const res = await new Promise<number>((resolve, reject) => {
        http
          .get(
            { host: '127.0.0.1', port, path: `${API}/health`, headers: { host: `localhost:${TEST_PORT}` } },
            (r) => {
              r.resume();
              resolve(r.statusCode ?? 0);
            },
          )
          .on('error', reject);
      });
      expect(res).toBe(200);
    } finally {
      for (const s of sockets) s.destroy();
      await t.close();
    }
  });

  it('die Grenze richtet sich nach den Geräten: ein Gerät → 32', async () => {
    const t = await startTunnelApp();
    const sockets: net.Socket[] = [];
    try {
      await pair(t);
      for (let i = 0; i < 32; i++) sockets.push(await connect(t.sock));
      const server = t.app.tunnel.httpServer as net.Server;
      await waitForCount(server, 32);
      const extra = await connect(t.sock);
      sockets.push(extra);
      let closed = false;
      extra.once('close', () => (closed = true));
      await waitFor(() => closed, 3000, 'Schließen der 33. Verbindung');
    } finally {
      for (const s of sockets) s.destroy();
      await t.close();
    }
  });

  it('der NetworkConnectionGate sieht keine Tunnel-Sockets: maxPerSource/maxNetwork greifen am Tunnel nicht', async () => {
    Object.assign(connectionLimits, { maxPerSource: 2, maxNetwork: 3 });
    const t = await startTunnelApp();
    const sockets: net.Socket[] = [];
    try {
      const { token } = await pair(t);
      for (let i = 0; i < 10; i++) sockets.push(await connect(t.sock));
      await sleep(100);
      expect(sockets.every((s) => !s.destroyed)).toBe(true);
      const res = await viaTunnel(t.sock, { path: `${API}/health`, token });
      expect(res.status).toBe(200);
    } finally {
      for (const s of sockets) s.destroy();
      await t.close();
    }
  });
});

describe('Haupteingang unverändert', () => {
  it('lokal ohne Token, aus dem Netz mit Token, wie bisher (testConfig mit Tunnel-Standard an)', async () => {
    const t = await startTestApp();
    try {
      expect(testConfig().tunnel).toBe(true);
      const local = await t.request({ url: `${API}/health` });
      expect(local.statusCode).toBe(200);
      const net1 = await t.app.inject({
        url: `${API}/health`,
        remoteAddress: MAC_IP,
        headers: { host: `${MAC_IP}:${TEST_PORT}` },
      });
      expect(net1.statusCode).toBe(401);
    } finally {
      await t.close();
    }
  });
});
