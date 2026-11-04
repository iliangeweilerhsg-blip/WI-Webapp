// Sessions (T1-02): Zustandsautomat, Offline-Fälle, Takt und Auto-Stopp, Sessions aus dem Kalender, Op-Handler, REST.
// Die Handler laufen direkt als `handler(tx, op, ctx)` in einer Transaktion. `publishAfterCommit` (T1-08) ist durch
// `setSessionEventPublisher` ersetzt und sammelt die Ereignisse.
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  SINGLE_USER_ID,
  SessionListSchema,
  SessionSchema,
  SessionSnapshotSchema,
  SyncOpSchema,
  type Session,
  type SessionState,
  type SyncEvent,
  type SyncOp,
  type SyncOrigin,
} from '@sg/shared';
import { createDb, type DbHandle } from '../../src/db/client.ts';
import {
  audioChunk,
  calendarEvent,
  courseModule,
  job,
  marker,
  recording,
  semester,
  session,
  setting,
  slideDeck,
  slideEvent,
  syncOp,
} from '../../src/db/schema/index.ts';
import { HttpError } from '../../src/errors.ts';
import { uuidv7 } from '../../src/lib/uuid7.ts';
import { SyncOpError } from '../../src/sync/handlers.ts';
import { SESSION_HANDLERS } from '../../src/sync/handlers/session.ts';
import {
  ensurePlannedSessions,
  runSessionTick,
  setSessionEventPublisher,
  startSessionTicker,
  transitionSession,
  type SessionAction,
  type TransitionInput,
} from '../../src/services/sessions.ts';
import { startTestApp, testConfig, testDatabaseUrl, type TestApp } from './helpers.ts';

let handle: DbHandle;
const base = { userId: SINGLE_USER_ID };
const config = { dataDir: '/tmp/sg-sessions-test' };
const API = '/api/v1';
const DEVICE = '0190f6a2-0000-7000-8000-0000000000d1';
const DEVICE_2 = '0190f6a2-0000-7000-8000-0000000000d2';

let events: SyncEvent[] = [];
let moduleId = '';

/** Minuten nach 2026-11-04 09:00 UTC */
const T = (min: number): Date => new Date(Date.UTC(2026, 10, 4, 9, 0) + min * 60_000);

beforeAll(() => {
  handle = createDb(testDatabaseUrl());
  setSessionEventPublisher(async (_tx, event) => {
    events.push(event);
  });
});
afterAll(async () => {
  setSessionEventPublisher(null);
  await truncate();
  await handle.close();
});
beforeEach(async () => {
  await truncate();
  events = [];
  const semesterId = uuidv7();
  moduleId = uuidv7();
  await handle.db.insert(semester).values({ id: semesterId, ...base, name: 'HS 2026' });
  await handle.db
    .insert(courseModule)
    .values({ id: moduleId, ...base, semesterId, name: 'Datenbanken', color: 'mod-01' });
});

async function truncate() {
  await handle.sql`TRUNCATE semester, module, calendar_source, calendar_event, session, slide_deck, job,
    sync_op, sync_stream, setting, recording CASCADE`;
}

// --- Hilfen ----------------------------------------------------------------------------------

type SessionInsert = typeof session.$inferInsert;

async function mkSession(over: Partial<SessionInsert> = {}): Promise<string> {
  const id = uuidv7();
  await handle.db.insert(session).values({ id, ...base, moduleId, state: 'bereit', ...over });
  return id;
}

async function mkEvent(
  startMin: number,
  endMin: number,
  over: Partial<typeof calendarEvent.$inferInsert> = {},
): Promise<string> {
  const id = uuidv7();
  await handle.db.insert(calendarEvent).values({
    id,
    ...base,
    moduleId,
    kind: 'vorlesung',
    title: 'Datenbanken',
    startsAt: T(startMin),
    endsAt: T(endMin),
    ...over,
  });
  return id;
}

async function row(id: string) {
  const [found] = await handle.db.select().from(session).where(eq(session.id, id));
  if (!found) throw new Error(`Session ${id} fehlt`);
  return found;
}

/** Operationen eines Stroms, als `SyncOp` geprüft */
async function opsOf(sessionId: string): Promise<(SyncOp & { origin: SyncOrigin })[]> {
  const rows = await handle.db
    .select()
    .from(syncOp)
    .where(eq(syncOp.stream, `session:${sessionId}`))
    .orderBy(asc(syncOp.seq));
  return rows.map(
    (r) =>
      SyncOpSchema.parse({
        type: 'op',
        op_id: r.opId,
        stream: r.stream,
        kind: r.kind,
        at: r.at,
        clock_uncertain: r.clockUncertain,
        data: r.data,
        seq: r.seq,
        origin: r.origin,
      }) as SyncOp & { origin: SyncOrigin },
  );
}

const transition = (
  id: string,
  action: SessionAction,
  input: Partial<TransitionInput> & { at: Date },
): ReturnType<typeof transitionSession> =>
  handle.db.transaction((tx) => transitionSession(tx, id, action, { origin: 'server', ...input }));

async function errorOf(promise: Promise<unknown>): Promise<HttpError> {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(HttpError);
  return error as HttpError;
}

const updatedEventFor = (id: string) =>
  events.filter((e) => e.name === 'session.updated' && e.data.id === id).map((e) => e.data as Session);

/** Operation eines Geräts wie vom Dispatcher übergeben, vorher gegen das Schema geprüft */
function clientOp(
  kind: SyncOp['kind'],
  sessionId: string,
  data: Record<string, unknown>,
  at: number,
): SyncOp {
  return SyncOpSchema.parse({
    type: 'op',
    op_id: uuidv7(),
    stream: `session:${sessionId}`,
    kind,
    at,
    clock_uncertain: false,
    data,
  });
}

const runHandler = (op: SyncOp, deviceId: string | null = DEVICE, origin: SyncOrigin = 'ipad') =>
  handle.db.transaction((tx) => SESSION_HANDLERS[op.kind]!(tx, op, { deviceId, origin }));

const startOp = (sessionId: string, atMin: number, over: Record<string, unknown> = {}) =>
  clientOp(
    'session.start',
    sessionId,
    {
      session_id: sessionId,
      module_id: moduleId,
      calendar_event_id: null,
      slide_deck_id: null,
      started_from: 'ipad',
      started_at: T(atMin).getTime(),
      ...over,
    },
    T(atMin).getTime(),
  );

// --- Zustandsautomat ---------------------------------------------------------------------------------

describe('Zustandsautomat (§9.1)', () => {
  it('geplant/bereit → laeuft: started_at, started_from, Server-Operation und Ereignis', async () => {
    for (const state of ['geplant', 'bereit'] as const) {
      await handle.sql`TRUNCATE session, sync_op, sync_stream CASCADE`;
      events = [];
      const id = await mkSession({ state });
      const { session: s, endedSession } = await transition(id, 'start', { at: T(0), startedFrom: 'mac' });
      expect(endedSession).toBeNull();
      expect(s).toMatchObject({ state: 'laeuft', started_at: '2026-11-04T09:00:00Z', started_from: 'mac' });
      expect(SessionSchema.parse(s)).toBeTruthy();
      const [op] = await opsOf(id);
      expect(op).toMatchObject({ kind: 'session.start', origin: 'server', at: T(0).getTime() });
      expect(updatedEventFor(id).at(-1)?.state).toBe('laeuft');
    }
  });

  it('laeuft → pausiert → laeuft → beendet; ohne Aufnahme folgt sofort verarbeitet', async () => {
    const id = await mkSession();
    await transition(id, 'start', { at: T(0), startedFrom: 'mac' });
    expect((await transition(id, 'pause', { at: T(10) })).session.state).toBe('pausiert');
    expect((await transition(id, 'resume', { at: T(12) })).session.state).toBe('laeuft');
    const stopped = (await transition(id, 'stop', { at: T(60) })).session;
    expect(stopped).toMatchObject({
      state: 'verarbeitet',
      ended_at: '2026-11-04T10:00:00Z',
      stop_reason: 'manuell',
    });
    expect((await opsOf(id)).map((o) => [o.kind, o.origin])).toEqual([
      ['session.start', 'server'],
      ['session.pause', 'server'],
      ['session.resume', 'server'],
      ['session.stop', 'server'],
    ]);
  });

  it('Stopp aus pausiert; Grund aus der Anfrage; ended_at nie vor started_at', async () => {
    const id = await mkSession();
    await transition(id, 'start', { at: T(0), startedFrom: 'mac' });
    await transition(id, 'pause', { at: T(5) });
    const stopped = (await transition(id, 'stop', { at: T(-5), reason: 'stille' })).session;
    expect(stopped).toMatchObject({ stop_reason: 'stille', ended_at: '2026-11-04T09:00:00Z' });
  });

  it('Stopp mit Aufnahmen legt je Aufnahme einen audio.finalize-Job an und bleibt beendet', async () => {
    const id = await mkSession();
    const done = uuidv7();
    const open = uuidv7();
    for (const [rid, completedAt] of [
      [done, T(1)],
      [open, null],
    ] as const) {
      await handle.db.insert(recording).values({
        id: rid,
        ...base,
        sessionId: id,
        mime: 'audio/webm',
        codec: 'opus',
        startedMs: 0,
        completedAt,
      });
    }
    await transition(id, 'start', { at: T(0), startedFrom: 'mac' });
    const before = Date.now();
    expect((await transition(id, 'stop', { at: T(30) })).session.state).toBe('beendet');
    const jobs = await handle.db.select().from(job).where(eq(job.sessionId, id));
    expect(jobs).toHaveLength(2);
    const byRecording = new Map(jobs.map((j) => [(j.payload as { recording_id: string }).recording_id, j]));
    expect(byRecording.get(done)).toMatchObject({ type: 'audio.finalize', runAfter: null });
    const delayed = byRecording.get(open)!.runAfter!.getTime();
    expect(delayed - before).toBeGreaterThanOrEqual(10 * 60_000 - 1000);
    expect(delayed - before).toBeLessThan(10 * 60_000 + 10_000);
  });

  // Zustand × Aktion: change = Übergang, noop = gleicher Zielzustand, invalid = 409
  const matrix: [SessionState, SessionAction, 'change' | 'noop' | 'invalid'][] = [
    ['geplant', 'start', 'change'],
    ['geplant', 'pause', 'invalid'],
    ['geplant', 'resume', 'invalid'],
    ['geplant', 'stop', 'invalid'],
    ['bereit', 'start', 'change'],
    ['bereit', 'pause', 'invalid'],
    ['bereit', 'resume', 'invalid'],
    ['bereit', 'stop', 'invalid'],
    ['verpasst', 'pause', 'invalid'],
    ['verpasst', 'resume', 'invalid'],
    ['verpasst', 'stop', 'invalid'],
    ['laeuft', 'start', 'noop'],
    ['laeuft', 'pause', 'change'],
    ['laeuft', 'resume', 'noop'],
    ['laeuft', 'stop', 'change'],
    ['pausiert', 'start', 'noop'],
    ['pausiert', 'pause', 'noop'],
    ['pausiert', 'resume', 'change'],
    ['pausiert', 'stop', 'change'],
    ['beendet', 'start', 'invalid'],
    ['beendet', 'pause', 'invalid'],
    ['beendet', 'resume', 'invalid'],
    ['beendet', 'stop', 'noop'],
    ['verarbeitet', 'start', 'invalid'],
    ['verarbeitet', 'pause', 'invalid'],
    ['verarbeitet', 'resume', 'invalid'],
    ['verarbeitet', 'stop', 'noop'],
  ];
  it.each(matrix)('%s + %s → %s', async (state, action, expected) => {
    const started = ['laeuft', 'pausiert', 'beendet', 'verarbeitet'].includes(state);
    const ended = state === 'beendet' || state === 'verarbeitet';
    const id = await mkSession({
      state,
      ...(started ? { startedAt: T(-60), startedFrom: 'mac' } : {}),
      ...(ended ? { endedAt: T(-30), stopReason: 'manuell' } : {}),
    });
    const input = { at: T(0), startedFrom: 'mac' as const };
    if (expected === 'invalid') {
      const error = await errorOf(transition(id, action, input));
      expect(error).toMatchObject({
        statusCode: 409,
        code: 'session_transition_invalid',
        details: { state, action },
      });
      expect((await row(id)).state).toBe(state);
      return;
    }
    const before = await row(id);
    const result = await transition(id, action, input);
    if (expected === 'noop') {
      expect(await opsOf(id)).toHaveLength(0);
      expect(events).toHaveLength(0);
      const after = await row(id);
      expect(after.state).toBe(state);
      expect(after.updatedAt).toEqual(before.updatedAt);
      expect(after.endedAt).toEqual(before.endedAt);
      expect(after.startedAt).toEqual(before.startedAt);
    } else {
      expect(result.session.state).not.toBe(state);
      expect(await opsOf(id)).toHaveLength(1);
      expect(updatedEventFor(id)).toHaveLength(1);
    }
  });

  it('verpasst: Start nur mit started_at vor dem Terminende (auch REST nach dem Ende ist ungültig)', async () => {
    const eventId = await mkEvent(0, 90);
    const late = await mkSession({ state: 'verpasst', calendarEventId: eventId });
    const error = await errorOf(transition(late, 'start', { at: T(90), startedFrom: 'mac' }));
    expect(error).toMatchObject({ code: 'session_transition_invalid', details: { state: 'verpasst' } });

    const ok = await transition(late, 'start', {
      at: T(89),
      origin: 'ipad',
      deviceId: DEVICE,
      startedFrom: 'ipad',
    });
    expect(ok.session).toMatchObject({
      state: 'laeuft',
      started_at: T(89).toISOString().replace('.000Z', 'Z'),
    });
    // Client-Operation legt der Dispatcher ab: keine Server-Operation für den Übergang selbst
    expect(await opsOf(late)).toHaveLength(0);
  });

  it('Start beendet die früher gestartete aktive Session am Kalenderende, spätestens jetzt', async () => {
    const eventId = await mkEvent(-60, 30);
    const first = await mkSession({ state: 'laeuft', startedAt: T(-60), calendarEventId: eventId });
    const second = await mkSession();
    const result = await transition(second, 'start', { at: T(45), startedFrom: 'mac' });
    expect(result.session.state).toBe('laeuft');
    expect(result.endedSession).toMatchObject({
      id: first,
      state: 'verarbeitet',
      stop_reason: 'kalenderende',
      ended_at: '2026-11-04T09:30:00Z',
    });
    expect(await opsOf(first)).toMatchObject([
      { kind: 'session.stop', origin: 'server', data: { reason: 'kalenderende' } },
    ]);
    expect(updatedEventFor(first).at(-1)?.state).toBe('verarbeitet');

    // Spontane Session hat kein Kalenderende: ended_at = Beginn der neuen
    const third = await mkSession();
    const again = await transition(third, 'start', { at: T(50), startedFrom: 'mac' });
    expect(again.endedSession).toMatchObject({ id: second, ended_at: '2026-11-04T09:50:00Z' });
  });

  it('Nachgelieferter Start beendet nie eine später gestartete Session (§9.2)', async () => {
    const active = await mkSession({ state: 'laeuft', startedAt: T(30), startedFrom: 'mac' });
    const late = await mkSession();
    const result = await transition(late, 'start', {
      at: T(10),
      origin: 'ipad',
      deviceId: DEVICE,
      startedFrom: 'ipad',
    });
    expect(result.endedSession).toBeNull();
    expect(result.session).toMatchObject({
      id: late,
      state: 'verarbeitet',
      stop_reason: 'kalenderende',
      started_at: '2026-11-04T09:10:00Z',
      ended_at: '2026-11-04T09:30:00Z',
    });
    expect((await row(active)).state).toBe('laeuft');
    // Start kommt vom Gerät (Dispatcher), der Stopp als Server-Operation
    expect(await opsOf(late)).toMatchObject([{ kind: 'session.stop', origin: 'server' }]);
  });

  it('Zwei gleichzeitige Starts: genau eine aktive Session, kein Unique-Fehler', async () => {
    for (let round = 0; round < 3; round += 1) {
      await handle.sql`TRUNCATE session, sync_op, sync_stream CASCADE`;
      const a = await mkSession();
      const b = await mkSession();
      const results = await Promise.all([
        transition(a, 'start', { at: T(0), startedFrom: 'mac' }),
        transition(b, 'start', { at: T(1), startedFrom: 'mac' }),
      ]);
      expect(results).toHaveLength(2);
      const active = (await handle.db.select().from(session)).filter((s) =>
        ['laeuft', 'pausiert'].includes(s.state),
      );
      // In jeder Reihenfolge: B (später gestartet) läuft, A ist beendet und endet bei B
      expect(active.map((s) => s.id)).toEqual([b]);
      expect(await row(a)).toMatchObject({ state: 'verarbeitet', stopReason: 'kalenderende', endedAt: T(1) });
    }
  });

  it('Gleichzeitige Starts mit gleichem started_at: ebenfalls nur eine aktive Session', async () => {
    const a = await mkSession();
    const b = await mkSession();
    await Promise.all([
      transition(a, 'start', { at: T(0), startedFrom: 'mac' }),
      transition(b, 'start', { at: T(0), startedFrom: 'ipad' }),
    ]);
    const active = (await handle.db.select().from(session)).filter((s) =>
      ['laeuft', 'pausiert'].includes(s.state),
    );
    expect(active).toHaveLength(1);
  });

  it('Weich gelöschte Session: start/pause/resume/stop werden bestätigt, nichts ändert sich', async () => {
    const id = await mkSession({ state: 'bereit', deletedAt: T(-5) });
    for (const action of ['start', 'pause', 'resume', 'stop'] as const) {
      const result = await transition(id, action, { at: T(0), startedFrom: 'mac' });
      expect(result.session).toMatchObject({ state: 'bereit', deleted_at: '2026-11-04T08:55:00Z' });
    }
    expect(await opsOf(id)).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it('Unbekannte Session: pause/stop → 404, start ohne Modul → 404', async () => {
    for (const action of ['pause', 'resume', 'stop', 'start'] as const) {
      const error = await errorOf(transition(uuidv7(), action, { at: T(0) }));
      expect(error).toMatchObject({ statusCode: 404, code: 'session_not_found' });
    }
  });
});

// --- Offline-Fälle (§9.2, §9.3) ----------------------------------------------------------------------

describe('Offline-Start und Ersetzen', () => {
  it('unbekannte ID ohne Termin: spontane Session wird angelegt und gestartet', async () => {
    const id = uuidv7();
    const result = await transition(id, 'start', {
      at: T(5),
      origin: 'ipad',
      deviceId: DEVICE,
      startedFrom: 'ipad',
      moduleId,
    });
    expect(result.session).toMatchObject({
      id,
      module_id: moduleId,
      calendar_event_id: null,
      state: 'laeuft',
      started_from: 'ipad',
      number: null,
    });
  });

  it('unbekanntes Modul → 404 module_not_found, nichts angelegt', async () => {
    const id = uuidv7();
    const error = await errorOf(
      transition(id, 'start', { at: T(0), origin: 'ipad', startedFrom: 'ipad', moduleId: uuidv7() }),
    );
    expect(error).toMatchObject({ code: 'module_not_found' });
    expect(await handle.db.select().from(session).where(eq(session.id, id))).toHaveLength(0);
  });

  it('ersetzt eine nie gestartete Session desselben Termins: deck, number und Foliensätze gehen über', async () => {
    const eventId = await mkEvent(0, 90);
    const deckId = uuidv7();
    const planned = await mkSession({ state: 'verpasst', calendarEventId: eventId, number: 3 });
    await handle.db.insert(slideDeck).values({
      id: deckId,
      ...base,
      moduleId,
      sessionId: planned,
      title: 'VL 3',
      filePath: 'p',
      sha256: 'a'.repeat(64),
    });
    await handle.db.update(session).set({ slideDeckId: deckId }).where(eq(session.id, planned));

    const id = uuidv7();
    const result = await transition(id, 'start', {
      at: T(10),
      origin: 'ipad',
      deviceId: DEVICE,
      startedFrom: 'ipad',
      moduleId,
      calendarEventId: eventId,
    });
    expect(result.session).toMatchObject({
      id,
      state: 'laeuft',
      calendar_event_id: eventId,
      number: 3,
      slide_deck_id: deckId,
      planned_starts_at: '2026-11-04T09:00:00Z',
      planned_ends_at: '2026-11-04T10:30:00Z',
    });
    expect((await row(planned)).deletedAt).not.toBeNull();
    const [deck] = await handle.db.select().from(slideDeck).where(eq(slideDeck.id, deckId));
    expect(deck!.sessionId).toBe(id);
    expect(updatedEventFor(planned).at(-1)?.deleted_at).not.toBeNull();
  });

  it('eigenes slide_deck_id der neuen Session hat Vorrang vor dem der ersetzten', async () => {
    const eventId = await mkEvent(0, 90);
    const oldDeck = uuidv7();
    const newDeck = uuidv7();
    for (const [d, hash] of [
      [oldDeck, 'a'],
      [newDeck, 'b'],
    ] as const) {
      await handle.db
        .insert(slideDeck)
        .values({ id: d, ...base, moduleId, title: 'x', filePath: 'p', sha256: hash.repeat(64) });
    }
    await mkSession({ state: 'bereit', calendarEventId: eventId, slideDeckId: oldDeck });
    const id = uuidv7();
    const result = await transition(id, 'start', {
      at: T(5),
      origin: 'ipad',
      startedFrom: 'ipad',
      moduleId,
      calendarEventId: eventId,
      slideDeckId: newDeck,
    });
    expect(result.session.slide_deck_id).toBe(newDeck);
  });

  it.each([
    ['laeuft', { startedAt: T(0) }],
    ['pausiert', { startedAt: T(0) }],
    ['beendet', { startedAt: T(0), endedAt: T(10), stopReason: 'manuell' as const }],
    ['verarbeitet', { startedAt: T(0), endedAt: T(10), stopReason: 'manuell' as const }],
  ] as const)(
    'Termin hat schon eine Session in %s → session_superseded mit der bestehenden ID',
    async (state, extra) => {
      const eventId = await mkEvent(0, 90);
      const existing = await mkSession({ state, calendarEventId: eventId, ...extra });
      const id = uuidv7();
      const error = await errorOf(
        transition(id, 'start', {
          at: T(5),
          origin: 'ipad',
          startedFrom: 'ipad',
          moduleId,
          calendarEventId: eventId,
        }),
      );
      expect(error).toMatchObject({
        statusCode: 409,
        code: 'session_superseded',
        details: { session_id: existing },
      });
      expect(await handle.db.select().from(session).where(eq(session.id, id))).toHaveLength(0);
    },
  );

  it('Handler: session_superseded wird zum nicht wiederholbaren SyncOpError mit details.session_id', async () => {
    const eventId = await mkEvent(0, 90);
    const existing = await mkSession({ state: 'laeuft', startedAt: T(0), calendarEventId: eventId });
    const id = uuidv7();
    const error = await runHandler(startOp(id, 5, { calendar_event_id: eventId })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SyncOpError);
    expect(error).toMatchObject({
      code: 'session_superseded',
      retryable: false,
      details: { session_id: existing },
    });
  });

  it('Termin der Session wurde gelöscht oder ist unbekannt: Session ist spontan (kein FK-Fehler)', async () => {
    const id = uuidv7();
    await runHandler(startOp(id, 0, { calendar_event_id: uuidv7() }));
    expect(await row(id)).toMatchObject({ calendarEventId: null, state: 'laeuft' });
  });

  it('Modul weich gelöscht: Session wird mit deleted_at des Moduls angelegt, bleibt unverändert (bereit) und beendet nichts', async () => {
    const active = await mkSession({ state: 'laeuft', startedAt: T(-10) });
    await handle.db
      .update(courseModule)
      .set({ deletedAt: T(-3) })
      .where(eq(courseModule.id, moduleId));
    const id = uuidv7();
    await runHandler(startOp(id, 0));
    expect(await row(id)).toMatchObject({ deletedAt: T(-3), state: 'bereit', startedAt: null });
    expect((await row(active)).state).toBe('laeuft');
  });

  it('VL-Nummer bei neuer Session zum Vorlesungstermin: Position unter den Terminen des Moduls', async () => {
    await mkEvent(-200, -150);
    await mkEvent(-100, -50, { cancelled: true });
    const eventId = await mkEvent(0, 90);
    const id = uuidv7();
    const result = await transition(id, 'start', {
      at: T(1),
      origin: 'ipad',
      startedFrom: 'ipad',
      moduleId,
      calendarEventId: eventId,
    });
    expect(result.session.number).toBe(2);
  });
});

describe('Abweichender Offline-Start (§9.3)', () => {
  it('start auf laeuft: bestätigt, started_at des Servers bleibt, Eintrag in start_offsets (erster gilt dauerhaft)', async () => {
    const id = await mkSession({ state: 'laeuft', startedAt: T(0), startedFrom: 'mac' });
    await runHandler(startOp(id, 2));
    await runHandler(startOp(id, 7)); // gleiches Gerät noch einmal: der erste Eintrag bleibt
    await runHandler(startOp(id, -1), DEVICE_2);
    const after = await row(id);
    expect(after.startedAt).toEqual(T(0));
    expect(after.startOffsets).toEqual([
      { device_id: DEVICE, offset_ms: 2 * 60_000 },
      { device_id: DEVICE_2, offset_ms: -60_000 },
    ]);
    expect(updatedEventFor(id).at(-1)?.start_offsets).toHaveLength(2);
  });

  it('gleiches started_at oder kein Gerät (Web/REST): kein Eintrag', async () => {
    const id = await mkSession({ state: 'pausiert', startedAt: T(0), startedFrom: 'mac' });
    await runHandler(startOp(id, 0));
    await runHandler(startOp(id, 3), null, 'web');
    expect((await row(id)).startOffsets).toEqual([]);
  });

  it('start auf beendet/verarbeitet bleibt session_transition_invalid', async () => {
    const id = await mkSession({ state: 'beendet', startedAt: T(0), endedAt: T(5), stopReason: 'manuell' });
    const error = await runHandler(startOp(id, 2)).catch((e: unknown) => e);
    expect(error).toMatchObject({
      code: 'session_transition_invalid',
      retryable: false,
      details: { state: 'beendet', action: 'start' },
    });
  });
});

// --- Takt und Auto-Stopp (§9.4) -------------------------------------------------------------------------------

describe('Core-Takt', () => {
  it('geplant → bereit 15 min vor dem Beginn → verpasst nach dem Ende; Ereignis je Wechsel', async () => {
    const eventId = await mkEvent(60, 150);
    const id = await mkSession({ state: 'geplant', calendarEventId: eventId });
    const tick = (min: number) => runSessionTick(handle.db, config, T(min));

    await tick(44);
    expect((await row(id)).state).toBe('geplant');
    await tick(45);
    expect((await row(id)).state).toBe('bereit');
    await tick(100);
    expect((await row(id)).state).toBe('bereit');
    await tick(150);
    expect((await row(id)).state).toBe('verpasst');
    expect(updatedEventFor(id).map((s) => s.state)).toEqual(['bereit', 'verpasst']);
    expect(await opsOf(id)).toHaveLength(0); // bereit und verpasst haben keine Operation
  });

  it('geplant springt über bereit direkt auf verpasst; spontane und gestartete Sessions bleiben', async () => {
    const eventId = await mkEvent(0, 60);
    const missed = await mkSession({ state: 'geplant', calendarEventId: eventId });
    const spontaneous = await mkSession({ state: 'bereit' });
    const started = await mkSession({
      state: 'laeuft',
      startedAt: T(0),
      calendarEventId: await mkEvent(0, 60),
    });
    await runSessionTick(handle.db, config, T(500));
    expect((await row(missed)).state).toBe('verpasst');
    expect((await row(spontaneous)).state).toBe('bereit');
    // laeuft + Terminende + 30 min überschritten → wird vom Auto-Stopp erfasst, nicht von verpasst
    expect((await row(started)).state).toBe('verarbeitet');
  });

  describe('Auto-Stopp-Rückfallebene', () => {
    const limits = (over: Record<string, number> = {}) =>
      handle.db.insert(setting).values({
        key: 'lecture',
        ...base,
        value: over,
      });

    it('Regel 2: Terminende + 30 min; ended_at ist die Grenze, nicht die Zeit des Takts', async () => {
      const eventId = await mkEvent(0, 60);
      const id = await mkSession({ state: 'laeuft', startedAt: T(0), calendarEventId: eventId });
      await runSessionTick(handle.db, config, new Date(T(90).getTime() - 1));
      expect((await row(id)).state).toBe('laeuft');

      await runSessionTick(handle.db, config, T(97));
      expect(await row(id)).toMatchObject({
        state: 'verarbeitet',
        stopReason: 'kalenderende',
        endedAt: T(90),
      });
      expect(await opsOf(id)).toMatchObject([
        { kind: 'session.stop', origin: 'server', at: T(90).getTime(), data: { reason: 'kalenderende' } },
      ]);
    });

    it('Regel 4: Maximaldauer ab started_at; spontane Sessions kennen nur Regel 4', async () => {
      const id = await mkSession({ state: 'laeuft', startedAt: T(0) });
      await runSessionTick(handle.db, config, T(239));
      expect((await row(id)).state).toBe('laeuft');
      await runSessionTick(handle.db, config, T(241));
      expect(await row(id)).toMatchObject({ stopReason: 'maximaldauer', endedAt: T(240) });
    });

    it('Regel 4 aus pausiert', async () => {
      const id = await mkSession({ state: 'pausiert', startedAt: T(0) });
      await runSessionTick(handle.db, config, T(240));
      expect(await row(id)).toMatchObject({ stopReason: 'maximaldauer', endedAt: T(240) });
    });

    it('beide Regeln überschritten: die zuerst erreichte gilt', async () => {
      const eventId = await mkEvent(0, 300); // Hardlimit T(330), Maximaldauer T(240)
      const id = await mkSession({ state: 'laeuft', startedAt: T(0), calendarEventId: eventId });
      await runSessionTick(handle.db, config, T(500));
      expect(await row(id)).toMatchObject({ stopReason: 'maximaldauer', endedAt: T(240) });
    });

    it('Einstellungen aus lecture.* gelten (z. B. Hardlimit 5 min)', async () => {
      await limits({ auto_stop_hard_after_end_min: 5 });
      const eventId = await mkEvent(0, 60);
      const id = await mkSession({ state: 'laeuft', startedAt: T(0), calendarEventId: eventId });
      await runSessionTick(handle.db, config, T(65));
      expect(await row(id)).toMatchObject({ stopReason: 'kalenderende', endedAt: T(65) });
    });

    it('Verlängerung: vor auto_stop_extended_until stoppt keine Regel, danach gilt die Grenze = extended_until', async () => {
      const eventId = await mkEvent(0, 60);
      const id = await mkSession({
        state: 'laeuft',
        startedAt: T(0),
        calendarEventId: eventId,
        autoStopExtendedUntil: T(100),
      });
      await runSessionTick(handle.db, config, T(95));
      expect((await row(id)).state).toBe('laeuft');
      await runSessionTick(handle.db, config, T(104));
      expect(await row(id)).toMatchObject({ stopReason: 'kalenderende', endedAt: T(100) });
    });

    it('Core-Start: überschrittene Grenze → absturz_wiederhergestellt, ended_at = letzte Aktivität', async () => {
      const id = await mkSession({ state: 'laeuft', startedAt: T(0), calendarEventId: await mkEvent(0, 60) });
      const rec = uuidv7();
      await handle.db.insert(recording).values({
        id: rec,
        ...base,
        sessionId: id,
        mime: 'audio/webm',
        codec: 'opus',
        startedMs: 0,
      });
      await handle.db.insert(audioChunk).values({
        id: uuidv7(),
        ...base,
        recordingId: rec,
        seq: 0,
        startMs: 0,
        durationMs: 40 * 60_000,
        filePath: 'x',
        sha256: 'c'.repeat(64),
        sizeBytes: 10,
      });
      // Eine Operation später als das Chunk-Ende: Sie zählt als letzte Aktivität
      await handle.sql`INSERT INTO sync_stream (stream, head_seq) VALUES (${`session:${id}`}, 1)`;
      await handle.db.insert(syncOp).values({
        stream: `session:${id}`,
        seq: 1,
        opId: uuidv7(),
        kind: 'slide.change',
        at: T(50).getTime(),
        clockUncertain: false,
        data: {},
        origin: 'ipad',
      });
      await runSessionTick(handle.db, config, T(500), { startup: true });
      expect(await row(id)).toMatchObject({
        stopReason: 'absturz_wiederhergestellt',
        endedAt: T(50),
        state: 'beendet', // Aufnahme vorhanden → audio.finalize-Job
      });
      expect(await handle.db.select().from(job).where(eq(job.sessionId, id))).toHaveLength(1);
    });

    it('Core-Start ohne Aktivität: ended_at = started_at; Grenze nicht überschritten: läuft weiter (F-SES-05)', async () => {
      const crashed = await mkSession({ state: 'laeuft', startedAt: T(0) });
      await runSessionTick(handle.db, config, T(300), { startup: true });
      expect(await row(crashed)).toMatchObject({ stopReason: 'absturz_wiederhergestellt', endedAt: T(0) });

      const alive = await mkSession({ state: 'laeuft', startedAt: T(290) });
      await runSessionTick(handle.db, config, T(300), { startup: true });
      expect((await row(alive)).state).toBe('laeuft');
    });

    it('nachgelieferter Stopp eines Geräts mit früherem at korrigiert den Stopp des Takts (ohne Zustandswechsel)', async () => {
      const eventId = await mkEvent(0, 60);
      const id = await mkSession({ state: 'laeuft', startedAt: T(0), calendarEventId: eventId });
      await runSessionTick(handle.db, config, T(95));
      expect((await row(id)).endedAt).toEqual(T(90));
      events = [];

      // Späterer at ändert nichts
      await runHandler(clientOp('session.stop', id, { session_id: id }, T(92).getTime()));
      expect(await row(id)).toMatchObject({ endedAt: T(90), stopReason: 'kalenderende' });
      expect(events).toHaveLength(0);

      // Früherer at korrigiert ended_at und stop_reason
      await runHandler(clientOp('session.stop', id, { session_id: id, reason: 'stille' }, T(58).getTime()));
      expect(await row(id)).toMatchObject({ endedAt: T(58), stopReason: 'stille', state: 'verarbeitet' });
      expect(updatedEventFor(id)).toHaveLength(1);
      // Danach ist der Grund nicht mehr korrigierbar
      await runHandler(clientOp('session.stop', id, { session_id: id }, T(30).getTime()));
      expect((await row(id)).endedAt).toEqual(T(58));
    });

    it('Korrektur durch Stopp nach absturz_wiederhergestellt; manueller Stopp wird nie korrigiert', async () => {
      const crashed = await mkSession({ state: 'laeuft', startedAt: T(0) });
      await runSessionTick(handle.db, config, T(300), { startup: true });
      await runHandler(clientOp('session.stop', crashed, { session_id: crashed }, T(0).getTime() - 1));
      expect(await row(crashed)).toMatchObject({ stopReason: 'manuell', endedAt: T(0) }); // nicht vor started_at

      const manual = await mkSession({ state: 'laeuft', startedAt: T(0) });
      await transition(manual, 'stop', { at: T(30) });
      await runHandler(clientOp('session.stop', manual, { session_id: manual }, T(10).getTime()));
      expect((await row(manual)).endedAt).toEqual(T(30));
    });
  });

  it('Ticker: führt beim Start einmal mit Absturz-Erkennung aus, danach im Intervall; stop beendet ihn', async () => {
    const crashed = await mkSession({ state: 'laeuft', startedAt: T(0) });
    let clock = T(300);
    const errors: unknown[] = [];
    const ticker = startSessionTicker({
      db: handle.db,
      config,
      onError: (e) => errors.push(e),
      intervalMs: 20,
      now: () => clock,
    });
    await ticker.runOnce();
    expect((await row(crashed)).stopReason).toBe('absturz_wiederhergestellt');

    const eventId = await mkEvent(400, 460);
    const planned = await mkSession({ state: 'geplant', calendarEventId: eventId });
    clock = T(390);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect((await row(planned)).state).toBe('bereit');
    await ticker.stop();
    clock = T(470);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect((await row(planned)).state).toBe('bereit');
    expect(errors).toEqual([]);
  });
});

// --- Sessions aus dem Kalender ---------------------------------------------------------------------------------

describe('ensurePlannedSessions (§9.2)', () => {
  const ensure = (ids: string[]) => handle.db.transaction((tx) => ensurePlannedSessions(tx, ids));
  const sessionsOf = (eventId: string) =>
    handle.db.select().from(session).where(eq(session.calendarEventId, eventId));

  it('legt für Vorlesung, Übung, Tutorium mit Modul eine Session an; sonst nicht; idempotent', async () => {
    const future = [
      await mkEvent(1000, 1090, { kind: 'vorlesung' }),
      await mkEvent(1100, 1190, { kind: 'uebung' }),
      await mkEvent(1200, 1290, { kind: 'tutorium' }),
    ];
    const none = [
      await mkEvent(1300, 1390, { kind: 'pruefung' }),
      await mkEvent(1400, 1490, { kind: 'fest' }),
      await mkEvent(1500, 1590, { moduleId: null }),
      await mkEvent(1600, 1690, { cancelled: true }),
    ];
    await ensure([...future, ...none]);
    await ensure([...future, ...none, ...future]);
    for (const id of future) {
      const found = await sessionsOf(id);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ state: 'geplant', moduleId, startedAt: null });
    }
    for (const id of none) expect(await sessionsOf(id)).toHaveLength(0);
    expect((await sessionsOf(future[1]!))[0]!.number).toBeNull();
  });

  it('Zustand folgt der Zeit: bereit kurz vor dem Beginn, verpasst für Vergangenes', async () => {
    const now = Date.now();
    const soon = await handle.db
      .insert(calendarEvent)
      .values({
        id: uuidv7(),
        ...base,
        moduleId,
        kind: 'vorlesung',
        title: 'x',
        startsAt: new Date(now + 5 * 60_000),
        endsAt: new Date(now + 95 * 60_000),
      })
      .returning({ id: calendarEvent.id });
    const past = await mkEvent(0, 90);
    await ensure([soon[0]!.id, past]);
    expect((await sessionsOf(soon[0]!.id))[0]!.state).toBe('bereit');
    expect((await sessionsOf(past))[0]!.state).toBe('verpasst');
  });

  it('Termin bekommt anderes Modul / wird abgesagt / verliert das Modul: nie gestartete Session folgt bzw. wird gelöscht', async () => {
    const other = uuidv7();
    const [sem] = await handle.db.select().from(semester);
    await handle.db
      .insert(courseModule)
      .values({ id: other, ...base, semesterId: sem!.id, name: 'Statistik', color: 'mod-02' });
    const eventId = await mkEvent(1000, 1090);
    await ensure([eventId]);
    await handle.db.update(calendarEvent).set({ moduleId: other }).where(eq(calendarEvent.id, eventId));
    await ensure([eventId]);
    expect((await sessionsOf(eventId))[0]!.moduleId).toBe(other);

    await handle.db.update(calendarEvent).set({ cancelled: true }).where(eq(calendarEvent.id, eventId));
    await ensure([eventId]);
    expect((await sessionsOf(eventId))[0]!.deletedAt).not.toBeNull();

    // Abgesagt → wieder angesetzt: neue Session möglich (Unique-Index nur über nicht gelöschte)
    await handle.db.update(calendarEvent).set({ cancelled: false }).where(eq(calendarEvent.id, eventId));
    await ensure([eventId]);
    expect((await sessionsOf(eventId)).filter((s) => !s.deletedAt)).toHaveLength(1);

    await handle.db.update(calendarEvent).set({ moduleId: null }).where(eq(calendarEvent.id, eventId));
    await ensure([eventId]);
    expect((await sessionsOf(eventId)).filter((s) => !s.deletedAt)).toHaveLength(0);
  });

  it('gestartete Sessions bleiben bei Absage und Moduländerung unverändert', async () => {
    const eventId = await mkEvent(0, 90);
    const id = await mkSession({
      state: 'laeuft',
      startedAt: T(0),
      calendarEventId: eventId,
      number: 4,
    });
    await handle.db
      .update(calendarEvent)
      .set({ cancelled: true, moduleId: null })
      .where(eq(calendarEvent.id, eventId));
    await ensure([eventId]);
    expect(await row(id)).toMatchObject({ deletedAt: null, state: 'laeuft', number: 4, moduleId });
  });

  it('VL-Nummern: Position in zeitlicher Reihenfolge, neu gerechnet bei neuen Terminen; gestartete bleiben fest', async () => {
    const e2 = await mkEvent(2000, 2090);
    const e3 = await mkEvent(3000, 3090);
    await ensure([e2, e3]);
    expect((await sessionsOf(e2))[0]!.number).toBe(1);
    expect((await sessionsOf(e3))[0]!.number).toBe(2);

    const e1 = await mkEvent(1000, 1090);
    await ensure([e1]);
    expect((await sessionsOf(e1))[0]!.number).toBe(1);
    expect((await sessionsOf(e2))[0]!.number).toBe(2);
    expect((await sessionsOf(e3))[0]!.number).toBe(3);

    // e2 wurde gestartet: seine Nummer bleibt, e3 rückt nach einer Absage von e1 trotzdem nach
    await handle.db
      .update(session)
      .set({ state: 'laeuft', startedAt: T(2000) })
      .where(eq(session.calendarEventId, e2));
    await handle.db.update(calendarEvent).set({ cancelled: true }).where(eq(calendarEvent.id, e1));
    await ensure([e1]);
    expect((await sessionsOf(e2))[0]!.number).toBe(2);
    expect((await sessionsOf(e3))[0]!.number).toBe(2);
    // Übung zählt nicht mit
    const u = await mkEvent(500, 590, { kind: 'uebung' });
    await ensure([u]);
    expect((await sessionsOf(u))[0]!.number).toBeNull();
    expect((await sessionsOf(e3))[0]!.number).toBe(2);
  });

  it('Termin ohne Treffer (unbekannte ID) wird ignoriert', async () => {
    await expect(ensure([uuidv7()])).resolves.toBeUndefined();
    await expect(ensure([])).resolves.toBeUndefined();
  });
});

// --- Op-Handler ------------------------------------------------------------------------------------------------------------

describe('Op-Handler', () => {
  it('session.start/pause/resume/stop übernehmen started_at bzw. at der Operation', async () => {
    const id = await mkSession();
    await runHandler(startOp(id, 3));
    await runHandler(clientOp('session.pause', id, { session_id: id }, T(10).getTime()));
    expect((await row(id)).state).toBe('pausiert');
    await runHandler(clientOp('session.resume', id, { session_id: id }, T(12).getTime()));
    await runHandler(clientOp('session.stop', id, { session_id: id, reason: 'manuell' }, T(40).getTime()));
    expect(await row(id)).toMatchObject({
      state: 'verarbeitet',
      startedAt: T(3),
      startedFrom: 'ipad',
      endedAt: T(40),
      stopReason: 'manuell',
    });
    // Gerät schreibt die eigene Operation selbst über den Dispatcher: der Handler legt keine an
    expect(await opsOf(id)).toHaveLength(0);
  });

  it('Start eines anderen Geräts beendet die aktive Session mit einer Server-Operation im Strom der alten', async () => {
    const first = await mkSession({ state: 'laeuft', startedAt: T(0), startedFrom: 'mac' });
    const second = uuidv7();
    await runHandler(startOp(second, 20));
    expect(await row(first)).toMatchObject({ stopReason: 'kalenderende', endedAt: T(20) });
    expect(await opsOf(first)).toMatchObject([{ kind: 'session.stop', origin: 'server' }]);
  });

  it('Fehler: Zustand ungültig, Session unbekannt, falscher Strom', async () => {
    const id = await mkSession({ state: 'bereit' });
    const invalid = await runHandler(clientOp('session.pause', id, { session_id: id }, T(1).getTime())).catch(
      (e: unknown) => e,
    );
    expect(invalid).toMatchObject({
      code: 'session_transition_invalid',
      retryable: false,
      details: { state: 'bereit', action: 'pause' },
    });

    const unknown = uuidv7();
    const missing = await runHandler(
      clientOp('session.stop', unknown, { session_id: unknown }, T(1).getTime()),
    ).catch((e: unknown) => e);
    expect(missing).toMatchObject({ code: 'session_not_found', retryable: false });

    const wrongStream = {
      ...clientOp('session.pause', id, { session_id: id }, 1),
      stream: `session:${unknown}`,
    } as SyncOp;
    expect(await runHandler(wrongStream).catch((e: unknown) => e)).toMatchObject({ code: 'stream_mismatch' });
  });

  it('Der Handler ignoriert fremde Operationsarten', async () => {
    const id = await mkSession();
    const op = clientOp('session.pause', id, { session_id: id }, 1);
    await expect(
      handle.db.transaction((tx) =>
        SESSION_HANDLERS['session.stop']!(tx, op, { deviceId: null, origin: 'ipad' }),
      ),
    ).resolves.toBeUndefined();
  });

  describe('slide.change und marker.*', () => {
    const slide = (sessionId: string, tMs = 1000, eventId = uuidv7()) =>
      clientOp(
        'slide.change',
        sessionId,
        {
          event_id: eventId,
          session_id: sessionId,
          slide_id: null,
          slide_index: 2,
          t_ms: tMs,
          device: 'ipad',
        },
        T(1).getTime(),
      );
    const markerAdd = (sessionId: string, markerId = uuidv7()) =>
      clientOp(
        'marker.add',
        sessionId,
        {
          marker_id: markerId,
          session_id: sessionId,
          kind: 'frage',
          t_ms: 500,
          page_id: null,
          position: { x: 1, y: 2 },
          note: 'Wieso?',
          source: 'mac',
        },
        T(1).getTime(),
      );

    it.each(['geplant', 'bereit', 'verpasst', 'laeuft', 'pausiert', 'beendet', 'verarbeitet'] as const)(
      'werden im Zustand %s angenommen',
      async (state) => {
        const id = await mkSession({ state });
        await runHandler(slide(id));
        await runHandler(markerAdd(id));
        expect(await handle.db.select().from(slideEvent).where(eq(slideEvent.sessionId, id))).toHaveLength(1);
        expect(await handle.db.select().from(marker).where(eq(marker.sessionId, id))).toHaveLength(1);
      },
    );

    it('slide.change: Felder, source aus dem Gerät, idempotent über event_id', async () => {
      const id = await mkSession();
      const op = slide(id, 1234);
      await runHandler(op);
      await runHandler(op);
      await runHandler(
        clientOp(
          'slide.change',
          id,
          { event_id: uuidv7(), session_id: id, slide_id: null, slide_index: 3, t_ms: 5, device: 'mac' },
          1,
        ),
      );
      const rows = await handle.db.select().from(slideEvent).orderBy(asc(slideEvent.tMs));
      expect(rows.map((r) => [r.slideIndex, r.tMs, r.device, r.source])).toEqual([
        [3, 5, 'mac', 'manuell_mac'],
        [2, 1234, 'ipad', 'manuell_ipad'],
      ]);
    });

    it('marker.add: Felder, idempotent; marker.remove: weich, unbekannt und doppelt werden bestätigt', async () => {
      const id = await mkSession();
      const markerId = uuidv7();
      await runHandler(markerAdd(id, markerId));
      await runHandler(markerAdd(id, markerId));
      const [m] = await handle.db.select().from(marker);
      expect(m).toMatchObject({
        id: markerId,
        sessionId: id,
        kind: 'frage',
        tMs: 500,
        source: 'mac',
        note: 'Wieso?',
        position: { x: 1, y: 2 },
        deletedAt: null,
      });
      const remove = (mid: string) => clientOp('marker.remove', id, { marker_id: mid }, T(2).getTime());
      await runHandler(remove(markerId));
      const [removed] = await handle.db.select().from(marker);
      expect(removed!.deletedAt).not.toBeNull();
      await runHandler(remove(markerId));
      await runHandler(remove(uuidv7()));
      expect((await handle.db.select().from(marker))[0]!.deletedAt).toEqual(removed!.deletedAt);
    });

    it('marker.remove im Strom einer anderen Session → stream_mismatch', async () => {
      const a = await mkSession();
      const b = await mkSession();
      const markerId = uuidv7();
      await runHandler(markerAdd(a, markerId));
      const error = await runHandler(clientOp('marker.remove', b, { marker_id: markerId }, 1)).catch(
        (e: unknown) => e,
      );
      expect(error).toMatchObject({ code: 'stream_mismatch' });
    });

    it('weich gelöschte Session: Daten werden mit deren deleted_at gespeichert', async () => {
      const id = await mkSession({ deletedAt: T(-1) });
      await runHandler(slide(id));
      await runHandler(markerAdd(id));
      const [s] = await handle.db.select().from(slideEvent);
      const [m] = await handle.db.select().from(marker);
      expect(s!.deletedAt).toEqual(T(-1));
      expect(m!.deletedAt).toEqual(T(-1));
    });

    it('unbekannte Session → session_not_found; falscher Strom → stream_mismatch', async () => {
      const unknown = uuidv7();
      expect(await runHandler(slide(unknown)).catch((e: unknown) => e)).toMatchObject({
        code: 'session_not_found',
        retryable: false,
      });
      expect(await runHandler(markerAdd(unknown)).catch((e: unknown) => e)).toMatchObject({
        code: 'session_not_found',
      });
      const id = await mkSession();
      const wrong = { ...slide(id), stream: `session:${unknown}` } as SyncOp;
      expect(await runHandler(wrong).catch((e: unknown) => e)).toMatchObject({ code: 'stream_mismatch' });
    });
  });
});

// --- REST ----------------------------------------------------------------------------------------------------------------------

describe('REST (§7.2)', () => {
  let t: TestApp;
  let clock = T(0);

  beforeAll(async () => {
    t = await startTestApp({}, { now: () => clock });
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(() => {
    clock = T(0);
  });

  const call = async <B = unknown>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: unknown,
  ) => {
    const res = await t.request({
      method,
      url: `${API}${url}`,
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });
    return { status: res.statusCode, body: (res.body ? JSON.parse(res.body) : null) as B };
  };

  it('POST /sessions legt eine spontane Session in bereit an; 409 session_exists; 404 module_not_found', async () => {
    const id = uuidv7();
    const created = await call<Session>('POST', '/sessions', { id, module_id: moduleId, title: 'Spontan' });
    expect(created.status).toBe(201);
    expect(SessionSchema.parse(created.body)).toMatchObject({
      id,
      state: 'bereit',
      title: 'Spontan',
      calendar_event_id: null,
      planned_starts_at: null,
      planned_ends_at: null,
      processing: {},
      start_offsets: [],
    });
    expect((await call('POST', '/sessions', { id, module_id: moduleId })).status).toBe(409);
    expect(
      (await call<{ error: { code: string } }>('POST', '/sessions', { module_id: uuidv7() })).body.error.code,
    ).toBe('module_not_found');
    expect((await call('POST', '/sessions', {})).status).toBe(400);
  });

  it('Start, Pause, Fortsetzen, Stopp über REST mit Serverzeit; start liefert ended_session', async () => {
    const first = (await call<Session>('POST', '/sessions', { module_id: moduleId })).body.id;
    const second = (await call<Session>('POST', '/sessions', { module_id: moduleId })).body.id;

    clock = T(0);
    const start = await call<{ session: Session; ended_session: Session | null }>(
      'POST',
      `/sessions/${first}/start`,
      { started_from: 'mac' },
    );
    expect(start.status).toBe(200);
    expect(start.body).toMatchObject({
      session: { state: 'laeuft', started_at: '2026-11-04T09:00:00Z', started_from: 'mac' },
      ended_session: null,
    });
    clock = T(5);
    expect((await call<Session>('POST', `/sessions/${first}/pause`)).body.state).toBe('pausiert');
    clock = T(6);
    expect((await call<Session>('POST', `/sessions/${first}/resume`)).body.state).toBe('laeuft');

    clock = T(20);
    const swap = await call<{ session: Session; ended_session: Session }>(
      'POST',
      `/sessions/${second}/start`,
      { started_from: 'mac' },
    );
    expect(swap.body.session.id).toBe(second);
    expect(swap.body.ended_session).toMatchObject({
      id: first,
      stop_reason: 'kalenderende',
      ended_at: '2026-11-04T09:20:00Z',
    });

    clock = T(50);
    const stop = await call<Session>('POST', `/sessions/${second}/stop`, { reason: 'stille' });
    expect(stop.body).toMatchObject({
      state: 'verarbeitet',
      stop_reason: 'stille',
      ended_at: '2026-11-04T09:50:00Z',
    });
    // Stopp ohne Body = manuell
    const third = (await call<Session>('POST', '/sessions', { module_id: moduleId })).body.id;
    await call('POST', `/sessions/${third}/start`, { started_from: 'mac' });
    expect((await call<Session>('POST', `/sessions/${third}/stop`)).body.stop_reason).toBe('manuell');
  });

  it('Fehler: 404, 409 session_transition_invalid mit details, absturz_wiederhergestellt abgelehnt, ungültige Bodies', async () => {
    const id = (await call<Session>('POST', '/sessions', { module_id: moduleId })).body.id;
    type Err = { error: { code: string; details?: Record<string, unknown> } };
    const missing = uuidv7();
    for (const action of ['start', 'pause', 'resume', 'stop', 'extend']) {
      const res = await call<Err>(
        'POST',
        `/sessions/${missing}/${action}`,
        action === 'start' ? { started_from: 'mac' } : undefined,
      );
      expect([res.status, res.body.error.code]).toEqual([404, 'session_not_found']);
    }
    const invalid = await call<Err>('POST', `/sessions/${id}/pause`);
    expect(invalid).toMatchObject({
      status: 409,
      body: { error: { code: 'session_transition_invalid', details: { state: 'bereit', action: 'pause' } } },
    });
    expect((await call('POST', `/sessions/${id}/start`, {})).status).toBe(400);
    expect((await call('POST', `/sessions/${id}/start`, { started_from: 'pc' })).status).toBe(400);
    expect((await call('POST', `/sessions/${id}/stop`, { reason: 'absturz_wiederhergestellt' })).status).toBe(
      400,
    );
    expect((await call('POST', `/sessions/${id}/stop`, { reason: 'unsinn' })).status).toBe(400);
    expect((await call('GET', '/sessions/kein-uuid')).status).toBe(400);
    expect((await call('GET', `/sessions/${missing}`)).status).toBe(404);
  });

  it('REST auf eine weich gelöschte Session → 404', async () => {
    const id = await mkSession({ deletedAt: T(-1) });
    for (const action of ['start', 'pause', 'resume', 'stop', 'extend']) {
      const res = await call(
        'POST',
        `/sessions/${id}/${action}`,
        action === 'start' ? { started_from: 'mac' } : undefined,
      );
      expect(res.status).toBe(404);
    }
  });

  it('Start mit Foliensatz: gesetzt, andere Module und unbekannte Sätze werden abgelehnt', async () => {
    const deck = uuidv7();
    await handle.db
      .insert(slideDeck)
      .values({ id: deck, ...base, moduleId, title: 'D', filePath: 'p', sha256: 'd'.repeat(64) });
    const id = (await call<Session>('POST', '/sessions', { module_id: moduleId })).body.id;
    const bad = await call<{ error: { code: string } }>('POST', `/sessions/${id}/start`, {
      started_from: 'mac',
      slide_deck_id: uuidv7(),
    });
    expect([bad.status, bad.body.error.code]).toEqual([404, 'slide_deck_not_found']);
    expect((await row(id)).state).toBe('bereit');
    const ok = await call<{ session: Session }>('POST', `/sessions/${id}/start`, {
      started_from: 'mac',
      slide_deck_id: deck,
    });
    expect(ok.body.session.slide_deck_id).toBe(deck);
    const [d] = await handle.db.select().from(slideDeck).where(eq(slideDeck.id, deck));
    expect(d!.sessionId).toBe(id);
  });

  it('PATCH ändert Titel und Foliensatz; DELETE: 409 session_active bei laufender, sonst 204 und danach 404', async () => {
    const id = (await call<Session>('POST', '/sessions', { module_id: moduleId })).body.id;
    const patched = await call<Session>('PATCH', `/sessions/${id}`, { title: 'Neu' });
    expect(patched.body.title).toBe('Neu');
    expect((await call('PATCH', `/sessions/${uuidv7()}`, { title: 'x' })).status).toBe(404);

    await call('POST', `/sessions/${id}/start`, { started_from: 'mac' });
    const blocked = await call<{ error: { code: string; details: { session_ids: string[] } } }>(
      'DELETE',
      `/sessions/${id}`,
    );
    expect([blocked.status, blocked.body.error.code, blocked.body.error.details.session_ids]).toEqual([
      409,
      'session_active',
      [id],
    ]);
    await call('POST', `/sessions/${id}/pause`);
    expect((await call('DELETE', `/sessions/${id}`)).status).toBe(409);
    await call('POST', `/sessions/${id}/stop`);
    events = [];
    expect((await call('DELETE', `/sessions/${id}`)).status).toBe(204);
    expect((await call('GET', `/sessions/${id}`)).status).toBe(404);
    expect((await call('DELETE', `/sessions/${id}`)).status).toBe(404);
    expect(updatedEventFor(id).at(-1)?.deleted_at).not.toBeNull();
  });

  it('POST /extend: max(jetzt, bisher) + minutes, Standard aus den Einstellungen, nur aktive Sessions', async () => {
    const id = (await call<Session>('POST', '/sessions', { module_id: moduleId })).body.id;
    expect((await call<{ error: { code: string } }>('POST', `/sessions/${id}/extend`)).body.error.code).toBe(
      'session_not_active',
    );
    await call('POST', `/sessions/${id}/start`, { started_from: 'mac' });

    clock = T(100);
    const first = await call<Session>('POST', `/sessions/${id}/extend`);
    expect(first.body.auto_stop_extended_until).toBe('2026-11-04T10:55:00Z'); // 100 + 15 (Standard)
    clock = T(101);
    const second = await call<Session>('POST', `/sessions/${id}/extend`, { minutes: 30 });
    expect(second.body.auto_stop_extended_until).toBe('2026-11-04T11:25:00Z'); // max(101, 115) + 30
    clock = T(300);
    const third = await call<Session>('POST', `/sessions/${id}/extend`, { minutes: 5 });
    expect(third.body.auto_stop_extended_until).toBe('2026-11-04T14:05:00Z'); // max(300, 145) + 5
    expect((await call('POST', `/sessions/${id}/extend`, { minutes: 0 })).status).toBe(400);
    expect((await call('POST', `/sessions/${id}/extend`, { minutes: 121 })).status).toBe(400);
    expect(updatedEventFor(id).at(-1)?.auto_stop_extended_until).toBe('2026-11-04T14:05:00Z');
    await call('POST', `/sessions/${id}/stop`);
    expect((await call('POST', `/sessions/${id}/extend`)).status).toBe(409);
  });

  it('GET /sessions: Sortierung, Filter (module_id, state-Liste, from/to), Cursor, 400 bei ungültigem state', async () => {
    const [sem] = await handle.db.select().from(semester);
    const other = uuidv7();
    await handle.db
      .insert(courseModule)
      .values({ id: other, ...base, semesterId: sem!.id, name: 'X', color: 'mod-03' });
    const eventLate = await mkEvent(600, 690);
    const a = await mkSession({ state: 'beendet', startedAt: T(10), endedAt: T(20) });
    const b = await mkSession({ state: 'geplant', calendarEventId: eventLate });
    const c = await mkSession({ state: 'laeuft', startedAt: T(30) });
    const d = await mkSession({ state: 'bereit', createdAt: T(40), moduleId: other });
    await mkSession({ state: 'bereit', deletedAt: T(0) });

    const all = await call<{ items: Session[]; next_cursor: string | null }>('GET', '/sessions');
    SessionListSchema.parse(all.body);
    expect(all.body.items.map((s) => s.id)).toEqual([a, c, d, b]);

    const mod = await call<{ items: Session[] }>('GET', `/sessions?module_id=${other}`);
    expect(mod.body.items.map((s) => s.id)).toEqual([d]);

    const states = await call<{ items: Session[] }>('GET', '/sessions?state=laeuft,pausiert');
    expect(states.body.items.map((s) => s.id)).toEqual([c]);
    const two = await call<{ items: Session[] }>('GET', '/sessions?state=beendet,geplant');
    expect(two.body.items.map((s) => s.id)).toEqual([a, b]);

    const from = encodeURIComponent(T(20).toISOString());
    const to = encodeURIComponent(T(100).toISOString());
    const window = await call<{ items: Session[] }>('GET', `/sessions?from=${from}&to=${to}`);
    expect(window.body.items.map((s) => s.id)).toEqual([c, d]);

    const page1 = await call<{ items: Session[]; next_cursor: string }>('GET', '/sessions?limit=3');
    expect(page1.body.items.map((s) => s.id)).toEqual([a, c, d]);
    const page2 = await call<{ items: Session[]; next_cursor: string | null }>(
      'GET',
      `/sessions?limit=3&cursor=${page1.body.next_cursor}`,
    );
    expect(page2.body.items.map((s) => s.id)).toEqual([b]);
    expect(page2.body.next_cursor).toBeNull();

    expect((await call('GET', '/sessions?state=laeuft,quatsch')).status).toBe(400);
    expect((await call('GET', '/sessions?from=gestern')).status).toBe(400);
    expect((await call('GET', '/sessions?cursor=kaputt')).status).toBe(400);
  });

  it('GET /sessions/{id}/snapshot: Daten ohne gelöschte Objekte, sortiert, stream_seq und stream_op_id passen', async () => {
    const id = (await call<Session>('POST', '/sessions', { module_id: moduleId })).body.id;
    const empty = await call<unknown>('GET', `/sessions/${id}/snapshot`);
    expect(SessionSnapshotSchema.parse(empty.body)).toMatchObject({
      stream_seq: 0,
      stream_op_id: null,
      markers: [],
    });

    clock = T(0);
    await call('POST', `/sessions/${id}/start`, { started_from: 'mac' });
    clock = T(1);
    await call('POST', `/sessions/${id}/pause`);

    const keep = uuidv7();
    const gone = uuidv7();
    const sd = (tMs: number) => ({
      event_id: uuidv7(),
      session_id: id,
      slide_id: null,
      slide_index: 1,
      t_ms: tMs,
      device: 'mac',
    });
    await runHandler(clientOp('slide.change', id, sd(900), 1), null, 'web');
    await runHandler(clientOp('slide.change', id, sd(100), 1), null, 'web');
    for (const [mid, tMs] of [
      [keep, 50],
      [gone, 10],
    ] as const) {
      await runHandler(
        clientOp(
          'marker.add',
          id,
          {
            marker_id: mid,
            session_id: id,
            kind: 'klausur',
            t_ms: tMs,
            page_id: null,
            position: null,
            note: null,
            source: 'mac',
          },
          1,
        ),
        null,
        'web',
      );
    }
    await runHandler(clientOp('marker.remove', id, { marker_id: gone }, 2), null, 'web');
    await handle.db
      .insert(recording)
      .values({ id: uuidv7(), ...base, sessionId: id, mime: 'audio/webm', codec: 'opus', startedMs: 0 });

    const res = await call<unknown>('GET', `/sessions/${id}/snapshot`);
    const snap = SessionSnapshotSchema.parse(res.body);
    expect(snap.session.state).toBe('pausiert');
    expect(snap.slide_events.map((e) => e.t_ms)).toEqual([100, 900]);
    expect(snap.markers.map((m) => m.id)).toEqual([keep]);
    expect(snap.recordings).toMatchObject([{ chunk_count: 0, last_seq: null, completed_at: null }]);
    // Zwei Server-Operationen (start, pause)
    const ops = await opsOf(id);
    expect(snap.stream_seq).toBe(ops.length);
    expect(snap.stream_seq).toBe(2);
    expect(snap.stream_op_id).toBe(ops.at(-1)!.op_id);

    expect((await call('GET', `/sessions/${uuidv7()}/snapshot`)).status).toBe(404);
  });
});

describe('Folien-Upload (§9.2)', () => {
  it('createSlideDeck mit session_id setzt slide_deck_id der Session, aber nur wenn sie noch keins hat', async () => {
    const { createSlideDeck } = await import('../../src/services/material.ts');
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const cfg = testConfig();
    mkdirSync(join(cfg.dataDir, 'media', '.tmp'), { recursive: true });
    const upload = (name: string, sha: string) => {
      const tmpPath = join(cfg.dataDir, 'media', '.tmp', name);
      writeFileSync(tmpPath, '%PDF-1.4 test');
      return { tmpPath, size: 13, sha256: sha, filename: `${name}.pdf` };
    };
    const id = await mkSession();
    const first = await createSlideDeck(handle.db, cfg.dataDir, upload('eins', 'e'.repeat(64)), {
      moduleId,
      sessionId: id,
    });
    expect(await row(id)).toMatchObject({ slideDeckId: first.id });
    expect(updatedEventFor(id).at(-1)?.slide_deck_id).toBe(first.id);
    const [deck] = await handle.db.select().from(slideDeck).where(eq(slideDeck.id, first.id));
    expect(deck!.sessionId).toBe(id);

    // Zweiter Satz: die Session hat schon einen, er bleibt
    const second = await createSlideDeck(handle.db, cfg.dataDir, upload('zwei', 'f'.repeat(64)), {
      moduleId,
      sessionId: id,
    });
    expect(second.id).not.toBe(first.id);
    expect((await row(id)).slideDeckId).toBe(first.id);

    // Dublette zu einer anderen Session ohne Foliensatz: die Session bekommt den vorhandenen Satz
    const other = await mkSession();
    const dup = await createSlideDeck(handle.db, cfg.dataDir, upload('drei', 'e'.repeat(64)), {
      moduleId,
      sessionId: other,
    });
    expect(dup).toMatchObject({ id: first.id, duplicate: true });
    expect((await row(other)).slideDeckId).toBe(first.id);
    const [still] = await handle.db.select().from(slideDeck).where(eq(slideDeck.id, first.id));
    expect(still!.sessionId).toBe(id); // hängt weiter an der ersten Session
  });
});
