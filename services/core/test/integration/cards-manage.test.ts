// Karten verwalten (VERTRAEGE §21.14): `GET /cards` (Filter, Suche, Sortierung, Cursor) und `POST /cards/bulk`.
// Echte Datenbank. Karten und ihr Zustand werden direkt geschrieben, damit Zustand und Anlegezeit frei wählbar sind.
import { sql as dsql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiErrorSchema,
  CardBulkResultSchema,
  CardPageSchema,
  CardSchema,
  SINGLE_USER_ID,
  TrashListSchema,
  type CardContent,
  type CardPage,
  type EvidenceRef,
} from '@sg/shared';
import { insertCardWithState } from '../../src/services/cards.ts';
import { lockCardsQuery } from '../../src/services/cards-list.ts';
import { uuidv7 } from '../../src/lib/uuid7.ts';
import { startTestApp, type TestApp } from './helpers.ts';
import { refId, World } from './inbox-helpers.ts';

const API = '/api/v1';
let app: TestApp;
let world: World;
const NOW = new Date('2026-11-13T10:00:00Z');

beforeAll(async () => {
  app = await startTestApp({}, { now: () => NOW, learningTimeZone: 'Europe/Zurich' });
  world = new World(app.handle);
});
afterAll(async () => {
  await world.reset();
  await app.close();
});
beforeEach(async () => {
  await world.reset();
});

const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, payload?: object) =>
  app.request({ method, url: `${API}${path}`, ...(payload ? { payload } : {}) });
const errorOf = (res: { json: () => unknown }) => ApiErrorSchema.parse(res.json()).error;

async function page(query = ''): Promise<CardPage> {
  const res = await call('GET', `/cards${query}`);
  expect(res.statusCode, res.body).toBe(200);
  return CardPageSchema.parse(res.json());
}
const ids = (p: CardPage) => p.items.map((i) => i.card.id);

const basic = (front: string, back = 'Antwort', explanation: string | null = null): CardContent => ({
  kind: 'basic',
  front: { text_md: front },
  back: { text_md: back, explanation_md: explanation },
});
const cloze = (text: string, answers: Record<string, string[]>) =>
  ({ kind: 'cloze', front: { text_md: text }, back: { answers } }) as unknown as CardContent;

const slideRef = (): EvidenceRef => ({
  kind: 'slide',
  slide_id: refId('f1'),
  deck_id: refId('d1'),
  slide_index: 1,
});

interface CardSeed {
  concept?: string;
  content?: CardContent;
  origin?: 'ki' | 'manuell';
  suspended?: boolean;
  createdAt?: string;
  state?: {
    state?: 'new' | 'learning' | 'review' | 'relearning';
    due?: string;
    lapses?: number;
    difficulty?: number;
    reps?: number;
  };
}

/** Karte `ref` direkt anlegen (Kurzname wie bei `refId`), danach Zustand und Zeiten setzen */
async function mk(ref: string, seed: CardSeed = {}): Promise<string> {
  const id = refId(ref);
  await world.db.transaction(async (tx) => {
    await insertCardWithState(tx, {
      id,
      conceptId: refId(seed.concept ?? 'k1'),
      content: seed.content ?? basic(`Frage ${ref}`),
      sources: [slideRef()],
      origin: seed.origin ?? 'manuell',
      now: NOW,
    });
  });
  const s = world.db;
  if (seed.suspended) await s.execute(dsql`UPDATE card SET suspended = true WHERE id = ${id}`);
  if (seed.createdAt)
    await s.execute(dsql`UPDATE card SET created_at = ${seed.createdAt}::timestamptz WHERE id = ${id}`);
  if (seed.state) {
    const st = seed.state;
    const state = st.state ?? 'review';
    await s.execute(dsql`UPDATE card_state SET state = ${state},
      due = COALESCE(${st.due ?? null}::timestamptz, due),
      lapses = COALESCE(${st.lapses ?? null}::int, lapses),
      difficulty = COALESCE(${st.difficulty ?? null}::float8, difficulty),
      reps = COALESCE(${st.reps ?? (state === 'new' ? 0 : 1)}::int, reps),
      last_review = ${state === 'new' ? null : '2026-11-01T10:00:00Z'}::timestamptz
      WHERE card_id = ${id}`);
  }
  return id;
}

async function seed() {
  await world.module('m2', 'Analysis', 'ANA');
  await world.concept('k1', { name: 'Primärschlüssel', status: 'aktiv', modules: ['m1'] });
  await world.concept('k2', { name: 'Fremdschlüssel', status: 'aktiv', modules: ['m2'] });
  await world.deck('d1', [{ ref: 'f1', index: 1 }]);
}

describe('GET /cards: Form und Sichtbarkeit', () => {
  it('liefert Karte, Konzept und Module; der Zustand steht in card.state; keine Gesamtzahl', async () => {
    await seed();
    await world.concept('k3', { name: 'Viele Module', status: 'aktiv' });
    // 11 Module: höchstens 10, nach Name sortiert; ein gelöschtes Modul fehlt
    for (let i = 0; i < 11; i += 1) {
      const ref = `mm${String(i).padStart(2, '0')}`;
      await world.module(ref, `Modul ${String(i).padStart(2, '0')}`, i === 0 ? null : `M${i}`);
      await world.db.execute(
        dsql`INSERT INTO concept_module (id, user_id, concept_id, module_id)
             VALUES (${refId(`cm3${ref}`)}, ${SINGLE_USER_ID}, ${refId('k3')}, ${refId(ref)})`,
      );
    }
    await world.db.execute(dsql`UPDATE module SET deleted_at = now() WHERE id = ${refId('mm00')}`);
    await mk('c1', { concept: 'k3' });
    const p = await page();
    expect(Object.keys(p).sort()).toEqual(['items', 'next_cursor']);
    const item = p.items[0]!;
    expect(item.concept).toEqual({ id: refId('k3'), name: 'Viele Module' });
    expect(item.modules.map((m) => m.name)).toEqual(
      Array.from({ length: 10 }, (_, i) => `Modul ${String(i + 1).padStart(2, '0')}`),
    );
    expect(item.modules[0]).toMatchObject({ short_name: 'M1' });
    expect(item.card).toMatchObject({ id: refId('c1'), state: { state: 'new', lapses: 0 } });
    expect(CardSchema.safeParse(item.card).success).toBe(true);
  });

  it('Konzept ohne Module: leere Liste; gelöschte Karten, gelöschte Konzepte, Vorschläge und Hüllen sind unsichtbar', async () => {
    await seed();
    await world.concept('k4', { name: 'Ohne Modul', status: 'aktiv' });
    await world.concept('kdel', { name: 'Gelöscht', status: 'aktiv' });
    await world.concept('kvor', { name: 'Vorschlag' });
    await world.concept('khul', { name: 'Hülle', status: 'aktiv' });
    await mk('c1', { concept: 'k4' });
    await mk('c2', { concept: 'k1' });
    await mk('c3', { concept: 'kdel' });
    await mk('c4', { concept: 'kvor' });
    await mk('c5', { concept: 'khul' });
    await mk('c6', { concept: 'k1' });
    await world.db.execute(dsql`UPDATE card SET deleted_at = now() WHERE id = ${refId('c6')}`);
    await world.db.execute(dsql`UPDATE concept SET deleted_at = now() WHERE id = ${refId('kdel')}`);
    await world.db.execute(
      dsql`UPDATE concept SET status = 'zusammengefuehrt', merged_into = ${refId('k1')} WHERE id = ${refId('khul')}`,
    );
    const p = await page('?sort=faellig');
    expect(new Set(ids(p))).toEqual(new Set([refId('c1'), refId('c2')]));
    expect(p.items.find((i) => i.card.id === refId('c1'))!.modules).toEqual([]);
    // eine gelöschte card_state-Zeile blendet die Karte ebenfalls aus
    await world.db.execute(dsql`UPDATE card_state SET deleted_at = now() WHERE card_id = ${refId('c2')}`);
    expect(ids(await page())).toEqual([refId('c1')]);
  });

  it('leere Datenbank: leere Seite', async () => {
    expect(await page()).toEqual({ items: [], next_cursor: null });
  });
});

describe('GET /cards: Filter', () => {
  async function world1() {
    await seed();
    await mk('a1', { concept: 'k1', content: basic('A1'), origin: 'ki' });
    await mk('a2', { concept: 'k1', content: cloze('{{c1::X}} ist Y', { c1: ['X'] }), origin: 'manuell' });
    await mk('b1', { concept: 'k2', content: basic('B1'), origin: 'ki', suspended: true });
    await mk('b2', {
      concept: 'k2',
      content: cloze('{{c1::P}} ist Q', { c1: ['P'] }),
      origin: 'ki',
      state: { state: 'review', lapses: 3, difficulty: 2 },
    });
  }
  const sorted = (p: CardPage) => ids(p).sort();

  it('module_id und concept_id', async () => {
    await world1();
    expect(sorted(await page(`?module_id=${refId('m1')}`))).toEqual([refId('a1'), refId('a2')]);
    expect(sorted(await page(`?module_id=${refId('m2')}`))).toEqual([refId('b1'), refId('b2')]);
    expect(await page(`?module_id=${refId('m9')}`)).toMatchObject({ items: [] });
    expect(sorted(await page(`?concept_id=${refId('k2')}`))).toEqual([refId('b1'), refId('b2')]);
    // Modul-Zuordnung gelöscht: Filter greift nicht mehr
    await world.db.execute(
      dsql`UPDATE concept_module SET deleted_at = now() WHERE concept_id = ${refId('k1')}`,
    );
    expect(ids(await page(`?module_id=${refId('m1')}`))).toEqual([]);
  });

  it('kind (einfach und mehrfach) und origin', async () => {
    await world1();
    expect(sorted(await page('?kind=basic'))).toEqual([refId('a1'), refId('b1')]);
    expect(sorted(await page('?kind=cloze'))).toEqual([refId('a2'), refId('b2')]);
    expect(await page('?kind=cloze&kind=basic')).toMatchObject({ items: expect.arrayContaining([]) });
    expect((await page('?kind=cloze&kind=basic')).items).toHaveLength(4);
    expect(sorted(await page('?origin=ki'))).toEqual([refId('a1'), refId('b1'), refId('b2')]);
    expect(sorted(await page('?origin=manuell'))).toEqual([refId('a2')]);
  });

  it('status: alle, aktiv, pausiert, neu', async () => {
    await world1();
    expect((await page()).items).toHaveLength(4);
    expect((await page('?status=alle')).items).toHaveLength(4);
    expect(sorted(await page('?status=aktiv'))).toEqual([refId('a1'), refId('a2'), refId('b2')]);
    expect(sorted(await page('?status=pausiert'))).toEqual([refId('b1')]);
    expect(sorted(await page('?status=neu'))).toEqual([refId('a1'), refId('a2'), refId('b1')]);
  });

  it('status=schwer: nicht neu und (lapses ≥ 3 oder difficulty ≥ 7), Grenzen genau', async () => {
    await seed();
    await mk('h01', { state: { state: 'review', lapses: 2, difficulty: 6.99 } }); // knapp darunter
    await mk('h02', { state: { state: 'review', lapses: 3, difficulty: 0 } }); // lapses an der Grenze
    await mk('h03', { state: { state: 'learning', lapses: 0, difficulty: 7 } }); // difficulty an der Grenze
    await mk('h04', { state: { state: 'new', lapses: 5, difficulty: 9 } }); // neu zählt nie
    await mk('h05', { state: { state: 'relearning', lapses: 4, difficulty: 8.5 } });
    await mk('h06', { state: { state: 'review', lapses: 0, difficulty: 3 } });
    expect((await page('?status=schwer')).items.map((i) => i.card.id).sort()).toEqual([
      refId('h02'),
      refId('h03'),
      refId('h05'),
    ]);
  });

  it('Filter kombiniert (UND) mit q und Sortierung', async () => {
    await world1();
    expect(ids(await page(`?module_id=${refId('m2')}&kind=cloze&origin=ki&status=aktiv`))).toEqual([
      refId('b2'),
    ]);
    expect(await page(`?module_id=${refId('m1')}&origin=ki&status=pausiert`)).toMatchObject({ items: [] });
    expect(ids(await page(`?concept_id=${refId('k2')}&status=schwer&q=ist`))).toEqual([refId('b2')]);
    expect(ids(await page(`?kind=basic&status=neu&q=b1&sort=faellig`))).toEqual([refId('b1')]);
  });

  it('Validierung: 400 validation_failed', async () => {
    for (const q of [
      '?limit=0',
      '?limit=201',
      '?q=',
      `?q=${'x'.repeat(101)}`,
      '?module_id=kein-uuid',
      '?concept_id=1',
      '?kind=reverse',
      '?origin=bot',
      '?status=kaputt',
      '?sort=zufall',
    ]) {
      const res = await call('GET', `/cards${q}`);
      expect(res.statusCode, q).toBe(400);
      expect(errorOf(res).code, q).toBe('validation_failed');
    }
    // Grenzen sind gültig
    expect((await call('GET', `/cards?limit=200&q=${'x'.repeat(100)}`)).statusCode).toBe(200);
  });

  it('ungültiger Cursor: 400 invalid_cursor (auch der Cursor der falschen Sortierung)', async () => {
    await seed();
    for (const q of ['?cursor=%25%25', '?sort=schwer&cursor=bm9wZQ', '?sort=schwer&cursor=W10']) {
      const res = await call('GET', `/cards${q}`);
      expect(res.statusCode, q).toBe(400);
      expect(errorOf(res).code, q).toBe('invalid_cursor');
    }
    const neuCursor = Buffer.from(JSON.stringify(['2026-11-13 10:00:00+00', refId('a1')]), 'utf8').toString(
      'base64url',
    );
    const res = await call('GET', `/cards?sort=schwer&cursor=${neuCursor}`);
    expect(res.statusCode).toBe(400);
  });

  it('präparierter schwer-Cursor außerhalb des Wertebereichs: 400 statt 500 (N1)', async () => {
    await seed();
    const enc = (parts: string[]) => Buffer.from(JSON.stringify(parts), 'utf8').toString('base64url');
    const id = refId('a1');
    const cursors = [
      enc(['s', '9999999999', '1', id]), // lapses über int-Bereich
      enc(['s', '1', '1e999', id]), // Gleitkomma außerhalb des Bereichs
      enc(['s', '1', '1'.repeat(400), id]), // zu lang
      enc(['s', '1', '0'.repeat(399) + '1', id]), // nur die Länge ist ungültig (Wert 1)
      enc(['s', '1', '0.' + '0'.repeat(400), id]), // nur die Länge ist ungültig (Wert 0)
      enc(['s', '1', '0.' + '0'.repeat(400) + '1', id]), // zu lang und Unterlauf
      enc(['s', '1', '1e-400', id]), // Unterlauf: Postgres lehnt es ab
      enc(['s', '1', '9e-999', id]), // Unterlauf
    ];
    for (const c of cursors) {
      const res = await call('GET', `/cards?sort=schwer&cursor=${c}`);
      expect(res.statusCode, c).toBe(400);
      expect(errorOf(res).code).toBe('invalid_cursor');
    }
    // Grenzwerte sind gültig
    const ok = await call('GET', `/cards?sort=schwer&cursor=${enc(['s', '2147483647', '1e300', id])}`);
    expect(ok.statusCode, ok.body).toBe(200);
    // subnormale Werte und Null (auch mit Nachkommastellen) sind gültig
    for (const d of ['1e-310', '0', '0.0', '0e-999']) {
      const res = await call('GET', `/cards?sort=schwer&cursor=${enc(['s', '1', d, id])}`);
      expect(res.statusCode, `${d}: ${res.body}`).toBe(200);
    }
  });

  it('Cursor einer anderen Sortierung: 400 invalid_cursor (N2)', async () => {
    await seed();
    await mk('x1', { createdAt: '2026-11-01T10:00:00Z', state: { lapses: 4, difficulty: 8 } });
    await mk('x2', { createdAt: '2026-11-02T10:00:00Z', state: { lapses: 5, difficulty: 8 } });
    const cursorOf = async (sort: string) => {
      const p = await page(`?sort=${sort}&limit=1`);
      expect(p.next_cursor).not.toBeNull();
      return p.next_cursor!;
    };
    const cursors = {
      neu: await cursorOf('neu'),
      faellig: await cursorOf('faellig'),
      schwer: await cursorOf('schwer'),
    };
    for (const sort of ['neu', 'faellig', 'schwer'] as const) {
      expect((await call('GET', `/cards?sort=${sort}&limit=1&cursor=${cursors[sort]}`)).statusCode).toBe(200);
      for (const other of ['neu', 'faellig', 'schwer'] as const) {
        if (other === sort) continue;
        const res = await call('GET', `/cards?sort=${sort}&cursor=${cursors[other]}`);
        expect(res.statusCode, `${sort} mit ${other}-Cursor`).toBe(400);
        expect(errorOf(res).code).toBe('invalid_cursor');
      }
    }
  });
});

describe('GET /cards: Suche q', () => {
  it('trifft Vorderseite, Antwort, Erklärung und Lückenlösungen, ohne Groß-/Kleinschreibung', async () => {
    await seed();
    await mk('q1', { content: basic('Wie heißt der Zebrastreifen?') });
    await mk('q2', { content: basic('x', 'Die ANTWORT lautet Quokka') });
    await mk('q3', { content: basic('x', 'y', 'Erklärung mit Narwal') });
    await mk('q4', { content: cloze('Das {{c1::Ding}} ist hier', { c1: ['Ding', 'Gadget', 'Okapi'] }) });
    await mk('q5', { content: basic('Nichts davon') });
    const hit = async (q: string) => ids(await page(`?q=${encodeURIComponent(q)}&sort=faellig`)).sort();
    expect(await hit('zebra')).toEqual([refId('q1')]);
    expect(await hit('QUOKKA')).toEqual([refId('q2')]);
    expect(await hit('narwal')).toEqual([refId('q3')]);
    expect(await hit('okapi')).toEqual([refId('q4')]); // alternative Lösung
    expect(await hit('gadget')).toEqual([refId('q4')]);
    expect(await hit('streif')).toEqual([refId('q1')]); // Teilwort
    expect(await hit('kein Treffer')).toEqual([]);
  });

  it('% und _ sind wörtlich, auch Backslash', async () => {
    await seed();
    await mk('p1', { content: basic('Anteil 50% der Fälle') });
    await mk('p2', { content: basic('Anteil 500 Fälle') });
    await mk('p3', { content: basic('snake_case Name') });
    await mk('p4', { content: basic('snakeXcase Name') });
    await mk('p5', { content: basic('Pfad C:\\temp') });
    await mk('p6', { content: basic('Pfad C:temp') });
    const hit = async (q: string) => ids(await page(`?q=${encodeURIComponent(q)}`)).sort();
    expect(await hit('50%')).toEqual([refId('p1')]);
    expect(await hit('%')).toEqual([refId('p1')]);
    expect(await hit('e_c')).toEqual([refId('p3')]);
    expect(await hit('_')).toEqual([refId('p3')]);
    expect(await hit('\\')).toEqual([refId('p5')]);
    expect(await hit('C:\\t')).toEqual([refId('p5')]);
  });
});

describe('GET /cards: Sortierung und Cursor', () => {
  /** Alle Seiten mit `limit` einsammeln; prüft nebenbei, dass die Seiten nie überlappen */
  async function walk(query: string, limit: number): Promise<string[]> {
    const all: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 50; guard += 1) {
      const p = await page(`?${query}&limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`);
      expect(p.items.length).toBeLessThanOrEqual(limit);
      all.push(...ids(p));
      cursor = p.next_cursor;
      if (!cursor) break;
      expect(p.items).toHaveLength(limit);
    }
    expect(new Set(all).size).toBe(all.length);
    return all;
  }

  it('neu (Standard): created_at absteigend, dann id absteigend; Cursor über die Seitengrenze, auch bei gleicher Zeit', async () => {
    await seed();
    // c1..c5 mit verschiedenen Zeiten, c6 und c7 mit gleicher Zeit (id entscheidet)
    await mk('c1', { createdAt: '2026-11-01T10:00:00.123456Z' });
    await mk('c2', { createdAt: '2026-11-02T10:00:00.123456Z' });
    await mk('c3', { createdAt: '2026-11-03T10:00:00.123456Z' });
    await mk('c4', { createdAt: '2026-11-04T10:00:00.000001Z' });
    await mk('c5', { createdAt: '2026-11-04T10:00:00.000002Z' });
    await mk('c6', { createdAt: '2026-11-05T10:00:00Z' });
    await mk('c7', { createdAt: '2026-11-05T10:00:00Z' });
    const expected = ['c7', 'c6', 'c5', 'c4', 'c3', 'c2', 'c1'].map(refId);
    expect(ids(await page())).toEqual(expected);
    expect(ids(await page('?sort=neu'))).toEqual(expected);
    for (const limit of [1, 2, 3, 7, 8]) expect(await walk('sort=neu', limit)).toEqual(expected);
    expect((await page('?limit=7')).next_cursor).toBeNull();
    expect((await page('?limit=6')).next_cursor).not.toBeNull();
  });

  it('faellig: due aufsteigend, dann id aufsteigend; Cursor über die Seitengrenze', async () => {
    await seed();
    await mk('d1', { state: { due: '2026-11-20T08:00:00.000001Z' } });
    await mk('d2', { state: { due: '2026-11-10T08:00:00Z' } });
    await mk('d3', { state: { due: '2026-11-15T08:00:00Z' } });
    await mk('d4', { state: { due: '2026-11-15T08:00:00Z' } }); // gleiche due wie d3: id
    await mk('d5', { state: { due: '2026-11-20T08:00:00Z' } });
    const expected = ['d2', 'd3', 'd4', 'd5', 'd1'].map(refId);
    expect(ids(await page('?sort=faellig'))).toEqual(expected);
    for (const limit of [1, 2, 3, 5, 6]) expect(await walk('sort=faellig', limit)).toEqual(expected);
  });

  it('schwer: lapses absteigend, dann difficulty absteigend, dann id aufsteigend; Cursor über die Seitengrenze', async () => {
    await seed();
    await mk('s1', { state: { lapses: 1, difficulty: 9 } });
    await mk('s2', { state: { lapses: 4, difficulty: 3.3333333333333335 } });
    await mk('s3', { state: { lapses: 4, difficulty: 8.1 } });
    await mk('s4', { state: { lapses: 4, difficulty: 8.1 } }); // Gleichstand: id
    await mk('s5', { state: { lapses: 0, difficulty: 0.1 } });
    await mk('s6', { state: { lapses: 10, difficulty: 1e-7 } }); // Exponentialschreibweise im Cursor
    await mk('s7', { state: { lapses: 0, difficulty: 0 } });
    const expected = ['s6', 's3', 's4', 's2', 's1', 's5', 's7'].map(refId);
    expect(ids(await page('?sort=schwer'))).toEqual(expected);
    for (const limit of [1, 2, 3, 4, 7, 8]) expect(await walk('sort=schwer', limit)).toEqual(expected);
  });

  it('schwer: Cursor verlustfrei für Gleitkomma-Schwierigkeiten mit vielen Stellen (N4)', async () => {
    await seed();
    // gleiche lapses, difficulty nur in der 7. bis 16. Stelle verschieden: rundet der Cursor, geht eine Karte verloren oder doppelt
    await mk('h1', { state: { lapses: 4, difficulty: 2 / 3 } });
    await mk('h2', { state: { lapses: 4, difficulty: 0.6666667 } });
    await mk('h3', { state: { lapses: 4, difficulty: 8.0000004 } });
    await mk('h4', { state: { lapses: 4, difficulty: 8.0000003 } });
    await mk('h5', { state: { lapses: 4, difficulty: 0.66666666666666 } });
    const expected = ['h3', 'h4', 'h2', 'h1', 'h5'].map(refId);
    expect(ids(await page('?sort=schwer'))).toEqual(expected);
    for (const limit of [1, 2, 3, 4]) expect(await walk('sort=schwer', limit)).toEqual(expected);
  });

  it('Cursor mit Filter: Seiten bleiben im gefilterten Satz', async () => {
    await seed();
    for (let i = 1; i <= 5; i += 1)
      await mk(`f${i}`, { concept: 'k1', createdAt: `2026-11-0${i}T10:00:00Z` });
    for (let i = 1; i <= 3; i += 1)
      await mk(`g${i}`, { concept: 'k2', createdAt: `2026-11-0${i}T11:00:00Z` });
    const got = await walk(`module_id=${refId('m1')}&sort=neu`, 2);
    expect(got).toEqual(['f5', 'f4', 'f3', 'f2', 'f1'].map(refId));
  });
});

describe('POST /cards/bulk', () => {
  const bulk = (idsList: string[], action: string) => call('POST', '/cards/bulk', { ids: idsList, action });
  async function ok(idsList: string[], action: string) {
    const res = await bulk(idsList, action);
    expect(res.statusCode, res.body).toBe(200);
    return CardBulkResultSchema.parse(res.json());
  }
  const flag = async (ref: string) =>
    (
      await world.db.execute<{ suspended: boolean }>(
        dsql`SELECT suspended FROM card WHERE id = ${refId(ref)}`,
      )
    )[0]!.suspended;

  it('suspend und resume: geändert / unchanged / card_not_found, IDs aufsteigend, FSRS-Zustand bleibt', async () => {
    await seed();
    await mk('b1', { state: { state: 'review', lapses: 2, difficulty: 5.5, reps: 4 } });
    await mk('b2', { suspended: true });
    await mk('b3');
    await mk('b4');
    await world.db.execute(dsql`UPDATE card SET deleted_at = now() WHERE id = ${refId('b4')}`);
    const before = await world.db.execute(dsql`SELECT * FROM card_state WHERE card_id = ${refId('b1')}`);

    const first = await ok([refId('b4'), refId('b3'), refId('b2'), refId('b1'), refId('zz')], 'suspend');
    expect(first.changed).toEqual([refId('b1'), refId('b3')]);
    expect(first.skipped).toEqual([
      { id: refId('b2'), code: 'unchanged' },
      { id: refId('b4'), code: 'card_not_found' },
      { id: refId('zz'), code: 'card_not_found' },
    ]);
    expect(await flag('b1')).toBe(true);
    expect(await flag('b3')).toBe(true);
    expect(await world.db.execute(dsql`SELECT * FROM card_state WHERE card_id = ${refId('b1')}`)).toEqual(
      before,
    );

    const again = await ok([refId('b1'), refId('b3')], 'suspend');
    expect(again).toEqual({
      changed: [],
      skipped: [
        { id: refId('b1'), code: 'unchanged' },
        { id: refId('b3'), code: 'unchanged' },
      ],
    });

    const resumed = await ok([refId('b3'), refId('b1'), refId('b2')], 'resume');
    expect(resumed).toEqual({ changed: [refId('b1'), refId('b2'), refId('b3')], skipped: [] });
    expect(await flag('b2')).toBe(false);
    expect((await ok([refId('b1')], 'resume')).skipped).toEqual([{ id: refId('b1'), code: 'unchanged' }]);
    // die Liste sieht den Wechsel
    expect((await page('?status=pausiert')).items).toHaveLength(0);
  });

  it('suspend ändert updated_at; Pausieren wirkt wie PATCH (Karte fällt aus der Warteschlange)', async () => {
    await seed();
    await mk('u1', { state: { state: 'review', due: '2026-11-12T10:00:00Z' } });
    const queueBefore = (await call('GET', '/review/queue')).json() as { items: unknown[] };
    expect(queueBefore.items).toHaveLength(1);
    await ok([refId('u1')], 'suspend');
    const card = CardSchema.parse((await call('GET', `/cards/${refId('u1')}`)).json());
    expect(card.suspended).toBe(true);
    expect(((await call('GET', '/review/queue')).json() as { items: unknown[] }).items).toHaveLength(0);
    await ok([refId('u1')], 'resume');
    expect(((await call('GET', '/review/queue')).json() as { items: unknown[] }).items).toHaveLength(1);
  });

  it('delete: Papierkorb je Karte, Zustand geht mit, Wiederherstellen bringt alles zurück; erneut löschen → card_not_found', async () => {
    await seed();
    await mk('e1', { state: { state: 'review', lapses: 2, difficulty: 6, reps: 3 } });
    await mk('e2');
    await mk('e3');
    const res = await ok([refId('e3'), refId('e1'), refId('nope')], 'delete');
    expect(res).toEqual({
      changed: [refId('e1'), refId('e3')],
      skipped: [{ id: refId('nope'), code: 'card_not_found' }],
    });
    expect(ids(await page())).toEqual([refId('e2')]);
    expect((await call('GET', `/cards/${refId('e1')}`)).statusCode).toBe(404);
    const rows = await world.db.execute<{ id: string; deleted_at: string | null }>(
      dsql`SELECT card_id AS id, deleted_at FROM card_state WHERE card_id IN (${refId('e1')}, ${refId('e3')})`,
    );
    expect(rows.every((r) => r.deleted_at !== null)).toBe(true);

    const trash = TrashListSchema.parse((await call('GET', '/trash?kind=card')).json());
    expect(trash.items.map((i) => i.id).sort()).toEqual([refId('e1'), refId('e3')]);
    expect(trash.items[0]).toMatchObject({ kind: 'card' });

    const again = await ok([refId('e1')], 'delete');
    expect(again).toEqual({ changed: [], skipped: [{ id: refId('e1'), code: 'card_not_found' }] });

    const restored = await call('POST', `/trash/${refId('e1')}/restore`);
    expect(restored.statusCode, restored.body).toBe(200);
    const back = CardSchema.parse((await call('GET', `/cards/${refId('e1')}`)).json());
    expect(back.state).toMatchObject({ state: 'review', lapses: 2, difficulty: 6, reps: 3 });
    expect(ids(await page('?sort=faellig')).sort()).toEqual([refId('e1'), refId('e2')]);
  });

  it('Validierung: doppelte IDs, leere Liste, mehr als 200, falsche Aktion, fremde Felder → 400 validation_failed', async () => {
    await seed();
    await mk('v1');
    const cases: object[] = [
      { ids: [refId('v1'), refId('v1')], action: 'delete' },
      { ids: [], action: 'delete' },
      { ids: Array.from({ length: 201 }, (_, i) => refId(`x${i}`)), action: 'suspend' },
      { ids: [refId('v1')], action: 'archive' },
      { ids: [refId('v1')] },
      { ids: ['kein-uuid'], action: 'suspend' },
      { ids: [refId('v1')], action: 'suspend', extra: 1 },
    ];
    for (const body of cases) {
      const res = await call('POST', '/cards/bulk', body);
      expect(res.statusCode, JSON.stringify(body).slice(0, 80)).toBe(400);
      expect(errorOf(res).code).toBe('validation_failed');
    }
    // nichts wurde angefasst
    expect(ids(await page())).toEqual([refId('v1')]);
    expect(await flag('v1')).toBe(false);
  });

  it('genau 200 IDs sind erlaubt', async () => {
    await seed();
    const list = Array.from({ length: 200 }, (_, i) => refId(`y${String(i).padStart(3, '0')}`));
    const res = await ok(list, 'suspend');
    expect(res.changed).toEqual([]);
    expect(res.skipped).toHaveLength(200);
  });

  it('Bulk-Delete eines ganzen Konzepts mit vielen Karten: alles in einer Transaktion', async () => {
    await seed();
    const refs = Array.from({ length: 30 }, (_, i) => `m${String(i).padStart(2, '0')}`);
    for (const r of refs) await mk(r);
    const res = await ok(refs.map(refId), 'delete');
    expect(res.changed).toHaveLength(30);
    expect(ids(await page())).toEqual([]);
    expect((await call('GET', '/trash?kind=card&limit=100')).json()).toMatchObject({
      items: expect.any(Array),
    });
  });

  describe('Nebenläufigkeit', () => {
    const blockedCount = async (): Promise<number> => {
      const rows = await app.handle.sql`
        SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`;
      return rows[0]?.n ?? 0;
    };
    const waitForBlocked = (n: number) =>
      vi.waitFor(async () => expect(await blockedCount()).toBeGreaterThanOrEqual(n), {
        timeout: 5_000,
        interval: 25,
      });

    it.each(['suspend', 'delete'] as const)(
      'zwei Bulk-Aufrufe (%s) mit überlappenden IDs in gegensätzlicher Reihenfolge: beide 200, kein 40P01',
      async (action) => {
        await seed();
        const [a, b, c] = await Promise.all([mk('n1'), mk('n2'), mk('n3')]);
        // Eine fremde Transaktion hält Karte n1. A (n1, n2, n3) und B (n3, n2, n1) warten beide an der kleinsten ID;
        // ohne aufsteigendes Sperren hielte B schon n3 und n2, A schon n1: Verklemmung nach dem Freigeben
        const gate = await app.handle.sql.reserve();
        let first: ReturnType<typeof bulk> | undefined;
        let second: ReturnType<typeof bulk> | undefined;
        try {
          await gate`BEGIN`;
          await gate`SELECT id FROM card WHERE id = ${a} FOR NO KEY UPDATE`;
          first = bulk([a, b, c], action);
          await waitForBlocked(1);
          second = bulk([c, b, a], action);
          await waitForBlocked(2);
          await gate`COMMIT`;
          const [r1, r2] = await Promise.all([first, second]);
          expect(r1.statusCode, r1.body).toBe(200);
          expect(r2.statusCode, r2.body).toBe(200);
          const x = CardBulkResultSchema.parse(r1.json());
          const y = CardBulkResultSchema.parse(r2.json());
          // jede Karte wurde genau einmal geändert, die andere Seite hat sie übersprungen
          expect([...x.changed, ...y.changed].sort()).toEqual([a, b, c]);
          const skippedCode = action === 'delete' ? 'card_not_found' : 'unchanged';
          expect([...x.skipped, ...y.skipped].every((s) => s.code === skippedCode)).toBe(true);
        } finally {
          await gate`ROLLBACK`.catch(() => undefined);
          gate.release();
          await Promise.allSettled([first, second]);
        }
      },
    );

    it('Sperr-Abfrage: ORDER BY id steht vor FOR NO KEY UPDATE und der Plan sortiert vor dem Sperren (N3)', async () => {
      const q = lockCardsQuery(app.handle.db, [refId('n1'), refId('n2')]);
      const { sql: text, params } = q.toSQL();
      expect(text).toMatch(/order by "card"\."id"\s+for no key update/i);
      const plan = await app.handle.sql.unsafe(`EXPLAIN ${text}`, params as never[]);
      const lines = plan.map((r) => String(r['QUERY PLAN']));
      // Der eigentliche Regressionsschutz ist die SQL-Prüfung oben. Der Plan hängt von der Tabellengröße ab:
      // oben `LockRows`, darunter entweder `Sort` nach id oder ein Index-Scan über den Primärschlüssel (id-Reihenfolge).
      const plain = lines.join('\n');
      expect(lines[0], plain).toContain('LockRows');
      const below = lines.slice(1).join('\n');
      expect(/Sort Key: .*\bid\b/.test(below) || /Index Scan using card_pkey/.test(below), plain).toBe(true);
    });

    it('Bulk-Delete wartet auf eine laufende Bewertung (card_state) und verklemmt nicht', async () => {
      await seed();
      const id = await mk('r1', { state: { state: 'review', due: '2026-11-12T10:00:00Z' } });
      // Die Bewertung hält `card_state` (FOR UPDATE) und braucht danach `card` (FK-Sperre FOR KEY SHARE)
      const gate = await app.handle.sql.reserve();
      let deleting: ReturnType<typeof bulk> | undefined;
      try {
        await gate`BEGIN`;
        await gate`SELECT id FROM card_state WHERE card_id = ${id} FOR UPDATE`;
        deleting = bulk([id], 'delete');
        await waitForBlocked(1);
        await gate`INSERT INTO review_log ${gate({
          id: uuidv7(),
          user_id: SINGLE_USER_ID,
          card_id: id,
          reviewed_at: NOW.toISOString(),
          rating: 3,
          rating_source: 'nutzer',
          duration_ms: 1000,
          context: 'taeglich',
          state_before: '{}',
          state_after: '{}',
        })}`;
        await gate`COMMIT`;
        const res = await deleting;
        expect(res.statusCode, res.body).toBe(200);
        expect(CardBulkResultSchema.parse(res.json()).changed).toEqual([id]);
      } finally {
        await gate`ROLLBACK`.catch(() => undefined);
        gate.release();
        await Promise.allSettled([deleting]);
      }
    });
  });
});
