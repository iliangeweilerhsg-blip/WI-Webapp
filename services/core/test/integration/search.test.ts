// T2-12: GET /search (VERTRAEGE §19.6) gegen echtes Postgres. Die Tests schreiben `search_chunk` selbst (wie der
// Worker, §19.3) und ersetzen den Loopback-Endpunkt des Workers durch einen Test-Server mit Token-Datei (§19.4).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SINGLE_USER_ID, SearchResponseSchema, type SearchHit, type SearchResponse } from '@sg/shared';
import type { DbHandle } from '../../src/db/client.ts';
import { courseModule, semester, session, slideDeck } from '../../src/db/schema/index.ts';
import { HNSW_EF_SEARCH, vectorQuery } from '../../src/services/search.ts';
import { uuidv7 } from '../../src/lib/uuid7.ts';
import { FakeWorker, fakeEmbed } from '../unit/worker-fake.ts';
import { startTestApp, type TestApp } from './helpers.ts';
import { insertSlideChunk, insertTranscriptChunk, vectorWithSimilarity } from './search-helpers.ts';

const API = '/api/v1';
const base = { userId: SINGLE_USER_ID };

let app: TestApp;
let handle: DbHandle;
let worker: FakeWorker;

/** Feste IDs (aufsteigend), damit Gleichstände nach `chunk_id` prüfbar sind */
const cid = (n: number) => `019a6000-0000-7000-8000-${String(n).padStart(12, '0')}`;

let dbs = '';
let bs = '';
let ds = '';
let deckDbs = '';
let deckBs = '';
let sessionDbs = '';

beforeAll(async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'sg-search-it-'));
  worker = await new FakeWorker(dataDir).start();
  const previous = process.env.SG_WORKER_PORT;
  process.env.SG_WORKER_PORT = String(worker.port);
  try {
    app = await startTestApp({ dataDir });
  } finally {
    if (previous === undefined) delete process.env.SG_WORKER_PORT;
    else process.env.SG_WORKER_PORT = previous;
  }
  handle = app.handle;
});
afterAll(async () => {
  await truncate();
  await app.close();
  await worker.stop();
});

async function truncate() {
  await handle.sql`TRUNCATE semester, module, session, slide_deck, search_chunk, job CASCADE`;
}

beforeEach(async () => {
  await truncate();
  worker.mode = 'ok';
  worker.vectorFor = null;
  worker.requests.length = 0;
  const semesterId = uuidv7();
  await handle.db.insert(semester).values({ id: semesterId, ...base, name: 'HS 2026' });
  dbs = uuidv7();
  bs = uuidv7();
  ds = uuidv7();
  await handle.db.insert(courseModule).values([
    { id: dbs, ...base, semesterId, name: 'Datenbanksysteme', shortName: 'DBS', color: 'mod-01' },
    { id: bs, ...base, semesterId, name: 'Betriebssysteme', shortName: 'BS', color: 'mod-02' },
    { id: ds, ...base, semesterId, name: 'Datenstrukturen', shortName: null, color: 'mod-03' },
  ]);
  deckDbs = uuidv7();
  deckBs = uuidv7();
  await handle.db.insert(slideDeck).values([
    {
      id: deckDbs,
      ...base,
      moduleId: dbs,
      title: 'VL 7 Normalisierung',
      filePath: 'x.pdf',
      sha256: 'a'.repeat(64),
      ingestState: 'verarbeitet',
    },
    {
      id: deckBs,
      ...base,
      moduleId: bs,
      title: 'VL 2 Prozesse',
      filePath: 'y.pdf',
      sha256: 'b'.repeat(64),
      ingestState: 'verarbeitet',
    },
  ]);
  sessionDbs = uuidv7();
  await handle.db.insert(session).values({
    id: sessionDbs,
    ...base,
    moduleId: dbs,
    number: 7,
    title: null,
    state: 'verarbeitet',
    startedAt: new Date('2026-11-03T07:15:00Z'),
  });
});

async function get(query: Record<string, string>): Promise<{ status: number; body: SearchResponse }> {
  const res = await app.request({ url: `${API}/search?${new URLSearchParams(query).toString()}` });
  const body = res.json();
  if (res.statusCode === 200) return { status: 200, body: SearchResponseSchema.parse(body) };
  return { status: res.statusCode, body };
}

async function search(q: string, extra: Record<string, string> = {}): Promise<SearchResponse> {
  const res = await get({ q, ...extra });
  expect(res.status).toBe(200);
  return res.body;
}

const ids = (r: SearchResponse) => r.hits.map((h) => h.chunk_id);
const hitText = (h: SearchHit) =>
  h.snippet
    .filter((p) => p.hit)
    .map((p) => p.text)
    .join('|');

describe('Wortsuche', () => {
  it('findet Folien und Gesagtes, mit Modul, Ausschnitt und Feldern je Art', async () => {
    const slideChunk = await insertSlideChunk(handle, {
      deckId: deckDbs,
      slideIndex: 14,
      title: '3NF',
      text: '3NF Die dritte Normalform verbietet transitive Abhängigkeiten',
    });
    const talk = await insertTranscriptChunk(handle, {
      sessionId: sessionDbs,
      part: 3,
      tMs: 2_512_000,
      tEndMs: 2_571_000,
      text: 'und das ist eben die dritte Normalform, das kommt auch in der Klausur',
    });
    await insertSlideChunk(handle, { deckId: deckBs, slideIndex: 1, text: 'Prozesse und Threads' });

    worker.mode = 'not_ready';
    const r = await search('normalform');
    expect(r).toMatchObject({ query: 'normalform', mode: 'text', degraded: 'embedder_not_ready' });
    expect(r.filters).toEqual({ module_ids: [], kinds: [], unresolved: [] });
    expect(new Set(ids(r))).toEqual(new Set([slideChunk, talk]));
    const slide = r.hits.find((h) => h.kind === 'slide')!;
    expect(slide).toMatchObject({
      kind: 'slide',
      module: { id: dbs, name: 'Datenbanksysteme', short_name: 'DBS' },
      deck_id: deckDbs,
      deck_title: 'VL 7 Normalisierung',
      slide_index: 14,
      slide_title: '3NF',
    });
    expect(slide.snippet).toEqual([
      { text: '3NF Die dritte ', hit: false },
      { text: 'Normalform', hit: true },
      { text: ' verbietet transitive Abhängigkeiten', hit: false },
    ]);
    const transcript = r.hits.find((h) => h.kind === 'transcript')!;
    expect(transcript).toMatchObject({
      kind: 'transcript',
      session_id: sessionDbs,
      session_number: 7,
      session_title: null,
      session_started_at: '2026-11-03T07:15:00Z',
      t_ms: 2_512_000,
      t_end_ms: 2_571_000,
    });
    expect(hitText(transcript)).toBe('Normalform');
    expect(r.took_ms).toBeGreaterThanOrEqual(0);
  });

  it('halb getippte Wörter treffen über den simple-Teil (:* am letzten Wort), Leerraum am Ende nicht', async () => {
    const chunk = await insertSlideChunk(handle, {
      deckId: deckDbs,
      slideIndex: 1,
      text: 'Organisatorisches zu den Vorlesungen',
    });
    worker.mode = 'not_ready';
    expect(ids(await search('vorlesu'))).toEqual([chunk]);
    expect(ids(await search('organisatorisches vorle'))).toEqual([chunk]);
    expect(ids(await search('vorlesu '))).toEqual([]);
    // Großschreibung egal
    expect(ids(await search('VORLESUNGEN'))).toEqual([chunk]);
  });

  it('alle Wörter müssen vorkommen (&), Stoppwörter stören nicht, Fachwort der anderen Sprache trifft', async () => {
    const a = await insertSlideChunk(handle, {
      deckId: deckDbs,
      slideIndex: 1,
      text: 'Der Join verbindet Tabellen',
    });
    await insertSlideChunk(handle, { deckId: deckDbs, slideIndex: 2, text: 'Tabellen ohne Verbindung' });
    worker.mode = 'not_ready';
    expect(ids(await search('der join tabellen'))).toEqual([a]);
    expect(ids(await search('joins '))).toEqual([a]); // englischer Stamm von „joins“ = „join“
  });

  it('nach Rang sortiert, limit begrenzt', async () => {
    const often = await insertSlideChunk(handle, {
      deckId: deckDbs,
      slideIndex: 1,
      text: 'Schlüssel Schlüssel Schlüssel Primärschlüssel',
    });
    const once = await insertSlideChunk(handle, { deckId: deckDbs, slideIndex: 2, text: 'Ein Schlüssel' });
    worker.mode = 'not_ready';
    expect(ids(await search('schlüssel '))).toEqual([often, once]);
    expect(ids(await search('schlüssel ', { limit: '1' }))).toEqual([often]);
  });

  it('Ausschnitt eines langen Textes: … vorn und hinten', async () => {
    const words = Array.from({ length: 80 }, (_, i) => `wort${i}`);
    words[40] = 'Normalform';
    await insertTranscriptChunk(handle, {
      sessionId: sessionDbs,
      part: 0,
      tMs: 0,
      tEndMs: 60_000,
      text: words.join(' '),
    });
    worker.mode = 'not_ready';
    const [hit] = (await search('normalform')).hits;
    expect(hit!.snippet[0]!.text.startsWith('… ')).toBe(true);
    expect(hit!.snippet[0]!.hit).toBe(false);
    expect(hit!.snippet.at(-1)!.text.endsWith(' …')).toBe(true);
    expect(hitText(hit!)).toBe('Normalform');
  });

  it('ohne Wörter: leere Treffer, mode text, kein Aufruf des Workers', async () => {
    await insertSlideChunk(handle, { deckId: deckDbs, slideIndex: 1, text: 'irgendwas' });
    const r = await search('!!! typ:folie');
    expect(r).toMatchObject({ query: '!!!', mode: 'text', degraded: null, hits: [] });
    expect(worker.requests).toHaveLength(0);
  });
});

describe('Bedeutungssuche und Mischen', () => {
  it('reine Vektortreffer (Ähnlichkeit ≥ 0,45, gleiches Modell), Ausschnitt = Textanfang ohne hit', async () => {
    const query = 'relationale algebra';
    const near = await insertSlideChunk(handle, {
      deckId: deckDbs,
      slideIndex: 3,
      text: 'Projektion und Selektion auf Relationen',
      embedding: fakeEmbed(query),
    });
    const sim50 = await insertSlideChunk(handle, {
      deckId: deckDbs,
      slideIndex: 4,
      text: 'Kreuzprodukt',
      embedding: vectorWithSimilarity(fakeEmbed(query), 0.5),
    });
    await insertSlideChunk(handle, {
      deckId: deckDbs,
      slideIndex: 5,
      text: 'Weit weg',
      embedding: vectorWithSimilarity(fakeEmbed(query), 0.4),
    });
    await insertSlideChunk(handle, {
      deckId: deckDbs,
      slideIndex: 6,
      text: 'Anderes Modell',
      embedding: fakeEmbed(query),
      model: 'BAAI/bge-m3',
    });
    await insertSlideChunk(handle, { deckId: deckDbs, slideIndex: 7, text: 'Ohne Vektor' });

    const r = await search(query);
    expect(r).toMatchObject({ mode: 'hybrid', degraded: null });
    expect(ids(r)).toEqual([near, sim50]);
    expect(r.hits[0]!.snippet).toEqual([{ text: 'Projektion und Selektion auf Relationen', hit: false }]);
    // Der Vektor der Anfrage kommt aus den Wörtern, mit Leerzeichen verbunden
    expect(worker.requests.at(-1)).toMatchObject({
      path: '/embed',
      body: { texts: ['relationale algebra'] },
    });
  });

  it('RRF: Σ 1/(60 + rang) über beide Listen, Gleichstand nach chunk_id aufsteigend', async () => {
    const unit = fakeEmbed('normalform');
    // a: Wortrang 1 und Vektorrang 1. b: nur Wortrang 2. c: nur Vektorrang 2 (ID kleiner als b)
    const a = await insertSlideChunk(handle, {
      id: cid(50),
      deckId: deckDbs,
      slideIndex: 1,
      text: 'Normalform Normalform Normalform',
      embedding: unit,
    });
    const b = await insertSlideChunk(handle, {
      id: cid(40),
      deckId: deckDbs,
      slideIndex: 2,
      text: 'Die Normalform',
    });
    const c = await insertSlideChunk(handle, {
      id: cid(30),
      deckId: deckDbs,
      slideIndex: 3,
      text: 'Etwas ganz anderes',
      embedding: vectorWithSimilarity(unit, 0.7),
    });
    const r = await search('normalform');
    expect(r.mode).toBe('hybrid');
    expect(ids(r)).toEqual([a, c, b]);
    expect(r.hits[0]!.score).toBeCloseTo(2 / 61, 12);
    expect(r.hits[1]!.score).toBeCloseTo(1 / 62, 12);
    expect(r.hits[2]!.score).toBe(r.hits[1]!.score);
  });

  it('nur Wörter mit 1 Zeichen: keine Bedeutungssuche, degraded null', async () => {
    await insertSlideChunk(handle, {
      deckId: deckDbs,
      slideIndex: 1,
      text: 'a b c',
      embedding: true,
      tsConfig: 'simple',
    });
    const r = await search('a b');
    expect(r).toMatchObject({ mode: 'text', degraded: null });
    expect(r.hits).toHaveLength(1);
    expect(worker.requests).toHaveLength(0);
  });
});

describe('degraded', () => {
  beforeEach(async () => {
    await insertSlideChunk(handle, { deckId: deckDbs, slideIndex: 1, text: 'Normalform', embedding: true });
  });

  it('503 embedder_not_ready → embedder_not_ready, Wortsuche läuft', async () => {
    worker.mode = 'not_ready';
    const r = await search('normalform');
    expect(r).toMatchObject({ mode: 'text', degraded: 'embedder_not_ready' });
    expect(r.hits).toHaveLength(1);
  });

  it.each(['unavailable', 'busy', 'server_error', 'unauthorized', 'bad_schema'] as const)(
    '%s → embedder_unavailable',
    async (mode) => {
      worker.mode = mode;
      const r = await search('normalform');
      expect(r).toMatchObject({ mode: 'text', degraded: 'embedder_unavailable' });
      expect(r.hits).toHaveLength(1);
    },
  );

  it('Zeitlimit 800 ms → embedder_unavailable', async () => {
    worker.mode = 'slow';
    worker.delayMs = 3000;
    const started = Date.now();
    const r = await search('normalform');
    expect(r.degraded).toBe('embedder_unavailable');
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('401 nach Token-Wechsel: Datei neu lesen, dann hybrid', async () => {
    expect((await search('normalform')).mode).toBe('hybrid');
    worker.rotateToken();
    const r = await search('normalform');
    expect(r).toMatchObject({ mode: 'hybrid', degraded: null });
    expect(worker.requests.slice(-2).map((x) => x.authorization)).toEqual([
      expect.not.stringContaining(worker.token),
      `Bearer ${worker.token}`,
    ]);
  });

  it('Worker aus → embedder_unavailable; danach wieder da → hybrid', async () => {
    const port = worker.port;
    await worker.stop();
    try {
      const r = await search('normalform');
      expect(r).toMatchObject({ mode: 'text', degraded: 'embedder_unavailable' });
      expect(r.hits).toHaveLength(1);
    } finally {
      await worker.start(port);
    }
    expect((await search('normalform')).mode).toBe('hybrid');
  });
});

describe('Filter', () => {
  let slideDbs = '';
  let slideBs = '';
  let talkDbs = '';
  beforeEach(async () => {
    slideDbs = await insertSlideChunk(handle, {
      deckId: deckDbs,
      slideIndex: 1,
      text: 'Normalform',
      embedding: true,
    });
    slideBs = await insertSlideChunk(handle, {
      deckId: deckBs,
      slideIndex: 1,
      text: 'Normalform',
      embedding: true,
    });
    talkDbs = await insertTranscriptChunk(handle, {
      sessionId: sessionDbs,
      part: 0,
      tMs: 0,
      tEndMs: 1000,
      text: 'Normalform',
      embedding: true,
    });
  });

  it('fach: über short_name (Groß-/Kleinschreibung egal), auch mit Bedeutungssuche (exakt)', async () => {
    const r = await search('fach:dbs normalform');
    expect(r.filters).toEqual({ module_ids: [dbs], kinds: [], unresolved: [] });
    expect(r.mode).toBe('hybrid');
    expect(new Set(ids(r))).toEqual(new Set([slideDbs, talkDbs]));
    expect(r.query).toBe('normalform');
  });

  it('fach: sonst über den Namensanfang, mehrere Module', async () => {
    const r = await search('FACH:daten normalform');
    expect(r.filters.module_ids).toEqual([dbs, ds].sort());
    expect(new Set(ids(r))).toEqual(new Set([slideDbs, talkDbs]));
  });

  it('typ:folie, typ:gesagtes, beide', async () => {
    expect(ids(await search('typ:folie fach:BS normalform'))).toEqual([slideBs]);
    expect(ids(await search('typ:gesagtes normalform'))).toEqual([talkDbs]);
    const both = await search('typ:gesagtes typ:Folie normalform');
    expect(both.filters.kinds).toEqual(['slide', 'transcript']);
    expect(both.hits).toHaveLength(3);
  });

  it('module_id allein und zusammen mit fach:', async () => {
    expect(new Set(ids(await search('normalform', { module_id: dbs })))).toEqual(
      new Set([slideDbs, talkDbs]),
    );
    const same = await search('fach:DBS normalform', { module_id: dbs });
    expect(same.filters).toEqual({ module_ids: [dbs], kinds: [], unresolved: [] });
    // Schnittmenge leer → der fach:-Filter ist nicht aufgelöst, keine Treffer
    const empty = await search('fach:BS normalform', { module_id: dbs });
    expect(empty.filters.unresolved).toEqual(['fach:BS']);
    expect(empty.hits).toEqual([]);
  });

  it('nicht aufgelöste Präfixe machen die Liste leer', async () => {
    for (const q of [
      'fach:XYZ normalform',
      'typ:video normalform',
      'semester:HS26 normalform',
      'fach: normalform',
    ]) {
      const r = await search(q);
      expect(r.hits).toEqual([]);
      expect(r.filters.unresolved).toEqual([q.split(' ')[0]]);
      expect(r.mode).toBe('text');
    }
    expect(worker.requests).toHaveLength(0);
  });

  it('unbekanntes oder gelöschtes module_id → module_id:<id> in unresolved', async () => {
    const unknown = uuidv7();
    expect((await search('normalform', { module_id: unknown })).filters.unresolved).toEqual([
      `module_id:${unknown}`,
    ]);
    await handle.sql`UPDATE module SET deleted_at = now() WHERE id = ${bs}`;
    const r = await search('normalform', { module_id: bs });
    expect(r.filters.unresolved).toEqual([`module_id:${bs}`]);
    expect(r.hits).toEqual([]);
    // Gelöschtes Modul zählt auch für fach: nicht
    expect((await search('fach:BS normalform')).filters.unresolved).toEqual(['fach:BS']);
  });
});

describe('Gelöschtes', () => {
  it.each([true, false])('wird in Wort- und Bedeutungssuche ausgefiltert (Filter: %s)', async (filtered) => {
    const alive = await insertSlideChunk(handle, {
      deckId: deckDbs,
      slideIndex: 1,
      text: 'Normalform',
      embedding: true,
    });
    await insertSlideChunk(handle, {
      deckId: deckDbs,
      slideIndex: 2,
      text: 'Normalform',
      embedding: true,
      deletedAt: new Date(),
    });
    // Foliensatz gelöscht
    const deadDeck = uuidv7();
    await handle.db.insert(slideDeck).values({
      id: deadDeck,
      ...base,
      moduleId: dbs,
      title: 'weg',
      filePath: 'z.pdf',
      sha256: 'c'.repeat(64),
      deletedAt: new Date(),
    });
    await insertSlideChunk(handle, { deckId: deadDeck, slideIndex: 1, text: 'Normalform', embedding: true });
    // Session gelöscht
    const deadSession = uuidv7();
    await handle.db
      .insert(session)
      .values({ id: deadSession, ...base, moduleId: dbs, deletedAt: new Date() });
    await insertTranscriptChunk(handle, {
      sessionId: deadSession,
      part: 0,
      tMs: 0,
      tEndMs: 1,
      text: 'Normalform',
      embedding: true,
    });
    // Modul gelöscht (Foliensatz selbst nicht)
    const deadModuleDeck = uuidv7();
    await handle.db.insert(slideDeck).values({
      id: deadModuleDeck,
      ...base,
      moduleId: bs,
      title: 'Modul weg',
      filePath: 'w.pdf',
      sha256: 'd'.repeat(64),
    });
    await insertSlideChunk(handle, {
      deckId: deadModuleDeck,
      slideIndex: 1,
      text: 'Normalform',
      embedding: true,
    });
    await handle.sql`UPDATE module SET deleted_at = now() WHERE id = ${bs}`;

    const r = await search(filtered ? 'typ:folie normalform' : 'normalform');
    expect(r.mode).toBe('hybrid');
    expect(ids(r)).toEqual([alive]);
    // Auch reine Vektortreffer: Text passt nicht, Vektor schon
    worker.vectorFor = () => fakeEmbed('normalform');
    expect(ids(await search(filtered ? 'typ:folie qqq' : 'qqq'))).toEqual([alive]);
  });
});

describe('Validierung', () => {
  it.each([
    [{}],
    [{ q: '' }],
    [{ q: '   ' }],
    [{ q: 'x'.repeat(201) }],
    [{ q: 'a', limit: '0' }],
    [{ q: 'a', limit: '51' }],
    [{ q: 'a', limit: 'zehn' }],
    [{ q: 'a', module_id: 'kein-uuid' }],
    [{ q: 'a', module_id: '019A6000-0000-7000-8000-000000000001' }],
  ])('400 validation_failed: %j', async (query) => {
    const res = await get(query as Record<string, string>);
    expect(res.status).toBe(400);
    expect((res.body as unknown as { error: { code: string } }).error.code).toBe('validation_failed');
  });

  it('200 Zeichen nach trim sind erlaubt (Leerraum außen zählt nicht)', async () => {
    expect((await get({ q: `  ${'x'.repeat(200)}  ` })).status).toBe(200);
  });
});

describe('Abfrageplan der Bedeutungssuche (ohne Zeitmessung, läuft auch in CI)', () => {
  /** Plan der Abfrage, die `search()` tatsächlich stellt. Seq-Scan aus, damit auch wenige Zeilen den Index zeigen */
  async function plan(filters: Parameters<typeof vectorQuery>[2]): Promise<string> {
    const rows = await handle.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL enable_seqscan = off`);
      await tx.execute(sql.raw(`SET LOCAL hnsw.ef_search = ${HNSW_EF_SEARCH}`));
      return tx.execute<Record<string, string>>(
        sql`EXPLAIN ${vectorQuery(fakeEmbed('normalform'), 'fake-embed-1', filters)}`,
      );
    });
    return rows.map((r) => Object.values(r)[0]).join('\n');
  }

  beforeEach(async () => {
    for (let i = 1; i <= 5; i += 1) {
      await insertSlideChunk(handle, { deckId: deckDbs, slideIndex: i, text: `Folie ${i}`, embedding: true });
    }
  });

  it('ohne Filter: HNSW-Index', async () => {
    expect(await plan({ moduleIds: null, kinds: [], unresolved: [] })).toContain(
      'search_chunk_embedding_hnsw',
    );
  });

  it('mit Filter (Modul oder Art): exakt, ohne HNSW', async () => {
    expect(await plan({ moduleIds: [dbs], kinds: [], unresolved: [] })).not.toContain(
      'search_chunk_embedding_hnsw',
    );
    expect(await plan({ moduleIds: null, kinds: ['slide'], unresolved: [] })).not.toContain(
      'search_chunk_embedding_hnsw',
    );
  });
});
