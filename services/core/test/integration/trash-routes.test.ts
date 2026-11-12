// T1-18: Papierkorb-Routen, Lösch-Routen mit Kaskade, Server-Operationen, endgültiges Löschen, Sperrreihenfolge
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SINGLE_USER_ID } from '@sg/shared';
import { stroke } from '../../src/db/schema/index.ts';
import { uuidv7 } from '../../src/lib/uuid7.ts';
import { appendOp } from '../../src/sync/append.ts';
import { purgeTrashItems, restoreWithOps, softDeleteWithOps } from '../../src/services/trash-ops.ts';
import { softDelete } from '../../src/services/trash.ts';
import { startTestApp, type TestApp } from './helpers.ts';

const API = '/api/v1';
const base = { user_id: SINGLE_USER_ID };

let t: TestApp;

beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => {
  await truncate();
  await t.close();
});
beforeEach(truncate);

async function truncate() {
  const sql = t.handle.sql;
  await sql`TRUNCATE semester, module, calendar_source, calendar_event, session, slide_deck, exercise_sheet,
    notebook, sync_stream, setting, backup_run, job CASCADE`;
}

interface Ids {
  semester: string;
  module: string;
  deck: string;
  slide: string;
  sheet: string;
  task: string;
  session: string;
  photo: string;
  recording: string;
  chunk: string;
  vlNotebook: string;
  notebook: string;
  page: string;
  stroke: string;
}

function dataFile(relative: string, content = 'x'): string {
  const full = join(t.config.dataDir, relative);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
  return full;
}

/** Semester mit einem Modul, das von allem etwas hat. Dateien liegen im Datenordner des Tests. */
async function seed(): Promise<Ids> {
  const s = t.handle.sql;
  const ids: Ids = {
    semester: uuidv7(),
    module: uuidv7(),
    deck: uuidv7(),
    slide: uuidv7(),
    sheet: uuidv7(),
    task: uuidv7(),
    session: uuidv7(),
    photo: uuidv7(),
    recording: uuidv7(),
    chunk: uuidv7(),
    vlNotebook: uuidv7(),
    notebook: uuidv7(),
    page: uuidv7(),
    stroke: uuidv7(),
  };
  await s`INSERT INTO semester ${s({ id: ids.semester, ...base, name: 'HS 2026', is_current: true })}`;
  await s`INSERT INTO module ${s({ id: ids.module, ...base, semester_id: ids.semester, name: 'DBS', color: 'mod-01' })}`;
  await s`INSERT INTO slide_deck ${s({
    id: ids.deck,
    ...base,
    module_id: ids.module,
    title: 'VL 1',
    file_path: `media/decks/${ids.deck}/original.pdf`,
    sha256: 'a'.repeat(64),
  })}`;
  await s`INSERT INTO slide ${s({
    id: ids.slide,
    ...base,
    deck_id: ids.deck,
    index: 1,
    width_pt: 1,
    height_pt: 1,
    image_path: `media/decks/${ids.deck}/slides/1.png`,
    thumb_path: `media/decks/${ids.deck}/thumbs/1.webp`,
  })}`;
  await s`INSERT INTO exercise_sheet ${s({
    id: ids.sheet,
    ...base,
    module_id: ids.module,
    title: 'Blatt 1',
    file_path: `media/sheets/${ids.sheet}/original.pdf`,
    sha256: 'b'.repeat(64),
  })}`;
  await s`INSERT INTO task ${s({ id: ids.task, ...base, sheet_id: ids.sheet, label: '1a', page_index: 1 })}`;
  await s`INSERT INTO session ${s({ id: ids.session, ...base, module_id: ids.module, state: 'beendet', title: 'VL 7' })}`;
  await s`INSERT INTO photo ${s({
    id: ids.photo,
    ...base,
    session_id: ids.session,
    t_ms: 5,
    mime: 'image/jpeg',
    sha256: 'c'.repeat(64),
    size_bytes: 1,
    file_path: `media/photos/${ids.photo}.jpg`,
  })}`;
  await s`INSERT INTO recording ${s({ id: ids.recording, ...base, session_id: ids.session, mime: 'audio/webm', codec: 'opus', started_ms: 0 })}`;
  await s`INSERT INTO audio_chunk ${s({
    id: ids.chunk,
    ...base,
    recording_id: ids.recording,
    seq: 0,
    start_ms: 0,
    duration_ms: 1000,
    file_path: `media/recordings/${ids.recording}/chunks/0.webm`,
    sha256: 'd'.repeat(64),
    size_bytes: 1,
  })}`;
  await s`INSERT INTO notebook ${s({ id: ids.vlNotebook, ...base, module_id: ids.module, title: 'Vorlesung', kind: 'vorlesung' })}`;
  await s`INSERT INTO notebook ${s({ id: ids.notebook, ...base, module_id: ids.module, title: 'Frei' })}`;
  await s`INSERT INTO page ${s({
    id: ids.page,
    ...base,
    notebook_id: ids.notebook,
    index: 1,
    template: 'blanko',
    width_pt: 1,
    height_pt: 1,
    pkdrawing_path: `media/pages/${ids.page}.pkdrawing`,
  })}`;
  await t.handle.db.insert(stroke).values({
    id: ids.stroke,
    userId: SINGLE_USER_ID,
    pageId: ids.page,
    clientId: uuidv7(),
    tool: 'pen',
    layer: 'ink',
    color: '#000000FF',
    width: 1,
    bbox: [0, 0, 1, 1],
    points: Buffer.alloc(24),
  });
  return ids;
}

function seedFiles(ids: Ids): string[] {
  return [
    dataFile(`media/decks/${ids.deck}/original.pdf`),
    dataFile(`media/decks/${ids.deck}/slides/1.png`),
    dataFile(`media/decks/${ids.deck}/thumbs/1.webp`),
    dataFile(`media/sheets/${ids.sheet}/original.pdf`),
    dataFile(`media/photos/${ids.photo}.jpg`),
    dataFile(`media/recordings/${ids.recording}/chunks/0.webm`),
    dataFile(`media/recordings/${ids.recording}/full.m4a`),
    dataFile(`media/pages/${ids.page}.pkdrawing`),
  ];
}

async function ops(stream: string): Promise<{ kind: string; origin: string; data: unknown }[]> {
  const rows = await t.handle
    .sql`SELECT kind, origin, data FROM sync_op WHERE stream = ${stream} ORDER BY seq`;
  return rows.map((r) => ({ kind: r.kind as string, origin: r.origin as string, data: r.data }));
}

async function count(table: string, id?: string): Promise<number> {
  const s = t.handle.sql;
  const [row] = id
    ? await s`SELECT count(*)::int AS n FROM ${s(table)} WHERE id = ${id}`
    : await s`SELECT count(*)::int AS n FROM ${s(table)}`;
  return row?.n as number;
}

const del = (url: string) => t.request({ method: 'DELETE', url: `${API}${url}` });
const post = (url: string) => t.request({ method: 'POST', url: `${API}${url}` });
const get = (url: string) => t.request({ method: 'GET', url: `${API}${url}` });

describe('Lösch-Routen mit Kaskade (Umstellung auf softDelete)', () => {
  it('DELETE /modules/:id: Kaskade mit gleichem Zeitstempel, Antwort 204 wie bisher, notebook.delete im Strom', async () => {
    const ids = await seed();
    const res = await del(`/modules/${ids.module}`);
    expect(res.statusCode).toBe(204);

    const rows = await t.handle.sql`SELECT
        (SELECT deleted_at::text FROM module WHERE id = ${ids.module}) AS m,
        (SELECT deleted_at::text FROM slide WHERE id = ${ids.slide}) AS slide,
        (SELECT deleted_at::text FROM task WHERE id = ${ids.task}) AS task,
        (SELECT deleted_at::text FROM page WHERE id = ${ids.page}) AS page,
        (SELECT deleted_at::text FROM audio_chunk WHERE id = ${ids.chunk}) AS chunk`;
    const [r] = rows;
    expect(r?.m).not.toBeNull();
    for (const key of ['slide', 'task', 'page', 'chunk']) expect(r?.[key], key).toBe(r?.m);
    expect((await get(`/modules/${ids.module}`)).statusCode).toBe(404);
    expect((await del(`/modules/${ids.module}`)).statusCode).toBe(404);

    // Beide Standard- und das freie Notizbuch bekommen notebook.delete
    for (const nb of [ids.vlNotebook, ids.notebook]) {
      expect(await ops(`notebook:${nb}`)).toEqual([
        { kind: 'notebook.delete', origin: 'server', data: { notebook_id: nb } },
      ]);
    }
  });

  it('409 session_active (Modul und Semester): nichts wird gelöscht, kein Strom-Eintrag', async () => {
    const ids = await seed();
    await t.handle.sql`UPDATE session SET state = 'laeuft' WHERE id = ${ids.session}`;
    for (const url of [`/modules/${ids.module}`, `/semesters/${ids.semester}`]) {
      const res = await del(url);
      expect(res.statusCode).toBe(409);
      const body = res.json<{ error: { code: string; details: { session_ids: string[] } } }>();
      expect(body.error.code).toBe('session_active');
      expect(body.error.details.session_ids).toEqual([ids.session]);
    }
    const [row] = await t.handle.sql`SELECT
        (SELECT deleted_at FROM module WHERE id = ${ids.module}) AS m,
        (SELECT deleted_at FROM semester WHERE id = ${ids.semester}) AS s`;
    expect(row).toEqual({ m: null, s: null });
    expect(await count('sync_op')).toBe(0);
  });

  it('DELETE /semesters/:id: Module und alles darunter, 404 danach, Wiederherstellen holt es zurück', async () => {
    const ids = await seed();
    expect((await del(`/semesters/${ids.semester}`)).statusCode).toBe(204);
    expect((await get(`/semesters/${ids.semester}`)).statusCode).toBe(404);
    expect((await del(`/semesters/${ids.semester}`)).statusCode).toBe(404);
    expect((await get(`/modules/${ids.module}`)).statusCode).toBe(404);

    const list = (await get('/trash')).json<{
      items: { id: string; kind: string; dependent_count: number }[];
    }>();
    expect(list.items.map((i) => [i.kind, i.id])).toEqual([['semester', ids.semester]]);
    expect(list.items[0]?.dependent_count).toBeGreaterThan(10);

    const restored = await post(`/trash/${ids.semester}/restore`);
    expect(restored.statusCode).toBe(200);
    expect(restored.json<{ kind: string }>().kind).toBe('semester');
    expect((await get(`/modules/${ids.module}`)).statusCode).toBe(200);
    // notebook.restore für beide Notizbücher
    for (const nb of [ids.vlNotebook, ids.notebook]) {
      expect((await ops(`notebook:${nb}`)).map((o) => o.kind)).toEqual([
        'notebook.delete',
        'notebook.restore',
      ]);
    }
  });

  it('Foliensatz und Übungsblatt: Folien und Aufgaben werden mitgelöscht und kommen zurück', async () => {
    const ids = await seed();
    expect((await del(`/slide-decks/${ids.deck}`)).statusCode).toBe(204);
    expect((await del(`/exercise-sheets/${ids.sheet}`)).statusCode).toBe(204);
    const [gone] = await t.handle.sql`SELECT
        (SELECT deleted_at IS NOT NULL FROM slide WHERE id = ${ids.slide}) AS slide,
        (SELECT deleted_at IS NOT NULL FROM task WHERE id = ${ids.task}) AS task`;
    expect(gone).toEqual({ slide: true, task: true });
    expect((await del(`/slide-decks/${ids.deck}`)).statusCode).toBe(404);

    const list = (await get('/trash')).json<{
      items: { kind: string; title: string; dependent_count: number }[];
    }>();
    expect(list.items.map((i) => [i.kind, i.dependent_count]).sort()).toEqual([
      ['exercise_sheet', 1],
      ['slide_deck', 1],
    ]);
    expect((await post(`/trash/${ids.deck}/restore`)).statusCode).toBe(200);
    expect((await post(`/trash/${ids.sheet}/restore`)).statusCode).toBe(200);
    const [back] = await t.handle.sql`SELECT
        (SELECT deleted_at IS NULL FROM slide WHERE id = ${ids.slide}) AS slide,
        (SELECT deleted_at IS NULL FROM task WHERE id = ${ids.task}) AS task`;
    expect(back).toEqual({ slide: true, task: true });
  });
});

describe('GET /trash', () => {
  it('zeigt nur direkt gelöschte Objekte, mit Eltern, Aufbewahrung und Filter nach Art', async () => {
    const ids = await seed();
    // Foliensatz zuerst einzeln, dann das ganze Modul: beide sind direkt (anderer Zeitstempel)
    await del(`/slide-decks/${ids.deck}`);
    await new Promise((r) => setTimeout(r, 5));
    await del(`/modules/${ids.module}`);

    const all = (await get('/trash')).json<{
      items: {
        id: string;
        kind: string;
        title: string;
        deleted_at: string;
        purge_at: string;
        parent: { id: string; kind: string; title: string } | null;
        dependent_count: number;
      }[];
      next_cursor: string | null;
    }>();
    expect(all.items.map((i) => i.kind)).toEqual(['module', 'slide_deck']);
    const [mod, deck] = all.items;
    expect(mod?.title).toBe('DBS');
    expect(mod?.parent).toEqual({ id: ids.semester, kind: 'semester', title: 'HS 2026' });
    expect(deck?.parent).toEqual({ id: ids.module, kind: 'module', title: 'DBS' });
    expect(deck?.dependent_count).toBe(1);
    // 30 Tage Aufbewahrung
    expect(new Date(mod!.purge_at).getTime() - new Date(mod!.deleted_at).getTime()).toBe(30 * 86_400_000);
    // Der Modul-Eintrag zählt alles außer dem früher gelöschten Foliensatz samt Folie
    expect(mod?.dependent_count).toBeGreaterThanOrEqual(10);

    const onlyDecks = (await get('/trash?kind=slide_deck')).json<{ items: { id: string }[] }>();
    expect(onlyDecks.items.map((i) => i.id)).toEqual([ids.deck]);
    expect((await get('/trash?kind=unsinn')).statusCode).toBe(400);
  });

  it('Seiten über Cursor: stabil und ohne Doppelte', async () => {
    const ids = await seed();
    for (let i = 0; i < 5; i += 1) {
      const id = uuidv7();
      await t.handle
        .sql`INSERT INTO marker ${t.handle.sql({ id, ...base, session_id: ids.session, kind: 'frage', t_ms: i, source: 'mac' })}`;
      await t.handle.sql`UPDATE marker SET deleted_at = now() + ${i} * interval '1 second' WHERE id = ${id}`;
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard += 1) {
      const url: string = `/trash?limit=2${cursor ? `&cursor=${cursor}` : ''}`;
      const res = (await get(url)).json<{ items: { id: string }[]; next_cursor: string | null }>();
      seen.push(...res.items.map((i) => i.id));
      cursor = res.next_cursor;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect((await get('/trash?cursor=kaputt')).statusCode).toBe(400);
  });

  it('Sessions, die mit ihrer Kalenderquelle gelöscht wurden, stehen nicht einzeln darin (Entscheidung §13)', async () => {
    const ids = await seed();
    const s = t.handle.sql;
    const source = uuidv7();
    const event = uuidv7();
    const planned = uuidv7();
    await s`INSERT INTO calendar_source ${s({ id: source, ...base, kind: 'ics_file', name: 'plan.ics' })}`;
    await s`INSERT INTO calendar_event ${s({ id: event, ...base, source_id: source, module_id: ids.module, kind: 'vorlesung', title: 'DBS', starts_at: new Date().toISOString(), ends_at: new Date().toISOString(), external_uid: 'a' })}`;
    await s`INSERT INTO session ${s({ id: planned, ...base, module_id: ids.module, calendar_event_id: event, state: 'geplant' })}`;
    await t.handle.db.transaction((tx) => softDelete(tx, 'calendar_source', source));

    const list = (await get('/trash')).json<{ items: { id: string; kind: string }[] }>();
    expect(list.items.map((i) => [i.kind, i.id])).toEqual([['calendar_source', source]]);

    // Direktes Wiederherstellen der Session: sie kommt nur über die Quelle zurück
    const direct = await post(`/trash/${planned}/restore`);
    expect(direct.statusCode).toBe(409);
    const body = direct.json<{
      error: { code: string; details: { parent: { id: string; kind: string } } };
    }>();
    expect(body.error.code).toBe('restore_parent_deleted');
    expect(body.error.details.parent).toMatchObject({ id: source, kind: 'calendar_source' });
    // Auch nicht einzeln endgültig löschbar
    expect((await del(`/trash/${planned}`)).statusCode).toBe(404);

    expect((await post(`/trash/${source}/restore`)).statusCode).toBe(200);
    const [back] = await s`SELECT deleted_at FROM session WHERE id = ${planned}`;
    expect(back?.deleted_at).toBeNull();
  });
});

describe('POST /trash/:id/restore', () => {
  it('404 trash_item_not_found für Unbekanntes und Aktives, 400 für ungültige ID', async () => {
    const ids = await seed();
    const unknown = await post(`/trash/${uuidv7()}/restore`);
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json<{ error: { code: string } }>().error.code).toBe('trash_item_not_found');
    expect((await post(`/trash/${ids.module}/restore`)).statusCode).toBe(404);
    expect((await post('/trash/abc/restore')).statusCode).toBe(400);
  });

  it('409 restore_parent_deleted mit details.parent', async () => {
    const ids = await seed();
    await del(`/slide-decks/${ids.deck}`);
    await del(`/modules/${ids.module}`);
    const res = await post(`/trash/${ids.deck}/restore`);
    expect(res.statusCode).toBe(409);
    const body = res.json<{ error: { code: string; details: { parent: unknown } } }>();
    expect(body.error.code).toBe('restore_parent_deleted');
    expect(body.error.details.parent).toEqual({ id: ids.module, kind: 'module', title: 'DBS' });
    expect(await count('slide_deck', ids.deck)).toBe(1);
  });

  it('409 restore_parent_deleted einer Seite nennt Modul und Notizbuch (UX-55)', async () => {
    const ids = await seed();
    await t.handle.db.transaction((tx) => softDelete(tx, 'page', ids.page));
    await del(`/notebooks/${ids.notebook}`);
    const res = await post(`/trash/${ids.page}/restore`);
    expect(res.statusCode).toBe(409);
    const body = res.json<{ error: { details: { parent: unknown } } }>();
    expect(body.error.details.parent).toEqual({ id: ids.notebook, kind: 'notebook', title: 'DBS · Frei' });
  });

  it('409 restore_conflict mit constraint und conflicting_id; nichts wird wiederhergestellt', async () => {
    const ids = await seed();
    // Ein Termin mit Session; Session gelöscht, am Termin entsteht eine neue
    const s = t.handle.sql;
    const event = uuidv7();
    const old = uuidv7();
    await s`INSERT INTO calendar_event ${s({ id: event, ...base, module_id: ids.module, kind: 'vorlesung', title: 'DBS', starts_at: new Date().toISOString(), ends_at: new Date().toISOString() })}`;
    await s`INSERT INTO session ${s({ id: old, ...base, module_id: ids.module, calendar_event_id: event, state: 'beendet' })}`;
    await softDeleteWithOps(t.handle.db, 'session', old);
    const fresh = uuidv7();
    await s`INSERT INTO session ${s({ id: fresh, ...base, module_id: ids.module, calendar_event_id: event, state: 'geplant' })}`;

    const res = await post(`/trash/${old}/restore`);
    expect(res.statusCode).toBe(409);
    const body = res.json<{
      error: { code: string; details: { constraint: string; conflicting_id: string } };
    }>();
    expect(body.error.code).toBe('restore_conflict');
    expect(body.error.details).toEqual({ constraint: 'session_event_uq', conflicting_id: fresh });
    const [row] = await s`SELECT deleted_at FROM session WHERE id = ${old}`;
    expect(row?.deleted_at).not.toBeNull();
  });

  it('Seite: page.restore im Notizbuch-Strom, Striche kommen mit; zweites Wiederherstellen ist 404', async () => {
    const ids = await seed();
    await t.handle.db.transaction((tx) => softDelete(tx, 'page', ids.page));
    const list = (await get('/trash')).json<{
      items: { kind: string; title: string; parent: { kind: string; title: string } | null }[];
    }>();
    // UX-55: Das Elternobjekt nennt das Modul, damit man die Seite im Papierkorb wiederfindet
    expect(list.items).toMatchObject([
      { kind: 'page', title: 'Seite 1', parent: { kind: 'notebook', title: 'DBS · Frei' } },
    ]);

    const res = await post(`/trash/${ids.page}/restore`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: ids.page, kind: 'page', restored_count: 2 });
    expect(await ops(`notebook:${ids.notebook}`)).toEqual([
      { kind: 'page.restore', origin: 'server', data: { page_id: ids.page } },
    ]);
    expect((await post(`/trash/${ids.page}/restore`)).statusCode).toBe(404);
  });

  it('Notizbuch: notebook.restore im eigenen Strom (zusätzlich zu notebook.delete aus DELETE /notebooks)', async () => {
    const ids = await seed();
    expect((await del(`/notebooks/${ids.notebook}`)).statusCode).toBe(204);
    expect((await post(`/trash/${ids.notebook}/restore`)).statusCode).toBe(200);
    expect((await ops(`notebook:${ids.notebook}`)).map((o) => o.kind)).toEqual([
      'notebook.delete',
      'notebook.restore',
    ]);
  });

  it('Semester: kommt ohne is_current zurück, wenn inzwischen ein anderes aktuell ist', async () => {
    const ids = await seed();
    await del(`/semesters/${ids.semester}`);
    const other = uuidv7();
    await t.handle
      .sql`INSERT INTO semester ${t.handle.sql({ id: other, ...base, name: 'FS 2027', is_current: true })}`;
    expect((await post(`/trash/${ids.semester}/restore`)).statusCode).toBe(200);
    const [row] = await t.handle.sql`SELECT is_current FROM semester WHERE id = ${ids.semester}`;
    expect(row?.is_current).toBe(false);
  });
});

describe('endgültig löschen', () => {
  it('DELETE /trash/:id: Zeilen, Ströme und alle Dateien des Moduls sind weg; Fremdes bleibt', async () => {
    const ids = await seed();
    const files = seedFiles(ids);
    const outside = join(mkdtempSync(join(tmpdir(), 'sg-outside-')), 'wichtig.txt');
    writeFileSync(outside, 'bleibt');
    // Manipulierter Pfad in der DB darf nichts außerhalb des Datenordners löschen
    await t.handle.sql`UPDATE photo SET file_path = ${outside} WHERE id = ${ids.photo}`;
    await t.handle.sql`UPDATE slide SET image_path = '../../../etc/passwd' WHERE id = ${ids.slide}`;
    // Strom mit Operationen
    await t.handle.db.transaction((tx) =>
      appendOp(tx, `notebook:${ids.notebook}`, {
        kind: 'notebook.update',
        data: { notebook_id: ids.notebook, fields: { title: 'x', module_id: ids.module } },
        at: 1,
        clockUncertain: false,
        origin: 'server',
      }),
    );
    const bystander = join(t.config.dataDir, 'media', 'photos', `${uuidv7()}.jpg`);
    writeFileSync(bystander, 'fremd');

    // Noch aktiv: nicht im Papierkorb
    expect((await del(`/trash/${ids.module}`)).statusCode).toBe(404);
    await del(`/modules/${ids.module}`);
    const res = await del(`/trash/${ids.module}`);
    expect(res.statusCode).toBe(204);

    for (const table of [
      'module',
      'slide_deck',
      'slide',
      'exercise_sheet',
      'task',
      'session',
      'photo',
      'recording',
      'audio_chunk',
      'notebook',
      'page',
      'stroke',
    ]) {
      expect(await count(table), table).toBe(0);
    }
    expect(await count('semester')).toBe(1);
    expect(await count('sync_op')).toBe(0);
    expect(await count('sync_stream')).toBe(0);
    for (const file of files) expect(existsSync(file), file).toBe(false);
    expect(existsSync(join(t.config.dataDir, 'media', 'decks', ids.deck))).toBe(false);
    expect(existsSync(outside)).toBe(true);
    expect(existsSync(bystander)).toBe(true);
    expect((await del(`/trash/${ids.module}`)).statusCode).toBe(404);
  });

  it('Eltern-Kind-Zeitstempel: ein Kind im Papierkorb eines gelöschten Elternteils ist nicht einzeln löschbar', async () => {
    const ids = await seed();
    await del(`/modules/${ids.module}`);
    expect((await del(`/trash/${ids.deck}`)).statusCode).toBe(404);
    expect(await count('slide_deck', ids.deck)).toBe(1);
  });

  it('einzelnes Foto: Zeile und Datei, Session bleibt', async () => {
    const ids = await seed();
    const files = seedFiles(ids);
    await t.handle.db.transaction((tx) => softDelete(tx, 'photo', ids.photo));
    expect((await del(`/trash/${ids.photo}`)).statusCode).toBe(204);
    expect(await count('photo')).toBe(0);
    expect(await count('session', ids.session)).toBe(1);
    expect(existsSync(files[4] as string)).toBe(false);
    expect(existsSync(files[5] as string)).toBe(true);
  });

  it('DELETE /trash leert alles (optional nach Art) und zählt die direkten Objekte', async () => {
    const ids = await seed();
    seedFiles(ids);
    await del(`/slide-decks/${ids.deck}`);
    await del(`/exercise-sheets/${ids.sheet}`);
    await del(`/modules/${ids.module}`);

    const some = await del('/trash?kind=slide_deck');
    expect(some.statusCode).toBe(200);
    expect(some.json()).toEqual({ purged_count: 1 });
    expect(await count('slide_deck')).toBe(0);
    expect(await count('exercise_sheet')).toBe(1);

    const rest = await del('/trash');
    expect(rest.json()).toEqual({ purged_count: 2 });
    expect(await count('module')).toBe(0);
    expect(await count('exercise_sheet')).toBe(0);
    expect((await get('/trash')).json()).toEqual({ items: [], next_cursor: null });
    expect(await del('/trash').then((r) => r.json())).toEqual({ purged_count: 0 });
  });
});

describe('Sperrreihenfolge: Strom vor Zeile (§16.2)', () => {
  /** Hält den Strom des Notizbuchs wie ein Op-Handler und fordert danach die Zeile an */
  async function handlerHoldingStream(notebookId: string, pageId: string, release: Promise<void>) {
    await t.handle.db.transaction(async (tx) => {
      await appendOp(tx, `notebook:${notebookId}`, {
        kind: 'notebook.update',
        data: { notebook_id: notebookId, fields: { title: 'Handler', module_id: null } },
        at: 1,
        clockUncertain: false,
        origin: 'server',
      });
      await release;
      // Erst jetzt die Zeilen: Würde das Löschen zuerst die Zeilen sperren, entstünde hier ein Deadlock
      await tx.execute(sql`SELECT id FROM page WHERE id = ${pageId} FOR UPDATE`);
    });
  }

  it('Modul löschen wartet auf den Strom, statt die Zeilen zuerst zu sperren (kein Deadlock)', async () => {
    const ids = await seed();
    let releaseHandler!: () => void;
    const gate = new Promise<void>((resolve) => (releaseHandler = resolve));
    const handler = handlerHoldingStream(ids.notebook, ids.page, gate);
    await new Promise((r) => setTimeout(r, 150));
    const deleting = softDeleteWithOps(t.handle.db, 'module', ids.module);
    await new Promise((r) => setTimeout(r, 300));
    releaseHandler();
    await Promise.all([handler, deleting]);
    const [row] = await t.handle.sql`SELECT deleted_at FROM module WHERE id = ${ids.module}`;
    expect(row?.deleted_at).not.toBeNull();
  });

  it('Wiederherstellen eines Moduls wartet ebenfalls auf den Strom (kein Deadlock)', async () => {
    const ids = await seed();
    await softDeleteWithOps(t.handle.db, 'module', ids.module);
    let releaseHandler!: () => void;
    const gate = new Promise<void>((resolve) => (releaseHandler = resolve));
    const handler = handlerHoldingStream(ids.notebook, ids.page, gate);
    await new Promise((r) => setTimeout(r, 150));
    const restoring = restoreWithOps(t.handle.db, ids.module);
    await new Promise((r) => setTimeout(r, 300));
    releaseHandler();
    const [, result] = await Promise.all([handler, restoring]);
    expect(result.kind).toBe('module');
  });

  it('Endgültiges Löschen wartet auf den Strom (kein Deadlock)', async () => {
    const ids = await seed();
    await softDeleteWithOps(t.handle.db, 'module', ids.module);
    let releaseHandler!: () => void;
    const gate = new Promise<void>((resolve) => (releaseHandler = resolve));
    const handler = handlerHoldingStream(ids.notebook, ids.page, gate);
    await new Promise((r) => setTimeout(r, 150));
    const purging = del(`/trash/${ids.module}`);
    await new Promise((r) => setTimeout(r, 300));
    releaseHandler();
    const [, res] = await Promise.all([handler, purging]);
    expect(res.statusCode).toBe(204);
    expect(await count('module')).toBe(0);
  });
});

describe('Review-Nacharbeit (Race, Prüfungen)', () => {
  it('purgeTrashItems prüft die Wurzel unter der Sperre: eine wiederhergestellte (aktive) Wurzel wird nie gelöscht', async () => {
    const ids = await seed();
    const files = seedFiles(ids);
    await softDeleteWithOps(t.handle.db, 'module', ids.module);
    await restoreWithOps(t.handle.db, ids.module);
    await expect(
      purgeTrashItems(t.handle.db, t.config.dataDir, [{ kind: 'module', id: ids.module }]),
    ).rejects.toMatchObject({ code: 'trash_item_not_found' });
    expect(await count('module', ids.module)).toBe(1);
    expect(await count('notebook')).toBe(2);
    for (const f of files) expect(existsSync(f), f).toBe(true);
  });

  it('Notizbuch, das gleichzeitig angelegt wird, wird mitgelöscht und bekommt notebook.delete', async () => {
    const ids = await seed();
    const late = uuidv7();
    let commitLate!: () => void;
    const gate = new Promise<void>((resolve) => (commitLate = resolve));
    // Wie notebook.create: Modul FOR KEY SHARE (FK), Notizbuch eingefügt, noch nicht committet
    const creating = t.handle.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM module WHERE id = ${ids.module} FOR SHARE`);
      await tx.execute(
        sql`INSERT INTO notebook (id, user_id, module_id, title) VALUES (${late}, ${SINGLE_USER_ID}, ${ids.module}, 'Spät')`,
      );
      await gate;
    });
    await new Promise((r) => setTimeout(r, 150));
    const deleting = softDeleteWithOps(t.handle.db, 'module', ids.module);
    await new Promise((r) => setTimeout(r, 300));
    commitLate();
    await Promise.all([creating, deleting]);
    const [row] = await t.handle.sql`SELECT deleted_at IS NOT NULL AS gone FROM notebook WHERE id = ${late}`;
    expect(row?.gone).toBe(true);
    expect((await ops(`notebook:${late}`)).map((o) => o.kind)).toEqual(['notebook.delete']);
  });

  it('DELETE /trash: aktive Session im Papierkorb gibt 409, bevor irgendetwas gelöscht wird', async () => {
    const ids = await seed();
    const other = uuidv7();
    await t.handle
      .sql`INSERT INTO exercise_sheet ${t.handle.sql({ id: other, ...base, module_id: ids.module, title: 'Z', file_path: 'p', sha256: 'e'.repeat(64) })}`;
    await del(`/exercise-sheets/${other}`);
    await del(`/modules/${ids.module}`);
    await t.handle.sql`UPDATE session SET state = 'laeuft' WHERE id = ${ids.session}`;
    const res = await del('/trash');
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('session_active');
    expect(await count('exercise_sheet', other)).toBe(1);
    expect(await count('module', ids.module)).toBe(1);
  });

  it('Dateien außerhalb von media/ werden nie gelöscht, auch nicht über einen DB-Pfad', async () => {
    const ids = await seed();
    const secret = dataFile('config/.env', 'GEHEIM');
    await t.handle.sql`UPDATE photo SET file_path = 'config/.env' WHERE id = ${ids.photo}`;
    await t.handle.sql`UPDATE slide SET image_path = 'media' WHERE id = ${ids.slide}`;
    seedFiles(ids);
    await del(`/modules/${ids.module}`);
    expect((await del(`/trash/${ids.module}`)).statusCode).toBe(204);
    expect(existsSync(secret)).toBe(true);
    expect(existsSync(join(t.config.dataDir, 'media'))).toBe(true);
  });
});
