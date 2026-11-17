// Folien in der Vorlesung (VERTRAEGE §22, F1): `GET /modules/{id}/deck-options`, `PATCH /sessions/{id}` mit
// `slide_deck_id`, Upload mit `session_id` samt Sperrreihenfolge (kein 40P01).
import { randomBytes } from 'node:crypto';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiErrorSchema, DeckOptionsSchema, SINGLE_USER_ID, SessionSchema, type SyncEvent } from '@sg/shared';
import { uuidv7 } from '../../src/lib/uuid7.ts';
import { createSlideDeck } from '../../src/services/material.ts';
import { purgeTrashItems } from '../../src/services/trash-ops.ts';
import { setSessionEventPublisher } from '../../src/services/sessions.ts';
import { startTestApp, type TestApp } from './helpers.ts';

const API = '/api/v1';
const base = { user_id: SINGLE_USER_ID };
let t: TestApp;
let sem: string;
let mod: string;
let otherMod: string;
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
  otherMod = uuidv7();
  await s`INSERT INTO semester ${s({ id: sem, ...base, name: 'HS', is_current: true })}`;
  await s`INSERT INTO module ${s({ id: mod, ...base, semester_id: sem, name: 'DBS', color: 'mod-01' })}`;
  await s`INSERT INTO module ${s({ id: otherMod, ...base, semester_id: sem, name: 'STA', color: 'mod-02' })}`;
});

async function truncate() {
  await t.handle
    .sql`TRUNCATE semester, module, calendar_source, calendar_event, session, slide_deck, moodle_item, sync_stream, job, setting CASCADE`;
}

// ---- Hilfen --------------------------------------------------------------------------------

let clock = Date.parse('2026-11-01T08:00:00Z');
const nextTime = () => new Date((clock += 60_000)).toISOString();

async function mkDeck(
  opts: { module?: string; state?: string; deleted?: boolean; uploadedAt?: string; title?: string } = {},
): Promise<string> {
  const s = t.handle.sql;
  const id = uuidv7();
  await s`INSERT INTO slide_deck ${s({
    id,
    ...base,
    module_id: opts.module ?? mod,
    title: opts.title ?? `Satz ${id.slice(-4)}`,
    file_path: `media/decks/${id}/original.pdf`,
    sha256: randomBytes(32).toString('hex'),
    uploaded_at: opts.uploadedAt ?? nextTime(),
    ingest_state: opts.state ?? 'verarbeitet',
    deleted_at: opts.deleted ? new Date().toISOString() : null,
  })}`;
  return id;
}

async function mkSession(
  opts: {
    module?: string;
    state?: string;
    deck?: string | null;
    deleted?: boolean;
    number?: number | null;
    title?: string | null;
    startedAt?: string | null;
  } = {},
): Promise<string> {
  const s = t.handle.sql;
  const id = uuidv7();
  const state = opts.state ?? 'bereit';
  const started =
    opts.startedAt !== undefined
      ? opts.startedAt
      : ['laeuft', 'pausiert', 'beendet', 'verarbeitet'].includes(state)
        ? nextTime()
        : null;
  await s`INSERT INTO session ${s({
    id,
    ...base,
    module_id: opts.module ?? mod,
    slide_deck_id: opts.deck ?? null,
    number: opts.number ?? null,
    title: opts.title ?? null,
    state,
    started_at: started,
    ended_at: ['beendet', 'verarbeitet'].includes(state) ? nextTime() : null,
    stop_reason: ['beendet', 'verarbeitet'].includes(state) ? 'manuell' : null,
    deleted_at: opts.deleted ? new Date().toISOString() : null,
  })}`;
  return id;
}

async function mkSlideEvent(sessionId: string, deleted = false): Promise<void> {
  const s = t.handle.sql;
  await s`INSERT INTO slide_event ${s({
    id: uuidv7(),
    ...base,
    session_id: sessionId,
    slide_index: 1,
    t_ms: 1000,
    device: 'mac',
    source: 'manuell_mac',
    deleted_at: deleted ? new Date().toISOString() : null,
  })}`;
}

async function mkMoodleItem(deckId: string, timemodified: string | null, removed = false): Promise<void> {
  const s = t.handle.sql;
  await s`INSERT INTO moodle_item ${s({
    id: uuidv7(),
    ...base,
    moodle_course_id: '42',
    cmid: String(Math.floor(Math.random() * 1e9)),
    activity_name: 'Folien',
    filename: 'f.pdf',
    file_ref: randomBytes(8).toString('hex'),
    timemodified,
    size_bytes: 1,
    kind: 'folien',
    slide_deck_id: deckId,
    removed_in_moodle_at: removed ? new Date().toISOString() : null,
  })}`;
}

const options = async (module: string, query = '') => {
  const res = await t.request({ method: 'GET', url: `${API}/modules/${module}/deck-options${query}` });
  return res;
};
const optionsOk = async (module: string, sessionId?: string) => {
  const res = await options(module, sessionId ? `?session_id=${sessionId}` : '');
  expect(res.statusCode).toBe(200);
  return DeckOptionsSchema.parse(res.json());
};
const patch = (id: string, body: Record<string, unknown>) =>
  t.request({ method: 'PATCH', url: `${API}/sessions/${id}`, payload: body });
const errCode = (res: { json: () => unknown }) => ApiErrorSchema.parse(res.json()).error.code;
const sessionRow = async (id: string) => {
  const [r] = await t.handle.sql`SELECT slide_deck_id, title, updated_at FROM session WHERE id = ${id}`;
  return r as { slide_deck_id: string | null; title: string | null; updated_at: Date };
};
const deckHint = async (id: string) => {
  const [r] = await t.handle.sql`SELECT session_id FROM slide_deck WHERE id = ${id}`;
  return (r as { session_id: string | null }).session_id;
};
const updatedFor = (id: string) =>
  events.filter((e) => e.type === 'event' && e.name === 'session.updated' && e.data.id === id);

// ---- deck-options ---------------------------------------------------------------------------

describe('GET /modules/{id}/deck-options (§22.2, §22.3)', () => {
  it('Fehler: unbekanntes Modul, unbekannte Session, fremdes Modul, ungültige UUID, leerer Wert gilt als nicht gesetzt', async () => {
    const res404 = await options(uuidv7());
    expect([res404.statusCode, errCode(res404)]).toEqual([404, 'module_not_found']);
    const res404s = await options(mod, `?session_id=${uuidv7()}`);
    expect([res404s.statusCode, errCode(res404s)]).toEqual([404, 'session_not_found']);
    const foreign = await mkSession({ module: otherMod });
    const res400 = await options(mod, `?session_id=${foreign}`);
    expect([res400.statusCode, errCode(res400)]).toEqual([400, 'session_module_mismatch']);
    const bad = await options(mod, '?session_id=keine-uuid');
    expect([bad.statusCode, errCode(bad)]).toEqual([400, 'validation_failed']);
    const empty = await options(mod, '?session_id=');
    expect(empty.statusCode).toBe(200);
    expect(DeckOptionsSchema.parse(empty.json()).session_id).toBeNull();
    // gelöschte Session = unbekannt
    const gone = await mkSession({ deleted: true });
    expect(errCode(await options(mod, `?session_id=${gone}`))).toBe('session_not_found');
  });

  it('Reihenfolge nach available_at absteigend, Gleichstand id absteigend; Vorschlag = erster freier', async () => {
    const same = '2026-11-10T10:00:00Z';
    const a = await mkDeck({ uploadedAt: '2026-11-01T10:00:00Z' });
    const b = await mkDeck({ uploadedAt: same });
    const c = await mkDeck({ uploadedAt: same });
    const d = await mkDeck({ uploadedAt: '2026-11-05T10:00:00Z' });
    const ses = await mkSession();
    const res = await optionsOk(mod, ses);
    const [hi, lo] = [b, c].sort().reverse();
    expect(res.items.map((i) => i.deck.id)).toEqual([hi, lo, d, a]);
    expect(res.suggested_deck_id).toBe(hi);
    expect(res.current_deck_id).toBeNull();
    expect(res.lock).toBeNull();
    expect(res.session_id).toBe(ses);
  });

  it('Vorschlag überspringt belegte Sätze: andere Session in geplant/bereit/laeuft/pausiert/beendet/verarbeitet belegt, verpasst und gelöschte nicht', async () => {
    const ses = await mkSession();
    for (const state of ['geplant', 'bereit', 'laeuft', 'pausiert', 'beendet', 'verarbeitet']) {
      if (state === 'laeuft' || state === 'pausiert')
        await t.handle.sql`DELETE FROM session WHERE state IN ('laeuft','pausiert')`;
      const deck = await mkDeck();
      await mkSession({ state, deck, number: 3 });
      const res = await optionsOk(mod, ses);
      const item = res.items.find((i) => i.deck.id === deck)!;
      expect(item.free, state).toBe(false);
      expect(item.used_by, state).toEqual([{ session_id: expect.any(String), number: 3, title: null }]);
      expect(res.suggested_deck_id === deck, state).toBe(false);
    }
    const missed = await mkDeck();
    await mkSession({ state: 'verpasst', deck: missed });
    const deletedUser = await mkDeck();
    await mkSession({ state: 'beendet', deck: deletedUser, deleted: true });
    const res = await optionsOk(mod, ses);
    expect(res.items.find((i) => i.deck.id === missed)).toMatchObject({ free: true, used_by: [] });
    expect(res.items.find((i) => i.deck.id === deletedUser)).toMatchObject({ free: true, used_by: [] });
    // `deletedUser` wurde zuletzt angelegt und ist frei: Vorschlag
    expect(res.suggested_deck_id).toBe(deletedUser);
  });

  it('die anfragende Session zählt nie als Belegung; ohne session_id zählen alle', async () => {
    const deck = await mkDeck();
    const ses = await mkSession({ deck, state: 'laeuft' });
    const own = await optionsOk(mod, ses);
    expect(own.items[0]).toMatchObject({ free: true, used_by: [] });
    expect(own.current_deck_id).toBe(deck);
    expect(own.suggested_deck_id).toBeNull(); // hat schon einen Satz
    const anon = await optionsOk(mod);
    expect(anon).toMatchObject({
      session_id: null,
      current_deck_id: null,
      suggested_deck_id: null, // der einzige Satz ist belegt
      lock: null,
    });
    expect(anon.items[0]).toMatchObject({ free: false });
    expect(anon.items[0]!.used_by).toHaveLength(1);
  });

  it('ohne session_id: Vorschlag ist der neueste freie Satz des Moduls, sonst null; current_deck_id und lock bleiben null', async () => {
    // Kein Satz: kein Vorschlag
    expect((await optionsOk(mod)).suggested_deck_id).toBeNull();
    const older = await mkDeck({ uploadedAt: '2026-11-01T09:00:00Z' });
    const newest = await mkDeck({ uploadedAt: '2026-11-05T09:00:00Z' });
    const res = await optionsOk(mod);
    expect(res).toMatchObject({
      session_id: null,
      current_deck_id: null,
      lock: null,
      suggested_deck_id: newest,
    });
    expect(res.items.map((o) => o.deck.id)).toEqual([newest, older]);
    // Der neueste ist belegt: der Vorschlag rückt auf den nächsten freien
    await mkSession({ state: 'beendet', deck: newest });
    expect((await optionsOk(mod)).suggested_deck_id).toBe(older);
    // Alle belegt: null
    await mkSession({ state: 'bereit', deck: older });
    expect((await optionsOk(mod)).suggested_deck_id).toBeNull();
  });

  it('ohne session_id: ein Satz, den nur eine verpasst-Session trägt, gilt als frei und wird vorgeschlagen', async () => {
    const deck = await mkDeck();
    await mkSession({ state: 'verpasst', deck });
    const res = await optionsOk(mod);
    expect(res.items[0]).toMatchObject({ free: true, used_by: [] });
    expect(res.suggested_deck_id).toBe(deck);
  });

  it('ohne session_id: Sätze anderer Module, gelöschte und fehlerhafte werden nicht vorgeschlagen', async () => {
    await mkDeck({ module: otherMod });
    await mkDeck({ deleted: true });
    await mkDeck({ state: 'fehler' });
    expect((await optionsOk(mod)).suggested_deck_id).toBeNull();
  });

  it('gelöscht und fehler sind nicht wählbar, neu und verarbeitet schon; fremde Module nicht', async () => {
    const ok1 = await mkDeck({ state: 'neu' });
    const ok2 = await mkDeck({ state: 'verarbeitet' });
    await mkDeck({ state: 'fehler' });
    await mkDeck({ deleted: true });
    await mkDeck({ module: otherMod });
    const res = await optionsOk(mod, await mkSession());
    expect(res.items.map((i) => i.deck.id).sort()).toEqual([ok1, ok2].sort());
  });

  it('available_at: Moodle-Datum (größtes, NULL ignoriert, auch removed), sonst Upload; source', async () => {
    const moodleDeck = await mkDeck({ uploadedAt: '2026-11-17T09:00:00Z' });
    await mkMoodleItem(moodleDeck, '2026-11-02T08:00:00Z');
    await mkMoodleItem(moodleDeck, '2026-11-09T08:00:00Z', true);
    await mkMoodleItem(moodleDeck, null);
    const nullOnly = await mkDeck({ uploadedAt: '2026-11-12T09:00:00Z' });
    await mkMoodleItem(nullOnly, null);
    const upload = await mkDeck({ uploadedAt: '2026-11-04T09:00:00Z' });
    const res = await optionsOk(mod, await mkSession());
    const by = (id: string) => res.items.find((i) => i.deck.id === id)!;
    expect(by(moodleDeck)).toMatchObject({ source: 'moodle', available_at: '2026-11-09T08:00:00.000Z' });
    expect(by(nullOnly)).toMatchObject({ source: 'moodle', available_at: '2026-11-12T09:00:00.000Z' });
    expect(by(upload)).toMatchObject({ source: 'upload', available_at: '2026-11-04T09:00:00.000Z' });
    // Moodle-Datum statt Upload-Datum bestimmt die Reihenfolge: der später hochgeladene Moodle-Satz ist älter
    expect(res.items.map((i) => i.deck.id)).toEqual(
      [nullOnly, moodleDeck, upload].sort(
        (x, y) => Date.parse(by(y).available_at) - Date.parse(by(x).available_at),
      ),
    );
    expect(res.suggested_deck_id).toBe(nullOnly);
  });

  it('used_by: höchstens 3, sortiert nach coalesce(started_at, created_at) absteigend', async () => {
    const deck = await mkDeck();
    const times = [
      '2026-11-01T10:00:00Z',
      '2026-11-08T10:00:00Z',
      '2026-11-03T10:00:00Z',
      '2026-11-15T10:00:00Z',
    ];
    const ids: string[] = [];
    for (const [i, at] of times.entries())
      ids.push(await mkSession({ state: 'verarbeitet', deck, number: i + 1, startedAt: at }));
    // ohne started_at: created_at (jetzt) ist am neuesten
    const planned = await mkSession({ state: 'geplant', deck, number: 9 });
    const res = await optionsOk(mod, await mkSession());
    expect(res.items[0]!.used_by.map((u) => u.session_id)).toEqual([planned, ids[3], ids[1]]);
  });

  it('der aktuelle Satz ist immer dabei: auch bei fehler und jenseits der 50, free false wenn er selbst belegt ist', async () => {
    const current = await mkDeck({ state: 'fehler', uploadedAt: '2020-01-01T00:00:00Z' });
    await mkSession({ deck: current, state: 'beendet' });
    const ses = await mkSession({ deck: current });
    for (let i = 0; i < 52; i++) await mkDeck();
    const res = await optionsOk(mod, ses);
    expect(res.items).toHaveLength(51);
    expect(res.items.at(-1)!.deck.id).toBe(current);
    expect(res.items.at(-1)).toMatchObject({ free: false });
    expect(res.current_deck_id).toBe(current);
  });

  it('der Vorschlag ist immer dabei, auch wenn die ersten 50 belegt sind', async () => {
    const other = await mkSession({ state: 'beendet' });
    void other;
    for (let i = 0; i < 50; i++)
      await mkSession({
        state: 'beendet',
        deck: await mkDeck({ uploadedAt: new Date(Date.UTC(2026, 10, 10, 0, i)).toISOString() }),
      });
    const free = await mkDeck({ uploadedAt: '2026-01-01T00:00:00Z' });
    const res = await optionsOk(mod, await mkSession());
    expect(res.suggested_deck_id).toBe(free);
    expect(res.items.at(-1)!.deck.id).toBe(free);
    expect(res.items).toHaveLength(51);
  });

  it('gelöschter Satz an der Session: current_deck_id null, Vorschlag möglich, lock aus dem Zeiger', async () => {
    const dead = await mkDeck({ deleted: true });
    const free = await mkDeck();
    const ses = await mkSession({ deck: dead });
    let res = await optionsOk(mod, ses);
    expect(res).toMatchObject({ current_deck_id: null, suggested_deck_id: free, lock: null });
    await mkSlideEvent(ses);
    res = await optionsOk(mod, ses);
    expect(res).toMatchObject({ current_deck_id: null, lock: 'folienwechsel' });
  });

  it.each(['beendet', 'verarbeitet', 'verpasst'])(
    'abgeschlossene Session (%s) ohne Satz: kein Vorschlag, obwohl ein freier Satz da ist; lock abgeschlossen',
    async (state) => {
      const free = await mkDeck();
      const ses = await mkSession({ state });
      const res = await optionsOk(mod, ses);
      expect(res.items.find((o) => o.deck.id === free)?.free).toBe(true);
      expect(res.suggested_deck_id).toBeNull();
      expect(res.current_deck_id).toBeNull();
      expect(res.lock).toBe('abgeschlossen');
      // Gegenprobe: dieselbe Lage in einer offenen Session ergibt den Vorschlag
      const open = await mkSession({ state: 'bereit' });
      expect((await optionsOk(mod, open)).suggested_deck_id).toBe(free);
    },
  );

  it('Zeiger auf einen Satz eines anderen Moduls: current_deck_id null, Satz nicht in items, lock aus dem Zeiger', async () => {
    const foreign = await mkDeck({ module: otherMod });
    const own = await mkDeck();
    const ses = await mkSession({ state: 'bereit', deck: foreign });
    await mkSlideEvent(ses);
    const res = await optionsOk(mod, ses);
    expect(res.current_deck_id).toBeNull();
    expect(res.items.map((o) => o.deck.id)).toEqual([own]);
    expect(res.lock).toBe('folienwechsel');
    expect(res.suggested_deck_id).toBe(own);
  });

  it('lock: abgeschlossen (beendet, verarbeitet, verpasst), folienwechsel, sonst null; gelöschte slide_event zählen nicht', async () => {
    const deck = await mkDeck();
    for (const state of ['beendet', 'verarbeitet', 'verpasst']) {
      const closed = await mkSession({ state, deck: state === 'verpasst' ? null : deck });
      const res = await optionsOk(mod, closed);
      expect(res.lock, state).toBe('abgeschlossen');
      expect(res.suggested_deck_id, state).toBeNull();
    }
    const running = await mkSession({ state: 'laeuft', deck });
    expect((await optionsOk(mod, running)).lock).toBeNull();
    await mkSlideEvent(running, true);
    expect((await optionsOk(mod, running)).lock).toBeNull();
    await mkSlideEvent(running);
    expect((await optionsOk(mod, running)).lock).toBe('folienwechsel');
    // ohne Satz keine Sperre, auch mit slide_event
    const noDeck = await mkSession({ state: 'bereit' });
    await mkSlideEvent(noDeck);
    expect((await optionsOk(mod, noDeck)).lock).toBeNull();
  });
});

// ---- PATCH ----------------------------------------------------------------------------------

describe('PATCH /sessions/{id} mit slide_deck_id (§22.4)', () => {
  it.each(['geplant', 'bereit', 'laeuft', 'pausiert'])('setzen, wechseln, leeren in %s', async (state) => {
    const a = await mkDeck();
    const b = await mkDeck();
    const ses = await mkSession({ state });
    let res = await patch(ses, { slide_deck_id: a });
    expect(res.statusCode).toBe(200);
    expect(SessionSchema.parse(res.json()).slide_deck_id).toBe(a);
    expect(await deckHint(a)).toBe(ses);
    expect(updatedFor(ses)).toHaveLength(1);
    res = await patch(ses, { slide_deck_id: b });
    expect(res.statusCode).toBe(200);
    expect((await sessionRow(ses)).slide_deck_id).toBe(b);
    // Hinweis: alter Satz verliert ihn, neuer bekommt ihn
    expect(await deckHint(a)).toBeNull();
    expect(await deckHint(b)).toBe(ses);
    res = await patch(ses, { slide_deck_id: null });
    expect(res.statusCode).toBe(200);
    expect((await sessionRow(ses)).slide_deck_id).toBeNull();
    expect(await deckHint(b)).toBeNull();
    expect(updatedFor(ses)).toHaveLength(3);
  });

  it.each(['beendet', 'verarbeitet', 'verpasst'])(
    'abgeschlossen (%s): 409 slide_deck_session_closed mit details.state',
    async (state) => {
      const a = await mkDeck();
      const ses = await mkSession({ state });
      const res = await patch(ses, { slide_deck_id: a });
      expect(res.statusCode).toBe(409);
      expect(ApiErrorSchema.parse(res.json()).error).toMatchObject({
        code: 'slide_deck_session_closed',
        details: { state },
      });
      expect((await sessionRow(ses)).slide_deck_id).toBeNull();
      expect(updatedFor(ses)).toHaveLength(0);
      // title allein geht in jedem Zustand
      const ok = await patch(ses, { title: 'Neu' });
      expect(ok.statusCode).toBe(200);
      expect((await sessionRow(ses)).title).toBe('Neu');
    },
  );

  it('gleicher Wert: 200 ohne Ereignis, auch in abgeschlossenen Sessions und für null', async () => {
    const a = await mkDeck();
    const closed = await mkSession({ state: 'beendet', deck: a });
    const before = await sessionRow(closed);
    let res = await patch(closed, { slide_deck_id: a });
    expect(res.statusCode).toBe(200);
    expect(SessionSchema.parse(res.json()).slide_deck_id).toBe(a);
    const none = await mkSession({ state: 'verpasst' });
    res = await patch(none, { slide_deck_id: null });
    expect(res.statusCode).toBe(200);
    // auch bei Sperre durch Folienwechsel
    const running = await mkSession({ state: 'laeuft', deck: a });
    await mkSlideEvent(running);
    res = await patch(running, { slide_deck_id: a });
    expect(res.statusCode).toBe(200);
    expect(events).toHaveLength(0);
    expect(new Date((await sessionRow(closed)).updated_at)).toEqual(new Date(before.updated_at));
  });

  it('Sperre durch slide_event: Wechsel und Leeren 409 slide_deck_locked mit details; gelöschte slide_event sperren nicht', async () => {
    const a = await mkDeck();
    const b = await mkDeck();
    const ses = await mkSession({ state: 'laeuft', deck: a });
    await mkSlideEvent(ses, true);
    expect((await patch(ses, { slide_deck_id: b })).statusCode).toBe(200);
    expect((await patch(ses, { slide_deck_id: a })).statusCode).toBe(200);
    events = [];
    await mkSlideEvent(ses);
    await mkSlideEvent(ses);
    for (const body of [{ slide_deck_id: b }, { slide_deck_id: null }]) {
      const res = await patch(ses, body);
      expect(res.statusCode).toBe(409);
      expect(ApiErrorSchema.parse(res.json()).error).toMatchObject({
        code: 'slide_deck_locked',
        details: { slide_deck_id: a, slide_events: 2 },
      });
    }
    expect((await sessionRow(ses)).slide_deck_id).toBe(a);
    expect(updatedFor(ses)).toHaveLength(0);
    // title und Wechsel zusammen: alles oder nichts
    const both = await patch(ses, { title: 'X', slide_deck_id: b });
    expect(both.statusCode).toBe(409);
    expect((await sessionRow(ses)).title).toBeNull();
  });

  it('Sperre gilt auch, wenn der Satz gelöscht ist (Zeiger zählt); ohne slide_event geht der Wechsel', async () => {
    const dead = await mkDeck({ deleted: true });
    const b = await mkDeck();
    const locked = await mkSession({ state: 'bereit', deck: dead });
    await mkSlideEvent(locked);
    const res = await patch(locked, { slide_deck_id: b });
    expect(res.statusCode).toBe(409);
    expect(errCode(res)).toBe('slide_deck_locked');
    expect((await patch(locked, { slide_deck_id: null })).statusCode).toBe(409);
    const free = await mkSession({ state: 'bereit', deck: dead });
    expect((await patch(free, { slide_deck_id: b })).statusCode).toBe(200);
  });

  it('von „kein Satz“ aus gibt es keine Sperre, auch mit slide_event', async () => {
    const a = await mkDeck();
    const ses = await mkSession({ state: 'laeuft' });
    await mkSlideEvent(ses);
    const res = await patch(ses, { slide_deck_id: a });
    expect(res.statusCode).toBe(200);
  });

  it('POST /sessions mit slide_deck_id (spontaner Start): setzt den Satz, Hinweis und Ereignis; Fehler legen nichts an', async () => {
    const deck = await mkDeck();
    const post = (body: Record<string, unknown>) =>
      t.request({ method: 'POST', url: `${API}/sessions`, payload: body });
    const res = await post({ module_id: mod, slide_deck_id: deck });
    expect(res.statusCode).toBe(201);
    const created = res.json() as { id: string; slide_deck_id: string | null; state: string };
    expect([created.state, created.slide_deck_id]).toEqual(['bereit', deck]);
    expect((await sessionRow(created.id)).slide_deck_id).toBe(deck);
    expect(await deckHint(deck)).toBe(created.id);
    expect(updatedFor(created.id)).toHaveLength(1);
    // Danach ist der Satz belegt, der Vorschlag rückt weiter
    expect((await optionsOk(mod)).items.find((o) => o.deck.id === deck)?.free).toBe(false);
    const before = (await t.handle.sql`SELECT 1 FROM session`).length;
    let bad = await post({ module_id: mod, slide_deck_id: uuidv7() });
    expect([bad.statusCode, errCode(bad)]).toEqual([404, 'slide_deck_not_found']);
    bad = await post({ module_id: mod, slide_deck_id: await mkDeck({ deleted: true }) });
    expect([bad.statusCode, errCode(bad)]).toEqual([404, 'slide_deck_not_found']);
    bad = await post({ module_id: mod, slide_deck_id: await mkDeck({ module: otherMod }) });
    expect([bad.statusCode, errCode(bad)]).toEqual([400, 'slide_deck_module_mismatch']);
    expect(await t.handle.sql`SELECT 1 FROM session`).toHaveLength(before);
  });

  describe('POST /sessions/{id}/start mit slide_deck_id (§22.4): setzt nur, wenn noch kein gültiger Satz da ist', () => {
    const start = (id: string, deck: string) =>
      t.request({
        method: 'POST',
        url: `${API}/sessions/${id}/start`,
        payload: { started_from: 'mac', slide_deck_id: deck },
      });

    it('Session hat schon einen Satz: der mitgeschickte (veraltete) wird ignoriert, 200, auch ein unbekannter', async () => {
      const own = await mkDeck();
      const stale = await mkDeck();
      const ses = await mkSession({ state: 'bereit', deck: own });
      const res = await start(ses, stale);
      expect(res.statusCode).toBe(200);
      expect((await sessionRow(ses)).slide_deck_id).toBe(own);
      expect(await deckHint(stale)).toBeNull();
      const ses2 = await mkSession({ state: 'geplant', deck: own });
      expect((await start(ses2, uuidv7())).statusCode).toBe(200);
      expect((await sessionRow(ses2)).slide_deck_id).toBe(own);
    });

    it('Session ohne Satz: der mitgeschickte wird gesetzt; fremd oder gelöscht: 404 bzw. 400', async () => {
      const deck = await mkDeck();
      const ses = await mkSession({ state: 'bereit' });
      const bad = await start(ses, await mkDeck({ module: otherMod }));
      expect([bad.statusCode, errCode(bad)]).toEqual([400, 'slide_deck_module_mismatch']);
      const gone = await start(ses, await mkDeck({ deleted: true }));
      expect([gone.statusCode, errCode(gone)]).toEqual([404, 'slide_deck_not_found']);
      expect((await sessionRow(ses)).slide_deck_id).toBeNull();
      expect((await start(ses, deck)).statusCode).toBe(200);
      expect((await sessionRow(ses)).slide_deck_id).toBe(deck);
      expect(await deckHint(deck)).toBe(ses);
    });

    it('Zeiger auf gelöschten Satz (oder Satz eines anderen Moduls): zählt als kein Satz, der mitgeschickte wird gesetzt', async () => {
      const deck = await mkDeck();
      const dead = await mkDeck({ deleted: true });
      const ses = await mkSession({ state: 'bereit', deck: dead });
      expect((await start(ses, deck)).statusCode).toBe(200);
      expect((await sessionRow(ses)).slide_deck_id).toBe(deck);
      const deck2 = await mkDeck();
      const foreign = await mkDeck({ module: otherMod });
      const ses2 = await mkSession({ state: 'bereit', deck: foreign });
      expect((await start(ses2, deck2)).statusCode).toBe(200);
      expect((await sessionRow(ses2)).slide_deck_id).toBe(deck2);
    });
  });

  it('Satz fehlt oder gelöscht: 404; anderes Modul: 400; Zustandsprüfung geht vor', async () => {
    const ses = await mkSession();
    let res = await patch(ses, { slide_deck_id: uuidv7() });
    expect([res.statusCode, errCode(res)]).toEqual([404, 'slide_deck_not_found']);
    res = await patch(ses, { slide_deck_id: await mkDeck({ deleted: true }) });
    expect([res.statusCode, errCode(res)]).toEqual([404, 'slide_deck_not_found']);
    res = await patch(ses, { slide_deck_id: await mkDeck({ module: otherMod }) });
    expect([res.statusCode, errCode(res)]).toEqual([400, 'slide_deck_module_mismatch']);
    const closed = await mkSession({ state: 'beendet' });
    res = await patch(closed, { slide_deck_id: uuidv7() });
    expect(errCode(res)).toBe('slide_deck_session_closed');
    // Sperre geht vor 404
    const a = await mkDeck();
    const locked = await mkSession({ state: 'laeuft', deck: a });
    await mkSlideEvent(locked);
    res = await patch(locked, { slide_deck_id: uuidv7() });
    expect(errCode(res)).toBe('slide_deck_locked');
    expect(updatedFor(ses)).toHaveLength(0);
  });

  it('Satz mit ingest_state fehler ist erlaubt, wird aber nicht angeboten', async () => {
    const bad = await mkDeck({ state: 'fehler' });
    const ses = await mkSession();
    const res = await patch(ses, { slide_deck_id: bad });
    expect(res.statusCode).toBe(200);
  });

  it('belegter Satz einer anderen Session ist kein Fehler; Hinweis bleibt bei der ersten Session', async () => {
    const a = await mkDeck();
    const first = await mkSession({ state: 'beendet', deck: a });
    await t.handle.sql`UPDATE slide_deck SET session_id = ${first} WHERE id = ${a}`;
    const ses = await mkSession();
    expect((await patch(ses, { slide_deck_id: a })).statusCode).toBe(200);
    expect(await deckHint(a)).toBe(first);
    // Leeren der zweiten Session lässt den Hinweis der ersten stehen
    expect((await patch(ses, { slide_deck_id: null })).statusCode).toBe(200);
    expect(await deckHint(a)).toBe(first);
  });

  it('title und slide_deck_id: alles oder nichts, ein Ereignis; nur title: Ereignis nur bei Änderung', async () => {
    const a = await mkDeck();
    const ses = await mkSession({ title: 'Alt' });
    let res = await patch(ses, { title: 'Neu', slide_deck_id: a });
    expect(res.statusCode).toBe(200);
    expect(await sessionRow(ses)).toMatchObject({ title: 'Neu', slide_deck_id: a });
    expect(updatedFor(ses)).toHaveLength(1);
    // Fehler im Satz: der Titel bleibt
    res = await patch(ses, { title: 'Nochmal', slide_deck_id: uuidv7() });
    expect(res.statusCode).toBe(404);
    expect((await sessionRow(ses)).title).toBe('Neu');
    // gleicher Titel, gleicher Satz: kein Ereignis
    res = await patch(ses, { title: 'Neu', slide_deck_id: a });
    expect(res.statusCode).toBe(200);
    expect(updatedFor(ses)).toHaveLength(1);
    // gleicher Satz, anderer Titel: ein Ereignis, auch in einer abgeschlossenen Session
    await t.handle.sql`UPDATE session SET state = 'beendet' WHERE id = ${ses}`;
    res = await patch(ses, { title: 'Spät', slide_deck_id: a });
    expect(res.statusCode).toBe(200);
    expect(updatedFor(ses)).toHaveLength(2);
  });

  it('updated_at steigt mit jeder Änderung strikt', async () => {
    const a = await mkDeck();
    const b = await mkDeck();
    const ses = await mkSession();
    const at = async () => new Date((await sessionRow(ses)).updated_at).getTime();
    const t0 = await at();
    await patch(ses, { slide_deck_id: a });
    const t1 = await at();
    await patch(ses, { slide_deck_id: b });
    const t2 = await at();
    expect(t1).toBeGreaterThan(t0);
    expect(t2).toBeGreaterThan(t1);
  });

  it('Session unbekannt oder gelöscht: 404 session_not_found', async () => {
    const res = await patch(uuidv7(), { slide_deck_id: null });
    expect([res.statusCode, errCode(res)]).toEqual([404, 'session_not_found']);
    const gone = await mkSession({ deleted: true });
    expect(errCode(await patch(gone, { slide_deck_id: null }))).toBe('session_not_found');
  });

  it('Start mit slide_deck_id in bereit überschreibt einen vorhandenen gültigen Satz nicht mehr (§22.4)', async () => {
    const a = await mkDeck();
    const b = await mkDeck();
    const ses = await mkSession({ state: 'bereit', deck: a });
    const res = await t.request({
      method: 'POST',
      url: `${API}/sessions/${ses}/start`,
      payload: { started_from: 'mac', slide_deck_id: b },
    });
    expect(res.statusCode).toBe(200);
    expect((await sessionRow(ses)).slide_deck_id).toBe(a);
  });
});

// ---- Upload ---------------------------------------------------------------------------------

describe('Upload mit session_id (§22.5)', () => {
  const dataDir = join('/tmp', `sg-deck-session-${process.pid}`);
  let n = 0;
  const upload = (label?: string) => {
    mkdirSync(join(dataDir, 'media', '.tmp'), { recursive: true });
    const tmpPath = join(dataDir, 'media', '.tmp', `u${++n}-${randomBytes(4).toString('hex')}`);
    const content = `%PDF-1.4 ${label ?? randomBytes(6).toString('hex')}`;
    writeFileSync(tmpPath, content);
    return {
      tmpPath,
      size: content.length,
      sha256: createHash('sha256').update(content).digest('hex'),
      filename: 'f.pdf',
    };
  };
  const put = (sessionId: string, label?: string) =>
    createSlideDeck(t.handle.db, dataDir, upload(label), { moduleId: mod, sessionId });

  it('hängt den Satz an eine Session ohne Satz (setzt nur, ersetzt nie)', async () => {
    const ses = await mkSession({ state: 'laeuft' });
    const first = await put(ses);
    expect((await sessionRow(ses)).slide_deck_id).toBe(first.id);
    expect(await deckHint(first.id)).toBe(ses);
    expect(updatedFor(ses)).toHaveLength(1);
    const second = await put(ses);
    expect(second.id).not.toBe(first.id);
    expect((await sessionRow(ses)).slide_deck_id).toBe(first.id);
    expect(updatedFor(ses)).toHaveLength(1);
  });

  it.each(['beendet', 'verarbeitet', 'verpasst'])(
    'abgeschlossen (%s): 409, es entsteht kein Satz und keine Datei',
    async (state) => {
      const ses = await mkSession({ state });
      const up = upload();
      const decksDir0 = join(dataDir, 'media', 'decks');
      const decksBefore = existsSync(decksDir0) ? readdirSync(decksDir0) : [];
      await expect(
        createSlideDeck(t.handle.db, dataDir, up, { moduleId: mod, sessionId: ses }),
      ).rejects.toMatchObject({ statusCode: 409, code: 'slide_deck_session_closed', details: { state } });
      expect(await t.handle.sql`SELECT 1 FROM slide_deck`).toHaveLength(0);
      expect(await t.handle.sql`SELECT 1 FROM job`).toHaveLength(0);
      // Die hochgeladene Temp-Datei wurde nie verschoben (der Aufrufer räumt sie auf)
      expect(existsSync(up.tmpPath)).toBe(true);
      // Keine Datei im Satz-Ordner (nichts abgelegt, nichts liegen geblieben)
      const decksDir = join(dataDir, 'media', 'decks');
      expect(existsSync(decksDir) ? readdirSync(decksDir) : []).toEqual(decksBefore);
    },
  );

  it('Zeiger auf gelöschten Satz ohne slide_event: Upload hängt an; mit slide_event nicht', async () => {
    const dead = await mkDeck({ deleted: true });
    const free = await mkSession({ state: 'bereit', deck: dead });
    await t.handle.sql`UPDATE slide_deck SET session_id = ${free} WHERE id = ${dead}`;
    const up = await put(free);
    expect((await sessionRow(free)).slide_deck_id).toBe(up.id);
    // Der gelöschte alte Satz wird nicht angefasst, sein Hinweis bleibt (§22.1)
    expect(await deckHint(dead)).toBe(free);
    expect(updatedFor(free)).toHaveLength(1);

    const dead2 = await mkDeck({ deleted: true });
    const locked = await mkSession({ state: 'bereit', deck: dead2 });
    await mkSlideEvent(locked);
    const up2 = await put(locked);
    expect(up2.duplicate).toBe(false);
    expect((await sessionRow(locked)).slide_deck_id).toBe(dead2);
    expect(updatedFor(locked)).toHaveLength(0);
  });

  it('Zeiger auf lebenden Satz: nichts ersetzt, auch ohne slide_event', async () => {
    const a = await mkDeck();
    const ses = await mkSession({ state: 'laeuft', deck: a });
    await put(ses);
    expect((await sessionRow(ses)).slide_deck_id).toBe(a);
  });

  it('falsches Modul und unbekannte Session: 400 / 404', async () => {
    const foreign = await mkSession({ module: otherMod });
    await expect(put(foreign)).rejects.toMatchObject({ statusCode: 400, code: 'session_module_mismatch' });
    await expect(put(uuidv7())).rejects.toMatchObject({ statusCode: 404, code: 'session_not_found' });
  });

  it('HTTP: 409 mit Fehlercode über POST /slide-decks', async () => {
    const ses = await mkSession({ state: 'beendet' });
    const boundary = '----sgdeck';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="module_id"\r\n\r\n${mod}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="session_id"\r\n\r\n${ses}\r\n`),
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="f.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4 http\r\n--${boundary}--\r\n`,
      ),
    ]);
    const res = await t.request({
      method: 'POST',
      url: `${API}/slide-decks`,
      payload: body,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    expect(res.statusCode).toBe(409);
    expect(ApiErrorSchema.parse(res.json()).error).toMatchObject({
      code: 'slide_deck_session_closed',
      details: { state: 'beendet' },
    });
  });
});

// ---- Nebenläufigkeit ------------------------------------------------------------------------

async function blockedCount(): Promise<number> {
  const rows = await t.handle.sql`
    SELECT count(*)::int AS n FROM pg_stat_activity
    WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`;
  return rows[0]?.n ?? 0;
}
async function waitForBlocked(n: number): Promise<void> {
  await vi.waitFor(async () => expect(await blockedCount()).toBeGreaterThanOrEqual(n), {
    timeout: 5_000,
    interval: 25,
  });
}
const errorCode = (e: unknown): string | undefined =>
  (e as { code?: string })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;

describe('Nebenläufigkeit (§22.4, §22.5, §16.2)', () => {
  it('PATCH ‖ slide.change: hält der Folienwechsel den Strom, wartet PATCH und sieht ihn danach (kein Durchrutschen)', async () => {
    const a = await mkDeck();
    const b = await mkDeck();
    const ses = await mkSession({ state: 'laeuft', deck: a });
    const gate = await t.handle.sql.reserve();
    let patched: Promise<{ statusCode: number; json: () => unknown }> | undefined;
    try {
      // wie `appendOp` + `slide.change`: Strom `FOR UPDATE`, dann `slide_event` (FK auf die Session: KEY SHARE)
      await gate`BEGIN`;
      await gate`INSERT INTO sync_stream (stream, head_seq) VALUES (${'session:' + ses}, 0) ON CONFLICT DO NOTHING`;
      await gate`SELECT head_seq FROM sync_stream WHERE stream = ${'session:' + ses} FOR UPDATE`;
      await gate`INSERT INTO slide_event ${gate({ id: uuidv7(), ...base, session_id: ses, slide_index: 2, t_ms: 5, device: 'mac', source: 'manuell_mac' })}`;
      patched = patch(ses, { slide_deck_id: b });
      // PATCH hängt am Strom: Es hat noch nicht entschieden
      await waitForBlocked(1);
      expect((await sessionRow(ses)).slide_deck_id).toBe(a);
      await gate`COMMIT`;
    } finally {
      await gate`ROLLBACK`.catch(() => undefined);
      gate.release();
    }
    const [settled] = await Promise.allSettled([patched]);
    expect(settled.status).toBe('fulfilled');
    const res = (settled as PromiseFulfilledResult<{ statusCode: number; json: () => unknown }>).value;
    expect(res.statusCode).toBe(409);
    expect(errCode(res)).toBe('slide_deck_locked');
    expect((await sessionRow(ses)).slide_deck_id).toBe(a);
  });

  it('slide.change nach einem laufenden PATCH wartet auf dessen Ende und wird angenommen, danach ist gesperrt', async () => {
    const a = await mkDeck();
    const b = await mkDeck();
    const ses = await mkSession({ state: 'laeuft', deck: a });
    const gate = await t.handle.sql.reserve();
    let change: Promise<unknown> | undefined;
    try {
      // PATCH hält Zustandswechsel-Sperre und Session-Zeile (wie in `updateSession`), dann den Strom
      await gate`BEGIN`;
      await gate`SELECT pg_advisory_xact_lock(hashtextextended('sg:session-transition', 0))`;
      await gate`SELECT id FROM session WHERE id = ${ses} FOR NO KEY UPDATE`;
      await gate`INSERT INTO sync_stream (stream, head_seq) VALUES (${'session:' + ses}, 0) ON CONFLICT DO NOTHING`;
      await gate`SELECT head_seq FROM sync_stream WHERE stream = ${'session:' + ses} FOR UPDATE`;
      change = t.handle.sql.begin(async (tx) => {
        await tx`INSERT INTO sync_stream (stream, head_seq) VALUES (${'session:' + ses}, 0) ON CONFLICT DO NOTHING`;
        await tx`SELECT head_seq FROM sync_stream WHERE stream = ${'session:' + ses} FOR UPDATE`;
        await tx`INSERT INTO slide_event ${tx({ id: uuidv7(), ...base, session_id: ses, slide_index: 2, t_ms: 5, device: 'mac', source: 'manuell_mac' })}`;
      });
      await waitForBlocked(1);
      await gate`UPDATE session SET slide_deck_id = ${b} WHERE id = ${ses}`;
      await gate`COMMIT`;
    } finally {
      await gate`ROLLBACK`.catch(() => undefined);
      gate.release();
    }
    const [settled] = await Promise.allSettled([change]);
    expect(settled.status).toBe('fulfilled');
    expect((await patch(ses, { slide_deck_id: a })).statusCode).toBe(409);
  });

  it('PATCH ‖ Upload mit session_id: gleiche Reihenfolge, kein 40P01', async () => {
    const a = await mkDeck();
    const ses = await mkSession({ state: 'laeuft' });
    mkdirSync('/tmp/sg-deck-session-race/media/.tmp', { recursive: true });
    const content = '%PDF-1.4 race';
    const tmpPath = '/tmp/sg-deck-session-race/media/.tmp/race';
    writeFileSync(tmpPath, content);
    const sha = createHash('sha256').update(content).digest('hex');
    const gate = await t.handle.sql.reserve();
    let uploading: Promise<unknown> | undefined;
    let gateError: unknown = null;
    try {
      // PATCH-Reihenfolge: Zustandswechsel-Sperre → Session-Zeile → (Strom) → Sperren der Datei/Sätze
      await gate`BEGIN`;
      await gate`SELECT pg_advisory_xact_lock(hashtextextended('sg:session-transition', 0))`;
      await gate`SELECT id FROM session WHERE id = ${ses} FOR NO KEY UPDATE`;
      uploading = createSlideDeck(
        t.handle.db,
        '/tmp/sg-deck-session-race',
        { tmpPath, size: content.length, sha256: sha, filename: 'r.pdf' },
        { moduleId: mod, sessionId: ses },
      ).catch((e: unknown) => e);
      // Richtig: Der Upload hängt an der Zustandswechsel-Sperre und hat die Datei-Sperre noch nicht.
      // Falsch (alte Reihenfolge): Er hält die Datei-Sperre und wartet auf die Session, dann wartet das Gate auf ihn.
      await waitForBlocked(1);
      try {
        await gate`SELECT pg_advisory_xact_lock(hashtextextended(${`deck:${mod}:${sha}`}, 0))`;
        await gate`SELECT id FROM slide_deck WHERE module_id = ${mod} ORDER BY id FOR NO KEY UPDATE`;
        await gate`UPDATE session SET slide_deck_id = ${a}, updated_at = clock_timestamp() WHERE id = ${ses}`;
        await gate`COMMIT`;
      } catch (e) {
        gateError = e;
        await gate`ROLLBACK`.catch(() => undefined);
      }
    } finally {
      await gate`ROLLBACK`.catch(() => undefined);
      gate.release();
    }
    const [res] = await Promise.allSettled([uploading]);
    expect(errorCode(gateError)).toBeUndefined();
    expect(res.status).toBe('fulfilled');
    expect((res as PromiseFulfilledResult<unknown>).value).not.toBeInstanceOf(Error);
    // Der Upload kam nach dem PATCH: Die Session hat schon einen Satz und behält ihn
    expect((await sessionRow(ses)).slide_deck_id).toBe(a);
  });

  it('PATCH ‖ Upload, echt gleichzeitig, mehrere Runden: nie ein Datenbankfehler', async () => {
    mkdirSync('/tmp/sg-deck-session-race/media/.tmp', { recursive: true });
    for (let round = 0; round < 8; round++) {
      const a = await mkDeck();
      const ses = await mkSession({ state: 'bereit' });
      const content = `%PDF-1.4 round ${round} ${randomBytes(4).toString('hex')}`;
      const tmpPath = `/tmp/sg-deck-session-race/media/.tmp/r${round}`;
      writeFileSync(tmpPath, content);
      const results = await Promise.allSettled([
        patch(ses, { slide_deck_id: a }),
        createSlideDeck(
          t.handle.db,
          '/tmp/sg-deck-session-race',
          {
            tmpPath,
            size: content.length,
            sha256: createHash('sha256').update(content).digest('hex'),
            filename: 'r.pdf',
          },
          { moduleId: mod, sessionId: ses },
        ),
      ]);
      for (const r of results) expect(r.status).toBe('fulfilled');
      const res = (results[0] as PromiseFulfilledResult<{ statusCode: number }>).value;
      expect(res.statusCode).toBe(200);
      expect((await sessionRow(ses)).slide_deck_id).not.toBeNull();
    }
  });

  it('Upload mit Zeiger auf gelöschten Satz ‖ slide.change: wartet auf den Strom, hängt danach nicht an', async () => {
    const dead = await mkDeck({ deleted: true });
    const ses = await mkSession({ state: 'laeuft', deck: dead });
    mkdirSync('/tmp/sg-deck-session-race/media/.tmp', { recursive: true });
    const content = '%PDF-1.4 stream';
    const tmpPath = '/tmp/sg-deck-session-race/media/.tmp/stream';
    writeFileSync(tmpPath, content);
    const gate = await t.handle.sql.reserve();
    let uploading: Promise<unknown> | undefined;
    try {
      await gate`BEGIN`;
      await gate`INSERT INTO sync_stream (stream, head_seq) VALUES (${'session:' + ses}, 0) ON CONFLICT DO NOTHING`;
      await gate`SELECT head_seq FROM sync_stream WHERE stream = ${'session:' + ses} FOR UPDATE`;
      await gate`INSERT INTO slide_event ${gate({ id: uuidv7(), ...base, session_id: ses, slide_index: 2, t_ms: 5, device: 'mac', source: 'manuell_mac' })}`;
      uploading = createSlideDeck(
        t.handle.db,
        '/tmp/sg-deck-session-race',
        {
          tmpPath,
          size: content.length,
          sha256: createHash('sha256').update(content).digest('hex'),
          filename: 's.pdf',
        },
        { moduleId: mod, sessionId: ses },
      );
      await waitForBlocked(1);
      await gate`COMMIT`;
    } finally {
      await gate`ROLLBACK`.catch(() => undefined);
      gate.release();
      await Promise.allSettled([uploading]);
    }
    expect((await sessionRow(ses)).slide_deck_id).toBe(dead);
  });

  it('PATCH ‖ Session-Stopp: beide laufen nacheinander, entweder gesetzt und beendet oder 409 closed', async () => {
    const a = await mkDeck();
    const ses = await mkSession({ state: 'laeuft' });
    const gate = await t.handle.sql.reserve();
    let patching: Promise<{ statusCode: number; json: () => unknown }> | undefined;
    let stopping: Promise<{ statusCode: number }> | undefined;
    try {
      await gate`BEGIN`;
      await gate`SELECT pg_advisory_xact_lock(hashtextextended('sg:session-transition', 0))`;
      patching = patch(ses, { slide_deck_id: a });
      stopping = t.request({ method: 'POST', url: `${API}/sessions/${ses}/stop`, payload: {} });
      await waitForBlocked(2);
      await gate`COMMIT`;
    } finally {
      await gate`ROLLBACK`.catch(() => undefined);
      gate.release();
    }
    const [p, s] = await Promise.allSettled([patching, stopping]);
    expect(p.status).toBe('fulfilled');
    expect(s.status).toBe('fulfilled');
    const pr = (p as PromiseFulfilledResult<{ statusCode: number; json: () => unknown }>).value;
    const sr = (s as PromiseFulfilledResult<{ statusCode: number }>).value;
    expect(sr.statusCode).toBe(200);
    const row = await sessionRow(ses);
    if (pr.statusCode === 200) expect(row.slide_deck_id).toBe(a);
    else {
      expect(pr.statusCode).toBe(409);
      expect(errCode(pr)).toBe('slide_deck_session_closed');
      expect(row.slide_deck_id).toBeNull();
    }
  });

  // ---- Papierkorb, Session-Zeile, Modul löschen (Nacharbeit nach Review) ----------------------------

  /** Wartet, bis `p` fertig ist oder ein Statement an einer Sperre hängt (alte, verklemmende Reihenfolge) */
  async function settledOrBlocked(p: Promise<unknown>): Promise<void> {
    let done = false;
    void p.then(
      () => (done = true),
      () => (done = true),
    );
    await vi.waitFor(async () => expect(done || (await blockedCount()) >= 1).toBe(true), {
      timeout: 5_000,
      interval: 25,
    });
  }
  const raceDir = '/tmp/sg-deck-session-race';
  const raceFile = (content: string) => {
    mkdirSync(join(raceDir, 'media', '.tmp'), { recursive: true });
    const tmpPath = join(raceDir, 'media', '.tmp', `x-${randomBytes(4).toString('hex')}`);
    writeFileSync(tmpPath, content);
    return {
      tmpPath,
      size: content.length,
      sha256: createHash('sha256').update(content).digest('hex'),
      filename: 'x.pdf',
    };
  };
  const raceUpload = (label: string) => raceFile(`%PDF-1.4 ${label} ${randomBytes(4).toString('hex')}`);

  it('PATCH ‖ endgültiges Löschen des (gelöschten) alten Satzes: 200, kein 40P01, der gelöschte Satz wird nicht gesperrt', async () => {
    const dead = await mkDeck({ deleted: true });
    const b = await mkDeck();
    const ses = await mkSession({ state: 'bereit', deck: dead });
    await t.handle.sql`UPDATE slide_deck SET session_id = ${ses} WHERE id = ${dead}`;
    const gate = await t.handle.sql.reserve();
    let patched: Promise<{ statusCode: number }> | undefined;
    let gateError: unknown = null;
    try {
      // Das endgültige Löschen: Satz `FOR UPDATE` (trash-ops), danach DELETE (FK `SET NULL` braucht die Session-Zeile)
      await gate`BEGIN`;
      await gate`SELECT id FROM slide_deck WHERE id = ${dead} FOR UPDATE`;
      patched = patch(ses, { slide_deck_id: b });
      await settledOrBlocked(patched);
      try {
        await gate`DELETE FROM slide_deck WHERE id = ${dead}`;
        await gate`COMMIT`;
      } catch (e) {
        gateError = e;
        await gate`ROLLBACK`.catch(() => undefined);
      }
    } finally {
      await gate`ROLLBACK`.catch(() => undefined);
      gate.release();
    }
    const [res] = await Promise.allSettled([patched]);
    expect(errorCode(gateError)).toBeUndefined();
    expect(res.status).toBe('fulfilled');
    expect((res as PromiseFulfilledResult<{ statusCode: number }>).value.statusCode).toBe(200);
    expect((await sessionRow(ses)).slide_deck_id).toBe(b);
    expect(await t.handle.sql`SELECT 1 FROM slide_deck WHERE id = ${dead}`).toHaveLength(0);
  });

  it('PATCH ‖ purgeTrashItems des gelöschten Satzes: echter Deadlock-Test (Purge hält den Satz, PATCH läuft dazwischen), kein 40P01', async () => {
    const dead = await mkDeck({ deleted: true });
    const b = await mkDeck();
    const ses = await mkSession({ state: 'bereit', deck: dead });
    await t.handle.sql`UPDATE slide_deck SET session_id = ${ses} WHERE id = ${dead}`;
    // Der echte Purge nimmt den Satz `FOR UPDATE` und löscht ihn danach (der FK `SET NULL` braucht die Session-Zeile).
    // Damit der Purge den Satz hält, während PATCH die Session-Zeile nimmt, hält ihn ein BEFORE-DELETE-Trigger an
    // einer Advisory-Sperre an: Der Purge hat dann den Satz gesperrt, aber noch nicht die Session-Zeile.
    const key = 7_360_001;
    await t.handle.sql.unsafe(`
      CREATE OR REPLACE FUNCTION test_purge_pause() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN PERFORM pg_advisory_xact_lock(${key}); RETURN OLD; END $f$;
      CREATE TRIGGER test_purge_pause BEFORE DELETE ON slide_deck FOR EACH ROW EXECUTE FUNCTION test_purge_pause();
    `);
    const gate = await t.handle.sql.reserve();
    let purged: Promise<unknown> | undefined;
    let patched: Promise<{ statusCode: number }> | undefined;
    try {
      await gate`BEGIN`;
      await gate`SELECT pg_advisory_xact_lock(${key})`;
      purged = purgeTrashItems(t.handle.db, raceDir, [{ kind: 'slide_deck', id: dead }]).catch(
        (e: unknown) => e,
      );
      await waitForBlocked(1); // Der Purge hält den Satz und hängt im Trigger
      patched = patch(ses, { slide_deck_id: b });
      // Neuer Code: PATCH fasst den gelöschten Satz nicht an und ist fertig. Alter Code: PATCH hängt am Satz.
      let patchDone = false;
      void patched.then(
        () => (patchDone = true),
        () => (patchDone = true),
      );
      await vi.waitFor(async () => expect(patchDone || (await blockedCount()) >= 2).toBe(true), {
        timeout: 5_000,
        interval: 25,
      });
      await gate`COMMIT`;
    } finally {
      await gate`ROLLBACK`.catch(() => undefined);
      gate.release();
      await t.handle.sql.unsafe('DROP TRIGGER IF EXISTS test_purge_pause ON slide_deck');
    }
    const [res, pr] = await Promise.allSettled([patched, purged]);
    expect(res.status).toBe('fulfilled');
    expect((res as PromiseFulfilledResult<{ statusCode: number }>).value.statusCode).toBe(200);
    expect(pr.status).toBe('fulfilled');
    expect(errorCode((pr as PromiseFulfilledResult<unknown>).value)).toBeUndefined();
    expect((pr as PromiseFulfilledResult<unknown>).value).not.toBeInstanceOf(Error);
    expect((await sessionRow(ses)).slide_deck_id).toBe(b);
    expect(await t.handle.sql`SELECT 1 FROM slide_deck WHERE id = ${dead}`).toHaveLength(0);
  });

  it('PATCH leert den Zeiger auf einen gelöschten Satz, ohne ihn anzufassen (Hinweis bleibt)', async () => {
    const dead = await mkDeck({ deleted: true });
    const ses = await mkSession({ state: 'bereit', deck: dead });
    await t.handle.sql`UPDATE slide_deck SET session_id = ${ses} WHERE id = ${dead}`;
    const [before] = await t.handle.sql`SELECT updated_at FROM slide_deck WHERE id = ${dead}`;
    expect((await patch(ses, { slide_deck_id: null })).statusCode).toBe(200);
    expect((await sessionRow(ses)).slide_deck_id).toBeNull();
    expect(await deckHint(dead)).toBe(ses);
    const [after] = await t.handle.sql`SELECT updated_at FROM slide_deck WHERE id = ${dead}`;
    expect(after?.updated_at).toEqual(before?.updated_at);
  });

  it('Upload mit Zeiger auf gelöschten Satz ‖ endgültiges Löschen dieses Satzes: kein 40P01, Upload hängt an', async () => {
    const dead = await mkDeck({ deleted: true });
    const ses = await mkSession({ state: 'bereit', deck: dead });
    await t.handle.sql`UPDATE slide_deck SET session_id = ${ses} WHERE id = ${dead}`;
    const gate = await t.handle.sql.reserve();
    let uploading: Promise<unknown> | undefined;
    let gateError: unknown = null;
    try {
      await gate`BEGIN`;
      await gate`SELECT id FROM slide_deck WHERE id = ${dead} FOR UPDATE`;
      uploading = createSlideDeck(t.handle.db, raceDir, raceUpload('purge'), {
        moduleId: mod,
        sessionId: ses,
      }).catch((e: unknown) => e);
      await settledOrBlocked(uploading);
      try {
        await gate`DELETE FROM slide_deck WHERE id = ${dead}`;
        await gate`COMMIT`;
      } catch (e) {
        gateError = e;
        await gate`ROLLBACK`.catch(() => undefined);
      }
    } finally {
      await gate`ROLLBACK`.catch(() => undefined);
      gate.release();
    }
    const [res] = await Promise.allSettled([uploading]);
    expect(errorCode(gateError)).toBeUndefined();
    expect(res.status).toBe('fulfilled');
    const value = (res as PromiseFulfilledResult<{ id: string }>).value;
    expect(value).not.toBeInstanceOf(Error);
    expect((await sessionRow(ses)).slide_deck_id).toBe(value.id);
    expect(await t.handle.sql`SELECT 1 FROM slide_deck WHERE id = ${dead}`).toHaveLength(0);
  });

  it('PATCH ‖ Schreiber ohne Zustandswechsel-Sperre (z. B. title-PATCH, hier mit Zustandswechsel): PATCH wartet auf die Session-Zeile und sieht den neuen Zustand', async () => {
    const a = await mkDeck();
    const ses = await mkSession({ state: 'laeuft' });
    const gate = await t.handle.sql.reserve();
    let patched: Promise<{ statusCode: number; json: () => unknown }> | undefined;
    try {
      // Hält nur die Session-Zeile, nicht `lockSessionTransitions`
      await gate`BEGIN`;
      await gate`UPDATE session SET state = 'beendet', ended_at = now(), stop_reason = 'manuell' WHERE id = ${ses}`;
      patched = patch(ses, { slide_deck_id: a });
      await waitForBlocked(1);
      await gate`COMMIT`;
    } finally {
      await gate`ROLLBACK`.catch(() => undefined);
      gate.release();
    }
    const [res] = await Promise.allSettled([patched]);
    expect(res.status).toBe('fulfilled');
    const r = (res as PromiseFulfilledResult<{ statusCode: number; json: () => unknown }>).value;
    expect(r.statusCode).toBe(409);
    expect(errCode(r)).toBe('slide_deck_session_closed');
    expect((await sessionRow(ses)).slide_deck_id).toBeNull();
  });

  it('Upload mit session_id ‖ Modul löschen (Kaskade hält zuerst die Zustandswechsel-Sperre und die Sätze): kein 40P01', async () => {
    // Vorhandener Satz mit gleichem Inhalt: Der Upload hängt ihn der Session an und aktualisiert dessen Hinweis
    const content = `%PDF-1.4 dup ${randomBytes(4).toString('hex')}`;
    const x = await createSlideDeck(t.handle.db, raceDir, raceFile(content), { moduleId: mod });
    const ses = await mkSession({ state: 'bereit' });
    const gate = await t.handle.sql.reserve();
    let uploading: Promise<unknown> | undefined;
    let gateError: unknown = null;
    try {
      // Kaskade (`softDeleteWithOps`): `lockSessionTransitions`, Sätze des Moduls, dann die Session-Zeilen
      await gate`BEGIN`;
      await gate`SELECT pg_advisory_xact_lock(hashtextextended('sg:session-transition', 0))`;
      await gate`SELECT id FROM slide_deck WHERE id = ${x.id} FOR NO KEY UPDATE`;
      uploading = createSlideDeck(t.handle.db, raceDir, raceFile(content), {
        moduleId: mod,
        sessionId: ses,
      }).catch((e: unknown) => e);
      await waitForBlocked(1);
      try {
        await gate`UPDATE session SET deleted_at = now() WHERE id = ${ses}`;
        await gate`COMMIT`;
      } catch (e) {
        gateError = e;
        await gate`ROLLBACK`.catch(() => undefined);
      }
    } finally {
      await gate`ROLLBACK`.catch(() => undefined);
      gate.release();
    }
    const [res] = await Promise.allSettled([uploading]);
    expect(errorCode(gateError)).toBeUndefined();
    expect(res.status).toBe('fulfilled');
    // Die Kaskade war zuerst: Die Session ist gelöscht, der Upload scheitert sauber
    expect((res as PromiseFulfilledResult<unknown>).value).toMatchObject({
      statusCode: 404,
      code: 'session_not_found',
    });
    expect((await sessionRow(ses)).slide_deck_id).toBeNull();
  });
});
