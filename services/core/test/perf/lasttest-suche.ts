// Lasttest für ⌘K (`GET /api/v1/search`): Abnahme Phase 2 „⌘K < 300 ms“ (docs/spezifikation/10-UMSETZUNG.md §3).
// Von Hand gestartet, nicht Teil der CI (liegt bewusst nicht unter test/unit oder test/integration).
//
//   DATABASE_URL=postgres://sg:sg@127.0.0.1:5432/postgres node services/core/test/perf/lasttest-suche.ts
//   Optionen: --faktor <x>  Datenmenge (Standard 1 = ein Studienjahr, siehe daten.ts), --laeufe <n>  Messungen je Anfrage
//
// Das Skript legt eine EIGENE Datenbank `sg_perf_…` auf dem Server aus DATABASE_URL an, baut sie über die Migrationen
// auf, füllt sie mit erfundenen Daten und löscht sie am Ende wieder. Die Daten in der Datenbank aus DATABASE_URL
// bleiben unberührt (es werden dort keine Tabellen gelesen oder geändert).
// Gemessen wird die ganze Route in-process (`app.inject`: Prüfung der Anfrage, Suche, Antwort-Schema, JSON), mit einem
// Worker-Stub über HTTP auf 127.0.0.1 für das Embedding der Anfrage (feste Vektoren aus dem Bestand).
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres from 'postgres';
import { pino } from 'pino';
import { SINGLE_USER_ID } from '@sg/shared';
import { buildApp } from '../../src/app.ts';
import { loadConfig } from '../../src/config.ts';
import { createDb } from '../../src/db/client.ts';
import { runMigrations } from '../../src/db/migrate.ts';
import { FakeWorker } from '../unit/worker-fake.ts';
import { planCounts, QUERIES, type QueryGroup } from './daten.ts';
import { percentile, summarize, TARGET_MS } from './statistik.ts';

const API = '/api/v1';
const WARMUP = 3;

function parseArgs(argv: string[]): { factor: number; runs: number } {
  let factor = 1;
  let runs = 40;
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i + 1];
    if (argv[i] === '--faktor' && value !== undefined && Number(value) > 0 && Number(value) <= 4) {
      factor = Number(value);
      i += 1;
    } else if (argv[i] === '--laeufe' && value !== undefined && /^\d+$/.test(value) && Number(value) >= 5) {
      runs = Number(value);
      i += 1;
    } else {
      throw new Error(
        `Unbekannte oder ungültige Option "${argv[i]}". Erlaubt: --faktor <0..4>, --laeufe <n ≥ 5>.`,
      );
    }
  }
  return { factor, runs };
}

const ms = (value: number): string => `${value.toFixed(1)} ms`;

async function seed(sql: postgres.Sql, factor: number): Promise<void> {
  const counts = planCounts(factor);
  await sql`INSERT INTO semester (id, user_id, name)
    SELECT gen_random_uuid(), ${SINGLE_USER_ID}, 'Semester ' || i FROM generate_series(1, ${counts.semesters}) i`;
  await sql`INSERT INTO module (id, user_id, semester_id, name, short_name, color)
    SELECT gen_random_uuid(), ${SINGLE_USER_ID},
           (SELECT id FROM semester ORDER BY name OFFSET ((i - 1) % ${counts.semesters}) LIMIT 1),
           'Modul ' || i, 'M' || i, 'mod-01'
    FROM generate_series(1, ${counts.modules}) i`;
  const moduleIds = (await sql<{ id: string }[]>`SELECT id FROM module ORDER BY name`).map((r) => r.id);
  await sql`INSERT INTO slide_deck (id, user_id, module_id, title, file_path, sha256, ingest_state)
    SELECT gen_random_uuid(), ${SINGLE_USER_ID}, (${moduleIds}::uuid[])[1 + i % ${counts.modules}], 'Foliensatz ' || i, 'x.pdf',
           md5(i::text) || md5(i::text), 'verarbeitet'
    FROM generate_series(1, ${counts.decks}) i`;
  await sql`INSERT INTO session (id, user_id, module_id, number, state, started_at)
    SELECT gen_random_uuid(), ${SINGLE_USER_ID}, (${moduleIds}::uuid[])[1 + i % ${counts.modules}], i, 'verarbeitet',
           now() - make_interval(days => i)
    FROM generate_series(1, ${counts.sessions}) i`;

  // Wortschatz aus Silben (1 728 erfundene Wörter), schief verteilt, dazu die Fachwörter aus den Anfragen
  await sql`CREATE TEMP TABLE perf_vocab AS
    SELECT array_agg(a || b || c ORDER BY a, b, c) AS w
    FROM unnest(ARRAY['ka','me','lo','ri','sun','tal','ber','gen','ung','ar','ve','pro']) a,
         unnest(ARRAY['ka','me','lo','ri','sun','tal','ber','gen','ung','ar','ve','pro']) b,
         unnest(ARRAY['ka','me','lo','ri','sun','tal','ber','gen','ung','ar','ve','pro']) c`;
  const terms = [
    'Normalform',
    'Transaktion',
    'Isolation',
    'Kardinalität',
    'Wertschöpfung',
    'Bilanzierung',
    'Heuristik',
    'Algorithmus',
  ];
  await sql`CREATE TEMP TABLE perf_terms AS SELECT ${terms}::text[] AS t`;
  const text = (words: number, salt: string): string => `(SELECT string_agg(
       CASE WHEN random() < 0.04 THEN (SELECT t FROM perf_terms)[1 + floor(8 * random())::int]
            ELSE (SELECT w FROM perf_vocab)[1 + floor(1728 * power(random(), 2))::int] END, ' ')
     FROM generate_series(1, ${words} + 0 * ${salt}))`;
  const vector = (salt: string): string =>
    `(SELECT array_agg(random() - 0.5)::vector FROM generate_series(1, 1024 + 0 * ${salt}))`;

  // HNSW-Index (Migration 0009) für das Befüllen entfernen und danach mit derselben Definition neu bauen
  await sql`DROP INDEX IF EXISTS search_chunk_embedding_hnsw`;
  await sql.unsafe(`
    INSERT INTO search_chunk (id, user_id, source_kind, source_id, part, deck_id, slide_index, title, text, ts_config,
      tsv, embedding, embedding_model, content_hash, index_version)
    SELECT gen_random_uuid(), '${SINGLE_USER_ID}', 'slide', gen_random_uuid(), 0, d.id, s, 'Folie ' || s, t.text,
           'german', to_tsvector('german', t.text) || to_tsvector('simple', t.text), ${vector('s')}, 'fake-embed-1',
           encode(sha256(convert_to(t.text, 'UTF8')), 'hex'), 1
    FROM slide_deck d, generate_series(1, ${counts.slidesPerDeck}) s,
         LATERAL (SELECT ${text(40, 's + 0 * hashtext(d.id::text)')} AS text) t`);
  await sql.unsafe(`
    INSERT INTO search_chunk (id, user_id, source_kind, source_id, part, session_id, t_ms, t_end_ms, text, ts_config,
      tsv, embedding, embedding_model, content_hash, index_version)
    SELECT gen_random_uuid(), '${SINGLE_USER_ID}', 'transcript', se.id, p, se.id, p * 60000, p * 60000 + 59000,
           t.text, 'german', to_tsvector('german', t.text) || to_tsvector('simple', t.text), ${vector('p')},
           'fake-embed-1', encode(sha256(convert_to(t.text, 'UTF8')), 'hex'), 1
    FROM session se, generate_series(0, ${counts.windowsPerSession - 1}) p,
         LATERAL (SELECT ${text(150, 'p + 0 * hashtext(se.id::text)')} AS text) t`);
  await sql.unsafe(
    `CREATE INDEX "search_chunk_embedding_hnsw" ON "search_chunk" USING hnsw ("embedding" vector_cosine_ops)`,
  );
  await sql`VACUUM ANALYZE search_chunk`;
  await sql`ANALYZE slide_deck`;
  await sql`ANALYZE session`;
  await sql`ANALYZE module`;
}

interface Row {
  group: QueryGroup;
  q: string;
  samples: number[];
  hits: number;
  mode: string;
}

async function main(): Promise<number> {
  const { factor, runs } = parseArgs(process.argv.slice(2));
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) {
    throw new Error(
      'DATABASE_URL fehlt. Beispiel: DATABASE_URL=postgres://sg:sg@127.0.0.1:5432/postgres node services/core/test/perf/lasttest-suche.ts',
    );
  }
  const name = `sg_perf_${Date.now()}_${randomBytes(3).toString('hex')}`;
  const testUrl = new URL(baseUrl);
  testUrl.pathname = `/${name}`;
  const dataDir = mkdtempSync(join(tmpdir(), 'sg-perf-'));
  const admin = postgres(baseUrl, { max: 1, onnotice: () => {} });
  let handle: ReturnType<typeof createDb> | undefined;
  let worker: FakeWorker | undefined;
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  const previousPort = process.env.SG_WORKER_PORT;
  try {
    await admin.unsafe(`CREATE DATABASE ${name}`);
    console.log(`Eigene Test-Datenbank: ${name} (wird am Ende gelöscht)`);
    handle = createDb(testUrl.toString());
    await runMigrations(handle.db);

    const counts = planCounts(factor);
    console.log(
      `Fülle: ${counts.semesters} Semester, ${counts.modules} Module, ${counts.decks} Foliensätze (${counts.decks * counts.slidesPerDeck} Folien), ` +
        `${counts.sessions} Sessions (${counts.sessions * counts.windowsPerSession} Transkriptfenster à 60 s) …`,
    );
    const seedStart = performance.now();
    await seed(handle.sql, factor);
    console.log(`Daten fertig in ${((performance.now() - seedStart) / 1000).toFixed(0)} s.`);

    // Feste Anfragevektoren aus dem Bestand: die Bedeutungssuche findet echte Nachbarn
    const samples = await handle.sql<{ v: string }[]>`
      SELECT embedding::text AS v FROM search_chunk WHERE embedding IS NOT NULL ORDER BY random() LIMIT 25`;
    const vectors = samples.map((r) => JSON.parse(r.v) as number[]);
    worker = await new FakeWorker(dataDir).start();
    let next = 0;
    worker.vectorFor = () => vectors[next++ % vectors.length] as number[];
    process.env.SG_WORKER_PORT = String(worker.port);

    const config = {
      ...loadConfig({ SG_DATA_DIR: dataDir, DATABASE_URL: testUrl.toString(), SG_CORE_PORT: '4710' }),
    };
    app = await buildApp({
      config,
      db: handle.db,
      logger: pino({ level: 'silent' }),
      sessionTicker: false,
    });
    await app.ready();
    const get = async (q: string) => {
      const started = performance.now();
      const res = await app!.inject({
        method: 'GET',
        url: `${API}/search?${new URLSearchParams({ q, limit: '20' }).toString()}`,
        remoteAddress: '127.0.0.1',
        headers: { host: `localhost:${config.port}` },
      });
      const elapsed = performance.now() - started;
      if (res.statusCode !== 200)
        throw new Error(`GET /search "${q}" antwortet ${res.statusCode}: ${res.body.slice(0, 200)}`);
      const body = res.json() as { hits: unknown[]; mode: string };
      return { elapsed, hits: body.hits.length, mode: body.mode };
    };

    console.log(`Messe ${QUERIES.length} Anfragen, je ${runs} Läufe nach ${WARMUP} Aufwärmläufen …\n`);
    const rows: Row[] = [];
    for (const query of QUERIES) {
      for (let i = 0; i < WARMUP; i += 1) await get(query.q);
      const row: Row = { group: query.group, q: query.q, samples: [], hits: 0, mode: '' };
      for (let i = 0; i < runs; i += 1) {
        const r = await get(query.q);
        row.samples.push(r.elapsed);
        row.hits = r.hits;
        row.mode = r.mode;
      }
      rows.push(row);
    }

    const width = Math.max(...rows.map((r) => r.q.length), 10);
    console.log(
      `${'Anfrage'.padEnd(width)}  ${'Art'.padEnd(10)}  Treffer  Modus   ${'p50'.padStart(9)}  ${'p95'.padStart(9)}  ${'max'.padStart(9)}`,
    );
    for (const r of rows) {
      const s = summarize(r.samples);
      console.log(
        `${r.q.padEnd(width)}  ${r.group.padEnd(10)}  ${String(r.hits).padStart(7)}  ${r.mode.padEnd(6)}  ${ms(s.p50).padStart(9)}  ${ms(s.p95).padStart(9)}  ${ms(s.max).padStart(9)}`,
      );
    }
    console.log('');
    const groups = [...new Set(rows.map((r) => r.group))];
    for (const group of groups) {
      const s = summarize(rows.filter((r) => r.group === group).flatMap((r) => r.samples));
      console.log(`${group.padEnd(10)} p50 ${ms(s.p50)}, p95 ${ms(s.p95)}`);
    }
    const all = summarize(rows.flatMap((r) => r.samples));
    const worst = Math.max(...rows.map((r) => percentile(r.samples, 0.95)));
    const ok = all.p95 < TARGET_MS && worst < TARGET_MS;
    console.log(
      `\nAlle Anfragen: p50 ${ms(all.p50)}, p95 ${ms(all.p95)}; schlechtester p95 einer Anfrage ${ms(worst)}. ` +
        `Ziel < ${TARGET_MS} ms: ${ok ? 'erreicht' : 'verfehlt'}.`,
    );
    console.log(
      'Hinweis: Wert dieses Rechners, in-process gemessen (ohne Browser und Netz). Daten sind erfunden. Embedding über Worker-Stub.',
    );
    return ok ? 0 : 2;
  } finally {
    if (previousPort === undefined) delete process.env.SG_WORKER_PORT;
    else process.env.SG_WORKER_PORT = previousPort;
    await app?.close().catch(() => {});
    await worker?.stop().catch(() => {});
    await handle?.close().catch(() => {});
    try {
      await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    } finally {
      await admin.end({ timeout: 5 });
      rmSync(dataDir, { recursive: true, force: true });
    }
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  },
);
