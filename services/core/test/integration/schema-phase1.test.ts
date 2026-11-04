// Phase-1-Tabellen aus T1-DB (VERTRAEGE §6.1, 03 §3/§5/§6/§13): Spalten, Schlüssel, Fremdschlüssel, Trigger.
import { eq, sql as dsql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SINGLE_USER_ID } from '@sg/shared';
import { createDb, type DbHandle } from '../../src/db/client.ts';
import {
  audioChunk,
  calendarEvent,
  calendarSource,
  courseModule,
  marker,
  notebook,
  page,
  pageElement,
  recording,
  semester,
  session,
  slideEvent,
  stroke,
} from '../../src/db/schema/index.ts';
import { uuidv7 } from '../../src/lib/uuid7.ts';
import { testDatabaseUrl } from './helpers.ts';

let handle: DbHandle;
let sql: postgres.Sql;
const base = { userId: SINGLE_USER_ID };

beforeAll(() => {
  handle = createDb(testDatabaseUrl());
  sql = handle.sql;
});
afterAll(async () => {
  await sql`TRUNCATE semester, module, calendar_source, calendar_event, session, notebook CASCADE`;
  await handle.close();
});

async function seedModule() {
  const semesterId = uuidv7();
  const moduleId = uuidv7();
  await handle.db.insert(semester).values({ id: semesterId, ...base, name: `S ${semesterId}` });
  await handle.db
    .insert(courseModule)
    .values({ id: moduleId, ...base, semesterId, name: 'M', color: 'mod-04' });
  return moduleId;
}

async function columns(table: string) {
  const rows = await sql`SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${table}`;
  return Object.fromEntries(rows.map((r) => [r.column_name as string, r]));
}

describe('Phase-1-Schema', () => {
  it('ergänzt module, calendar_source, calendar_event, session, recording, device und backup_run (VERTRAEGE §6.1)', async () => {
    const mod = await columns('module');
    expect(mod.settings).toMatchObject({ data_type: 'jsonb', is_nullable: 'NO' });
    expect(mod.settings?.column_default).toContain("'{}'");

    const source = await columns('calendar_source');
    expect(source.name).toMatchObject({ data_type: 'text', is_nullable: 'NO' });
    expect(source.last_error).toMatchObject({ is_nullable: 'YES' });

    const event = await columns('calendar_event');
    expect(event.description).toMatchObject({ is_nullable: 'YES' });
    expect(event.all_day).toMatchObject({ data_type: 'boolean', is_nullable: 'NO' });
    expect(event.assigned_by?.column_default).toContain("'auto'");

    const sess = await columns('session');
    expect(sess.start_offsets).toMatchObject({ data_type: 'jsonb', is_nullable: 'NO' });
    expect(sess.start_offsets?.column_default).toContain("'[]'");
    expect(sess.auto_stop_extended_until).toMatchObject({ is_nullable: 'YES' });

    const rec = await columns('recording');
    expect(rec.chunks_independent).toMatchObject({ data_type: 'boolean', is_nullable: 'NO' });
    expect(rec.completed_at).toMatchObject({ is_nullable: 'YES' });
    expect((await columns('audio_chunk')).size_bytes).toMatchObject({ data_type: 'bigint' });

    const photo = await columns('photo');
    expect(photo.file_path).toMatchObject({ is_nullable: 'YES' });
    for (const c of ['mime', 'sha256', 'size_bytes']) expect(photo[c]?.is_nullable, c).toBe('NO');

    const dev = await columns('device');
    expect(dev.clock_offset_ms).toMatchObject({ is_nullable: 'YES', column_default: null });
    const backup = await columns('backup_run');
    expect(backup.trigger).toMatchObject({ is_nullable: 'NO' });
    expect(backup.stand).toMatchObject({ is_nullable: 'YES' });

    const stroke = await columns('stroke');
    expect(stroke.points).toMatchObject({ data_type: 'bytea', is_nullable: 'NO' });
    expect(stroke.transform).toMatchObject({ data_type: 'ARRAY', is_nullable: 'NO' });
  });

  it('legt sync_stream, sync_op und sync_meta genau nach VERTRAEGE §6.1 an', async () => {
    expect(Object.keys(await columns('sync_stream')).sort()).toEqual(['head_seq', 'stream']);
    const op = await columns('sync_op');
    expect(Object.keys(op).sort()).toEqual(
      [
        'stream',
        'seq',
        'op_id',
        'kind',
        'at',
        'clock_uncertain',
        'data',
        'origin',
        'device_id',
        'received_at',
      ].sort(),
    );
    expect(op.device_id?.is_nullable).toBe('YES');
    const constraints = await sql`SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'sync_op'::regclass`;
    const defs = constraints.map((c) => c.def as string);
    expect(defs).toContain('PRIMARY KEY (stream, seq)');
    expect(defs).toContain('UNIQUE (op_id)');

    const meta = await sql`SELECT db_epoch::text AS epoch FROM sync_meta`;
    expect(meta).toHaveLength(1);
    expect(meta[0]?.epoch).toMatch(/^[0-9a-f-]{36}$/);
    await expect(sql`INSERT INTO sync_meta (id, db_epoch) VALUES (2, gen_random_uuid())`).rejects.toThrow();
  });

  it('pflegt updated_at auch in den neuen Tabellen', async () => {
    const triggers = await sql`SELECT event_object_table AS t FROM information_schema.triggers
      WHERE trigger_name LIKE '%_touch_updated_at'`;
    const names = triggers.map((r) => r.t as string);
    for (const table of [
      'slide_event',
      'marker',
      'photo',
      'recording',
      'audio_chunk',
      'notebook',
      'page',
      'stroke',
      'page_element',
    ]) {
      expect(names, table).toContain(table);
    }
  });

  it('calendar_event: UNIQUE (source_id, external_uid, recurrence_id) mit NULLS NOT DISTINCT', async () => {
    const moduleId = await seedModule();
    const sourceId = uuidv7();
    await handle.db
      .insert(calendarSource)
      .values({ id: sourceId, ...base, kind: 'ics_file', name: 'stundenplan.ics' });
    const event = {
      ...base,
      sourceId,
      moduleId,
      externalUid: 'vl@uni',
      kind: 'vorlesung',
      title: 'VL',
      startsAt: new Date(),
      endsAt: new Date(),
    };
    await handle.db.insert(calendarEvent).values({ id: uuidv7(), ...event });
    // Einzeltermin doppelt: recurrence_id NULL zählt als gleich
    await expect(handle.db.insert(calendarEvent).values({ id: uuidv7(), ...event })).rejects.toThrow();
    // Vorkommen einer Serie unterscheiden sich über recurrence_id
    await handle.db
      .insert(calendarEvent)
      .values({ id: uuidv7(), ...event, recurrenceId: '2026-10-27T10:15:00+01:00' });
    await expect(
      handle.db
        .insert(calendarEvent)
        .values({ id: uuidv7(), ...event, recurrenceId: '2026-10-27T10:15:00+01:00' }),
    ).rejects.toThrow();
    await expect(
      handle.db
        .insert(calendarEvent)
        .values({ id: uuidv7(), ...event, externalUid: 'x', assignedBy: 'irgendwer' }),
    ).rejects.toThrow();
    // Manuelle Termine (ohne Quelle) fallen nicht unter den Abgleichschlüssel
    const manual = { ...event, sourceId: null, externalUid: null };
    await handle.db.insert(calendarEvent).values({ id: uuidv7(), ...manual });
    await handle.db.insert(calendarEvent).values({ id: uuidv7(), ...manual });
    // Upsert über den partiellen Index (so nutzt ihn der Abgleich in T1-01)
    const upsertId = uuidv7();
    const [upserted] = await handle.db
      .insert(calendarEvent)
      .values({ id: upsertId, ...event, title: 'VL neu' })
      .onConflictDoUpdate({
        target: [calendarEvent.sourceId, calendarEvent.externalUid, calendarEvent.recurrenceId],
        targetWhere: dsql`${calendarEvent.sourceId} IS NOT NULL`,
        set: { title: 'VL neu' },
      })
      .returning();
    expect(upserted?.id).not.toBe(upsertId);
    expect(upserted?.title).toBe('VL neu');
  });

  it('Verweise über Stromgrenzen haben keinen Fremdschlüssel, Teile eines Ganzen CASCADE (VERTRAEGE §6)', async () => {
    const moduleId = await seedModule();
    const sessionId = uuidv7();
    await handle.db.insert(session).values({ id: sessionId, ...base, moduleId, state: 'beendet' });
    // Unbekannte Folie, Seite und Session sind erlaubt (offline angelegt, kommt später)
    await handle.db.insert(slideEvent).values({
      id: uuidv7(),
      ...base,
      sessionId,
      slideId: uuidv7(),
      slideIndex: 1,
      tMs: 0,
      device: 'ipad',
      source: 'manuell_ipad',
    });
    const markerId = uuidv7();
    await handle.db
      .insert(marker)
      .values({ id: markerId, ...base, sessionId, kind: 'frage', tMs: 5, pageId: uuidv7(), source: 'ipad' });
    const notebookId = uuidv7();
    await handle.db.insert(notebook).values({ id: notebookId, ...base, moduleId, title: 'Frei' });
    const pageId = uuidv7();
    await handle.db.insert(page).values({
      id: pageId,
      ...base,
      notebookId,
      sessionId: uuidv7(),
      backgroundSlideId: uuidv7(),
      index: 1,
      template: 'blanko',
      widthPt: 595,
      heightPt: 842,
    });
    // Fremdschlüssel innerhalb eines Stroms
    await expect(
      handle.db
        .insert(marker)
        .values({ id: uuidv7(), ...base, sessionId: uuidv7(), kind: 'frage', tMs: 0, source: 'mac' }),
    ).rejects.toThrow();
    await expect(
      handle.db.insert(page).values({
        id: uuidv7(),
        ...base,
        notebookId: uuidv7(),
        index: 1,
        template: 'blanko',
        widthPt: 1,
        heightPt: 1,
      }),
    ).rejects.toThrow();

    const recordingId = uuidv7();
    await handle.db
      .insert(recording)
      .values({ id: recordingId, ...base, sessionId, mime: 'audio/webm', codec: 'opus', startedMs: 0 });
    const chunk = {
      ...base,
      recordingId,
      seq: 0,
      startMs: 0,
      durationMs: 10_000,
      filePath: 'media/recordings/x/chunks/0.webm',
      sha256: 'a'.repeat(64),
      sizeBytes: 100,
    };
    await handle.db.insert(audioChunk).values({ id: uuidv7(), ...chunk });
    await expect(handle.db.insert(audioChunk).values({ id: uuidv7(), ...chunk })).rejects.toThrow(); // Invariante 2

    // Endgültiges Löschen der Session nimmt ihre Daten mit
    await handle.db.delete(session).where(eq(session.id, sessionId));
    expect(await handle.db.select().from(marker).where(eq(marker.id, markerId))).toHaveLength(0);
    expect(
      await handle.db.select().from(audioChunk).where(eq(audioChunk.recordingId, recordingId)),
    ).toHaveLength(0);
    // Die Seite gehört zum Notizbuch und bleibt
    expect(await handle.db.select().from(page).where(eq(page.id, pageId))).toHaveLength(1);
    // Modul mit Notizbuch lässt sich nicht endgültig löschen (NO ACTION)
    await expect(handle.db.delete(courseModule).where(eq(courseModule.id, moduleId))).rejects.toThrow();
  });

  it('Striche: (page_id, client_id) eindeutig, auch gelöschte (Upsert, Invariante 6); bytea und transform', async () => {
    const moduleId = await seedModule();
    const notebookId = uuidv7();
    await handle.db.insert(notebook).values({ id: notebookId, ...base, moduleId, title: 'Frei' });
    const pageId = uuidv7();
    await handle.db
      .insert(page)
      .values({ id: pageId, ...base, notebookId, index: 1, template: 'kariert', widthPt: 1, heightPt: 1 });
    const points = Buffer.alloc(48, 7);
    const s = {
      ...base,
      pageId,
      clientId: uuidv7(),
      tool: 'pen',
      layer: 'ink',
      color: '#1E2A44FF',
      width: 2,
      bbox: [0, 0, 10, 10],
      points,
    };
    const id = uuidv7();
    await handle.db.insert(stroke).values({ id, ...s, deletedAt: new Date() });
    await expect(handle.db.insert(stroke).values({ id: uuidv7(), ...s })).rejects.toThrow();
    const [row] = await handle.db.select().from(stroke).where(eq(stroke.id, id));
    expect(Buffer.compare(row!.points, points)).toBe(0);
    expect(row!.transform).toEqual([1, 0, 0, 1, 0, 0]);
    expect(row!.clockUncertain).toBe(false);
    await expect(
      handle.db.insert(stroke).values({ id: uuidv7(), ...s, clientId: uuidv7(), transform: [1, 0, 0, 1] }),
    ).rejects.toThrow();
    await handle.db.insert(pageElement).values({
      id: uuidv7(),
      ...base,
      pageId,
      kind: 'stamp',
      frame: [0, 0, 20, 20],
      payload: { marker_id: uuidv7(), marker_kind: 'frage' },
    });
  });

  it('Notizbücher: je Modul höchstens ein „Vorlesung“ und ein „Übung“, freie beliebig viele', async () => {
    const moduleId = await seedModule();
    await handle.db
      .insert(notebook)
      .values({ id: uuidv7(), ...base, moduleId, title: 'Vorlesung', kind: 'vorlesung' });
    await handle.db
      .insert(notebook)
      .values({ id: uuidv7(), ...base, moduleId, title: 'Übung', kind: 'uebung' });
    await expect(
      handle.db
        .insert(notebook)
        .values({ id: uuidv7(), ...base, moduleId, title: 'VL 2', kind: 'vorlesung' }),
    ).rejects.toThrow();
    await handle.db.insert(notebook).values({ id: uuidv7(), ...base, moduleId, title: 'A' });
    await handle.db.insert(notebook).values({ id: uuidv7(), ...base, moduleId, title: 'B' });
  });
});
