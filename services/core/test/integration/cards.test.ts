// B2: Karten und Wiederholung (VERTRAEGE §21.4): `POST/GET/PATCH/DELETE /cards`, `GET /concepts/{id}/cards`,
// `POST /cards/{id}/review`, `GET /review/queue`, Papierkorb (§21.8) und Einstellungen `learning` (§21.9).
// Echte Datenbank. Die Uhr des Core ist gestellt (`clock`), die Ortszeit ist Europe/Zurich.
import { sql as dsql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ApiErrorSchema,
  CardListSchema,
  CardSchema,
  ReviewQueueSchema,
  ReviewResultSchema,
  SettingsSchema,
  SINGLE_USER_ID,
  TrashListSchema,
  type Card,
  type CardContent,
  type EvidenceRef,
  type ReviewQueue,
  type ReviewResult,
} from '@sg/shared';
import { uuidv7 } from '../../src/lib/uuid7.ts';
import { startTestApp, type TestApp } from './helpers.ts';
import { refId, World } from './inbox-helpers.ts';

const API = '/api/v1';
let app: TestApp;
let world: World;
/** Gestellte Uhr des Core: 13.11.2026 10:00 UTC = 11:00 in Zürich, Lerntag bis 14.11. 03:00 UTC */
let clock = new Date('2026-11-13T10:00:00Z');

beforeAll(async () => {
  app = await startTestApp({}, { now: () => clock, learningTimeZone: 'Europe/Zurich' });
  world = new World(app.handle);
});
afterAll(async () => {
  await world.reset();
  await app.close();
});
beforeEach(async () => {
  await world.reset();
  clock = new Date('2026-11-13T10:00:00Z');
});

const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, payload?: object) =>
  app.request({ method, url: `${API}${path}`, ...(payload ? { payload } : {}) });
const errorOf = (res: { json: () => unknown }) => ApiErrorSchema.parse(res.json()).error;

const basic = (front = 'Was ist ein Primärschlüssel?', back = 'Ein eindeutiges Attribut.'): CardContent => ({
  kind: 'basic',
  front: { text_md: front },
  back: { text_md: back, explanation_md: null },
});
const cloze = (
  text = 'Ein {{c1::Tupel}} ist eine Zeile.',
  answers: Record<string, string[]> = { c1: ['Tupel'] },
) => ({ kind: 'cloze', front: { text_md: text }, back: { answers } }) as unknown as CardContent;

/** Foliensatz `d1` mit den Folien `f1` (Seite 1) und `f2` (Seite 2) */
async function seed() {
  await world.concept('k1', { name: 'Primärschlüssel', status: 'aktiv', examRelevant: true });
  await world.concept('k2', { name: 'Fremdschlüssel', status: 'aktiv' });
  await world.deck('d1', [
    { ref: 'f1', index: 1 },
    { ref: 'f2', index: 2 },
  ]);
  await world.session('s1');
}
const slideRef = (slide = 'f1', index = 1): Extract<EvidenceRef, { kind: 'slide' }> => ({
  kind: 'slide',
  slide_id: refId(slide),
  deck_id: refId('d1'),
  slide_index: index,
});
const timeRef = (session = 's1', start = 1000, end = 5000): EvidenceRef => ({
  kind: 'transcript',
  session_id: refId(session),
  t_start_ms: start,
  t_end_ms: end,
});

async function create(
  concept = 'k1',
  content: CardContent = basic(),
  sources: EvidenceRef[] = [slideRef()],
  id?: string,
): Promise<Card> {
  const res = await call('POST', '/cards', {
    ...(id ? { id } : {}),
    concept_id: refId(concept),
    content,
    sources,
  });
  expect(res.statusCode, res.body).toBe(201);
  return CardSchema.parse(res.json());
}

async function review(cardId: string, rating: number, id = uuidv7(), durationMs = 8000) {
  return call('POST', `/cards/${cardId}/review`, { id, rating, duration_ms: durationMs });
}
async function reviewOk(
  cardId: string,
  rating: number,
  id = uuidv7(),
  durationMs = 8000,
): Promise<ReviewResult> {
  const res = await review(cardId, rating, id, durationMs);
  expect(res.statusCode, res.body).toBe(200);
  return ReviewResultSchema.parse(res.json());
}
async function queue(query = ''): Promise<ReviewQueue> {
  const res = await call('GET', `/review/queue${query}`);
  expect(res.statusCode, res.body).toBe(200);
  return ReviewQueueSchema.parse(res.json());
}
const advance = (ms: number) => {
  clock = new Date(clock.getTime() + ms);
};

describe('POST /cards', () => {
  it('legt eine Karte von Hand an: origin manuell, Stufe 2, neuer Zustand mit due = jetzt', async () => {
    await seed();
    const created = await create('k1', basic(), [slideRef(), timeRef()]);
    expect(created).toMatchObject({
      concept_id: refId('k1'),
      stage: 2,
      origin: 'manuell',
      suspended: false,
      content: basic(),
      state: {
        state: 'new',
        due: '2026-11-13T10:00:00Z',
        stability: 0,
        difficulty: 0,
        elapsed_days: 0,
        scheduled_days: 0,
        learning_steps: 0,
        reps: 0,
        lapses: 0,
        last_review: null,
      },
    });
    expect(created.sources).toEqual([
      { ref: slideRef(), missing: false },
      { ref: timeRef(), missing: false },
    ]);
    const [row] = await app.handle
      .sql`SELECT origin, inbox_item_id, user_id FROM card WHERE id = ${created.id}`;
    expect(row).toMatchObject({ origin: 'manuell', inbox_item_id: null });
    const states = await app.handle.sql`SELECT 1 FROM card_state WHERE card_id = ${created.id}`;
    expect(states).toHaveLength(1);
  });

  it('nimmt eine vergebene id und säubert den Inhalt', async () => {
    await seed();
    const id = uuidv7();
    const created = await create(
      'k1',
      {
        kind: 'basic',
        front: { text_md: '  Was ist\tein Schlüssel?\r\n' },
        back: { text_md: 'Ein​ Attribut.', explanation_md: ' Merksatz ' },
      },
      [slideRef()],
      id,
    );
    expect(created.id).toBe(id);
    expect(created.content).toEqual({
      kind: 'basic',
      front: { text_md: 'Was ist ein Schlüssel?' },
      back: { text_md: 'Ein Attribut.', explanation_md: 'Merksatz' },
    });
  });

  it('cloze: Lücken werden am Rand getrimmt', async () => {
    await seed();
    const created = await create('k1', cloze('Ein {{c1:: Tupel }} ist eine Zeile.'));
    expect(created.content).toEqual(cloze('Ein {{c1::Tupel}} ist eine Zeile.'));
  });

  it('409 card_exists bei vergebener id, auch wenn die Karte im Papierkorb liegt', async () => {
    await seed();
    const id = uuidv7();
    await create('k1', basic(), [slideRef()], id);
    const again = await call('POST', '/cards', {
      id,
      concept_id: refId('k1'),
      content: basic(),
      sources: [slideRef()],
    });
    expect(again.statusCode).toBe(409);
    expect(errorOf(again).code).toBe('card_exists');
    await call('DELETE', `/cards/${id}`);
    const third = await call('POST', '/cards', {
      id,
      concept_id: refId('k1'),
      content: basic(),
      sources: [slideRef()],
    });
    expect(third.statusCode).toBe(409);
    expect(errorOf(third).code).toBe('card_exists');
  });

  it('404 concept_not_found für unbekannte und gelöschte Konzepte', async () => {
    await seed();
    await world.concept('gone', { status: 'aktiv', deletedAt: new Date() });
    for (const concept of [uuidv7(), refId('gone')]) {
      const res = await call('POST', '/cards', {
        concept_id: concept,
        content: basic(),
        sources: [slideRef()],
      });
      expect(res.statusCode).toBe(404);
      expect(errorOf(res).code).toBe('concept_not_found');
    }
  });

  it('409 concept_not_active für Vorschläge und Hüllen, bei der Hülle mit merged_into', async () => {
    await seed();
    await world.concept('p', { name: 'Vorschlag', status: 'vorschlag' });
    const proposal = await call('POST', '/cards', {
      concept_id: refId('p'),
      content: basic(),
      sources: [slideRef()],
    });
    expect(proposal.statusCode).toBe(409);
    expect(errorOf(proposal)).toMatchObject({ code: 'concept_not_active', details: { status: 'vorschlag' } });
    await app.handle
      .sql`UPDATE concept SET status = 'zusammengefuehrt', merged_into = ${refId('k2')} WHERE id = ${refId('p')}`;
    const shell = await call('POST', '/cards', {
      concept_id: refId('p'),
      content: basic(),
      sources: [slideRef()],
    });
    expect(shell.statusCode).toBe(409);
    expect(errorOf(shell).details).toEqual({ status: 'zusammengefuehrt', merged_into: refId('k2') });
  });

  it('400 card_invalid mit details.reason für jeden Verstoß aus §21.2', async () => {
    await seed();
    const cases: [CardContent, string][] = [
      [basic(' ', 'Antwort'), 'empty'],
      [cloze('Keine Lücke hier.'), 'cloze_none'],
      [cloze('Offen {{c1::Tupel'), 'cloze_none'],
      [cloze('{{c1::A}} und {{c3::B}}', { c1: ['A'], c3: ['B'] }), 'cloze_numbers'],
      [cloze('Ein {{c1::Tupel::Zeile}} ist.', { c1: ['Tupel::Zeile'] }), 'cloze_syntax'],
      [cloze('{{c1::A}} und {{c2::B}}', { c1: ['A'] }), 'cloze_answers'],
    ];
    for (const [content, reason] of cases) {
      const res = await call('POST', '/cards', { concept_id: refId('k1'), content, sources: [slideRef()] });
      expect(res.statusCode, JSON.stringify(content)).toBe(400);
      expect(errorOf(res)).toMatchObject({ code: 'card_invalid', details: { reason } });
    }
    expect(await app.handle.sql`SELECT 1 FROM card`).toHaveLength(0);
  });

  it('400 validation_failed bei Verstößen gegen das Schema (Länge, Belege 1 bis 6, fehlende Felder)', async () => {
    await seed();
    const bodies: object[] = [
      { concept_id: refId('k1'), content: basic('x'.repeat(501)), sources: [slideRef()] },
      { concept_id: refId('k1'), content: basic(), sources: [] },
      { concept_id: refId('k1'), content: basic(), sources: Array.from({ length: 7 }, () => slideRef()) },
      { concept_id: refId('k1'), content: basic() },
      { concept_id: 'kein-uuid', content: basic(), sources: [slideRef()] },
    ];
    for (const body of bodies) {
      const res = await call('POST', '/cards', body);
      expect(res.statusCode, JSON.stringify(body).slice(0, 80)).toBe(400);
      expect(errorOf(res).code).toBe('validation_failed');
    }
  });

  it('400 card_source_invalid mit details.index', async () => {
    await seed();
    const deleted = await world.deck('d2', [{ ref: 'g1', index: 1 }]);
    await app.handle.sql`UPDATE slide_deck SET deleted_at = now() WHERE id = ${deleted}`;
    const cases: [EvidenceRef[], number][] = [
      // Folie existiert nicht
      [[slideRef(), { ...slideRef(), slide_id: uuidv7() }], 1],
      // Foliennummer passt nicht
      [[slideRef('f1', 2)], 0],
      // falscher Foliensatz
      [[{ ...slideRef(), deck_id: uuidv7() }], 0],
      // Foliensatz gelöscht
      [[slideRef(), { kind: 'slide', slide_id: refId('g1'), deck_id: refId('d2'), slide_index: 1 }], 1],
      // Session fehlt
      [[timeRef('s1'), timeRef('gibts-nicht-s9')], 1],
      // Anfang nach Ende
      [[timeRef('s1', 9000, 1000)], 0],
      // Dublette
      [[slideRef(), timeRef(), slideRef()], 2],
    ];
    for (const [sources, index] of cases) {
      const body = {
        concept_id: refId('k1'),
        content: basic(),
        sources: sources.map((s) =>
          s.kind === 'transcript' && s.session_id === refId('gibts-nicht-s9')
            ? { ...s, session_id: uuidv7() }
            : s,
        ),
      };
      const res = await call('POST', '/cards', body);
      expect(res.statusCode, res.body).toBe(400);
      expect(errorOf(res)).toMatchObject({ code: 'card_source_invalid', details: { index } });
    }
  });

  it('eine gelöschte Session ist als Beleg ungültig', async () => {
    await seed();
    await app.handle.sql`UPDATE session SET deleted_at = now() WHERE id = ${refId('s1')}`;
    const res = await call('POST', '/cards', {
      concept_id: refId('k1'),
      content: basic(),
      sources: [timeRef()],
    });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res).code).toBe('card_source_invalid');
  });

  it('der Beleg muss kein Beleg des Konzepts sein (kein evidence-Eintrag nötig)', async () => {
    await seed();
    expect(await app.handle.sql`SELECT 1 FROM evidence`).toHaveLength(0);
    await create('k1', basic(), [timeRef()]);
  });
});

describe('GET /cards/{id} und GET /concepts/{id}/cards', () => {
  it('liest eine Karte; 404 für unbekannte und gelöschte', async () => {
    await seed();
    const created = await create();
    const res = await call('GET', `/cards/${created.id}`);
    expect(res.statusCode).toBe(200);
    expect(CardSchema.parse(res.json())).toEqual(created);
    await call('DELETE', `/cards/${created.id}`);
    for (const id of [created.id, uuidv7()]) {
      const missing = await call('GET', `/cards/${id}`);
      expect(missing.statusCode).toBe(404);
      expect(errorOf(missing).code).toBe('card_not_found');
    }
  });

  it('meldet Belege als missing, wenn Folie, Foliensatz oder Session gelöscht sind', async () => {
    await seed();
    const created = await create('k1', basic(), [slideRef('f1', 1), slideRef('f2', 2), timeRef()]);
    await app.handle.sql`UPDATE slide SET deleted_at = now() WHERE id = ${refId('f2')}`;
    let read = CardSchema.parse((await call('GET', `/cards/${created.id}`)).json());
    expect(read.sources.map((s) => s.missing)).toEqual([false, true, false]);
    await app.handle.sql`UPDATE slide_deck SET deleted_at = now() WHERE id = ${refId('d1')}`;
    await app.handle.sql`UPDATE session SET deleted_at = now() WHERE id = ${refId('s1')}`;
    read = CardSchema.parse((await call('GET', `/cards/${created.id}`)).json());
    expect(read.sources.map((s) => s.missing)).toEqual([true, true, true]);
  });

  it('listet die Karten eines Konzepts: auch pausierte, nicht gelöschte, (created_at, id)', async () => {
    await seed();
    const a = await create('k1', basic('Frage A?'));
    const b = await create('k1', basic('Frage B?'));
    const c = await create('k1', basic('Frage C?'));
    await create('k2', basic('Anderes Konzept?'));
    await call('PATCH', `/cards/${b.id}`, { suspended: true });
    await call('DELETE', `/cards/${c.id}`);
    const res = await call('GET', `/concepts/${refId('k1')}/cards`);
    expect(res.statusCode).toBe(200);
    const list = CardListSchema.parse(res.json());
    expect(list.items.map((card) => card.id)).toEqual([a.id, b.id]);
    expect(list.items[1]!.suspended).toBe(true);
  });

  it('Vorschläge und Hüllen geben eine leere Liste, unbekannte oder gelöschte Konzepte 404', async () => {
    await seed();
    await world.concept('p', { status: 'vorschlag' });
    await world.concept('gone', { status: 'aktiv', deletedAt: new Date() });
    const empty = await call('GET', `/concepts/${refId('p')}/cards`);
    expect(empty.statusCode).toBe(200);
    expect(CardListSchema.parse(empty.json()).items).toEqual([]);
    for (const id of [uuidv7(), refId('gone')]) {
      const res = await call('GET', `/concepts/${id}/cards`);
      expect(res.statusCode).toBe(404);
      expect(errorOf(res).code).toBe('concept_not_found');
    }
  });
});

describe('PATCH /cards/{id}', () => {
  it('ersetzt den Inhalt auch mit anderem kind, lässt den FSRS-Zustand und die Bewertungen unberührt', async () => {
    await seed();
    const created = await create();
    const reviewed = await reviewOk(created.id, 3);
    const res = await call('PATCH', `/cards/${created.id}`, { content: cloze() });
    expect(res.statusCode, res.body).toBe(200);
    const patched = CardSchema.parse(res.json());
    expect(patched.content).toEqual(cloze());
    expect(patched.state).toEqual(reviewed.card.state);
    expect(patched.origin).toBe('manuell');
    expect(patched.sources).toEqual(created.sources);
    expect(Date.parse(patched.updated_at)).toBeGreaterThanOrEqual(Date.parse(created.updated_at));
    expect(await app.handle.sql`SELECT 1 FROM review_log WHERE card_id = ${created.id}`).toHaveLength(1);
    const [row] = await app.handle.sql`SELECT kind FROM card WHERE id = ${created.id}`;
    expect(row!.kind).toBe('cloze');
  });

  it('ersetzt die Belege (geprüft wie beim Anlegen) und pausiert bzw. setzt fort', async () => {
    await seed();
    const created = await create();
    const changed = CardSchema.parse(
      (
        await call('PATCH', `/cards/${created.id}`, {
          sources: [timeRef(), slideRef('f2', 2)],
          suspended: true,
        })
      ).json(),
    );
    expect(changed.sources.map((s) => s.ref)).toEqual([timeRef(), slideRef('f2', 2)]);
    expect(changed.suspended).toBe(true);
    const bad = await call('PATCH', `/cards/${created.id}`, { sources: [slideRef('f1', 2)] });
    expect(bad.statusCode).toBe(400);
    expect(errorOf(bad)).toMatchObject({ code: 'card_source_invalid', details: { index: 0 } });
    const resumed = CardSchema.parse(
      (await call('PATCH', `/cards/${created.id}`, { suspended: false })).json(),
    );
    expect(resumed.suspended).toBe(false);
    expect(resumed.sources.map((s) => s.ref)).toEqual([timeRef(), slideRef('f2', 2)]);
  });

  it('400 validation_failed ohne Feld, 400 card_invalid bei schlechtem Inhalt, 404 sonst', async () => {
    await seed();
    const created = await create();
    const none = await call('PATCH', `/cards/${created.id}`, {});
    expect(none.statusCode).toBe(400);
    expect(errorOf(none).code).toBe('validation_failed');
    const bad = await call('PATCH', `/cards/${created.id}`, { content: cloze('Ohne Lücke') });
    expect(bad.statusCode).toBe(400);
    expect(errorOf(bad)).toMatchObject({ code: 'card_invalid', details: { reason: 'cloze_none' } });
    expect(CardSchema.parse((await call('GET', `/cards/${created.id}`)).json()).content).toEqual(basic());
    await call('DELETE', `/cards/${created.id}`);
    for (const id of [created.id, uuidv7()]) {
      const missing = await call('PATCH', `/cards/${id}`, { suspended: true });
      expect(missing.statusCode).toBe(404);
      expect(errorOf(missing).code).toBe('card_not_found');
    }
  });
});

describe('POST /cards/{id}/review', () => {
  it('Gut auf eine neue Karte: Lernschritt, requeue, Zustand und Log in einem Zug', async () => {
    await seed();
    const created = await create();
    const id = uuidv7();
    const result = await reviewOk(created.id, 3, id, 8000);
    expect(result.review).toEqual({
      id,
      card_id: created.id,
      reviewed_at: '2026-11-13T10:00:00Z',
      rating: 3,
      duration_ms: 8000,
    });
    expect(result.card.state).toMatchObject({
      state: 'learning',
      due: '2026-11-13T10:10:00Z',
      reps: 1,
      lapses: 0,
      last_review: '2026-11-13T10:00:00Z',
    });
    expect(result.requeue).toBe(true);
    const [log] = await app.handle
      .sql`SELECT rating, rating_source, context, duration_ms, state_before, state_after FROM review_log WHERE id = ${id}`;
    expect(log).toMatchObject({ rating: 3, rating_source: 'nutzer', context: 'taeglich', duration_ms: 8000 });
    expect((log!.state_before as { state: string }).state).toBe('new');
    expect(log!.state_after).toEqual(result.card.state);
    const [stored] = await app.handle
      .sql`SELECT state, reps, due FROM card_state WHERE card_id = ${created.id}`;
    expect(stored).toMatchObject({ state: 'learning', reps: 1 });
  });

  it('Nochmal: eine Minute später wieder dran; Leicht: in Tagen, requeue false', async () => {
    await seed();
    const a = await create('k1', basic('Frage A?'));
    const b = await create('k1', basic('Frage B?'));
    const again = await reviewOk(a.id, 1);
    expect(again.card.state.due).toBe('2026-11-13T10:01:00Z');
    expect(again.requeue).toBe(true);
    const easy = await reviewOk(b.id, 4);
    expect(easy.card.state.state).toBe('review');
    expect(easy.card.state.scheduled_days).toBeGreaterThanOrEqual(1);
    expect(easy.requeue).toBe(false);
  });

  it('die Zeit kommt von der Uhr des Core, auch bei einer nicht fälligen Karte', async () => {
    await seed();
    const created = await create();
    await reviewOk(created.id, 3);
    // Die Karte ist erst in 10 min fällig, wird aber jetzt noch einmal bewertet (Block zieht sie vor)
    advance(2 * 60_000);
    const second = await reviewOk(created.id, 3);
    expect(second.review.reviewed_at).toBe('2026-11-13T10:02:00Z');
    expect(second.card.state.reps).toBe(2);
  });

  it('idempotent über die id: gleiche Bewertung noch einmal gibt 200 mit dem heutigen Stand und ändert nichts', async () => {
    await seed();
    const created = await create();
    const id = uuidv7();
    const first = await reviewOk(created.id, 3, id);
    advance(5 * 60_000);
    const replay = await reviewOk(created.id, 3, id, 9999);
    expect(replay.review).toEqual(first.review);
    expect(replay.card).toEqual(first.card);
    expect(replay.requeue).toBe(true);
    expect(await app.handle.sql`SELECT 1 FROM review_log`).toHaveLength(1);
    const [state] = await app.handle.sql`SELECT reps FROM card_state WHERE card_id = ${created.id}`;
    expect(state!.reps).toBe(1);
    // Der Wiederholung nach einem späteren Stand der Karte gibt den heutigen Stand, die Bewertung bleibt die alte
    await reviewOk(created.id, 4);
    const later = await reviewOk(created.id, 3, id);
    expect(later.review).toEqual(first.review);
    expect(later.card.state.reps).toBe(2);
    expect(later.requeue).toBe(false);
  });

  it('409 review_exists bei gleicher id mit anderem rating oder anderer Karte', async () => {
    await seed();
    const a = await create('k1', basic('Frage A?'));
    const b = await create('k1', basic('Frage B?'));
    const id = uuidv7();
    await reviewOk(a.id, 3, id);
    const otherRating = await review(a.id, 2, id);
    expect(otherRating.statusCode).toBe(409);
    expect(errorOf(otherRating).code).toBe('review_exists');
    const otherCard = await review(b.id, 3, id);
    expect(otherCard.statusCode).toBe(409);
    expect(errorOf(otherCard).code).toBe('review_exists');
    expect(await app.handle.sql`SELECT 1 FROM review_log`).toHaveLength(1);
    const [untouched] = await app.handle.sql`SELECT state FROM card_state WHERE card_id = ${b.id}`;
    expect(untouched!.state).toBe('new');
  });

  it('zehn gleichzeitige Sendungen derselben Bewertung ergeben genau eine Zeile und lauter 200', async () => {
    await seed();
    const created = await create();
    const id = uuidv7();
    const results = await Promise.all(Array.from({ length: 10 }, () => review(created.id, 3, id)));
    expect(results.map((r) => r.statusCode)).toEqual(Array.from({ length: 10 }, () => 200));
    expect(await app.handle.sql`SELECT 1 FROM review_log`).toHaveLength(1);
    const [state] = await app.handle.sql`SELECT reps FROM card_state WHERE card_id = ${created.id}`;
    expect(state!.reps).toBe(1);
  });

  it('dieselbe id für zwei Karten gleichzeitig: genau eine gewinnt, die andere bekommt 409', async () => {
    await seed();
    const a = await create('k1', basic('Frage A?'));
    const b = await create('k1', basic('Frage B?'));
    const id = uuidv7();
    const [ra, rb] = await Promise.all([review(a.id, 3, id), review(b.id, 3, id)]);
    expect([ra.statusCode, rb.statusCode].sort()).toEqual([200, 409]);
    expect(await app.handle.sql`SELECT 1 FROM review_log`).toHaveLength(1);
  });

  it('409 card_suspended; 404 für gelöschte und unbekannte Karten; 400 bei ungültigem rating', async () => {
    await seed();
    const created = await create();
    await call('PATCH', `/cards/${created.id}`, { suspended: true });
    const suspended = await review(created.id, 3);
    expect(suspended.statusCode).toBe(409);
    expect(errorOf(suspended).code).toBe('card_suspended');
    expect(await app.handle.sql`SELECT 1 FROM review_log`).toHaveLength(0);
    await call('PATCH', `/cards/${created.id}`, { suspended: false });
    for (const rating of [0, 5, 2.5]) {
      const bad = await review(created.id, rating);
      expect(bad.statusCode).toBe(400);
      expect(errorOf(bad).code).toBe('validation_failed');
    }
    const badDuration = await call('POST', `/cards/${created.id}/review`, {
      id: uuidv7(),
      rating: 3,
      duration_ms: 3_600_001,
    });
    expect(badDuration.statusCode).toBe(400);
    await call('DELETE', `/cards/${created.id}`);
    for (const id of [created.id, uuidv7()]) {
      const missing = await review(id, 3);
      expect(missing.statusCode).toBe(404);
      expect(errorOf(missing).code).toBe('card_not_found');
    }
  });
});

describe('GET /review/queue', () => {
  it('ohne Karten: has_cards false und leerer Block', async () => {
    await seed();
    const empty = await queue();
    expect(empty).toMatchObject({
      day: '2026-11-13',
      day_ends_at: '2026-11-14T03:00:00Z',
      generated_at: '2026-11-13T10:00:00Z',
      budget_minutes: 20,
      used_seconds: 0,
      estimated_seconds: 0,
      reviewed_today: 0,
      items: [],
      more_due: false,
      has_cards: false,
    });
  });

  it('neue Karten kommen als Gruppe „neu“ mit dreifacher Schätzung; Konzept und Klausurkennzeichen sind dabei', async () => {
    await seed();
    const a = await create('k1', basic('Frage A?'));
    const c = await create('k2', cloze());
    const q = await queue();
    expect(q.has_cards).toBe(true);
    expect(q.items.map((item) => [item.card.id, item.group, item.estimate_seconds])).toEqual([
      [a.id, 'neu', 36],
      [c.id, 'neu', 60],
    ]);
    expect(q.items[0]!.concept).toEqual({ id: refId('k1'), name: 'Primärschlüssel', exam_relevant: true });
    expect(q.items[1]!.concept).toMatchObject({ id: refId('k2'), exam_relevant: false });
    expect(q.estimated_seconds).toBe(96);
    expect(q.more_due).toBe(false);
  });

  it('pausierte und gelöschte Karten und Karten gelöschter Konzepte fehlen; has_cards bleibt wahr', async () => {
    await seed();
    const suspended = await create('k1', basic('Pausiert?'));
    const deleted = await create('k1', basic('Gelöscht?'));
    const orphan = await create('k2', basic('Konzept weg?'));
    await call('PATCH', `/cards/${suspended.id}`, { suspended: true });
    await call('DELETE', `/cards/${deleted.id}`);
    await app.handle.sql`UPDATE concept SET deleted_at = now() WHERE id = ${refId('k2')}`;
    const q = await queue();
    expect(q.items).toEqual([]);
    expect(q.has_cards).toBe(true);
    expect(q.more_due).toBe(false);
    expect(orphan.id).toBeTruthy();
  });

  it('Lernschritt: Karte aus Gut erscheint nach 10 min als „angefangen“, vorher gilt sie als heute fällig', async () => {
    await seed();
    const created = await create();
    await reviewOk(created.id, 3);
    const soon = await queue();
    // Fällig um 10:10, der Lerntag endet erst am 14.11. um 03:00 UTC: gehört in den heutigen Block
    expect(soon.items.map((item) => [item.card.id, item.group])).toEqual([[created.id, 'angefangen']]);
    expect(soon.reviewed_today).toBe(1);
    expect(soon.used_seconds).toBe(8);
    advance(11 * 60_000);
    const later = await queue();
    expect(later.items.map((item) => item.group)).toEqual(['angefangen']);
  });

  it('eine auf Tage verschobene Karte fehlt heute; der nächste Lerntag nimmt sie wieder auf', async () => {
    await seed();
    const created = await create();
    const easy = await reviewOk(created.id, 4);
    expect((await queue()).items).toEqual([]);
    clock = new Date(easy.card.state.due);
    clock = new Date(clock.getTime() + 60_000);
    const due = await queue();
    expect(due.items.map((item) => [item.card.id, item.group])).toEqual([[created.id, 'faellig']]);
    expect(due.used_seconds).toBe(0);
    expect(due.reviewed_today).toBe(0);
  });

  it('Tageswechsel um 04:00 Ortszeit: um 03:30 Zürcher Zeit zählt noch der Vortag', async () => {
    await seed();
    clock = new Date('2026-11-14T02:30:00Z');
    expect((await queue()).day).toBe('2026-11-13');
    clock = new Date('2026-11-14T03:00:00Z');
    const next = await queue();
    expect(next.day).toBe('2026-11-14');
    expect(next.day_ends_at).toBe('2026-11-15T03:00:00Z');
  });

  it('Zeitbudget: Rest 0 lässt nur Angefangene zu; extra_minutes öffnet weitere', async () => {
    await seed();
    for (let i = 0; i < 4; i += 1) await create('k1', basic(`Frage ${i}?`));
    // 1 min = 60 s Rest, eine neue Karte kostet 36 s, Reserve hilft hier nicht: nur eine passt
    const tight = await queue('?budget_minutes=1');
    expect(tight.items).toHaveLength(1);
    expect(tight.more_due).toBe(true);
    expect(tight.budget_minutes).toBe(1);
    const more = await queue('?budget_minutes=1&extra_minutes=10');
    expect(more.items.length).toBeGreaterThan(tight.items.length);
    expect(more.budget_minutes).toBe(1);
  });

  it('verbrauchte Zeit zählt gegen das Budget (Deckel 2 min je Bewertung)', async () => {
    await seed();
    const created = await create();
    await create('k1', basic('Zweite?'));
    await reviewOk(created.id, 3, uuidv7(), 600_000);
    const q = await queue();
    expect(q.used_seconds).toBe(120);
    expect(q.reviewed_today).toBe(1);
  });

  it('neue Karten je Tag aus den Einstellungen; begonnene Karten zählen mit', async () => {
    await seed();
    const cards: Card[] = [];
    for (let i = 0; i < 5; i += 1) cards.push(await create('k1', basic(`Frage ${i}?`)));
    const set = await call('PATCH', '/settings', { learning: { new_cards_per_day: 2 } });
    expect(set.statusCode, set.body).toBe(200);
    let q = await queue('?budget_minutes=120');
    expect(q.items.filter((item) => item.group === 'neu')).toHaveLength(2);
    expect(q.more_due).toBe(false);
    await reviewOk(q.items[0]!.card.id, 4);
    q = await queue('?budget_minutes=120');
    expect(q.items.filter((item) => item.group === 'neu')).toHaveLength(1);
  });

  it('das Budget aus den Einstellungen gilt, wenn die Anfrage keines nennt', async () => {
    await seed();
    await call('PATCH', '/settings', { learning: { review_budget_minutes: 45 } });
    expect((await queue()).budget_minutes).toBe(45);
    expect((await queue('?budget_minutes=7')).budget_minutes).toBe(7);
  });

  it('400 validation_failed bei Budget außerhalb 1–240 und extra_minutes außerhalb 0–120', async () => {
    for (const query of [
      '?budget_minutes=0',
      '?budget_minutes=241',
      '?extra_minutes=-1',
      '?extra_minutes=121',
      '?budget_minutes=abc',
      '?budget_minutes=1.5',
    ]) {
      const res = await call('GET', `/review/queue${query}`);
      expect(res.statusCode, query).toBe(400);
      expect(errorOf(res).code).toBe('validation_failed');
    }
  });

  it('die Antwort nennt keine Zahl der insgesamt fälligen Karten (LP9)', async () => {
    await seed();
    await create();
    const q = await queue();
    expect(Object.keys(q).sort()).toEqual(
      [
        'budget_minutes',
        'day',
        'day_ends_at',
        'estimated_seconds',
        'generated_at',
        'has_cards',
        'items',
        'more_due',
        'reviewed_today',
        'used_seconds',
      ].sort(),
    );
  });

  it('Schätzung aus der eigenen Zeit: ab 20 Bewertungen der Median, begrenzt auf 5 bis 60 s', async () => {
    await seed();
    const old = await create('k1', basic('Oft bewertet?'));
    await call('PATCH', `/cards/${old.id}`, { suspended: true });
    const fresh = await create('k1', basic('Neue Karte?'));
    const insertLogs = async (count: number, durationMs: number) => {
      await app.handle.sql`DELETE FROM review_log`;
      for (let i = 0; i < count; i += 1) {
        await app.handle
          .sql`INSERT INTO review_log (id, user_id, card_id, reviewed_at, rating, rating_source, duration_ms, context, state_before, state_after)
          VALUES (${uuidv7()}, ${SINGLE_USER_ID}, ${old.id}, '2026-11-01T10:00:00Z'::timestamptz, 3, 'nutzer', ${durationMs}, 'taeglich', '{}'::jsonb, '{}'::jsonb)`;
      }
    };
    const estimate = async () =>
      (await queue('?budget_minutes=120')).items.find((i) => i.card.id === fresh.id)!.estimate_seconds;
    expect(await estimate()).toBe(36); // keine Bewertungen: Startwert 12 s, neue Karte dreifach
    await insertLogs(19, 30_000);
    expect(await estimate()).toBe(36); // 19 < 20: noch die Startwerte
    await insertLogs(20, 30_000);
    expect(await estimate()).toBe(90); // Median 30 s
    await insertLogs(20, 90_000);
    expect(await estimate()).toBe(180); // Median 90 s, begrenzt auf 60 s
    await insertLogs(20, 1_000);
    expect(await estimate()).toBe(15); // Median 1 s, begrenzt auf 5 s
  });
});

describe('Papierkorb (§21.8)', () => {
  it('Löschen: 204, Zustand und Bewertungen gehen mit; GET /trash zeigt Titel und Konzept; Wiederherstellen bringt alles zurück', async () => {
    await seed();
    const created = await create('k1', basic('Wann ist eine Relation in dritter Normalform?'));
    await reviewOk(created.id, 3);
    const del = await call('DELETE', `/cards/${created.id}`);
    expect(del.statusCode).toBe(204);
    const stamps = await app.handle
      .sql`SELECT c.deleted_at::text AS c, s.deleted_at::text AS s, (SELECT deleted_at::text FROM review_log LIMIT 1) AS l
      FROM card c JOIN card_state s ON s.card_id = c.id WHERE c.id = ${created.id}`;
    expect(stamps[0]!.c).not.toBeNull();
    expect(stamps[0]!.s).toBe(stamps[0]!.c);
    expect(stamps[0]!.l).toBe(stamps[0]!.c);

    const trash = TrashListSchema.parse((await call('GET', '/trash')).json());
    expect(trash.items).toHaveLength(1);
    expect(trash.items[0]).toMatchObject({
      id: created.id,
      kind: 'card',
      title: 'Wann ist eine Relation in dritter Normalform?',
      parent: { id: refId('k1'), kind: 'concept', title: 'Primärschlüssel' },
      dependent_count: 0,
    });
    const filtered = TrashListSchema.parse((await call('GET', '/trash?kind=card')).json());
    expect(filtered.items).toHaveLength(1);

    const restored = await call('POST', `/trash/${created.id}/restore`);
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json()).toEqual({ id: created.id, kind: 'card', restored_count: 3 });
    const back = CardSchema.parse((await call('GET', `/cards/${created.id}`)).json());
    expect(back.state.state).toBe('learning');
    expect(await app.handle.sql`SELECT 1 FROM review_log WHERE deleted_at IS NULL`).toHaveLength(1);
  });

  it('Titel: höchstens 80 Zeichen, bei cloze mit […] statt der Lücken', async () => {
    await seed();
    const long = await create('k1', basic(`${'Lang '.repeat(30)}Ende?`));
    const gap = await create(
      'k1',
      cloze('Ein {{c1::Tupel}} ist eine {{c2::Zeile}}.', { c1: ['Tupel'], c2: ['Zeile'] }),
    );
    await call('DELETE', `/cards/${long.id}`);
    await call('DELETE', `/cards/${gap.id}`);
    const items = TrashListSchema.parse((await call('GET', '/trash')).json()).items;
    const byId = new Map(items.map((item) => [item.id, item.title]));
    expect(byId.get(long.id)).toHaveLength(80);
    expect(byId.get(long.id)).toBe(`${'Lang '.repeat(30)}Ende?`.slice(0, 80));
    expect(byId.get(gap.id)).toBe('Ein […] ist eine […].');
  });

  it('Wiederherstellen: 409 restore_parent_deleted, wenn das Konzept gelöscht oder nicht mehr aktiv ist', async () => {
    await seed();
    const created = await create();
    await call('DELETE', `/cards/${created.id}`);
    await app.handle
      .sql`UPDATE concept SET status = 'vorschlag', proposal_session_id = ${refId('s1')} WHERE id = ${refId('k1')}`;
    const inactive = await call('POST', `/trash/${created.id}/restore`);
    expect(inactive.statusCode).toBe(409);
    expect(errorOf(inactive)).toMatchObject({
      code: 'restore_parent_deleted',
      details: { parent: { id: refId('k1'), kind: 'concept', title: 'Primärschlüssel' } },
    });
    await app.handle
      .sql`UPDATE concept SET status = 'aktiv', proposal_session_id = NULL, deleted_at = now() WHERE id = ${refId('k1')}`;
    const gone = await call('POST', `/trash/${created.id}/restore`);
    expect(gone.statusCode).toBe(409);
    expect(errorOf(gone).code).toBe('restore_parent_deleted');
    await app.handle.sql`UPDATE concept SET deleted_at = NULL WHERE id = ${refId('k1')}`;
    expect((await call('POST', `/trash/${created.id}/restore`)).statusCode).toBe(200);
  });

  it('Wiederherstellen sperrt das Konzept FOR SHARE: ein gleichzeitiges Zurückstufen (reopen von A1) kommt nicht dazwischen', async () => {
    await seed();
    const created = await create();
    await call('DELETE', `/cards/${created.id}`);
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    // Verbindung 1 stuft das Konzept zurück (hält `FOR NO KEY UPDATE`), committet aber erst später
    const downgrade = app.handle.db.transaction(async (tx) => {
      await tx.execute(
        dsql`UPDATE concept SET status = 'vorschlag', proposal_session_id = ${refId('s1')} WHERE id = ${refId('k1')}`,
      );
      await released;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Verbindung 2 stellt die Karte wieder her und muss auf die Sperre warten, sieht danach das zurückgestufte Konzept
    let finished = false;
    const restoring = call('POST', `/trash/${created.id}/restore`).then((res) => {
      finished = true;
      return res;
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(finished).toBe(false);
    release();
    await downgrade;
    const res = await restoring;
    expect(res.statusCode, res.body).toBe(409);
    expect(errorOf(res).code).toBe('restore_parent_deleted');
    expect(await app.handle.sql`SELECT 1 FROM card WHERE deleted_at IS NULL`).toHaveLength(0);
  });

  it('endgültig löschen entfernt Karte, Zustand und Bewertungen', async () => {
    await seed();
    const created = await create();
    await reviewOk(created.id, 3);
    await call('DELETE', `/cards/${created.id}`);
    const purged = await call('DELETE', `/trash/${created.id}`);
    expect(purged.statusCode, purged.body).toBe(204);
    expect(await app.handle.sql`SELECT 1 FROM card`).toHaveLength(0);
    expect(await app.handle.sql`SELECT 1 FROM card_state`).toHaveLength(0);
    expect(await app.handle.sql`SELECT 1 FROM review_log`).toHaveLength(0);
  });

  it('eine gelöschte Karte lässt sich nicht noch einmal löschen (404)', async () => {
    await seed();
    const created = await create();
    expect((await call('DELETE', `/cards/${created.id}`)).statusCode).toBe(204);
    const again = await call('DELETE', `/cards/${created.id}`);
    expect(again.statusCode).toBe(404);
    expect(errorOf(again).code).toBe('card_not_found');
  });

  it('bleibt beim Löschen der Session erhalten (Belege zeigen missing)', async () => {
    await seed();
    const created = await create('k1', basic(), [timeRef()]);
    await app.handle.sql`UPDATE session SET deleted_at = now() WHERE id = ${refId('s1')}`;
    const read = CardSchema.parse((await call('GET', `/cards/${created.id}`)).json());
    expect(read.sources[0]!.missing).toBe(true);
  });
});

describe('Einstellungen learning (§21.9)', () => {
  it('GET /settings liefert die Standards, PATCH führt Feld für Feld zusammen und prüft die Grenzen', async () => {
    const before = SettingsSchema.parse((await call('GET', '/settings')).json());
    expect(before.learning).toEqual({ review_budget_minutes: 20, new_cards_per_day: 20 });
    const first = await call('PATCH', '/settings', { learning: { review_budget_minutes: 30 } });
    expect(SettingsSchema.parse(first.json()).learning).toEqual({
      review_budget_minutes: 30,
      new_cards_per_day: 20,
    });
    const second = await call('PATCH', '/settings', { learning: { new_cards_per_day: 0 } });
    expect(SettingsSchema.parse(second.json()).learning).toEqual({
      review_budget_minutes: 30,
      new_cards_per_day: 0,
    });
    for (const learning of [
      { review_budget_minutes: 4 },
      { review_budget_minutes: 121 },
      { new_cards_per_day: -1 },
      { new_cards_per_day: 101 },
      { new_cards_per_day: 1.5 },
      { unbekannt: 1 },
    ]) {
      const bad = await call('PATCH', '/settings', { learning });
      expect(bad.statusCode, JSON.stringify(learning)).toBe(400);
    }
  });
});
