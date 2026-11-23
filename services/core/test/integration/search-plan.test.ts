// #334, #400: GET /search setzt für Wort- und gefilterte Bedeutungssuche Planer-Einstellungen (parallele Worker, kein Seq
// Scan auf der Wortsuche) und ein Zeitlimit. Das darf die Ergebnisse nicht ändern: Reihenfolge der Wortsuche und der
// gefilterten Bedeutungssuche = Referenz mit Standard-Plan. Die Einstellungen dürfen nicht über die Transaktion hinaus
// wirken.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SINGLE_USER_ID, SearchResponseSchema } from '@sg/shared';
import { parseSearchWorkers } from '../../src/config.ts';
import { HttpError } from '../../src/errors.ts';
import { uuidv7 } from '../../src/lib/uuid7.ts';
import {
  CANDIDATES,
  MIN_VECTOR_SIM,
  fuseRrf,
  parseSearchQuery,
  search,
  textQuery,
  textSettings,
  tsQueryText,
  withSettings,
} from '../../src/services/search.ts';
import { FAKE_MODEL, FakeWorker, fakeEmbed } from '../unit/worker-fake.ts';
import { startTestApp, type TestApp } from './helpers.ts';

const API = '/api/v1';
const DECKS = 6;
const SLIDES = 40; // 240 Folien
const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta'];

let app: TestApp;
let worker: FakeWorker;
let moduleM1 = '';

/** Erfundener, deterministischer Text: häufige und seltene Wörter, wechselnde Länge */
function textFor(n: number): string {
  const parts: string[] = [];
  for (let i = 0; i < 6 + (n % 25); i += 1) parts.push(WORDS[(n * 7 + i * i * 3) % WORDS.length]!);
  if (n % 5 === 0) parts.push('selten');
  return parts.join(' ');
}

beforeAll(async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'sg-search-plan-'));
  worker = await new FakeWorker(dataDir).start();
  const previous = process.env.SG_WORKER_PORT;
  process.env.SG_WORKER_PORT = String(worker.port);
  try {
    app = await startTestApp({ dataDir });
  } finally {
    if (previous === undefined) delete process.env.SG_WORKER_PORT;
    else process.env.SG_WORKER_PORT = previous;
  }
  const sql = app.handle.sql;
  await sql`TRUNCATE semester, module, session, slide_deck, search_chunk, job CASCADE`;
  await sql`INSERT INTO semester (id, user_id, name) VALUES (${uuidv7()}, ${SINGLE_USER_ID}, 'HS 2026')`;
  await sql`INSERT INTO module (id, user_id, semester_id, name, short_name, color)
    SELECT gen_random_uuid(), ${SINGLE_USER_ID}, (SELECT id FROM semester LIMIT 1), 'Modul ' || i, 'M' || i, 'mod-01'
    FROM generate_series(1, 2) i`;
  await sql`INSERT INTO slide_deck (id, user_id, module_id, title, file_path, sha256, ingest_state)
    SELECT gen_random_uuid(), ${SINGLE_USER_ID}, (SELECT id FROM module ORDER BY name OFFSET (i % 2) LIMIT 1),
           'Foliensatz ' || i, 'x.pdf', md5(i::text) || md5(i::text), 'verarbeitet'
    FROM generate_series(1, ${DECKS}) i`;
  const decks = await sql<{ id: string }[]>`SELECT id FROM slide_deck ORDER BY title`;
  let n = 0;
  // Decks reihum einfügen (außen Folie, innen Deck): Sonst hängt die Korrelation von deck_id an den zufälligen
  // UUIDs, und der Planer nimmt manchmal einen vollen Index-Scan über search_chunk_deck_idx statt GIN (Review #401).
  for (let s = 1; s <= SLIDES; s += 1) {
    for (const deck of decks) {
      n += 1;
      const text = textFor(n);
      const vector = `[${fakeEmbed(text).join(',')}]`;
      await sql`INSERT INTO search_chunk (id, user_id, source_kind, source_id, part, deck_id, slide_index, text, ts_config,
          tsv, embedding, embedding_model, content_hash, index_version)
        VALUES (${uuidv7()}, ${SINGLE_USER_ID}, 'slide', ${uuidv7()}, 0, ${deck.id}, ${s}, ${text}, 'german',
          to_tsvector('german', ${text}) || to_tsvector('simple', ${text}), ${vector}::vector, ${FAKE_MODEL},
          ${'0'.repeat(64)}, 1)`;
    }
  }
  await sql`ANALYZE search_chunk`;
  await sql`ANALYZE slide_deck`;
  await sql`ANALYZE module`;
  moduleM1 = (await sql<{ id: string }[]>`SELECT id FROM module WHERE short_name = 'M1'`)[0]!.id;
});
afterAll(async () => {
  await app.handle.sql`TRUNCATE semester, module, session, slide_deck, search_chunk, job CASCADE`;
  await app.close();
  await worker.stop();
});

/** Referenz: dieselbe Abfrage mit dem Standard-Plan des Servers (ohne die Einstellungen aus search.ts) */
async function reference(q: string, moduleId?: string): Promise<string[]> {
  const parsed = parseSearchQuery(q);
  const text = tsQueryText(parsed.words, parsed.prefixLast)!;
  const rows = await app.handle.sql<{ id: string }[]>`
    SELECT c.id FROM search_chunk c
    LEFT JOIN slide_deck d ON d.id = c.deck_id
    JOIN module m ON m.id = d.module_id
    WHERE c.deleted_at IS NULL AND d.deleted_at IS NULL AND m.deleted_at IS NULL
      AND (${moduleId ?? null}::uuid IS NULL OR d.module_id = ${moduleId ?? null}::uuid)
      AND c.tsv @@ (to_tsquery('german'::regconfig, ${text}) || to_tsquery('english'::regconfig, ${text}) || to_tsquery('simple'::regconfig, ${text}))
    ORDER BY ts_rank_cd(c.tsv, (to_tsquery('german'::regconfig, ${text}) || to_tsquery('english'::regconfig, ${text}) || to_tsquery('simple'::regconfig, ${text}))) DESC, c.id
    LIMIT ${CANDIDATES}`;
  return rows.map((r) => r.id);
}

describe('Wortsuche mit Planer-Einstellungen (#334)', () => {
  // Die Vektoren in `search_chunk` machten die Liste sonst gemischt; hier zählt nur die Wortsuche
  beforeEach(() => {
    worker.mode = 'unavailable';
  });
  it.each(['alpha', 'alpha beta', 'selten', 'zet', 'gamma delt'])(
    'liefert für "%s" dieselbe Reihenfolge wie der Standard-Plan',
    async (q) => {
      const res = await app.request({
        url: `${API}/search?${new URLSearchParams({ q, limit: '50' }).toString()}`,
      });
      expect(res.statusCode).toBe(200);
      const body = SearchResponseSchema.parse(res.json());
      // Ohne Vektoren in `search_chunk` kommt alles aus der Wortsuche; RRF mit einer Liste erhält deren Reihenfolge
      expect(body.hits.map((h) => h.chunk_id)).toEqual((await reference(q)).slice(0, 50));
      expect(body.hits.length).toBeGreaterThan(0);
    },
  );

  it('filtert nach Fach wie zuvor', async () => {
    const res = await app.request({
      url: `${API}/search?${new URLSearchParams({ q: 'fach:M1 alpha', limit: '50' }).toString()}`,
    });
    expect(res.statusCode).toBe(200);
    const body = SearchResponseSchema.parse(res.json());
    expect(body.hits.length).toBeGreaterThan(0);
    expect(new Set(body.hits.map((h) => h.module.short_name))).toEqual(new Set(['M1']));
  });
});

/**
 * Referenz der Bedeutungssuche: eigene, einfache Abfrage (nicht `vectorQuery`) auf einer Verbindung, exakt, ohne die
 * Einstellungen aus search.ts. Ohne eigene Formulierung würde eine Änderung an `vectorQuery` die Referenz mitziehen.
 */
async function vectorReference(word: string, moduleId: string | undefined): Promise<string[]> {
  const literal = `[${fakeEmbed(word).join(',')}]`;
  const rows = await app.handle.sql<{ id: string; dist: number }[]>`
    SELECT c.id, c.embedding <=> ${literal}::vector AS dist
    FROM search_chunk c JOIN slide_deck d ON d.id = c.deck_id JOIN module m ON m.id = d.module_id
    WHERE c.deleted_at IS NULL AND d.deleted_at IS NULL AND m.deleted_at IS NULL
      AND c.source_kind = 'slide' AND c.embedding_model = ${FAKE_MODEL}
      AND (${moduleId ?? null}::uuid IS NULL OR d.module_id = ${moduleId ?? null}::uuid)
    ORDER BY dist, c.id`;
  return rows
    .filter((r) => Number(r.dist) <= 1 - MIN_VECTOR_SIM)
    .slice(0, CANDIDATES)
    .map((r) => r.id);
}

describe('gefilterte Bedeutungssuche mit Planer-Einstellungen (#400)', () => {
  beforeEach(() => {
    worker.mode = 'ok';
  });

  const cases: { q: string; word: string; byModule: boolean }[] = [
    { q: 'typ:folie alpha', word: 'alpha', byModule: false },
    { q: 'fach:M1 alpha', word: 'alpha', byModule: true },
    { q: 'fach:M1 typ:folie gamma', word: 'gamma', byModule: true },
  ];
  it.each(cases)('"$q": dieselbe Reihenfolge wie die Abfrage ohne Einstellungen', async (c) => {
    const res = await app.request({
      url: `${API}/search?${new URLSearchParams({ q: c.q, limit: '50' }).toString()}`,
    });
    expect(res.statusCode).toBe(200);
    const body = SearchResponseSchema.parse(res.json());
    expect(body.mode).toBe('hybrid');
    const vectorIds = await vectorReference(c.word, c.byModule ? moduleM1 : undefined);
    expect(vectorIds.length).toBeGreaterThan(0);
    const textIds = await reference(c.word, c.byModule ? moduleM1 : undefined);
    const expected = fuseRrf([textIds, vectorIds])
      .map((f) => f.id)
      .slice(0, 50);
    expect(body.hits.map((h) => h.chunk_id)).toEqual(expected);
  });
});

describe('Plan der Wortsuche (#400)', () => {
  // Ziel aus textSettings: tsv wird über den GIN-Index gefiltert (Index Cond bzw. Recheck Cond auf tsv @@), nicht als
  // Filter eines vollen Scans. Ohne die Einstellungen wählt der Planer hier einen Seq Scan.
  it.each(['selten', 'alpha'])('"%s": GIN-Index auf tsv, kein Seq Scan', async (q) => {
    const parsed = parseSearchQuery(q);
    const text = tsQueryText(parsed.words, parsed.prefixLast)!;
    const plan = (
      await withSettings(app.handle.db, textSettings(2), 2000, (tx) =>
        tx.execute<Record<string, string>>(
          sql`EXPLAIN ${textQuery(text, { moduleIds: null, kinds: [], unresolved: [] })}`,
        ),
      )
    )
      .map((r) => Object.values(r)[0])
      .join('\n');
    expect(plan, plan).toContain('Bitmap Index Scan on search_chunk_tsv_gin');
    expect(plan, plan).toMatch(/(Index|Recheck) Cond: \(.*tsv @@/);
    expect(plan, plan).not.toContain('Seq Scan on search_chunk');
  });
});

describe('Einstellungen enden mit der Transaktion (#400)', () => {
  it('SHOW auf einer frischen Abfrage zeigt wieder die Standardwerte', async () => {
    const show = async (name: string) =>
      (await app.handle.sql.unsafe<{ v: string }[]>(`SELECT current_setting('${name}') AS v`))[0]!.v;
    const before = {
      seqscan: await show('enable_seqscan'),
      timeout: await show('statement_timeout'),
      workers: await show('max_parallel_workers_per_gather'),
      setup: await show('parallel_setup_cost'),
    };
    expect(before.seqscan).toBe('on');
    // Innerhalb gelten sie
    const inside = await withSettings(app.handle.db, textSettings(4), 1500, async (tx) => {
      const [row] = await tx.execute<Record<string, string>>(
        sql`SELECT current_setting('enable_seqscan') AS seqscan, current_setting('statement_timeout') AS timeout,
          current_setting('max_parallel_workers_per_gather') AS workers`,
      );
      return row;
    });
    expect(inside).toEqual({ seqscan: 'off', timeout: '1500ms', workers: '4' });
    // Mehrere frische Abfragen, damit auch eine wiederverwendete Pool-Verbindung dabei ist
    for (let i = 0; i < 5; i += 1) {
      expect(await show('enable_seqscan')).toBe(before.seqscan);
      expect(await show('statement_timeout')).toBe(before.timeout);
      expect(await show('max_parallel_workers_per_gather')).toBe(before.workers);
      expect(await show('parallel_setup_cost')).toBe(before.setup);
    }
  });
});

describe('Zeitlimit (#400)', () => {
  const noEmbed = {
    embed: () => Promise.reject(new Error('aus')),
  };

  it('eine zu lange Abfrage wird abgebrochen: 503 search_timeout ohne SQL-Text', async () => {
    const error = await withSettings(app.handle.db, [], 50, (tx) =>
      tx.execute(sql`SELECT pg_sleep(2)`),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ statusCode: 503, code: 'search_timeout' });
    expect((error as HttpError).message).not.toMatch(/select|pg_sleep|statement/i);
  });

  it('search() meldet ein Zeitlimit der Datenbank (SQLSTATE 57014) als 503 search_timeout', async () => {
    const db = {
      transaction: async () => {
        throw Object.assign(new Error('Failed query: select …'), { cause: { code: '57014' } });
      },
    };
    const error = await search({ db: db as never, worker: noEmbed }, { q: 'alpha', limit: 5 }).catch(
      (e: unknown) => e,
    );
    expect(error).toMatchObject({ statusCode: 503, code: 'search_timeout' });
  });

  it('andere Datenbankfehler bleiben unverändert', async () => {
    const boom = new Error('boom');
    const db = {
      transaction: async () => {
        throw boom;
      },
    };
    await expect(search({ db: db as never, worker: noEmbed }, { q: 'alpha', limit: 5 })).rejects.toBe(boom);
  });
});

describe('SG_SEARCH_WORKERS (#400)', () => {
  it('Standard 2, erlaubt 0–4, sonst Fehler', () => {
    expect(parseSearchWorkers(undefined)).toBe(2);
    expect(parseSearchWorkers('')).toBe(2);
    expect(parseSearchWorkers('0')).toBe(0);
    expect(parseSearchWorkers('4')).toBe(4);
    for (const bad of ['5', '-1', '1.5', 'x']) {
      expect(() => parseSearchWorkers(bad)).toThrow(/SG_SEARCH_WORKERS/);
    }
  });
});
