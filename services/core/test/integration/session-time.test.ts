// Sitzungszeit nach Serveruhr (VERTRAEGE §9.3, #332): Snapshot, GET /photos/{id} und GET /pages/{id}/strokes liefern
// zu den Rohwerten den Geräteversatz aus `session.start_offsets` mit. Die Operationen laufen wie im Dispatcher:
// Vorab-Sperre, `appendOp` mit `device_id`, dann der Handler.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  PageStrokesSchema,
  PhotoSchema,
  SessionSnapshotSchema,
  SINGLE_USER_ID,
  type Stroke,
  type SyncOp,
  type SyncOrigin,
} from '@sg/shared';
import { notebook, session } from '../../src/db/schema/index.ts';
import { uuidv7 } from '../../src/lib/uuid7.ts';
import { appendOp } from '../../src/sync/append.ts';
import { getOpRegistration } from '../../src/sync/handlers.ts';
import { startTestApp, type TestApp } from './helpers.ts';
import { loadStrokeFixtures, makeOp, nbStream, pageCreateData, seedModule } from './ink-helpers.ts';

const API = '/api/v1';
/** iPad A: offline gestartet, 2 min nach dem Mac */
const IPAD_OFFLINE = '0190f6a2-0000-7000-8000-0000000000a1';
/** iPad B: online, folgt der laufenden Session, kein Eintrag in start_offsets */
const IPAD_ONLINE = '0190f6a2-0000-7000-8000-0000000000b2';
/** iPad C: offline gestartet, 1 min vor dem Mac (negativer Versatz) */
const IPAD_EARLY = '0190f6a2-0000-7000-8000-0000000000c3';
const STARTED = Date.UTC(2026, 10, 4, 9, 0);
const MIN = 60_000;

let t: TestApp;
let moduleId = '';

beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => {
  await truncate();
  await t.close();
});
beforeEach(async () => {
  await truncate();
  moduleId = (await seedModule(t.handle.db)).moduleId;
});

async function truncate() {
  await t.handle.sql`TRUNCATE semester, module, notebook, session, photo, sync_stream, sync_op CASCADE`;
}

/** Wie der Dispatcher (connection.ts): Vorab-Sperre, appendOp mit Gerät, Handler – in einer Transaktion */
async function dispatch(op: SyncOp, deviceId: string | null, origin: SyncOrigin = 'ipad'): Promise<void> {
  const registration = getOpRegistration(op.kind);
  if (!registration) throw new Error(`Kein Handler für ${op.kind}`);
  await t.handle.db.transaction(async (tx) => {
    if (registration.preLock) await registration.preLock(tx, op);
    await appendOp(tx, op.stream, {
      kind: op.kind,
      data: op.data,
      at: op.at,
      clockUncertain: op.clock_uncertain,
      origin,
      opId: op.op_id,
      deviceId,
    });
    await registration.handler(tx, op, { deviceId, origin });
  });
}

const get = (url: string) => t.request({ method: 'GET', url: `${API}${url}` });

async function runningSession(): Promise<string> {
  const id = uuidv7();
  await t.handle.db.insert(session).values({
    id,
    userId: SINGLE_USER_ID,
    moduleId,
    state: 'laeuft',
    startedAt: new Date(STARTED),
    startedFrom: 'mac',
  } as typeof session.$inferInsert);
  return id;
}

/** `session.start` eines Geräts mit eigenem `started_at` (Minuten relativ zum Start des Mac) */
const startOp = (sessionId: string, deltaMin: number) =>
  makeOp(
    'session.start',
    `session:${sessionId}`,
    {
      session_id: sessionId,
      module_id: moduleId,
      calendar_event_id: null,
      slide_deck_id: null,
      started_from: 'ipad',
      started_at: STARTED + deltaMin * MIN,
    },
    { at: STARTED + deltaMin * MIN },
  );

const markerOp = (sessionId: string, markerId: string, tMs: number, source: 'ipad' | 'mac' = 'ipad') =>
  makeOp('marker.add', `session:${sessionId}`, {
    marker_id: markerId,
    session_id: sessionId,
    kind: 'frage',
    t_ms: tMs,
    page_id: null,
    position: null,
    note: null,
    source,
  });

const photoOp = (sessionId: string, photoId: string, tMs: number) =>
  makeOp('photo.add', `session:${sessionId}`, {
    photo_id: photoId,
    session_id: sessionId,
    t_ms: tMs,
    page_id: null,
    file_ref: { sha256: 'a'.repeat(64), mime: 'image/jpeg', size_bytes: 10 },
  });

const template = loadStrokeFixtures()[0]!.strokes[0]!;
const stroke = (tStartMs: number | null): Stroke => ({
  ...template,
  client_id: uuidv7(),
  t_start_ms: tStartMs,
  t_end_ms: tStartMs === null ? null : tStartMs + 250,
});

async function notebookWithPage(sessionId: string | null): Promise<{ stream: string; pageId: string }> {
  const nbId = uuidv7();
  await t.handle.db
    .insert(notebook)
    .values({ id: nbId, userId: SINGLE_USER_ID, moduleId, title: 'Vorlesung' });
  const stream = nbStream(nbId);
  const data = pageCreateData(nbId, { session_id: sessionId });
  await dispatch(makeOp('page.create', stream, data), IPAD_OFFLINE);
  return { stream, pageId: data.page_id };
}

describe('Sitzungszeit nach Serveruhr (§9.3)', () => {
  it('Snapshot: t_session_ms je Marker und Foto, nur das offline gestartete Gerät ist versetzt; Rohwerte bleiben', async () => {
    const id = await runningSession();
    await dispatch(startOp(id, 2), IPAD_OFFLINE); // offset +2 min
    await dispatch(startOp(id, -1), IPAD_EARLY); // offset −1 min
    const [mOffline, mOnline, mWeb, mEarly, pOffline, pOnline] = Array.from({ length: 6 }, () => uuidv7());
    await dispatch(markerOp(id, mOffline!, 60_000), IPAD_OFFLINE);
    await dispatch(markerOp(id, mOffline!, 60_000), IPAD_ONLINE); // spätere Wiederholung eines anderen Geräts zählt nicht
    await dispatch(markerOp(id, mOnline!, 100_000), IPAD_ONLINE);
    await dispatch(markerOp(id, mWeb!, 110_000, 'mac'), null, 'web');
    await dispatch(markerOp(id, mEarly!, 30_000), IPAD_EARLY);
    await dispatch(photoOp(id, pOffline!, 90_000), IPAD_OFFLINE);
    await dispatch(photoOp(id, pOnline!, 95_000), IPAD_ONLINE);

    const res = await get(`/sessions/${id}/snapshot`);
    expect(res.statusCode, res.body).toBe(200);
    const snap = SessionSnapshotSchema.parse(res.json());
    expect(snap.session.start_offsets).toEqual([
      { device_id: IPAD_OFFLINE, offset_ms: 2 * MIN },
      { device_id: IPAD_EARLY, offset_ms: -MIN },
    ]);
    const markers = Object.fromEntries(snap.markers.map((m) => [m.id, [m.t_ms, m.t_session_ms]]));
    expect(markers).toEqual({
      [mOffline!]: [60_000, 180_000],
      [mOnline!]: [100_000, 100_000],
      [mWeb!]: [110_000, 110_000],
      [mEarly!]: [30_000, 0], // 30 s − 1 min, auf 0 geklemmt
    });
    // Sortierung bleibt nach Rohwert t_ms (§7.2)
    expect(snap.markers.map((m) => m.t_ms)).toEqual([30_000, 60_000, 100_000, 110_000]);
    const photos = Object.fromEntries(snap.photos.map((p) => [p.id, [p.t_ms, p.t_session_ms]]));
    expect(photos).toEqual({ [pOffline!]: [90_000, 210_000], [pOnline!]: [95_000, 95_000] });

    const photo = PhotoSchema.parse((await get(`/photos/${pOffline}`)).json());
    expect(photo).toMatchObject({ t_ms: 90_000, t_session_ms: 210_000 });
    expect(PhotoSchema.parse((await get(`/photos/${pOnline}`)).json()).t_session_ms).toBe(95_000);
  });

  it('Striche: stroke_offsets_ms nur für Striche des offline gestarteten Geräts, Rohwerte bleiben', async () => {
    const id = await runningSession();
    await dispatch(startOp(id, 2), IPAD_OFFLINE);
    const { stream, pageId } = await notebookWithPage(id);
    const offline = stroke(30_000);
    const online = stroke(40_000);
    const untimed = stroke(null);
    await dispatch(makeOp('stroke.add', stream, { page_id: pageId, stroke: offline }), IPAD_OFFLINE);
    await dispatch(makeOp('stroke.add', stream, { page_id: pageId, stroke: online }), IPAD_ONLINE);
    await dispatch(makeOp('stroke.add', stream, { page_id: pageId, stroke: untimed }), IPAD_OFFLINE);

    const res = await get(`/pages/${pageId}/strokes`);
    expect(res.statusCode, res.body).toBe(200);
    const body = PageStrokesSchema.parse(res.json());
    expect(body.stroke_offsets_ms).toEqual({ [offline.client_id]: 2 * MIN });
    const raw = Object.fromEntries(body.strokes.map((s) => [s.client_id, s.t_start_ms]));
    expect(raw).toEqual({
      [offline.client_id]: 30_000,
      [online.client_id]: 40_000,
      [untimed.client_id]: null,
    });

    // Upsert desselben Strichs durch das online gestartete Gerät: die letzte stroke.add zählt
    await dispatch(makeOp('stroke.add', stream, { page_id: pageId, stroke: offline }), IPAD_ONLINE);
    expect(PageStrokesSchema.parse((await get(`/pages/${pageId}/strokes`)).json()).stroke_offsets_ms).toEqual(
      {},
    );
  });

  it('ohne Eintrag in start_offsets oder ohne Session der Seite: kein Versatz', async () => {
    const id = await runningSession();
    const markerId = uuidv7();
    await dispatch(markerOp(id, markerId, 5_000), IPAD_ONLINE);
    const snap = SessionSnapshotSchema.parse((await get(`/sessions/${id}/snapshot`)).json());
    expect(snap.markers[0]).toMatchObject({ t_ms: 5_000, t_session_ms: 5_000 });

    const strokesOf = async (sessionId: string | null) => {
      const { stream, pageId } = await notebookWithPage(sessionId);
      await dispatch(makeOp('stroke.add', stream, { page_id: pageId, stroke: stroke(1_000) }), IPAD_OFFLINE);
      return PageStrokesSchema.parse((await get(`/pages/${pageId}/strokes`)).json());
    };
    expect((await strokesOf(id)).stroke_offsets_ms).toEqual({});
    // Mit Versatz in der Session, aber die Seite gehört zu keiner Session: Rohwert gilt
    await dispatch(startOp(id, 2), IPAD_OFFLINE);
    expect((await strokesOf(null)).stroke_offsets_ms).toEqual({});
  });
});
