// Sync-Server mit gekoppelten Geräten aus dem Netz, gegen den echten Wächter (T1-10): request.sgDevice,
// Gegenprobe der device_id, time.offset, localOnly-Ereignisse, pairing.requested, Widerruf
// (closeDeviceConnections, Lücke zwischen Wächter und hub.add, Prüfung vor welcome), Device.connected.
// Braucht eine IPv4-Adresse, die nicht Loopback ist.
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SyncEvent } from '@sg/shared';
import { uuidv7 } from '../../src/lib/uuid7.ts';
import { createDevice } from '../../src/services/devices.ts';
import { closeDeviceConnections, isDeviceConnected } from '../../src/sync/connections.ts';
import { publishEvent } from '../../src/sync/events.ts';
import { registerOpHandler } from '../../src/sync/handlers.ts';
import { syncTestHooks } from '../../src/sync/server.ts';
import {
  markerOp,
  networkAddress,
  sessionStream,
  sleep,
  startSyncApp,
  TestClient,
  waitFor,
  type SyncTestApp,
} from './sync-helpers.ts';

const address = networkAddress();

let app: SyncTestApp;
const clients: TestClient[] = [];
const handled: { deviceId: string | null; origin: string }[] = [];

registerOpHandler('marker.add', async (_tx, _op, ctx) => {
  handled.push(ctx);
});

describe.skipIf(address === null)('Sync mit Geräten aus dem Netz', () => {
  let deviceId: string;
  let token: string;

  beforeAll(async () => {
    app = await startSyncApp({ host: '0.0.0.0' });
  });
  beforeEach(async () => {
    const created = await createDevice(app.handle.db, {
      name: 'iPad von Test',
      kind: 'ipad',
      appVersion: null,
    });
    deviceId = created.device.id;
    token = created.token;
  });
  afterEach(() => {
    syncTestHooks.beforeAccept = null;
    for (const c of clients.splice(0)) c.close();
  });
  afterAll(async () => {
    await app.close();
  });

  const netUrl = () => `ws://${address}:${app.port}/sync`;
  const localUrl = () => `ws://127.0.0.1:${app.port}/sync`;

  /** REST-Aufruf am Mac (lokal, ohne Token) */
  const localRest = (method: string, path: string, body?: unknown) =>
    fetch(`http://127.0.0.1:${app.port}/api/v1${path}`, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

  async function open(url: string, headers: Record<string, string> = {}): Promise<TestClient> {
    const client = await TestClient.open(url, headers);
    clients.push(client);
    return client;
  }

  const helloAsDevice = (client: TestClient, extra: Record<string, unknown> = {}) =>
    client.send({
      type: 'hello',
      protocol: 1,
      client: 'ipad',
      app_version: '1.2.3',
      streams: [],
      device_id: deviceId,
      ...extra,
    });

  async function device(extra: Record<string, unknown> = {}): Promise<TestClient> {
    const client = await open(netUrl(), { authorization: `Bearer ${token}` });
    helloAsDevice(client, extra);
    return client;
  }

  async function local(): Promise<TestClient> {
    const client = await open(localUrl());
    expect((await client.hello()).type).toBe('welcome');
    return client;
  }

  /** Hält das Annehmen der nächsten Verbindung nach dem Wächter an, bis `release` aufgerufen wird */
  function holdAccept(): { reached: Promise<void>; release: () => void } {
    let release!: () => void;
    let reached!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const reachedP = new Promise<void>((r) => (reached = r));
    syncTestHooks.beforeAccept = async () => {
      syncTestHooks.beforeAccept = null;
      reached();
      await gate;
    };
    return { reached: reachedP, release };
  }

  it('lehnt Verbindungen aus dem Netz ohne bzw. mit unbekanntem Token per HTTP ab (Wächter, 401)', async () => {
    const none = new TestClient(netUrl());
    clients.push(none);
    await none.closed();
    expect(none.httpStatus).toBe(401);
    const unknown = new TestClient(netUrl(), {
      authorization: `Bearer EXAMPLEunbekannt${randomBytes(4).toString('hex')}`,
    });
    clients.push(unknown);
    await unknown.closed();
    expect(unknown.httpStatus).toBe(401);
  });

  it('meldet das Gerät an, speichert app_version und time.offset und gibt das Gerät an den Handler', async () => {
    const watcher = await local();
    const client = await device();
    expect(await client.next((m) => m.type === 'welcome')).toMatchObject({ device_id: deviceId });
    expect(isDeviceConnected(deviceId)).toBe(true);
    expect(await watcher.next((m) => m.type === 'event' && m.name === 'device.connection')).toEqual({
      type: 'event',
      name: 'device.connection',
      data: { client: 'ipad', device_id: deviceId, connected: true },
    });

    client.send({ type: 'time.offset', offset_ms: -1234, rtt_ms: 12 });
    const readDevice = async () =>
      (
        await app.handle.sql<{ clock_offset_ms: number | null; app_version: string | null }[]>`
          SELECT clock_offset_ms, app_version FROM device WHERE id = ${deviceId}`
      )[0];
    let row = await readDevice();
    for (let i = 0; i < 100 && row?.clock_offset_ms !== -1234; i += 1) {
      await sleep(20);
      row = await readDevice();
    }
    expect(row).toEqual({ clock_offset_ms: -1234, app_version: '1.2.3' });

    const page = uuidv7();
    client.send({ type: 'presence', session_id: null, notebook_id: uuidv7(), page_id: page });
    const presence = await watcher.next((m) => m.type === 'event' && m.name === 'presence');
    expect(presence.data).toMatchObject({
      client: 'ipad',
      device_id: deviceId,
      device_name: 'iPad von Test',
      page_id: page,
    });

    const op = markerOp(sessionStream());
    client.send(op);
    await client.next((m) => m.type === 'ack');
    expect(handled.at(-1)).toEqual({ deviceId, origin: 'ipad' });
  });

  it('prüft hello.device_id gegen das Token (device_token_invalid, 4401)', async () => {
    const client = await device({ device_id: uuidv7() });
    expect(await client.next((m) => m.type === 'error')).toMatchObject({
      code: 'device_token_invalid',
      fatal: true,
    });
    expect(await client.closed()).toBe(4401);
  });

  it('sendet localOnly-Ereignisse und pairing.requested nur an lokale Clients', async () => {
    const watcher = await local();
    const client = await device();
    await client.next((m) => m.type === 'welcome');
    const localOnly: SyncEvent = {
      type: 'event',
      name: 'device.connection',
      data: { client: 'ipad', device_id: uuidv7(), connected: true },
    };
    const pairing: SyncEvent = {
      type: 'event',
      name: 'pairing.requested',
      data: {
        request_id: uuidv7(),
        pairing_id: uuidv7(),
        device_name: 'Fremdes iPad',
        kind: 'ipad',
        requested_at: '2026-11-04T07:16:00Z',
      },
    };
    const forAll: SyncEvent = {
      type: 'event',
      name: 'presence',
      data: {
        client: 'web',
        device_id: null,
        device_name: 'alle',
        session_id: null,
        notebook_id: null,
        page_id: null,
      },
    };
    publishEvent(localOnly, { localOnly: true });
    publishEvent(pairing);
    publishEvent(forAll);
    const same = (e: SyncEvent) => (m: unknown) => JSON.stringify(m) === JSON.stringify(e);
    await watcher.next(same(localOnly));
    await watcher.next(same(pairing));
    await watcher.next(same(forAll));
    await client.next(same(forAll));
    await sleep(100);
    expect(client.messages.some(same(localOnly))).toBe(false);
    expect(client.messages.some(same(pairing))).toBe(false);
  });

  it('pair/start aus dem Netz (T1-10) erzeugt pairing.requested nur für lokale Clients', async () => {
    const watcher = await local();
    const client = await device();
    await client.next((m) => m.type === 'welcome');
    const opened = await localRest('POST', '/devices/pairings');
    expect(opened.status).toBe(201);
    const started = await fetch(`http://${address}:${app.port}/api/v1/devices/pair/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        device_name: 'Neues iPad',
        kind: 'ipad',
        public_nonce: `EXAMPLEnonce${randomBytes(6).toString('hex')}`,
      }),
    });
    expect(started.status).toBe(201);
    const event = await watcher.next((m) => m.type === 'event' && m.name === 'pairing.requested');
    expect(event.data).toMatchObject({ device_name: 'Neues iPad', kind: 'ipad' });
    await sleep(100);
    expect(client.messages.some((m) => m.type === 'event' && m.name === 'pairing.requested')).toBe(false);
  });

  it('closeDeviceConnections schließt alle Verbindungen des Geräts mit dem Code', async () => {
    const watcher = await local();
    const first = await device();
    const second = await device();
    await first.next((m) => m.type === 'welcome');
    await second.next((m) => m.type === 'welcome');
    closeDeviceConnections(deviceId, 4401);
    expect(await first.closed()).toBe(4401);
    expect(await second.closed()).toBe(4401);
    expect(isDeviceConnected(deviceId)).toBe(false);
    await watcher.next(
      (m) =>
        m.type === 'event' &&
        m.name === 'device.connection' &&
        (m.data as { connected: boolean; device_id: string }).connected === false,
    );
    expect(watcher.closeCode).toBeNull();
  });

  it('DELETE /devices/{id} schließt die Verbindung mit 4401, Device.connected stimmt', async () => {
    const client = await device();
    await client.next((m) => m.type === 'welcome');
    const listed = async () => {
      const res = await localRest('GET', '/devices');
      const body = (await res.json()) as { items: { id: string; connected: boolean }[] };
      return body.items.find((d) => d.id === deviceId)?.connected;
    };
    expect(await listed()).toBe(true);
    expect((await localRest('DELETE', `/devices/${deviceId}`)).status).toBe(204);
    expect(await client.closed()).toBe(4401);
    await waitFor(() => !isDeviceConnected(deviceId));
    // Neuer Upgrade mit dem widerrufenen Token: 401 vom Wächter
    const again = new TestClient(netUrl(), { authorization: `Bearer ${token}` });
    clients.push(again);
    await again.closed();
    expect(again.httpStatus).toBe(401);
  });

  it('Widerruf zwischen Wächter und hub.add: Verbindung wird sofort mit 4401 geschlossen (Security-Review #83, S3)', async () => {
    const gate = holdAccept();
    const client = await open(netUrl(), { authorization: `Bearer ${token}` });
    await gate.reached;
    // Der Wächter hat das Token schon akzeptiert. Jetzt widerrufen: closeDeviceConnections sieht die Verbindung nicht
    expect((await localRest('DELETE', `/devices/${deviceId}`)).status).toBe(204);
    gate.release();
    // Geschlossen, ohne dass der Client etwas gesendet hat (die Prüfung direkt nach hub.add greift)
    expect(await client.closed(2000)).toBe(4401);
    expect(client.messages).toEqual([
      expect.objectContaining({ type: 'error', code: 'device_token_invalid' }),
    ]);
    expect(isDeviceConnected(deviceId)).toBe(false);
  });

  it('Widerruf ohne Benachrichtigung (z. B. vor einem Neustart): Prüfung vor welcome per Datenbank', async () => {
    const gate = holdAccept();
    const client = await open(netUrl(), { authorization: `Bearer ${token}` });
    await gate.reached;
    // Direkt in der Datenbank: onDeviceRevoked feuert nicht, das Set im Speicher kennt den Widerruf nicht
    await app.handle.sql`UPDATE device SET deleted_at = now() WHERE id = ${deviceId}`;
    gate.release();
    await sleep(50);
    helloAsDevice(client);
    expect(await client.next((m) => m.type === 'error')).toMatchObject({
      code: 'device_token_invalid',
      fatal: true,
    });
    expect(await client.closed()).toBe(4401);
    expect(client.messages.some((m) => m.type === 'welcome')).toBe(false);
  });
});
