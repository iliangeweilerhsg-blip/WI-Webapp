// Audio-Aufnahmen (VERTRAEGE §7.3, §10): anlegen, Chunks hochladen, abschließen, abrufen. Ticket T1-06.
import { stat } from 'node:fs/promises';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ApiErrorSchema,
  AudioChunkMetaSchema,
  AudioChunkSchema,
  RecordingCompleteSchema,
  RecordingCreateSchema,
  RecordingSchema,
  UuidSchema,
} from '@sg/shared';
import type { Config } from '../config.ts';
import type { Db } from '../db/client.ts';
import { HttpError } from '../errors.ts';
import {
  completeRecording,
  createRecording,
  findFullAudio,
  getRecording,
  MAX_CHUNK_BYTES,
  MAX_SEQ,
  storeChunk,
} from '../services/recordings.ts';
import { baseMediaType, rawBody, sendStoredFile } from './photos.ts';

export interface RecordingRouteDeps {
  db: Db;
  config: Pick<Config, 'dataDir'>;
}

const IdParams = z.object({ id: UuidSchema });
/** `{seq}` als Ganzzahl ≥ 0 ohne führende Nullen (VERTRAEGE §6). Ungültig = `400 validation_failed` */
const ChunkParams = z.object({
  id: UuidSchema,
  seq: z
    .string()
    .regex(/^(0|[1-9][0-9]*)$/)
    .transform(Number)
    .pipe(z.number().int().max(MAX_SEQ)),
});
const AudioQuery = z.object({
  from_ms: z.coerce.number().int().min(0).optional(),
  to_ms: z.coerce.number().int().min(0).optional(),
});

const DECIMAL = /^(0|[1-9][0-9]*)$/;

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === 'string' ? value : undefined;
}

/** Pflichtheader von `PUT …/chunks/{seq}` als `AudioChunkMeta` parsen (`400 chunk_header_invalid`) */
function parseChunkMeta(request: FastifyRequest, seq: number) {
  const invalid = (name: string) =>
    new HttpError(400, 'chunk_header_invalid', `Der Header ${name} fehlt oder ist ungültig.`, {
      header: name,
    });
  const startRaw = header(request, 'x-start-ms');
  const durationRaw = header(request, 'x-duration-ms');
  const sha = header(request, 'x-sha256');
  if (startRaw === undefined || !DECIMAL.test(startRaw)) throw invalid('X-Start-Ms');
  if (durationRaw === undefined || !DECIMAL.test(durationRaw)) throw invalid('X-Duration-Ms');
  if (sha === undefined) throw invalid('X-Sha256');
  const parsed = AudioChunkMetaSchema.safeParse({
    seq,
    start_ms: Number(startRaw),
    duration_ms: Number(durationRaw),
    sha256: sha,
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    throw invalid(
      field === 'start_ms' ? 'X-Start-Ms' : field === 'duration_ms' ? 'X-Duration-Ms' : 'X-Sha256',
    );
  }
  return parsed.data;
}

export async function recordingRoutes(app: FastifyInstance, deps: RecordingRouteDeps): Promise<void> {
  const { db } = deps;
  const dataDir = deps.config.dataDir;
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post(
    '/sessions/:id/recordings',
    {
      schema: {
        tags: ['Audio'],
        summary: 'Aufnahme anlegen (Session muss laufen oder pausiert sein)',
        params: IdParams,
        body: RecordingCreateSchema,
        response: { 201: RecordingSchema, 400: ApiErrorSchema, 404: ApiErrorSchema, 409: ApiErrorSchema },
      },
    },
    async (request, reply) =>
      reply.code(201).send(await createRecording(db, request.params.id, request.body)),
  );

  typed.get(
    '/recordings/:id',
    {
      schema: {
        tags: ['Audio'],
        summary: 'Eine Aufnahme',
        params: IdParams,
        response: { 200: RecordingSchema, 400: ApiErrorSchema, 404: ApiErrorSchema },
      },
    },
    async (request) => getRecording(db, request.params.id),
  );

  typed.post(
    '/recordings/:id/complete',
    {
      schema: {
        tags: ['Audio'],
        summary: 'Aufnahme abschließen und `audio.finalize` einstellen',
        params: IdParams,
        body: RecordingCompleteSchema,
        response: { 200: RecordingSchema, 400: ApiErrorSchema, 404: ApiErrorSchema, 409: ApiErrorSchema },
      },
    },
    async (request) => completeRecording(db, request.params.id, request.body),
  );

  typed.get(
    '/recordings/:id/audio',
    {
      schema: {
        tags: ['Audio'],
        summary: 'Gesamte Aufnahme als `audio/mp4` mit Range-Unterstützung',
        description:
          'Liefert `full.m4a` von `audio.finalize`. `from_ms`/`to_ms` sind für Phase 2 reserviert und werden noch nicht ausgewertet, die Antwort enthält immer die ganze Datei.',
        params: IdParams,
        querystring: AudioQuery,
        response: { 400: ApiErrorSchema, 404: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const path = await findFullAudio(db, dataDir, request.params.id);
      if (!path) throw new HttpError(404, 'audio_not_ready', 'Die Audiodatei liegt (noch) nicht vor.');
      return sendStoredFile(request, reply, {
        path,
        contentType: 'audio/mp4',
        // Nach jedem audio.finalize ändert sich die Datei: ETag aus Größe und Änderungszeit statt immutable
        etag: await fileEtag(path),
        cacheControl: 'private, no-cache',
      });
    },
  );

  // Der Body kommt als roher Stream. Den Typ prüft der Service selbst, damit er `415 chunk_mime_mismatch` meldet
  await app.register(async (upload) => {
    upload.addContentTypeParser('*', (_request, payload, done) => done(null, payload));
    upload.withTypeProvider<ZodTypeProvider>().put(
      '/recordings/:id/chunks/:seq',
      {
        schema: {
          tags: ['Audio'],
          summary: 'Audio-Chunk hochladen (Rohdaten, wiederholbar)',
          description:
            'Body: Chunk-Rohdaten, `Content-Type` = Basistyp der Aufnahme. Pflichtheader `X-Start-Ms`, `X-Duration-Ms` (Ganzzahlen in ms) und `X-Sha256` (hex, klein). 201 neu, 200 bei Duplikat (gleiche seq, gleiches sha256).',
          params: ChunkParams,
          response: {
            200: AudioChunkSchema,
            201: AudioChunkSchema,
            400: ApiErrorSchema,
            404: ApiErrorSchema,
            409: ApiErrorSchema,
            413: ApiErrorSchema,
            415: ApiErrorSchema,
            422: ApiErrorSchema,
          },
        },
      },
      async (request, reply) => {
        const meta = parseChunkMeta(request, request.params.seq);
        const declared = Number(request.headers['content-length']);
        if (Number.isFinite(declared) && declared > MAX_CHUNK_BYTES) {
          throw new HttpError(413, 'chunk_too_large', 'Der Chunk ist größer als 10 MB.');
        }
        const chunk = await storeChunk(
          db,
          request.params.id,
          meta,
          baseMediaType(request),
          rawBody(request),
          {
            dataDir,
          },
        );
        return reply.code(chunk.duplicate ? 200 : 201).send(chunk);
      },
    );
  });
}

async function fileEtag(path: string): Promise<string> {
  const info = await stat(path);
  return `"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
}
