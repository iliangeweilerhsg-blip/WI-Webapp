// Seiten, Striche und PencilKit-Sicherung (VERTRAEGE §7.4)
import { stat } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ApiErrorSchema,
  FileReceiptSchema,
  NotebookPagesSchema,
  PageDetailSchema,
  PageStrokesSchema,
  Sha256Schema,
  UuidSchema,
} from '@sg/shared';
import { HttpError } from '../errors.ts';
import {
  findPkdrawingFile,
  getNotebookPages,
  getPageDetail,
  getPageStrokes,
  MAX_PKDRAWING_BYTES,
  storePkdrawing,
} from '../services/pages.ts';
import { assertDeclaredSize, baseMediaType, rawBody, sendStoredFile, type InkRouteDeps } from './photos.ts';

const IdParams = z.object({ id: UuidSchema });
const Sha256Header = z.object({ 'x-sha256': Sha256Schema });

export async function pageRoutes(app: FastifyInstance, deps: InkRouteDeps): Promise<void> {
  const { db } = deps;
  const dataDir = deps.config.dataDir;
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/notebooks/:id/pages',
    {
      schema: {
        tags: ['Notizen'],
        summary: 'Seiten eines Notizbuchs (nach index, created_at, id), mit Stand des Sync-Stroms',
        params: IdParams,
        response: { 200: NotebookPagesSchema, 400: ApiErrorSchema, 404: ApiErrorSchema },
      },
    },
    async (request) => getNotebookPages(db, request.params.id),
  );

  typed.get(
    '/pages/:id',
    {
      schema: {
        tags: ['Notizen'],
        summary: 'Seite mit Elementen',
        params: IdParams,
        response: { 200: PageDetailSchema, 400: ApiErrorSchema, 404: ApiErrorSchema },
      },
    },
    async (request) => getPageDetail(db, request.params.id),
  );

  typed.get(
    '/pages/:id/strokes',
    {
      schema: {
        tags: ['Notizen'],
        summary: 'Alle Striche der Seite (nach created_at, client_id)',
        params: IdParams,
        response: { 200: PageStrokesSchema, 400: ApiErrorSchema, 404: ApiErrorSchema },
      },
    },
    async (request) => getPageStrokes(db, request.params.id),
  );

  typed.get(
    '/pages/:id/pkdrawing',
    {
      schema: {
        tags: ['Notizen'],
        summary: 'PencilKit-Sicherung der Seite (nur fürs iPad)',
        params: IdParams,
        response: { 400: ApiErrorSchema, 404: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const path = await findPkdrawingFile(db, dataDir, request.params.id);
      if (!path) throw new HttpError(404, 'pkdrawing_not_found', 'Zu dieser Seite gibt es keine Sicherung.');
      const info = await stat(path);
      return sendStoredFile(request, reply, {
        path,
        contentType: 'application/octet-stream',
        // Eine neue Sicherung ersetzt die alte: Größe und Änderungszeit trennen die Stände
        etag: `"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`,
        cacheControl: 'private, no-cache',
      });
    },
  );

  // Der Body kommt als roher Stream. Den Typ prüft der Handler selbst, damit er `415 unsupported_media_type` meldet
  await app.register(async (upload) => {
    upload.addContentTypeParser('*', (_request, payload, done) => done(null, payload));
    upload.withTypeProvider<ZodTypeProvider>().put(
      '/pages/:id/pkdrawing',
      {
        schema: {
          tags: ['Notizen'],
          summary: 'PencilKit-Sicherung hochladen (Rohdaten, wiederholbar)',
          description:
            'Body: die `.pkdrawing`-Datei, `Content-Type: application/octet-stream`, Header `X-Sha256` (hex, klein). Erst nach dem `ack` von `page.create`. Eine neue Sicherung ersetzt die alte.',
          params: IdParams,
          headers: Sha256Header,
          response: {
            200: FileReceiptSchema,
            400: ApiErrorSchema,
            404: ApiErrorSchema,
            413: ApiErrorSchema,
            415: ApiErrorSchema,
            422: ApiErrorSchema,
          },
        },
      },
      async (request) => {
        if (baseMediaType(request) !== 'application/octet-stream') {
          throw new HttpError(
            415,
            'unsupported_media_type',
            'Erlaubt ist application/octet-stream als Content-Type.',
          );
        }
        assertDeclaredSize(request, MAX_PKDRAWING_BYTES);
        return storePkdrawing(db, dataDir, request.params.id, rawBody(request), request.headers['x-sha256']);
      },
    );
  });
}
