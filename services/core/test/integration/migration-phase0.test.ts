// Phase-1-Migration auf einer Datenbank mit Phase-0-Stand und Daten (Abnahme T1-DB).
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

/** Letzte Migration des Phase-0-Stands (main vor T1-DB) */
const PHASE0_LAST_TAG = '0002_updated_at_trigger';

let admin: postgres.Sql;
let handle: DbHandle;
let dbName: string;
let phase0Folder: string;

beforeAll(async () => {
  admin = postgres(testDatabaseUrl(), { max: 1, onnotice: () => {} });
  dbName = `sg_it_p0_${Date.now()}_${randomBytes(3).toString('hex')}`;
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  const url = new URL(testDatabaseUrl());
  url.pathname = `/${dbName}`;
  handle = createDb(url.toString());

  // Ordner mit den Migrationen bis einschließlich Phase 0
  phase0Folder = mkdtempSync(join(tmpdir(), 'sg-migrations-p0-'));
  cpSync(MIGRATIONS_FOLDER, phase0Folder, { recursive: true });
  const journalPath = join(phase0Folder, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
  const last = journal.entries.findIndex((e) => e.tag === PHASE0_LAST_TAG);
  expect(last).toBeGreaterThanOrEqual(0);
  journal.entries = journal.entries.slice(0, last + 1);
  writeFileSync(journalPath, JSON.stringify(journal));
});

afterAll(async () => {
  await handle?.close();
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end({ timeout: 5 });
  rmSync(phase0Folder, { recursive: true, force: true });
});

describe('Migration vom Phase-0-Stand', () => {
  it('übernimmt vorhandene Daten und ergänzt die neuen Spalten mit Standards', async () => {
    await migrate(handle.db, { migrationsFolder: phase0Folder });
    const sql = handle.sql;
    const u = SINGLE_USER_ID;
    const semesterId = uuidv7();
    const moduleId = uuidv7();
    const deckId = uuidv7();
    const sourceId = uuidv7();
    const eventId = uuidv7();
    const sessionId = uuidv7();
    const deviceId = uuidv7();
    const backupId = uuidv7();

    // Phase-0-Daten mit rohem SQL (das Drizzle-Schema kennt schon die neuen Spalten)
    await sql`INSERT INTO semester (id, user_id, name, is_current) VALUES (${semesterId}, ${u}, 'HS 2026', true)`;
    await sql`INSERT INTO module (id, user_id, semester_id, name, color, ects)
      VALUES (${moduleId}, ${u}, ${semesterId}, 'Datenbanksysteme', 'mod-03', 6)`;
    await sql`INSERT INTO slide_deck (id, user_id, module_id, title, file_path, sha256)
      VALUES (${deckId}, ${u}, ${moduleId}, 'VL 1', 'media/decks/x/original.pdf', ${'a'.repeat(64)})`;
    await sql`INSERT INTO calendar_source (id, user_id, kind, url)
      VALUES (${sourceId}, ${u}, 'ics_url', 'https://uni.example/plan.ics')`;
    await sql`INSERT INTO calendar_event (id, user_id, source_id, external_uid, module_id, kind, title, starts_at, ends_at)
      VALUES (${eventId}, ${u}, ${sourceId}, 'uid-1', ${moduleId}, 'vorlesung', 'DBS', now(), now() + interval '90 min')`;
    await sql`INSERT INTO session (id, user_id, module_id, calendar_event_id, state, started_at)
      VALUES (${sessionId}, ${u}, ${moduleId}, ${eventId}, 'laeuft', now())`;
    await sql`INSERT INTO device (id, user_id, name, kind, token_hash)
      VALUES (${deviceId}, ${u}, 'iPad', 'ipad', ${'b'.repeat(64)})`;
    await sql`INSERT INTO backup_run (id, user_id, started_at, target, state)
      VALUES (${backupId}, ${u}, now(), '/Volumes/Backup', 'fertig')`;
    await sql`INSERT INTO setting (key, value, user_id) VALUES ('lecture', '{"auto_stop_silence_min": 20}', ${u})`;
    await sql`INSERT INTO job (id, user_id, type, payload) VALUES (${uuidv7()}, ${u}, 'pdf.ingest', ${JSON.stringify({ slide_deck_id: deckId })}::jsonb)`;

    await runMigrations(handle.db);
    await runMigrations(handle.db); // idempotent

    const [mod] = await sql`SELECT settings, ects FROM module WHERE id = ${moduleId}`;
    expect(mod).toMatchObject({ settings: {}, ects: '6' });
    const [source] = await sql`SELECT name, last_error FROM calendar_source WHERE id = ${sourceId}`;
    expect(source).toEqual({ name: 'https://uni.example/plan.ics', last_error: null });
    const [event] =
      await sql`SELECT all_day, assigned_by, description FROM calendar_event WHERE id = ${eventId}`;
    expect(event).toEqual({ all_day: false, assigned_by: 'auto', description: null });
    const [sess] =
      await sql`SELECT state, start_offsets, auto_stop_extended_until FROM session WHERE id = ${sessionId}`;
    expect(sess).toEqual({ state: 'laeuft', start_offsets: [], auto_stop_extended_until: null });
    const [dev] = await sql`SELECT clock_offset_ms FROM device WHERE id = ${deviceId}`;
    expect(dev?.clock_offset_ms).toBeNull(); // 0 war kein Messwert
    const [backup] = await sql`SELECT trigger, stand FROM backup_run WHERE id = ${backupId}`;
    expect(backup).toEqual({ trigger: 'manuell', stand: null });
    expect(await sql`SELECT count(*)::int AS n FROM sync_meta`).toEqual([{ n: 1 }]);
    expect(await sql`SELECT count(*)::int AS n FROM job`).toEqual([{ n: 1 }]);

    // Neue Invariante greift sofort: neben der laufenden Session keine pausierte
    await expect(
      sql`INSERT INTO session (id, user_id, module_id, state) VALUES (${uuidv7()}, ${u}, ${moduleId}, 'pausiert')`,
    ).rejects.toThrow();
  });
});
