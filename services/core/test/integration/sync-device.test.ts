// Sync-Server mit gekoppelten Geräten aus dem Netz (T1-08): resolveDevice, Gegenprobe der device_id,
// time.offset, localOnly-Ereignisse, closeDeviceConnections/isDeviceConnected.
// Braucht eine IPv4-Adresse, die nicht Loopback ist. T1-10 wird `request.sgDevice` setzen, hier simuliert das
// der Token-Prüfer der Test-App.
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SINGLE_USER_ID, type SyncEvent } from '@sg/shared';
import { uuidv7 } from '../../src/lib/uuid7.ts';
import { closeDeviceConnections, isDeviceConnected } from '../../src/sync/connections.ts';
import { publishEvent } from '../../src/sync/events.ts';
import { registerOpHandler } from '../../src/sync/handlers.ts';
import {
  markerOp,
  networkAddress,
  sessionStream,
  sleep,
  startSyncApp,
  TestClient,
  type SyncTestApp,
} from './sync-helpers.ts';

const address = networkAddress();
const deviceId = uuidv7();
const TOKEN = 'EXAMPLEdevicetoken0000000000000000000000001';
const TOKEN_WITHOUT_DEVICE = 'EXAMPLEdevicetoken0000000000000000000000002';

let app: SyncTestApp;
const clients: TestClient[] = [];
const handled: { deviceId: string | null; origin: string }[] = [];

registerOpHandler('marker.add', async (_tx, _op, ctx) => {
  handled.push(ctx);
});

describe.skipIf(address === null)('Sync mit Geräten aus dem Netz', () => {
  beforeAll(async () => {
    app = await startSyncApp({
      host: '0.0.0.0',
      devices: { [TOKEN]: deviceId, [TOKEN_WITHOUT_DEVICE]: null },
    });
    await app.handle.sql`INSERT INTO device (id, user_id, name, kind, token_hash)
      VALUES (${deviceId}, ${SINGLE_USER_ID}, 'iPad von Test', 'ipad', ${randomBytes(32).toString('hex')})`;
  });
  afterEach(() => {
    for (const c of clients.splice(0)) c.close();
  });
  afterAll(async () => {
    await app.handle.sql`DELETE FROM device WHERE id = ${deviceId}`;
    await app.close();
  });

  const netUrl = () => `ws://${address}:${app.port}/sync`;
  const localUrl = () => `ws://127.0.0.1:${app.port}/sync`;

  async function open(url: string, headers: Record<string, string> = {}): Promise<TestClient> {
    const client = await TestClient.open(url, headers);
    clients.push(client);
    return client;
  }

  async function device(extra: Record<string, unknown> = {}): Promise<TestClient> {
    const client = await open(netUrl(), { authorization: `Bearer ${TOKEN}` });
    client.send({
      type: 'hello',
      protocol: 1,
      client: 'ipad',
      app_version: '1.2.3',
      streams: [],
      device_id: deviceId,
      ...extra,
    });
    return client;
  }

  async function local(): Promise<TestClient> {
    const client = await open(localUrl());
    expect((await client.hello()).type).toBe('welcome');
    return client;
  }

  it('lehnt Verbindungen aus dem Netz ohne Token per HTTP ab (Wächter, 401)', async () => {
    const client = new TestClient(netUrl());
    clients.push(client);
    await client.closed();
    expect(client.httpStatus).toBe(401);
  });

  it('schließt eine Netzverbindung ohne request.sgDevice mit 4401 (Fallback in resolveDevice)', async () => {
    const client = await open(netUrl(), { authorization: `Bearer ${TOKEN_WITHOUT_DEVICE}` });
    expect(await client.next((m) => m.type === 'error')).toMatchObject({
      code: 'device_token_invalid',
      fatal: true,
    });
    expect(await client.closed()).toBe(4401);
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
});
