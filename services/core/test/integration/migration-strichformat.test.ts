// Migration 0013_strichformat_v2 (V2-1, VERTRAEGE §23.6): nullbare Spalte stroke.sizes.
// Zuerst der Stand vor der Migration mit vorhandenen Strichen, dann die Prüfungen. Alle Inhalte erfunden.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SINGLE_USER_ID } from '@sg/shared';
import { createDb, type DbHandle } from '../../src/db/client.ts';
import { MIGRATIONS_FOLDER, runMigrations } from '../../src/db/migrate.ts';
import { uuidv7 } from '../../src/lib/uuid7.ts';
import { testDatabaseUrl } from './helpers.ts';

/** Letzte Migration vor dem Strichformat v2 */
const BEFORE_TAG = '0012_cards';
const U = SINGLE_USER_ID;

let admin: postgres.Sql;
let handle: DbHandle;
let sql: postgres.Sql;
let dbName: string;
let beforeFolder: string;

const moduleId = uuidv7();
const notebookId = uuidv7();
const pageId = uuidv7();
const oldStrokeId = uuidv7();
/** Zwei Punkte à 24 Byte, alle Werte 0 */
const TWO_POINTS = Buffer.alloc(48);

beforeAll(async () => {
  admin = postgres(testDatabaseUrl(), { max: 1, onnotice: () => {} });
  dbName = `sg_it_strichformat_${Date.now()}_${randomBytes(3).toString('hex')}`;
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  const url = new URL(testDatabaseUrl());
  url.pathname = `/${dbName}`;
  handle = createDb(url.toString());
  sql = handle.sql;

  beforeFolder = mkdtempSync(join(tmpdir(), 'sg-migrations-strichformat-'));
  cpSync(MIGRATIONS_FOLDER, beforeFolder, { recursive: true });
  const journalPath = join(beforeFolder, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
  const last = journal.entries.findIndex((e) => e.tag === BEFORE_TAG);
  expect(last).toBeGreaterThanOrEqual(0);
  expect(journal.entries[last + 1]?.tag).toBe('0013_strichformat_v2');
  journal.entries = journal.entries.slice(0, last + 1);
  writeFileSync(journalPath, JSON.stringify(journal));

  // Stand vor 0013 mit einem Strich (die Tabelle hat noch keine Spalte sizes)
  await migrate(handle.db, { migrationsFolder: beforeFolder });
  const semesterId = uuidv7();
  await sql`INSERT INTO semester (id, user_id, name) VALUES (${semesterId}, ${U}, 'Strichformat-Test')`;
  await sql`INSERT INTO module (id, user_id, semester_id, name, color)
    VALUES (${moduleId}, ${U}, ${semesterId}, 'Beispielfach', 'mod-02')`;
  await sql`INSERT INTO notebook (id, user_id, module_id, title) VALUES (${notebookId}, ${U}, ${moduleId}, 'Skizzen')`;
  await sql`INSERT INTO page (id, user_id, notebook_id, index, template, width_pt, height_pt)
    VALUES (${pageId}, ${U}, ${notebookId}, 1, 'liniert', 595, 842)`;
  await sql`INSERT INTO stroke (id, user_id, page_id, client_id, tool, layer, color, width, bbox, points)
    VALUES (${oldStrokeId}, ${U}, ${pageId}, 'alter-strich', 'pen', 'ink', '#1E2A44FF', 2.4, '[0,0,1,1]'::jsonb, ${TWO_POINTS})`;
  const before = await sql`SELECT column_name FROM information_schema.columns
    WHERE table_name = 'stroke' AND column_name = 'sizes'`;
  expect(before).toHaveLength(0);

  await runMigrations(handle.db);
  await runMigrations(handle.db); // idempotent
});

afterAll(async () => {
  await handle?.close();
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end({ timeout: 5 });
  rmSync(beforeFolder, { recursive: true, force: true });
});

describe('Migration 0013_strichformat_v2 auf einem Stand mit Strichen', () => {
  it('legt stroke.sizes als nullbare bytea-Spalte ohne Vorgabe an', async () => {
    const [col] = await sql`SELECT data_type, is_nullable, column_default FROM information_schema.columns
      WHERE table_name = 'stroke' AND column_name = 'sizes'`;
    expect(col).toEqual({ data_type: 'bytea', is_nullable: 'YES', column_default: null });
  });

  it('vorhandene Striche bleiben lesbar, unverändert und ohne sizes (Format v1)', async () => {
    const rows =
      await sql`SELECT client_id, tool, width, points, sizes FROM stroke WHERE page_id = ${pageId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ client_id: 'alter-strich', tool: 'pen', sizes: null });
    expect(Buffer.from(rows[0]?.points as Buffer).equals(TWO_POINTS)).toBe(true);
    expect(rows[0]?.width).toBeCloseTo(2.4, 4);
  });

  it('der CHECK verlangt 8 Byte je Punkt (ein Drittel der Länge von points)', async () => {
    await sql`UPDATE stroke SET sizes = ${Buffer.alloc(16)} WHERE id = ${oldStrokeId}`;
    await expect(
      sql`UPDATE stroke SET sizes = ${Buffer.alloc(15)} WHERE id = ${oldStrokeId}`,
    ).rejects.toMatchObject({
      constraint_name: 'stroke_sizes_chk',
    });
    await sql`UPDATE stroke SET sizes = NULL WHERE id = ${oldStrokeId}`;
  });
});
