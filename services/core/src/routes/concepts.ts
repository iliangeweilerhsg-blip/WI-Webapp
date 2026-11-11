// Konzepte lesen (VERTRAEGE §20.6, F-BIB-02). Ticket T2-22b. Bearbeiten außerhalb der Inbox kommt später.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ApiErrorSchema,
  ConceptDetailSchema,
  ConceptListSchema,
  SessionConceptsSchema,
  UuidSchema,
} from '@sg/shared';
import type { Db } from '../db/client.ts';
import { PageQuerySchema } from '../lib/pagination.ts';
import { getConceptDetail, getSessionConcepts, listConcepts } from '../services/concepts.ts';

export interface ConceptRouteDeps {
  db: Db;
}

const IdParams = z.object({ id: UuidSchema });

const ConceptQuerySchema = PageQuerySchema.extend({
  status: z.enum(['aktiv', 'vorschlag', 'alle']).default('aktiv'),
  module_id: UuidSchema.optional(),
  q: z
    .string()
    .refine((value) => [...value].length >= 1 && [...value].length <= 100, {
      message: 'q muss 1 bis 100 Zeichen lang sein',
    })
    .optional(),
});

export async function conceptRoutes(app: FastifyInstance, deps: ConceptRouteDeps): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const { db } = deps;

  typed.get(
    '/concepts',
    {
      schema: {
        tags: ['Konzepte'],
        summary: 'Konzepte nach Name, optional je Modul und mit Teilwortsuche (F-BIB-02)',
        querystring: ConceptQuerySchema,
        response: { 200: ConceptListSchema, 400: ApiErrorSchema },
      },
    },
    async (request) =>
      listConcepts(db, {
        status: request.query.status,
        moduleId: request.query.module_id,
        q: request.query.q,
        cursor: request.query.cursor,
        limit: request.query.limit,
      }),
  );

  typed.get(
    '/concepts/:id',
    {
      schema: {
        tags: ['Konzepte'],
        summary: 'Konzept mit Modulen, Belegen und bestätigten Beziehungen',
        params: IdParams,
        response: { 200: ConceptDetailSchema, 404: ApiErrorSchema },
      },
    },
    async (request) => getConceptDetail(db, request.params.id),
  );

  typed.get(
    '/sessions/:id/concepts',
    {
      schema: {
        tags: ['Sessions'],
        summary: 'Konzepte mit Belegen aus dieser Session (Rückblick)',
        params: IdParams,
        response: { 200: SessionConceptsSchema, 404: ApiErrorSchema },
      },
    },
    async (request) => getSessionConcepts(db, request.params.id),
  );
}
