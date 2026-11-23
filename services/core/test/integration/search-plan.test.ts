// #334: GET /search setzt für Wort- und gefilterte Bedeutungssuche Planer-Einstellungen (parallele Worker, kein Seq Scan
// auf der Wortsuche). Das darf die Ergebnisse nicht ändern: Reihenfolge der Wortsuche = Referenz mit Standard-Plan.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SINGLE_USER_ID, SearchResponseSchema } from '@sg/shared';
import { uuidv7 } from '../../src/lib/uuid7.ts';
import { CANDIDATES, parseSearchQuery, tsQueryText } from '../../src/services/search.ts';
import { FakeWorker } from '../unit/worker-fake.ts';
import { startTestApp, type TestApp } from './helpers.ts';

const API = '/api/v1';
const DECKS = 6;
const SLIDES = 40; // 240 Folien
const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta'];

let app: TestApp;
let worker: FakeWorker;

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
  for (const deck of decks) {
    for (let s = 1; s <= SLIDES; s += 1) {
      n += 1;
      const text = textFor(n);
      await sql`INSERT INTO search_chunk (id, user_id, source_kind, source_id, part, deck_id, slide_index, text, ts_config,
          tsv, content_hash, index_version)
        VALUES (${uuidv7()}, ${SINGLE_USER_ID}, 'slide', ${uuidv7()}, 0, ${deck.id}, ${s}, ${text}, 'german',
          to_tsvector('german', ${text}) || to_tsvector('simple', ${text}), ${'0'.repeat(64)}, 1)`;
    }
  }
  await sql`ANALYZE search_chunk`;
});
afterAll(async () => {
  await app.handle.sql`TRUNCATE semester, module, session, slide_deck, search_chunk, job CASCADE`;
  await app.close();
  await worker.stop();
});

/** Referenz: dieselbe Abfrage mit dem Standard-Plan des Servers (ohne die Einstellungen aus search.ts) */
async function reference(q: string): Promise<string[]> {
  const parsed = parseSearchQuery(q);
  const text = tsQueryText(parsed.words, parsed.prefixLast)!;
  const rows = await app.handle.sql<{ id: string }[]>`
    SELECT c.id FROM search_chunk c
    LEFT JOIN slide_deck d ON d.id = c.deck_id
    JOIN module m ON m.id = d.module_id
    WHERE c.deleted_at IS NULL AND d.deleted_at IS NULL AND m.deleted_at IS NULL
      AND c.tsv @@ (to_tsquery('german'::regconfig, ${text}) || to_tsquery('english'::regconfig, ${text}) || to_tsquery('simple'::regconfig, ${text}))
    ORDER BY ts_rank_cd(c.tsv, (to_tsquery('german'::regconfig, ${text}) || to_tsquery('english'::regconfig, ${text}) || to_tsquery('simple'::regconfig, ${text}))) DESC, c.id
    LIMIT ${CANDIDATES}`;
  return rows.map((r) => r.id);
}

describe('Wortsuche mit Planer-Einstellungen (#334)', () => {
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
