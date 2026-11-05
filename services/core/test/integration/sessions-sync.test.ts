// Sessions im echten Sync-Server (T1-02 + T1-08): Handler mit preLock, session_superseded (4409), `session.updated`
// bei REST-Zustandswechseln und bei Meldungen des Workers (`sg_session`), echter Versand ohne Mocks.
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SINGLE_USER_ID } from '@sg/shared';
import { calendarEvent, session } from '../../src/db/schema/index.ts';
import { uuidv7 } from '../../src/lib/uuid7.ts';
import { getOpRegistration } from '../../src/sync/handlers.ts';
import { seedModule } from './ink-helpers.ts';
import { startSyncApp, TestClient, type Msg, type SyncTestApp } from './sync-helpers.ts';

let app: SyncTestApp;
let moduleId = '';
const clients: TestClient[] = [];
const T0 = Date.now();

beforeAll(async () => {
  app = await startSyncApp({ extra: { sessionTicker: false } });
});
afterAll(async () => {
  for (const c of clients.splice(0)) c.close();
  await app.close();
});
beforeEach(async () => {
  await app.handle.sql`TRUNCATE semester, module, calendar_event, session, sync_op, sync_stream, job CASCADE`;
  moduleId = (await seedModule(app.handle.db)).moduleId;
});
afterEach(() => {
  for (const c of clients.splice(0)) c.close();
});

async function ready(): Promise<TestClient> {
  const client = await TestClient.open(`ws://127.0.0.1:${app.port}/sync`);
  clients.push(client);
  expect((await client.hello()).type).toBe('welcome');
  return client;
}

const api = (path: string, init: { method?: string; body?: unknown } = {}) =>
  fetch(`http://127.0.0.1:${app.port}/api/v1${path}`, {
    method: init.method ?? 'GET',
    headers: init.body === undefined ? {} : { 'content-type': 'application/json' },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });

function startMsg(sessionId: string, extra: Record<string, unknown> = {}): Msg {
  return {
    type: 'op',
    op_id: uuidv7(),
    stream: `session:${sessionId}`,
    kind: 'session.start',
    at: T0,
    clock_uncertain: false,
    data: {
      session_id: sessionId,
      module_id: moduleId,
      calendar_event_id: null,
      slide_deck_id: null,
      started_from: 'ipad',
      started_at: T0,
      ...extra,
    },
  };
}

const isUpdated = (id: string, state?: string) => (m: Msg) =>
  m.type === 'event' &&
  m.name === 'session.updated' &&
  (m.data as { id: string; state: string }).id === id &&
  (state === undefined || (m.data as { state: string }).state === state);

describe('Session-Handler im Sync-Server', () => {
  it('sind mit preLock registriert (Zustandswechsel), Daten-Operationen ohne', () => {
    for (const kind of ['session.start', 'session.pause', 'session.resume', 'session.stop'] as const) {
      expect(getOpRegistration(kind)?.preLock).toBeTypeOf('function');
    }
    for (const kind of ['slide.change', 'marker.add', 'marker.remove'] as const) {
      expect(getOpRegistration(kind)).toBeDefined();
      expect(getOpRegistration(kind)?.preLock).toBeUndefined();
    }
  });

  it('session.start vom Gerät legt die Session an, ack, anderes Gerät erhält session.updated', async () => {
    const watcher = await ready();
    const device = await ready();
    const id = uuidv7();
    device.send(startMsg(id));
    const ack = await device.next((m) => m.type === 'ack');
    expect(ack).toMatchObject({ stream: `session:${id}`, seq: 1 });
    const [row] = await app.handle.db.select().from(session).where(eq(session.id, id));
    expect(row).toMatchObject({ state: 'laeuft', startedFrom: 'ipad' });
    const event = await watcher.next(isUpdated(id, 'laeuft'));
    expect((event.data as { started_from: string }).started_from).toBe('ipad');
  });

  it('session_superseded: Fehler mit details.session_id, Verbindung wird mit 4409 geschlossen', async () => {
    const eventId = uuidv7();
    await app.handle.db.insert(calendarEvent).values({
      id: eventId,
      userId: SINGLE_USER_ID,
      moduleId,
      kind: 'vorlesung',
      title: 'VL',
      startsAt: new Date(T0 - 3_600_000),
      endsAt: new Date(T0 + 3_600_000),
    });
    const existing = uuidv7();
    await app.handle.db.insert(session).values({
      id: existing,
      userId: SINGLE_USER_ID,
      moduleId,
      calendarEventId: eventId,
      state: 'laeuft',
      startedAt: new Date(T0 - 60_000),
      startedFrom: 'mac',
    });
    const device = await ready();
    device.send(startMsg(uuidv7(), { calendar_event_id: eventId }));
    const error = await device.next((m) => m.type === 'error');
    expect(error).toMatchObject({
      code: 'session_superseded',
      retryable: false,
      fatal: true,
      details: { session_id: existing },
    });
    expect(await device.closed()).toBe(4409);
  });

  it('REST-Zustandswechsel liefern keine 500er und gehen als session.updated an alle Clients', async () => {
    const watcher = await ready();
    const created = await api('/sessions', { method: 'POST', body: { module_id: moduleId } });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    for (const [path, state, body] of [
      ['start', 'laeuft', { started_from: 'mac' }],
      ['pause', 'pausiert', undefined],
      ['resume', 'laeuft', undefined],
      ['stop', 'verarbeitet', undefined],
    ] as const) {
      const res = await api(`/sessions/${id}/${path}`, { method: 'POST', body });
      expect(res.status, path).toBe(200);
      await watcher.next(isUpdated(id, state));
    }
  });

  it('Meldung des Workers auf sg_session ergibt session.updated mit dem aktuellen Stand', async () => {
    const id = uuidv7();
    await app.handle.db.insert(session).values({
      id,
      userId: SINGLE_USER_ID,
      moduleId,
      state: 'beendet',
      startedAt: new Date(T0 - 60_000),
      endedAt: new Date(T0),
      stopReason: 'manuell',
    });
    const watcher = await ready();
    await app.handle
      .sql`UPDATE session SET state = 'verarbeitet', processing = '{"audio.finalize":"fertig"}'::jsonb, updated_at = now() WHERE id = ${id}`;
    await app.handle.sql`SELECT pg_notify('sg_session', ${id})`;
    const event = await watcher.next(isUpdated(id, 'verarbeitet'));
    expect((event.data as { processing: unknown }).processing).toEqual({ 'audio.finalize': 'fertig' });

    // Ungültige Nutzlast und unbekannte ID: nichts, kein Absturz
    await app.handle.sql`SELECT pg_notify('sg_session', 'kein-uuid')`;
    await app.handle.sql`SELECT pg_notify('sg_session', ${uuidv7()})`;
    await app.handle.sql`SELECT pg_notify('sg_session', ${id})`;
    await watcher.next(isUpdated(id, 'verarbeitet'));
  });
});
