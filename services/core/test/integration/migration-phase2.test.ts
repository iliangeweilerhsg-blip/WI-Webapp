// Migration 0006_transcript auf einer Datenbank mit Phase-1-Stand und Daten (T2-01, VERTRAEGE §18.1).
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

/** Letzte Migration vor Phase 2 */
const PHASE1_LAST_TAG = '0005_moodle';
const HEX = 'a'.repeat(64);

let admin: postgres.Sql;
let handle: DbHandle;
let dbName: string;
let phase1Folder: string;

beforeAll(async () => {
  admin = postgres(testDatabaseUrl(), { max: 1, onnotice: () => {} });
  dbName = `sg_it_p1_${Date.now()}_${randomBytes(3).toString('hex')}`;
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  const url = new URL(testDatabaseUrl());
  url.pathname = `/${dbName}`;
  handle = createDb(url.toString());

  phase1Folder = mkdtempSync(join(tmpdir(), 'sg-migrations-p1-'));
  cpSync(MIGRATIONS_FOLDER, phase1Folder, { recursive: true });
  const journalPath = join(phase1Folder, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
  const last = journal.entries.findIndex((e) => e.tag === PHASE1_LAST_TAG);
  expect(last).toBeGreaterThanOrEqual(0);
  journal.entries = journal.entries.slice(0, last + 1);
  writeFileSync(journalPath, JSON.stringify(journal));
});

afterAll(async () => {
  await handle?.close();
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end({ timeout: 5 });
  rmSync(phase1Folder, { recursive: true, force: true });
});

describe('Migration vom Phase-1-Stand (0006_transcript)', () => {
  it('lässt Bestandsdaten unberührt und legt Transkript- und Folienzuordnungstabellen an', async () => {
    await migrate(handle.db, { migrationsFolder: phase1Folder });
    const sql = handle.sql;
    const u = SINGLE_USER_ID;
    const semesterId = uuidv7();
    const moduleId = uuidv7();
    const deckId = uuidv7();
    const slideId = uuidv7();
    const sessionId = uuidv7();
    const recordingId = uuidv7();
    const finalizeJobId = uuidv7();

    // Phase-1-Daten: beendete Session mit Aufnahme, Folienwechsel und fertigem audio.finalize
    await sql`INSERT INTO semester (id, user_id, name, is_current) VALUES (${semesterId}, ${u}, 'HS 2026', true)`;
    await sql`INSERT INTO module (id, user_id, semester_id, name, color, lang)
      VALUES (${moduleId}, ${u}, ${semesterId}, 'Datenbanksysteme', 'mod-03', 'de')`;
    await sql`INSERT INTO slide_deck (id, user_id, module_id, title, file_path, sha256)
      VALUES (${deckId}, ${u}, ${moduleId}, 'VL 7', 'media/decks/x/original.pdf', ${HEX})`;
    await sql`INSERT INTO slide (id, user_id, deck_id, index, width_pt, height_pt, text, title)
      VALUES (${slideId}, ${u}, ${deckId}, 1, 720, 405, 'Dritte Normalform', 'Dritte Normalform')`;
    await sql`INSERT INTO session (id, user_id, module_id, slide_deck_id, state, started_at, ended_at, processing)
      VALUES (${sessionId}, ${u}, ${moduleId}, ${deckId}, 'verarbeitet', now() - interval '2 hours',
              now() - interval '30 min', '{"audio.finalize": "fertig"}'::jsonb)`;
    await sql`INSERT INTO recording (id, user_id, session_id, mime, codec, started_ms, duration_ms, state)
      VALUES (${recordingId}, ${u}, ${sessionId}, 'audio/webm;codecs=opus', 'opus', 0, 5400000, 'vollstaendig')`;
    await sql`INSERT INTO slide_event (id, user_id, session_id, slide_id, slide_index, t_ms, device, source)
      VALUES (${uuidv7()}, ${u}, ${sessionId}, ${slideId}, 1, 1000, 'mac', 'manuell_mac')`;
    await sql`INSERT INTO job (id, user_id, type, payload, state, session_id)
      VALUES (${finalizeJobId}, ${u}, 'audio.finalize', ${JSON.stringify({ recording_id: recordingId })}::jsonb,
              'fertig', ${sessionId})`;

    await runMigrations(handle.db);
    await runMigrations(handle.db); // idempotent

    const [sess] = await sql`SELECT state, processing FROM session WHERE id = ${sessionId}`;
    expect(sess).toEqual({ state: 'verarbeitet', processing: { 'audio.finalize': 'fertig' } });
    expect(await sql`SELECT count(*)::int AS n FROM job`).toEqual([{ n: 1 }]);
    for (const table of ['transcript', 'transcript_segment', 'slide_segment']) {
      expect(await sql.unsafe(`SELECT count(*)::int AS n FROM ${table}`)).toEqual([{ n: 0 }]);
    }

    // Schreibweg des Workers (VERTRAEGE §18.2/§18.3) passt auf die Tabellen
    const transcriptId = uuidv7();
    const jobId = uuidv7();
    await sql`INSERT INTO transcript (id, user_id, session_id, recording_id, job_id, finalize_job_id, provider, model,
        language, initial_prompt, input_hash, audio_sha256, audio_duration_ms, segment_count, word_count)
      VALUES (${transcriptId}, ${u}, ${sessionId}, ${recordingId}, ${jobId}, ${finalizeJobId}, 'fake', 'fake-1',
        'de', 'Vorlesung Datenbanksysteme. Folien: Dritte Normalform.', ${HEX}, ${HEX}, 5400000, 1, 3)`;
    const words = [
      { text: 'Die', start_ms: 1000, end_ms: 1200, prob: 1 },
      { text: 'dritte', start_ms: 1200, end_ms: 1500, prob: 1 },
      { text: 'Normalform.', start_ms: 1500, end_ms: 2100, prob: 1 },
    ];
    await sql`INSERT INTO transcript_segment (id, user_id, transcript_id, session_id, recording_id, seq, start_ms,
        end_ms, text, lang, avg_logprob, no_speech_prob, words)
      VALUES (${uuidv7()}, ${u}, ${transcriptId}, ${sessionId}, ${recordingId}, 0, 1000, 2100,
        'Die dritte Normalform.', 'de', -0.1, 0, ${JSON.stringify(words)}::jsonb)`;
    await sql`INSERT INTO slide_segment (id, user_id, session_id, slide_id, slide_index, start_ms, end_ms, source,
        confidence, job_id)
      VALUES (${uuidv7()}, ${u}, ${sessionId}, ${slideId}, 1, 0, 5400000, 'log', 1, ${uuidv7()})`;

    // Ein Transkript je Aufnahme
    await expect(
      sql`INSERT INTO transcript (id, user_id, session_id, recording_id, job_id, finalize_job_id, provider, model,
          input_hash, audio_sha256, audio_duration_ms, segment_count, word_count)
        VALUES (${uuidv7()}, ${u}, ${sessionId}, ${recordingId}, ${jobId}, ${finalizeJobId}, 'fake', 'fake-1',
          ${HEX}, ${HEX}, 0, 0, 0)`,
    ).rejects.toThrow(/transcript_recording_uq/);
    // Prüfungen: Quelle, Zeitraum, Konfidenz
    await expect(
      sql`INSERT INTO slide_segment (id, user_id, session_id, slide_id, slide_index, start_ms, end_ms, source, confidence)
        VALUES (${uuidv7()}, ${u}, ${sessionId}, ${slideId}, 1, 10, 10, 'log', 1)`,
    ).rejects.toThrow(/slide_segment_time_chk/);
    await expect(
      sql`INSERT INTO slide_segment (id, user_id, session_id, slide_id, slide_index, start_ms, end_ms, source, confidence)
        VALUES (${uuidv7()}, ${u}, ${sessionId}, ${slideId}, 1, 0, 10, 'korrektur', 1)`,
    ).rejects.toThrow(/slide_segment_source_chk/);

    // updated_at pflegt die Datenbank (Trigger wie 0002)
    const triggers = await sql`SELECT tgname FROM pg_trigger WHERE tgname LIKE '%_touch_updated_at'
      AND tgrelid IN ('transcript'::regclass, 'transcript_segment'::regclass, 'slide_segment'::regclass)`;
    expect(triggers.map((r) => r.tgname as string).sort()).toEqual([
      'slide_segment_touch_updated_at',
      'transcript_segment_touch_updated_at',
      'transcript_touch_updated_at',
    ]);
    await sql`UPDATE transcript SET segment_count = 1, updated_at = '2000-01-01T00:00:00Z' WHERE id = ${transcriptId}`;
    await sql`UPDATE transcript SET segment_count = 2 WHERE id = ${transcriptId}`;
    const [touched] =
      await sql`SELECT updated_at > '2000-01-02T00:00:00Z'::timestamptz AS ok FROM transcript WHERE id = ${transcriptId}`;
    expect(touched?.ok).toBe(true);

    // Ersetzen (hartes DELETE) nimmt die Segmente mit, endgültiges Löschen der Session alles (Papierkorb, §13)
    await sql`DELETE FROM transcript WHERE id = ${transcriptId}`;
    expect(await sql`SELECT count(*)::int AS n FROM transcript_segment`).toEqual([{ n: 0 }]);
    await sql`DELETE FROM session WHERE id = ${sessionId}`;
    for (const table of ['transcript', 'transcript_segment', 'slide_segment', 'recording']) {
      expect(await sql.unsafe(`SELECT count(*)::int AS n FROM ${table}`)).toEqual([{ n: 0 }]);
    }
  });
});
