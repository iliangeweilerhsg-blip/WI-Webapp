// T2-22b: `GET /concepts`, `GET /concepts/{id}`, `GET /sessions/{id}/concepts` (VERTRAEGE §20.6). Echte Datenbank,
// die Tests schreiben Konzepte, Belege und Einträge selbst.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ConceptDetailSchema,
  ConceptListSchema,
  SessionConceptsSchema,
  type ConceptDetail,
  type ConceptList,
  type SessionConcepts,
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

describe('GET /concepts', () => {
  async function seed() {
    await world.module('m2', 'Statistik', 'STAT');
    await world.concept('a', { name: 'varianz', status: 'aktiv', modules: ['m2'] });
    await world.concept('b', {
      name: 'Dritte Normalform',
      aliases: ['3NF', '100%_Regel'],
      status: 'aktiv',
      modules: ['m1'],
    });
    await world.concept('c', { name: 'Abhängigkeit', status: 'aktiv', modules: ['m1', 'm2'] });
    await world.concept('d', { name: 'Gelöscht', status: 'aktiv', deletedAt: new Date() });
    await world.concept('p', { name: 'Boyce-Codd-Normalform', modules: ['m1'] });
    await world.concept('q', { name: 'Abgelehnt' });
    await world.concept('h', { name: 'Hülle' });
    await world.item('ip', { kind: 'concept_new', concept: 'p' });
    await world.item('iq', { kind: 'concept_new', concept: 'q', status: 'abgelehnt' });
    await world.item('ih', { kind: 'concept_new', concept: 'h' });
    await app.request({
      method: 'POST',
      url: `${API}/inbox/${refId('ih')}/accept`,
      payload: { merge_into: refId('c') },
    });
    await world.slideEvidence('e1', { concept: 'b', session: 's1', slide: 'f1' });
    await world.slideEvidence('e2', { concept: 'b', session: 's1', slide: 'f2' });
    await world.transcriptEvidence('e3', { concept: 'b', session: 's2', startMs: 0, endMs: 5000 });
    await world.slideEvidence('e4', { concept: 'b', session: 's2', slide: 'f3', deletedAt: new Date() });
  }

  const list = async (query = ''): Promise<ConceptList> => {
    const res = await get(`/concepts${query}`);
    expect(res.statusCode, res.body).toBe(200);
    return ConceptListSchema.parse(res.json());
  };
  const names = (page: ConceptList) => page.items.map((item) => item.concept.name);

  it('Standard: aktive Konzepte nach Name ohne Groß-/Kleinschreibung, mit Modulen und Zählern', async () => {
    await seed();
    const page = await list();
    expect(names(page)).toEqual(['Abhängigkeit', 'Dritte Normalform', 'varianz']);
    expect(page.next_cursor).toBeNull();
    expect(page.items[0]!.modules).toEqual([
      { id: refId('m1'), name: 'Datenbanken', short_name: null },
      { id: refId('m2'), name: 'Statistik', short_name: 'STAT' },
    ]);
    expect(page.items[1]).toMatchObject({ evidence_count: 3, session_count: 2 });
    expect(page.items[2]).toMatchObject({ evidence_count: 0, session_count: 0 });
    expect(page.items[1]!.concept).toMatchObject({ status: 'aktiv', importance_base: 1, merged_into: null });
  });

  it('status: vorschlag nur mit offenem Eintrag, alle ohne Hüllen und Abgelehntes', async () => {
    await seed();
    expect(names(await list('?status=vorschlag'))).toEqual(['Boyce-Codd-Normalform']);
    expect(names(await list('?status=alle'))).toEqual([
      'Abhängigkeit',
      'Boyce-Codd-Normalform',
      'Dritte Normalform',
      'varianz',
    ]);
  });

  it('module_id und q (Name oder Alias, Teilwort, % und _ wörtlich)', async () => {
    await seed();
    expect(names(await list(`?module_id=${refId('m2')}`))).toEqual(['Abhängigkeit', 'varianz']);
    expect(names(await list(`?module_id=${uuidv7()}`))).toEqual([]);
    expect(names(await list('?q=NORMAL'))).toEqual(['Dritte Normalform']);
    expect(names(await list('?q=3nf'))).toEqual(['Dritte Normalform']);
    expect(names(await list(`?q=${encodeURIComponent('0%_r')}`))).toEqual(['Dritte Normalform']);
    expect(names(await list(`?q=${encodeURIComponent('%')}`))).toEqual(['Dritte Normalform']);
    expect(names(await list('?q=_'))).toEqual(['Dritte Normalform']);
    expect(names(await list(`?q=norm&module_id=${refId('m2')}`))).toEqual([]);
    expect(names(await list('?q=normal&status=alle'))).toEqual([
      'Boyce-Codd-Normalform',
      'Dritte Normalform',
    ]);
  });

  it('blättert über (lower(name), id)', async () => {
    await seed();
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: ConceptList = await list(`?status=alle&limit=1${cursor ? `&cursor=${cursor}` : ''}`);
      seen.push(...names(page));
      cursor = page.next_cursor;
    } while (cursor);
    expect(seen).toEqual(names(await list('?status=alle')));
  });

  it('400 bei ungültigen Parametern', async () => {
    for (const query of ['?status=x', '?module_id=x', '?q=', `?q=${'a'.repeat(101)}`, '?limit=500']) {
      const res = await get(`/concepts${query}`);
      expect(res.statusCode, query).toBe(400);
      expect(res.json().error.code).toBe('validation_failed');
    }
    const res = await get('/concepts?cursor=xx');
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_cursor');
  });
});

describe('GET /concepts/{id}', () => {
  const detail = async (ref: string): Promise<ConceptDetail> => {
    const res = await get(`/concepts/${refId(ref)}`);
    expect(res.statusCode, res.body).toBe(200);
    return ConceptDetailSchema.parse(res.json());
  };

  it('Belege (neueste Session zuerst, missing), bestätigte Beziehungen, Fächerbrücke', async () => {
    await world.module('m2', 'Statistik');
    await world.session('s1', { number: 3, startedAt: new Date('2026-10-01T08:00:00Z') });
    await world.session('s2', { number: 4, startedAt: new Date('2026-10-08T08:00:00Z') });
    await world.deck('d1', [
      { ref: 'f1', index: 1, title: 'Titel eins' },
      { ref: 'f2', index: 2 },
    ]);
    await world.deck('d2', [{ ref: 'g1', index: 5, title: 'Weg' }]);
    await app.handle.sql`UPDATE slide SET deleted_at = now() WHERE id = ${refId('f2')}`;
    await app.handle.sql`UPDATE slide_deck SET deleted_at = now() WHERE id = ${refId('d2')}`;

    await world.concept('c', { name: 'Normalform', status: 'aktiv', modules: ['m1'] });
    await world.concept('o1', { name: 'Relation', status: 'aktiv', modules: ['m1'] });
    await world.concept('o2', { name: 'Varianz', status: 'aktiv', modules: ['m2'] });
    await world.concept('o3', { name: 'Vorschlag' });
    await world.concept('o4', { name: 'Gelöscht', status: 'aktiv', deletedAt: new Date() });
    await world.relation('r1', { from: 'c', to: 'o1', confirmed: true, confidence: 0.9 });
    await world.relation('r2', {
      from: 'o2',
      to: 'c',
      kind: 'angewendet_in',
      confirmed: true,
      confidence: null,
    });
    await world.relation('r3', { from: 'c', to: 'o3' });
    await world.relation('r4', { from: 'c', to: 'o4', confirmed: true });

    await world.slideEvidence('e1', { concept: 'c', session: 's1', slide: 'f1' });
    await world.slideEvidence('e2', { concept: 'c', session: 's1', slide: 'f2' });
    await world.slideEvidence('e3', { concept: 'c', session: 's2', slide: 'g1', auto: true });
    await world.transcriptEvidence('e4', {
      concept: 'c',
      session: 's2',
      startMs: 60_000,
      endMs: 90_000,
      quote: 'Zitat',
    });
    await world.slideEvidence('e5', { concept: 'c', session: 's2', slide: 'weg' });
    await world.slideEvidence('e6', { concept: 'c', session: 's1', slide: 'f1', deletedAt: new Date() });

    const d = await detail('c');
    expect(d.concept).toMatchObject({ id: refId('c'), name: 'Normalform', status: 'aktiv' });
    expect(d.modules).toEqual([{ id: refId('m1'), name: 'Datenbanken', short_name: null }]);
    expect(d.inbox_item_id).toBeNull();
    // e5: Folie endgültig weg, nicht mehr darstellbar. e6: gelöscht
    expect(d.evidence.map((e) => e.id)).toEqual(['e3', 'e4', 'e1', 'e2'].map(refId));
    expect(d.evidence[0]).toMatchObject({
      ref: { kind: 'slide', slide_id: refId('g1'), deck_id: refId('d2'), slide_index: 5 },
      slide_title: 'Weg',
      missing: true,
      auto: true,
      session: { id: refId('s2'), number: 4 },
    });
    expect(d.evidence[1]).toMatchObject({
      ref: { kind: 'transcript', session_id: refId('s2'), t_start_ms: 60_000, t_end_ms: 90_000 },
      slide_title: null,
      missing: false,
      quote: 'Zitat',
    });
    expect(d.evidence[2]).toMatchObject({ slide_title: 'Titel eins', missing: false, auto: false });
    expect(d.evidence[3]).toMatchObject({ slide_title: null, missing: true });

    expect(d.relations).toEqual([
      {
        id: refId('r2'),
        kind: 'angewendet_in',
        direction: 'eingehend',
        other: { id: refId('o2'), name: 'Varianz', status: 'aktiv' },
        source: 'ki',
        confidence: null,
        cross_module: true,
      },
      {
        id: refId('r1'),
        kind: 'baut_auf',
        direction: 'ausgehend',
        other: { id: refId('o1'), name: 'Relation', status: 'aktiv' },
        source: 'ki',
        confidence: 0.9,
        cross_module: false,
      },
    ]);
  });

  it('auch für Vorschläge (mit offenem Eintrag) und Hüllen (merged_into)', async () => {
    await world.concept('p', { name: 'Vorschlag' });
    await world.concept('h', { name: 'Hülle' });
    await world.concept('t', { name: 'Ziel', status: 'aktiv' });
    await world.item('ip', { kind: 'concept_new', concept: 'p' });
    await world.item('ih', { kind: 'concept_merge', concept: 'h', target: 't' });
    await app.request({ method: 'POST', url: `${API}/inbox/${refId('ih')}/accept`, payload: {} });

    expect(await detail('p')).toMatchObject({ concept: { status: 'vorschlag' }, inbox_item_id: refId('ip') });
    expect(await detail('h')).toMatchObject({
      concept: { status: 'zusammengefuehrt', merged_into: refId('t') },
      inbox_item_id: null,
    });
  });

  it('404 concept_not_found: unbekannt oder gelöscht', async () => {
    await world.concept('d', { name: 'Gelöscht', status: 'aktiv', deletedAt: new Date() });
    for (const id of [refId('d'), uuidv7()]) {
      const res = await get(`/concepts/${id}`);
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('concept_not_found');
    }
    expect((await get('/concepts/x')).statusCode).toBe(400);
  });
});

describe('GET /sessions/{id}/concepts', () => {
  it('Konzepte mit Belegen der Session, nach Folie, Zeit und Name; ohne Abgelehntes und Hüllen', async () => {
    await world.deck('d1', [
      { ref: 'f1', index: 1 },
      { ref: 'f2', index: 2 },
      { ref: 'f3', index: 3 },
    ]);
    await world.concept('a', { name: 'Spät auf Folie 3' });
    await world.concept('b', { name: 'Aktiv auf Folie 1', status: 'aktiv' });
    await world.concept('c', { name: 'Nur gesagt, früh' });
    await world.concept('d', { name: 'Nur gesagt, spät' });
    await world.concept('e', { name: 'Auch auf Folie 1' });
    await world.concept('x', { name: 'Abgelehnt' });
    await world.concept('h', { name: 'Hülle' });
    await world.concept('y', { name: 'Andere Session', session: 's2' });
    await world.slideEvidence('e1', { concept: 'a', session: 's1', slide: 'f3' });
    await world.slideEvidence('e2', { concept: 'b', session: 's1', slide: 'f1', auto: true });
    await world.slideEvidence('e2b', { concept: 'b', session: 's2', slide: 'f2' });
    await world.transcriptEvidence('e3', { concept: 'c', session: 's1', startMs: 1000, endMs: 2000 });
    await world.transcriptEvidence('e4', { concept: 'd', session: 's1', startMs: 9000, endMs: 9500 });
    await world.slideEvidence('e5', { concept: 'e', session: 's1', slide: 'f1' });
    await world.transcriptEvidence('e5b', { concept: 'e', session: 's1', startMs: 0, endMs: 10 });
    await world.slideEvidence('e6', { concept: 'x', session: 's1', slide: 'f1' });
    await world.slideEvidence('e7', { concept: 'h', session: 's1', slide: 'f2' });
    await world.slideEvidence('e8', { concept: 'y', session: 's2', slide: 'f1' });
    await world.item('ia', { kind: 'concept_new', concept: 'a' });
    await world.item('ic', { kind: 'concept_new', concept: 'c' });
    await world.item('id', { kind: 'concept_new', concept: 'd' });
    await world.item('ie', { kind: 'concept_new', concept: 'e' });
    await world.item('ix', { kind: 'concept_new', concept: 'x', status: 'abgelehnt' });
    await world.item('ih', { kind: 'concept_merge', concept: 'h', target: 'b' });
    await app.request({ method: 'POST', url: `${API}/inbox/${refId('ih')}/accept`, payload: {} });

    const res = await get(`/sessions/${refId('s1')}/concepts`);
    expect(res.statusCode, res.body).toBe(200);
    const body: SessionConcepts = SessionConceptsSchema.parse(res.json());
    expect(body.session_id).toBe(refId('s1'));
    expect(body.items.map((item) => item.concept.name)).toEqual([
      // gleiche Folie: der frühere Zeitpunkt zuerst
      'Auch auf Folie 1',
      'Aktiv auf Folie 1',
      'Spät auf Folie 3',
      'Nur gesagt, früh',
      'Nur gesagt, spät',
    ]);
    // b: eigener Beleg und der aus der Hülle (umgehängt), nicht der aus s2. Eintrag = die Zusammenführung
    expect(body.items[1]).toMatchObject({ inbox_item_id: refId('ih'), inbox_status: 'angenommen' });
    expect(body.items[1]!.evidence.map((e) => e.id)).toEqual([refId('e2'), refId('e7')]);
    expect(body.items[0]).toMatchObject({ inbox_item_id: refId('ie'), inbox_status: 'offen' });
    expect(body.items[0]!.evidence).toHaveLength(2);
  });

  it('leer ohne Belege, 404 session_not_found für unbekannte und gelöschte Sessions', async () => {
    await world.session('s1');
    expect((await get(`/sessions/${refId('s1')}/concepts`)).json()).toEqual({
      session_id: refId('s1'),
      items: [],
    });
    await app.handle.sql`UPDATE session SET deleted_at = now() WHERE id = ${refId('s1')}`;
    for (const id of [refId('s1'), uuidv7()]) {
      const res = await get(`/sessions/${id}/concepts`);
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('session_not_found');
    }
  });
});
