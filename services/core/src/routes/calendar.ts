// Kalender-Endpunkte (VERTRAEGE §7.1, F-KAL-01/02): Quellen, ICS-Import, Termine
import { createHash } from 'node:crypto';
import multipart from '@fastify/multipart';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ApiErrorSchema,
  CalendarEventListSchema,
  CalendarEventSchema,
  CalendarEventUpdateSchema,
  CalendarSourceCreateSchema,
  CalendarSourceListSchema,
  IcsImportResultSchema,
  TimestampSchema,
  UuidSchema,
} from '@sg/shared';
import type { Db } from '../db/client.ts';
import { HttpError } from '../errors.ts';
import { PageQuerySchema } from '../lib/pagination.ts';
import {
  createFileSource,
  createUrlSource,
  deleteSource,
  getEvent,
  listEvents,
  listSources,
  reassignAutoEvents,
  syncAllUrlSources,
  syncSource,
  updateEvent,
} from '../services/calendar.ts';

/** Größte erlaubte ICS-Datei (VERTRAEGE §7.1) */
export const MAX_ICS_UPLOAD_BYTES = 5 * 1024 * 1024;
/** URL-Quellen werden alle 6 h abgeglichen (VERTRAEGE §8) */
export const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface CalendarRouteDeps {
  db: Db;
  /** Abgleich beim Start und alle 6 h (Standard: an). Nur für Tests abschaltbar. */
  scheduler?: boolean;
}

interface IcsUpload {
  filename: string;
  content: string;
  fields: Record<string, string>;
}

declare module 'fastify' {
  interface FastifyRequest {
    icsUpload?: IcsUpload;
  }
}

const IdParams = z.object({ id: UuidSchema });
const ReassignResultSchema = z.object({
  changed: z.number().int().min(0).describe('Termine, deren Modul oder Art sich geändert hat'),
  ohne_modul: z
    .number()
    .int()
    .min(0)
    .describe('Nicht abgesagte automatisch zugeordnete Termine ohne Modul danach'),
});

/** Lokal heißt: Die Socket-Adresse ist Loopback (VERTRAEGE §5), nie `Host` oder `X-Forwarded-For` */
function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}
const SourcesQuery = PageQuerySchema;
const flag = z.enum(['true', 'false']).optional();
const EventsQuery = PageQuerySchema.extend({
  from: TimestampSchema.optional(),
  to: TimestampSchema.optional(),
  module_id: UuidSchema.optional(),
  unassigned: flag,
  include_cancelled: flag,
});

/**
 * Liest einen multipart-Body (Feld `file` und Textfelder) im `preValidation`, also vor der Idempotency-Prüfung. Die Datei
 * (höchstens 5 MB) bleibt im Speicher. Kein multipart: nichts zu tun (JSON oder leerer Body).
 */
async function parseIcsUpload(request: FastifyRequest): Promise<void> {
  if (!request.isMultipart()) return;
  const fields: Record<string, string> = {};
  let upload: { filename: string; content: string } | undefined;
  let problem: HttpError | undefined;
  const hash = createHash('sha256');
  try {
    for await (const part of request.parts()) {
      if (part.type === 'field') {
        if (typeof part.value === 'string' && !(part.fieldname in fields))
          fields[part.fieldname] = part.value;
        continue;
      }
      if (part.fieldname !== 'file' || upload || problem) {
        problem ??= new HttpError(400, 'unexpected_file', 'Erwartet wird genau eine Datei im Feld „file“.');
        for await (const chunk of part.file) void chunk;
        continue;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of part.file) chunks.push(chunk as Buffer);
      if (part.file.truncated) {
        problem = new HttpError(413, 'file_too_large', 'Die Datei ist größer als 5 MB.');
        continue;
      }
      const bytes = Buffer.concat(chunks);
      hash.update(bytes);
      upload = { filename: part.filename ?? '', content: new TextDecoder('utf-8').decode(bytes) };
    }
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (request.raw.aborted || code === 'FST_MP_PREMATURE_CLOSE' || code === 'ERR_STREAM_PREMATURE_CLOSE') {
      throw new HttpError(400, 'upload_aborted', 'Der Upload wurde abgebrochen.');
    }
    throw error;
  }
  if (problem) throw problem;
  if (!upload) throw new HttpError(400, 'file_missing', 'Das Feld „file“ mit der ICS-Datei fehlt.');
  for (const [name, value] of Object.entries(fields).sort(([a], [b]) => a.localeCompare(b))) {
    hash.update(`\u0000${name}=${value}`);
  }
  request.icsUpload = { ...upload, fields };
  request.idempotencyFingerprint = hash.digest('hex');
}

function validationFailed(path: string, message: string): HttpError {
  return new HttpError(400, 'validation_failed', 'Die Anfrage ist ungültig.', {
    in: 'body',
    issues: [{ path, message }],
  });
}

/** Optionales Textfeld `id`/`name` aus multipart prüfen */
function uploadFields(fields: Record<string, string>): { id?: string; name?: string } {
  const result: { id?: string; name?: string } = {};
  if (fields.id !== undefined && fields.id !== '') {
    const id = UuidSchema.safeParse(fields.id);
    if (!id.success) throw validationFailed('id', 'keine gültige UUID');
    result.id = id.data;
  }
  if (fields.name !== undefined && fields.name.trim() !== '') result.name = fields.name.trim();
  return result;
}

export async function calendarRoutes(app: FastifyInstance, deps: CalendarRouteDeps): Promise<void> {
  const { db } = deps;
  const typed = app.withTypeProvider<ZodTypeProvider>();

  const multipartOptions = {
    // Die Größe prüft der Parser selbst (`file.truncated`) und antwortet mit `file_too_large`
    throwFileSizeLimit: false,
    defParamCharset: 'utf8',
    limits: { fileSize: MAX_ICS_UPLOAD_BYTES, files: 3, fields: 10, fieldSize: 4096, parts: 15 },
  };
  await app.register(multipart, multipartOptions);

  // --- Zeitplan: beim Start und alle 6 h -------------------------------------------------------
  if (deps.scheduler !== false) {
    let running = false;
    const run = () => {
      if (running) return;
      running = true;
      syncAllUrlSources(db, app.log)
        .catch((error: unknown) => app.log.warn({ err: error }, 'Kalender-Abgleich konnte nicht starten'))
        .finally(() => {
          running = false;
        });
    };
    app.addHook('onReady', async () => run());
    const timer = setInterval(run, SYNC_INTERVAL_MS);
    timer.unref();
    app.addHook('onClose', async () => clearInterval(timer));
  }

  // --- Quellen ----------------------------------------------------------------------------------

  typed.get(
    '/calendar/sources',
    {
      schema: {
        tags: ['Kalender'],
        summary: 'Kalenderquellen auflisten (älteste zuerst)',
        querystring: SourcesQuery,
        response: { 200: CalendarSourceListSchema, 400: ApiErrorSchema },
      },
    },
    async (request) => listSources(db, request.query),
  );

  typed.post(
    '/calendar/sources',
    {
      preValidation: parseIcsUpload,
      schema: {
        tags: ['Kalender'],
        summary: 'ICS-Quelle anlegen und sofort abgleichen',
        description:
          'JSON `{ url, name?, id? }` (ICS-URL, `webcal://` wird `https://`) oder multipart/form-data mit `file` (.ics, höchstens 5 MB), `name?`, `id?`. Antwort: `IcsImportResult`. Der Abgleich läuft synchron.',
        consumes: ['application/json', 'multipart/form-data'],
        response: {
          201: IcsImportResultSchema,
          400: ApiErrorSchema,
          409: ApiErrorSchema,
          413: ApiErrorSchema,
          422: ApiErrorSchema,
          502: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const upload = request.icsUpload;
      if (upload) {
        const fields = uploadFields(upload.fields);
        const result = await createFileSource(db, {
          id: fields.id,
          name: fields.name,
          filename: upload.filename,
          content: upload.content,
        });
        return reply.code(201).send(result);
      }
      const body = CalendarSourceCreateSchema.safeParse(request.body);
      if (!body.success) {
        const urlIssue = body.error.issues.some((issue) => issue.path[0] === 'url');
        throw new HttpError(
          400,
          'validation_failed',
          urlIssue
            ? 'Die Adresse ist ungültig. Sie muss mit https:// oder webcal:// beginnen.'
            : 'Die Anfrage ist ungültig.',
          {
            in: 'body',
            issues: body.error.issues.map((issue) => ({
              path: issue.path.join('.'),
              message: issue.message,
            })),
          },
        );
      }
      return reply.code(201).send(await createUrlSource(db, body.data));
    },
  );

  typed.post(
    '/calendar/sources/:id/sync',
    {
      preValidation: parseIcsUpload,
      schema: {
        tags: ['Kalender'],
        summary: 'Quelle abgleichen',
        description:
          'URL-Quelle: ohne Body, die URL wird neu abgerufen. Datei-Quelle: multipart mit `file` (neue Fassung). Fehler beim Abruf stehen danach in `last_error`.',
        consumes: ['multipart/form-data'],
        params: IdParams,
        response: {
          200: IcsImportResultSchema,
          400: ApiErrorSchema,
          404: ApiErrorSchema,
          413: ApiErrorSchema,
          422: ApiErrorSchema,
          502: ApiErrorSchema,
        },
      },
    },
    async (request) => syncSource(db, request.params.id, request.icsUpload?.content),
  );

  typed.delete(
    '/calendar/sources/:id',
    {
      schema: {
        tags: ['Kalender'],
        summary: 'Quelle löschen (weich, mit ihren Terminen; Papierkorb)',
        params: IdParams,
        response: {
          204: z.null().describe('Gelöscht'),
          400: ApiErrorSchema,
          404: ApiErrorSchema,
          409: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      await deleteSource(db, request.params.id);
      return reply.code(204).send(null);
    },
  );

  // --- Termine ----------------------------------------------------------------------------------

  typed.get(
    '/calendar/events',
    {
      schema: {
        tags: ['Kalender'],
        summary: 'Termine auflisten (nach Beginn aufsteigend)',
        description:
          '`from`/`to`: Termine, die im Zeitraum liegen oder hineinreichen. Ohne `include_cancelled=true` fehlen abgesagte Termine. `unassigned=true`: nur Termine ohne Modul.',
        querystring: EventsQuery,
        response: { 200: CalendarEventListSchema, 400: ApiErrorSchema },
      },
    },
    async (request) => {
      const q = request.query;
      return listEvents(db, {
        from: q.from,
        to: q.to,
        moduleId: q.module_id,
        unassigned: q.unassigned === 'true',
        includeCancelled: q.include_cancelled === 'true',
        cursor: q.cursor,
        limit: q.limit,
      });
    },
  );

  typed.get(
    '/calendar/events/:id',
    {
      schema: {
        tags: ['Kalender'],
        summary: 'Einen Termin lesen',
        params: IdParams,
        response: { 200: CalendarEventSchema, 400: ApiErrorSchema, 404: ApiErrorSchema },
      },
    },
    async (request) => getEvent(db, request.params.id),
  );

  typed.post(
    '/calendar/reassign',
    {
      schema: {
        tags: ['Kalender'],
        summary: 'Automatische Zuordnung aller Termine neu berechnen (lokal)',
        description:
          'Bestimmt Modul und Art aller Termine mit `assigned_by = auto` neu, etwa nach dem Anlegen eines Moduls. Manuelle Zuordnungen bleiben unangetastet, ein zweiter Aufruf ändert nichts. Nur lokale Anfragen.',
        response: { 200: ReassignResultSchema, 403: ApiErrorSchema },
      },
    },
    async (request) => {
      if (!isLoopback(request.socket.remoteAddress)) {
        throw new HttpError(
          403,
          'local_only',
          'Diese Route gibt es nur auf dem Mac, auf dem der Core läuft.',
        );
      }
      return reassignAutoEvents(db);
    },
  );

  typed.patch(
    '/calendar/events/:id',
    {
      schema: {
        tags: ['Kalender'],
        summary: 'Modul und/oder Art eines Termins setzen (manuell)',
        description:
          'Setzt `assigned_by = manuell`. `scope` fehlt = `serie` (alle Termine der Quelle mit gleicher `external_uid`, auch spätere Vorkommen). Antwort: alle geänderten Termine.',
        params: IdParams,
        body: CalendarEventUpdateSchema,
        response: { 200: CalendarEventListSchema, 400: ApiErrorSchema, 404: ApiErrorSchema },
      },
    },
    async (request) => {
      const items = await updateEvent(db, request.params.id, request.body);
      return { items, next_cursor: null };
    },
  );
}
