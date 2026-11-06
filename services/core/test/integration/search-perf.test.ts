// T2-12: Leistung von GET /search (F-SUC-01, VERTRAEGE §19.6 „Ziel“): erste Ergebnisse in < 300 ms bei 5 000 Folien
// und 200 h Transkript (≈ 12 000 Fenster). Synthetische Daten, gemessen ohne Embedding-Aufruf (der Worker-Stub
// antwortet ohne HTTP). Gemessen werden die Wortsuche (mode text) und, mit einem festen Anfragevektor, die
// Bedeutungssuche mit HNSW (ohne Filter) und exakt (mit Filter).
//
// `SG_SKIP_SEARCH_PERF=1` überspringt den Test (z. B. auf langsamen CI-Runnern: Aufbau der Daten samt HNSW-Index dauert
// dort deutlich länger als die übrigen Tests, und Zeitmessungen auf geteilten Runnern schwanken).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SINGLE_USER_ID } from '@sg/shared';
import { WorkerError } from '../../src/lib/worker-client.ts';
import { search } from '../../src/services/search.ts';
import { startTestApp, type TestApp } from './helpers.ts';

const SKIP = process.env.SG_SKIP_SEARCH_PERF === '1';
const DECKS = 100;
const SLIDES_PER_DECK = 50; // 5 000 Folien
const SESSIONS = 200;
const WINDOWS_PER_SESSION = 60; // 12 000 Fenster à 60 s = 200 h
const TARGET_MS = 300;
const RUNS = 7;

let app: TestApp;

const HNSW_INDEX = `CREATE INDEX IF NOT EXISTS "search_chunk_embedding_hnsw" ON "search_chunk" USING hnsw ("embedding" vector_cosine_ops)`;

/** Median der Laufzeit in ms (der erste Lauf wärmt Caches und Pläne) */
async function median(fn: () => Promise<unknown>): Promise<number> {
  await fn();
  const times: number[] = [];
  for (let i = 0; i < RUNS; i += 1) {
    const started = performance.now();
    await fn();
    times.push(performance.now() - started);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)]!;
}

describe.skipIf(SKIP)('Leistung GET /search (5 000 Folien, 12 000 Fenster)', () => {
  let moduleIds: string[] = [];

  beforeAll(async () => {
    app = await startTestApp();
    const sql = app.handle.sql;
    await sql`TRUNCATE semester, module, session, slide_deck, search_chunk, job CASCADE`;
    await sql`INSERT INTO semester (id, user_id, name) VALUES (gen_random_uuid(), ${SINGLE_USER_ID}, 'HS 2026')`;
    // 4 Module, Foliensätze und Sessions reihum verteilt
    await sql`INSERT INTO module (id, user_id, semester_id, name, short_name, color)
      SELECT gen_random_uuid(), ${SINGLE_USER_ID}, (SELECT id FROM semester LIMIT 1), 'Modul ' || i, 'M' || i, 'mod-01'
      FROM generate_series(1, 4) i`;
    moduleIds = (await sql<{ id: string }[]>`SELECT id FROM module ORDER BY name`).map((r) => r.id);
    await sql`INSERT INTO slide_deck (id, user_id, module_id, title, file_path, sha256, ingest_state)
      SELECT gen_random_uuid(), ${SINGLE_USER_ID}, (${moduleIds}::uuid[])[1 + i % 4], 'Foliensatz ' || i, 'x.pdf',
             md5(i::text) || md5(i::text), 'verarbeitet'
      FROM generate_series(1, ${DECKS}) i`;
    await sql`INSERT INTO session (id, user_id, module_id, number, state, started_at)
      SELECT gen_random_uuid(), ${SINGLE_USER_ID}, (${moduleIds}::uuid[])[1 + i % 4], i, 'verarbeitet', now()
      FROM generate_series(1, ${SESSIONS}) i`;
    // Wortschatz aus Silben (1 728 Wörter), schief verteilt (häufige und seltene Wörter), dazu Fachwörter
    await sql`CREATE TEMP TABLE IF NOT EXISTS perf_vocab AS
      SELECT array_agg(a || b || c ORDER BY a, b, c) AS w
      FROM unnest(ARRAY['ka','me','lo','ri','sun','tal','ber','gen','ung','ar','ve','pro']) a,
           unnest(ARRAY['ka','me','lo','ri','sun','tal','ber','gen','ung','ar','ve','pro']) b,
           unnest(ARRAY['ka','me','lo','ri','sun','tal','ber','gen','ung','ar','ve','pro']) c`;
    const text = (words: number, salt: string) => `(SELECT string_agg(
         CASE WHEN random() < 0.01 THEN 'Normalform' WHEN random() < 0.01 THEN 'Transaktion'
              ELSE (SELECT w FROM perf_vocab)[1 + floor(1728 * power(random(), 2))::int] END, ' ')
       FROM generate_series(1, ${words} + 0 * ${salt}))`;
    const vector = (salt: string) =>
      `(SELECT array_agg(random() - 0.5)::vector FROM generate_series(1, 1024 + 0 * ${salt}))`;
    // HNSW-Index für das Befüllen entfernen und danach mit derselben Definition neu bauen (Migration 0009):
    // 17 000 Einfügungen in einen bestehenden Index dauern ein Vielfaches und hinterlassen eine aufgeblähte Tabelle
    await sql`DROP INDEX IF EXISTS search_chunk_embedding_hnsw`;
    await sql.unsafe(`
      INSERT INTO search_chunk (id, user_id, source_kind, source_id, part, deck_id, slide_index, title, text, ts_config,
        tsv, embedding, embedding_model, content_hash, index_version)
      SELECT gen_random_uuid(), '${SINGLE_USER_ID}', 'slide', gen_random_uuid(), 0, d.id, s, 'Folie ' || s, t.text,
             'german', to_tsvector('german', t.text) || to_tsvector('simple', t.text), ${vector('s')}, 'fake-embed-1',
             encode(sha256(convert_to(t.text, 'UTF8')), 'hex'), 1
      FROM slide_deck d, generate_series(1, ${SLIDES_PER_DECK}) s, LATERAL (SELECT ${text(40, 's + 0 * hashtext(d.id::text)')} AS text) t`);
    await sql.unsafe(`
      INSERT INTO search_chunk (id, user_id, source_kind, source_id, part, session_id, t_ms, t_end_ms, text, ts_config,
        tsv, embedding, embedding_model, content_hash, index_version)
      SELECT gen_random_uuid(), '${SINGLE_USER_ID}', 'transcript', se.id, p, se.id, p * 60000, p * 60000 + 59000,
             t.text, 'german', to_tsvector('german', t.text) || to_tsvector('simple', t.text), ${vector('p')},
             'fake-embed-1', encode(sha256(convert_to(t.text, 'UTF8')), 'hex'), 1
      FROM session se, generate_series(0, ${WINDOWS_PER_SESSION - 1}) p,
           LATERAL (SELECT ${text(150, 'p + 0 * hashtext(se.id::text)')} AS text) t`);
    await sql.unsafe(HNSW_INDEX);
    await sql`VACUUM ANALYZE search_chunk`;
    await sql`ANALYZE slide_deck`;
    await sql`ANALYZE session`;
    await sql`ANALYZE module`;
  }, 600_000);

  afterAll(async () => {
    if (!app) return;
    await app.handle.sql`TRUNCATE semester, module, session, slide_deck, search_chunk, job CASCADE`;
    // Falls das Befüllen abbrach: Index für die übrigen Tests wiederherstellen
    await app.handle.sql.unsafe(HNSW_INDEX);
    await app.close();
  });

  const noEmbed = {
    embed: () => Promise.reject(new WorkerError('embedder_not_ready', 'Test: ohne Embedding-Aufruf')),
  };

  it('Daten wie verlangt', async () => {
    const [counts] = await app.handle.sql<{ slides: number; windows: number }[]>`
      SELECT count(*) FILTER (WHERE source_kind = 'slide')::int AS slides,
             count(*) FILTER (WHERE source_kind = 'transcript')::int AS windows FROM search_chunk`;
    expect(counts).toEqual({ slides: 5000, windows: 12000 });
  });

  it(`Wortsuche: Median < ${TARGET_MS} ms`, async () => {
    const queries = [
      'normalform', // ≈ 1 % der Wörter: Treffer in vielen Einträgen
      'transaktion normalform',
      'kakaka', // häufigstes Wort
      'kaka', // halb getippt, viele Präfix-Treffer
      'ver', // kurzes Präfix, sehr viele Treffer (ungünstigster Fall)
      'fach:M1 normalform',
      'typ:gesagtes normalform',
    ];
    const results: Record<string, number> = {};
    for (const q of queries) {
      results[q] = Math.round(
        await median(() => search({ db: app.handle.db, worker: noEmbed }, { q, limit: 50 })),
      );
    }
    console.info('Suchzeit Wortsuche (Median, ms):', results);
    for (const [q, ms] of Object.entries(results)) expect(ms, q).toBeLessThan(TARGET_MS);
  });

  it(`Bedeutungssuche (fester Vektor, ohne HTTP): HNSW ohne Filter und exakt mit Filter < ${TARGET_MS} ms`, async () => {
    const [row] = await app.handle.sql<{ v: string }[]>`
      SELECT embedding::text AS v FROM search_chunk WHERE source_kind = 'transcript' LIMIT 1`;
    const vector = JSON.parse(row!.v) as number[];
    const fixed = { embed: async () => ({ model: 'fake-embed-1', dim: 1024 as const, vectors: [vector] }) };
    const results: Record<string, number> = {};
    for (const q of ['normalform', 'fach:M1 normalform', 'typ:folie normalform']) {
      const response = await search({ db: app.handle.db, worker: fixed }, { q, limit: 50 });
      expect(response.mode).toBe('hybrid');
      results[q] = Math.round(
        await median(() => search({ db: app.handle.db, worker: fixed }, { q, limit: 50 })),
      );
    }
    console.info('Suchzeit hybrid (Median, ms):', results);
    for (const [q, ms] of Object.entries(results)) expect(ms, q).toBeLessThan(TARGET_MS);

    // Plan ohne Filter: HNSW-Index
    const plan = await app.handle.sql.begin(async (tx) => {
      await tx`SET LOCAL hnsw.ef_search = 100`;
      return tx.unsafe(
        `EXPLAIN SELECT c.id FROM search_chunk c LEFT JOIN slide_deck d ON d.id = c.deck_id
           LEFT JOIN session s ON s.id = c.session_id JOIN module m ON m.id = coalesce(d.module_id, s.module_id)
         WHERE c.deleted_at IS NULL AND d.deleted_at IS NULL AND s.deleted_at IS NULL AND m.deleted_at IS NULL
           AND c.embedding_model = 'fake-embed-1'
         ORDER BY c.embedding <=> '${row!.v}'::vector LIMIT 50`,
      );
    });
    expect(plan.map((p) => Object.values(p)[0]).join('\n')).toContain('search_chunk_embedding_hnsw');
  });
});
