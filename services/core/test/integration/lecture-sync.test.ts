// F3b (VERTRAEGE 17.8, 22.11): Der Session-Takt meldet den Bedarf an Folien (`SessionTickResult`), `afterTick` läuft
// erst nach dem Commit, und `buildApp` verdrahtet beides mit `LectureSync`. Testfälle 1 bis 6 und 8 bis 12 aus 17.8
// (Fall 7 steht in `moodle-lecture-courses.test.ts`). Kurse, Dateien und Namen sind erfunden.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { pino } from 'pino';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DeckOptionsSchema,
  MoodleSyncStatusSchema,
  SINGLE_USER_ID,
  SyncOpSchema,
  type Module,
  type Semester,
  type SyncEvent,
  type SyncOp,
} from '@sg/shared';
import { createDb, type Db, type DbHandle } from '../../src/db/client.ts';
import { calendarEvent, courseModule, semester, session, slideDeck } from '../../src/db/schema/index.ts';
import { uuidv7 } from '../../src/lib/uuid7.ts';
import { LectureSync } from '../../src/moodle/lecture.ts';
import { createMoodleServices } from '../../src/moodle/index.ts';
import { MoodleSync } from '../../src/moodle/sync.ts';
import { StaticTokenStore } from '../../src/moodle/token-store.ts';
import { SESSION_HANDLERS } from '../../src/sync/handlers/session.ts';
import {
  runSessionTick,
  setSessionEventPublisher,
  startSessionTicker,
  transitionSession,
  type SessionTickOptions,
  type SessionTickResult,
} from '../../src/services/sessions.ts';
import { FakeMoodleServer, fileReply, HANDLED, unix } from '../unit/moodle-server.ts';
import { startTestApp, testDatabaseUrl, type TestApp } from './helpers.ts';

const API = '/api/v1';
const base = { userId: SINGLE_USER_ID };
const DEVICE = '0190f6a2-0000-7000-8000-0000000000d1';

/** Minuten nach 2026-11-04 09:00 UTC */
const T = (min: number): Date => new Date(Date.UTC(2026, 10, 4, 9, 0) + min * 60_000);

let t: TestApp;
let events: SyncEvent[] = [];
let modA = '';
let modB = '';
let tickConfig: TestApp['config'];

async function truncate(): Promise<void> {
  await t.handle
    .sql`TRUNCATE semester, module, calendar_source, calendar_event, session, slide_deck, moodle_item,
    moodle_course_link, moodle_course_decided, job, sync_op, sync_stream, setting CASCADE`;
}

async function seed(): Promise<void> {
  const semesterId = uuidv7();
  modA = uuidv7();
  modB = uuidv7();
  await t.handle.db.insert(semester).values({ id: semesterId, ...base, name: 'HS 2026', isCurrent: true });
  await t.handle.db.insert(courseModule).values([
    { id: modA, ...base, semesterId, name: 'Datenbanken', color: 'mod-01' },
    { id: modB, ...base, semesterId, name: 'Statistik', color: 'mod-02' },
  ]);
}

type SessionInsert = typeof session.$inferInsert;

async function mkSession(over: Partial<SessionInsert> = {}): Promise<string> {
  const id = uuidv7();
  await t.handle.db.insert(session).values({ id, ...base, moduleId: modA, state: 'bereit', ...over });
  return id;
}

async function mkEvent(startMin: number, endMin: number, moduleId = modA): Promise<string> {
  const id = uuidv7();
  await t.handle.db.insert(calendarEvent).values({
    id,
    ...base,
    moduleId,
    kind: 'vorlesung',
    title: 'Vorlesung',
    startsAt: T(startMin),
    endsAt: T(endMin),
  });
  return id;
}

async function mkDeck(over: { moduleId?: string; deleted?: boolean } = {}): Promise<string> {
  const id = uuidv7();
  await t.handle.db.insert(slideDeck).values({
    id,
    ...base,
    moduleId: over.moduleId ?? modA,
    title: 'Satz',
    filePath: `media/decks/${id}/original.pdf`,
    sha256: id.replaceAll('-', '').padEnd(64, '0'),
    ingestState: 'verarbeitet',
    deletedAt: over.deleted ? new Date() : null,
  });
  return id;
}

const tick = (now: Date, options?: SessionTickOptions): Promise<SessionTickResult> =>
  runSessionTick(t.handle.db, tickConfig, now, options);

const api = (method: 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
  t.request({ method, url: `${API}${url}`, ...(payload ? { payload } : {}) });

const rowOf = async (id: string) => {
  const [found] = await t.handle.db.select().from(session).where(eq(session.id, id));
  if (!found) throw new Error(`Session ${id} fehlt`);
  return found;
};

function startOp(sessionId: string, moduleId: string, atMin: number): SyncOp {
  return SyncOpSchema.parse({
    type: 'op',
    op_id: uuidv7(),
    stream: `session:${sessionId}`,
    kind: 'session.start',
    at: T(atMin).getTime(),
    clock_uncertain: false,
    data: {
      session_id: sessionId,
      module_id: moduleId,
      calendar_event_id: null,
      slide_deck_id: null,
      started_from: 'ipad',
      started_at: T(atMin).getTime(),
    },
  });
}

const runHandler = (op: SyncOp) =>
  t.handle.db.transaction((tx) => SESSION_HANDLERS[op.kind]!(tx, op, { deviceId: DEVICE, origin: 'ipad' }));

// --- Takt und Bedarf (Fälle 1 bis 6, 10, 11) -----------------------------------------------------------------

describe('SessionTickResult und afterTick (17.8)', () => {
  beforeAll(async () => {
    t = await startTestApp();
    tickConfig = t.config;
    setSessionEventPublisher(async (_tx, event) => {
      events.push(event);
    });
  });
  afterAll(async () => {
    setSessionEventPublisher(null);
    await truncate();
    await t.close();
  });
  beforeEach(async () => {
    await truncate();
    events = [];
    await seed();
  });

  it('Fall 1: geplant → bereit meldet das Modul einmal je Übergang', async () => {
    const eventId = await mkEvent(60, 120);
    const id = await mkSession({ state: 'geplant', calendarEventId: eventId });
    expect(await tick(T(0))).toEqual({ becameReady: [], activeWithoutDeck: [] });
    expect((await rowOf(id)).state).toBe('geplant');
    expect(await tick(T(46))).toEqual({ becameReady: [modA], activeWithoutDeck: [] });
    expect((await rowOf(id)).state).toBe('bereit');
    expect(await tick(T(47))).toEqual({ becameReady: [], activeWithoutDeck: [] });
  });

  it('Fall 1: mehrere Module und Dubletten aufsteigend sortiert', async () => {
    const [a1, a2, b1] = [await mkEvent(60, 120), await mkEvent(61, 120), await mkEvent(62, 120, modB)];
    await mkSession({ state: 'geplant', calendarEventId: a1 });
    await mkSession({ state: 'geplant', calendarEventId: a2 });
    await mkSession({ state: 'geplant', calendarEventId: b1, moduleId: modB });
    const result = await tick(T(50));
    expect(result.becameReady).toEqual([modA, modB].sort());
  });

  it('Fall 2: mit gültigem Satz nicht gemeldet, mit gelöschtem oder fremdem Satz gemeldet', async () => {
    const cases: { name: string; deck: () => Promise<string>; reported: boolean }[] = [
      { name: 'gültig', deck: () => mkDeck(), reported: false },
      { name: 'gelöscht', deck: () => mkDeck({ deleted: true }), reported: true },
      { name: 'anderes Modul', deck: () => mkDeck({ moduleId: modB }), reported: true },
    ];
    for (const c of cases) {
      await truncate();
      await seed();
      const deck = await c.deck();
      const eventId = await mkEvent(60, 120);
      await mkSession({ state: 'geplant', calendarEventId: eventId, slideDeckId: deck });
      const result = await tick(T(50));
      expect(result.becameReady, c.name).toEqual(c.reported ? [modA] : []);
    }
  });

  it('Fall 3: geplant → verpasst in einem Schritt wird nicht gemeldet', async () => {
    const eventId = await mkEvent(0, 30);
    const id = await mkSession({ state: 'geplant', calendarEventId: eventId });
    expect(await tick(T(100))).toEqual({ becameReady: [], activeWithoutDeck: [] });
    expect((await rowOf(id).then((r) => r.state)) as string).toBe('verpasst');
  });

  it('Fall 4: laeuft und pausiert ohne Satz stehen in jedem Takt in der Liste, danach nicht mehr', async () => {
    // Es gibt höchstens eine aktive Session (session_one_active_uq)
    const first = await mkSession({ state: 'laeuft', startedAt: T(0) });
    expect((await tick(T(1))).activeWithoutDeck).toEqual([modA]);
    expect((await tick(T(2))).activeWithoutDeck).toEqual([modA]);
    await t.handle.db.transaction((tx) =>
      transitionSession(tx, first, 'pause', { at: T(3), origin: 'server', now: T(3) }),
    );
    expect((await rowOf(first)).state).toBe('pausiert');
    expect((await tick(T(4))).activeWithoutDeck).toEqual([modA]);

    // PATCH mit Satz
    const deck = await mkDeck();
    expect((await api('PATCH', `/sessions/${first}`, { slide_deck_id: deck })).statusCode).toBe(200);
    expect((await tick(T(5))).activeWithoutDeck).toEqual([]);

    // Stopp
    await t.handle.db.transaction((tx) =>
      transitionSession(tx, first, 'stop', { at: T(6), origin: 'server', now: T(6) }),
    );
    const second = await mkSession({ state: 'laeuft', startedAt: T(7), moduleId: modB });
    expect((await tick(T(8))).activeWithoutDeck).toEqual([modB]);
    await t.handle.db.transaction((tx) =>
      transitionSession(tx, second, 'stop', { at: T(9), origin: 'server', now: T(9) }),
    );
    expect((await tick(T(10))).activeWithoutDeck).toEqual([]);

    // Löschen
    const third = await mkSession({ state: 'laeuft', startedAt: T(11) });
    expect((await tick(T(12))).activeWithoutDeck).toEqual([modA]);
    // Über die API lässt sich eine aktive Session nicht löschen; die Zeile gilt trotzdem als gelöscht
    await t.handle.sql`UPDATE session SET deleted_at = now() WHERE id = ${third}`;
    expect((await tick(T(13))).activeWithoutDeck).toEqual([]);
  });

  it('Fall 4: ein gelöschter oder fremder Satz zählt nicht als gültig', async () => {
    const deleted = await mkDeck({ deleted: true });
    const foreign = await mkDeck({ moduleId: modB });
    for (const deck of [deleted, foreign]) {
      await t.handle.sql`DELETE FROM session`;
      await mkSession({ state: 'laeuft', startedAt: T(0), slideDeckId: deck });
      expect((await tick(T(1))).activeWithoutDeck).toEqual([modA]);
    }
  });

  it('Fall 5: beendet der Takt die Session selbst (Auto-Stopp), steht sie in diesem Takt nicht mehr in der Liste', async () => {
    const eventId = await mkEvent(0, 60);
    const id = await mkSession({ state: 'laeuft', startedAt: T(0), calendarEventId: eventId });
    // Der Übergang einer anderen Session im selben Takt wird trotzdem gemeldet
    const nextEvent = await mkEvent(100, 160, modB);
    await mkSession({ state: 'geplant', calendarEventId: nextEvent, moduleId: modB });
    const result = await tick(T(95));
    expect((await rowOf(id)).state).not.toBe('laeuft');
    expect(result).toEqual({ becameReady: [modB], activeWithoutDeck: [] });
  });

  it('Fall 6: afterTick läuft erst nach dem Commit (zweite Verbindung sieht bereit), mit startup als Wahrheitswert', async () => {
    const eventId = await mkEvent(60, 120);
    const id = await mkSession({ state: 'geplant', calendarEventId: eventId });
    const second: DbHandle = createDb(testDatabaseUrl());
    await second.sql`SELECT 1`; // Verbindung vorwärmen: Sie soll im Aufruf sofort abfragen können
    const seen: { result: SessionTickResult; options: SessionTickOptions; state: Promise<string> }[] = [];
    let clock = T(0);
    const ticker = startSessionTicker({
      db: t.handle.db,
      config: tickConfig,
      onError: (e) => {
        throw e;
      },
      intervalMs: 3_600_000,
      now: () => clock,
      afterTick: (result, options) => {
        // Die Abfrage geht in diesem Aufruf auf der zweiten Verbindung los: Sie sieht nur Festgeschriebenes
        const state = second.sql<{ state: string }[]>`SELECT state FROM session WHERE id = ${id}`.then(
          (rows) => rows[0]?.state ?? 'fehlt',
        );
        seen.push({ result, options, state });
      },
    });
    try {
      await ticker.runOnce(); // der Start-Takt läuft schon, dies ist der zweite
      expect(seen).toHaveLength(2);
      expect(seen[0]!.options.startup).toBe(true);
      expect(await seen[0]!.state).toBe('geplant');
      clock = T(50);
      await ticker.runOnce();
      expect(seen).toHaveLength(3);
      expect(seen[2]!.result.becameReady).toEqual([modA]);
      expect(await seen[2]!.state).toBe('bereit');
    } finally {
      await ticker.stop();
      await second.close();
    }
  });

  it('Fall 6: scheitert der Takt (Fehler in der Transaktion), läuft afterTick nicht und der Übergang ist zurückgerollt', async () => {
    const eventId = await mkEvent(60, 120);
    const id = await mkSession({ state: 'geplant', calendarEventId: eventId });
    const failing = new Proxy(t.handle.db, {
      get(target, prop, receiver) {
        if (prop === 'transaction') {
          return (fn: (tx: unknown) => Promise<unknown>) =>
            target.transaction(async (tx) => {
              await fn(tx);
              throw new Error('Takt scheitert');
            });
        }
        return Reflect.get(target, prop, receiver) as unknown;
      },
    }) as Db;
    const after = vi.fn();
    const errors: unknown[] = [];
    const ticker = startSessionTicker({
      db: failing,
      config: tickConfig,
      onError: (e) => errors.push(e),
      intervalMs: 3_600_000,
      now: () => T(50),
      afterTick: after,
    });
    await ticker.runOnce();
    await ticker.stop();
    expect(errors.length).toBeGreaterThanOrEqual(2);
    expect(after).not.toHaveBeenCalled();
    expect((await rowOf(id)).state).toBe('geplant');
  });

  it('Fall 6: wirft afterTick, geht der Fehler an onError und der Takt läuft weiter', async () => {
    const errors: unknown[] = [];
    let calls = 0;
    const ticker = startSessionTicker({
      db: t.handle.db,
      config: tickConfig,
      onError: (e) => errors.push(e),
      intervalMs: 3_600_000,
      now: () => T(0),
      afterTick: () => {
        calls += 1;
        throw new Error('afterTick wirft');
      },
    });
    await ticker.runOnce();
    await ticker.stop();
    expect(calls).toBe(2);
    expect(errors).toHaveLength(2);
  });

  it('Fall 10: Start über REST und über session.start eines Geräts: der nächste Takt meldet das Modul', async () => {
    const restId = await mkSession({ state: 'bereit' });
    expect((await tick(T(0))).activeWithoutDeck).toEqual([]);
    const started = await api('POST', `/sessions/${restId}/start`, { started_from: 'mac' });
    expect(started.statusCode).toBe(200);
    expect((await tick(T(1))).activeWithoutDeck).toEqual([modA]);
    await t.handle.db.transaction((tx) =>
      transitionSession(tx, restId, 'stop', { at: T(2), origin: 'server', now: T(2) }),
    );
    expect((await tick(T(3))).activeWithoutDeck).toEqual([]);

    const deviceId = uuidv7();
    await runHandler(startOp(deviceId, modB, 4));
    expect((await rowOf(deviceId)).state).toBe('laeuft');
    expect((await tick(T(5))).activeWithoutDeck).toEqual([modB]);
  });

  it('Fall 10: ein nachgelieferter Geräte-Start einer schon beendeten Session meldet nichts', async () => {
    const id = await mkSession({
      state: 'beendet',
      startedAt: T(0),
      endedAt: T(10),
      stopReason: 'manuell',
    });
    await runHandler(startOp(id, modA, 0));
    expect((await rowOf(id)).state).toBe('beendet');
    expect(await tick(T(20))).toEqual({ becameReady: [], activeWithoutDeck: [] });
  });

  it('Fall 11: eine Session direkt in bereit (Kalender-Import) steht nie in becameReady, nach dem Start in activeWithoutDeck', async () => {
    const eventId = await mkEvent(10, 70);
    // So legt `ensurePlannedSessions` sie an, wenn der Termin schon im Fenster von 15 min liegt
    const id = await mkSession({ state: 'bereit', calendarEventId: eventId });
    expect(await tick(T(0))).toEqual({ becameReady: [], activeWithoutDeck: [] });
    expect(await tick(T(5))).toEqual({ becameReady: [], activeWithoutDeck: [] });
    await t.handle.db.transaction((tx) =>
      transitionSession(tx, id, 'start', { at: T(6), origin: 'server', startedFrom: 'mac', now: T(6) }),
    );
    expect(await tick(T(7))).toEqual({ becameReady: [], activeWithoutDeck: [modA] });
  });
});

// --- Ende zu Ende mit dem Moodle-Fake (Fälle 8 und 9) ------------------------------------------------------------

const TOKEN = Array.from({ length: 32 }, (_, i) => (i % 16).toString(16)).join('');
const NOW = new Date('2026-11-05T12:00:00Z');
const COURSE = 9_100_000 + Math.floor(Math.random() * 90_000);
const FILE_A = '/7001/mod_resource/content/1/VL01_Einfuehrung.pdf';
const FILE_B = '/7002/mod_resource/content/1/VL02_Normalformen.pdf';
const pdf = (label: string) => Buffer.from(`%PDF-1.4\n% ${label}\n%%EOF\n`);

describe('Abgleich zur Vorlesung Ende zu Ende (Fälle 8 und 9)', () => {
  let fake: FakeMoodleServer;
  let sync: MoodleSync;
  let lecture: LectureSync;
  let syncHandle: DbHandle;
  let semesterRow: Semester;
  let moduleRow: Module;
  /** Nur die erste Datei ist im Kurs, `withSecond` fügt die zweite hinzu */
  let withSecond = false;

  const resource = (id: number, ref: string, name: string, modified: string) => ({
    id,
    name: name.replace('.pdf', ''),
    modname: 'resource',
    visible: 1,
    contents: [
      {
        type: 'file',
        filename: name,
        filepath: '/',
        filesize: 40,
        fileurl: `${fake.baseUrl}/webservice/pluginfile.php${ref}?forcedownload=1&token=${TOKEN}`,
        timemodified: unix(modified),
        mimetype: 'application/pdf',
      },
    ],
  });

  function installFixtures(): void {
    fake.rest = {
      core_webservice_get_site_info: {
        sitename: 'Beispiel-Moodle',
        fullname: 'Erika Beispiel',
        userid: 42,
        functions: [],
      },
      core_enrol_get_users_courses: [
        {
          id: COURSE,
          shortname: 'DBS-DEMO',
          fullname: 'Datenbanksysteme (Beispielkurs)',
          startdate: unix('2026-10-01T00:00:00Z'),
          enddate: 0,
        },
      ],
      core_course_get_contents: () => [
        {
          id: 10,
          name: 'Woche 1',
          visible: 1,
          section: 1,
          modules: [
            resource(7001, FILE_A, 'VL01_Einfuehrung.pdf', '2026-10-20T10:00:00Z'),
            ...(withSecond ? [resource(7002, FILE_B, 'VL02_Normalformen.pdf', '2026-11-05T11:00:00Z')] : []),
          ],
        },
      ],
      mod_assign_get_assignments: { courses: [] },
      core_calendar_get_action_events_by_timesort: { events: [] },
    };
    fake.files.clear();
    fake.files.set(FILE_A, fileReply({ body: pdf('a') }));
    fake.files.set(FILE_B, fileReply({ body: pdf('b') }));
  }

  const req = async (method: 'GET' | 'PUT' | 'POST' | 'PATCH', url: string, payload?: object) => {
    const res = await t.request({ method, url: `${API}${url}`, ...(payload ? { payload } : {}) });
    return { status: res.statusCode, body: res.body ? (res.json() as unknown) : null };
  };
  const syncStatus = async () => MoodleSyncStatusSchema.parse((await req('GET', '/moodle/sync')).body);
  const deckOptions = async (sessionId: string) =>
    DeckOptionsSchema.parse(
      (await req('GET', `/modules/${moduleRow.id}/deck-options?session_id=${sessionId}`)).body,
    );

  beforeAll(async () => {
    fake = await new FakeMoodleServer(TOKEN).start();
  });
  afterAll(async () => {
    await fake.stop();
  });

  beforeEach(async () => {
    withSecond = false;
    installFixtures();
    fake.tokenValid = true;
    fake.requests.length = 0;
    const dataDir = mkdtempSync(join(tmpdir(), 'sg-core-lecture-'));
    const moodle = createMoodleServices({
      config: { moodleUrl: fake.baseUrl, dataDir },
      tokens: new StaticTokenStore(TOKEN),
      logger: pino({ level: 'silent' }),
      readMeta: async () => ({ token_valid_until: '2027-01-31' }),
      now: () => NOW,
      timeZone: 'Europe/Berlin',
      client: { minIntervalMs: 0, retryDelaysMs: [0, 0], timeoutMs: 2000 },
    });
    syncHandle = createDb(testDatabaseUrl());
    sync = new MoodleSync({ db: syncHandle.db, dataDir, moodle, now: () => NOW });
    lecture = new LectureSync({ db: syncHandle.db, sync, status: moodle.status, now: () => NOW });
    t = await startTestApp(
      { moodleUrl: fake.baseUrl, dataDir },
      { moodle, moodleSync: sync, now: () => NOW },
    );
    tickConfig = t.config;
    setSessionEventPublisher(async (_tx, event) => {
      events.push(event);
    });
    events = [];
    await truncate();
    semesterRow = (
      await req('POST', '/semesters', { name: 'WS 2026', starts_on: '2026-10-01', ends_on: '2027-03-31' })
    ).body as Semester;
  });

  afterEach(async () => {
    await sync.idle();
    setSessionEventPublisher(null);
    await truncate();
    await t.close();
    await syncHandle.close();
  });

  /** Modul und Zuordnung (ein erster Abgleich `zuordnung` übernimmt die erste Datei) */
  async function setup(): Promise<void> {
    expect(semesterRow).toBeTruthy();
    await req('PATCH', `/semesters/${semesterRow.id}`, { is_current: true });
    const res = await t.request({
      method: 'POST',
      url: `${API}/modules`,
      payload: { semester_id: semesterRow.id, name: 'Datenbanksysteme', short_name: 'DBS' },
    });
    expect(res.statusCode).toBe(201);
    moduleRow = res.json() as Module;
    expect((await req('PUT', `/moodle/links/${COURSE}`, { module_id: moduleRow.id })).status).toBe(200);
    await sync.idle();
  }

  async function mkSessionFor(moduleId: string, state: 'laeuft' | 'bereit'): Promise<string> {
    const id = uuidv7();
    await t.handle.db.insert(session).values({
      id,
      ...base,
      moduleId,
      state,
      startedAt: state === 'laeuft' ? new Date(NOW.getTime() - 60_000) : null,
    });
    return id;
  }

  function startTicker() {
    return startSessionTicker({
      db: t.handle.db,
      config: t.config,
      onError: (e) => {
        throw e;
      },
      intervalMs: 3_600_000,
      now: () => NOW,
      afterTick: (result, o) => lecture.onTick(result, { startup: o.startup === true }),
    });
  }

  it('Fall 8: Takt → Abgleich → neuer Satz als Vorschlag, nichts verknüpft, last_run unverändert, zweiter Takt ohne Moodle-Aufruf', async () => {
    await setup();
    const sessionId = await mkSessionFor(moduleRow.id, 'laeuft');
    const before = await syncStatus();
    expect(before.last_run?.trigger).toBe('zuordnung');
    const firstDeck = (await deckOptions(sessionId)).suggested_deck_id;
    expect(firstDeck).not.toBeNull();

    // Die Datei erscheint erst kurz vor der Vorlesung
    withSecond = true;
    events = [];
    fake.requests.length = 0;
    const ticker = startTicker();
    try {
      await ticker.runOnce(); // nach dem Start-Takt (der nichts anstößt)
      await vi.waitFor(() => expect(sync.lastLectureRun).not.toBeNull());
      await sync.idle();
      expect(sync.lastLectureRun).toMatchObject({ trigger: 'vorlesung', ok: true, courses: 1 });
      const options = await deckOptions(sessionId);
      expect(options.suggested_deck_id).not.toBe(firstDeck);
      expect(options.items.find((i) => i.deck.id === options.suggested_deck_id)).toMatchObject({
        source: 'moodle',
      });
      expect((await rowOf(sessionId)).slideDeckId).toBeNull();
      expect(events.filter((e) => e.type === 'event' && e.name === 'session.updated')).toEqual([]);
      expect(await syncStatus()).toEqual(before);

      // Ein zweiter Takt eine Minute später: gedrosselt, Moodle wird nicht gefragt
      const calls = fake.requests.length;
      expect(calls).toBeGreaterThan(0);
      await ticker.runOnce();
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(await lecture.request(moduleRow.id)).toBe('gedrosselt');
      expect(fake.requests.length).toBe(calls);
    } finally {
      await ticker.stop();
    }
  });

  it('Fall 9: Moodle nicht erreichbar: Takt und Start antworten wie sonst, der Lauf scheitert, last_run bleibt', async () => {
    await setup();
    const before = await syncStatus();
    const next = await mkSessionFor(moduleRow.id, 'bereit');
    // Moodle bricht jede Verbindung ab
    fake.rest.core_course_get_contents = (_params: URLSearchParams, res: { destroy: () => void }) => {
      res.destroy();
      return HANDLED;
    };
    const ticker = startTicker();
    try {
      const started = await api('POST', `/sessions/${next}/start`, { started_from: 'mac' });
      expect(started.statusCode).toBe(200);
      expect((await rowOf(next)).state).toBe('laeuft');
      await ticker.runOnce();
      await vi.waitFor(() => expect(sync.lastLectureRun).not.toBeNull());
      await sync.idle();
      expect(sync.lastLectureRun).toMatchObject({ trigger: 'vorlesung', ok: false });
      expect(sync.lastLectureRun?.failed_courses).toHaveLength(1);
      expect(await syncStatus()).toEqual(before);
    } finally {
      await ticker.stop();
    }
  });

  it('Fall 9: Moodle lehnt den Token ab: kein Fehler für Takt und Start, last_run bleibt', async () => {
    await setup();
    const before = await syncStatus();
    const next = await mkSessionFor(moduleRow.id, 'bereit');
    fake.tokenValid = false;
    const ticker = startTicker();
    try {
      const started = await api('POST', `/sessions/${next}/start`, { started_from: 'mac' });
      expect(started.statusCode).toBe(200);
      expect((await rowOf(next)).state).toBe('laeuft');
      await ticker.runOnce();
      await new Promise((resolve) => setTimeout(resolve, 200));
      await sync.idle();
      // Entweder kein Lauf (Zugang schon als ungültig bekannt) oder ein gescheiterter Lauf
      const run = sync.lastLectureRun;
      if (run) expect(run.ok).toBe(false);
      expect(await syncStatus()).toMatchObject({ last_run: before.last_run });
    } finally {
      await ticker.stop();
    }
  });
});

// --- Verdrahtung in buildApp (Fall 12) -----------------------------------------------------------------------------

describe('buildApp: Verdrahtung des Takts mit LectureSync (Fall 12)', () => {
  afterEach(async () => {
    await truncate();
    await t.close();
  });

  it('onTick nach jedem gelungenen Takt: Start-Takt mit startup true, danach false; erst nach listen', async () => {
    let clock = T(0);
    const calls: { result: SessionTickResult; options: { startup?: boolean } | undefined }[] = [];
    t = await startTestApp(
      {},
      {
        sessionTicker: true,
        sessionTickIntervalMs: 20,
        now: () => clock,
        lectureSync: {
          onTick: (result, options) =>
            void calls.push({
              result: {
                becameReady: [...result.becameReady],
                activeWithoutDeck: [...result.activeWithoutDeck],
              },
              options,
            }),
        },
      },
    );
    tickConfig = t.config;
    await truncate();
    await seed();
    await mkSession({ state: 'laeuft', startedAt: T(0) });
    const eventId = await mkEvent(60, 120, modB);
    await mkSession({ state: 'geplant', calendarEventId: eventId, moduleId: modB });

    // Nach ready allein läuft nichts: der Takt startet erst nach listen
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(calls).toHaveLength(0);

    await t.app.listen({ port: 0, host: '127.0.0.1' });
    await vi.waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(3));
    // Genau ein Start-Takt, er kommt zuerst
    expect(calls[0]).toEqual({
      result: { becameReady: [], activeWithoutDeck: [modA] },
      options: { startup: true },
    });
    expect(calls.filter((c) => c.options?.startup === true)).toHaveLength(1);
    for (const c of calls.slice(1)) {
      expect(c.options).toEqual({ startup: false });
      expect(c.result).toEqual({ becameReady: [], activeWithoutDeck: [modA] });
    }

    // Uhr ins Fenster von B: genau ein Takt meldet den Übergang
    const seen = calls.length;
    clock = T(50);
    await vi.waitFor(() => expect(calls.slice(seen).some((c) => c.result.becameReady.length > 0)).toBe(true));
    await vi.waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(seen + 4));
    const after = calls.slice(seen);
    const ready = after.filter((c) => c.result.becameReady.length > 0);
    expect(ready).toHaveLength(1);
    expect(ready[0]).toEqual({
      result: { becameReady: [modB], activeWithoutDeck: [modA] },
      options: { startup: false },
    });
    for (const c of after) expect(c.result.activeWithoutDeck).toEqual([modA]);
    expect(after.filter((c) => c.options?.startup === true)).toHaveLength(0);
  });

  it('ohne sessionTicker gibt es keinen Anstoß', async () => {
    const onTick = vi.fn();
    t = await startTestApp({}, { sessionTicker: false, sessionTickIntervalMs: 20, lectureSync: { onTick } });
    tickConfig = t.config;
    await truncate();
    await seed();
    await mkSession({ state: 'laeuft', startedAt: T(0) });
    await t.app.listen({ port: 0, host: '127.0.0.1' });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(onTick).not.toHaveBeenCalled();
  });
});
