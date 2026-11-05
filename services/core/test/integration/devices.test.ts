// Geräte und Kopplung (VERTRAEGE §5, §7.5, §11.1, §12, T1-10): Routen, Wächter, Widerruf (REST und WS)
import { createHash, randomBytes } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { connect, type AddressInfo, type Socket } from 'node:net';
import { networkInterfaces } from 'node:os';
import { Writable } from 'node:stream';
import { eq, sql } from 'drizzle-orm';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { pino } from 'pino';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  ApiErrorSchema,
  DeviceListSchema,
  PairingCodeSchema,
  PairingRequestListSchema,
  PairResponseSchema,
  PairStartResponseSchema,
  type PairingCode,
} from '@sg/shared';
import { device, idempotencyKey } from '../../src/db/schema/index.ts';
import { LastSeenTracker, onDeviceRevoked, verifyDeviceToken } from '../../src/services/devices.ts';
import { PairingManager } from '../../src/services/pairing.ts';
import { buildApp } from '../../src/app.ts';
import { createDb } from '../../src/db/client.ts';
import { loggerOptions } from '../../src/logger.ts';
import { startTestApp, TEST_PORT, testConfig, type TestApp } from './helpers.ts';

const MAC_IP = '192.168.1.5';
const clock = { now: Date.now() };

/** Gesammelte Log-Zeilen aller Tests dieser Datei (Prüfung: Code, Token und geheime `pairing_id` tauchen nie auf) */
const logLines: string[] = [];
/** Geheime `pairing_id` aller in dieser Datei geöffneten Fenster (#100, H-1) */
const secretPairingIds = new Set<string>();
const logStream = new Writable({
  write(chunk: Buffer, _enc, done) {
    logLines.push(chunk.toString('utf8'));
    done();
  },
});

let t: TestApp;
let pairing: PairingManager;
beforeAll(async () => {
  pairing = new PairingManager({ now: () => clock.now });
  t = await startTestApp(
    {},
    // Dieselben Logger-Optionen wie im Betrieb (Serializer mit Schwärzung), sonst prüft der Log-Test nichts Echtes
    { pairing, pairingHost: () => MAC_IP, logger: pino(loggerOptions({ logLevel: 'trace' }), logStream) },
  );
});
afterAll(async () => {
  await t.close();
  // Über alle Tests dieser Datei: keine geheime pairing_id im Log (auch nicht aus DELETE ?pairing_id=)
  const all = logLines.join('\n');
  expect(secretPairingIds.size).toBeGreaterThan(0);
  for (const id of secretPairingIds) expect(all).not.toContain(id);
});
afterEach(() => {
  clock.now = Date.now();
});

let ipCounter = 0;
/** Jede Anfrage aus dem Netz von einer eigenen Adresse (das Rate-Limit testet ein eigener Fall) */
const freshIp = () => `192.168.${10 + Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

/** Anfrage aus dem WLAN (nicht Loopback), Host = IP des Macs */
function net(options: InjectOptions & { ip?: string; token?: string }): Promise<LightMyRequestResponse> {
  const { ip, token, ...rest } = options;
  return t.app.inject({
    ...rest,
    remoteAddress: ip ?? freshIp(),
    headers: {
      host: `${MAC_IP}:${TEST_PORT}`,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...rest.headers,
    },
  });
}

function errorCode(res: LightMyRequestResponse): string {
  return ApiErrorSchema.parse(res.json()).error.code;
}

const nonce = () => randomBytes(18).toString('base64url');

async function openWindow(): Promise<PairingCode> {
  const res = await t.request({ method: 'POST', url: '/api/v1/devices/pairings' });
  expect(res.statusCode).toBe(201);
  const code = PairingCodeSchema.parse(res.json());
  secretPairingIds.add(code.pairing_id);
  return code;
}

async function confirm(
  body: Record<string, unknown>,
  extra: { ip?: string; headers?: Record<string, string> } = {},
) {
  return net({
    method: 'POST',
    url: '/api/v1/devices/pair/confirm',
    payload: { device_name: 'iPad von Ilian', kind: 'ipad', public_nonce: nonce(), ...body },
    ...extra,
  });
}

async function start(body: Record<string, unknown> = {}, ip?: string, headers?: Record<string, string>) {
  return net({
    method: 'POST',
    url: '/api/v1/devices/pair/start',
    payload: { device_name: 'iPad', kind: 'ipad', public_nonce: nonce(), ...body },
    ...(ip ? { ip } : {}),
    ...(headers ? { headers } : {}),
  });
}

/** Koppelt ein Gerät über den QR-Weg und liefert Token und ID */
async function pairDevice(name = 'iPad von Ilian'): Promise<{ token: string; id: string }> {
  const w = await openWindow();
  const res = await confirm({ pairing_id: w.pairing_id, code: w.code, device_name: name });
  expect(res.statusCode).toBe(201);
  const body = PairResponseSchema.parse(res.json());
  return { token: body.device_token, id: body.device.id };
}

/** Freier TCP-Port für einen echten Server */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '0.0.0.0', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

const wrongCode = (code: string) => (code === '000000' ? '000001' : '000000');

describe('Kopplungsfenster öffnen (nur lokal)', () => {
  it('liefert PairingCode mit Host, Port und QR-Inhalt im festen Format', async () => {
    const w = await openWindow();
    expect(w.host).toBe(MAC_IP);
    expect(w.port).toBe(TEST_PORT);
    expect(w.qr_url).toBe(
      `sg://pair?v=1&host=${MAC_IP}&port=${TEST_PORT}&pairing_id=${w.pairing_id}&code=${w.code}`,
    );
    expect(Date.parse(w.expires_at) - Date.now()).toBeGreaterThan(4.9 * 60_000);
  });

  it('aus dem Netz ohne Token → 401, mit gültigem Token → 403 local_only', async () => {
    const { token } = await pairDevice();
    const noToken = await net({ method: 'POST', url: '/api/v1/devices/pairings' });
    expect(noToken.statusCode).toBe(401);
    expect(errorCode(noToken)).toBe('device_token_required');
    for (const [method, url] of [
      ['POST', '/api/v1/devices/pairings'],
      ['GET', '/api/v1/devices/pairings/requests'],
      ['DELETE', `/api/v1/devices/pairings/requests/${crypto.randomUUID()}`],
    ] as const) {
      const res = await net({ method, url, token });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
      expect(errorCode(res)).toBe('local_only');
    }
  });

  it('Host-Header-Spoofing: „Host: localhost“ von einer Netz-IP bleibt eine Netz-Anfrage', async () => {
    const { token } = await pairDevice();
    const spoofed = { host: `localhost:${TEST_PORT}`, 'x-forwarded-for': '127.0.0.1' };
    // Aus dem Netz ist „localhost“ als Host gar nicht erlaubt (421), lokal wird die Anfrage nie
    for (const extra of [{}, { token }]) {
      const res = await net({ method: 'POST', url: '/api/v1/devices/pairings', headers: spoofed, ...extra });
      expect(res.statusCode).toBe(421);
      expect(errorCode(res)).toBe('host_not_allowed');
    }
    const list = await net({ url: '/api/v1/devices/pairings/requests', headers: spoofed, token });
    expect(list.statusCode).toBe(421);
    // Mit erlaubtem Host und gültigem Token: lokale Route → 403 local_only
    const withToken = await net({ method: 'POST', url: '/api/v1/devices/pairings', token });
    expect(withToken.statusCode).toBe(403);
    expect(errorCode(withToken)).toBe('local_only');
  });
});

describe('QR-Weg', () => {
  it('koppelt ohne pair/start; das Token gilt danach aus dem Netz, last_seen_at ist gesetzt', async () => {
    const w = await openWindow();
    const res = await confirm({ pairing_id: w.pairing_id, code: w.code, app_version: '1.0 (3)' });
    expect(res.statusCode).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = PairResponseSchema.parse(res.json());
    expect(body.device).toMatchObject({
      name: 'iPad von Ilian',
      kind: 'ipad',
      app_version: '1.0 (3)',
      connected: false,
    });
    expect(body.device.last_seen_at).not.toBeNull();

    const health = await net({ url: '/api/v1/health', token: body.device_token });
    expect(health.statusCode).toBe(200);

    // Fenster ist danach zu
    const again = await confirm({ pairing_id: w.pairing_id, code: w.code });
    expect(again.statusCode).toBe(409);
    expect(errorCode(again)).toBe('pairing_window_closed');

    const list = DeviceListSchema.parse((await t.request({ url: '/api/v1/devices' })).json());
    expect(list.items.map((d) => d.id)).toContain(body.device.id);
  });

  it('gespeichert wird nur sha256(token); kein Idempotency-Eintrag mit Code oder Token', async () => {
    const w = await openWindow();
    const key = crypto.randomUUID();
    const res = await confirm(
      { pairing_id: w.pairing_id, code: w.code },
      { headers: { 'idempotency-key': key } },
    );
    expect(res.statusCode).toBe(201);
    const { device_token: token, device: d } = PairResponseSchema.parse(res.json());
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [row] = await t.handle.db.select().from(device).where(eq(device.id, d.id));
    expect(row?.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    const dump = JSON.stringify(row);
    expect(dump).not.toContain(token);

    // Weder die Bestätigung noch das Öffnen des Fensters landen in idempotency_key
    const openKey = crypto.randomUUID();
    const opened = await t.request({
      method: 'POST',
      url: '/api/v1/devices/pairings',
      headers: { 'idempotency-key': openKey },
    });
    expect(opened.statusCode).toBe(201);
    const stored = await t.handle.db
      .select()
      .from(idempotencyKey)
      .where(sql`${idempotencyKey.key} IN (${key}::uuid, ${openKey}::uuid)`);
    expect(stored).toHaveLength(0);
    // Ein Wiederholen mit demselben Schlüssel liefert kein gespeichertes Token
    const replay = await confirm(
      { pairing_id: w.pairing_id, code: w.code },
      { headers: { 'idempotency-key': key } },
    );
    expect(replay.statusCode).toBe(409);
  });

  it('gleichzeitige confirm-Aufrufe mit richtigem Code: genau einer gewinnt', async () => {
    const before = DeviceListSchema.parse((await t.request({ url: '/api/v1/devices?limit=200' })).json())
      .items.length;
    const w = await openWindow();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => confirm({ pairing_id: w.pairing_id, code: w.code })),
    );
    const statuses = results.map((r) => r.statusCode).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(7);
    const after = DeviceListSchema.parse((await t.request({ url: '/api/v1/devices?limit=200' })).json()).items
      .length;
    expect(after).toBe(before + 1);
  });

  it('abgelaufenes Fenster → 409 pairing_window_closed für start und confirm', async () => {
    const w = await openWindow();
    clock.now += 5 * 60_000;
    const c = await confirm({ pairing_id: w.pairing_id, code: w.code });
    expect(c.statusCode).toBe(409);
    expect(errorCode(c)).toBe('pairing_window_closed');
    const s = await start();
    expect(s.statusCode).toBe(409);
    const list = await t.request({ url: '/api/v1/devices/pairings/requests' });
    expect(list.headers['sg-pairing-state']).toBe('expired');
  });
});

describe('Gerätedaten', () => {
  it('app_version wird auf 64 Zeichen gekürzt, Name und Version ohne unsichtbare Zeichen (K1, K2)', async () => {
    const w = await openWindow();
    const res = await confirm({
      pairing_id: w.pairing_id,
      code: w.code,
      device_name: '\u202eiPad\u200b von Ilian\ufeff',
      app_version: `1.0\u200b-${'x'.repeat(200)}`,
    });
    expect(res.statusCode).toBe(201);
    const d = PairResponseSchema.parse(res.json()).device;
    expect(d.name).toBe('iPad von Ilian');
    expect(d.app_version).toHaveLength(64);
    expect(d.app_version?.startsWith('1.0-xx')).toBe(true);
  });
});

describe('Bonjour-Weg (pair/start)', () => {
  it('Anfrage erscheint in der Liste (nur lokal), Bestätigung mit der Kennung aus pair/start klappt', async () => {
    const w = await openWindow();
    const n = nonce();
    const s = await start({ device_name: 'iPad Pro', public_nonce: n });
    expect(s.statusCode).toBe(201);
    const started = PairStartResponseSchema.parse(s.json());
    expect(started.pairing_id).not.toBe(w.pairing_id);
    expect(JSON.stringify(s.json())).not.toContain(w.code);

    const listRes = await t.request({ url: '/api/v1/devices/pairings/requests' });
    expect(listRes.headers['sg-pairing-state']).toBe('open');
    expect(listRes.headers['sg-pairing-id']).toBe(w.pairing_id);
    const list = PairingRequestListSchema.parse(listRes.json());
    expect(list.items).toEqual([
      expect.objectContaining({ request_id: started.request_id, device_name: 'iPad Pro', kind: 'ipad' }),
    ]);

    const c = await confirm({ pairing_id: started.pairing_id, code: w.code, public_nonce: n });
    expect(c.statusCode).toBe(201);
    const after = await t.request({ url: '/api/v1/devices/pairings/requests' });
    expect(after.headers['sg-pairing-state']).toBe('paired');
    expect(PairingRequestListSchema.parse(after.json()).items).toHaveLength(0);
  });

  it('abgelehnte Anfrage: confirm → 403 pairing_request_rejected; request_id lässt sich nicht wiederverwenden', async () => {
    const w = await openWindow();
    const n = nonce();
    const started = PairStartResponseSchema.parse((await start({ public_nonce: n })).json());
    const del = await t.request({
      method: 'DELETE',
      url: `/api/v1/devices/pairings/requests/${started.request_id}`,
    });
    expect(del.statusCode).toBe(204);

    const c = await confirm({ pairing_id: started.pairing_id, code: w.code, public_nonce: n });
    expect(c.statusCode).toBe(403);
    expect(errorCode(c)).toBe('pairing_request_rejected');
    // Auch über den QR-Weg nicht
    const qr = await confirm({ pairing_id: w.pairing_id, code: w.code, public_nonce: n });
    expect(errorCode(qr)).toBe('pairing_request_rejected');

    // Zweites Ablehnen derselben request_id
    const again = await t.request({
      method: 'DELETE',
      url: `/api/v1/devices/pairings/requests/${started.request_id}`,
    });
    expect(again.statusCode).toBe(404);
    expect(errorCode(again)).toBe('pairing_request_not_found');
    // Neuer start mit derselben Nonce öffnet die Anfrage nicht wieder
    const restart = PairStartResponseSchema.parse((await start({ public_nonce: n })).json());
    expect(restart.request_id).toBe(started.request_id);
    expect(
      PairingRequestListSchema.parse((await t.request({ url: '/api/v1/devices/pairings/requests' })).json())
        .items,
    ).toHaveLength(0);

    // request_id eines alten Fensters gilt im neuen nicht
    const other = PairStartResponseSchema.parse((await start()).json());
    await openWindow();
    const stale = await t.request({
      method: 'DELETE',
      url: `/api/v1/devices/pairings/requests/${other.request_id}`,
    });
    expect(stale.statusCode).toBe(404);
  });

  it('höchstens 10 offene Anfragen → 429 pairing_requests_full', async () => {
    await openWindow();
    for (let i = 0; i < 10; i++) expect((await start()).statusCode).toBe(201);
    const full = await start();
    expect(full.statusCode).toBe(429);
    expect(errorCode(full)).toBe('pairing_requests_full');
  });
});

describe('Fenster am Mac schließen (DELETE /devices/pairings)', () => {
  it('schließt sofort und verwirft Anfragen; idempotent; nur lokal', async () => {
    const w = await openWindow();
    expect((await start({ device_name: 'Wartet' })).statusCode).toBe(201);
    const del = await t.request({ method: 'DELETE', url: '/api/v1/devices/pairings' });
    expect(del.statusCode).toBe(204);
    const list = await t.request({ url: '/api/v1/devices/pairings/requests' });
    expect(list.headers['sg-pairing-state']).toBe('closed');
    expect(PairingRequestListSchema.parse(list.json()).items).toEqual([]);
    const c = await confirm({ pairing_id: w.pairing_id, code: w.code });
    expect(errorCode(c)).toBe('pairing_window_closed');
    expect((await t.request({ method: 'DELETE', url: '/api/v1/devices/pairings' })).statusCode).toBe(204);

    const { token } = await pairDevice();
    const remote = await net({ method: 'DELETE', url: '/api/v1/devices/pairings', token });
    expect(remote.statusCode).toBe(403);
    expect(errorCode(remote)).toBe('local_only');
  });

  it('?pairing_id eines anderen Fensters lässt das aktuelle offen', async () => {
    const old = await openWindow();
    const current = await openWindow();
    const del = await t.request({
      method: 'DELETE',
      url: `/api/v1/devices/pairings?pairing_id=${old.pairing_id}`,
    });
    expect(del.statusCode).toBe(204);
    const c = await confirm({ pairing_id: current.pairing_id, code: current.code });
    expect(c.statusCode).toBe(201);
  });

  it('die geheime pairing_id aus ?pairing_id steht nicht im Log (#100, H-1)', async () => {
    const w = await openWindow();
    const before = logLines.length;
    const del = await t.request({
      method: 'DELETE',
      url: `/api/v1/devices/pairings?pairing_id=${w.pairing_id}`,
    });
    expect(del.statusCode).toBe(204);
    // Ungültige Kennung (400) und unbekannter Pfad (404) laufen über andere Logzeilen
    const bad = await t.request({
      method: 'DELETE',
      url: `/api/v1/devices/pairings?pairing_id=${w.pairing_id}x`,
    });
    expect(bad.statusCode).toBe(400);
    const missing = await t.request({
      method: 'DELETE',
      url: `/api/v1/gibt-es-nicht?pairing_id=${w.pairing_id}`,
    });
    expect(missing.statusCode).toBe(404);
    const list = await t.request({ url: '/api/v1/devices/pairings/requests' });
    expect(list.headers['sg-pairing-state']).toBe('closed');

    const lines = logLines.slice(before).join('\n');
    expect(lines).toContain('incoming request');
    expect(lines).toContain('/api/v1/devices/pairings?pairing_id=[Redacted]');
    expect(lines).not.toContain(w.pairing_id);
  });

  it('auch nach # liest Fastify die Query; die Kennung steht trotzdem nicht im Log (#100, H-1)', async () => {
    // Roh über TCP an einen echten Server: `inject` schneidet `#…` vorher ab
    await t.app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = t.app.server.address() as AddressInfo;
    const rawDelete = (path: string) =>
      new Promise<number>((resolve, reject) => {
        const socket = connect(port, '127.0.0.1', () =>
          socket.write(
            `DELETE ${path} HTTP/1.1\r\nHost: localhost:${TEST_PORT}\r\nConnection: close\r\n\r\n`,
          ),
        );
        let data = '';
        socket.on('data', (chunk: Buffer) => (data += chunk.toString('utf8')));
        socket.on('error', reject);
        socket.on('end', () => resolve(Number(data.split(' ')[1])));
      });

    const old = await openWindow();
    const current = await openWindow();
    const before = logLines.length;
    // Fremde Kennung hinter #: Fastify liest sie als pairing_id, darum bleibt das aktuelle Fenster offen
    expect(await rawDelete(`/api/v1/devices/pairings#pairing_id=${old.pairing_id}`)).toBe(204);
    const stillOpen = await t.request({ url: '/api/v1/devices/pairings/requests' });
    expect(stillOpen.headers['sg-pairing-state']).toBe('open');
    expect(await rawDelete(`/api/v1/devices/pairings#x=1&pairing_id=${current.pairing_id}`)).toBe(204);
    const closed = await t.request({ url: '/api/v1/devices/pairings/requests' });
    expect(closed.headers['sg-pairing-state']).toBe('closed');

    const lines = logLines.slice(before).join('\n');
    expect(lines).toContain('/api/v1/devices/pairings#pairing_id=[Redacted]');
    expect(lines).toContain('/api/v1/devices/pairings#x=1&pairing_id=[Redacted]');
    expect(lines).not.toContain(old.pairing_id);
    expect(lines).not.toContain(current.pairing_id);
  });
});

describe('Zustand während des Einlösens (#100, H-4)', () => {
  it('SG-Pairing-State ist confirming, solange ein richtiger Code eingelöst wird', async () => {
    const w = await openWindow();
    const grant = pairing.beginConfirm(
      { pairing_id: w.pairing_id, code: w.code, public_nonce: nonce() },
      freshIp(),
    );
    try {
      const during = await t.request({ url: '/api/v1/devices/pairings/requests' });
      expect(during.headers['sg-pairing-state']).toBe('confirming');
      expect(during.headers['sg-pairing-id']).toBe(w.pairing_id);
      const c = await confirm({ pairing_id: w.pairing_id, code: w.code });
      expect(errorCode(c)).toBe('pairing_window_closed');
    } finally {
      grant.abort();
    }
    const after = await t.request({ url: '/api/v1/devices/pairings/requests' });
    expect(after.headers['sg-pairing-state']).toBe('open');
  });
});

describe('DNS-Rebinding auf die LAN-IP (S1)', () => {
  const evil = { host: `evil.example:${TEST_PORT}`, origin: `http://evil.example:${TEST_PORT}` };

  it('(b) fremder Host aus dem Netz → 421, für pair/*, Routen mit Token und den WebSocket', async () => {
    const w = await openWindow();
    const { token } = await pairDevice();
    const s = await start({}, undefined, evil);
    expect(s.statusCode).toBe(421);
    expect(errorCode(s)).toBe('host_not_allowed');
    const c = await confirm({ pairing_id: w.pairing_id, code: wrongCode(w.code) }, { headers: evil });
    expect(c.statusCode).toBe(421);
    const withToken = await net({ url: '/api/v1/devices', token, headers: evil });
    expect(withToken.statusCode).toBe(421);
    const ws = await net({
      url: '/sync',
      token,
      headers: { ...evil, connection: 'Upgrade', upgrade: 'websocket' },
    });
    expect(ws.statusCode).toBe(421);
    // Ohne Origin, nur mit fremdem Host: ebenfalls 421
    const plain = await start({}, undefined, { host: 'evil.example' });
    expect(plain.statusCode).toBe(421);
    const w2 = await openWindow();
    expect((await start({}, undefined, evil)).statusCode).toBe(421);
    expect(
      PairingRequestListSchema.parse((await t.request({ url: '/api/v1/devices/pairings/requests' })).json())
        .items,
    ).toEqual([]);
    expect((await confirm({ pairing_id: w2.pairing_id, code: w2.code })).statusCode).toBe(201);
  });

  it('(a) pair/* mit Origin-Header → 403, auch bei erlaubtem Host; nichts wird angelegt oder gezählt', async () => {
    const w = await openWindow();
    const sameHost = { origin: `http://${MAC_IP}:${TEST_PORT}` };
    const s = await start({}, undefined, sameHost);
    expect(s.statusCode).toBe(403);
    expect(errorCode(s)).toBe('origin_not_allowed');
    for (let i = 0; i < 25; i++) {
      const c = await confirm({ pairing_id: w.pairing_id, code: wrongCode(w.code) }, { headers: sameHost });
      expect(errorCode(c)).toBe('origin_not_allowed');
    }
    const nullOrigin = await confirm(
      { pairing_id: w.pairing_id, code: w.code },
      { headers: { origin: 'null' } },
    );
    expect(errorCode(nullOrigin)).toBe('origin_not_allowed');
    const list = await t.request({ url: '/api/v1/devices/pairings/requests' });
    expect(list.headers['sg-pairing-state']).toBe('open');
    expect(PairingRequestListSchema.parse(list.json()).items).toEqual([]);
    // Das iPad (ohne Origin) koppelt danach normal
    expect((await confirm({ pairing_id: w.pairing_id, code: w.code })).statusCode).toBe(201);
  });

  it('erlaubt bleiben IP-Literale und .local-Namen; Routen mit Token behalten ihre Origin-Regel', async () => {
    await openWindow();
    expect((await start({}, undefined, { host: `ilians-macbook-air.local:${TEST_PORT}` })).statusCode).toBe(
      201,
    );
    expect((await start({}, undefined, { host: `[fe80::1]:${TEST_PORT}` })).statusCode).toBe(201);
    expect((await start({}, undefined, { host: MAC_IP })).statusCode).toBe(201);
    const { token } = await pairDevice();
    const read = await net({ url: '/api/v1/devices', token, headers: { origin: 'http://evil.example' } });
    expect(read.statusCode).toBe(200);
    const own = await net({
      method: 'DELETE',
      url: `/api/v1/devices/pairings/requests/${crypto.randomUUID()}`,
      token,
      headers: { origin: `http://${MAC_IP}:${TEST_PORT}` },
    });
    // Origin der eigenen Adresse ist erlaubt, die Route bleibt lokal
    expect(errorCode(own)).toBe('local_only');
  });
});

describe('Brute-Force und Blockade', () => {
  it('falscher Code bis zur Sperre; ein neues Fenster am Mac hebt sie auf', async () => {
    const w = await openWindow();
    const publicId = PairStartResponseSchema.parse((await start()).json()).pairing_id;
    // Ein Angreifer mit vielen Adressen und Nonces: 20 falsche Codes über die öffentliche Kennung
    for (let i = 0; i < 20; i++) {
      const res = await confirm({ pairing_id: publicId, code: wrongCode(w.code) });
      expect(res.statusCode).toBe(403);
      expect(errorCode(res)).toBe('pairing_code_invalid');
    }
    // Der öffentliche Weg ist zu, auch mit dem richtigen Code
    const blocked = await confirm({ pairing_id: publicId, code: w.code });
    expect(errorCode(blocked)).toBe('pairing_window_closed');
    expect((await start()).statusCode).toBe(409);
    const state = await t.request({ url: '/api/v1/devices/pairings/requests' });
    expect(state.headers['sg-pairing-state']).toBe('qr_only');

    // Ein weiterer Fehlversuch (nur mit dem QR-Code möglich) überschreitet 20 pro Stunde → Sperre
    const qrWrong = await confirm({ pairing_id: w.pairing_id, code: wrongCode(w.code) });
    expect(errorCode(qrWrong)).toBe('pairing_code_invalid');
    const locked = await confirm({ pairing_id: w.pairing_id, code: w.code });
    expect(locked.statusCode).toBe(423);
    expect(errorCode(locked)).toBe('pairing_locked');
    expect((await start()).statusCode).toBe(423);

    // Neues Fenster am Mac: Sperre und Zähler sind zurückgesetzt
    const neu = await openWindow();
    expect((await confirm({ pairing_id: neu.pairing_id, code: neu.code })).statusCode).toBe(201);
  });

  it('DoS: ein Angreifer verbraucht das Budget von pair/start, das echte iPad koppelt trotzdem per QR', async () => {
    const w = await openWindow();
    const publicId = PairStartResponseSchema.parse((await start()).json()).pairing_id;
    for (let i = 0; i < 25; i++) await confirm({ pairing_id: publicId, code: wrongCode(w.code) });
    // 10 Anfragen belegen alle Plätze des Bonjour-Wegs (soweit noch offen)
    for (let i = 0; i < 10; i++) await start();
    const ipad = await confirm({ pairing_id: w.pairing_id, code: w.code, device_name: 'Echtes iPad' });
    expect(ipad.statusCode).toBe(201);
  });

  it('Fehlermeldungen sind für jeden falschen Code gleich (kein „fast richtig“)', async () => {
    const w = await openWindow();
    const near = String((Number(w.code) + 1) % 1_000_000).padStart(6, '0');
    const far = wrongCode(w.code);
    const a = await confirm({ pairing_id: w.pairing_id, code: near });
    const b = await confirm({ pairing_id: w.pairing_id, code: far });
    expect(a.statusCode).toBe(b.statusCode);
    expect(a.json()).toEqual(b.json());
  });

  it('Rate-Limit: mehr als 10 pair/*-Aufrufe pro Minute von einer Adresse → 429 pairing_rate_limited', async () => {
    await openWindow();
    const ip = '192.168.77.77';
    for (let i = 0; i < 10; i++) expect((await start({}, ip)).statusCode).not.toBe(429);
    const limited = await start({}, ip);
    expect(limited.statusCode).toBe(429);
    expect(errorCode(limited)).toBe('pairing_rate_limited');
    const confirmLimited = await confirm({ pairing_id: crypto.randomUUID(), code: '123456' }, { ip });
    expect(errorCode(confirmLimited)).toBe('pairing_rate_limited');
  });

  it('pair/* ist nur per POST ohne Token erreichbar; andere Methoden brauchen ein Token', async () => {
    const res = await net({ method: 'GET', url: '/api/v1/devices/pair/start' });
    expect(res.statusCode).toBe(401);
    const dotted = await net({
      method: 'POST',
      url: '/api/v1/devices/pair/start/../../devices',
      payload: {},
    });
    expect(dotted.statusCode).toBe(401);
  });

  it('Code und Token stehen in keinem Log', async () => {
    const w = await openWindow();
    const res = await confirm({ pairing_id: w.pairing_id, code: w.code });
    const token = PairResponseSchema.parse(res.json()).device_token;
    await net({ url: '/api/v1/health', token });
    await net({ url: '/api/v1/health', token: 'x'.repeat(43) });
    const all = logLines.join('\n');
    expect(all.length).toBeGreaterThan(0);
    expect(all).not.toContain(token);
    expect(all).not.toContain(`"${w.code}"`);
    expect(all).not.toContain(`code=${w.code}`);
  });
});

describe('Token-Prüfung (VERTRAEGE §5)', () => {
  it('fehlendes Token → device_token_required, unbekanntes → device_token_invalid', async () => {
    const missing = await net({ url: '/api/v1/devices' });
    expect(errorCode(missing)).toBe('device_token_required');
    for (const token of ['abc', 'A'.repeat(43), randomBytes(32).toString('base64url')]) {
      const res = await net({ url: '/api/v1/devices', token });
      expect(res.statusCode).toBe(401);
      expect(errorCode(res)).toBe('device_token_invalid');
    }
  });

  it('gekoppeltes Gerät darf normale Routen nutzen', async () => {
    const { token } = await pairDevice();
    const res = await net({ url: '/api/v1/devices', token });
    expect(res.statusCode).toBe(200);
  });

  it('last_seen_at höchstens einmal pro Minute', async () => {
    const { id, token } = await pairDevice();
    await t.handle.db.execute(
      sql`UPDATE device SET last_seen_at = now() - interval '2 minutes' WHERE id = ${id}`,
    );
    const now = { ms: Date.now() };
    const tracker = new LastSeenTracker(t.handle.db, () => now.ms);
    expect(await verifyDeviceToken(t.handle.db, token)).toEqual({ deviceId: id });
    expect(await tracker.touch(id)).toBe(true);
    expect(await tracker.touch(id)).toBe(false);
    now.ms += 30_000;
    expect(await tracker.touch(id)).toBe(false);
    now.ms += 31_000;
    // Im Speicher ist eine Minute um, in der DB aber nicht: nicht schreiben
    expect(await tracker.touch(id)).toBe(false);
  });
});

describe('Gerät entfernen (REST)', () => {
  it('Token sofort ungültig, Gerät fehlt in der Liste, zweites Entfernen → 404', async () => {
    const { id, token } = await pairDevice('Altes iPad');
    const seen: string[] = [];
    const off = onDeviceRevoked((deviceId) => seen.push(deviceId));
    try {
      expect((await net({ url: '/api/v1/health', token })).statusCode).toBe(200);
      const del = await t.request({ method: 'DELETE', url: `/api/v1/devices/${id}` });
      expect(del.statusCode).toBe(204);
      expect(seen).toEqual([id]);
      const after = await net({ url: '/api/v1/health', token });
      expect(after.statusCode).toBe(401);
      expect(errorCode(after)).toBe('device_token_invalid');
      const list = DeviceListSchema.parse((await t.request({ url: '/api/v1/devices?limit=200' })).json());
      expect(list.items.map((d) => d.id)).not.toContain(id);
      const again = await t.request({ method: 'DELETE', url: `/api/v1/devices/${id}` });
      expect(again.statusCode).toBe(404);
      expect(errorCode(again)).toBe('device_not_found');
    } finally {
      off();
    }
  });

  it('aus dem Netz darf ein Gerät nur sich selbst entfernen (K4)', async () => {
    const a = await pairDevice('Gerät A');
    const b = await pairDevice('Gerät B');
    const other = await net({ method: 'DELETE', url: `/api/v1/devices/${b.id}`, token: a.token });
    expect(other.statusCode).toBe(403);
    expect(errorCode(other)).toBe('local_only');
    // Unbekannte ID: ebenfalls 403, die Antwort verrät nicht, ob es sie gibt
    const unknown = await net({
      method: 'DELETE',
      url: `/api/v1/devices/${crypto.randomUUID()}`,
      token: a.token,
    });
    expect(errorCode(unknown)).toBe('local_only');
    expect((await net({ url: '/api/v1/health', token: b.token })).statusCode).toBe(200);
    // Lokal geht es weiterhin
    expect((await t.request({ method: 'DELETE', url: `/api/v1/devices/${b.id}` })).statusCode).toBe(204);
  });

  it('ein Gerät kann sich mit seinem Token selbst entfernen (Netzroute)', async () => {
    const { id, token } = await pairDevice();
    const del = await net({ method: 'DELETE', url: `/api/v1/devices/${id}`, token });
    expect(del.statusCode).toBe(204);
    expect((await net({ url: '/api/v1/health', token })).statusCode).toBe(401);
  });

  it('ungültige ID → 400 validation_failed', async () => {
    const res = await t.request({ method: 'DELETE', url: '/api/v1/devices/nicht-uuid' });
    expect(res.statusCode).toBe(400);
  });
});

describe('WebSocket-Upgrade (§11.1) und Widerruf', () => {
  it('Upgrade mit fremdem Origin → 403, auch mit gültigem Token; lokal ebenso', async () => {
    const { token } = await pairDevice();
    const upgrade = { connection: 'Upgrade', upgrade: 'websocket', origin: 'http://evil.example' };
    const remote = await net({ url: '/sync', token, headers: upgrade });
    expect(remote.statusCode).toBe(403);
    expect(errorCode(remote)).toBe('origin_not_allowed');
    const local = await t.request({ url: '/sync', headers: upgrade });
    expect(local.statusCode).toBe(403);
    const revokedOrMissing = await net({
      url: '/sync',
      headers: { connection: 'Upgrade', upgrade: 'websocket' },
    });
    expect(errorCode(revokedOrMissing)).toBe('device_token_required');
  });

  it('authenticateUpgrade prüft auch rohe Anfragen (Token, Origin, Host)', async () => {
    const { id, token } = await pairDevice();
    const raw = (headers: Record<string, string>, remoteAddress: string) => ({
      method: 'GET',
      headers: { upgrade: 'websocket', ...headers },
      socket: { remoteAddress },
    });
    await expect(
      t.app.authenticateUpgrade(
        raw({ host: `${MAC_IP}:${TEST_PORT}`, authorization: `Bearer ${token}` }, '10.0.0.2'),
      ),
    ).resolves.toEqual({ deviceId: id });
    await expect(
      t.app.authenticateUpgrade(raw({ host: `localhost:${TEST_PORT}` }, '127.0.0.1')),
    ).resolves.toBeNull();
    await expect(
      t.app.authenticateUpgrade(raw({ host: `localhost:${TEST_PORT}` }, '10.0.0.2')),
    ).rejects.toMatchObject({
      code: 'host_not_allowed',
    });
    await expect(
      t.app.authenticateUpgrade(raw({ host: `${MAC_IP}:${TEST_PORT}` }, '10.0.0.2')),
    ).rejects.toMatchObject({
      code: 'device_token_required',
    });
    await expect(
      t.app.authenticateUpgrade(
        raw({ host: `localhost:${TEST_PORT}`, origin: 'http://evil.example' }, '127.0.0.1'),
      ),
    ).rejects.toMatchObject({ code: 'origin_not_allowed' });
  });

  // Echter WebSocket über eine Nicht-Loopback-Adresse dieses Rechners, gegen den echten Sync-Server (T1-08):
  // DELETE /devices/{id} ruft closeDeviceConnections(id, 4401) auf.
  const lanAddress = Object.values(networkInterfaces())
    .flat()
    .find((i) => i && i.family === 'IPv4' && !i.internal)?.address;

  it.skipIf(!lanAddress)(
    'widerrufenes Gerät: offener WebSocket wird mit 4401 geschlossen, neuer Upgrade → 401',
    async () => {
      const port = await freePort();
      const config = testConfig({ port });
      const handle = createDb(config.databaseUrl);
      const server = await buildApp({ config, db: handle.db, logger: pino({ level: 'silent' }) });
      await server.listen({ host: '0.0.0.0', port });
      // Alle Sockets des Servers, um zu prüfen, dass ein abgelehnter Upgrade nicht offen hängen bleibt
      const open = new Set<Socket>();
      server.server.on('connection', (sock: Socket) => {
        open.add(sock);
        sock.on('close', () => open.delete(sock));
      });
      try {
        // Kopplung gegen diesen Server (Host-Header passend zum gewählten Port)
        const opened = await server.inject({
          method: 'POST',
          url: '/api/v1/devices/pairings',
          remoteAddress: '127.0.0.1',
          headers: { host: `localhost:${port}` },
        });
        expect(opened.statusCode).toBe(201);
        const w = PairingCodeSchema.parse(opened.json());
        const paired = await server.inject({
          method: 'POST',
          url: '/api/v1/devices/pair/confirm',
          remoteAddress: lanAddress,
          headers: { host: `${lanAddress}:${port}` },
          payload: {
            pairing_id: w.pairing_id,
            code: w.code,
            device_name: 'iPad',
            kind: 'ipad',
            public_nonce: nonce(),
          },
        });
        const { device_token: token, device: d } = PairResponseSchema.parse(paired.json());

        const client = new WebSocket(`ws://${lanAddress}:${port}/sync`, {
          headers: { authorization: `Bearer ${token}` },
        } as unknown as string[]);
        await new Promise<void>((resolve, reject) => {
          client.onopen = () => resolve();
          client.onerror = () => reject(new Error('WebSocket nicht geöffnet'));
        });
        const closed = new Promise<number>((resolve) => {
          client.onclose = (event) => resolve(event.code);
        });
        await new Promise((r) => setTimeout(r, 50));

        const del = await server.inject({
          method: 'DELETE',
          url: `/api/v1/devices/${d.id}`,
          remoteAddress: '127.0.0.1',
          headers: { host: `localhost:${port}` },
        });
        expect(del.statusCode).toBe(204);
        expect(await closed).toBe(4401);

        // Neuer Upgrade mit dem widerrufenen Token: HTTP 401 vor dem Wechsel auf WebSocket
        const status = await new Promise<number>((resolve, reject) => {
          const req = httpRequest({
            host: lanAddress,
            port,
            path: '/sync',
            headers: {
              connection: 'Upgrade',
              upgrade: 'websocket',
              'sec-websocket-version': '13',
              'sec-websocket-key': randomBytes(16).toString('base64'),
              authorization: `Bearer ${token}`,
            },
          });
          req.on('response', (res) => {
            res.resume();
            // Der Server schließt den Socket nach der Ablehnung selbst (Connection: close)
            expect(res.headers.connection).toBe('close');
            res.socket.on('close', () => resolve(res.statusCode ?? 0));
          });
          req.on('upgrade', () => resolve(101));
          req.on('error', reject);
          req.end();
        });
        expect(status).toBe(401);
        for (let i = 0; i < 40 && open.size > 0; i++) await new Promise((r) => setTimeout(r, 50));
        expect(open.size).toBe(0);
      } finally {
        await server.close();
        await handle.close();
      }
    },
  );

  it.skipIf(!lanAddress)(
    'Upgrade mit kaputter URL aus dem Netz: Ablehnung schließt den Socket, auch bei h2c (Gegen-Review #84, S-1)',
    async () => {
      const port = await freePort();
      const config = testConfig({ port });
      const handle = createDb(config.databaseUrl);
      const server = await buildApp({ config, db: handle.db, logger: pino({ level: 'silent' }) });
      await server.listen({ host: '0.0.0.0', port });
      // Gemessen wird am Server-Socket: Der Client hält seine Seite offen (allowHalfOpen), nur der Server kann schließen
      const serverSockets = new Set<Socket>();
      server.server.on('connection', (sock: Socket) => {
        serverSockets.add(sock);
        sock.on('close', () => serverSockets.delete(sock));
      });
      const { connect } = await import('node:net');
      const cases = [
        { path: '/%', upgrade: 'Upgrade: websocket' },
        { path: '/sync%zz', upgrade: 'Upgrade: websocket' },
        // Nicht-WebSocket-Upgrades: Node löst 'upgrade' trotzdem aus
        { path: '/%', upgrade: 'Upgrade: h2c' },
        { path: '/%', upgrade: 'Upgrade: websocket\r\nUpgrade: websocket' },
      ];
      const clients: Socket[] = [];
      try {
        for (const c of cases) {
          const head = await new Promise<string>((resolve, reject) => {
            let data = '';
            const sock = connect({ host: lanAddress as string, port, allowHalfOpen: true }, () => {
              sock.write(
                `GET ${c.path} HTTP/1.1\r\nHost: ${lanAddress}:${port}\r\nConnection: Upgrade\r\n` +
                  `${c.upgrade}\r\nSec-WebSocket-Version: 13\r\n` +
                  `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\n\r\n`,
              );
            });
            clients.push(sock);
            sock.on('data', (chunk: Buffer) => (data += chunk.toString()));
            sock.on('end', () => resolve(data));
            sock.on('error', reject);
            setTimeout(() => resolve(data), 3000);
          });
          expect(head, c.upgrade).toMatch(/^HTTP\/1\.1 4\d\d/);
          expect(head.toLowerCase(), c.upgrade).toContain('connection: close');
        }
        // Spätestens nach der Frist (1 s) zerstört der Server alle Sockets, obwohl die Clients offen bleiben
        for (let i = 0; i < 60 && serverSockets.size > 0; i++) await new Promise((r) => setTimeout(r, 50));
        expect(serverSockets.size).toBe(0);
      } finally {
        for (const sock of clients) sock.destroy();
        await server.close();
        await handle.close();
      }
    },
  );
});
