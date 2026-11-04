import { createHash } from 'node:crypto';
import { and, eq, lt, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from '../db/client.ts';
import { idempotencyKey } from '../db/schema/index.ts';
import { HttpError } from '../errors.ts';

/**
 * `Idempotency-Key` für POST (08 §1). Ablauf:
 * - Header fehlt: nichts passiert. Header kein UUID: 400 `invalid_idempotency_key`.
 * - Erster Aufruf: Der Schlüssel wird reserviert (status 0), die Antwort danach gespeichert.
 *   Antworten mit Status ≥ 500 werden nicht gespeichert, der Schlüssel wird wieder frei.
 * - Wiederholung mit gleichem Schlüssel, Methode, Pfad und gleicher Anfrage: die gespeicherte Antwort
 *   kommt unverändert zurück (Header `Idempotent-Replay: true`).
 * - Gleicher Schlüssel mit anderer Anfrage: 422 `idempotency_key_reused`.
 * - Gleicher Schlüssel, erste Anfrage läuft noch: 409 `idempotency_key_in_progress`.
 *
 * Gespeichert werden nur JSON-Antworten. Der Anfrage-Hash deckt Query und JSON-Body ab; bei anderen
 * Inhalten (multipart) Content-Type und Content-Length, weil der Body dort erst der Handler liest.
 */

export const IDEMPOTENCY_TTL_HOURS = 24;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

declare module 'fastify' {
  interface FastifyRequest {
    idempotency?: { key: string; method: string; path: string };
  }
}

function pathOf(request: FastifyRequest): string {
  return request.url.split('?')[0] ?? '/';
}

export function hashRequest(request: FastifyRequest): string {
  const contentType = request.headers['content-type'] ?? '';
  const query = request.url.includes('?') ? request.url.slice(request.url.indexOf('?')) : '';
  const isJson = contentType.toLowerCase().startsWith('application/json');
  const content = isJson
    ? JSON.stringify(request.body ?? null)
    : `${contentType}|${request.headers['content-length'] ?? ''}`;
  return createHash('sha256').update(`${query}\n${content}`).digest('hex');
}

/** Löscht Einträge, die älter als 24 h sind. Beim Start aufrufen. */
export async function purgeIdempotencyKeys(db: Db): Promise<number> {
  const rows = await db
    .delete(idempotencyKey)
    .where(lt(idempotencyKey.createdAt, sql`now() - make_interval(hours => ${IDEMPOTENCY_TTL_HOURS})`))
    .returning({ key: idempotencyKey.key });
  return rows.length;
}

export function registerIdempotency(app: FastifyInstance, db: Db): void {
  app.addHook('preHandler', async (request, reply) => {
    if (request.method !== 'POST') return;
    const header = request.headers['idempotency-key'];
    if (header === undefined) return;
    if (typeof header !== 'string' || !UUID_RE.test(header)) {
      throw new HttpError(400, 'invalid_idempotency_key', 'Idempotency-Key muss eine UUID sein.');
    }
    const key = header.toLowerCase();
    const method = request.method;
    const path = pathOf(request);
    const requestHash = hashRequest(request);

    const inserted = await db
      .insert(idempotencyKey)
      .values({ key, method, path, requestHash, status: 0 })
      .onConflictDoNothing()
      .returning({ key: idempotencyKey.key });

    if (inserted.length > 0) {
      request.idempotency = { key, method, path };
      return;
    }

    const [existing] = await db
      .select()
      .from(idempotencyKey)
      .where(
        and(eq(idempotencyKey.key, key), eq(idempotencyKey.method, method), eq(idempotencyKey.path, path)),
      );
    if (!existing) {
      // Zwischenzeitlich gelöscht (fehlgeschlagene erste Anfrage): Client soll es noch einmal versuchen
      throw new HttpError(409, 'idempotency_key_in_progress', 'Bitte die Anfrage wiederholen.');
    }
    if (existing.requestHash !== requestHash) {
      throw new HttpError(
        422,
        'idempotency_key_reused',
        'Dieser Idempotency-Key wurde schon mit einer anderen Anfrage verwendet.',
      );
    }
    if (existing.status === 0) {
      throw new HttpError(
        409,
        'idempotency_key_in_progress',
        'Die erste Anfrage mit diesem Idempotency-Key läuft noch.',
      );
    }
    return reply
      .code(existing.status)
      .header('content-type', 'application/json; charset=utf-8')
      .header('idempotent-replay', 'true')
      .send(JSON.stringify(existing.response ?? null));
  });

  app.addHook('onSend', async (request, reply, payload) => {
    const ctx = request.idempotency;
    if (!ctx) return payload;
    request.idempotency = undefined;
    const where = and(
      eq(idempotencyKey.key, ctx.key),
      eq(idempotencyKey.method, ctx.method),
      eq(idempotencyKey.path, ctx.path),
    );
    try {
      const contentType = String(reply.getHeader('content-type') ?? '');
      if (reply.statusCode >= 500 || !contentType.startsWith('application/json')) {
        await db.delete(idempotencyKey).where(where);
      } else {
        const response = typeof payload === 'string' && payload.length > 0 ? JSON.parse(payload) : null;
        await db.update(idempotencyKey).set({ status: reply.statusCode, response }).where(where);
      }
    } catch (error) {
      request.log.error({ err: error }, 'Idempotency-Key konnte nicht gespeichert werden');
      await db
        .delete(idempotencyKey)
        .where(where)
        .catch(() => {});
    }
    return payload;
  });
}
