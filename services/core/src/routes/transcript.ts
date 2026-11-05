// Transkript und Neuverarbeitung einer Session (VERTRAEGE §18.4, §18.5). Ticket T2-02b.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ApiErrorSchema,
  SessionReprocessRequestSchema,
  SessionReprocessResultSchema,
  SessionTranscriptSchema,
  UuidSchema,
} from '@sg/shared';
import type { Db } from '../db/client.ts';
import { getSessionTranscript, reprocessSession } from '../services/transcript.ts';

export interface TranscriptRouteDeps {
  db: Db;
}

const IdParams = z.object({ id: UuidSchema });

const TranscriptQuerySchema = z.object({
  slide_id: UuidSchema.optional(),
  include_words: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

export async function transcriptRoutes(app: FastifyInstance, deps: TranscriptRouteDeps): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const { db } = deps;

  typed.get(
    '/sessions/:id/transcript',
    {
      schema: {
        tags: ['Sessions'],
        summary: 'Transkript, Folienzuordnung und Aufnahmen einer Session (F-NAC-02)',
        params: IdParams,
        querystring: TranscriptQuerySchema,
        response: { 200: SessionTranscriptSchema, 400: ApiErrorSchema, 404: ApiErrorSchema },
      },
    },
    async (request) =>
      getSessionTranscript(db, request.params.id, {
        slideId: request.query.slide_id,
        includeWords: request.query.include_words,
      }),
  );

  typed.post(
    '/sessions/:id/reprocess',
    {
      schema: {
        tags: ['Sessions'],
        summary: 'Verarbeitungskette ab `from_step` neu anstoßen (Standard: `transcribe`)',
        params: IdParams,
        body: SessionReprocessRequestSchema.nullish(),
        response: {
          202: SessionReprocessResultSchema,
          400: ApiErrorSchema,
          404: ApiErrorSchema,
          409: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await reprocessSession(db, request.params.id, request.body ?? {});
      return reply.code(202).send(result);
    },
  );
}
