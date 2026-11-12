// #304 M2: Eine Wiederherstellung (`sg restore`) darf kein Gerät aktiv machen, das beim Restore nicht aktiv war.
// Ende-zu-Ende gegen echtes PostgreSQL und den echten Tunnel-Eingang: koppeln → Backup → Gerät widerrufen → Restore →
// altes Token ergibt 401 (Haupteingang und Tunnel). Der Restore ist der echte von `infra/sg`, in einer eigenen
// Datenbank (das Tauschen der Datenbank berührt so nicht die gemeinsame Test-Datenbank).
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PairingCodeSchema, PairResponseSchema } from '@sg/shared';
import { runBackup } from '../../../../infra/sg/src/backup.ts';
import { createPg, realExec } from '../../../../infra/sg/src/pg.ts';
import { revokeRestoredDevices, runRestore } from '../../../../infra/sg/src/restore.ts';
import { createDb } from '../../src/db/client.ts';
import { runMigrations } from '../../src/db/migrate.ts';
import { startTestApp, TEST_PORT, testDatabaseUrl, type TestApp } from './helpers.ts';

const API = '/api/v1';
const MAC_IP = '192.168.1.5';

function viaTunnel(socketPath: string, path: string, token: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath,
        path,
        agent: false,
        headers: { host: '127.0.0.1:51234', authorization: `Bearer ${token}` },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

let ip = 0;
async function pair(t: TestApp, name: string): Promise<{ id: string; token: string }> {
  const opened = await t.request({ method: 'POST', url: `${API}/devices/pairings` });
  const code = PairingCodeSchema.parse(opened.json());
  const res = await t.app.inject({
    method: 'POST',
    url: `${API}/devices/pair/confirm`,
    remoteAddress: `192.168.30.${++ip}`,
    headers: { host: `${MAC_IP}:${TEST_PORT}` },
    payload: {
      pairing_id: code.pairing_id,
      code: code.code,
      device_name: name,
      kind: 'ipad',
      public_nonce: randomBytes(18).toString('base64url'),
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  const paired = PairResponseSchema.parse(res.json());
  return { id: paired.device.id, token: paired.device_token };
}

describe('Restore und Geräte (#304 M2)', () => {
  const dbName = `sg_rg_${randomBytes(4).toString('hex')}`;
  const base = new URL(testDatabaseUrl());
  const url = new URL(base.toString());
  url.pathname = `/${dbName}`;
  const root = mkdtempSync(join(tmpdir(), 'sg-rg-'));
  const dataDir = join(root, 'daten');
  const target = join(root, 'ziel');
  const admin = postgres(base.toString(), { max: 1, onnotice: () => {} });
  const apps: TestApp[] = [];

  beforeAll(async () => {
    mkdirSync(dataDir, { mode: 0o700 });
    mkdirSync(target, { mode: 0o700 });
    await admin.unsafe(`CREATE DATABASE ${dbName}`);
    const handle = createDb(url.toString());
    try {
      await runMigrations(handle.db);
    } finally {
      await handle.close();
    }
  }, 60_000);

  afterAll(async () => {
    for (const t of apps.splice(0)) await t.close().catch(() => {});
    await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    const stale = await admin.unsafe(
      `SELECT datname FROM pg_database WHERE datname LIKE '${dbName}\\_vor\\_restore\\_%'`,
    );
    for (const row of stale) {
      await admin.unsafe(`DROP DATABASE IF EXISTS ${row.datname as string} WITH (FORCE)`);
    }
    await admin.end({ timeout: 5 });
    rmSync(root, { recursive: true, force: true });
  });

  async function startApp(): Promise<TestApp> {
    const t = await startTestApp({ dataDir, databaseUrl: url.toString() });
    apps.push(t);
    await t.app.tunnel.start();
    return t;
  }
  const stop = async (t: TestApp) => {
    await t.close();
    apps.splice(apps.indexOf(t), 1);
  };
  const mainStatus = async (t: TestApp, token: string) =>
    (
      await t.app.inject({
        method: 'GET',
        url: `${API}/health`,
        remoteAddress: '192.168.30.250',
        headers: { host: `${MAC_IP}:${TEST_PORT}`, authorization: `Bearer ${token}` },
      })
    ).statusCode;

  it('widerrufenes Gerät bleibt nach dem Restore ungültig, auch über den Tunnel; kein Gerät wird aktiv', async () => {
    let t = await startApp();
    const a = await pair(t, 'iPad A (wird widerrufen)');
    const b = await pair(t, 'iPad B (bleibt)');
    expect(await mainStatus(t, a.token)).toBe(200);
    expect(await viaTunnel(t.app.tunnel.socketPath, `${API}/health`, a.token)).toBe(200);

    // Backup mit beiden Geräten aktiv
    const pg = createPg({ databaseUrl: url.toString(), composeFile: '' }, realExec, 'local');
    const quiet = { log: () => {}, err: (m: string) => expect.fail(m) };
    const cfg = { dataDir, databaseUrl: url.toString() };
    expect(await runBackup({ ...quiet, cfg, pg }, { trigger: 'manuell', target })).toBe(0);
    const stand = readdirSync(target).filter((n) => /^\d{8}T\d{6}Z$/.test(n))[0] as string;

    // Danach: Gerät A widerrufen (z. B. verlorenes iPad)
    const del = await t.request({ method: 'DELETE', url: `${API}/devices/${a.id}` });
    expect(del.statusCode).toBe(204);
    expect(await mainStatus(t, a.token)).toBe(401);
    expect(await viaTunnel(t.app.tunnel.socketPath, `${API}/health`, a.token)).toBe(401);
    await stop(t);

    // Restore des Standes von vor dem Widerruf
    const lines: string[] = [];
    const code = await runRestore(
      {
        log: (m) => lines.push(m),
        err: (m) => expect.fail(m),
        cfg,
        pg,
        servicesRunning: async () => [],
        confirm: async () => true,
      },
      { stand, test: false, yes: true, target },
    );
    expect(code).toBe(0);

    // Core startet neu (wie `sg start`)
    t = await startApp();
    for (const dev of [a, b]) {
      expect(await mainStatus(t, dev.token)).toBe(401);
      expect(await viaTunnel(t.app.tunnel.socketPath, `${API}/health`, dev.token)).toBe(401);
    }
    const list = await t.request({ method: 'GET', url: `${API}/devices` });
    expect(list.statusCode).toBe(200);
    expect(JSON.stringify(list.json())).not.toContain(a.id);
    // Tunnel-Schlüssel der alten Geräte sind aus der Schlüsseldatei verschwunden
    const keys = readFileSync(join(dataDir, 'secrets', 'tunnel-keys.json'), 'utf8');
    expect(keys).not.toContain(a.id);
    expect(keys).not.toContain(b.id);

    // Neu koppeln funktioniert
    const fresh = await pair(t, 'iPad neu gekoppelt');
    expect(await mainStatus(t, fresh.token)).toBe(200);
    expect(await viaTunnel(t.app.tunnel.socketPath, `${API}/health`, fresh.token)).toBe(200);
    // `sg restore` sagt an, dass neu gekoppelt werden muss
    expect(lines.join('\n')).toMatch(/2 gekoppelte Geräte wurden widerrufen/);
    await stop(t);
  }, 120_000);

  it('revokeRestoredDevices: ältere Stände ohne Tabelle device ergeben 0, ein zweiter Lauf widerruft nichts mehr', async () => {
    const scratch = `${dbName}_leer`;
    await admin.unsafe(`CREATE DATABASE ${scratch}`);
    try {
      const u = new URL(url.toString());
      u.pathname = `/${scratch}`;
      const pg = createPg({ databaseUrl: u.toString(), composeFile: '' }, realExec, 'local');
      expect(await revokeRestoredDevices(pg, scratch)).toBe(0);
    } finally {
      await admin.unsafe(`DROP DATABASE IF EXISTS ${scratch} WITH (FORCE)`);
    }
    const pg = createPg({ databaseUrl: url.toString(), composeFile: '' }, realExec, 'local');
    // Vom ersten Test ist das neu gekoppelte Gerät aktiv: eins wird widerrufen, danach ist nichts mehr aktiv
    expect(await revokeRestoredDevices(pg, dbName)).toBe(1);
    expect(await revokeRestoredDevices(pg, dbName)).toBe(0);
  });
});
