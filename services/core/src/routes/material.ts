// Material-Endpunkte (08 §1 „Material“): Foliensätze, Folien, Übungsblätter, Upload und Dateiauslieferung
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import multipart from '@fastify/multipart';
import { inArray, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ApiErrorSchema,
  ExerciseSheetListSchema,
  ExerciseSheetSchema,
  ExerciseSheetUpdateSchema,
  SlideDeckDetailSchema,
  SlideDeckListSchema,
  SlideDeckSchema,
  SlideDeckUpdateSchema,
  SlideSchema,
  UploadResultSchema,
  UuidSchema,
} from '@sg/shared';
import type { Config } from '../config.ts';
import type { Db } from '../db/client.ts';
import { exerciseSheet, slideDeck } from '../db/schema/index.ts';
import { HttpError } from '../errors.ts';
import { asciiFallback, encodeExtValue } from '../moodle/content-disposition.ts';
import { PageQuerySchema } from '../lib/pagination.ts';
import { uuidv7 } from '../lib/uuid7.ts';
import {
  createExerciseSheet,
  createSlideDeck,
  deleteExerciseSheet,
  deleteSlideDeck,
  getDeckRow,
  getSheetRow,
  getSlideDeckDetail,
  getSlideWithDeck,
  listExerciseSheets,
  listSlideDecks,
  renameSlideDeck,
  resolveDataPath,
  toApiDeck,
  toApiSheet,
  toApiSlide,
  updateExerciseSheet,
  uploadTmpDir,
  type StoredUpload,
} from '../services/material.ts';

/** Größtes erlaubtes PDF (Foliensätze mit vielen Bildern, F-ORG-02) */
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
/** Veraltete temporäre Uploads und Ordner ohne DB-Zeile (Absturz mitten im Upload) werden nach so vielen Minuten entfernt */
const STALE_MINUTES = 60;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const PDF_MAGIC = Buffer.from('%PDF');
/** `%PDF` darf in den ersten 1024 Bytes stehen (PDF-Spezifikation, Acrobat-Toleranz) */
const MAGIC_WINDOW = 1024;
const ACCEPTED_MIME = new Set(['application/pdf', 'application/x-pdf', 'application/octet-stream', '']);
const IMMUTABLE_CACHE = 'private, max-age=31536000, immutable';
/** Erhöhen, wenn sich die Darstellung der Seitenbilder ändert (neuer ETag) */
const IMAGE_ETAG_VERSION = 'v1';

export interface MaterialRouteDeps {
  db: Db;
  config: Pick<Config, 'dataDir'>;
  /** Nur für Tests: kleineres Größenlimit */
  maxUploadBytes?: number;
}

interface ParsedUpload {
  file: StoredUpload;
  fields: Record<string, string>;
}

declare module 'fastify' {
  interface FastifyRequest {
    upload?: ParsedUpload;
  }
}

// ---------- Upload-Parser ----------

async function discard(stream: NodeJS.ReadableStream): Promise<void> {
  // Rest verwerfen, damit die Verbindung sauber weiterläuft
  for await (const chunk of stream) void chunk;
}

/**
 * Liest den multipart-Body (Feld `file` + Textfelder) im `preValidation`, also vor der
 * Idempotency-Prüfung: Die Datei geht gestreamt in eine temporäre Datei im Datenordner, dabei
 * entstehen `sha256` und Größe. Der Fingerabdruck (Datei + Felder) fließt in den Idempotency-Hash.
 */
function createUploadParser(dataDir: string, maxBytes: number) {
  return async function parseUpload(request: FastifyRequest): Promise<void> {
    if (!request.isMultipart()) {
      throw new HttpError(
        415,
        'multipart_required',
        'Erwartet wird multipart/form-data mit dem Feld „file“.',
      );
    }
    const tmpDir = uploadTmpDir(dataDir);
    await mkdir(tmpDir, { recursive: true });
    const fields: Record<string, string> = {};
    let stored: StoredUpload | undefined;
    let problem: HttpError | undefined;
    try {
      for await (const part of request.parts()) {
        if (part.type === 'field') {
          if (typeof part.value === 'string' && !(part.fieldname in fields))
            fields[part.fieldname] = part.value;
          continue;
        }
        if (part.fieldname !== 'file' || stored || problem) {
          problem ??= new HttpError(400, 'unexpected_file', 'Erwartet wird genau eine Datei im Feld „file“.');
          await discard(part.file);
          continue;
        }
        const mimetype = part.mimetype.toLowerCase().split(';')[0]?.trim() ?? '';
        const tmpPath = join(tmpDir, `${uuidv7()}.upload`);
        const hash = createHash('sha256');
        let size = 0;
        let magicOk = false;
        try {
          await pipeline(
            part.file,
            async function* (source: AsyncIterable<Buffer>) {
              // Die ersten MAGIC_WINDOW Bytes puffern: `%PDF` darf (laut PDF-Spezifikation) nach
              // etwas Vorspann stehen. Kein PDF: nur noch mitlesen, nichts schreiben.
              const pending: Buffer[] = [];
              let pendingSize = 0;
              let decided = false;
              for await (const chunk of source) {
                hash.update(chunk);
                size += chunk.length;
                if (decided) {
                  if (magicOk) yield chunk;
                  continue;
                }
                pending.push(chunk);
                pendingSize += chunk.length;
                if (pendingSize >= MAGIC_WINDOW) {
                  decided = true;
                  const head = Buffer.concat(pending);
                  magicOk = head.subarray(0, MAGIC_WINDOW).includes(PDF_MAGIC) && ACCEPTED_MIME.has(mimetype);
                  if (magicOk) yield head;
                }
              }
              if (!decided) {
                const head = Buffer.concat(pending);
                magicOk = head.includes(PDF_MAGIC) && ACCEPTED_MIME.has(mimetype);
                if (magicOk) yield head;
              }
            },
            createWriteStream(tmpPath),
          );
        } catch (error) {
          await rm(tmpPath, { force: true });
          throw error;
        }
        if (part.file.truncated) {
          await rm(tmpPath, { force: true });
          problem = new HttpError(
            413,
            'file_too_large',
            `Die Datei ist größer als ${Math.floor(maxBytes / (1024 * 1024))} MB.`,
          );
        } else if (size === 0 || !magicOk || !ACCEPTED_MIME.has(mimetype)) {
          await rm(tmpPath, { force: true });
          problem = new HttpError(400, 'invalid_pdf', 'Die Datei ist kein gültiges PDF.');
        } else {
          stored = { tmpPath, size, sha256: hash.digest('hex'), filename: part.filename ?? '' };
        }
      }
    } catch (error) {
      if (stored) await rm(stored.tmpPath, { force: true });
      const code = (error as { code?: string }).code;
      const message = error instanceof Error ? error.message : '';
      if (
        request.raw.aborted ||
        code === 'FST_MP_PREMATURE_CLOSE' ||
        code === 'ERR_STREAM_PREMATURE_CLOSE' ||
        message.includes('terminated early')
      ) {
        // Client hat abgebrochen: kein Serverfehler
        request.log.info('Upload vom Client abgebrochen');
        throw new HttpError(400, 'upload_aborted', 'Der Upload wurde abgebrochen.');
      }
      throw error;
    }
    if (problem) {
      if (stored) await rm(stored.tmpPath, { force: true });
      throw problem;
    }
    if (!stored) throw new HttpError(400, 'file_missing', 'Das Feld „file“ mit dem PDF fehlt.');

    request.upload = { file: stored, fields };
    request.idempotencyFingerprint = createHash('sha256')
      .update(JSON.stringify([stored.sha256, stored.size, stored.filename, Object.entries(fields).sort()]))
      .digest('hex');
  };
}

/** Räumt die temporäre Datei auf, falls der Handler sie nicht (mehr) braucht (Dublette, Fehler, Replay) */
async function cleanupUpload(request: FastifyRequest): Promise<void> {
  if (request.upload) await rm(request.upload.file.tmpPath, { force: true }).catch(() => {});
}

/** Entfernt temporäre Uploads, die älter als `STALE_MINUTES` sind */
async function removeStaleTmp(dataDir: string): Promise<void> {
  const dir = uploadTmpDir(dataDir);
  const limit = Date.now() - STALE_MINUTES * 60 * 1000;
  try {
    for (const name of await readdir(dir)) {
      const path = join(dir, name);
      const info = await stat(path).catch(() => null);
      if (info && info.mtimeMs < limit) await rm(path, { force: true });
    }
  } catch {
    // Ordner existiert noch nicht: nichts zu tun
  }
}

const UUID_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Höchstens so viele Waisen (und höchstens dieser Anteil) gelten als plausibel; mehr = DB passt nicht zum Datenordner */
const ORPHAN_MAX_COUNT = 3;
const ORPHAN_MAX_SHARE = 0.1;

interface SweepLog {
  warn: (obj: object, msg: string) => void;
}

/**
 * Verschiebt `media/decks|sheets/<id>/`-Ordner ohne DB-Zeile (Absturz zwischen `rename` und Commit),
 * die älter als `STALE_MINUTES` sind, nach `media/.orphaned/<typ>/<id>`. Es wird NIE gelöscht:
 * Endgültiges Löschen gibt es erst mit dem Papierkorb (F-DAT-04). Zeilen mit `deleted_at` zählen als vorhanden.
 *
 * Schutzschalter gegen eine DB, die nicht zum Datenordner passt (falsche DATABASE_URL, altes Backup):
 * Hat die Tabelle 0 Zeilen, es gibt aber Ordner, oder gelten mehr als 3 Ordner bzw. mehr als 10 % als
 * verwaist, wird übersprungen und gewarnt.
 */
export async function sweepOrphanFolders(db: Db, dataDir: string, log: SweepLog): Promise<number> {
  const limit = Date.now() - STALE_MINUTES * 60 * 1000;
  let moved = 0;
  for (const [folder, table] of [
    ['decks', slideDeck],
    ['sheets', exerciseSheet],
  ] as const) {
    const root = join(dataDir, 'media', folder);
    const all = (await readdir(root).catch(() => [] as string[])).filter((name) => UUID_NAME.test(name));
    if (all.length === 0) continue;
    const [{ n = 0 } = {}] = await db.select({ n: sql<number>`count(*)::int` }).from(table);
    if (n === 0) {
      log.warn(
        { folder, folders: all.length },
        'Tabelle leer, aber Ordner vorhanden: Aufräumen übersprungen',
      );
      continue;
    }
    const old: string[] = [];
    for (const name of all) {
      const info = await stat(join(root, name)).catch(() => null);
      if (info && info.mtimeMs < limit) old.push(name);
    }
    if (old.length === 0) continue;
    const known = new Set(
      (await db.select({ id: table.id }).from(table).where(inArray(table.id, old))).map((row) => row.id),
    );
    const orphans = old.filter((name) => !known.has(name));
    if (orphans.length === 0) continue;
    if (orphans.length > ORPHAN_MAX_COUNT || orphans.length / all.length > ORPHAN_MAX_SHARE) {
      log.warn(
        { folder, orphans: orphans.length, folders: all.length },
        'Zu viele verwaiste Ordner, DB passt offenbar nicht zum Datenordner: Aufräumen übersprungen',
      );
      continue;
    }
    const target = join(dataDir, 'media', '.orphaned', folder);
    await mkdir(target, { recursive: true });
    for (const name of orphans) {
      const dest = existsSync(join(target, name)) ? `${name}.${Date.now()}` : name;
      await rename(join(root, name), join(target, dest));
      moved++;
    }
    log.warn({ folder, moved: orphans.length }, 'Verwaiste Ordner nach media/.orphaned verschoben');
  }
  return moved;
}

// ---------- Felder prüfen ----------

const emptyToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;
const optionalTitle = z.preprocess(emptyToUndefined, z.string().trim().min(1).max(300).optional());

const DeckFieldsSchema = z.object({
  module_id: UuidSchema,
  session_id: z.preprocess(emptyToUndefined, UuidSchema.optional()),
  title: optionalTitle,
});

const SheetFieldsSchema = z.object({
  module_id: UuidSchema,
  title: optionalTitle,
  number: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).max(10_000).optional()),
  due_at: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .datetime({ offset: true })
      .transform((value) => new Date(value))
      .optional(),
  ),
});

function parseFields<S extends z.ZodType>(schema: S, fields: Record<string, string>): z.infer<S> {
  const parsed = schema.safeParse(fields);
  if (!parsed.success) {
    throw new HttpError(400, 'validation_failed', 'Die Anfrage ist ungültig.', {
      in: 'body',
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return parsed.data;
}

// ---------- Dateiauslieferung (Range, ETag) ----------

type ByteRange = { start: number; end: number } | 'unsatisfiable' | null;

/** Eine einzelne Bytespanne (`bytes=a-b`, `a-`, `-n`). Mehrere Spannen: ignoriert (ganze Datei). */
export function parseRange(header: string, size: number): ByteRange {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, from = '', to = ''] = match;
  if (from === '' && to === '') return null;
  if (from === '') {
    const suffix = Number(to);
    if (suffix === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(size - suffix, 0), end: size - 1 };
  }
  const start = Number(from);
  const end = to === '' ? size - 1 : Math.min(Number(to), size - 1);
  if (start >= size || end < start) return 'unsatisfiable';
  return { start, end };
}

function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header
    .split(',')
    .map((value) => value.trim().replace(/^W\//, ''))
    .some((value) => value === etag || value === '*');
}

interface ServeOptions {
  path: string | null;
  contentType: string;
  etag: string;
  disposition?: string;
}

async function serveFile(request: FastifyRequest, reply: FastifyReply, options: ServeOptions) {
  const info = options.path ? await stat(options.path).catch(() => null) : null;
  if (!options.path || !info?.isFile()) {
    throw new HttpError(404, 'file_not_found', 'Die Datei ist (noch) nicht vorhanden.');
  }
  reply
    .header('content-type', options.contentType)
    .header('etag', options.etag)
    .header('cache-control', IMMUTABLE_CACHE)
    .header('accept-ranges', 'bytes');
  if (options.disposition) reply.header('content-disposition', options.disposition);

  if (etagMatches(request.headers['if-none-match'], options.etag)) return reply.code(304).send();

  const rangeHeader = request.headers.range;
  const ifRange = request.headers['if-range'];
  const range =
    rangeHeader && (!ifRange || ifRange === options.etag) ? parseRange(rangeHeader, info.size) : null;
  if (range === 'unsatisfiable') {
    return reply
      .code(416)
      .header('content-range', `bytes */${info.size}`)
      .header('content-type', 'application/json; charset=utf-8')
      .send({ error: { code: 'range_not_satisfiable', message: 'Der Bereich liegt außerhalb der Datei.' } });
  }
  if (range) {
    return reply
      .code(206)
      .header('content-range', `bytes ${range.start}-${range.end}/${info.size}`)
      .header('content-length', range.end - range.start + 1)
      .send(createReadStream(options.path, { start: range.start, end: range.end }));
  }
  return reply.header('content-length', info.size).send(createReadStream(options.path));
}

/**
 * `inline; filename="<ASCII-Ersatz>"; filename*=UTF-8''<RFC-8187-kodiert>` für den Titel. Kodiert mit dem
 * Encoder aus `moodle/content-disposition.ts`: `encodeURIComponent` lässt `'()*` stehen, das verstößt
 * gegen RFC 8187 (`attr-char`).
 */
export function pdfDisposition(title: string): string {
  const name = `${title}.pdf`;
  return `inline; filename="${asciiFallback(name)}"; filename*=UTF-8''${encodeExtValue(name)}`;
}

// ---------- Routen ----------

const IdParams = z.object({ id: UuidSchema });
const PageParams = z.object({ id: UuidSchema, index: z.coerce.number().int().min(1) });
const ListQuery = PageQuerySchema.extend({ module_id: UuidSchema.optional() });
const errorResponses = { 400: ApiErrorSchema, 404: ApiErrorSchema } as const;

export async function materialRoutes(app: FastifyInstance, deps: MaterialRouteDeps): Promise<void> {
  const { db } = deps;
  const dataDir = deps.config.dataDir;
  const maxBytes = deps.maxUploadBytes ?? MAX_UPLOAD_BYTES;
  const typed = app.withTypeProvider<ZodTypeProvider>();

  const multipartOptions = {
    // Dateigröße prüft der Parser selbst (`file.truncated`) und antwortet dann mit `file_too_large`
    throwFileSizeLimit: false,
    defParamCharset: 'utf8',
    limits: { fileSize: maxBytes, files: 5, fields: 20, fieldSize: 4096, parts: 30 },
  };
  await app.register(multipart, multipartOptions);
  // Aufräumen beim Start und danach regelmäßig. Erst nach erfolgreichem `listen` (`onListen`): Ein zweiter Core,
  // der mit `EADDRINUSE` scheitert, verschiebt keine Ordner und löscht keine Uploads (#170)
  let sweeping: Promise<void> | null = null;
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  const sweep = () => {
    if (sweeping || stopped) return;
    sweeping = removeStaleTmp(dataDir)
      .then(() => sweepOrphanFolders(db, dataDir, app.log))
      .then(() => {})
      .catch((error: unknown) => app.log.warn({ err: error }, 'Aufräumen der Uploads fehlgeschlagen'))
      .finally(() => {
        sweeping = null;
      });
  };
  app.addHook('onListen', async () => {
    if (timer || stopped) return;
    timer = setInterval(sweep, CLEANUP_INTERVAL_MS);
    timer.unref();
    sweep();
  });
  app.addHook('onClose', async () => {
    stopped = true;
    clearInterval(timer);
    await sweeping;
  });

  const parseUpload = createUploadParser(dataDir, maxBytes);
  const uploadHooks = {
    preValidation: parseUpload,
    // Replay, 409 und Fehlerantworten kommen, ohne dass der Handler läuft; der Abbruch des Clients ebenso
    onResponse: cleanupUpload,
    onRequestAbort: cleanupUpload,
  };

  // ----- Foliensätze -----

  typed.post(
    '/slide-decks',
    {
      ...uploadHooks,
      schema: {
        tags: ['Material'],
        summary: 'Foliensatz hochladen',
        description:
          'multipart/form-data. Felder: `file` (PDF, Pflicht), `module_id` (UUID, Pflicht), `session_id` (UUID), `title`. Gleiche Datei im selben Modul: 200 mit duplicate=true. Ein gescheiterter Foliensatz wird dabei neu eingelesen.',
        consumes: ['multipart/form-data'],
        response: {
          200: UploadResultSchema,
          201: UploadResultSchema,
          ...errorResponses,
          413: ApiErrorSchema,
          415: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const upload = request.upload;
      if (!upload) throw new HttpError(400, 'file_missing', 'Das Feld „file“ mit dem PDF fehlt.');
      try {
        const fields = parseFields(DeckFieldsSchema, upload.fields);
        const result = await createSlideDeck(db, dataDir, upload.file, {
          moduleId: fields.module_id,
          sessionId: fields.session_id,
          title: fields.title,
        });
        return reply.code(result.duplicate ? 200 : 201).send(result);
      } finally {
        await cleanupUpload(request);
      }
    },
  );

  typed.get(
    '/slide-decks',
    {
      schema: {
        tags: ['Material'],
        summary: 'Foliensätze auflisten (neueste zuerst), optional pro Modul',
        querystring: ListQuery,
        response: { 200: SlideDeckListSchema, 400: ApiErrorSchema },
      },
    },
    async (request) =>
      listSlideDecks(db, {
        moduleId: request.query.module_id,
        cursor: request.query.cursor,
        limit: request.query.limit,
      }),
  );

  typed.get(
    '/slide-decks/:id',
    {
      schema: {
        tags: ['Material'],
        summary: 'Foliensatz mit seinen Folien (nach Index sortiert)',
        params: IdParams,
        response: { 200: SlideDeckDetailSchema, ...errorResponses },
      },
    },
    async (request) => getSlideDeckDetail(db, request.params.id),
  );

  typed.patch(
    '/slide-decks/:id',
    {
      schema: {
        tags: ['Material'],
        summary: 'Titel eines Foliensatzes ändern',
        params: IdParams,
        body: SlideDeckUpdateSchema,
        response: { 200: SlideDeckSchema, ...errorResponses },
      },
    },
    async (request) => {
      const title = request.body.title?.trim();
      if (title === undefined) return toApiDeck(await getDeckRow(db, request.params.id));
      if (title === '' || title.length > 300) {
        throw new HttpError(400, 'validation_failed', 'Der Titel muss 1 bis 300 Zeichen lang sein.', {
          in: 'body',
          issues: [{ path: 'title', message: 'muss 1 bis 300 Zeichen lang sein' }],
        });
      }
      return renameSlideDeck(db, request.params.id, title);
    },
  );

  typed.delete(
    '/slide-decks/:id',
    {
      schema: {
        tags: ['Material'],
        summary: 'Foliensatz löschen (Soft-Delete)',
        params: IdParams,
        response: { 204: z.null(), ...errorResponses },
      },
    },
    async (request, reply) => {
      await deleteSlideDeck(db, request.params.id);
      return reply.code(204).send(null);
    },
  );

  typed.get(
    '/slide-decks/:id/file',
    {
      schema: {
        tags: ['Material'],
        summary: 'Original-PDF (Range-fähig)',
        params: IdParams,
        response: errorResponses,
      },
    },
    async (request, reply) => {
      const deck = await getDeckRow(db, request.params.id);
      return serveFile(request, reply, {
        path: resolveDataPath(dataDir, deck.filePath),
        contentType: 'application/pdf',
        etag: `"${deck.sha256}"`,
        disposition: pdfDisposition(deck.title),
      });
    },
  );

  // ----- Folien -----

  typed.get(
    '/slides/:id',
    {
      schema: {
        tags: ['Material'],
        summary: 'Eine Folie',
        params: IdParams,
        response: { 200: SlideSchema, ...errorResponses },
      },
    },
    async (request) => toApiSlide((await getSlideWithDeck(db, request.params.id)).slide),
  );

  for (const variant of ['image', 'thumb'] as const) {
    typed.get(
      `/slides/:id/${variant}`,
      {
        schema: {
          tags: ['Material'],
          summary: variant === 'image' ? 'Folienbild (PNG, 2×)' : 'Vorschaubild der Folie (WebP, 320 px)',
          params: IdParams,
          response: errorResponses,
        },
      },
      async (request, reply) => {
        const { slide, deck } = await getSlideWithDeck(db, request.params.id);
        const relative = variant === 'image' ? slide.imagePath : slide.thumbPath;
        return serveFile(request, reply, {
          path: relative ? resolveDataPath(dataDir, relative) : null,
          contentType: variant === 'image' ? 'image/png' : 'image/webp',
          etag: `"${deck.sha256.slice(0, 24)}-${slide.index}-${variant}-${IMAGE_ETAG_VERSION}"`,
        });
      },
    );
  }

  // ----- Übungsblätter -----

  typed.post(
    '/exercise-sheets',
    {
      ...uploadHooks,
      schema: {
        tags: ['Material'],
        summary: 'Übungsblatt hochladen',
        description:
          'multipart/form-data. Felder: `file` (PDF, Pflicht), `module_id` (UUID, Pflicht), `title`, `number` (Ganzzahl), `due_at` (ISO 8601 mit Zeitzone). Gleiche Datei im selben Modul: 200 mit duplicate=true.',
        consumes: ['multipart/form-data'],
        response: {
          200: UploadResultSchema,
          201: UploadResultSchema,
          ...errorResponses,
          413: ApiErrorSchema,
          415: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const upload = request.upload;
      if (!upload) throw new HttpError(400, 'file_missing', 'Das Feld „file“ mit dem PDF fehlt.');
      try {
        const fields = parseFields(SheetFieldsSchema, upload.fields);
        const result = await createExerciseSheet(db, dataDir, upload.file, {
          moduleId: fields.module_id,
          title: fields.title,
          number: fields.number,
          dueAt: fields.due_at,
        });
        return reply.code(result.duplicate ? 200 : 201).send(result);
      } finally {
        await cleanupUpload(request);
      }
    },
  );

  typed.get(
    '/exercise-sheets',
    {
      schema: {
        tags: ['Material'],
        summary: 'Übungsblätter auflisten (neueste zuerst), optional pro Modul',
        querystring: ListQuery,
        response: { 200: ExerciseSheetListSchema, 400: ApiErrorSchema },
      },
    },
    async (request) =>
      listExerciseSheets(db, {
        moduleId: request.query.module_id,
        cursor: request.query.cursor,
        limit: request.query.limit,
      }),
  );

  typed.get(
    '/exercise-sheets/:id',
    {
      schema: {
        tags: ['Material'],
        summary: 'Ein Übungsblatt',
        params: IdParams,
        response: { 200: ExerciseSheetSchema, ...errorResponses },
      },
    },
    async (request) => toApiSheet(await getSheetRow(db, request.params.id)),
  );

  typed.patch(
    '/exercise-sheets/:id',
    {
      schema: {
        tags: ['Material'],
        summary: 'Titel, Nummer oder Abgabedatum ändern',
        params: IdParams,
        body: ExerciseSheetUpdateSchema,
        response: { 200: ExerciseSheetSchema, ...errorResponses },
      },
    },
    async (request) => {
      if (request.body.title !== undefined && request.body.title.trim() === '') {
        throw new HttpError(400, 'validation_failed', 'Der Titel darf nicht leer sein.', {
          in: 'body',
          issues: [{ path: 'title', message: 'darf nicht leer sein' }],
        });
      }
      const title = request.body.title?.trim();
      return updateExerciseSheet(db, request.params.id, {
        ...request.body,
        ...(title !== undefined ? { title } : {}),
      });
    },
  );

  typed.delete(
    '/exercise-sheets/:id',
    {
      schema: {
        tags: ['Material'],
        summary: 'Übungsblatt löschen (Soft-Delete)',
        params: IdParams,
        response: { 204: z.null(), ...errorResponses },
      },
    },
    async (request, reply) => {
      await deleteExerciseSheet(db, request.params.id);
      return reply.code(204).send(null);
    },
  );

  typed.get(
    '/exercise-sheets/:id/file',
    {
      schema: {
        tags: ['Material'],
        summary: 'Original-PDF (Range-fähig)',
        params: IdParams,
        response: errorResponses,
      },
    },
    async (request, reply) => {
      const sheet = await getSheetRow(db, request.params.id);
      return serveFile(request, reply, {
        path: resolveDataPath(dataDir, sheet.filePath),
        contentType: 'application/pdf',
        etag: `"${sheet.sha256}"`,
        disposition: pdfDisposition(sheet.title),
      });
    },
  );

  for (const variant of ['image', 'thumb'] as const) {
    typed.get(
      `/exercise-sheets/:id/pages/:index/${variant}`,
      {
        schema: {
          tags: ['Material'],
          summary:
            variant === 'image' ? 'Seitenbild des Blatts (PNG, 2×)' : 'Vorschaubild der Seite (WebP, 320 px)',
          params: PageParams,
          response: errorResponses,
        },
      },
      async (request, reply) => {
        const sheet = await getSheetRow(db, request.params.id);
        const { index } = request.params;
        if (sheet.pageCount === null || index > sheet.pageCount) {
          throw new HttpError(404, 'page_not_found', 'Die Seite wurde nicht gefunden.');
        }
        // Pfad nur aus ID und Seitenindex (Zahl), VERTRAEGE §4
        const relative =
          variant === 'image'
            ? `media/sheets/${sheet.id}/pages/${index}.png`
            : `media/sheets/${sheet.id}/thumbs/${index}.webp`;
        return serveFile(request, reply, {
          path: resolveDataPath(dataDir, relative),
          contentType: variant === 'image' ? 'image/png' : 'image/webp',
          etag: `"${sheet.sha256.slice(0, 24)}-${index}-${variant}-${IMAGE_ETAG_VERSION}"`,
        });
      },
    );
  }
}
