// REST §7.4: Notizbücher, Seiten, Striche, pkdrawing, Fotos, Standard-Notizbücher beim Anlegen eines Moduls
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ApiErrorSchema,
  FileReceiptSchema,
  NotebookListSchema,
  NotebookPagesSchema,
  NotebookSchema,
  PageDetailSchema,
  PageStrokesSchema,
  PhotoSchema,
  type Module,
  type Notebook,
  type Semester,
  type Stroke,
} from '@sg/shared';
import { notebook, page } from '../../src/db/schema/index.ts';
import { uuidv7 } from '../../src/lib/uuid7.ts';
import { appendOp } from '../../src/sync/append.ts';
import { startTestApp, type TestApp } from './helpers.ts';
import {
  loadStrokeFixtures,
  makeOp,
  nbStream,
  pageCreateData,
  runHandler,
  seedModule,
  seedSession,
  type Seed,
} from './ink-helpers.ts';

const API = '/api/v1';
let t: TestApp;
let seed: Seed;

beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => {
  await truncate();
  await t.handle.sql`TRUNCATE idempotency_key`;
  await t.close();
});
beforeEach(async () => {
  await truncate();
  rmSync(join(t.config.dataDir, 'media'), { recursive: true, force: true });
  seed = await seedModule(t.handle.db);
});

async function truncate() {
  await t.handle.sql`TRUNCATE semester, module, notebook, session, photo, sync_stream, sync_op CASCADE`;
}

const json = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
  t.request({ method, url: `${API}${url}`, ...(payload ? { payload } : {}) });

async function errorOf(res: { statusCode: number; json: () => unknown }, status: number) {
  expect(res.statusCode).toBe(status);
  return ApiErrorSchema.parse(res.json()).error;
}

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

async function createNotebook(body: Record<string, unknown> = {}): Promise<Notebook> {
  const res = await json('POST', '/notebooks', { module_id: seed.moduleId, title: 'Skizzen', ...body });
  expect(res.statusCode, res.body).toBe(201);
  return NotebookSchema.parse(res.json());
}

const ops = (stream: string) =>
  t.handle.sql`SELECT seq, kind, origin, data FROM sync_op WHERE stream = ${stream} ORDER BY seq`;

describe('Standard-Notizbücher beim Anlegen eines Moduls', () => {
  it('POST /modules legt „Vorlesung“ und „Übung“ an', async () => {
    const sem = (await json('POST', '/semesters', { name: 'HS 2026' })).json() as Semester;
    const res = await json('POST', '/modules', { semester_id: sem.id, name: 'Statistik' });
    expect(res.statusCode, res.body).toBe(201);
    const mod = res.json() as Module;

    // Direkt in der DB: createModule legt sie an, nicht erst der erste GET
    const rows = await t.handle.db.select().from(notebook).where(eq(notebook.moduleId, mod.id));
    expect(rows.map((r) => [r.kind, r.title]).sort()).toEqual([
      ['uebung', 'Übung'],
      ['vorlesung', 'Vorlesung'],
    ]);

    const list = NotebookListSchema.parse((await json('GET', `/notebooks?module_id=${mod.id}`)).json());
    expect(list.items.map((n) => [n.kind, n.title, n.page_count])).toEqual([
      ['vorlesung', 'Vorlesung', 0],
      ['uebung', 'Übung', 0],
    ]);
  });

  it('GET /notebooks?module_id trägt sie für ältere Module nach, idempotent auch bei gleichzeitigen Aufrufen', async () => {
    const urls = Array.from({ length: 4 }, () => `/notebooks?module_id=${seed.moduleId}`);
    const results = await Promise.all(urls.map((url) => json('GET', url)));
    for (const r of results) expect(r.statusCode, r.body).toBe(200);
    const rows = await t.handle.db.select().from(notebook).where(eq(notebook.moduleId, seed.moduleId));
    expect(rows.map((r) => r.kind).sort()).toEqual(['uebung', 'vorlesung']);
  });

  it('unbekanntes oder gelöschtes Modul: leere Liste, keine neuen Notizbücher', async () => {
    const res = await json('GET', `/notebooks?module_id=${uuidv7()}`);
    expect(NotebookListSchema.parse(res.json()).items).toEqual([]);
    await t.handle.sql`UPDATE module SET deleted_at = now() WHERE id = ${seed.moduleId}`;
    await json('GET', `/notebooks?module_id=${seed.moduleId}`);
    expect(await t.handle.db.select().from(notebook)).toHaveLength(0);
  });

  it('GET /notebooks ohne module_id blendet Notizbücher gelöschter Module aus', async () => {
    const nb = await createNotebook();
    expect(NotebookListSchema.parse((await json('GET', '/notebooks')).json()).items.map((n) => n.id)).toEqual(
      [nb.id],
    );
    await t.handle.sql`UPDATE module SET deleted_at = now() WHERE id = ${seed.moduleId}`;
    expect(NotebookListSchema.parse((await json('GET', '/notebooks')).json()).items).toEqual([]);
    expect((await json('GET', `/notebooks/${nb.id}`)).statusCode).toBe(404);
    expect((await json('GET', `/notebooks/${nb.id}/pages`)).statusCode).toBe(404);
  });

  it('Liste ist paginiert und stabil sortiert', async () => {
    await json('GET', `/notebooks?module_id=${seed.moduleId}`);
    await createNotebook({ title: 'Frei 1' });
    const first = NotebookListSchema.parse((await json('GET', '/notebooks?limit=2')).json());
    expect(first.items.map((n) => n.title)).toEqual(['Vorlesung', 'Übung']);
    expect(first.next_cursor).not.toBeNull();
    const second = NotebookListSchema.parse(
      (await json('GET', `/notebooks?limit=2&cursor=${first.next_cursor}`)).json(),
    );
    expect(second.items.map((n) => n.title)).toEqual(['Frei 1']);
    expect(second.next_cursor).toBeNull();
  });
});

describe('POST /notebooks', () => {
  it('legt ein freies Notizbuch an (kind fehlt = frei)', async () => {
    const nb = await createNotebook();
    expect(nb).toMatchObject({ kind: 'frei', title: 'Skizzen', module_id: seed.moduleId, page_count: 0 });
  });

  it('übernimmt eine vom Client vergebene id; doppelte id: 409 notebook_exists', async () => {
    const id = uuidv7();
    expect((await createNotebook({ id })).id).toBe(id);
    const error = await errorOf(
      await json('POST', '/notebooks', { id, module_id: seed.moduleId, title: 'Noch eins' }),
      409,
    );
    expect(error.code).toBe('notebook_exists');
  });

  it('zweites vorlesung/uebung im Modul: 409 notebook_kind_exists', async () => {
    await json('GET', `/notebooks?module_id=${seed.moduleId}`);
    for (const kind of ['vorlesung', 'uebung']) {
      const res = await json('POST', '/notebooks', { module_id: seed.moduleId, title: 'Doppelt', kind });
      expect((await errorOf(res, 409)).code).toBe('notebook_kind_exists');
    }
  });

  it('unbekanntes Modul: 404 module_not_found; leerer Titel: 400', async () => {
    const res = await json('POST', '/notebooks', { module_id: uuidv7(), title: 'X' });
    expect((await errorOf(res, 404)).code).toBe('module_not_found');
    const blank = await json('POST', '/notebooks', { module_id: seed.moduleId, title: '   ' });
    expect((await errorOf(blank, 400)).code).toBe('validation_failed');
    const invalid = await json('POST', '/notebooks', { module_id: 'nope', title: 'X' });
    expect((await errorOf(invalid, 400)).code).toBe('validation_failed');
  });
});

describe('PATCH und DELETE /notebooks/{id}', () => {
  it('PATCH benennt um und schreibt notebook.update (origin server) mit vollem Stand', async () => {
    const nb = await createNotebook();
    const res = await json('PATCH', `/notebooks/${nb.id}`, { title: 'Neu' });
    expect(res.statusCode, res.body).toBe(200);
    expect(NotebookSchema.parse(res.json()).title).toBe('Neu');
    const written = await ops(nbStream(nb.id));
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      seq: '1',
      kind: 'notebook.update',
      origin: 'server',
      data: { notebook_id: nb.id, fields: { title: 'Neu', module_id: seed.moduleId } },
    });
  });

  it('PATCH ohne Änderung schreibt keine Operation', async () => {
    const nb = await createNotebook();
    await json('PATCH', `/notebooks/${nb.id}`, {});
    await json('PATCH', `/notebooks/${nb.id}`, { title: 'Skizzen' });
    expect(await ops(nbStream(nb.id))).toHaveLength(0);
  });

  it('PATCH verschiebt ein freies Notizbuch in ein anderes Modul', async () => {
    const other = await seedModule(t.handle.db);
    const nb = await createNotebook();
    const res = await json('PATCH', `/notebooks/${nb.id}`, { module_id: other.moduleId });
    expect(NotebookSchema.parse(res.json()).module_id).toBe(other.moduleId);
    const bad = await json('PATCH', `/notebooks/${nb.id}`, { module_id: uuidv7() });
    expect((await errorOf(bad, 404)).code).toBe('module_not_found');
  });

  it('PATCH: Standard-Notizbuch lässt sich umbenennen, aber nicht verschieben', async () => {
    const list = NotebookListSchema.parse(
      (await json('GET', `/notebooks?module_id=${seed.moduleId}`)).json(),
    );
    const vl = list.items[0] as Notebook;
    expect((await json('PATCH', `/notebooks/${vl.id}`, { title: 'Mein VL' })).statusCode).toBe(200);
    const other = await seedModule(t.handle.db);
    const res = await json('PATCH', `/notebooks/${vl.id}`, { module_id: other.moduleId });
    expect((await errorOf(res, 409)).code).toBe('notebook_default');
  });

  it('PATCH und DELETE auf Unbekanntes: 404 notebook_not_found', async () => {
    expect((await errorOf(await json('PATCH', `/notebooks/${uuidv7()}`, { title: 'x' }), 404)).code).toBe(
      'notebook_not_found',
    );
    expect((await errorOf(await json('DELETE', `/notebooks/${uuidv7()}`), 404)).code).toBe(
      'notebook_not_found',
    );
  });

  it('DELETE löscht weich samt Seiten (gleicher Zeitstempel) und schreibt notebook.delete', async () => {
    const nb = await createNotebook();
    const pc = pageCreateData(nb.id);
    await runHandler(t.handle.db, t.config.dataDir, makeOp('page.create', nbStream(nb.id), pc));
    const res = await json('DELETE', `/notebooks/${nb.id}`);
    expect(res.statusCode, res.body).toBe(204);

    const [n] = await t.handle.sql`SELECT deleted_at::text AS d FROM notebook WHERE id = ${nb.id}`;
    const [p] = await t.handle.sql`SELECT deleted_at::text AS d FROM page WHERE id = ${pc.page_id}`;
    expect(n?.d).toBeTruthy();
    expect(p?.d).toBe(n?.d);
    expect((await ops(nbStream(nb.id))).map((o) => [o.kind, o.origin])).toEqual([
      ['notebook.delete', 'server'],
    ]);
    expect((await json('GET', `/notebooks/${nb.id}`)).statusCode).toBe(404);
    expect((await json('GET', `/notebooks/${nb.id}/pages`)).statusCode).toBe(404);
  });

  it('DELETE eines Standard-Notizbuchs: 409 notebook_default, nichts geschrieben', async () => {
    const list = NotebookListSchema.parse(
      (await json('GET', `/notebooks?module_id=${seed.moduleId}`)).json(),
    );
    const vl = list.items[0] as Notebook;
    const error = await errorOf(await json('DELETE', `/notebooks/${vl.id}`), 409);
    expect(error.code).toBe('notebook_default');
    expect(await ops(nbStream(vl.id))).toHaveLength(0);
  });
});

describe('Seiten und Striche lesen', () => {
  async function seedPages() {
    const nb = await createNotebook();
    const stream = nbStream(nb.id);
    const a = pageCreateData(nb.id, { index: 2 });
    const b = pageCreateData(nb.id, { index: 1 });
    await runHandler(t.handle.db, t.config.dataDir, makeOp('page.create', stream, a));
    await runHandler(t.handle.db, t.config.dataDir, makeOp('page.create', stream, b));
    return { nb, stream, a, b };
  }

  it('GET /notebooks/{id}/pages: nach index sortiert, page_count, Stand des Stroms', async () => {
    const { nb, stream, a, b } = await seedPages();
    const empty = NotebookPagesSchema.parse((await json('GET', `/notebooks/${nb.id}/pages`)).json());
    expect(empty.stream_seq).toBe(0);
    expect(empty.stream_op_id).toBeNull();
    expect(empty.items.map((p) => p.id)).toEqual([b.page_id, a.page_id]);
    expect(empty.items.every((p) => p.has_pkdrawing === false && p.version === 1)).toBe(true);

    const opId = uuidv7();
    await t.handle.db.transaction((tx) =>
      appendOp(tx, stream, {
        kind: 'page.create',
        data: a,
        at: 1_793_800_000_000,
        clockUncertain: false,
        origin: 'ipad',
        opId,
      }),
    );
    const res = NotebookPagesSchema.parse((await json('GET', `/notebooks/${nb.id}/pages`)).json());
    expect(res).toMatchObject({ notebook_id: nb.id, stream_seq: 1, stream_op_id: opId });
    expect((await json('GET', `/notebooks`)).statusCode).toBe(200);
    expect(NotebookSchema.parse((await json('GET', `/notebooks/${nb.id}`)).json()).page_count).toBe(2);
  });

  it('gleicher index: Reihenfolge nach created_at, dann id', async () => {
    const nb = await createNotebook();
    const stream = nbStream(nb.id);
    const first = pageCreateData(nb.id, { index: 1 });
    const second = pageCreateData(nb.id, { index: 1 });
    await runHandler(
      t.handle.db,
      t.config.dataDir,
      makeOp('page.create', stream, second, { at: 1_793_800_005_000 }),
    );
    await runHandler(
      t.handle.db,
      t.config.dataDir,
      makeOp('page.create', stream, first, { at: 1_793_800_001_000 }),
    );
    const res = NotebookPagesSchema.parse((await json('GET', `/notebooks/${nb.id}/pages`)).json());
    expect(res.items.map((p) => p.id)).toEqual([first.page_id, second.page_id]);
  });

  it('GET /pages/{id} und gelöschte Seiten: 404 page_not_found', async () => {
    const { a } = await seedPages();
    const detail = PageDetailSchema.parse((await json('GET', `/pages/${a.page_id}`)).json());
    expect(detail.page.id).toBe(a.page_id);
    expect(detail.elements).toEqual([]);
    await t.handle.db.update(page).set({ deletedAt: new Date() }).where(eq(page.id, a.page_id));
    expect((await errorOf(await json('GET', `/pages/${a.page_id}`), 404)).code).toBe('page_not_found');
    expect((await errorOf(await json('GET', `/pages/${a.page_id}/strokes`), 404)).code).toBe(
      'page_not_found',
    );
    expect((await errorOf(await json('GET', `/pages/${uuidv7()}`), 404)).code).toBe('page_not_found');
  });

  it('GET /pages/{id}/strokes liefert alle Fixture-Striche unverändert, nach created_at sortiert', async () => {
    const { b, stream } = await seedPages();
    const all: Stroke[] = loadStrokeFixtures().flatMap((f) => f.strokes);
    for (const s of all) {
      await runHandler(
        t.handle.db,
        t.config.dataDir,
        makeOp('stroke.add', stream, { page_id: b.page_id, stroke: s }),
      );
    }
    const res = await json('GET', `/pages/${b.page_id}/strokes`);
    expect(res.statusCode, res.body).toBe(200);
    const body = PageStrokesSchema.parse(res.json());
    expect(body.strokes).toHaveLength(all.length);
    const byId = new Map(all.map((s) => [s.client_id, s]));
    for (const got of body.strokes) {
      const want = byId.get(got.client_id) as Stroke;
      expect(got.points).toBe(want.points);
      expect(got.created_at).toBe(want.created_at);
      expect(got.t_start_ms).toBe(want.t_start_ms);
      expect(got.bbox).toEqual(want.bbox);
      expect(got.layer).toBe(want.layer);
      expect(got.tool).toBe(want.tool);
    }
    const times = body.strokes.map((s) => s.created_at);
    expect(times).toEqual([...times].sort((x, y) => x - y));
  });

  it('entfernte Striche erscheinen nicht mehr in GET /pages/{id}/strokes', async () => {
    const { b, stream } = await seedPages();
    const [keep, drop] = (loadStrokeFixtures()[0] as { strokes: Stroke[] }).strokes;
    for (const s of [keep, drop] as Stroke[]) {
      await runHandler(
        t.handle.db,
        t.config.dataDir,
        makeOp('stroke.add', stream, { page_id: b.page_id, stroke: s }),
      );
    }
    await runHandler(
      t.handle.db,
      t.config.dataDir,
      makeOp('stroke.remove', stream, { page_id: b.page_id, client_ids: [(drop as Stroke).client_id] }),
    );
    const body = PageStrokesSchema.parse((await json('GET', `/pages/${b.page_id}/strokes`)).json());
    expect(body.strokes.map((s) => s.client_id)).toEqual([(keep as Stroke).client_id]);
  });

  it('Elemente erscheinen in GET /pages/{id}, sortiert nach z', async () => {
    const { b, stream } = await seedPages();
    const make = (z: number) => ({
      element_id: uuidv7(),
      kind: 'text' as const,
      frame: [0, 0, 50, 20],
      z,
      t_ms: null,
      payload: { text: `z${z}`, size: 's' as const },
    });
    for (const z of [3, 1, 2]) {
      await runHandler(
        t.handle.db,
        t.config.dataDir,
        makeOp('element.upsert', stream, { page_id: b.page_id, element: make(z) }),
      );
    }
    const detail = PageDetailSchema.parse((await json('GET', `/pages/${b.page_id}`)).json());
    expect(detail.elements.map((e) => e.z)).toEqual([1, 2, 3]);
  });
});

describe('PUT/GET /pages/{id}/pkdrawing', () => {
  const body = Buffer.from('bplist00-pkdrawing-testdaten');

  async function onePage() {
    const nb = await createNotebook();
    const pc = pageCreateData(nb.id);
    await runHandler(t.handle.db, t.config.dataDir, makeOp('page.create', nbStream(nb.id), pc));
    return pc.page_id;
  }

  const put = (id: string, payload: Buffer, headers: Record<string, string> = {}) =>
    t.request({
      method: 'PUT',
      url: `${API}/pages/${id}/pkdrawing`,
      payload,
      headers: { 'content-type': 'application/octet-stream', 'x-sha256': sha256(payload), ...headers },
    });

  it('speichert die Datei, prüft sha256 und liefert sie mit Sicherheitsheadern zurück', async () => {
    const id = await onePage();
    expect((await errorOf(await json('GET', `/pages/${id}/pkdrawing`), 404)).code).toBe(
      'pkdrawing_not_found',
    );

    const res = await put(id, body);
    expect(res.statusCode, res.body).toBe(200);
    expect(FileReceiptSchema.parse(res.json())).toMatchObject({
      id,
      sha256: sha256(body),
      size_bytes: body.length,
      duplicate: false,
    });
    expect(existsSync(join(t.config.dataDir, 'media', 'pages', `${id}.pkdrawing`))).toBe(true);
    // Keine .part-Reste
    expect(readdirSync(join(t.config.dataDir, 'media', 'pages')).filter((n) => n.endsWith('.part'))).toEqual(
      [],
    );

    const get = await t.request({ method: 'GET', url: `${API}/pages/${id}/pkdrawing` });
    expect(get.statusCode).toBe(200);
    expect(get.rawPayload.equals(body)).toBe(true);
    expect(get.headers['content-type']).toBe('application/octet-stream');
    expect(get.headers['x-content-type-options']).toBe('nosniff');
    expect(get.headers['content-security-policy']).toContain("default-src 'none'");

    const detail = PageDetailSchema.parse((await json('GET', `/pages/${id}`)).json());
    expect(detail.page.has_pkdrawing).toBe(true);

    const range = await t.request({
      method: 'GET',
      url: `${API}/pages/${id}/pkdrawing`,
      headers: { range: 'bytes=0-5' },
    });
    expect(range.statusCode).toBe(206);
    expect(range.rawPayload.toString()).toBe('bplist');
  });

  it('dieselbe Datei noch einmal: duplicate = true; eine neue ersetzt die alte', async () => {
    const id = await onePage();
    await put(id, body);
    expect(FileReceiptSchema.parse((await put(id, body)).json()).duplicate).toBe(true);
    const next = Buffer.from('neue Sicherung');
    expect(FileReceiptSchema.parse((await put(id, next)).json()).duplicate).toBe(false);
    const get = await t.request({ method: 'GET', url: `${API}/pages/${id}/pkdrawing` });
    expect(get.rawPayload.equals(next)).toBe(true);
  });

  it('falsches sha256: 422 checksum_mismatch, Datei bleibt unverändert', async () => {
    const id = await onePage();
    await put(id, body);
    const res = await put(id, Buffer.from('anderer Inhalt'), { 'x-sha256': sha256('etwas anderes') });
    expect((await errorOf(res, 422)).code).toBe('checksum_mismatch');
    const get = await t.request({ method: 'GET', url: `${API}/pages/${id}/pkdrawing` });
    expect(get.rawPayload.equals(body)).toBe(true);
    expect(readdirSync(join(t.config.dataDir, 'media', 'pages')).filter((n) => n.endsWith('.part'))).toEqual(
      [],
    );
  });

  it('unbekannte Seite: 404 page_not_found; ungültige Header und Typen', async () => {
    expect((await errorOf(await put(uuidv7(), body), 404)).code).toBe('page_not_found');
    expect(existsSync(join(t.config.dataDir, 'media', 'pages'))).toBe(false);
    const id = await onePage();
    expect((await errorOf(await put(id, body, { 'x-sha256': 'ABC' }), 400)).code).toBe('validation_failed');
    const noHeader = await t.request({
      method: 'PUT',
      url: `${API}/pages/${id}/pkdrawing`,
      payload: body,
      headers: { 'content-type': 'application/octet-stream' },
    });
    expect((await errorOf(noHeader, 400)).code).toBe('validation_failed');
    const wrongType = await put(id, body, { 'content-type': 'image/jpeg' });
    expect((await errorOf(wrongType, 415)).code).toBe('unsupported_media_type');
    const empty = await t.request({
      method: 'PUT',
      url: `${API}/pages/${id}/pkdrawing`,
      payload: Buffer.alloc(0),
      headers: { 'content-type': 'application/octet-stream', 'x-sha256': sha256('') },
    });
    expect(empty.statusCode).toBe(400);
  });

  it('Datei über 50 MB: 413 file_too_large (Content-Length), nichts gespeichert', async () => {
    const id = await onePage();
    const res = await t.request({
      method: 'PUT',
      url: `${API}/pages/${id}/pkdrawing`,
      payload: Buffer.alloc(1),
      headers: {
        'content-type': 'application/octet-stream',
        'x-sha256': sha256('x'),
        'content-length': String(50 * 1024 * 1024 + 1),
      },
    });
    expect((await errorOf(res, 413)).code).toBe('file_too_large');
    expect(existsSync(join(t.config.dataDir, 'media', 'pages', `${id}.pkdrawing`))).toBe(false);
  });
});

describe('Fotos: PUT/GET /photos/{id}/file und photo.add', () => {
  const bytes = Buffer.from('JPEG-Bytes-fuer-den-Test');
  const fileRef = (mime = 'image/jpeg', data = bytes) => ({
    sha256: sha256(data),
    mime,
    size_bytes: data.length,
  });
  const putFile = (id: string, payload: Buffer, mime = 'image/jpeg', headers: Record<string, string> = {}) =>
    t.request({
      method: 'PUT',
      url: `${API}/photos/${id}/file`,
      payload,
      headers: { 'content-type': mime, 'x-sha256': sha256(payload), ...headers },
    });

  async function addMeta(sessionId: string, photoId: string, ref = fileRef()) {
    await runHandler(
      t.handle.db,
      t.config.dataDir,
      makeOp('photo.add', `session:${sessionId}`, {
        photo_id: photoId,
        session_id: sessionId,
        t_ms: 4200,
        page_id: null,
        file_ref: ref,
      }),
    );
  }

  it('Metadaten zuerst, Datei danach: 201, danach has_file = true; Wiederholung 200 duplicate', async () => {
    const sessionId = await seedSession(t.handle.db, seed.moduleId);
    const id = uuidv7();
    await addMeta(sessionId, id);
    expect(PhotoSchema.parse((await json('GET', `/photos/${id}`)).json())).toMatchObject({
      id,
      session_id: sessionId,
      t_ms: 4200,
      mime: 'image/jpeg',
      has_file: false,
    });
    expect((await errorOf(await json('GET', `/photos/${id}/file`), 404)).code).toBe('photo_file_missing');

    const res = await putFile(id, bytes);
    expect(res.statusCode, res.body).toBe(201);
    expect(FileReceiptSchema.parse(res.json())).toMatchObject({
      id,
      sha256: sha256(bytes),
      duplicate: false,
    });
    expect(existsSync(join(t.config.dataDir, 'media', 'photos', `${id}.jpg`))).toBe(true);
    expect(PhotoSchema.parse((await json('GET', `/photos/${id}`)).json()).has_file).toBe(true);

    const again = await putFile(id, bytes);
    expect(again.statusCode).toBe(200);
    expect(FileReceiptSchema.parse(again.json()).duplicate).toBe(true);

    const get = await t.request({ method: 'GET', url: `${API}/photos/${id}/file` });
    expect(get.statusCode).toBe(200);
    expect(get.rawPayload.equals(bytes)).toBe(true);
    expect(get.headers['content-type']).toBe('image/jpeg');
    expect(get.headers['x-content-type-options']).toBe('nosniff');
    expect(get.headers.etag).toBe(`"${sha256(bytes)}"`);
    expect(
      (
        await t.request({
          method: 'GET',
          url: `${API}/photos/${id}/file`,
          headers: { 'if-none-match': get.headers.etag as string },
        })
      ).statusCode,
    ).toBe(304);
  });

  it('Datei zuerst, Metadaten danach: has_file ist sofort wahr', async () => {
    const sessionId = await seedSession(t.handle.db, seed.moduleId);
    const id = uuidv7();
    const heic = Buffer.from('HEIC-Bytes');
    const res = await putFile(id, heic, 'image/heic');
    expect(res.statusCode, res.body).toBe(201);
    expect(existsSync(join(t.config.dataDir, 'media', 'photos', `${id}.heic`))).toBe(true);
    expect((await errorOf(await json('GET', `/photos/${id}`), 404)).code).toBe('photo_not_found');

    await addMeta(sessionId, id, fileRef('image/heic', heic));
    const photo = PhotoSchema.parse((await json('GET', `/photos/${id}`)).json());
    expect(photo).toMatchObject({ has_file: true, mime: 'image/heic' });
    const get = await t.request({ method: 'GET', url: `${API}/photos/${id}/file` });
    expect(get.headers['content-type']).toBe('image/heic');
  });

  it('Datei zuerst, dann anderes sha256 ohne Zeile: 409 photo_file_conflict, die erste bleibt', async () => {
    const id = uuidv7();
    await putFile(id, bytes);
    const other = Buffer.from('ein anderes Foto');
    const res = await putFile(id, other);
    expect((await errorOf(res, 409)).code).toBe('photo_file_conflict');
    const asHeic = await putFile(id, bytes, 'image/heic');
    expect((await errorOf(asHeic, 409)).code).toBe('photo_file_conflict');
    expect(existsSync(join(t.config.dataDir, 'media', 'photos', `${id}.heic`))).toBe(false);
    expect(readdirSync(join(t.config.dataDir, 'media', 'photos')).filter((n) => n.endsWith('.part'))).toEqual(
      [],
    );
  });

  it('gleiche Größe, anderer Inhalt: 409 photo_file_conflict', async () => {
    const sessionId = await seedSession(t.handle.db, seed.moduleId);
    const id = uuidv7();
    await addMeta(sessionId, id);
    const same = Buffer.from('X'.repeat(bytes.length));
    expect(same.length).toBe(bytes.length);
    const res = await putFile(id, same);
    expect((await errorOf(res, 409)).code).toBe('photo_file_conflict');
    expect(PhotoSchema.parse((await json('GET', `/photos/${id}`)).json()).has_file).toBe(false);
  });

  it('HEIC hochgeladen, aber photo.add sagt JPEG: die verwaiste .heic wird entfernt', async () => {
    const sessionId = await seedSession(t.handle.db, seed.moduleId);
    const id = uuidv7();
    const heic = Buffer.from('HEIC-Bytes');
    expect((await putFile(id, heic, 'image/heic')).statusCode).toBe(201);
    await addMeta(sessionId, id);
    expect(existsSync(join(t.config.dataDir, 'media', 'photos', `${id}.heic`))).toBe(false);
    expect((await putFile(id, bytes)).statusCode).toBe(201);
  });

  it('weicht die Datei von photo.add ab (sha256, Typ, Größe): 409 photo_file_conflict', async () => {
    const sessionId = await seedSession(t.handle.db, seed.moduleId);
    const id = uuidv7();
    await addMeta(sessionId, id);
    const other = Buffer.from('ein anderes Foto');
    expect((await errorOf(await putFile(id, other), 409)).code).toBe('photo_file_conflict');
    expect((await errorOf(await putFile(id, bytes, 'image/heic'), 409)).code).toBe('photo_file_conflict');
    expect(PhotoSchema.parse((await json('GET', `/photos/${id}`)).json()).has_file).toBe(false);
  });

  it('eine früh hochgeladene, abweichende Datei wird nach photo.add durch die richtige ersetzt', async () => {
    const sessionId = await seedSession(t.handle.db, seed.moduleId);
    const id = uuidv7();
    mkdirSync(join(t.config.dataDir, 'media', 'photos'), { recursive: true });
    writeFileSync(join(t.config.dataDir, 'media', 'photos', `${id}.jpg`), 'kaputte Datei');
    await addMeta(sessionId, id);
    expect(PhotoSchema.parse((await json('GET', `/photos/${id}`)).json()).has_file).toBe(false);
    expect((await putFile(id, bytes)).statusCode).toBe(201);
    const get = await t.request({ method: 'GET', url: `${API}/photos/${id}/file` });
    expect(get.rawPayload.equals(bytes)).toBe(true);
  });

  it('falsche Prüfsumme: 422; falscher Typ: 415; kein Header: 400; leer: 400; nichts bleibt liegen', async () => {
    const id = uuidv7();
    const wrongSum = await putFile(id, bytes, 'image/jpeg', { 'x-sha256': sha256('anders') });
    expect((await errorOf(wrongSum, 422)).code).toBe('checksum_mismatch');
    expect((await errorOf(await putFile(id, bytes, 'image/png'), 415)).code).toBe('unsupported_media_type');
    expect((await errorOf(await putFile(id, bytes, 'application/octet-stream'), 415)).code).toBe(
      'unsupported_media_type',
    );
    const noHeader = await t.request({
      method: 'PUT',
      url: `${API}/photos/${id}/file`,
      payload: bytes,
      headers: { 'content-type': 'image/jpeg' },
    });
    expect((await errorOf(noHeader, 400)).code).toBe('validation_failed');
    const empty = await putFile(id, Buffer.alloc(0));
    expect(empty.statusCode).toBe(400);
    const dir = join(t.config.dataDir, 'media', 'photos');
    expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]);
  });

  it('Dateipfad kommt nur aus ID und Typ: ungültige ID wird abgewiesen, nichts außerhalb geschrieben', async () => {
    const res = await t.request({
      method: 'PUT',
      url: `${API}/photos/..%2F..%2Fescape/file`,
      payload: bytes,
      headers: { 'content-type': 'image/jpeg', 'x-sha256': sha256(bytes) },
    });
    expect(res.statusCode).toBe(400);
    expect((await json('GET', '/photos/nope')).statusCode).toBe(400);
  });

  it('unbekanntes Foto: 404 photo_not_found / photo_file_missing; Foto einer gelöschten Session: 404', async () => {
    expect((await errorOf(await json('GET', `/photos/${uuidv7()}`), 404)).code).toBe('photo_not_found');
    expect((await errorOf(await json('GET', `/photos/${uuidv7()}/file`), 404)).code).toBe(
      'photo_file_missing',
    );
    const sessionId = await seedSession(t.handle.db, seed.moduleId, new Date());
    const id = uuidv7();
    await addMeta(sessionId, id);
    expect((await json('GET', `/photos/${id}`)).statusCode).toBe(404);
  });

  it('gleichzeitige Uploads derselben Datei enden mit genau einer Datei', async () => {
    const sessionId = await seedSession(t.handle.db, seed.moduleId);
    const id = uuidv7();
    await addMeta(sessionId, id);
    const results = await Promise.all([putFile(id, bytes), putFile(id, bytes), putFile(id, bytes)]);
    for (const r of results) expect([200, 201], r.body).toContain(r.statusCode);
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
    const files = readdirSync(join(t.config.dataDir, 'media', 'photos'));
    expect(files).toEqual([`${id}.jpg`]);
  });
});
