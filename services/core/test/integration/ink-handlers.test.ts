// Op-Handler notebook.*, page.*, stroke.*, element.*, drawing.snapshot, photo.add (VERTRAEGE §11.2, §11.3)
// Direkt aufgerufen: handler(tx, op, ctx) in einer Transaktion, ohne WebSocket und ohne Dispatcher.
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Stroke } from '@sg/shared';
import { createDb, type DbHandle } from '../../src/db/client.ts';
import { notebook, page, pageElement, photo, stroke, syncOp } from '../../src/db/schema/index.ts';
import { uuidv7 } from '../../src/lib/uuid7.ts';
import { decodeStrokePoints, MAX_STROKE_POINT_BYTES } from '../../src/sync/handlers/ink.ts';
import { SyncOpError } from '../../src/sync/handlers.ts';
import {
  AT,
  loadStrokeFixtures,
  makeOp,
  nbStream,
  notebookCreateData,
  pageCreateData,
  runHandler,
  seedModule,
  seedSession,
  type Seed,
} from './ink-helpers.ts';
import { testDatabaseUrl } from './helpers.ts';

let handle: DbHandle;
let dataDir: string;
let seed: Seed;

beforeAll(() => {
  handle = createDb(testDatabaseUrl());
  dataDir = mkdtempSync(join(tmpdir(), 'sg-ink-handlers-'));
});
afterAll(async () => {
  await truncate();
  await handle.close();
  rmSync(dataDir, { recursive: true, force: true });
});
beforeEach(async () => {
  await truncate();
  seed = await seedModule(handle.db);
});

async function truncate() {
  await handle.sql`TRUNCATE semester, module, notebook, session, photo, sync_stream, sync_op CASCADE`;
}

const run = (op: Parameters<typeof runHandler>[2]) => runHandler(handle.db, dataDir, op);

async function failure(promise: Promise<unknown>): Promise<SyncOpError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(SyncOpError);
  return error as SyncOpError;
}

/** Freies Notizbuch mit einer Seite anlegen */
async function seedPage(overrides: Record<string, unknown> = {}) {
  const nb = notebookCreateData(seed.moduleId);
  await run(makeOp('notebook.create', nbStream(nb.notebook_id), nb));
  const pc = pageCreateData(nb.notebook_id, overrides);
  await run(makeOp('page.create', nbStream(nb.notebook_id), pc));
  return { notebookId: nb.notebook_id, pageId: pc.page_id, stream: nbStream(nb.notebook_id) };
}

const addStroke = (stream: string, pageId: string, s: Stroke, extra = {}) =>
  makeOp('stroke.add', stream, { page_id: pageId, stroke: s }, extra);

const fixtures = loadStrokeFixtures();
const sample = (): Stroke => structuredClone(fixtures[0]?.strokes[0]) as Stroke;

describe('notebook.create', () => {
  it('legt ein freies Notizbuch mit created_at aus den Daten an', async () => {
    const data = notebookCreateData(seed.moduleId, { title: '  Skizzen  ' });
    await run(makeOp('notebook.create', nbStream(data.notebook_id), data));
    const [row] = await handle.db.select().from(notebook).where(eq(notebook.id, data.notebook_id));
    expect(row).toMatchObject({ title: 'Skizzen', kind: 'frei', moduleId: seed.moduleId, deletedAt: null });
    expect(row?.createdAt.getTime()).toBe(AT);
  });

  it('ist idempotent über notebook_id: zweites Mal ohne Änderung', async () => {
    const data = notebookCreateData(seed.moduleId);
    await run(makeOp('notebook.create', nbStream(data.notebook_id), data));
    await run(makeOp('notebook.create', nbStream(data.notebook_id), { ...data, title: 'Anders' }));
    const rows = await handle.db.select().from(notebook).where(eq(notebook.id, data.notebook_id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe('Mein Notizbuch');
  });

  it('übernimmt deleted_at eines weich gelöschten Moduls', async () => {
    await handle.sql`UPDATE module SET deleted_at = '2026-11-01T10:00:00Z' WHERE id = ${seed.moduleId}`;
    const data = notebookCreateData(seed.moduleId);
    await run(makeOp('notebook.create', nbStream(data.notebook_id), data));
    const [row] = await handle.db.select().from(notebook).where(eq(notebook.id, data.notebook_id));
    expect(row?.deletedAt?.toISOString()).toBe('2026-11-01T10:00:00.000Z');
  });

  it('unbekanntes Modul: module_not_found, nicht wiederholbar', async () => {
    const data = notebookCreateData(uuidv7());
    const error = await failure(run(makeOp('notebook.create', nbStream(data.notebook_id), data)));
    expect(error).toMatchObject({ code: 'module_not_found', retryable: false });
  });

  it('falscher Strom: stream_mismatch', async () => {
    const data = notebookCreateData(seed.moduleId);
    const error = await failure(run(makeOp('notebook.create', nbStream(uuidv7()), data)));
    expect(error.code).toBe('stream_mismatch');
  });

  it('kind vorlesung wird abgelehnt (legt nur der Core an)', async () => {
    const data = notebookCreateData(seed.moduleId, { kind: 'vorlesung' });
    const error = await failure(run(makeOp('notebook.create', nbStream(data.notebook_id), data)));
    expect(error.code).toBe('message_invalid');
  });
});

describe('Server-Operationen von einem Client', () => {
  it.each([
    ['notebook.update', { notebook_id: uuidv7(), fields: { title: 'x', module_id: uuidv7() } }],
    ['notebook.delete', { notebook_id: uuidv7() }],
    ['notebook.restore', { notebook_id: uuidv7() }],
    ['page.restore', { page_id: uuidv7() }],
  ] as const)('%s ergibt op_not_allowed', async (kind, data) => {
    const error = await failure(run(makeOp(kind, nbStream(uuidv7()), data)));
    expect(error).toMatchObject({ code: 'op_not_allowed', retryable: false });
  });
});

describe('page.create / page.update / page.delete', () => {
  it('legt die Seite mit version 1 an und ist idempotent', async () => {
    const { notebookId, pageId, stream } = await seedPage({ index: 3, template: 'kariert' });
    const again = pageCreateData(notebookId, { page_id: pageId, index: 9 });
    await run(makeOp('page.create', stream, again));
    const rows = await handle.db.select().from(page).where(eq(page.id, pageId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ index: 3, template: 'kariert', version: 1, deletedAt: null });
  });

  it('Seite in gelöschtem Notizbuch übernimmt dessen deleted_at', async () => {
    const nb = notebookCreateData(seed.moduleId);
    await run(makeOp('notebook.create', nbStream(nb.notebook_id), nb));
    await handle.sql`UPDATE notebook SET deleted_at = '2026-11-02T08:00:00Z' WHERE id = ${nb.notebook_id}`;
    const pc = pageCreateData(nb.notebook_id);
    await run(makeOp('page.create', nbStream(nb.notebook_id), pc));
    const [row] = await handle.db.select().from(page).where(eq(page.id, pc.page_id));
    expect(row?.deletedAt?.toISOString()).toBe('2026-11-02T08:00:00.000Z');
  });

  it('unbekanntes Notizbuch: notebook_not_found; falscher Strom: stream_mismatch', async () => {
    const orphan = pageCreateData(uuidv7());
    const missing = await failure(run(makeOp('page.create', nbStream(orphan.notebook_id), orphan)));
    expect(missing).toMatchObject({ code: 'notebook_not_found', retryable: false });
    const { notebookId } = await seedPage();
    const wrong = await failure(run(makeOp('page.create', nbStream(uuidv7()), pageCreateData(notebookId))));
    expect(wrong.code).toBe('stream_mismatch');
  });

  it('page.update übernimmt den vollen Stand und zählt version hoch', async () => {
    const { pageId, stream } = await seedPage();
    const slide = uuidv7();
    await run(
      makeOp('page.update', stream, {
        page_id: pageId,
        version: 1,
        fields: {
          index: 4,
          template: 'cornell',
          session_id: null,
          background_slide_id: slide,
          attached_slide_id: null,
        },
      }),
    );
    const [row] = await handle.db.select().from(page).where(eq(page.id, pageId));
    expect(row).toMatchObject({ index: 4, template: 'cornell', backgroundSlideId: slide, version: 2 });
  });

  it('page.update mit alter version: page_version_conflict, Seite bleibt unverändert', async () => {
    const { pageId, stream } = await seedPage();
    const fields = {
      index: 2,
      template: 'blanko',
      session_id: null,
      background_slide_id: null,
      attached_slide_id: null,
    };
    await run(makeOp('page.update', stream, { page_id: pageId, version: 1, fields }));
    const error = await failure(
      run(makeOp('page.update', stream, { page_id: pageId, version: 1, fields: { ...fields, index: 7 } })),
    );
    expect(error).toMatchObject({ code: 'page_version_conflict', retryable: false });
    expect(error.details).toMatchObject({ current_version: 2 });
    const [row] = await handle.db.select().from(page).where(eq(page.id, pageId));
    expect(row).toMatchObject({ index: 2, version: 2 });
  });

  it('page.update für unbekannte Seite: page_not_found', async () => {
    const { stream } = await seedPage();
    const error = await failure(
      run(
        makeOp('page.update', stream, {
          page_id: uuidv7(),
          version: 1,
          fields: {
            index: 1,
            template: 'blanko',
            session_id: null,
            background_slide_id: null,
            attached_slide_id: null,
          },
        }),
      ),
    );
    expect(error.code).toBe('page_not_found');
  });

  it('page.delete löscht Seite, Striche und Elemente mit demselben Zeitstempel; zweites Mal bestätigt', async () => {
    const { pageId, stream } = await seedPage();
    await run(addStroke(stream, pageId, sample()));
    await run(
      makeOp('element.upsert', stream, {
        page_id: pageId,
        element: {
          element_id: uuidv7(),
          kind: 'text',
          frame: [10, 10, 100, 40],
          z: 1,
          t_ms: null,
          payload: { text: 'Hallo', size: 'm' },
        },
      }),
    );
    await run(makeOp('page.delete', stream, { page_id: pageId }));
    const [p] = await handle.sql`SELECT deleted_at::text AS d FROM page WHERE id = ${pageId}`;
    const strokes = await handle.sql`SELECT deleted_at::text AS d FROM stroke WHERE page_id = ${pageId}`;
    const elements =
      await handle.sql`SELECT deleted_at::text AS d FROM page_element WHERE page_id = ${pageId}`;
    expect(p?.d).toBeTruthy();
    expect(strokes.map((r) => r.d)).toEqual([p?.d]);
    expect(elements.map((r) => r.d)).toEqual([p?.d]);
    await run(makeOp('page.delete', stream, { page_id: pageId }));
    const [again] = await handle.sql`SELECT deleted_at::text AS d FROM page WHERE id = ${pageId}`;
    expect(again?.d).toBe(p?.d);
  });
});

describe('stroke.add / stroke.remove', () => {
  it.each(fixtures.map((f) => [f.file, f.strokes] as const))(
    'nimmt alle Striche aus %s an und speichert sie verlustfrei',
    async (_file, strokes) => {
      const { pageId, stream } = await seedPage();
      for (const s of strokes) {
        await run(addStroke(stream, pageId, s, { clock_uncertain: true }));
      }
      const rows = await handle.db.select().from(stroke).where(eq(stroke.pageId, pageId));
      expect(rows).toHaveLength(strokes.length);
      for (const s of strokes) {
        const row = rows.find((r) => r.clientId === s.client_id);
        expect(row, s.client_id).toBeDefined();
        expect(row).toMatchObject({
          tool: s.tool,
          layer: s.layer,
          color: s.color,
          tStartMs: s.t_start_ms,
          tEndMs: s.t_end_ms,
          clockUncertain: true,
          deletedAt: null,
        });
        expect(row?.width).toBeCloseTo(s.width, 4);
        expect(row?.bbox).toEqual(s.bbox);
        expect(row?.transform.map((v) => Math.round(v * 1e3) / 1e3)).toEqual(
          s.transform.map((v) => Math.round(v * 1e3) / 1e3),
        );
        expect(row?.createdAt.getTime()).toBe(s.created_at);
        expect(Buffer.from(row?.points ?? []).toString('base64')).toBe(s.points);
      }
    },
  );

  it('ist ein Upsert über (page_id, client_id): letzter Stand gewinnt (Lasso)', async () => {
    const { pageId, stream } = await seedPage();
    const s = sample();
    await run(addStroke(stream, pageId, s));
    await run(addStroke(stream, pageId, { ...s, transform: [1, 0, 0, 1, 50, 20], bbox: [60, 30, 10, 10] }));
    const rows = await handle.db.select().from(stroke).where(eq(stroke.pageId, pageId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.transform).toEqual([1, 0, 0, 1, 50, 20]);
    expect(rows[0]?.bbox).toEqual([60, 30, 10, 10]);
  });

  it('belebt einen gelöschten Strich wieder', async () => {
    const { pageId, stream } = await seedPage();
    const s = sample();
    await run(addStroke(stream, pageId, s));
    await run(makeOp('stroke.remove', stream, { page_id: pageId, client_ids: [s.client_id] }));
    const [gone] = await handle.db.select().from(stroke).where(eq(stroke.pageId, pageId));
    expect(gone?.deletedAt).not.toBeNull();
    await run(addStroke(stream, pageId, s));
    const [back] = await handle.db.select().from(stroke).where(eq(stroke.pageId, pageId));
    expect(back?.deletedAt).toBeNull();
  });

  it('stroke.add in eine gelöschte Seite übernimmt deren deleted_at', async () => {
    const { pageId, stream } = await seedPage();
    await handle.sql`UPDATE page SET deleted_at = '2026-11-03T09:30:00Z' WHERE id = ${pageId}`;
    await run(addStroke(stream, pageId, sample()));
    const [row] = await handle.db.select().from(stroke).where(eq(stroke.pageId, pageId));
    expect(row?.deletedAt?.toISOString()).toBe('2026-11-03T09:30:00.000Z');
    // Upsert eines schon vorhandenen, lebendigen Strichs in der gelöschten Seite: ebenfalls gelöscht
    await handle.sql`UPDATE stroke SET deleted_at = NULL WHERE page_id = ${pageId}`;
    await run(addStroke(stream, pageId, sample()));
    const [again] = await handle.db.select().from(stroke).where(eq(stroke.pageId, pageId));
    expect(again?.deletedAt?.toISOString()).toBe('2026-11-03T09:30:00.000Z');
  });

  it('unbekannte Seite: page_not_found; Seite eines anderen Notizbuchs: stream_mismatch', async () => {
    const { pageId, stream } = await seedPage();
    const missing = await failure(run(addStroke(stream, uuidv7(), sample())));
    expect(missing).toMatchObject({ code: 'page_not_found', retryable: false });
    const other = await seedPage();
    const mismatch = await failure(run(addStroke(other.stream, pageId, sample())));
    expect(mismatch.code).toBe('stream_mismatch');
  });

  it('prüft die Punkte: kein Base64, keine ganzen Punkte, leer, zu groß', async () => {
    const { pageId, stream } = await seedPage();
    const s = sample();
    const bad = [
      '', // leer
      '###notbase64###', // kein Base64
      Buffer.alloc(23).toString('base64'), // kein ganzer Punkt
      Buffer.alloc(25).toString('base64'), // 1 Punkt + 1 Byte
      Buffer.alloc(MAX_STROKE_POINT_BYTES + 24).toString('base64'), // zu groß
    ];
    for (const points of bad) {
      const error = await failure(run(addStroke(stream, pageId, { ...s, points })));
      expect(error, points.slice(0, 20)).toMatchObject({ code: 'message_invalid', retryable: false });
    }
    expect(decodeStrokePoints(Buffer.alloc(24).toString('base64'))).toHaveLength(24);
    expect(decodeStrokePoints(Buffer.alloc(MAX_STROKE_POINT_BYTES).toString('base64'))).toHaveLength(
      MAX_STROKE_POINT_BYTES,
    );
    const rows = await handle.db.select().from(stroke).where(eq(stroke.pageId, pageId));
    expect(rows).toHaveLength(0);
  });

  it('prüft transform, bbox und width', async () => {
    const { pageId, stream } = await seedPage();
    const s = sample();
    for (const broken of [
      { transform: [1, 0, 0, 1, 0] },
      { transform: [1, 0, 0, 1, 0, Number.NaN] },
      { bbox: [0, 0, 1] },
      { width: 0 },
    ]) {
      const error = await failure(run(addStroke(stream, pageId, { ...s, ...broken } as Stroke)));
      expect(error.code).toBe('message_invalid');
    }
  });

  it('stroke.remove: unbekannte client_ids werden ignoriert, andere Striche bleiben', async () => {
    const { pageId, stream } = await seedPage();
    const [a, b] = [sample(), { ...sample(), client_id: uuidv7() }];
    await run(addStroke(stream, pageId, a));
    await run(addStroke(stream, pageId, b));
    await run(makeOp('stroke.remove', stream, { page_id: pageId, client_ids: [a.client_id, uuidv7()] }));
    const rows = await handle.db.select().from(stroke).where(eq(stroke.pageId, pageId));
    expect(rows.find((r) => r.clientId === a.client_id)?.deletedAt).not.toBeNull();
    expect(rows.find((r) => r.clientId === b.client_id)?.deletedAt).toBeNull();
  });
});

describe('element.upsert / element.remove', () => {
  const stamp = (elementId: string, z = 0) => ({
    element_id: elementId,
    kind: 'stamp' as const,
    frame: [1, 2, 24, 24],
    z,
    t_ms: 5000,
    payload: { marker_id: uuidv7(), marker_kind: 'frage' as const },
  });

  it('legt an, ändert per Upsert und entfernt weich; unbekanntes Element wird ignoriert', async () => {
    const { pageId, stream } = await seedPage();
    const id = uuidv7();
    await run(makeOp('element.upsert', stream, { page_id: pageId, element: stamp(id, 1) }));
    await run(makeOp('element.upsert', stream, { page_id: pageId, element: stamp(id, 5) }));
    const rows = await handle.db.select().from(pageElement).where(eq(pageElement.pageId, pageId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id, kind: 'stamp', z: 5, tMs: 5000, deletedAt: null });
    expect(rows[0]?.frame).toEqual([1, 2, 24, 24]);

    await run(makeOp('element.remove', stream, { page_id: pageId, element_id: uuidv7() }));
    await run(makeOp('element.remove', stream, { page_id: pageId, element_id: id }));
    const [removed] = await handle.db.select().from(pageElement).where(eq(pageElement.id, id));
    expect(removed?.deletedAt).not.toBeNull();

    // Upsert belebt wieder
    await run(makeOp('element.upsert', stream, { page_id: pageId, element: stamp(id, 6) }));
    const [back] = await handle.db.select().from(pageElement).where(eq(pageElement.id, id));
    expect(back).toMatchObject({ z: 6, deletedAt: null });
  });

  it('Element in gelöschter Seite übernimmt deren deleted_at', async () => {
    const { pageId, stream } = await seedPage();
    await handle.sql`UPDATE page SET deleted_at = '2026-11-03T09:30:00Z' WHERE id = ${pageId}`;
    const id = uuidv7();
    await run(makeOp('element.upsert', stream, { page_id: pageId, element: stamp(id) }));
    const [row] = await handle.db.select().from(pageElement).where(eq(pageElement.id, id));
    expect(row?.deletedAt?.toISOString()).toBe('2026-11-03T09:30:00.000Z');
  });

  it('dieselbe element_id auf einer anderen Seite wird nicht verschoben', async () => {
    const first = await seedPage();
    const second = await seedPage();
    const id = uuidv7();
    await run(makeOp('element.upsert', first.stream, { page_id: first.pageId, element: stamp(id) }));
    const error = await failure(
      run(makeOp('element.upsert', second.stream, { page_id: second.pageId, element: stamp(id) })),
    );
    expect(error.code).toBe('stream_mismatch');
    const [row] = await handle.db.select().from(pageElement).where(eq(pageElement.id, id));
    expect(row?.pageId).toBe(first.pageId);
  });

  it('unbekannte Seite: page_not_found', async () => {
    const { stream } = await seedPage();
    const error = await failure(
      run(makeOp('element.upsert', stream, { page_id: uuidv7(), element: stamp(uuidv7()) })),
    );
    expect(error.code).toBe('page_not_found');
  });
});

describe('drawing.snapshot', () => {
  it('bestätigt immer, auch für unbekannte Seiten, und ändert nichts', async () => {
    const { stream } = await seedPage();
    const sha = createHash('sha256').update('x').digest('hex');
    await run(
      makeOp('drawing.snapshot', stream, {
        page_id: uuidv7(),
        pkdrawing_ref: { sha256: sha, mime: 'application/octet-stream', size_bytes: 1 },
      }),
    );
    expect(await handle.db.select().from(syncOp)).toHaveLength(0);
  });
});

describe('photo.add', () => {
  const bytes = Buffer.from('heic-bytes-für-den-test');
  const sha = createHash('sha256').update(bytes).digest('hex');
  const photoData = (sessionId: string, overrides: Record<string, unknown> = {}) => ({
    photo_id: uuidv7(),
    session_id: sessionId,
    t_ms: 1234,
    page_id: null,
    file_ref: { sha256: sha, mime: 'image/heic', size_bytes: bytes.length },
    ...overrides,
  });

  it('legt die Zeile ohne Datei an (has_file = false) und ist idempotent', async () => {
    const sessionId = await seedSession(handle.db, seed.moduleId);
    const data = photoData(sessionId);
    await run(makeOp('photo.add', `session:${sessionId}`, data));
    await run(makeOp('photo.add', `session:${sessionId}`, { ...data, t_ms: 999 }));
    const rows = await handle.db.select().from(photo).where(eq(photo.id, data.photo_id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tMs: 1234,
      filePath: null,
      mime: 'image/heic',
      sha256: sha,
      deletedAt: null,
    });
  });

  it('erkennt eine vorher hochgeladene, passende Datei (has_file = true)', async () => {
    const sessionId = await seedSession(handle.db, seed.moduleId);
    const data = photoData(sessionId);
    mkdirSync(join(dataDir, 'media', 'photos'), { recursive: true });
    writeFileSync(join(dataDir, 'media', 'photos', `${data.photo_id}.heic`), bytes);
    await run(makeOp('photo.add', `session:${sessionId}`, data));
    const [row] = await handle.db.select().from(photo).where(eq(photo.id, data.photo_id));
    expect(row?.filePath).toBe(`media/photos/${data.photo_id}.heic`);
  });

  it('eine vorher hochgeladene Datei mit anderem sha256 zählt nicht', async () => {
    const sessionId = await seedSession(handle.db, seed.moduleId);
    const data = photoData(sessionId);
    mkdirSync(join(dataDir, 'media', 'photos'), { recursive: true });
    writeFileSync(join(dataDir, 'media', 'photos', `${data.photo_id}.heic`), 'ganz anderer Inhalt!!!!!');
    await run(makeOp('photo.add', `session:${sessionId}`, data));
    const [row] = await handle.db.select().from(photo).where(eq(photo.id, data.photo_id));
    expect(row?.filePath).toBeNull();
  });

  it('weich gelöschte Session: das Foto übernimmt deren deleted_at', async () => {
    const deletedAt = new Date('2026-11-01T12:00:00Z');
    const sessionId = await seedSession(handle.db, seed.moduleId, deletedAt);
    const data = photoData(sessionId);
    await run(makeOp('photo.add', `session:${sessionId}`, data));
    const [row] = await handle.db.select().from(photo).where(eq(photo.id, data.photo_id));
    expect(row?.deletedAt?.toISOString()).toBe(deletedAt.toISOString());
  });

  it('unbekannte Session: session_not_found; falscher Strom: stream_mismatch', async () => {
    const ghost = uuidv7();
    const missing = await failure(run(makeOp('photo.add', `session:${ghost}`, photoData(ghost))));
    expect(missing).toMatchObject({ code: 'session_not_found', retryable: false });
    const sessionId = await seedSession(handle.db, seed.moduleId);
    const wrong = await failure(run(makeOp('photo.add', `session:${uuidv7()}`, photoData(sessionId))));
    expect(wrong.code).toBe('stream_mismatch');
    expect(
      await handle.db
        .select()
        .from(photo)
        .where(and(eq(photo.sessionId, sessionId))),
    ).toHaveLength(0);
  });
});
