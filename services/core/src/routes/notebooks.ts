// Notizbücher (VERTRAEGE §7.4) und Sammelregistrierung aller Handschrift-Routen
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ApiErrorSchema,
  NotebookCreateSchema,
  NotebookListSchema,
  NotebookSchema,
  NotebookUpdateSchema,
  UuidSchema,
} from '@sg/shared';
import { PageQuerySchema } from '../lib/pagination.ts';
import {
  createNotebook,
  deleteNotebook,
  getNotebook,
  listNotebooks,
  updateNotebook,
} from '../services/notebooks.ts';
import { pageRoutes } from './pages.ts';
import { photoRoutes, type InkRouteDeps } from './photos.ts';

const IdParams = z.object({ id: UuidSchema });
const ListQuery = PageQuerySchema.extend({ module_id: UuidSchema.optional() });

export async function notebookRoutes(app: FastifyInstance, deps: InkRouteDeps): Promise<void> {
  const { db } = deps;
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/notebooks',
    {
      schema: {
        tags: ['Notizen'],
        summary:
          'Notizbücher auflisten, optional pro Modul. Mit `module_id` entstehen fehlende Standard-Notizbücher.',
        querystring: ListQuery,
        response: { 200: NotebookListSchema, 400: ApiErrorSchema },
      },
    },
    async (request) =>
      listNotebooks(db, {
        moduleId: request.query.module_id,
        cursor: request.query.cursor,
        limit: request.query.limit,
      }),
  );

  typed.get(
    '/notebooks/:id',
    {
      schema: {
        tags: ['Notizen'],
        summary: 'Ein Notizbuch',
        params: IdParams,
        response: { 200: NotebookSchema, 400: ApiErrorSchema, 404: ApiErrorSchema },
      },
    },
    async (request) => getNotebook(db, request.params.id),
  );

  typed.post(
    '/notebooks',
    {
      schema: {
        tags: ['Notizen'],
        summary: 'Notizbuch anlegen (ohne `kind` ein freies)',
        body: NotebookCreateSchema,
        response: { 201: NotebookSchema, 400: ApiErrorSchema, 404: ApiErrorSchema, 409: ApiErrorSchema },
      },
    },
    async (request, reply) => reply.code(201).send(await createNotebook(db, request.body)),
  );

  typed.patch(
    '/notebooks/:id',
    {
      schema: {
        tags: ['Notizen'],
        summary: 'Notizbuch umbenennen oder in ein anderes Modul verschieben (Operation `notebook.update`)',
        params: IdParams,
        body: NotebookUpdateSchema,
        response: { 200: NotebookSchema, 400: ApiErrorSchema, 404: ApiErrorSchema, 409: ApiErrorSchema },
      },
    },
    async (request) => updateNotebook(db, request.params.id, request.body),
  );

  typed.delete(
    '/notebooks/:id',
    {
      schema: {
        tags: ['Notizen'],
        summary: 'Notizbuch löschen (Soft-Delete, Operation `notebook.delete`)',
        params: IdParams,
        response: { 204: z.null(), 400: ApiErrorSchema, 404: ApiErrorSchema, 409: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      await deleteNotebook(db, request.params.id);
      return reply.code(204).send(null);
    },
  );
}

/** Alle Routen der Handschrift (Notizbücher, Seiten, Fotos). In `app.ts` wird nur diese Funktion registriert. */
export async function inkRoutes(app: FastifyInstance, deps: InkRouteDeps): Promise<void> {
  await app.register(notebookRoutes, deps);
  await app.register(pageRoutes, deps);
  await app.register(photoRoutes, deps);
}
