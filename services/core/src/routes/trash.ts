// Papierkorb (VERTRAEGE §7.5, §13, F-DAT-04)
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ApiErrorSchema,
  TrashKindSchema,
  TrashListSchema,
  TrashRestoreResultSchema,
  UuidSchema,
} from '@sg/shared';
import type { Config } from '../config.ts';
import type { Db } from '../db/client.ts';
import { PageQuerySchema } from '../lib/pagination.ts';
import { emptyTrash, listTrash, purgeOne, restoreWithOps } from '../services/trash-ops.ts';

export interface TrashRouteDeps {
  db: Db;
  config: Config;
}

const IdParams = z.object({ id: UuidSchema });
const TrashQuery = PageQuerySchema.extend({ kind: TrashKindSchema.optional() });
const KindQuery = z.object({ kind: TrashKindSchema.optional() });

/** Antwort von `DELETE /trash` (kein Schema in packages/schemas: nur diese eine Zahl) */
const TrashEmptiedSchema = z.object({
  purged_count: z
    .number()
    .int()
    .min(0)
    .describe('Endgültig gelöschte Objekte (direkt gelöschte, wie in der Liste)'),
});

export async function trashRoutes(app: FastifyInstance, deps: TrashRouteDeps): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const { db, config } = deps;

  typed.get(
    '/trash',
    {
      schema: {
        tags: ['Daten'],
        summary: 'Papierkorb: direkt gelöschte Objekte, nach `deleted_at` absteigend',
        querystring: TrashQuery,
        response: { 200: TrashListSchema, 400: ApiErrorSchema },
      },
    },
    async (request) =>
      listTrash(db, { kind: request.query.kind, cursor: request.query.cursor, limit: request.query.limit }),
  );

  typed.post(
    '/trash/:id/restore',
    {
      schema: {
        tags: ['Daten'],
        summary:
          'Objekt samt Teilen wiederherstellen. 404 `trash_item_not_found`, 409 `restore_parent_deleted`, 409 `restore_conflict`',
        params: IdParams,
        response: {
          200: TrashRestoreResultSchema,
          400: ApiErrorSchema,
          404: ApiErrorSchema,
          409: ApiErrorSchema,
        },
      },
    },
    async (request) => restoreWithOps(db, request.params.id),
  );

  typed.delete(
    '/trash/:id',
    {
      schema: {
        tags: ['Daten'],
        summary: 'Objekt samt Teilen und Dateien endgültig löschen (204). 404 `trash_item_not_found`',
        params: IdParams,
        response: { 204: z.null(), 400: ApiErrorSchema, 404: ApiErrorSchema, 409: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      await purgeOne(db, config.dataDir, request.params.id);
      return reply.code(204).send(null);
    },
  );

  typed.delete(
    '/trash',
    {
      schema: {
        tags: ['Daten'],
        summary:
          'Papierkorb leeren (optional nur eine Art): alle direkt gelöschten Objekte endgültig löschen',
        querystring: KindQuery,
        response: { 200: TrashEmptiedSchema, 400: ApiErrorSchema, 409: ApiErrorSchema },
      },
    },
    async (request) => ({ purged_count: await emptyTrash(db, config.dataDir, request.query.kind) }),
  );
}
