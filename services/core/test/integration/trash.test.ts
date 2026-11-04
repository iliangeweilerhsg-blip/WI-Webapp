// softDelete / restoreFromTrash mit den Kaskaden aus VERTRAEGE §13.
import { eq as eqId } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SINGLE_USER_ID, type TrashKind } from '@sg/shared';
import { createDb, type DbHandle } from '../../src/db/client.ts';
import {
  audioChunk,
  calendarEvent,
  calendarSource,
  courseModule,
  exerciseSheet,
  marker,
  notebook,
  page,
  pageElement,
  photo,
  recording,
  semester,
  session,
  slide,
  slideDeck,
  slideEvent,
  stroke,
  task,
} from '../../src/db/schema/index.ts';
import { HttpError } from '../../src/errors.ts';
import { uuidv7 } from '../../src/lib/uuid7.ts';
import { restoreFromTrash, softDelete } from '../../src/services/trash.ts';
import { testDatabaseUrl } from './helpers.ts';

let handle: DbHandle;
const base = { userId: SINGLE_USER_ID };

beforeAll(() => {
  handle = createDb(testDatabaseUrl());
});
afterAll(async () => {
  await truncate();
  await handle.close();
});
beforeEach(truncate);

async function truncate() {
  await handle.sql`TRUNCATE semester, module, calendar_source, calendar_event, session, slide_deck,
    exercise_sheet, notebook CASCADE`;
}

const del = (kind: TrashKind, id: string) => handle.db.transaction((tx) => softDelete(tx, kind, id));
const restore = (id: string) => handle.db.transaction((tx) => restoreFromTrash(tx, id));

/** deleted_at als Text (Mikrosekunden-genau) je ID */
async function deletedAt(table: string, ids: string[]): Promise<Record<string, string | null>> {
  const rows =
    await handle.sql`SELECT id, deleted_at::text AS d FROM ${handle.sql(table)} WHERE id = ANY(${ids})`;
  return Object.fromEntries(rows.map((r) => [r.id as string, (r.d as string | null) ?? null]));
}

async function errorOf(promise: Promise<unknown>): Promise<HttpError> {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(HttpError);
  return error as HttpError;
}

/** Ein Semester mit einem vollständig gefüllten Modul */
async function seed() {
  const ids = {
    semester: uuidv7(),
    module: uuidv7(),
    deck: uuidv7(),
    slide: uuidv7(),
    sheet: uuidv7(),
    task: uuidv7(),
    session: uuidv7(),
    slideEvent: uuidv7(),
    marker: uuidv7(),
    photo: uuidv7(),
    recording: uuidv7(),
    chunk: uuidv7(),
    notebook: uuidv7(),
    vlNotebook: uuidv7(),
    page: uuidv7(),
    stroke: uuidv7(),
    element: uuidv7(),
    source: uuidv7(),
    event: uuidv7(),
    plannedSession: uuidv7(),
    eventStarted: uuidv7(),
    startedSession: uuidv7(),
  };
  const db = handle.db;
  await db.insert(semester).values({ id: ids.semester, ...base, name: 'HS 2026' });
  await db
    .insert(courseModule)
    .values({ id: ids.module, ...base, semesterId: ids.semester, name: 'DBS', color: 'mod-01' });
  await db.insert(slideDeck).values({
    id: ids.deck,
    ...base,
    moduleId: ids.module,
    title: 'VL 1',
    filePath: 'p',
    sha256: 'a'.repeat(64),
  });
  await db
    .insert(slide)
    .values({ id: ids.slide, ...base, deckId: ids.deck, index: 1, widthPt: 1, heightPt: 1 });
  await db.insert(exerciseSheet).values({
    id: ids.sheet,
    ...base,
    moduleId: ids.module,
    title: 'Blatt 1',
    filePath: 'p',
    sha256: 'b'.repeat(64),
  });
  await db.insert(task).values({ id: ids.task, ...base, sheetId: ids.sheet, label: '1a', pageIndex: 1 });
  await db.insert(session).values({
    id: ids.session,
    ...base,
    moduleId: ids.module,
    slideDeckId: ids.deck,
    state: 'beendet',
    title: 'VL 7',
  });
  await db.insert(slideEvent).values({
    id: ids.slideEvent,
    ...base,
    sessionId: ids.session,
    slideId: ids.slide,
    slideIndex: 1,
    tMs: 0,
    device: 'mac',
    source: 'manuell_mac',
  });
  await db
    .insert(marker)
    .values({ id: ids.marker, ...base, sessionId: ids.session, kind: 'frage', tMs: 10, source: 'ipad' });
  await db.insert(photo).values({
    id: ids.photo,
    ...base,
    sessionId: ids.session,
    tMs: 20,
    mime: 'image/jpeg',
    sha256: 'c'.repeat(64),
    sizeBytes: 10,
  });
  await db.insert(recording).values({
    id: ids.recording,
    ...base,
    sessionId: ids.session,
    mime: 'audio/webm',
    codec: 'opus',
    startedMs: 0,
  });
  await db.insert(audioChunk).values({
    id: ids.chunk,
    ...base,
    recordingId: ids.recording,
    seq: 0,
    startMs: 0,
    durationMs: 1000,
    filePath: 'p',
    sha256: 'd'.repeat(64),
    sizeBytes: 10,
  });
  await db.insert(notebook).values({ id: ids.notebook, ...base, moduleId: ids.module, title: 'Frei' });
  await db
    .insert(notebook)
    .values({ id: ids.vlNotebook, ...base, moduleId: ids.module, title: 'Vorlesung', kind: 'vorlesung' });
  // Seite mit session_id: gehört zum Notizbuch, nicht zur Session
  await db.insert(page).values({
    id: ids.page,
    ...base,
    notebookId: ids.notebook,
    sessionId: ids.session,
    index: 1,
    template: 'blanko',
    widthPt: 1,
    heightPt: 1,
  });
  await db.insert(stroke).values({
    id: ids.stroke,
    ...base,
    pageId: ids.page,
    clientId: uuidv7(),
    tool: 'pen',
    layer: 'ink',
    color: '#000000FF',
    width: 1,
    bbox: [0, 0, 1, 1],
    points: Buffer.alloc(24),
  });
  await db
    .insert(pageElement)
    .values({ id: ids.element, ...base, pageId: ids.page, kind: 'text', frame: [0, 0, 1, 1], payload: {} });
  // Kalender: ein nie gestarteter und ein gestarteter Termin derselben Quelle
  await db.insert(calendarSource).values({ id: ids.source, ...base, kind: 'ics_file', name: 'plan.ics' });
  const event = {
    ...base,
    sourceId: ids.source,
    moduleId: ids.module,
    kind: 'vorlesung',
    title: 'DBS',
    startsAt: new Date(),
    endsAt: new Date(),
  };
  await db.insert(calendarEvent).values({ id: ids.event, ...event, externalUid: 'a' });
  await db.insert(calendarEvent).values({ id: ids.eventStarted, ...event, externalUid: 'b' });
  await db.insert(session).values({
    id: ids.plannedSession,
    ...base,
    moduleId: ids.module,
    calendarEventId: ids.event,
    state: 'geplant',
  });
  await db.insert(session).values({
    id: ids.startedSession,
    ...base,
    moduleId: ids.module,
    calendarEventId: ids.eventStarted,
    state: 'verarbeitet',
  });
  return ids;
}

type Ids = Awaited<ReturnType<typeof seed>>;

/** Alle Zeilen der Modul-Kaskade außer dem Modul selbst */
function moduleParts(ids: Ids): [string, string[]][] {
  return [
    ['slide_deck', [ids.deck]],
    ['slide', [ids.slide]],
    ['exercise_sheet', [ids.sheet]],
    ['task', [ids.task]],
    ['session', [ids.session, ids.plannedSession, ids.startedSession]],
    ['slide_event', [ids.slideEvent]],
    ['marker', [ids.marker]],
    ['photo', [ids.photo]],
    ['recording', [ids.recording]],
    ['audio_chunk', [ids.chunk]],
    ['notebook', [ids.notebook, ids.vlNotebook]],
    ['page', [ids.page]],
    ['stroke', [ids.stroke]],
    ['page_element', [ids.element]],
  ];
}

describe('softDelete / restoreFromTrash', () => {
  it('Modul: alle Teile mit demselben deleted_at, Kalendertermine bleiben; Wiederherstellen holt genau diese zurück', async () => {
    const ids = await seed();
    // Ein vorher einzeln gelöschter Marker behält seinen eigenen Zeitstempel
    const earlier = uuidv7();
    await handle.db
      .insert(marker)
      .values({ id: earlier, ...base, sessionId: ids.session, kind: 'klausur', tMs: 1, source: 'mac' });
    await del('marker', earlier);
    const earlierTs = (await deletedAt('marker', [earlier]))[earlier];

    const ts = await del('module', ids.module);
    expect(ts).toBeInstanceOf(Date);
    const [moduleTs] = Object.values(await deletedAt('module', [ids.module]));
    expect(new Date(moduleTs!.replace(' ', 'T').replace(/\+00$/, 'Z')).getTime()).toBe(ts.getTime());
    let count = 0;
    for (const [table, rowIds] of moduleParts(ids)) {
      const got = await deletedAt(table, rowIds);
      for (const id of rowIds) expect(got[id], `${table} ${id}`).toBe(moduleTs);
      count += rowIds.length;
    }
    expect(Object.values(await deletedAt('calendar_event', [ids.event, ids.eventStarted]))).toEqual([
      null,
      null,
    ]);
    expect(Object.values(await deletedAt('semester', [ids.semester]))).toEqual([null]);
    expect((await deletedAt('marker', [earlier]))[earlier]).toBe(earlierTs);

    const result = await restore(ids.module);
    expect(result).toEqual({ id: ids.module, kind: 'module', restored_count: count + 1 });
    for (const [table, rowIds] of moduleParts(ids)) {
      const got = await deletedAt(table, rowIds);
      for (const id of rowIds) expect(got[id], `${table} ${id}`).toBeNull();
    }
    expect((await deletedAt('marker', [earlier]))[earlier]).toBe(earlierTs);
  });

  it('Semester: Module mit Kaskade; Modul allein nicht wiederherstellbar, solange das Semester gelöscht ist', async () => {
    const ids = await seed();
    await del('semester', ids.semester);
    const [semTs] = Object.values(await deletedAt('semester', [ids.semester]));
    expect(Object.values(await deletedAt('module', [ids.module]))).toEqual([semTs]);
    expect(Object.values(await deletedAt('stroke', [ids.stroke]))).toEqual([semTs]);

    const err = await errorOf(restore(ids.module));
    expect(err).toMatchObject({ statusCode: 409, code: 'restore_parent_deleted' });
    expect(err.details).toEqual({ parent: { id: ids.semester, kind: 'semester', title: 'HS 2026' } });

    const result = await restore(ids.semester);
    expect(result.kind).toBe('semester');
    expect(result.restored_count).toBe(2 + moduleParts(ids).reduce((n, [, r]) => n + r.length, 0));
    expect(Object.values(await deletedAt('stroke', [ids.stroke]))).toEqual([null]);
  });

  it('Kalenderquelle: Termine und nie gestartete Sessions, gestartete Sessions bleiben', async () => {
    const ids = await seed();
    await del('calendar_source', ids.source);
    const [ts] = Object.values(await deletedAt('calendar_source', [ids.source]));
    expect(await deletedAt('calendar_event', [ids.event, ids.eventStarted])).toEqual({
      [ids.event]: ts,
      [ids.eventStarted]: ts,
    });
    expect(await deletedAt('session', [ids.plannedSession, ids.startedSession])).toEqual({
      [ids.plannedSession]: ts,
      [ids.startedSession]: null,
    });
    expect(await restore(ids.source)).toEqual({ id: ids.source, kind: 'calendar_source', restored_count: 4 });
    expect(Object.values(await deletedAt('session', [ids.plannedSession]))).toEqual([null]);
  });

  it('Session: nur wenn nicht aktiv; nimmt Session-Daten mit, Seiten mit session_id bleiben', async () => {
    const ids = await seed();
    await handle.sql`UPDATE session SET state = 'pausiert' WHERE id = ${ids.session}`;
    expect(await errorOf(del('session', ids.session))).toMatchObject({
      statusCode: 409,
      code: 'session_active',
    });
    // Auch innerhalb der Modul-Kaskade: nichts wird gelöscht
    expect(await errorOf(del('module', ids.module))).toMatchObject({
      statusCode: 409,
      code: 'session_active',
    });
    expect(Object.values(await deletedAt('module', [ids.module]))).toEqual([null]);
    expect(Object.values(await deletedAt('slide_deck', [ids.deck]))).toEqual([null]);

    await handle.sql`UPDATE session SET state = 'beendet' WHERE id = ${ids.session}`;
    await del('session', ids.session);
    const [ts] = Object.values(await deletedAt('session', [ids.session]));
    for (const [table, id] of [
      ['slide_event', ids.slideEvent],
      ['marker', ids.marker],
      ['photo', ids.photo],
      ['recording', ids.recording],
      ['audio_chunk', ids.chunk],
    ] as const) {
      expect(Object.values(await deletedAt(table, [id])), table).toEqual([ts]);
    }
    expect(Object.values(await deletedAt('page', [ids.page]))).toEqual([null]);
    // Marker nicht wiederherstellbar, solange die Session gelöscht ist
    const err = await errorOf(restore(ids.marker));
    expect(err).toMatchObject({ code: 'restore_parent_deleted' });
    expect(err.details).toEqual({ parent: { id: ids.session, kind: 'session', title: 'VL 7' } });
    expect((await restore(ids.session)).restored_count).toBe(6);
  });

  it('Notizbuch: Standard-Notizbücher nicht einzeln; Seite mit Strichen und Elementen; Kind mit Eltern-Zeitstempel kommt mit', async () => {
    const ids = await seed();
    expect(await errorOf(del('notebook', ids.vlNotebook))).toMatchObject({
      statusCode: 409,
      code: 'notebook_default',
    });

    await del('page', ids.page);
    const [pageTs] = Object.values(await deletedAt('page', [ids.page]));
    expect(Object.values(await deletedAt('stroke', [ids.stroke]))).toEqual([pageTs]);
    expect(Object.values(await deletedAt('page_element', [ids.element]))).toEqual([pageTs]);

    // Ein Sync-Handler legt einen Strich auf der gelöschten Seite mit deren deleted_at an (VERTRAEGE §11.2)
    const [pageRow] = await handle.db
      .select({ deletedAt: page.deletedAt })
      .from(page)
      .where(eqId(page.id, ids.page));
    const parentTs = pageRow!.deletedAt;
    const late = uuidv7();
    await handle.db.insert(stroke).values({
      id: late,
      ...base,
      pageId: ids.page,
      clientId: uuidv7(),
      tool: 'marker',
      layer: 'highlight',
      color: '#FFFF00FF',
      width: 8,
      bbox: [0, 0, 1, 1],
      points: Buffer.alloc(24),
      deletedAt: parentTs,
    });

    await del('notebook', ids.notebook);
    const [nbTs] = Object.values(await deletedAt('notebook', [ids.notebook]));
    // Die schon gelöschte Seite behält ihren eigenen Zeitstempel
    expect(Object.values(await deletedAt('page', [ids.page]))).toEqual([pageTs]);
    expect(nbTs).not.toBe(pageTs);
    expect(await errorOf(restore(ids.page))).toMatchObject({ code: 'restore_parent_deleted' });

    expect(await restore(ids.notebook)).toEqual({ id: ids.notebook, kind: 'notebook', restored_count: 1 });
    expect(await restore(ids.page)).toEqual({ id: ids.page, kind: 'page', restored_count: 4 });
    expect(Object.values(await deletedAt('stroke', [late]))).toEqual([null]);
  });

  it('Foliensatz: Folien, Sessions mit slide_deck_id behalten den Verweis; Übungsblatt: Aufgaben', async () => {
    const ids = await seed();
    await del('slide_deck', ids.deck);
    const [ts] = Object.values(await deletedAt('slide_deck', [ids.deck]));
    expect(Object.values(await deletedAt('slide', [ids.slide]))).toEqual([ts]);
    expect(Object.values(await deletedAt('session', [ids.session]))).toEqual([null]);
    await del('exercise_sheet', ids.sheet);
    const [sheetTs] = Object.values(await deletedAt('exercise_sheet', [ids.sheet]));
    expect(Object.values(await deletedAt('task', [ids.task]))).toEqual([sheetTs]);
    await del('photo', ids.photo);
    expect(Object.values(await deletedAt('session', [ids.session]))).toEqual([null]);
    expect(await restore(ids.photo)).toEqual({ id: ids.photo, kind: 'photo', restored_count: 1 });
  });

  it('404: unbekannt oder schon gelöscht bzw. nicht im Papierkorb', async () => {
    const ids = await seed();
    expect(await errorOf(del('module', uuidv7()))).toMatchObject({
      statusCode: 404,
      code: 'module_not_found',
    });
    await del('marker', ids.marker);
    expect(await errorOf(del('marker', ids.marker))).toMatchObject({
      statusCode: 404,
      code: 'marker_not_found',
    });
    expect(await errorOf(restore(uuidv7()))).toMatchObject({ statusCode: 404, code: 'trash_item_not_found' });
    expect(await errorOf(restore(ids.module))).toMatchObject({
      statusCode: 404,
      code: 'trash_item_not_found',
    });
  });
});
