// Ende-zu-Ende „Folien in der Vorlesung“ (Plan FOLIEN-SESSION, F5; VERTRAEGE §22): die REST-Abfolge, die die Web-App
// in der Vorlesung geht, gegen den echten Core mit echter Datenbank. Im Repo gibt es keine Browser-Testumgebung
// (kein Playwright), darum läuft der Ablauf auf Core-Ebene: deck-options → Start → slide.change → PATCH 409.
// Der Folienwechsel geht wie im Sync-Server (`sync/connection.ts`) über die Registry: `getOpRegistration`, dann
// `preLock` (falls der Handler eines hat), `appendOp` und der Handler.
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ApiErrorSchema,
  DeckOptionsSchema,
  SINGLE_USER_ID,
  SessionSchema,
  SyncOpSchema,
  type SyncEvent,
} from '@sg/shared';
import type { Tx } from '../../src/db/client.ts';
import { uuidv7 } from '../../src/lib/uuid7.ts';
import { setSessionEventPublisher } from '../../src/services/sessions.ts';
import { appendOp } from '../../src/sync/append.ts';
import { getOpRegistration } from '../../src/sync/handlers.ts';
import { startTestApp, type TestApp } from './helpers.ts';

const API = '/api/v1';
const base = { user_id: SINGLE_USER_ID };
let t: TestApp;
let sem: string;
let mod: string;
let events: SyncEvent[] = [];

beforeAll(async () => {
  t = await startTestApp();
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
  const s = t.handle.sql;
  sem = uuidv7();
  mod = uuidv7();
  await s`INSERT INTO semester ${s({ id: sem, ...base, name: 'HS', is_current: true })}`;
  await s`INSERT INTO module ${s({ id: mod, ...base, semester_id: sem, name: 'Modul A', color: 'mod-01' })}`;
});

async function truncate() {
  await t.handle
    .sql`TRUNCATE semester, module, calendar_source, calendar_event, session, slide_deck, moodle_item, sync_stream, job, setting CASCADE`;
}

// ---- Hilfen --------------------------------------------------------------------------------

let clock = Date.parse('2026-11-01T08:00:00Z');
const nextTime = () => new Date((clock += 60_000)).toISOString();

async function mkDeck(title: string): Promise<string> {
  const s = t.handle.sql;
  const id = uuidv7();
  await s`INSERT INTO slide_deck ${s({
    id,
    ...base,
    module_id: mod,
    title,
    file_path: `media/decks/${id}/original.pdf`,
    sha256: randomBytes(32).toString('hex'),
    uploaded_at: nextTime(),
    ingest_state: 'verarbeitet',
  })}`;
  return id;
}

/** Vorlesung wie vom Kalender-Import geplant, dann „bereit“ wie kurz vor dem Beginn */
async function mkReadySession(): Promise<string> {
  const s = t.handle.sql;
  const eventId = uuidv7();
  const id = uuidv7();
  const startsAt = new Date(Date.now() + 5 * 60_000);
  await s`INSERT INTO calendar_event ${s({
    id: eventId,
    ...base,
    module_id: mod,
    kind: 'vorlesung',
    title: 'Vorlesung',
    starts_at: startsAt.toISOString(),
    ends_at: new Date(startsAt.getTime() + 90 * 60_000).toISOString(),
  })}`;
  await s`INSERT INTO session ${s({ id, ...base, module_id: mod, calendar_event_id: eventId, state: 'geplant' })}`;
  await s`UPDATE session SET state = 'bereit' WHERE id = ${id}`;
  return id;
}

const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: Record<string, unknown>) =>
  t.request({ method, url: `${API}${url}`, ...(payload ? { payload } : {}) });
const options = async (sessionId: string) => {
  const res = await call('GET', `/modules/${mod}/deck-options?session_id=${sessionId}`);
  expect(res.statusCode).toBe(200);
  return DeckOptionsSchema.parse(res.json());
};
const errorOf = (res: { json: () => unknown }) => ApiErrorSchema.parse(res.json()).error;
const updatedFor = (id: string) =>
  events.filter((e) => e.type === 'event' && e.name === 'session.updated' && e.data.id === id);
const slideEvents = async (id: string) =>
  (await t.handle.sql`SELECT 1 FROM slide_event WHERE session_id = ${id} AND deleted_at IS NULL`).length;

/** Folienwechsel eines Tabs wie im Sync-Server: Registrierung per `getOpRegistration`, preLock (falls vorhanden), `appendOp`, Handler */
function slideChange(sessionId: string, slideIndex: number) {
  const op = SyncOpSchema.parse({
    type: 'op',
    op_id: uuidv7(),
    stream: `session:${sessionId}`,
    kind: 'slide.change',
    at: Date.now(),
    clock_uncertain: false,
    data: {
      event_id: uuidv7(),
      session_id: sessionId,
      slide_id: null,
      slide_index: slideIndex,
      t_ms: 1_000 * slideIndex,
      device: 'mac',
    },
  });
  return t.handle.db.transaction(async (tx: Tx) => {
    const registration = getOpRegistration(op.kind);
    if (!registration) throw new Error(`Kein Handler für ${op.kind} registriert`);
    if (registration.preLock) await registration.preLock(tx, op);
    await appendOp(tx, op.stream, {
      kind: op.kind,
      data: op.data,
      at: op.at,
      clockUncertain: false,
      origin: 'web',
      opId: op.op_id,
    });
    await registration.handler(tx, op, { deviceId: null, origin: 'web' });
  });
}

// ---- Abläufe -------------------------------------------------------------------------------

describe('Folien in der Vorlesung, Ende zu Ende (§22)', () => {
  it('Start mit Vorschlag: neuester freier Satz, Folie 1, nach dem ersten Wechsel Sperre', async () => {
    // 1. Modul mit zwei Sätzen, der zweite ist der neuere
    const older = await mkDeck('Satz alt');
    const newer = await mkDeck('Satz neu');
    // 2. Bereite Session ohne Satz
    const ses = await mkReadySession();

    // 3. Die Start-Karte zeigt den neuesten freien Satz
    const opts = await options(ses);
    expect(opts.suggested_deck_id).toBe(newer);
    expect(opts.current_deck_id).toBeNull();
    expect(opts.lock).toBeNull();
    expect(opts.items.map((o) => o.deck.id)).toEqual([newer, older]);
    expect(opts.items.every((o) => o.free)).toBe(true);

    // 4. Start mit dem Vorschlag: Die Session läuft und trägt den Satz, es gibt noch keinen Folienwechsel (Folie 1)
    const started = await call('POST', `/sessions/${ses}/start`, {
      started_from: 'mac',
      slide_deck_id: newer,
    });
    expect(started.statusCode).toBe(200);
    const live = SessionSchema.parse((started.json() as { session: unknown }).session);
    expect([live.state, live.slide_deck_id]).toEqual(['laeuft', newer]);
    expect(await slideEvents(ses)).toBe(0);
    // Das iPad erfährt den Satz über session.updated
    const pushed = updatedFor(ses).map((e) => SessionSchema.parse(e.data));
    expect(pushed.some((e) => e.slide_deck_id === newer && e.state === 'laeuft')).toBe(true);
    const afterStart = await options(ses);
    expect(afterStart.current_deck_id).toBe(newer);
    expect(afterStart.lock).toBeNull();

    // Vor dem ersten Wechsel darf der Satz noch geändert werden („Ändern“)
    expect((await call('PATCH', `/sessions/${ses}`, { slide_deck_id: older })).statusCode).toBe(200);
    expect((await options(ses)).current_deck_id).toBe(older);
    expect((await call('PATCH', `/sessions/${ses}`, { slide_deck_id: newer })).statusCode).toBe(200);

    // 5. Pfeil → Folie 2, danach ist kein Wechsel des Satzes mehr möglich
    await slideChange(ses, 2);
    expect(await slideEvents(ses)).toBe(1);
    expect((await options(ses)).lock).toBe('folienwechsel');
    events = [];
    for (const body of [{ slide_deck_id: older }, { slide_deck_id: null }]) {
      const res = await call('PATCH', `/sessions/${ses}`, body);
      expect(res.statusCode).toBe(409);
      expect(errorOf(res)).toMatchObject({
        code: 'slide_deck_locked',
        details: { slide_deck_id: newer, slide_events: 1 },
      });
    }
    const [row] = await t.handle.sql`SELECT slide_deck_id FROM session WHERE id = ${ses}`;
    expect(row?.slide_deck_id).toBe(newer);
    expect(updatedFor(ses)).toHaveLength(0);
    // Derselbe Satz noch einmal ist kein Wechsel und bleibt erlaubt
    expect((await call('PATCH', `/sessions/${ses}`, { slide_deck_id: newer })).statusCode).toBe(200);
  });

  it('Belegter neuester Satz wird nicht vorgeschlagen: der Vorschlag ist der ältere freie Satz', async () => {
    const older = await mkDeck('Satz alt');
    const newer = await mkDeck('Satz neu');
    // Der neueste Satz hängt an einer anderen Vorlesung in belegendem Zustand (`beendet` belegt weiter)
    const s = t.handle.sql;
    const otherId = uuidv7();
    await s`INSERT INTO session ${s({
      id: otherId,
      ...base,
      module_id: mod,
      state: 'beendet',
      slide_deck_id: newer,
      started_at: nextTime(),
      ended_at: nextTime(),
    })}`;
    const ses = await mkReadySession();

    const opts = await options(ses);
    expect(opts.suggested_deck_id).toBe(older);
    const byId = new Map(opts.items.map((o) => [o.deck.id, o]));
    expect(byId.get(newer)?.free).toBe(false);
    expect(byId.get(newer)?.used_by.map((u) => u.session_id)).toEqual([otherId]);
    expect(byId.get(older)).toMatchObject({ free: true, used_by: [] });
  });

  it('Ohne Folien starten, später kommt ein Satz: die Live-Ansicht bietet ihn an, Übernehmen setzt ihn', async () => {
    const existing = await mkDeck('Satz bei Start');
    const ses = await mkReadySession();
    expect((await options(ses)).suggested_deck_id).toBe(existing);

    // „Ohne Folien“: Start ohne slide_deck_id, der Core wählt nie selbst einen Satz
    const started = await call('POST', `/sessions/${ses}/start`, { started_from: 'mac' });
    expect(started.statusCode).toBe(200);
    expect(SessionSchema.parse((started.json() as { session: unknown }).session)).toMatchObject({
      state: 'laeuft',
      slide_deck_id: null,
    });

    // Der Dozent lädt später einen neueren Satz hoch: Er ist das Angebot der Live-Ansicht
    const late = await mkDeck('Satz nachträglich');
    const offer = await options(ses);
    expect(offer.current_deck_id).toBeNull();
    expect(offer.suggested_deck_id).toBe(late);
    expect(offer.lock).toBeNull();
    const before = await t.handle.sql`SELECT state, started_at FROM session WHERE id = ${ses}`;

    // „Übernehmen“: PATCH setzt den Satz, die Aufnahme (Zustand, Startzeit) bleibt unberührt
    events = [];
    const taken = await call('PATCH', `/sessions/${ses}`, { slide_deck_id: late });
    expect(taken.statusCode).toBe(200);
    expect(SessionSchema.parse(taken.json())).toMatchObject({ state: 'laeuft', slide_deck_id: late });
    const after = await t.handle.sql`SELECT state, started_at FROM session WHERE id = ${ses}`;
    expect(after[0]).toEqual(before[0]);
    expect(updatedFor(ses)).toHaveLength(1);
    expect(await slideEvents(ses)).toBe(0);

    // Auch danach gilt die Sperre nach dem ersten Wechsel
    await slideChange(ses, 2);
    const locked = await call('PATCH', `/sessions/${ses}`, { slide_deck_id: existing });
    expect([locked.statusCode, errorOf(locked).code]).toEqual([409, 'slide_deck_locked']);
  });

  it('Ohne Folien und ohne Satz im Modul: kein Vorschlag, der Start geht trotzdem', async () => {
    const ses = await mkReadySession();
    const opts = await options(ses);
    expect([opts.suggested_deck_id, opts.items.length]).toEqual([null, 0]);
    const started = await call('POST', `/sessions/${ses}/start`, { started_from: 'mac' });
    expect(started.statusCode).toBe(200);
    expect(SessionSchema.parse((started.json() as { session: unknown }).session).slide_deck_id).toBeNull();
  });
});
