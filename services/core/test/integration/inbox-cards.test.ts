// B3: Inbox-Art `card_batch` (VERTRAEGE §21.7) gegen die echte Datenbank: Sichtbarkeit, Karten annehmen (A4), Ablehnen,
// Verfall mit dem Konzept, Rückgängig samt Sperren für A1 und A2, Massenaktionen. Die Vorschläge stehen direkt in den
// Tabellen (der Worker läuft nicht). Den ganzen Weg mit Worker prüft `e2e-inbox-worker.test.ts`.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CardListSchema,
  InboxBulkResultSchema,
  InboxDecisionResultSchema,
  InboxItemListSchema,
  InboxOverviewSchema,
  type CardProposal,
  type InboxDecisionResult,
} from '@sg/shared';
import { uuidv7 } from '../../src/lib/uuid7.ts';
import { startTestApp, type TestApp } from './helpers.ts';
import { defaultCards, refId, World } from './inbox-helpers.ts';

const API = '/api/v1';
let app: TestApp;
let world: World;

beforeAll(async () => {
  app = await startTestApp();
  world = new World(app.handle);
});
afterAll(async () => {
  await world.reset();
  await app.close();
});
beforeEach(async () => {
  await world.reset();
});

const get = (path: string) => app.request({ method: 'GET', url: `${API}${path}` });
const post = (path: string, payload?: unknown) =>
  app.request({
    method: 'POST',
    url: `${API}${path}`,
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
const accept = (ref: string, body: unknown = {}) => post(`/inbox/${refId(ref)}/accept`, body);
const reject = (ref: string) => post(`/inbox/${refId(ref)}/reject`);
const reopen = (ref: string) => post(`/inbox/${refId(ref)}/reopen`);
const bulk = (body: unknown) => post('/inbox/bulk', body);
const errorOf = (res: { json: () => { error?: { code: string; details?: Record<string, unknown> } } }) =>
  res.json().error;

function ok(res: { statusCode: number; body: string; json: () => unknown }): InboxDecisionResult {
  expect(res.statusCode, res.body).toBe(200);
  return InboxDecisionResultSchema.parse(res.json());
}

async function openIds(query = ''): Promise<string[]> {
  const res = await get(`/inbox?status=offen${query}`);
  expect(res.statusCode, res.body).toBe(200);
  return InboxItemListSchema.parse(res.json()).items.map((i) => i.id);
}

/** Aktives Konzept `c1` (Name wie die Karten) mit einem offenen Kartenvorschlag `b1`, Session `s1` */
async function activeBatch(cards?: CardProposal[]): Promise<void> {
  await world.concept('c1', { status: 'aktiv', name: 'Tupel' });
  await world.item('b1', { kind: 'card_batch', cardConcept: 'c1', ...(cards ? { cards } : {}) });
}

/** Vorschlag-Konzept `p1` mit Eintrag `i1`, dazu ein Kartenvorschlag `b1` */
async function proposalBatch(): Promise<void> {
  await world.concept('p1', { name: 'Tupel' });
  await world.item('i1', { kind: 'concept_new', concept: 'p1' });
  await world.item('b1', { kind: 'card_batch', cardConcept: 'p1' });
}

const basic = (key: string, front: string, answer = 'Antwort.'): CardProposal => ({
  key,
  content: { kind: 'basic', front: { text_md: front }, back: { text_md: answer, explanation_md: null } },
  sources: defaultCards('s1')[0]!.sources,
});

describe('Sichtbarkeit (§21.7)', () => {
  it('ein Kartenvorschlag zu einem Vorschlag-Konzept fehlt in Liste und Übersicht', async () => {
    await proposalBatch();
    expect(await openIds()).toEqual([refId('i1')]);
    expect(await openIds('&kind=card_batch')).toEqual([]);
    const overview = InboxOverviewSchema.parse((await get('/inbox/overview')).json());
    expect(overview.open_count).toBe(1);
    expect(overview.older_count).toBe(0);
    expect(overview.sessions.map((s) => s.open_count)).toEqual([1]);
  });

  it('eine Massenaktion mit session_id fasst ihn nicht an, solange sein Konzept nicht aktiv ist', async () => {
    await world.concept('p1');
    await world.item('b1', { kind: 'card_batch', cardConcept: 'p1' });
    for (const action of ['accept', 'reject'] as const) {
      const res = await bulk({ action, session_id: refId('s1') });
      expect(InboxBulkResultSchema.parse(res.json())).toEqual({ decided: [], skipped: [] });
    }
    expect((await world.itemRow('b1')).status).toBe('offen');
    expect(await world.cardRows()).toEqual([]);
  });

  it('einzeln annehmen scheitert mit card_concept_pending, nichts ändert sich', async () => {
    await proposalBatch();
    const before = await world.snapshot();
    const res = await accept('b1');
    expect(res.statusCode).toBe(409);
    expect(errorOf(res)).toMatchObject({
      code: 'card_concept_pending',
      details: { concept_id: refId('p1') },
    });
    expect(await world.snapshot()).toEqual(before);
    expect(await world.cardRows()).toEqual([]);
  });

  it('mit ids landet ein nicht sichtbarer Kartenvorschlag in skipped', async () => {
    await proposalBatch();
    for (const action of ['accept', 'reject'] as const) {
      const res = await bulk({ action, ids: [refId('b1')] });
      expect(InboxBulkResultSchema.parse(res.json())).toEqual({
        decided: [],
        skipped: [{ id: refId('b1'), code: 'card_concept_pending' }],
      });
    }
    expect((await world.itemRow('b1')).status).toBe('offen');
  });

  it('mit ids: wird das Konzept in derselben Aktion angenommen, zählt der Kartenvorschlag', async () => {
    await proposalBatch();
    const res = await bulk({ action: 'accept', ids: [refId('b1'), refId('i1')] });
    expect(InboxBulkResultSchema.parse(res.json())).toEqual({
      decided: [refId('i1'), refId('b1')],
      skipped: [],
    });
  });

  it('wird mit dem angenommenen Konzept sichtbar, ohne dass er mit angenommen wird', async () => {
    await proposalBatch();
    const result = ok(await accept('i1'));
    expect(result.item.status).toBe('angenommen');
    expect(await openIds('&kind=card_batch')).toEqual([refId('b1')]);
    expect((await world.itemRow('b1')).status).toBe('offen');
    expect((await world.itemRow('i1')).decision?.cascade_item_ids).toEqual([]);
    const overview = InboxOverviewSchema.parse((await get('/inbox/overview')).json());
    expect(overview.open_count).toBe(1);
  });

  it('entschiedene Kartenvorschläge bleiben in der Liste, auch wenn ihr Konzept nicht aktiv ist', async () => {
    await world.concept('p1');
    await world.item('b1', { kind: 'card_batch', cardConcept: 'p1', status: 'abgelehnt' });
    const res = await get('/inbox?status=entschieden');
    expect(InboxItemListSchema.parse(res.json()).items.map((i) => i.id)).toEqual([refId('b1')]);
  });

  it('bei einer Hülle zählt das Ziel: sichtbar nach dem Zusammenführen, Karten gehören dem Ziel', async () => {
    await world.concept('t1', { status: 'aktiv', name: 'Relation' });
    await world.concept('p1', { name: 'Relation (Tabelle)' });
    await world.item('i1', { kind: 'concept_merge', concept: 'p1', target: 't1' });
    await world.item('b1', { kind: 'card_batch', cardConcept: 'p1' });
    expect(await openIds('&kind=card_batch')).toEqual([]);
    ok(await accept('i1'));
    expect((await world.conceptRow('p1')).status).toBe('zusammengefuehrt');
    expect(await openIds('&kind=card_batch')).toEqual([refId('b1')]);

    const result = ok(await accept('b1'));
    expect(result.concept).toBeNull();
    expect(result.cards?.map((c) => c.concept_id)).toEqual([refId('t1'), refId('t1')]);
    expect((await world.itemRow('b1')).decision?.concept_id).toBe(refId('t1'));
  });
});

describe('Karten annehmen (A4)', () => {
  it('ohne cards werden alle angenommen: Karte und Zustand, origin ki, Rückverweis auf den Eintrag', async () => {
    await activeBatch();
    const result = ok(await accept('b1'));
    expect(result.concept).toBeNull();
    expect(result.item.status).toBe('angenommen');
    expect(result.cards).toHaveLength(2);
    expect(result.cards?.map((c) => c.content.kind)).toEqual(['basic', 'cloze']);
    expect(result.cards?.every((c) => c.origin === 'ki' && c.stage === 2 && c.state.state === 'new')).toBe(
      true,
    );

    const rows = await world.cardRows();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.inboxItemId === refId('b1') && r.conceptId === refId('c1'))).toBe(true);
    expect(await world.cardStateCount()).toBe(2);

    const decision = (await world.itemRow('b1')).decision!;
    expect(decision.action).toBe('karten_angenommen');
    expect(decision.concept_id).toBe(refId('c1'));
    expect(decision.cards).toEqual([
      { key: 'k1', outcome: 'angenommen', card_id: result.cards![0]!.id },
      { key: 'k2', outcome: 'angenommen', card_id: result.cards![1]!.id },
    ]);
    const list = CardListSchema.parse((await get(`/concepts/${refId('c1')}/cards`)).json());
    expect(list.items).toHaveLength(2);
  });

  it('einzelne verwerfen, eine bearbeiten (Inhalt und Belege)', async () => {
    await activeBatch();
    await world.deck('d1', [{ ref: 'f1', index: 1 }]);
    const sources = [{ kind: 'slide', slide_id: refId('f1'), deck_id: refId('d1'), slide_index: 1 }];
    const edited = {
      kind: 'cloze',
      front: { text_md: '  Ein {{c1:: Tupel }} ist eine Zeile.' },
      back: { answers: { c1: ['Tupel'] } },
    };
    const result = ok(
      await accept('b1', {
        cards: [
          { key: 'k1', accept: false },
          { key: 'k2', accept: true, content: edited, sources },
        ],
      }),
    );
    expect(result.cards).toHaveLength(1);
    expect(result.cards![0]!.content).toEqual({
      kind: 'cloze',
      front: { text_md: 'Ein {{c1::Tupel}} ist eine Zeile.' },
      back: { answers: { c1: ['Tupel'] } },
    });
    expect(result.cards![0]!.sources.map((s) => s.ref)).toEqual(sources);
    expect((await world.itemRow('b1')).decision?.cards).toEqual([
      { key: 'k1', outcome: 'verworfen', card_id: null },
      { key: 'k2', outcome: 'angenommen', card_id: result.cards![0]!.id },
    ]);
  });

  it('alle Karten abgewählt: wie Ablehnen, keine Karten', async () => {
    await activeBatch();
    const result = ok(
      await accept('b1', {
        cards: [
          { key: 'k1', accept: false },
          { key: 'k2', accept: false },
        ],
      }),
    );
    expect(result.item.status).toBe('abgelehnt');
    expect(result.cards).toBeUndefined();
    const decision = (await world.itemRow('b1')).decision!;
    expect(decision.action).toBe('abgelehnt');
    expect(decision.cards?.map((c) => c.outcome)).toEqual(['verworfen', 'verworfen']);
    expect(await world.cardRows()).toEqual([]);
  });

  it('ungültige Angaben: inbox_action_invalid, nichts entsteht', async () => {
    await activeBatch();
    const before = await world.snapshot();
    const bodies: unknown[] = [
      { cards: [{ key: 'k9', accept: true }] },
      {
        cards: [
          { key: 'k1', accept: true },
          { key: 'k1', accept: false },
        ],
      },
      { cards: [{ key: 'k1', accept: false, content: defaultCards('s1')[0]!.content }] },
      { cards: [{ key: 'k1', accept: false, sources: defaultCards('s1')[0]!.sources }] },
      { edit: { name: 'X' } },
      { merge_into: refId('c1') },
      { as_new: true },
      { relation_kind: 'verwandt' },
    ];
    for (const body of bodies) {
      const res = await accept('b1', body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(errorOf(res)?.code, JSON.stringify(body)).toBe('inbox_action_invalid');
    }
    expect(await world.snapshot()).toEqual(before);
    expect(await world.cardRows()).toEqual([]);
  });

  it('cards bei anderen Arten: inbox_action_invalid', async () => {
    await proposalBatch();
    const res = await accept('i1', { cards: [{ key: 'k1', accept: true }] });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res)?.code).toBe('inbox_action_invalid');
  });

  it('bearbeiteter Inhalt ungültig: card_invalid mit key und reason, die Annahme ist ganz zurückgerollt', async () => {
    await activeBatch();
    const bad = { kind: 'cloze', front: { text_md: 'Keine Lücke.' }, back: { answers: { c1: ['Tupel'] } } };
    const res = await accept('b1', { cards: [{ key: 'k2', accept: true, content: bad }] });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res)).toMatchObject({
      code: 'card_invalid',
      details: { key: 'k2', reason: 'cloze_none' },
    });
    expect((await world.itemRow('b1')).status).toBe('offen');
    expect(await world.cardRows()).toEqual([]);
  });

  it('bearbeiteter Beleg ungültig: card_source_invalid mit key und index', async () => {
    await activeBatch();
    const ghost = { kind: 'transcript', session_id: refId('s9'), t_start_ms: 0, t_end_ms: 10 };
    const res = await accept('b1', {
      cards: [{ key: 'k1', accept: true, sources: [defaultCards('s1')[0]!.sources[0], ghost] }],
    });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res)).toMatchObject({ code: 'card_source_invalid', details: { key: 'k1', index: 1 } });
    expect(await world.cardRows()).toEqual([]);
  });

  it('Belege unveränderter Karten werden nicht erneut geprüft', async () => {
    const ghost = basic('k1', 'Frage?');
    ghost.sources = [{ kind: 'transcript', session_id: refId('s9'), t_start_ms: 0, t_end_ms: 10 }];
    await activeBatch([ghost]);
    const result = ok(await accept('b1'));
    expect(result.cards![0]!.sources[0]!.missing).toBe(true);
  });

  it('Dubletten entstehen nicht: gegen vorhandene Karten und gegen frühere Karten derselben Annahme', async () => {
    await activeBatch([
      basic('k1', 'Was ist ein Tupel?'),
      basic('k2', '  was ist EIN Tupel? '),
      basic('k3', 'Was ist eine Relation?'),
      basic('k4', 'Was ist ein Schlüssel?'),
    ]);
    // vorhandene Karte mit der Vorderseite von k4
    const created = await post('/cards', {
      concept_id: refId('c1'),
      content: basic('x', 'Was ist ein Schlüssel?').content,
      sources: basic('x', 'x').sources,
    });
    expect(created.statusCode, created.body).toBe(201);
    const result = ok(await accept('b1'));
    expect(result.cards?.map((c) => c.content.front.text_md)).toEqual([
      'Was ist ein Tupel?',
      'Was ist eine Relation?',
    ]);
    expect((await world.itemRow('b1')).decision?.cards?.map((c) => c.outcome)).toEqual([
      'angenommen',
      'dublette',
      'angenommen',
      'dublette',
    ]);
  });

  it('nicht gelöschte Karten zählen für Dubletten, gelöschte nicht', async () => {
    await activeBatch([basic('k1', 'Was ist ein Tupel?')]);
    const first = await post('/cards', {
      concept_id: refId('c1'),
      content: basic('x', 'Was ist ein Tupel?').content,
      sources: basic('x', 'x').sources,
    });
    const id = (first.json() as { id: string }).id;
    expect((await app.request({ method: 'DELETE', url: `${API}/cards/${id}` })).statusCode).toBe(204);
    const result = ok(await accept('b1'));
    expect(result.cards).toHaveLength(1);
  });

  it('doppelt annehmen: inbox_item_decided', async () => {
    await activeBatch();
    ok(await accept('b1'));
    const again = await accept('b1');
    expect(again.statusCode).toBe(409);
    expect(errorOf(again)?.code).toBe('inbox_item_decided');
    expect(await world.cardRows()).toHaveLength(2);
  });
});

describe('Ablehnen und Verfall mit dem Konzept', () => {
  it('Ablehnen: alle Karten verworfen, nichts entsteht, reopen öffnet wieder', async () => {
    await activeBatch();
    const result = ok(await reject('b1'));
    expect(result.item.status).toBe('abgelehnt');
    const decision = (await world.itemRow('b1')).decision!;
    expect(decision.cards).toEqual([
      { key: 'k1', outcome: 'verworfen', card_id: null },
      { key: 'k2', outcome: 'verworfen', card_id: null },
    ]);
    expect(await world.cardRows()).toEqual([]);
    expect(ok(await reopen('b1')).item.status).toBe('offen');
    expect((await world.itemRow('b1')).decision).toBeNull();
  });

  it('das Ablehnen des Konzepts lehnt seine offenen Kartenvorschläge mit ab', async () => {
    await proposalBatch();
    await world.item('b2', { kind: 'card_batch', cardConcept: 'p1', session: 's2', priority: 2001 });
    const result = ok(await reject('i1'));
    expect(result.item.status).toBe('abgelehnt');
    const decision = (await world.itemRow('i1')).decision!;
    expect([...decision.cascade_item_ids].sort()).toEqual([refId('b1'), refId('b2')].sort());
    for (const ref of ['b1', 'b2']) {
      const row = await world.itemRow(ref);
      expect(row.status).toBe('abgelehnt');
      expect(row.decision).toMatchObject({ action: 'abgelehnt', triggered_by: refId('i1') });
      expect(row.decision?.cards?.every((c) => c.outcome === 'verworfen')).toBe(true);
    }
  });

  it('direkt lassen sie sich nicht öffnen, über das Konzept schon', async () => {
    await proposalBatch();
    ok(await reject('i1'));
    const res = await reopen('b1');
    expect(res.statusCode).toBe(409);
    expect(errorOf(res)).toMatchObject({
      code: 'inbox_reopen_conflict',
      details: { triggered_by: refId('i1') },
    });
    ok(await reopen('i1'));
    expect((await world.itemRow('b1')).status).toBe('offen');
    expect((await world.itemRow('b1')).decision).toBeNull();
  });

  it('bereits entschiedene Kartenvorschläge bleiben beim Ablehnen des Konzepts unberührt', async () => {
    await proposalBatch();
    await world.item('b2', {
      kind: 'card_batch',
      cardConcept: 'p1',
      session: 's2',
      status: 'angenommen',
      decision: { action: 'karten_angenommen', cards: [] },
    });
    ok(await reject('i1'));
    expect((await world.itemRow('b2')).status).toBe('angenommen');
    expect((await world.itemRow('i1')).decision?.cascade_item_ids).toEqual([refId('b1')]);
  });
});

describe('Rückgängig (reopen)', () => {
  it('angenommen: die Karten werden hart gelöscht, auch aus dem Papierkorb', async () => {
    await activeBatch();
    const result = ok(await accept('b1'));
    const [first] = result.cards!;
    expect((await app.request({ method: 'DELETE', url: `${API}/cards/${first!.id}` })).statusCode).toBe(204);
    const reopened = ok(await reopen('b1'));
    expect(reopened.item.status).toBe('offen');
    expect(reopened.cards).toBeUndefined();
    expect(await world.cardRows()).toEqual([]);
    expect(await world.cardStateCount()).toBe(0);
    expect((await world.itemRow('b1')).decision).toBeNull();
    // erneut annehmen geht
    expect(ok(await accept('b1')).cards).toHaveLength(2);
  });

  it('mit einer Bewertung: inbox_reopen_conflict, nichts ändert sich', async () => {
    await activeBatch();
    const result = ok(await accept('b1'));
    const review = await post(`/cards/${result.cards![0]!.id}/review`, {
      id: uuidv7(),
      rating: 3,
      duration_ms: 2000,
    });
    expect(review.statusCode, review.body).toBe(200);
    const before = await world.snapshot();
    const res = await reopen('b1');
    expect(res.statusCode).toBe(409);
    expect(errorOf(res)?.code).toBe('inbox_reopen_conflict');
    expect(await world.snapshot()).toEqual(before);
    expect(await world.cardRows()).toHaveLength(2);
  });

  it('eine Karte ist schon endgültig gelöscht: kein Fehler, die übrigen gehen weg', async () => {
    await activeBatch();
    const result = ok(await accept('b1'));
    await app.handle.sql`DELETE FROM card WHERE id = ${result.cards![0]!.id}`;
    const reopened = ok(await reopen('b1'));
    expect(reopened.item.status).toBe('offen');
    expect(await world.cardRows()).toEqual([]);
  });

  it('alle Karten schon endgültig gelöscht: kein Fehler', async () => {
    await activeBatch();
    ok(await accept('b1'));
    await app.handle.sql`DELETE FROM card`;
    expect(ok(await reopen('b1')).item.status).toBe('offen');
  });

  it('Karten mit Dubletten-Ergebnis: nur die angelegten werden gelöscht, eine manuelle Karte bleibt', async () => {
    await activeBatch([basic('k1', 'Was ist ein Tupel?'), basic('k2', 'Was ist eine Relation?')]);
    const manual = await post('/cards', {
      concept_id: refId('c1'),
      content: basic('x', 'Was ist ein Tupel?').content,
      sources: basic('x', 'x').sources,
    });
    const manualId = (manual.json() as { id: string }).id;
    ok(await accept('b1'));
    ok(await reopen('b1'));
    expect((await world.cardRows()).map((c) => c.id)).toEqual([manualId]);
  });
});

describe('reopen von A1 und A2 (§21.7)', () => {
  it('A1: mit Karten am Konzept: inbox_reopen_conflict', async () => {
    await proposalBatch();
    ok(await accept('i1'));
    ok(await accept('b1'));
    const before = await world.snapshot();
    const res = await reopen('i1');
    expect(res.statusCode).toBe(409);
    expect(errorOf(res)?.code).toBe('inbox_reopen_conflict');
    expect(await world.snapshot()).toEqual(before);
    expect((await world.conceptRow('p1')).status).toBe('aktiv');
  });

  it('A1: auch eine von Hand angelegte Karte sperrt', async () => {
    await proposalBatch();
    ok(await accept('i1'));
    const manual = await post('/cards', {
      concept_id: refId('p1'),
      content: basic('x', 'Was ist ein Tupel?').content,
      sources: basic('x', 'x').sources,
    });
    expect(manual.statusCode, manual.body).toBe(201);
    expect((await reopen('i1')).statusCode).toBe(409);
  });

  it('A1: nach reopen des Kartenvorschlags geht es, und die Kartenvorschläge werden wieder unsichtbar', async () => {
    await proposalBatch();
    ok(await accept('i1'));
    ok(await accept('b1'));
    ok(await reopen('b1'));
    ok(await reopen('i1'));
    expect((await world.conceptRow('p1')).status).toBe('vorschlag');
    expect(await openIds('&kind=card_batch')).toEqual([]);
  });

  it('A1: gelöschte Karten (Papierkorb) sperren nicht', async () => {
    await proposalBatch();
    ok(await accept('i1'));
    const result = ok(await accept('b1'));
    for (const c of result.cards!) {
      expect((await app.request({ method: 'DELETE', url: `${API}/cards/${c.id}` })).statusCode).toBe(204);
    }
    expect(ok(await reopen('i1')).item.status).toBe('offen');
  });

  it('A2: ein angenommener Kartenvorschlag der Hülle sperrt', async () => {
    await world.concept('t1', { status: 'aktiv', name: 'Relation' });
    await world.concept('p1', { name: 'Relation (Tabelle)' });
    await world.item('i1', { kind: 'concept_merge', concept: 'p1', target: 't1' });
    await world.item('b1', { kind: 'card_batch', cardConcept: 'p1' });
    ok(await accept('i1'));
    ok(await accept('b1'));
    const res = await reopen('i1');
    expect(res.statusCode).toBe(409);
    expect(errorOf(res)?.code).toBe('inbox_reopen_conflict');
    expect((await world.conceptRow('p1')).status).toBe('zusammengefuehrt');
    // erst die Karten zurück, dann die Zusammenführung
    ok(await reopen('b1'));
    ok(await reopen('i1'));
    expect((await world.conceptRow('p1')).status).toBe('vorschlag');
  });

  it('A2: ein offener Kartenvorschlag der Hülle sperrt nicht', async () => {
    await world.concept('t1', { status: 'aktiv', name: 'Relation' });
    await world.concept('p1', { name: 'Relation (Tabelle)' });
    await world.item('i1', { kind: 'concept_merge', concept: 'p1', target: 't1' });
    await world.item('b1', { kind: 'card_batch', cardConcept: 'p1' });
    ok(await accept('i1'));
    expect(ok(await reopen('i1')).item.status).toBe('offen');
  });
});

describe('Massenaktionen', () => {
  it('accept mit session_id: erst Konzepte, danach die dann sichtbaren Kartenvorschläge (alle Karten)', async () => {
    await proposalBatch();
    await world.concept('c2', { status: 'aktiv', name: 'Schlüssel' });
    await world.item('b2', { kind: 'card_batch', cardConcept: 'c2', priority: 2001 });
    const res = await bulk({ action: 'accept', session_id: refId('s1') });
    // b1 wird erst durch die Annahme von i1 sichtbar und kommt im selben Aufruf dran
    const result = InboxBulkResultSchema.parse(res.json());
    expect(result.skipped).toEqual([]);
    expect(result.decided).toEqual([refId('i1'), refId('b1'), refId('b2')]);
    expect(await world.cardRows()).toHaveLength(4);
  });

  it('reject mit session_id: Konzept zuerst, die Kartenvorschläge folgen über den Verfall', async () => {
    await proposalBatch();
    const result = InboxBulkResultSchema.parse(
      (await bulk({ action: 'reject', session_id: refId('s1') })).json(),
    );
    expect(result).toEqual({ decided: [refId('i1'), refId('b1')], skipped: [] });
    expect((await world.itemRow('b1')).decision?.triggered_by).toBe(refId('i1'));
  });

  it('reopen mit session_id: Kartenvorschlag vor dem Konzept, A1 wird nicht blockiert', async () => {
    await proposalBatch();
    ok(await accept('i1'));
    ok(await accept('b1'));
    const result = InboxBulkResultSchema.parse(
      (await bulk({ action: 'reopen', session_id: refId('s1') })).json(),
    );
    expect(result.skipped).toEqual([]);
    expect(result.decided).toEqual([refId('b1'), refId('i1')]);
    expect(await world.cardRows()).toEqual([]);
    expect((await world.conceptRow('p1')).status).toBe('vorschlag');
  });

  it('accept mit ids: ein Kartenvorschlag mit schon gelöschtem Konzept landet in skipped', async () => {
    await activeBatch();
    await app.handle.sql`UPDATE concept SET deleted_at = now() WHERE id = ${refId('c1')}`;
    const res = await bulk({ action: 'accept', ids: [refId('b1')] });
    expect(InboxBulkResultSchema.parse(res.json()).skipped).toEqual([
      { id: refId('b1'), code: 'card_concept_pending' },
    ]);
  });
});
