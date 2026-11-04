import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ApiErrorSchema,
  ExerciseSheetListSchema,
  ExerciseSheetSchema,
  PdfIngestPayloadSchema,
  SINGLE_USER_ID,
  SlideDeckDetailSchema,
  SlideDeckListSchema,
  SlideDeckSchema,
  SlideSchema,
  UploadResultSchema,
} from '@sg/shared';
import { createDb } from '../../src/db/client.ts';
import { registerErrorHandler } from '../../src/plugins/errors.ts';
import { uuidv7 } from '../../src/lib/uuid7.ts';
import { materialRoutes, parseRange, sweepOrphanFolders } from '../../src/routes/material.ts';
import { setSessionEventPublisher } from '../../src/services/sessions.ts';
import { startTestApp, testDatabaseUrl, type TestApp } from './helpers.ts';

let t: TestApp;
let moduleId: string;
let otherModuleId: string;
let sessionOfOtherModule: string;

const API = '/api/v1';

beforeAll(async () => {
  // Folien-Upload an eine Session meldet `session.updated`; der Versand (T1-08) ist hier nicht Gegenstand
  setSessionEventPublisher(async () => {});
  t = await startTestApp();
  const sql = t.handle.sql;
  const semesterId = uuidv7();
  moduleId = uuidv7();
  otherModuleId = uuidv7();
  sessionOfOtherModule = uuidv7();
  await sql`INSERT INTO semester (id, user_id, name) VALUES (${semesterId}, ${SINGLE_USER_ID}, 'Material-Test')`;
  for (const [id, name] of [
    [moduleId, 'Datenbanken'],
    [otherModuleId, 'Statistik'],
  ] as const) {
    await sql`INSERT INTO module (id, user_id, semester_id, name, color) VALUES (${id}, ${SINGLE_USER_ID}, ${semesterId}, ${name}, 'mod-01')`;
  }
  await sql`INSERT INTO session (id, user_id, module_id) VALUES (${sessionOfOtherModule}, ${SINGLE_USER_ID}, ${otherModuleId})`;
});
afterAll(async () => {
  setSessionEventPublisher(null);
  await t.close();
});
beforeEach(async () => {
  const sql = t.handle.sql;
  await sql`DELETE FROM job`;
  await sql`DELETE FROM idempotency_key`;
  await sql`DELETE FROM slide`;
  await sql`DELETE FROM slide_deck`;
  await sql`DELETE FROM exercise_sheet`;
  rmSync(join(t.config.dataDir, 'media'), { recursive: true, force: true });
});

/** Kleines Test-PDF (nur der Core-Check zählt: `%PDF` am Anfang) */
function fakePdf(marker = randomBytes(8).toString('hex'), padding = 0): Buffer {
  return Buffer.from(`%PDF-1.4\n% ${marker}\n${'x'.repeat(padding)}\n%%EOF\n`);
}

interface Part {
  name: string;
  value?: string;
  filename?: string;
  contentType?: string;
  data?: Buffer;
}

function multipartBody(parts: Part[], boundary = `----sgtest${randomBytes(6).toString('hex')}`) {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    let head = `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"`;
    if (part.filename !== undefined) head += `; filename="${part.filename}"`;
    head += '\r\n';
    if (part.contentType) head += `Content-Type: ${part.contentType}\r\n`;
    chunks.push(
      Buffer.from(`${head}\r\n`, 'utf8'),
      part.data ?? Buffer.from(part.value ?? '', 'utf8'),
      Buffer.from('\r\n'),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

function upload(
  url: string,
  fields: Record<string, string>,
  file: { data: Buffer; filename?: string; contentType?: string } | null,
  extraHeaders: Record<string, string> = {},
  boundary?: string,
) {
  const parts: Part[] = Object.entries(fields).map(([name, value]) => ({ name, value }));
  if (file) {
    parts.push({
      name: 'file',
      filename: file.filename ?? 'folien.pdf',
      contentType: file.contentType ?? 'application/pdf',
      data: file.data,
    });
  }
  const body = multipartBody(parts, boundary);
  return t.request({
    method: 'POST',
    url: `${API}${url}`,
    payload: body.payload,
    headers: { ...body.headers, ...extraHeaders },
  });
}

const uploadDeck = (
  fields: Record<string, string>,
  file = { data: fakePdf() } as Parameters<typeof upload>[2],
  h = {},
) => upload('/slide-decks', fields, file, h);
const uploadSheet = (
  fields: Record<string, string>,
  file = { data: fakePdf() } as Parameters<typeof upload>[2],
  h = {},
) => upload('/exercise-sheets', fields, file, h);

async function counts() {
  const sql = t.handle.sql;
  const count = async (table: string) => {
    const rows = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM ${sql(table)}`;
    return rows[0]?.n ?? 0;
  };
  return {
    decks: await count('slide_deck'),
    sheets: await count('exercise_sheet'),
    jobs: await count('job'),
  };
}

async function eventually<T>(
  fn: () => Promise<T>,
  check: (value: T) => boolean,
  timeoutMs = 2000,
): Promise<T> {
  const start = Date.now();
  let value = await fn();
  while (!check(value) && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    value = await fn();
  }
  return value;
}

const tmpFiles = (dataDir: string) => readdir(join(dataDir, 'media', '.tmp')).catch(() => [] as string[]);

describe('POST /slide-decks', () => {
  it('speichert PDF, legt Foliensatz und pdf.ingest-Job an (201)', async () => {
    const data = fakePdf('inhalt-1', 1500);
    const res = await uploadDeck({ module_id: moduleId }, { data, filename: 'VL 03 Übung.pdf' });
    expect(res.statusCode).toBe(201);
    const result = UploadResultSchema.parse(res.json());
    expect(result.duplicate).toBe(false);

    const [deck] = await t.handle.sql`SELECT * FROM slide_deck WHERE id = ${result.id}`;
    expect(deck).toMatchObject({
      module_id: moduleId,
      session_id: null,
      title: 'VL 03 Übung', // ohne Endung, UTF-8 bleibt erhalten
      file_path: `media/decks/${result.id}/original.pdf`,
      sha256: sha256(data),
      page_count: null,
      ingest_state: 'neu',
      deleted_at: null,
    });
    expect(readFileSync(join(t.config.dataDir, deck!.file_path as string)).equals(data)).toBe(true);

    const jobs = await t.handle.sql`SELECT * FROM job`;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ type: 'pdf.ingest', state: 'wartet', session_id: null });
    expect(jobs[0]!.payload).toEqual({ slide_deck_id: result.id });
    expect(PdfIngestPayloadSchema.safeParse(jobs[0]!.payload).success).toBe(true);
    expect(
      await eventually(
        () => tmpFiles(t.config.dataDir),
        (f) => f.length === 0,
      ),
    ).toEqual([]);
  });

  it('übernimmt Titel und Session (Job bekommt session_id)', async () => {
    const sessionId = uuidv7();
    await t.handle
      .sql`INSERT INTO session (id, user_id, module_id) VALUES (${sessionId}, ${SINGLE_USER_ID}, ${moduleId})`;
    const res = await uploadDeck({ module_id: moduleId, session_id: sessionId, title: ' Eigener Titel ' });
    expect(res.statusCode).toBe(201);
    const { id } = UploadResultSchema.parse(res.json());
    const detail = await t.request({ url: `${API}/slide-decks/${id}` });
    const body = SlideDeckDetailSchema.parse(detail.json());
    expect(body.deck).toMatchObject({ title: 'Eigener Titel', session_id: sessionId, ingest_state: 'neu' });
    const [job] = await t.handle.sql`SELECT session_id FROM job`;
    expect(job!.session_id).toBe(sessionId);
    await t.handle.sql`DELETE FROM slide_deck`;
    await t.handle.sql`DELETE FROM session WHERE id = ${sessionId}`;
  });

  it('erkennt dieselbe Datei im selben Modul (200, duplicate, nichts Neues)', async () => {
    const data = fakePdf('dublette');
    const first = UploadResultSchema.parse((await uploadDeck({ module_id: moduleId }, { data })).json());
    const again = await uploadDeck({ module_id: moduleId }, { data, filename: 'anders.pdf' });
    expect(again.statusCode).toBe(200);
    expect(UploadResultSchema.parse(again.json())).toEqual({ id: first.id, duplicate: true });
    expect(await counts()).toEqual({ decks: 1, sheets: 0, jobs: 1 });
    expect(
      await eventually(
        () => tmpFiles(t.config.dataDir),
        (f) => f.length === 0,
      ),
    ).toEqual([]);
    const folders = await readdir(join(t.config.dataDir, 'media', 'decks'));
    expect(folders).toEqual([first.id]);
  });

  it('gleiche Datei in anderem Modul oder nach dem Löschen ist kein Duplikat', async () => {
    const data = fakePdf('modulwechsel');
    const first = UploadResultSchema.parse((await uploadDeck({ module_id: moduleId }, { data })).json());
    const other = await uploadDeck({ module_id: otherModuleId }, { data });
    expect(other.statusCode).toBe(201);
    expect(UploadResultSchema.parse(other.json()).id).not.toBe(first.id);

    await t.request({ method: 'DELETE', url: `${API}/slide-decks/${first.id}` });
    const afterDelete = await uploadDeck({ module_id: moduleId }, { data });
    expect(afterDelete.statusCode).toBe(201);
    expect(UploadResultSchema.parse(afterDelete.json()).duplicate).toBe(false);
  });

  it('gleichzeitige Uploads derselben Datei ergeben genau einen Foliensatz', async () => {
    const data = fakePdf('parallel', 20_000);
    const results = await Promise.all(
      Array.from({ length: 4 }, () => uploadDeck({ module_id: moduleId }, { data })),
    );
    const parsed = results.map((r) => UploadResultSchema.parse(r.json()));
    expect(parsed.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(new Set(parsed.map((r) => r.id)).size).toBe(1);
    expect(await counts()).toEqual({ decks: 1, sheets: 0, jobs: 1 });
  });

  it.each([
    ['Textdatei', Buffer.from('Hallo, das ist kein PDF'), 'application/pdf'],
    ['PNG-Bild', Buffer.from('\x89PNG\r\n\x1a\n0000'), 'image/png'],
    ['leere Datei', Buffer.alloc(0), 'application/pdf'],
    ['PDF mit falschem MIME-Typ', fakePdf(), 'image/png'],
  ])('lehnt %s mit 400 invalid_pdf ab und hinterlässt nichts', async (_name, data, contentType) => {
    const res = await uploadDeck({ module_id: moduleId }, { data, contentType });
    expect(res.statusCode).toBe(400);
    expect(ApiErrorSchema.parse(res.json()).error.code).toBe('invalid_pdf');
    expect(await counts()).toEqual({ decks: 0, sheets: 0, jobs: 0 });
    expect(
      await eventually(
        () => tmpFiles(t.config.dataDir),
        (f) => f.length === 0,
      ),
    ).toEqual([]);
  });

  it('akzeptiert application/octet-stream, wenn die Magic-Bytes stimmen', async () => {
    const res = await uploadDeck(
      { module_id: moduleId },
      { data: fakePdf(), contentType: 'application/octet-stream' },
    );
    expect(res.statusCode).toBe(201);
  });

  it('Fehler bei den Feldern: fehlende Datei, fehlendes/ungültiges Modul, unbekannte Session', async () => {
    const noFile = await uploadDeck({ module_id: moduleId }, null);
    expect(noFile.statusCode).toBe(400);
    expect(ApiErrorSchema.parse(noFile.json()).error.code).toBe('file_missing');

    const noModule = await uploadDeck({});
    expect(noModule.statusCode).toBe(400);
    expect(ApiErrorSchema.parse(noModule.json()).error.code).toBe('validation_failed');

    const badModule = await uploadDeck({ module_id: 'keine-uuid' });
    expect(badModule.statusCode).toBe(400);

    const unknownModule = await uploadDeck({ module_id: uuidv7() });
    expect(unknownModule.statusCode).toBe(404);
    expect(ApiErrorSchema.parse(unknownModule.json()).error.code).toBe('module_not_found');

    const unknownSession = await uploadDeck({ module_id: moduleId, session_id: uuidv7() });
    expect(unknownSession.statusCode).toBe(404);
    expect(ApiErrorSchema.parse(unknownSession.json()).error.code).toBe('session_not_found');

    const mismatch = await uploadDeck({ module_id: moduleId, session_id: sessionOfOtherModule });
    expect(mismatch.statusCode).toBe(400);
    expect(ApiErrorSchema.parse(mismatch.json()).error.code).toBe('session_module_mismatch');

    expect(await counts()).toEqual({ decks: 0, sheets: 0, jobs: 0 });
    expect(
      await eventually(
        () => tmpFiles(t.config.dataDir),
        (f) => f.length === 0,
      ),
    ).toEqual([]);
  });

  it('verlangt multipart/form-data (415)', async () => {
    const res = await t.request({
      method: 'POST',
      url: `${API}/slide-decks`,
      payload: { module_id: moduleId },
    });
    expect(res.statusCode).toBe(415);
    expect(ApiErrorSchema.parse(res.json()).error.code).toBe('multipart_required');
  });

  it('zweite Datei oder falscher Feldname → 400 unexpected_file', async () => {
    const body = multipartBody([
      { name: 'module_id', value: moduleId },
      { name: 'file', filename: 'a.pdf', contentType: 'application/pdf', data: fakePdf() },
      { name: 'file', filename: 'b.pdf', contentType: 'application/pdf', data: fakePdf() },
    ]);
    const res = await t.request({
      method: 'POST',
      url: `${API}/slide-decks`,
      payload: body.payload,
      headers: body.headers,
    });
    expect(res.statusCode).toBe(400);
    expect(ApiErrorSchema.parse(res.json()).error.code).toBe('unexpected_file');
    expect(await counts()).toEqual({ decks: 0, sheets: 0, jobs: 0 });
    expect(
      await eventually(
        () => tmpFiles(t.config.dataDir),
        (f) => f.length === 0,
      ),
    ).toEqual([]);
  });

  it('Datei und Zeile verschwinden wieder, wenn das Anlegen des Jobs scheitert (eine Transaktion)', async () => {
    const sql = t.handle.sql;
    await sql`CREATE OR REPLACE FUNCTION block_job_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'job gesperrt'; END $$`;
    await sql`CREATE TRIGGER block_job BEFORE INSERT ON job FOR EACH ROW EXECUTE FUNCTION block_job_insert()`;
    try {
      const res = await uploadDeck({ module_id: moduleId });
      expect(res.statusCode).toBe(500);
    } finally {
      await sql`DROP TRIGGER block_job ON job`;
      await sql`DROP FUNCTION block_job_insert()`;
    }
    expect(await counts()).toEqual({ decks: 0, sheets: 0, jobs: 0 });
    const folders = await readdir(join(t.config.dataDir, 'media', 'decks')).catch(() => [] as string[]);
    expect(folders).toEqual([]);
    expect(
      await eventually(
        () => tmpFiles(t.config.dataDir),
        (f) => f.length === 0,
      ),
    ).toEqual([]);
  });
});

describe('Magic-Bytes, Wiederholung nach Fehler, Aufräumen', () => {
  it('akzeptiert %PDF in den ersten 1024 Bytes, nicht danach', async () => {
    const withPrefix = Buffer.concat([Buffer.from('\n'.repeat(900)), fakePdf('vorspann')]);
    expect((await uploadDeck({ module_id: moduleId }, { data: withPrefix })).statusCode).toBe(201);
    const tooLate = Buffer.concat([Buffer.from('x'.repeat(1030)), fakePdf('zu-spaet')]);
    const res = await uploadDeck({ module_id: moduleId }, { data: tooLate });
    expect(res.statusCode).toBe(400);
    expect(ApiErrorSchema.parse(res.json()).error.code).toBe('invalid_pdf');
    const tiny = await uploadDeck({ module_id: moduleId }, { data: Buffer.from('%PDF') });
    expect(tiny.statusCode).toBe(201);
  });

  it.each([
    ['slide_deck', '/slide-decks', uploadDeck, 'slide_deck_id'],
    ['exercise_sheet', '/exercise-sheets', uploadSheet, 'exercise_sheet_id'],
  ] as const)(
    'gescheiterte Dublette (%s) wird zurückgesetzt und neu eingelesen',
    async (table, _url, up, key) => {
      const data = fakePdf(`retry-${table}`);
      const first = UploadResultSchema.parse((await up({ module_id: moduleId }, { data })).json());
      const sql = t.handle.sql;
      await sql`UPDATE ${sql(table)} SET ingest_state = 'fehler' WHERE id = ${first.id}`;
      await sql`UPDATE job SET state = 'fehler'`;

      const again = await up({ module_id: moduleId }, { data });
      expect(again.statusCode).toBe(200);
      expect(UploadResultSchema.parse(again.json())).toEqual({ id: first.id, duplicate: true });
      const [row] = await sql`SELECT ingest_state FROM ${sql(table)} WHERE id = ${first.id}`;
      expect(row!.ingest_state).toBe('neu');
      const jobs = await sql`SELECT payload, state FROM job ORDER BY created_at`;
      expect(jobs).toHaveLength(2);
      expect(jobs[1]).toMatchObject({ state: 'wartet', payload: { [key]: first.id } });

      // Nicht gescheitert: keine zweite Einlesung
      await up({ module_id: moduleId }, { data });
      expect(await sql`SELECT 1 FROM job`).toHaveLength(2);
    },
  );

  it('Abbruch des Clients mitten im Upload hinterlässt keine temporäre Datei', async () => {
    await t.app.listen({ port: 0, host: '127.0.0.1' });
    const address = t.app.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const boundary = '----abbruch';
    await new Promise<void>((resolve) => {
      const req = httpRequest({
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: `${API}/slide-decks`,
        headers: {
          host: `localhost:${t.config.port}`,
          'content-type': `multipart/form-data; boundary=${boundary}`,
          'content-length': '5000000',
        },
      });
      req.on('error', () => resolve());
      req.on('close', () => resolve());
      req.write(
        `--${boundary}\r\nContent-Disposition: form-data; name="module_id"\r\n\r\n${moduleId}\r\n` +
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4\n${'x'.repeat(100_000)}`,
      );
      setTimeout(() => req.destroy(), 200);
    });
    expect(
      await eventually(
        () => tmpFiles(t.config.dataDir),
        (f) => f.length === 0,
      ),
    ).toEqual([]);
    expect(await counts()).toEqual({ decks: 0, sheets: 0, jobs: 0 });
  });

  it('räumt beim Start alte temporäre Uploads auf, frische bleiben', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'sg-core-sweep-'));
    const old = new Date(Date.now() - 3 * 3600 * 1000);
    mkdirSync(join(dataDir, 'media', '.tmp'), { recursive: true });
    const staleTmp = join(dataDir, 'media', '.tmp', 'alt.upload');
    const freshTmp = join(dataDir, 'media', '.tmp', 'neu.upload');
    writeFileSync(staleTmp, 'x');
    writeFileSync(freshTmp, 'x');
    utimesSync(staleTmp, old, old);
    const second = await startTestApp({ dataDir });
    try {
      const left = await eventually(
        () => readdir(join(dataDir, 'media', '.tmp')),
        (names) => !names.includes('alt.upload'),
      );
      expect(left).toEqual(['neu.upload']);
    } finally {
      await second.close();
    }
  });
});

describe('Verwaiste Ordner (nie löschen, nur verschieben)', () => {
  const old = new Date(Date.now() - 3 * 3600 * 1000);
  const warnings: { obj: object; msg: string }[] = [];
  const log = { warn: (obj: object, msg: string) => warnings.push({ obj, msg }) };

  async function makeFolders(dataDir: string, count: number, opts: { rows: boolean; old?: boolean }) {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const id = uuidv7();
      ids.push(id);
      const dir = join(dataDir, 'media', 'decks', id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'original.pdf'), `inhalt-${id}`);
      if (opts.old ?? true) utimesSync(dir, old, old);
      if (opts.rows) {
        await t.handle.sql`INSERT INTO slide_deck (id, user_id, module_id, title, file_path, sha256)
          VALUES (${id}, ${SINGLE_USER_ID}, ${moduleId}, 'x', 'p', ${randomBytes(32).toString('hex')})`;
      }
    }
    return ids;
  }
  const names = (dataDir: string, ...path: string[]) => readdir(join(dataDir, ...path)).catch(() => []);

  beforeEach(() => {
    warnings.length = 0;
  });

  it('leere Tabelle, aber Ordner vorhanden: nichts wird angefasst', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'sg-core-orph-'));
    const ids = await makeFolders(dataDir, 5, { rows: false });
    expect(await sweepOrphanFolders(t.handle.db, dataDir, log)).toBe(0);
    expect((await names(dataDir, 'media', 'decks')).sort()).toEqual([...ids].sort());
    expect(await names(dataDir, 'media', '.orphaned')).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  it('ein einzelner echter Waise wird verschoben, nicht gelöscht; Inhalt unverändert', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'sg-core-orph-'));
    const known = await makeFolders(dataDir, 10, { rows: true });
    const [orphan] = await makeFolders(dataDir, 1, { rows: false });
    const [young] = await makeFolders(dataDir, 0, { rows: false, old: false });
    expect(young).toBeUndefined();
    expect(await sweepOrphanFolders(t.handle.db, dataDir, log)).toBe(1);
    expect((await names(dataDir, 'media', 'decks')).sort()).toEqual([...known].sort());
    expect(await names(dataDir, 'media', '.orphaned', 'decks')).toEqual([orphan]);
    expect(readFileSync(join(dataDir, 'media', '.orphaned', 'decks', orphan!, 'original.pdf'), 'utf8')).toBe(
      `inhalt-${orphan}`,
    );
    expect(warnings.some((w) => w.msg.includes('verschoben'))).toBe(true);
  });

  it('junge Ordner ohne Zeile (laufender Upload) bleiben liegen', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'sg-core-orph-'));
    await makeFolders(dataDir, 10, { rows: true });
    const [young] = await makeFolders(dataDir, 1, { rows: false, old: false });
    expect(await sweepOrphanFolders(t.handle.db, dataDir, log)).toBe(0);
    expect(await names(dataDir, 'media', 'decks')).toContain(young);
  });

  it.each([
    ['mehr als 3 Waisen', 20, 4],
    ['mehr als 10 % Waisen', 20, 3],
  ])('%s: Aufräumen wird übersprungen', async (_name, knownCount, orphanCount) => {
    const dataDir = mkdtempSync(join(tmpdir(), 'sg-core-orph-'));
    const known = await makeFolders(dataDir, knownCount, { rows: true });
    const orphans = await makeFolders(dataDir, orphanCount, { rows: false });
    expect(await sweepOrphanFolders(t.handle.db, dataDir, log)).toBe(0);
    expect((await names(dataDir, 'media', 'decks')).sort()).toEqual([...known, ...orphans].sort());
    expect(await names(dataDir, 'media', '.orphaned')).toEqual([]);
    expect(warnings).toHaveLength(1);
  });
});

describe('Größenlimit', () => {
  it('antwortet mit 413 file_too_large und räumt auf', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'sg-core-limit-'));
    const handle = createDb(testDatabaseUrl());
    const app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    registerErrorHandler(app);
    await app.register(materialRoutes, { db: handle.db, config: { dataDir }, maxUploadBytes: 2000 });
    await app.ready();
    try {
      const big = multipartBody([
        { name: 'module_id', value: moduleId },
        {
          name: 'file',
          filename: 'gross.pdf',
          contentType: 'application/pdf',
          data: fakePdf('gross', 10_000),
        },
      ]);
      const res = await app.inject({
        method: 'POST',
        url: '/slide-decks',
        payload: big.payload,
        headers: big.headers,
      });
      expect(res.statusCode).toBe(413);
      expect(ApiErrorSchema.parse(res.json()).error.code).toBe('file_too_large');
      expect(
        await eventually(
          () => tmpFiles(dataDir),
          (f) => f.length === 0,
        ),
      ).toEqual([]);

      const small = multipartBody([
        { name: 'module_id', value: moduleId },
        { name: 'file', filename: 'klein.pdf', contentType: 'application/pdf', data: fakePdf('klein') },
      ]);
      const ok = await app.inject({
        method: 'POST',
        url: '/slide-decks',
        payload: small.payload,
        headers: small.headers,
      });
      expect(ok.statusCode).toBe(201);
      await handle.sql`DELETE FROM job`;
      await handle.sql`DELETE FROM slide_deck`;
    } finally {
      await app.close();
      await handle.close();
    }
  });
});

describe('Idempotency-Key bei Uploads', () => {
  it('Wiederholung (auch mit neuem Boundary) liefert die erste Antwort, ohne etwas neu anzulegen', async () => {
    const key = uuidv7();
    const data = fakePdf('idem', 500);
    const first = await upload(
      '/slide-decks',
      { module_id: moduleId },
      { data },
      { 'idempotency-key': key },
      '----eins',
    );
    expect(first.statusCode).toBe(201);
    const again = await upload(
      '/slide-decks',
      { module_id: moduleId },
      { data },
      { 'idempotency-key': key },
      '----zwei-anders-lang',
    );
    expect(again.statusCode).toBe(201);
    expect(again.headers['idempotent-replay']).toBe('true');
    expect(again.body).toBe(first.body);
    expect(await counts()).toEqual({ decks: 1, sheets: 0, jobs: 1 });
    expect(
      await eventually(
        () => tmpFiles(t.config.dataDir),
        (f) => f.length === 0,
      ),
    ).toEqual([]);
  });

  it('gleicher Key, gleiche Länge, anderer Inhalt → 422 idempotency_key_reused', async () => {
    const key = uuidv7();
    const a = fakePdf('AAAAAAAA');
    const b = fakePdf('BBBBBBBB');
    expect(a.length).toBe(b.length);
    const first = await upload(
      '/slide-decks',
      { module_id: moduleId },
      { data: a },
      { 'idempotency-key': key },
      '----gleich',
    );
    expect(first.statusCode).toBe(201);
    const second = await upload(
      '/slide-decks',
      { module_id: moduleId },
      { data: b },
      { 'idempotency-key': key },
      '----gleich',
    );
    expect(second.statusCode).toBe(422);
    expect(ApiErrorSchema.parse(second.json()).error.code).toBe('idempotency_key_reused');
    expect(await counts()).toEqual({ decks: 1, sheets: 0, jobs: 1 });
    expect(
      await eventually(
        () => tmpFiles(t.config.dataDir),
        (f) => f.length === 0,
      ),
    ).toEqual([]);
  });

  it('gleicher Key, gleiche Datei, anderes Feld → 422', async () => {
    const key = uuidv7();
    const data = fakePdf('felder');
    await upload('/slide-decks', { module_id: moduleId, title: 'A' }, { data }, { 'idempotency-key': key });
    const second = await upload(
      '/slide-decks',
      { module_id: moduleId, title: 'B' },
      { data },
      { 'idempotency-key': key },
    );
    expect(second.statusCode).toBe(422);
  });
});

describe('Foliensätze lesen, ändern, löschen', () => {
  async function createDeck(data = fakePdf(), fields: Record<string, string> = {}) {
    const res = await uploadDeck({ module_id: moduleId, ...fields }, { data, filename: 'Skript.pdf' });
    expect(res.statusCode).toBe(201);
    return UploadResultSchema.parse(res.json()).id;
  }

  async function addSlides(deckId: string, count: number, withFiles = true) {
    const ids: string[] = [];
    for (let i = count; i >= 1; i--) {
      // absichtlich rückwärts einfügen: die Antwort muss nach Index sortiert sein
      const id = uuidv7();
      ids.unshift(id);
      const image = `media/decks/${deckId}/slides/${i}.png`;
      const thumb = `media/decks/${deckId}/thumbs/${i}.webp`;
      if (withFiles) {
        mkdirSync(join(t.config.dataDir, 'media', 'decks', deckId, 'slides'), { recursive: true });
        mkdirSync(join(t.config.dataDir, 'media', 'decks', deckId, 'thumbs'), { recursive: true });
        writeFileSync(join(t.config.dataDir, image), Buffer.from(`PNG-${i}`));
        writeFileSync(join(t.config.dataDir, thumb), Buffer.from(`WEBP-${i}`));
      }
      await t.handle.sql`
        INSERT INTO slide (id, user_id, deck_id, index, image_path, thumb_path, width_pt, height_pt, text, text_blocks, title)
        VALUES (${id}, ${SINGLE_USER_ID}, ${deckId}, ${i}, ${withFiles ? image : null}, ${withFiles ? thumb : null},
                960, 540, ${`Text ${i}`}, ${JSON.stringify([{ text: `Text ${i}`, bbox: [10, 20, 100, 30] }])}::jsonb, ${`Folie ${i}`})`;
    }
    return ids;
  }

  it('Detail liefert Foliensatz und Folien nach Index sortiert', async () => {
    const deckId = await createDeck();
    await addSlides(deckId, 3);
    const res = await t.request({ url: `${API}/slide-decks/${deckId}` });
    expect(res.statusCode).toBe(200);
    const body = SlideDeckDetailSchema.parse(res.json());
    expect(body.deck.id).toBe(deckId);
    expect(body.slides.map((s) => s.index)).toEqual([1, 2, 3]);
    expect(body.slides[0]).toMatchObject({ title: 'Folie 1', width_pt: 960, text: 'Text 1' });
    expect(body.slides[0]!.text_blocks[0]).toEqual({ text: 'Text 1', bbox: [10, 20, 100, 30] });
  });

  it('GET /slides/{id}, /image und /thumb', async () => {
    const deckId = await createDeck();
    const [first] = await addSlides(deckId, 2);
    const slide = await t.request({ url: `${API}/slides/${first}` });
    expect(SlideSchema.parse(slide.json()).deck_id).toBe(deckId);

    const image = await t.request({ url: `${API}/slides/${first}/image` });
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toBe('image/png');
    expect(image.headers['cache-control']).toContain('max-age=31536000');
    expect(image.body).toBe('PNG-1');
    const etag = String(image.headers.etag);
    expect(etag).toMatch(/^".+"$/);
    const cached = await t.request({
      url: `${API}/slides/${first}/image`,
      headers: { 'if-none-match': etag },
    });
    expect(cached.statusCode).toBe(304);

    const thumb = await t.request({ url: `${API}/slides/${first}/thumb` });
    expect(thumb.headers['content-type']).toBe('image/webp');
    expect(thumb.body).toBe('WEBP-1');
  });

  it('Folienbild noch nicht fertig → 404 file_not_found; unbekannte Folie → 404', async () => {
    const deckId = await createDeck();
    const [first] = await addSlides(deckId, 1, false);
    const res = await t.request({ url: `${API}/slides/${first}/image` });
    expect(res.statusCode).toBe(404);
    expect(ApiErrorSchema.parse(res.json()).error.code).toBe('file_not_found');
    const unknown = await t.request({ url: `${API}/slides/${uuidv7()}/thumb` });
    expect(unknown.statusCode).toBe(404);
    expect(ApiErrorSchema.parse(unknown.json()).error.code).toBe('slide_not_found');
  });

  it('liefert das Original-PDF aus, Range-fähig', async () => {
    const data = fakePdf('range', 1000);
    const deckId = await createDeck(data);
    const url = `${API}/slide-decks/${deckId}/file`;

    const full = await t.request({ url });
    expect(full.statusCode).toBe(200);
    expect(full.headers['content-type']).toBe('application/pdf');
    expect(full.headers['accept-ranges']).toBe('bytes');
    expect(Number(full.headers['content-length'])).toBe(data.length);
    expect(String(full.headers['content-disposition'])).toContain('inline');
    expect(full.rawPayload.equals(data)).toBe(true);

    const part = await t.request({ url, headers: { range: 'bytes=0-4' } });
    expect(part.statusCode).toBe(206);
    expect(part.headers['content-range']).toBe(`bytes 0-4/${data.length}`);
    expect(part.body).toBe('%PDF-');

    const suffix = await t.request({ url, headers: { range: 'bytes=-7' } });
    expect(suffix.statusCode).toBe(206);
    expect(suffix.rawPayload.equals(data.subarray(data.length - 7))).toBe(true);

    const open = await t.request({ url, headers: { range: `bytes=${data.length - 3}-` } });
    expect(open.statusCode).toBe(206);
    expect(open.rawPayload.equals(data.subarray(data.length - 3))).toBe(true);

    const beyond = await t.request({ url, headers: { range: `bytes=${data.length + 10}-` } });
    expect(beyond.statusCode).toBe(416);
    expect(beyond.headers['content-range']).toBe(`bytes */${data.length}`);

    const cached = await t.request({ url, headers: { 'if-none-match': String(full.headers.etag) } });
    expect(cached.statusCode).toBe(304);
    expect(full.headers.etag).toBe(`"${sha256(data)}"`);
  });

  it('parseRange', () => {
    expect(parseRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange('bytes=90-200', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-500', 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=100-', 100)).toBe('unsatisfiable');
    expect(parseRange('bytes=5-2', 100)).toBe('unsatisfiable');
    expect(parseRange('bytes=0-1,5-6', 100)).toBeNull();
    expect(parseRange('items=0-1', 100)).toBeNull();
  });

  it('Liste mit Modulfilter und Cursor', async () => {
    const a = await createDeck();
    const b = await createDeck();
    const c = await createDeck(fakePdf(), {});
    await uploadDeck({ module_id: otherModuleId });

    const all = SlideDeckListSchema.parse(
      (await t.request({ url: `${API}/slide-decks?module_id=${moduleId}` })).json(),
    );
    expect(all.items.map((d) => d.id)).toEqual([c, b, a]); // neueste zuerst
    expect(all.next_cursor).toBeNull();

    const page1 = SlideDeckListSchema.parse(
      (await t.request({ url: `${API}/slide-decks?module_id=${moduleId}&limit=2` })).json(),
    );
    expect(page1.items).toHaveLength(2);
    expect(page1.next_cursor).not.toBeNull();
    const page2 = SlideDeckListSchema.parse(
      (
        await t.request({
          url: `${API}/slide-decks?module_id=${moduleId}&limit=2&cursor=${page1.next_cursor}`,
        })
      ).json(),
    );
    expect(page2.items.map((d) => d.id)).toEqual([a]);

    const everything = SlideDeckListSchema.parse((await t.request({ url: `${API}/slide-decks` })).json());
    expect(everything.items).toHaveLength(4);
  });

  it('PATCH ohne Titel ändert nichts', async () => {
    const id = await createDeck();
    const res = await t.request({ method: 'PATCH', url: `${API}/slide-decks/${id}`, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(SlideDeckSchema.parse(res.json()).title).toBe('Skript');
  });

  it('PATCH ändert den Titel, leerer Titel → 400, unbekannt → 404', async () => {
    const id = await createDeck();
    const res = await t.request({
      method: 'PATCH',
      url: `${API}/slide-decks/${id}`,
      payload: { title: '  Neuer Titel  ' },
    });
    expect(res.statusCode).toBe(200);
    expect(SlideDeckSchema.parse(res.json()).title).toBe('Neuer Titel');

    const empty = await t.request({
      method: 'PATCH',
      url: `${API}/slide-decks/${id}`,
      payload: { title: '   ' },
    });
    expect(empty.statusCode).toBe(400);
    const extra = await t.request({
      method: 'PATCH',
      url: `${API}/slide-decks/${id}`,
      payload: { title: 'x', sha256: 'y' },
    });
    expect(extra.statusCode).toBe(400);
    const unknown = await t.request({
      method: 'PATCH',
      url: `${API}/slide-decks/${uuidv7()}`,
      payload: { title: 'x' },
    });
    expect(unknown.statusCode).toBe(404);
    expect(ApiErrorSchema.parse(unknown.json()).error.code).toBe('slide_deck_not_found');
  });

  it('DELETE ist ein Soft-Delete: danach 404 überall, Zeile bleibt mit deleted_at', async () => {
    const id = await createDeck();
    const [slideId] = await addSlides(id, 1);
    const del = await t.request({ method: 'DELETE', url: `${API}/slide-decks/${id}` });
    expect(del.statusCode).toBe(204);
    expect(del.body).toBe('');

    for (const url of [
      `/slide-decks/${id}`,
      `/slide-decks/${id}/file`,
      `/slides/${slideId}`,
      `/slides/${slideId}/image`,
    ]) {
      const res = await t.request({ url: `${API}${url}` });
      expect(res.statusCode, url).toBe(404);
    }
    const list = SlideDeckListSchema.parse((await t.request({ url: `${API}/slide-decks` })).json());
    expect(list.items).toEqual([]);
    const [row] = await t.handle.sql`SELECT deleted_at FROM slide_deck WHERE id = ${id}`;
    expect(row!.deleted_at).not.toBeNull();
    const again = await t.request({ method: 'DELETE', url: `${API}/slide-decks/${id}` });
    expect(again.statusCode).toBe(404);
  });

  it('ungültige oder unbekannte IDs', async () => {
    expect((await t.request({ url: `${API}/slide-decks/keine-uuid` })).statusCode).toBe(400);
    expect((await t.request({ url: `${API}/slide-decks/${uuidv7()}` })).statusCode).toBe(404);
    expect((await t.request({ url: `${API}/slide-decks/${uuidv7()}/file` })).statusCode).toBe(404);
  });
});

describe('Übungsblätter', () => {
  async function createSheet(fields: Record<string, string> = {}, data = fakePdf()) {
    const res = await uploadSheet({ module_id: moduleId, ...fields }, { data, filename: 'Blatt 02.pdf' });
    expect(res.statusCode).toBe(201);
    return UploadResultSchema.parse(res.json()).id;
  }

  it('Upload mit Nummer und Abgabedatum, Job mit exercise_sheet_id', async () => {
    const data = fakePdf('blatt');
    const id = await createSheet({ number: '2', due_at: '2026-11-20T12:00:00Z', title: '  ' }, data);
    const res = await t.request({ url: `${API}/exercise-sheets/${id}` });
    const sheet = ExerciseSheetSchema.parse(res.json());
    expect(sheet).toMatchObject({
      module_id: moduleId,
      title: 'Blatt 02', // leerer Titel → Dateiname
      number: 2,
      due_at: '2026-11-20T12:00:00.000Z',
      sha256: sha256(data),
      page_count: null,
      has_solution: false,
      ingest_state: 'neu',
    });
    expect(Object.keys(sheet)).not.toContain('file_path');
    const [row] = await t.handle.sql`SELECT file_path FROM exercise_sheet WHERE id = ${id}`;
    expect(row!.file_path).toBe(`media/sheets/${id}/original.pdf`);
    expect(readFileSync(join(t.config.dataDir, row!.file_path as string)).equals(data)).toBe(true);
    const jobs = await t.handle.sql`SELECT type, payload FROM job`;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.type).toBe('pdf.ingest');
    expect(jobs[0]!.payload).toEqual({ exercise_sheet_id: id });
    expect(PdfIngestPayloadSchema.safeParse(jobs[0]!.payload).success).toBe(true);
  });

  it('Duplikat, falsches Format, ungültige Felder', async () => {
    const data = fakePdf('blatt-dup');
    const id = await createSheet({}, data);
    const dup = await uploadSheet({ module_id: moduleId }, { data });
    expect(dup.statusCode).toBe(200);
    expect(UploadResultSchema.parse(dup.json())).toEqual({ id, duplicate: true });

    const bad = await uploadSheet({ module_id: moduleId }, { data: Buffer.from('nope') });
    expect(bad.statusCode).toBe(400);
    expect(ApiErrorSchema.parse(bad.json()).error.code).toBe('invalid_pdf');

    const badDate = await uploadSheet({ module_id: moduleId, due_at: 'morgen' });
    expect(badDate.statusCode).toBe(400);
    expect(ApiErrorSchema.parse(badDate.json()).error.code).toBe('validation_failed');
    const badNumber = await uploadSheet({ module_id: moduleId, number: 'zwei' });
    expect(badNumber.statusCode).toBe(400);
    expect(await counts()).toEqual({ decks: 0, sheets: 1, jobs: 1 });
  });

  it('Liste, PATCH, Datei und DELETE', async () => {
    const data = fakePdf('blatt-file', 300);
    const a = await createSheet({}, data);
    const b = await createSheet({ title: 'Zweites' });
    const list = ExerciseSheetListSchema.parse(
      (await t.request({ url: `${API}/exercise-sheets?module_id=${moduleId}` })).json(),
    );
    expect(list.items.map((s) => s.id)).toEqual([b, a]);
    expect(
      ExerciseSheetListSchema.parse(
        (await t.request({ url: `${API}/exercise-sheets?module_id=${otherModuleId}` })).json(),
      ).items,
    ).toEqual([]);

    const patched = await t.request({
      method: 'PATCH',
      url: `${API}/exercise-sheets/${a}`,
      payload: { title: 'Neu', number: 5, due_at: '2026-12-01T08:00:00+01:00' },
    });
    expect(patched.statusCode).toBe(200);
    expect(ExerciseSheetSchema.parse(patched.json())).toMatchObject({
      title: 'Neu',
      number: 5,
      due_at: '2026-12-01T07:00:00.000Z',
    });
    const cleared = await t.request({
      method: 'PATCH',
      url: `${API}/exercise-sheets/${a}`,
      payload: { due_at: null, number: null },
    });
    expect(ExerciseSheetSchema.parse(cleared.json())).toMatchObject({
      title: 'Neu',
      number: null,
      due_at: null,
    });
    const noop = await t.request({ method: 'PATCH', url: `${API}/exercise-sheets/${a}`, payload: {} });
    expect(noop.statusCode).toBe(200);
    expect(
      (await t.request({ method: 'PATCH', url: `${API}/exercise-sheets/${a}`, payload: { title: ' ' } }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await t.request({
          method: 'PATCH',
          url: `${API}/exercise-sheets/${uuidv7()}`,
          payload: { title: 'x' },
        })
      ).statusCode,
    ).toBe(404);

    const file = await t.request({
      url: `${API}/exercise-sheets/${a}/file`,
      headers: { range: 'bytes=0-7' },
    });
    expect(file.statusCode).toBe(206);
    expect(file.rawPayload.equals(data.subarray(0, 8))).toBe(true);

    expect((await t.request({ method: 'DELETE', url: `${API}/exercise-sheets/${a}` })).statusCode).toBe(204);
    for (const url of [`/exercise-sheets/${a}`, `/exercise-sheets/${a}/file`]) {
      expect((await t.request({ url: `${API}${url}` })).statusCode, url).toBe(404);
    }
    expect((await t.request({ method: 'DELETE', url: `${API}/exercise-sheets/${a}` })).statusCode).toBe(404);
    const rest = ExerciseSheetListSchema.parse((await t.request({ url: `${API}/exercise-sheets` })).json());
    expect(rest.items.map((s) => s.id)).toEqual([b]);
  });

  it('Seitenbilder: nur im Seitenbereich und wenn die Datei da ist', async () => {
    const id = await createSheet();
    const base = join(t.config.dataDir, 'media', 'sheets', id);
    mkdirSync(join(base, 'pages'), { recursive: true });
    mkdirSync(join(base, 'thumbs'), { recursive: true });
    writeFileSync(join(base, 'pages', '1.png'), 'SEITE-1');
    writeFileSync(join(base, 'thumbs', '1.webp'), 'VORSCHAU-1');

    // pdf.ingest noch nicht gelaufen (page_count null)
    expect((await t.request({ url: `${API}/exercise-sheets/${id}/pages/1/image` })).statusCode).toBe(404);

    await t.handle
      .sql`UPDATE exercise_sheet SET page_count = 2, ingest_state = 'verarbeitet' WHERE id = ${id}`;
    const image = await t.request({ url: `${API}/exercise-sheets/${id}/pages/1/image` });
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toBe('image/png');
    expect(image.body).toBe('SEITE-1');
    const thumb = await t.request({ url: `${API}/exercise-sheets/${id}/pages/1/thumb` });
    expect(thumb.headers['content-type']).toBe('image/webp');
    expect(thumb.body).toBe('VORSCHAU-1');

    expect((await t.request({ url: `${API}/exercise-sheets/${id}/pages/2/image` })).statusCode).toBe(404); // Datei fehlt
    const outside = await t.request({ url: `${API}/exercise-sheets/${id}/pages/3/image` });
    expect(outside.statusCode).toBe(404);
    expect(ApiErrorSchema.parse(outside.json()).error.code).toBe('page_not_found');
    expect((await t.request({ url: `${API}/exercise-sheets/${id}/pages/0/image` })).statusCode).toBe(400);
    expect((await t.request({ url: `${API}/exercise-sheets/${id}/pages/../image` })).statusCode).toBe(404);
    expect((await t.request({ url: `${API}/exercise-sheets/${id}/pages/abc/image` })).statusCode).toBe(400);
  });
});

describe('Netzwerkzugriff und OpenAPI', () => {
  it('Uploads aus dem Netz ohne Token werden abgewiesen, bevor der Body gelesen wird', async () => {
    const body = multipartBody([
      { name: 'module_id', value: moduleId },
      { name: 'file', filename: 'a.pdf', contentType: 'application/pdf', data: fakePdf() },
    ]);
    const res = await t.app.inject({
      method: 'POST',
      url: `${API}/slide-decks`,
      remoteAddress: '192.168.1.20',
      payload: body.payload,
      headers: { ...body.headers, host: `192.168.1.5:${t.config.port}` },
    });
    expect(res.statusCode).toBe(401);
    expect(await counts()).toEqual({ decks: 0, sheets: 0, jobs: 0 });
  });

  it('Routen erscheinen in der OpenAPI-Beschreibung', async () => {
    const doc = (await t.request({ url: `${API}/openapi.json` })).json();
    const paths = Object.keys(doc.paths);
    for (const p of [
      '/api/v1/slide-decks',
      '/api/v1/slide-decks/{id}/file',
      '/api/v1/slides/{id}/thumb',
      '/api/v1/exercise-sheets/{id}/pages/{index}/image',
    ]) {
      expect(paths).toContain(p);
    }
  });
});
