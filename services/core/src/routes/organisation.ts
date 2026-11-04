// Organisation: Semester und Module (08 §1, F-ORG-01)
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ApiErrorSchema,
  ModuleCreateSchema,
  ModuleListSchema,
  ModuleSchema,
  ModuleUpdateSchema,
  SemesterCreateSchema,
  SemesterListSchema,
  SemesterSchema,
  SemesterUpdateSchema,
  UuidSchema,
} from '@sg/shared';
import type { Db } from '../db/client.ts';
import { PageQuerySchema } from '../lib/pagination.ts';
import {
  createModule,
  createSemester,
  deleteModule,
  getModule,
  getSemester,
  listModules,
  listSemesters,
  updateModule,
  updateSemester,
} from '../services/organisation.ts';

export interface OrganisationRouteDeps {
  db: Db;
}

const IdParams = z.object({ id: UuidSchema });

const SemestersQuery = PageQuerySchema.extend({
  archived: z.enum(['true', 'false']).optional(),
});

const ModulesQuery = PageQuerySchema.extend({
  semester_id: UuidSchema.optional(),
});

export async function organisationRoutes(app: FastifyInstance, deps: OrganisationRouteDeps): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const { db } = deps;

  // --- Semester -------------------------------------------------------------------------------

  typed.get(
    '/semesters',
    {
      schema: {
        tags: ['Organisation'],
        summary: 'Semester auflisten (neueste zuerst); archivierte sind enthalten, außer `archived=false`',
        querystring: SemestersQuery,
        response: { 200: SemesterListSchema, 400: ApiErrorSchema },
      },
    },
    async (request) =>
      listSemesters(db, {
        archived: request.query.archived === undefined ? undefined : request.query.archived === 'true',
        cursor: request.query.cursor,
        limit: request.query.limit,
      }),
  );

  typed.post(
    '/semesters',
    {
      schema: {
        tags: ['Organisation'],
        summary: 'Semester anlegen. Das erste Semester wird automatisch aktuell.',
        body: SemesterCreateSchema,
        response: { 201: SemesterSchema, 400: ApiErrorSchema, 409: ApiErrorSchema },
      },
    },
    async (request, reply) => reply.code(201).send(await createSemester(db, request.body)),
  );

  typed.get(
    '/semesters/:id',
    {
      schema: {
        tags: ['Organisation'],
        summary: 'Ein Semester lesen (auch archivierte)',
        params: IdParams,
        response: { 200: SemesterSchema, 400: ApiErrorSchema, 404: ApiErrorSchema },
      },
    },
    async (request) => getSemester(db, request.params.id),
  );

  typed.patch(
    '/semesters/:id',
    {
      schema: {
        tags: ['Organisation'],
        summary: 'Semester ändern; `is_current` setzt alle anderen zurück, `archived` archiviert/stellt her',
        params: IdParams,
        body: SemesterUpdateSchema,
        response: {
          200: SemesterSchema,
          400: ApiErrorSchema,
          404: ApiErrorSchema,
          409: ApiErrorSchema,
        },
      },
    },
    async (request) => updateSemester(db, request.params.id, request.body),
  );

  // --- Module ---------------------------------------------------------------------------------

  typed.get(
    '/modules',
    {
      schema: {
        tags: ['Organisation'],
        summary: 'Module auflisten (in Anlegereihenfolge), optional pro Semester',
        querystring: ModulesQuery,
        response: { 200: ModuleListSchema, 400: ApiErrorSchema },
      },
    },
    async (request) =>
      listModules(db, {
        semesterId: request.query.semester_id,
        cursor: request.query.cursor,
        limit: request.query.limit,
      }),
  );

  typed.post(
    '/modules',
    {
      schema: {
        tags: ['Organisation'],
        summary: 'Modul anlegen. Ohne `color` vergibt der Core die nächste freie Palettenfarbe.',
        body: ModuleCreateSchema,
        response: { 201: ModuleSchema, 400: ApiErrorSchema, 404: ApiErrorSchema, 409: ApiErrorSchema },
      },
    },
    async (request, reply) => reply.code(201).send(await createModule(db, request.body)),
  );

  typed.get(
    '/modules/:id',
    {
      schema: {
        tags: ['Organisation'],
        summary: 'Ein Modul lesen',
        params: IdParams,
        response: { 200: ModuleSchema, 400: ApiErrorSchema, 404: ApiErrorSchema },
      },
    },
    async (request) => getModule(db, request.params.id),
  );

  typed.patch(
    '/modules/:id',
    {
      schema: {
        tags: ['Organisation'],
        summary: 'Modul ändern',
        params: IdParams,
        body: ModuleUpdateSchema,
        response: { 200: ModuleSchema, 400: ApiErrorSchema, 404: ApiErrorSchema },
      },
    },
    async (request) => updateModule(db, request.params.id, request.body),
  );

  typed.delete(
    '/modules/:id',
    {
      schema: {
        tags: ['Organisation'],
        summary: 'Modul löschen (Soft-Delete, 204)',
        params: IdParams,
        response: { 204: z.null().describe('Gelöscht'), 400: ApiErrorSchema, 404: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      await deleteModule(db, request.params.id);
      return reply.code(204).send(null);
    },
  );
}
