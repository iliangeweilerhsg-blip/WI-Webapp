// T2-22b: Inbox (VERTRAEGE §20.6) gegen die echte Datenbank: Lesen, Annehmen (A1–A3), Ablehnen, Rückgängig und
// Massenaktionen. Die Tests schreiben Vorschläge selbst in die Tabellen, der Worker läuft nicht.
// Die gemeinsamen Testfälle stehen in `inbox-fixtures.test.ts`, Nebenläufigkeit in `inbox-concurrency.test.ts`.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  InboxBulkResultSchema,
  InboxDecisionResultSchema,
  InboxItemListSchema,
  InboxOverviewSchema,
  type InboxBulkResult,
  type InboxDecisionResult,
  type InboxItemList,
  type InboxOverview,
} from '@sg/shared';
import { uuidv7 } from '../../src/lib/uuid7.ts';
import { startTestApp, type TestApp } from './helpers.ts';
import { refId, World } from './inbox-helpers.ts';

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
const post = (path: string, payload?: unknown, headers: Record<string, string> = {}) =>
  app.request({
    method: 'POST',
    url: `${API}${path}`,
    headers,
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
const accept = (ref: string, body: unknown = {}) => post(`/inbox/${refId(ref)}/accept`, body);
const reject = (ref: string) => post(`/inbox/${refId(ref)}/reject`);
const reopen = (ref: string) => post(`/inbox/${refId(ref)}/reopen`);
const errorOf = (res: { json: () => { error?: { code: string; details?: Record<string, unknown> } } }) =>
  res.json().error;

function ok(res: { statusCode: number; body: string; json: () => unknown }): InboxDecisionResult {
  expect(res.statusCode, res.body).toBe(200);
  return InboxDecisionResultSchema.parse(res.json());
}

// --- Lesen -------------------------------------------------------------------------------------------------

describe('GET /inbox', () => {
  const A = new Date('2026-11-05T10:00:00Z');
  const B = new Date('2026-11-06T10:00:00Z');

  async function seed() {
    await world.session('s1', { number: 7, title: 'Normalformen', startedAt: A });
    await world.session('s2', { number: 8, startedAt: B });
    await world.concept('p1', { name: 'Zweite Normalform' });
    await world.concept('p2', { name: 'Dritte Normalform' });
    await world.concept('p3', { name: 'Tupel', session: 's2' });
    await world.concept('t1', { name: 'Erste Normalform', status: 'aktiv' });
    await world.concept('t2', { name: 'Relation', status: 'aktiv' });
    await world.relation('r1', { from: 'p1', to: 't1' });
    await world.relation('r2', { from: 'p2', to: 't1' });
    await world.relation('r3', { from: 't1', to: 't2' });
    await world.item('i1', { kind: 'concept_new', concept: 'p1', priority: 100, createdAt: A });
    await world.item('i2', {
      kind: 'concept_new',
      concept: 'p2',
      priority: 0,
      createdAt: A,
      status: 'abgelehnt',
    });
    await world.item('ir1', { kind: 'relation', relation: 'r1', priority: 1001, createdAt: A });
    await world.item('ir2', { kind: 'relation', relation: 'r2', priority: 1000, createdAt: A });
    await world.item('ir3', { kind: 'relation', relation: 'r3', priority: 1000, createdAt: A });
    await world.item('i3', {
      kind: 'concept_new',
      concept: 'p3',
      session: 's2',
      priority: 200,
      createdAt: B,
    });
  }

  const list = async (query = ''): Promise<InboxItemList> => {
    const res = await get(`/inbox${query}`);
    expect(res.statusCode, res.body).toBe(200);
    return InboxItemListSchema.parse(res.json());
  };
  const ids = (page: InboxItemList) => page.items.map((item) => item.id);

  it('Standard: offene Einträge, neuester Lauf zuerst, darin nach priority und id', async () => {
    await seed();
    const page = await list();
    expect(ids(page)).toEqual(['i3', 'i1', 'ir2', 'ir3', 'ir1'].map(refId));
    expect(page.next_cursor).toBeNull();
    expect(page.items[1]!.session).toEqual({
      id: refId('s1'),
      number: 7,
      title: 'Normalformen',
      started_at: '2026-11-05T10:00:00Z',
      module: { id: refId('m1'), name: 'Datenbanken', short_name: null },
    });
    expect(page.items[1]).toMatchObject({ kind: 'concept_new', status: 'offen', concept_id: refId('p1') });
  });

  it('blocked: Endpunkt noch offen, abgelehnt oder frei', async () => {
    await seed();
    const byId = new Map((await list()).items.map((item) => [item.id, item.blocked]));
    expect(byId.get(refId('ir1'))).toBe('endpunkt_offen');
    expect(byId.get(refId('ir2'))).toBe('endpunkt_abgelehnt');
    expect(byId.get(refId('ir3'))).toBeNull();
    expect(byId.get(refId('i1'))).toBeNull();
  });

  it('Filter status, kind (mehrfach) und session_id', async () => {
    await seed();
    expect(ids(await list('?status=entschieden'))).toEqual([refId('i2')]);
    expect(ids(await list('?status=alle'))).toHaveLength(6);
    expect(ids(await list('?kind=relation'))).toEqual(['ir2', 'ir3', 'ir1'].map(refId));
    expect(ids(await list('?kind=relation&kind=concept_new'))).toHaveLength(5);
    expect(ids(await list('?kind=concept_merge'))).toEqual([]);
    expect(ids(await list(`?session_id=${refId('s2')}`))).toEqual([refId('i3')]);
  });

  it('blättert ohne Lücken und Dubletten', async () => {
    await seed();
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: InboxItemList = await list(`?status=alle&limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...ids(page));
      cursor = page.next_cursor;
    } while (cursor);
    expect(seen).toEqual(ids(await list('?status=alle')));
    expect(new Set(seen).size).toBe(6);
  });

  it('400 bei ungültigen Parametern', async () => {
    for (const query of ['?status=neu', '?kind=card_batch', '?session_id=x', '?limit=0', '?limit=201']) {
      const res = await get(`/inbox${query}`);
      expect(res.statusCode, query).toBe(400);
      expect(errorOf(res)?.code).toBe('validation_failed');
    }
    const res = await get('/inbox?cursor=kaputt');
    expect(res.statusCode).toBe(400);
    expect(errorOf(res)?.code).toBe('invalid_cursor');
  });

  it('gelöschte Einträge und Einträge gelöschter Sessions gibt es nicht', async () => {
    await seed();
    await app.handle.sql`UPDATE inbox_item SET deleted_at = now() WHERE id = ${refId('i1')}`;
    await app.handle.sql`UPDATE session SET deleted_at = now() WHERE id = ${refId('s2')}`;
    expect(ids(await list())).toEqual(['ir2', 'ir3', 'ir1'].map(refId));
    expect((await accept('i1')).statusCode).toBe(404);
    expect((await accept('i3')).statusCode).toBe(404);
    expect(errorOf(await reject('i3'))?.code).toBe('inbox_item_not_found');
  });
});

describe('GET /inbox/overview', () => {
  it('zählt offene und ältere Einträge und gruppiert je Session, neueste zuerst', async () => {
    const old = new Date(Date.now() - 15 * 24 * 3600_000);
    const recent = new Date(Date.now() - 13 * 24 * 3600_000);
    await world.session('s1', { startedAt: new Date('2026-10-20T08:00:00Z') });
    await world.session('s2', { startedAt: new Date('2026-11-05T08:00:00Z') });
    await world.concept('p1');
    await world.concept('p2');
    await world.concept('p3', { session: 's2' });
    await world.concept('p4');
    await world.item('i1', { kind: 'concept_new', concept: 'p1', createdAt: old });
    await world.item('i2', { kind: 'concept_new', concept: 'p2', createdAt: recent });
    await world.item('i3', { kind: 'concept_new', concept: 'p3', session: 's2' });
    await world.item('i4', { kind: 'concept_new', concept: 'p4', status: 'abgelehnt', createdAt: old });

    const res = await get('/inbox/overview');
    expect(res.statusCode).toBe(200);
    const overview: InboxOverview = InboxOverviewSchema.parse(res.json());
    expect(overview.open_count).toBe(3);
    expect(overview.older_count).toBe(1);
    expect(overview.sessions.map((group) => [group.session?.id, group.open_count])).toEqual([
      [refId('s2'), 1],
      [refId('s1'), 2],
    ]);
    expect(new Date(overview.sessions[1]!.oldest_at).getTime()).toBe(old.getTime());
  });

  it('leer', async () => {
    expect((await get('/inbox/overview')).json()).toEqual({ open_count: 0, older_count: 0, sessions: [] });
  });
});

// --- A1 ----------------------------------------------------------------------------------------------------

describe('A1: neues Konzept annehmen', () => {
  it('übernimmt edit normiert, merkt sich die alten Werte und leert den Vektor', async () => {
    await world.concept('p', { name: 'Dritte NF', aliases: ['3NF'], oneLiner: 'Alt.', embedded: true });
    await world.item('i1', { kind: 'concept_new', concept: 'p', proposal: { importance: 1 } });

    const result = ok(
      await accept('i1', {
        edit: {
          name: '  Dritte   Normalform ',
          aliases: ['3NF', '3nf', ' ', 'dritte normalform', 'Third NF'],
        },
      }),
    );
    expect(result.item).toMatchObject({ status: 'angenommen', concept_id: refId('p') });
    expect(result.item.decided_at).not.toBeNull();
    expect(result.concept).toMatchObject({
      id: refId('p'),
      name: 'Dritte Normalform',
      aliases: ['3NF', 'Third NF'],
      one_liner: 'Alt.',
      status: 'aktiv',
      importance_base: 0.8,
    });
    const row = await world.conceptRow('p');
    expect(row.embedded).toBe(false);
    expect(row.proposal_session_id).toBeNull();
    expect((await world.itemRow('i1')).decision).toMatchObject({
      action: 'angenommen_neu',
      concept_id: refId('p'),
      previous: { name: 'Dritte NF', aliases: ['3NF'] },
      cascade_item_ids: [],
    });

    const again = await accept('i1');
    expect(again.statusCode).toBe(409);
    expect(errorOf(again)).toMatchObject({ code: 'inbox_item_decided', details: { status: 'angenommen' } });
    expect(errorOf(await reject('i1'))?.code).toBe('inbox_item_decided');
  });

  it('ohne Änderung am Text bleibt der Vektor, previous ist null', async () => {
    await world.concept('p', { name: 'Tupel', embedded: true });
    await world.item('i1', { kind: 'concept_new', concept: 'p' });
    ok(await accept('i1', { edit: { name: 'Tupel', kind: 'modell' } }));
    const row = await world.conceptRow('p');
    expect(row.embedded).toBe(true);
    expect(row.kind).toBe('modell');
    expect((await world.itemRow('i1')).decision?.previous).toEqual({ kind: 'definition' });

    await world.concept('q', { name: 'Attribut', embedded: true });
    await world.item('i2', { kind: 'concept_new', concept: 'q' });
    ok(await accept('i2', null));
    expect((await world.itemRow('i2')).decision?.previous).toBeNull();
    expect((await world.conceptRow('q')).embedded).toBe(true);
  });

  it('ein leerer Name nach dem Normieren ist ungültig, nichts ändert sich', async () => {
    await world.concept('p', { name: 'Tupel' });
    await world.item('i1', { kind: 'concept_new', concept: 'p' });
    const before = await world.snapshot();
    const res = await accept('i1', { edit: { name: ' ​ ' } });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res)?.code).toBe('validation_failed');
    expect(await world.snapshot()).toEqual(before);
  });

  it('Namensgleichheit zählt nur gegen aktive, nicht gelöschte, andere Konzepte', async () => {
    await world.concept('p', { name: 'Schlüssel' });
    await world.concept('v', { name: 'schlüssel', session: 's2' });
    await world.concept('d', { name: 'Schlüssel', status: 'aktiv', deletedAt: new Date() });
    await world.item('i1', { kind: 'concept_new', concept: 'p' });
    ok(await accept('i1'));
  });

  it('alles_ab_0_9 bestätigt nur Beziehungen ab 0,9 mit zwei aktiven Endpunkten und ohne Kreis', async () => {
    await world.setAutoAccept('alles_ab_0_9');
    await world.concept('p', { name: 'Zweite Normalform' });
    await world.concept('q', { name: 'Dritte Normalform' });
    await world.concept('t', { name: 'Erste Normalform', status: 'aktiv' });
    await world.concept('u', { name: 'Relation', status: 'aktiv' });
    await world.relation('rhi', { from: 'p', to: 't', confidence: 0.95 });
    await world.relation('rlo', { from: 'p', to: 'u', confidence: 0.85 });
    await world.relation('rpend', { from: 'q', to: 'p', confidence: 0.99 });
    // u baut_auf p bestätigt wäre mit p baut_auf u (rcyc) ein Kreis
    await world.relation('rback', { from: 'u', to: 'p', kind: 'beispiel_fuer', confidence: 0.99 });
    await world.item('i1', { kind: 'concept_new', concept: 'p' });
    await world.item('ihi', { kind: 'relation', relation: 'rhi', priority: 1000 });
    await world.item('ilo', { kind: 'relation', relation: 'rlo', priority: 1001 });
    await world.item('ipend', { kind: 'relation', relation: 'rpend', priority: 1002 });
    await world.item('iback', { kind: 'relation', relation: 'rback', priority: 1003 });

    ok(await accept('i1'));
    expect((await world.itemRow('i1')).decision?.cascade_item_ids).toEqual([refId('ihi'), refId('iback')]);
    expect((await world.relationRow('rhi')).confirmed).toBe(true);
    expect((await world.itemRow('ihi')).decision).toMatchObject({
      action: 'beziehung_bestaetigt',
      triggered_by: refId('i1'),
    });
    expect((await world.itemRow('ilo')).status).toBe('offen');
    expect((await world.itemRow('ipend')).status).toBe('offen');
    expect((await world.relationRow('rpend')).confirmed).toBe(false);
  });

  it('Folge-Beziehung mit Kreis bleibt offen, die Annahme gelingt trotzdem', async () => {
    await world.setAutoAccept('nur_beziehungen');
    await world.concept('p', { name: 'A' });
    await world.concept('t', { name: 'B', status: 'aktiv' });
    await world.concept('u', { name: 'C', status: 'aktiv' });
    // t → u bestätigt, u → p und p → t vorgeschlagen: beide zusammen schlössen den Kreis p → t → u → p
    await world.relation('r0', { from: 't', to: 'u', confirmed: true });
    await world.relation('r1', { from: 'u', to: 'p' });
    await world.relation('r2', { from: 'p', to: 't' });
    await world.item('i1', { kind: 'concept_new', concept: 'p' });
    await world.item('ir1', { kind: 'relation', relation: 'r1', priority: 1000 });
    await world.item('ir2', { kind: 'relation', relation: 'r2', priority: 1001 });

    ok(await accept('i1'));
    expect((await world.itemRow('i1')).decision?.cascade_item_ids).toEqual([refId('ir1')]);
    expect((await world.itemRow('ir2')).status).toBe('offen');
    expect((await world.relationRow('r2')).confirmed).toBe(false);
    const direct = await accept('ir2');
    expect(errorOf(direct)).toMatchObject({
      code: 'relation_cycle',
      details: { path: ['p', 't', 'u', 'p'].map(refId) },
    });
  });

  it('concept_merge mit as_new wird wie A1 angenommen und lässt sich zurücknehmen', async () => {
    await world.concept('p', { name: 'Normalisierung (Statistik)' });
    await world.concept('t', { name: 'Normalisierung (Datenbanken)', status: 'aktiv' });
    await world.item('i1', { kind: 'concept_merge', concept: 'p', target: 't' });
    const result = ok(await accept('i1', { as_new: true, edit: { one_liner: 'Skalieren auf [0, 1].' } }));
    expect(result.concept).toMatchObject({
      id: refId('p'),
      status: 'aktiv',
      one_liner: 'Skalieren auf [0, 1].',
    });
    expect((await world.itemRow('i1')).decision?.action).toBe('angenommen_neu');
    ok(await reopen('i1'));
    expect(await world.conceptRow('p')).toMatchObject({
      status: 'vorschlag',
      one_liner: null,
      proposal_session_id: refId('s1'),
    });
  });

  it('400 inbox_action_invalid, 400 validation_failed, 404', async () => {
    await world.concept('p');
    await world.concept('t', { status: 'aktiv' });
    await world.relation('r1', { from: 'p', to: 't' });
    await world.item('i1', { kind: 'concept_new', concept: 'p' });
    await world.item('ir1', { kind: 'relation', relation: 'r1' });
    const before = await world.snapshot();

    for (const [ref, body] of [
      ['i1', { relation_kind: 'verwandt' }],
      ['i1', { as_new: true }],
      ['ir1', { edit: { name: 'X' } }],
      ['ir1', { merge_into: refId('t') }],
    ] as const) {
      const res = await accept(ref, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(errorOf(res)?.code).toBe('inbox_action_invalid');
    }
    for (const body of [{ unbekannt: 1 }, { relation_kind: 'teil_von' }, { merge_into: 'x' }]) {
      const res = await accept('i1', body);
      expect(res.statusCode).toBe(400);
      expect(errorOf(res)?.code).toBe('validation_failed');
    }
    for (const op of ['accept', 'reject', 'reopen']) {
      const res = await post(`/inbox/${uuidv7()}/${op}`);
      expect(res.statusCode).toBe(404);
      expect(errorOf(res)?.code).toBe('inbox_item_not_found');
    }
    expect((await post('/inbox/keine-uuid/accept')).statusCode).toBe(400);
    expect(await world.snapshot()).toEqual(before);
  });
});

// --- A2 ----------------------------------------------------------------------------------------------------

describe('A2: zusammenführen', () => {
  async function seed() {
    await world.module('m2', 'Statistik', 'STAT');
    await world.concept('p', { name: 'Funktionale Abhängigkeit', aliases: ['FD'], modules: ['m1', 'm2'] });
    await world.concept('t', {
      name: 'FA (Datenbanken)',
      aliases: Array.from({ length: 19 }, (_, i) => `Alias ${i + 1}`),
      status: 'aktiv',
      modules: ['m1'],
      embedded: true,
    });
    await world.concept('r', { name: 'Relation', status: 'aktiv' });
    await world.concept('x', { name: 'Schlüssel', status: 'aktiv' });
    await world.slideEvidence('e1', { concept: 'p', session: 's1', slide: 'f1' });
    await world.slideEvidence('e2', { concept: 'p', session: 's1', slide: 'f2' });
    await world.slideEvidence('ex', { concept: 't', session: 's1', slide: 'f2', auto: true });
    // p < r < t: nach dem Umhängen muss die symmetrische Beziehung neu sortiert werden
    await world.relation('ra', { from: 'p', to: 'r', kind: 'verwandt' });
    await world.relation('rb', { from: 'p', to: 'x', kind: 'baut_auf' });
    await world.relation('rt', { from: 'p', to: 't', kind: 'baut_auf' });
    await world.item('i1', {
      kind: 'concept_merge',
      concept: 'p',
      target: 't',
      proposal: { exam_hint: true },
    });
    await world.item('ia', { kind: 'relation', relation: 'ra', priority: 1000 });
    await world.item('ib', { kind: 'relation', relation: 'rb', priority: 1001 });
    await world.item('it', { kind: 'relation', relation: 'rt', priority: 1002 });
  }

  it('hängt Belege, Aliase, Module und Beziehungen an das Ziel', async () => {
    await seed();
    const result = ok(await accept('i1'));
    expect(result.concept).toMatchObject({ id: refId('t'), status: 'aktiv', exam_relevant: true });
    expect(result.concept!.aliases).toHaveLength(20);
    expect(result.concept!.aliases.at(-1)).toBe('Funktionale Abhängigkeit');

    expect(await world.conceptRow('p')).toMatchObject({
      status: 'zusammengefuehrt',
      merged_into: refId('t'),
      proposal_session_id: refId('s1'),
    });
    expect((await world.conceptRow('t')).embedded).toBe(false);
    expect((await world.evidenceRow('e1'))?.conceptId).toBe(refId('t'));
    // Dublette an T: der Beleg von P ist hart gelöscht, der von T bleibt
    expect(await world.evidenceRow('e2')).toBeUndefined();
    expect((await world.evidenceRow('ex'))?.conceptId).toBe(refId('t'));

    expect(await world.relationRow('ra')).toMatchObject({
      fromId: refId('r'),
      toId: refId('t'),
      kind: 'verwandt',
    });
    expect((await world.itemRow('ia')).payload).toMatchObject({
      from_concept_id: refId('t'),
      to_concept_id: refId('r'),
    });
    expect((await world.itemRow('ia')).status).toBe('offen');
    expect(await world.relationRow('rb')).toMatchObject({ fromId: refId('t'), toId: refId('x') });
    // Selbstbezug: Eintrag abgelehnt, Zeile bleibt an P
    expect(await world.relationRow('rt')).toMatchObject({
      fromId: refId('p'),
      toId: refId('t'),
      confirmed: false,
    });
    expect(await world.itemRow('it')).toMatchObject({
      status: 'abgelehnt',
      decision: { action: 'abgelehnt', triggered_by: refId('i1'), duplicate_of: null },
    });

    const decision = (await world.itemRow('i1')).decision!;
    expect(decision).toMatchObject({
      action: 'zusammengefuehrt',
      concept_id: refId('p'),
      merged_into: refId('t'),
      moved_evidence_ids: [refId('e1')],
      added_aliases: ['Funktionale Abhängigkeit'],
      added_module_ids: [refId('m2')],
    });
    expect([...decision.cascade_item_ids].sort()).toEqual(['ia', 'ib', 'it'].map(refId).sort());

    // Die umgehängte Beziehung lässt sich jetzt bestätigen (beide Endpunkte aktiv)
    ok(await accept('ib'));
    expect((await world.relationRow('rb')).confirmed).toBe(true);
  });

  it('Rückgängig stellt alles wieder her (bis auf den hart gelöschten Doppel-Beleg)', async () => {
    await seed();
    const before = (await world.snapshot()) as { evidence: { id: string }[]; concepts: object[] };
    ok(await accept('i1'));
    const result = ok(await reopen('i1'));
    expect(result.item.status).toBe('offen');
    expect(result.concept).toMatchObject({ id: refId('p'), status: 'vorschlag', merged_into: null });

    const after = (await world.snapshot()) as typeof before;
    expect(after).toEqual({
      ...before,
      evidence: before.evidence.filter((row) => row.id !== refId('e2')),
      // exam_relevant bleibt (der alte Wert ist nicht bekannt), der Vektor von T ist geleert
      concepts: before.concepts.map((row) =>
        (row as { id: string }).id === refId('t')
          ? { ...row, examRelevant: true, embedded: false, embeddingModel: null }
          : row,
      ),
    });

    const twice = await reopen('i1');
    expect(twice.statusCode).toBe(409);
    expect(errorOf(twice)?.code).toBe('inbox_item_not_decided');
    expect(await world.snapshot()).toEqual(after);
  });

  it('Rückgängig scheitert, wenn eine umgehängte Beziehung inzwischen bestätigt ist', async () => {
    await seed();
    ok(await accept('i1'));
    ok(await accept('ib'));
    const before = await world.snapshot();
    const res = await reopen('i1');
    expect(res.statusCode).toBe(409);
    expect(errorOf(res)?.code).toBe('inbox_reopen_conflict');
    expect(await world.snapshot()).toEqual(before);

    // Erst die Beziehung zurück, dann geht auch die Zusammenführung zurück
    ok(await reopen('ib'));
    ok(await reopen('i1'));
    expect(await world.relationRow('rb')).toMatchObject({
      fromId: refId('p'),
      toId: refId('x'),
      confirmed: false,
      proposalSessionId: refId('s1'),
    });
  });

  it('concept_new mit merge_into führt zusammen, ein anderes Ziel schlägt das des Eintrags', async () => {
    await world.concept('p', { name: 'FD' });
    await world.concept('q', { name: 'Schlüsselkandidat' });
    await world.concept('t', { name: 'Funktionale Abhängigkeit', status: 'aktiv' });
    await world.concept('u', { name: 'Schlüssel', status: 'aktiv' });
    await world.item('i1', { kind: 'concept_new', concept: 'p' });
    await world.item('i2', { kind: 'concept_merge', concept: 'q', target: 't' });
    ok(await accept('i1', { merge_into: refId('t') }));
    expect((await world.conceptRow('t')).aliases).toEqual(['FD']);
    ok(await accept('i2', { merge_into: refId('u') }));
    expect((await world.conceptRow('q')).merged_into).toBe(refId('u'));
    expect((await world.itemRow('i2')).decision?.merged_into).toBe(refId('u'));
  });

  it('409 merge_target_invalid: der Vorschlag selbst, unbekannt, gelöscht, Hülle', async () => {
    await world.concept('p', { name: 'P' });
    await world.concept('q', { name: 'Q' });
    await world.concept('t', { name: 'T', status: 'aktiv' });
    await world.concept('d', { name: 'D', status: 'aktiv', deletedAt: new Date() });
    await world.item('i1', { kind: 'concept_new', concept: 'p' });
    await world.item('i2', { kind: 'concept_new', concept: 'q' });
    ok(await accept('i2', { merge_into: refId('t') }));
    const before = await world.snapshot();
    for (const target of [refId('p'), uuidv7(), refId('d'), refId('q')]) {
      const res = await accept('i1', { merge_into: target });
      expect(res.statusCode, target).toBe(409);
      expect(errorOf(res)?.code).toBe('merge_target_invalid');
    }
    expect(await world.snapshot()).toEqual(before);
  });
});

// --- A3 ----------------------------------------------------------------------------------------------------

describe('A3: Beziehung bestätigen', () => {
  beforeEach(async () => {
    await world.concept('a', { name: 'Relation', status: 'aktiv' });
    await world.concept('b', { name: 'Tabelle', status: 'aktiv' });
    await world.concept('c', { name: 'Tupel', status: 'aktiv' });
  });

  it('bestätigt und nimmt zurück', async () => {
    await world.relation('r1', { from: 'b', to: 'a' });
    await world.item('i1', { kind: 'relation', relation: 'r1' });
    const result = ok(await accept('i1'));
    expect(result.concept).toBeNull();
    expect(result.item).toMatchObject({ status: 'angenommen', relation_id: refId('r1'), blocked: null });
    expect(await world.relationRow('r1')).toMatchObject({ confirmed: true, proposalSessionId: null });
    expect((await world.itemRow('i1')).decision).toMatchObject({
      action: 'beziehung_bestaetigt',
      relation_kind_before: null,
      duplicate_of: null,
    });
    ok(await reopen('i1'));
    expect(await world.relationRow('r1')).toMatchObject({
      confirmed: false,
      proposalSessionId: refId('s1'),
      kind: 'baut_auf',
      fromId: refId('b'),
      toId: refId('a'),
    });
  });

  it('relation_kind ändert die Art, symmetrische Arten werden sortiert, Rückgängig kennt die Richtung', async () => {
    await world.relation('r1', { from: 'b', to: 'a', kind: 'baut_auf' });
    await world.item('i1', { kind: 'relation', relation: 'r1' });
    ok(await accept('i1', { relation_kind: 'gegensatz' }));
    expect(await world.relationRow('r1')).toMatchObject({
      kind: 'gegensatz',
      fromId: refId('a'),
      toId: refId('b'),
      confirmed: true,
    });
    expect((await world.itemRow('i1')).decision?.relation_kind_before).toBe('baut_auf');
    ok(await reopen('i1'));
    expect(await world.relationRow('r1')).toMatchObject({
      kind: 'baut_auf',
      fromId: refId('b'),
      toId: refId('a'),
      confirmed: false,
    });
  });

  it('409 relation_cycle über mehrere Kanten, auch nach einem Artwechsel auf baut_auf', async () => {
    await world.relation('r0', { from: 'b', to: 'c', confirmed: true });
    await world.relation('r00', { from: 'c', to: 'a', confirmed: true });
    await world.relation('r1', { from: 'a', to: 'b', kind: 'angewendet_in' });
    await world.item('i1', { kind: 'relation', relation: 'r1' });
    const before = await world.snapshot();
    const res = await accept('i1', { relation_kind: 'baut_auf' });
    expect(res.statusCode).toBe(409);
    expect(errorOf(res)).toMatchObject({
      code: 'relation_cycle',
      details: { path: ['a', 'b', 'c', 'a'].map(refId) },
    });
    expect(await world.snapshot()).toEqual(before);
    // Mit der vorgeschlagenen Art gibt es keinen Kreis
    ok(await accept('i1'));
  });

  it('Kanten über gelöschte Konzepte, gelöschte und unbestätigte Kanten bilden keinen Kreis', async () => {
    await world.concept('d', { name: 'Gelöscht', status: 'aktiv', deletedAt: new Date() });
    await world.relation('r0', { from: 'b', to: 'd', confirmed: true });
    await world.relation('r00', { from: 'd', to: 'a', confirmed: true });
    await world.relation('rdel', { from: 'b', to: 'a', confirmed: true });
    await app.handle.sql`UPDATE concept_relation SET deleted_at = now() WHERE id = ${refId('rdel')}`;
    await world.relation('r1', { from: 'a', to: 'b' });
    await world.item('i1', { kind: 'relation', relation: 'r1' });
    ok(await accept('i1'));
  });

  it('Dublette nach Artwechsel mit abgelehntem Vorschlag: duplicate_of ohne Bestätigung', async () => {
    await world.relation('r0', { from: 'a', to: 'b', kind: 'verwandt' });
    await world.relation('r1', { from: 'b', to: 'a', kind: 'baut_auf' });
    await world.item('i0', { kind: 'relation', relation: 'r0', status: 'abgelehnt' });
    await world.item('i1', { kind: 'relation', relation: 'r1' });
    ok(await accept('i1', { relation_kind: 'verwandt' }));
    expect((await world.itemRow('i1')).decision).toMatchObject({
      duplicate_of: refId('r0'),
      relation_kind_before: 'baut_auf',
      cascade_item_ids: [],
    });
    expect((await world.relationRow('r0')).confirmed).toBe(false);
    expect((await world.relationRow('r1')).confirmed).toBe(false);
    expect((await world.itemRow('i0')).status).toBe('abgelehnt');

    ok(await reopen('i1'));
    expect((await world.itemRow('i1')).status).toBe('offen');
    expect(await world.relationRow('r1')).toMatchObject({ kind: 'baut_auf', confirmed: false });
  });

  it('Dublette bestätigt den offenen Vorschlag, Rückgängig nimmt beide zurück', async () => {
    await world.relation('r0', { from: 'a', to: 'b', kind: 'verwandt', session: 's2' });
    await world.relation('r1', { from: 'b', to: 'a', kind: 'baut_auf' });
    await world.item('i0', { kind: 'relation', relation: 'r0', session: 's2' });
    await world.item('i1', { kind: 'relation', relation: 'r1' });
    const before = await world.snapshot();
    ok(await accept('i1', { relation_kind: 'verwandt' }));
    expect((await world.relationRow('r0')).confirmed).toBe(true);

    const direct = await reopen('i0');
    expect(direct.statusCode).toBe(409);
    expect(errorOf(direct)).toMatchObject({
      code: 'inbox_reopen_conflict',
      details: { triggered_by: refId('i1') },
    });

    ok(await reopen('i1'));
    // Die vorhandene Beziehung hängt wieder an ihrer eigenen Session
    expect(await world.relationRow('r0')).toMatchObject({ confirmed: false, proposalSessionId: refId('s2') });
    expect(await world.snapshot()).toEqual(before);
  });

  it('Dublette auf baut_auf mit Kreis: 409 relation_cycle, nichts ändert sich', async () => {
    await world.relation('rc', { from: 'b', to: 'a', confirmed: true });
    await world.relation('r0', { from: 'a', to: 'b', kind: 'baut_auf' });
    await world.relation('r1', { from: 'a', to: 'b', kind: 'angewendet_in' });
    await world.item('i0', { kind: 'relation', relation: 'r0' });
    await world.item('i1', { kind: 'relation', relation: 'r1' });
    const before = await world.snapshot();
    const res = await accept('i1', { relation_kind: 'baut_auf' });
    expect(errorOf(res)?.code).toBe('relation_cycle');
    expect(await world.snapshot()).toEqual(before);
  });
});

// --- Ablehnen und Rückgängig -------------------------------------------------------------------------------

describe('Ablehnen und Rückgängig', () => {
  it('Ablehnen nimmt offene Beziehungen mit, Rückgängig öffnet sie wieder; zweimal Rückgängig ändert nichts', async () => {
    await world.concept('p', { name: 'BCNF' });
    await world.concept('t', { name: 'Dritte Normalform', status: 'aktiv' });
    await world.concept('u', { name: 'Relation', status: 'aktiv' });
    await world.relation('r1', { from: 'p', to: 't' });
    await world.relation('r2', { from: 'u', to: 'p' });
    await world.relation('r3', { from: 'u', to: 't' });
    await world.item('i1', { kind: 'concept_new', concept: 'p' });
    await world.item('ir1', { kind: 'relation', relation: 'r1', priority: 1000 });
    await world.item('ir2', { kind: 'relation', relation: 'r2', priority: 1001, status: 'abgelehnt' });
    await world.item('ir3', { kind: 'relation', relation: 'r3', priority: 1002 });
    const before = await world.snapshot();

    const result = ok(await reject('i1'));
    expect(result.item.status).toBe('abgelehnt');
    expect(result.concept).toMatchObject({ id: refId('p'), status: 'vorschlag' });
    expect((await world.itemRow('i1')).decision).toMatchObject({
      action: 'abgelehnt',
      cascade_item_ids: [refId('ir1')],
    });
    expect((await world.itemRow('ir1')).decision).toMatchObject({
      action: 'abgelehnt',
      triggered_by: refId('i1'),
    });
    expect((await world.itemRow('ir3')).status).toBe('offen');

    const direct = await reopen('ir1');
    expect(errorOf(direct)).toMatchObject({
      code: 'inbox_reopen_conflict',
      details: { triggered_by: refId('i1') },
    });

    ok(await reopen('i1'));
    // Der schon vorher abgelehnte Eintrag ir2 bleibt abgelehnt
    expect(await world.snapshot()).toEqual(before);

    const twice = await reopen('i1');
    expect(twice.statusCode).toBe(409);
    expect(errorOf(twice)?.code).toBe('inbox_item_not_decided');
    expect(await world.snapshot()).toEqual(before);
  });

  it('A1 hin und zurück, zweimal: derselbe Zustand wie am Anfang', async () => {
    await world.setAutoAccept('nur_beziehungen');
    await world.concept('p', { name: 'Zweite NF', aliases: ['2NF'] });
    await world.concept('t', { name: 'Erste Normalform', status: 'aktiv' });
    await world.relation('r1', { from: 'p', to: 't' });
    await world.slideEvidence('e1', { concept: 'p', session: 's1', slide: 'f1' });
    await world.item('i1', { kind: 'concept_new', concept: 'p' });
    await world.item('ir1', { kind: 'relation', relation: 'r1', priority: 1000 });
    const before = await world.snapshot();

    for (let round = 0; round < 2; round += 1) {
      ok(
        await accept('i1', {
          edit: { name: 'Zweite Normalform', aliases: ['2NF', 'Second NF'], kind: null },
        }),
      );
      expect(await world.conceptRow('p')).toMatchObject({
        status: 'aktiv',
        name: 'Zweite Normalform',
        kind: null,
      });
      expect((await world.relationRow('r1')).confirmed).toBe(true);
      const result = ok(await reopen('i1'));
      expect(result.concept).toMatchObject({ status: 'vorschlag', name: 'Zweite NF', aliases: ['2NF'] });
      expect(await world.snapshot()).toEqual(before);
    }
  });

  it('Idempotency-Key: die Wiederholung von reopen liefert dieselbe Antwort und ändert nichts', async () => {
    await world.concept('p', { name: 'Tupel' });
    await world.item('i1', { kind: 'concept_new', concept: 'p' });
    ok(await accept('i1'));
    const key = { 'idempotency-key': uuidv7() };
    const first = await post(`/inbox/${refId('i1')}/reopen`, undefined, key);
    expect(first.statusCode).toBe(200);
    // Dazwischen wieder angenommen: die Wiederholung darf das nicht noch einmal zurücknehmen
    ok(await accept('i1'));
    const replay = await post(`/inbox/${refId('i1')}/reopen`, undefined, key);
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(replay.json()).toEqual(first.json());
    expect((await world.conceptRow('p')).status).toBe('aktiv');
  });

  describe('A1 zurücknehmen geht nicht mehr, wenn das Konzept inzwischen benutzt wird', () => {
    beforeEach(async () => {
      await world.concept('p', { name: 'Schlüssel' });
      await world.concept('t', { name: 'Relation', status: 'aktiv' });
      await world.item('i1', { kind: 'concept_new', concept: 'p' });
      ok(await accept('i1'));
    });

    async function expectConflict() {
      const before = await world.snapshot();
      const res = await reopen('i1');
      expect(res.statusCode, res.body).toBe(409);
      expect(errorOf(res)?.code).toBe('inbox_reopen_conflict');
      expect(await world.snapshot()).toEqual(before);
    }

    it('Beleg aus einer anderen Session', async () => {
      await world.slideEvidence('e9', { concept: 'p', session: 's2', slide: 'f1', auto: true });
      await expectConflict();
    });

    it('ein Beleg aus derselben Session stört nicht, ein gelöschter aus einer anderen auch nicht', async () => {
      await world.slideEvidence('e8', { concept: 'p', session: 's1', slide: 'f1', auto: true });
      await world.slideEvidence('e9', { concept: 'p', session: 's2', slide: 'f1', deletedAt: new Date() });
      ok(await reopen('i1'));
    });

    it('bestätigte Beziehung, die nicht mit dieser Annahme kam', async () => {
      await world.relation('r1', { from: 'p', to: 't' });
      await world.item('ir1', { kind: 'relation', relation: 'r1' });
      ok(await accept('ir1'));
      await expectConflict();
      ok(await reopen('ir1'));
      ok(await reopen('i1'));
    });

    it('ein anderes Konzept wurde hineingeführt', async () => {
      await world.concept('q', { name: 'Key' });
      await world.item('i2', { kind: 'concept_new', concept: 'q' });
      ok(await accept('i2', { merge_into: refId('p') }));
      await expectConflict();
    });

    it('Eintrag einer anderen Session führt es als Ziel oder Endpunkt', async () => {
      await world.concept('q', { name: 'Key', session: 's2' });
      await world.item('i2', { kind: 'concept_merge', concept: 'q', target: 'p', session: 's2' });
      await expectConflict();
      await app.handle.sql`DELETE FROM concept WHERE id = ${refId('q')}`;
      await world.relation('r2', { from: 'p', to: 't', session: 's2' });
      await world.item('ir2', { kind: 'relation', relation: 'r2', session: 's2' });
      await expectConflict();
    });
  });

  it('automatisch angenommene Einträge lassen sich zurücknehmen, Einträge ohne Session nicht (404)', async () => {
    await world.concept('p', { name: 'Tupel', status: 'aktiv' });
    await world.item('i1', {
      kind: 'concept_new',
      concept: 'p',
      status: 'automatisch',
      decision: { action: 'angenommen_neu', concept_id: refId('p') },
    });
    ok(await reopen('i1'));
    expect(await world.conceptRow('p')).toMatchObject({
      status: 'vorschlag',
      proposal_session_id: refId('s1'),
    });

    await world.concept('q', { name: 'Attribut', status: 'aktiv' });
    await world.item('i2', {
      kind: 'concept_new',
      concept: 'q',
      session: null,
      status: 'angenommen',
      decision: { action: 'angenommen_neu', concept_id: refId('q') },
    });
    const res = await reopen('i2');
    expect(res.statusCode).toBe(404);
    expect(errorOf(res)?.code).toBe('inbox_item_not_found');
  });
});

// --- Massenaktionen ----------------------------------------------------------------------------------------

describe('POST /inbox/bulk', () => {
  const bulk = async (payload: unknown): Promise<InboxBulkResult> => {
    const res = await post('/inbox/bulk', payload);
    expect(res.statusCode, res.body).toBe(200);
    return InboxBulkResultSchema.parse(res.json());
  };

  async function seed() {
    await world.setAutoAccept('nur_beziehungen');
    await world.concept('p1', { name: 'Zweite Normalform' });
    await world.concept('p2', { name: 'Dritte Normalform' });
    await world.concept('p3', { name: 'erste normalform' });
    await world.concept('p4', { name: 'FD' });
    await world.concept('t', { name: 'Erste Normalform', status: 'aktiv' });
    await world.concept('u', { name: 'Funktionale Abhängigkeit', status: 'aktiv' });
    await world.relation('r1', { from: 'p1', to: 't' });
    await world.relation('r2', { from: 'p2', to: 'p1' });
    await world.relation('r3', { from: 'p3', to: 't', kind: 'verwandt' });
    await world.item('i1', { kind: 'concept_new', concept: 'p1', priority: 110 });
    await world.item('i2', { kind: 'concept_new', concept: 'p2', priority: 100 });
    await world.item('i3', { kind: 'concept_new', concept: 'p3', priority: 105 });
    await world.item('i4', { kind: 'concept_merge', concept: 'p4', target: 'u', priority: 120 });
    await world.item('ir1', { kind: 'relation', relation: 'r1', priority: 1000 });
    await world.item('ir2', { kind: 'relation', relation: 'r2', priority: 1001 });
    await world.item('ir3', { kind: 'relation', relation: 'r3', priority: 1002 });
    // andere Session: bleibt unberührt
    await world.concept('z', { name: 'Tupel', session: 's2' });
    await world.item('iz', { kind: 'concept_new', concept: 'z', session: 's2' });
  }

  it('accept mit session_id: Konzepte nach priority, dann Beziehungen; Fehler landen in skipped', async () => {
    await seed();
    const result = await bulk({ action: 'accept', session_id: refId('s1') });
    // i2 (p2) zuerst: r2 braucht noch p1. Dann i3: concept_exists. i1 bestätigt r1 und r2 mit. i4 führt zusammen.
    expect(result.decided).toEqual(['i2', 'i1', 'ir1', 'ir2', 'i4'].map(refId));
    expect(result.skipped).toEqual([
      { id: refId('i3'), code: 'concept_exists' },
      { id: refId('ir3'), code: 'relation_endpoint_pending' },
    ]);
    expect((await world.conceptRow('p1')).status).toBe('aktiv');
    expect((await world.conceptRow('p3')).status).toBe('vorschlag');
    expect((await world.conceptRow('p4')).status).toBe('zusammengefuehrt');
    expect((await world.relationRow('r2')).confirmed).toBe(true);
    expect((await world.itemRow('iz')).status).toBe('offen');
    expect((await world.itemRow('i3')).status).toBe('offen');
  });

  it('„Rückgängig“ im Toast: reopen mit den decided-IDs in umgekehrter Reihenfolge', async () => {
    await seed();
    const before = await world.snapshot();
    const accepted = await bulk({ action: 'accept', session_id: refId('s1') });
    const undone = await bulk({ action: 'reopen', ids: [...accepted.decided].reverse() });
    expect(undone.skipped).toEqual([]);
    expect([...undone.decided].sort()).toEqual([...accepted.decided].sort());
    expect(await world.snapshot()).toEqual(before);
  });

  it('reopen eines Folge-Eintrags ohne seinen Auslöser: skipped mit inbox_reopen_conflict', async () => {
    await seed();
    await bulk({ action: 'accept', session_id: refId('s1') });
    const result = await bulk({ action: 'reopen', ids: [refId('ir1'), refId('i4')] });
    expect(result.decided).toEqual([refId('i4')]);
    expect(result.skipped).toEqual([{ id: refId('ir1'), code: 'inbox_reopen_conflict' }]);
  });

  it('reject und reopen mit session_id', async () => {
    await seed();
    const before = await world.snapshot();
    const rejected = await bulk({ action: 'reject', session_id: refId('s1') });
    expect(rejected.skipped).toEqual([]);
    expect(rejected.decided).toHaveLength(7);
    // Konzepte zuerst (nach priority), ihre Beziehungen gehen als Folge mit
    expect(rejected.decided.slice(0, 2)).toEqual([refId('i2'), refId('ir2')]);
    expect((await world.itemRow('ir1')).decision?.triggered_by).toBe(refId('i1'));
    expect((await world.itemRow('iz')).status).toBe('offen');

    const reopened = await bulk({ action: 'reopen', session_id: refId('s1') });
    expect(reopened.skipped).toEqual([]);
    expect(reopened.decided).toHaveLength(7);
    expect(await world.snapshot()).toEqual(before);
  });

  it('mit ids: gleiche Reihenfolge unabhängig von der Eingabe, unbekannte und schon entschiedene in skipped', async () => {
    await seed();
    const unknown = uuidv7();
    await reject('i3');
    const result = await bulk({
      action: 'accept',
      ids: [refId('ir1'), refId('i3'), unknown, refId('i1'), refId('i1'), refId('iz')],
    });
    expect(result.decided).toEqual(['iz', 'i1', 'ir1'].map(refId));
    expect(result.skipped).toEqual([
      { id: unknown, code: 'inbox_item_not_found' },
      { id: refId('i3'), code: 'inbox_item_decided' },
    ]);
  });

  it('400 validation_failed ohne oder mit beiden Zielen, 404 session_not_found', async () => {
    for (const payload of [
      { action: 'accept' },
      { action: 'accept', ids: [uuidv7()], session_id: uuidv7() },
      { action: 'accept', ids: [] },
      { action: 'löschen', ids: [uuidv7()] },
      {},
    ]) {
      const res = await post('/inbox/bulk', payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(errorOf(res)?.code).toBe('validation_failed');
    }
    const res = await post('/inbox/bulk', { action: 'accept', session_id: uuidv7() });
    expect(res.statusCode).toBe(404);
    expect(errorOf(res)?.code).toBe('session_not_found');
    expect(await bulk({ action: 'accept', session_id: await world.session('s9') })).toEqual({
      decided: [],
      skipped: [],
    });
  });
});
