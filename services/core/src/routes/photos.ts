// Tafel-Fotos (VERTRAEGE §7.4): Metadaten, Upload `PUT /photos/{id}/file` und Auslieferung.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ApiErrorSchema,
  FileReceiptSchema,
  PhotoSchema,
  Sha256Schema,
  UuidSchema,
  type PhotoMime,
} from '@sg/shared';
import type { Config } from '../config.ts';
import type { Db } from '../db/client.ts';
import { HttpError } from '../errors.ts';
import { findPhotoFile, getPhoto, MAX_PHOTO_BYTES, storePhotoFile } from '../services/photos.ts';
import { parseRange } from './material.ts';

export interface InkRouteDeps {
  db: Db;
  config: Pick<Config, 'dataDir'>;
}

const IdParams = z.object({ id: UuidSchema });
const Sha256Header = z.object({ 'x-sha256': Sha256Schema });
const PHOTO_TYPES: readonly string[] = ['image/heic', 'image/jpeg'];

/**
 * Gemeinsame Header für ausgelieferte Dateien. Der Typ kommt vom Core, nie vom Inhalt (`nosniff`), und die
 * Datei darf in keinem Kontext Skripte ausführen (`sandbox`), auch wenn sie direkt im Browser geöffnet wird.
 */
export function fileSecurityHeaders(reply: FastifyReply): void {
  reply
    .header('x-content-type-options', 'nosniff')
    .header('content-security-policy', "default-src 'none'; sandbox");
}

function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header
    .split(',')
    .map((value) => value.trim().replace(/^W\//, ''))
    .some((value) => value === etag || value === '*');
}

export interface SendFileOptions {
  path: string;
  contentType: string;
  etag: string;
  cacheControl: string;
}

/** Datei mit ETag und Range ausliefern (wie die Material-Routen), dazu die Sicherheitsheader */
export async function sendStoredFile(request: FastifyRequest, reply: FastifyReply, options: SendFileOptions) {
  const info = await stat(options.path).catch(() => null);
  if (!info?.isFile()) throw new HttpError(404, 'file_not_found', 'Die Datei ist (noch) nicht vorhanden.');
  fileSecurityHeaders(reply);
  reply
    .header('content-type', options.contentType)
    .header('etag', options.etag)
    .header('cache-control', options.cacheControl)
    .header('accept-ranges', 'bytes');
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

/** Basis-Typ eines `Content-Type`-Headers, kleingeschrieben und ohne Parameter */
export function baseMediaType(request: FastifyRequest): string {
  return (request.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

/** Roher Body als Stream. Ohne Body (kein Content-Type) ein leerer Stream */
export function rawBody(request: FastifyRequest): Readable {
  return request.body instanceof Readable ? request.body : Readable.from([]);
}

/** Wirft 413, wenn schon `Content-Length` über dem Limit liegt (spart das Einlesen) */
export function assertDeclaredSize(request: FastifyRequest, maxBytes: number): void {
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpError(
      413,
      'file_too_large',
      `Die Datei ist größer als ${Math.floor(maxBytes / (1024 * 1024))} MB.`,
    );
  }
}

export async function photoRoutes(app: FastifyInstance, deps: InkRouteDeps): Promise<void> {
  const { db } = deps;
  const dataDir = deps.config.dataDir;
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/photos/:id',
    {
      schema: {
        tags: ['Notizen'],
        summary: 'Metadaten eines Tafel-Fotos',
        params: IdParams,
        response: { 200: PhotoSchema, 400: ApiErrorSchema, 404: ApiErrorSchema },
      },
    },
    async (request) => getPhoto(db, request.params.id),
  );

  typed.get(
    '/photos/:id/file',
    {
      schema: {
        tags: ['Notizen'],
        summary: 'Foto-Datei (HEIC oder JPEG)',
        params: IdParams,
        response: { 400: ApiErrorSchema, 404: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const file = await findPhotoFile(db, dataDir, request.params.id);
      if (!file) throw new HttpError(404, 'photo_file_missing', 'Die Foto-Datei liegt (noch) nicht vor.');
      return sendStoredFile(request, reply, {
        path: file.path,
        contentType: file.mime,
        etag: `"${file.sha256}"`,
        // Zur ID gehört genau eine Datei (ein anderer Inhalt wird mit 409 abgelehnt)
        cacheControl: 'private, max-age=31536000, immutable',
      });
    },
  );

  // Der Body kommt als roher Stream. Den Typ prüft der Handler selbst, damit er `415 unsupported_media_type` meldet
  await app.register(async (upload) => {
    upload.addContentTypeParser('*', (_request, payload, done) => done(null, payload));
    upload.withTypeProvider<ZodTypeProvider>().put(
      '/photos/:id/file',
      {
        schema: {
          tags: ['Notizen'],
          summary: 'Foto hochladen (Rohdaten, wiederholbar)',
          description:
            'Body: die Bilddatei, `Content-Type: image/heic` oder `image/jpeg`, Header `X-Sha256` (hex, klein). Die Zeile entsteht mit `photo.add`, die Reihenfolge ist egal. 201 neu, 200 bei Duplikat.',
          params: IdParams,
          headers: Sha256Header,
          response: {
            200: FileReceiptSchema,
            201: FileReceiptSchema,
            400: ApiErrorSchema,
            409: ApiErrorSchema,
            413: ApiErrorSchema,
            415: ApiErrorSchema,
            422: ApiErrorSchema,
          },
        },
      },
      async (request, reply) => {
        const mime = baseMediaType(request);
        if (!PHOTO_TYPES.includes(mime)) {
          throw new HttpError(
            415,
            'unsupported_media_type',
            'Erlaubt sind image/heic und image/jpeg als Content-Type.',
          );
        }
        assertDeclaredSize(request, MAX_PHOTO_BYTES);
        const receipt = await storePhotoFile(
          request.params.id,
          rawBody(request),
          request.headers['x-sha256'],
          mime as PhotoMime,
          { db, dataDir },
        );
        return reply.code(receipt.duplicate ? 200 : 201).send(receipt);
      },
    );
  });
}
