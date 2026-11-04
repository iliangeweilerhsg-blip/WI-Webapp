import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiErrorSchema } from '@sg/shared';
import { createDb, type DbHandle } from '../../src/db/client.ts';
import { HttpError } from '../../src/errors.ts';
import { registerErrorHandler } from '../../src/plugins/errors.ts';
import { purgeIdempotencyKeys, registerIdempotency } from '../../src/plugins/idempotency.ts';
import { uuidv7 } from '../../src/lib/uuid7.ts';
import { testDatabaseUrl } from './helpers.ts';

let handle: DbHandle;
let app: FastifyInstance;
let calls = 0;

beforeAll(async () => {
  handle = createDb(testDatabaseUrl());
  app = Fastify({ logger: false });
  registerErrorHandler(app);
  registerIdempotency(app, handle.db);
  app.post('/things', async (request, reply) => {
    calls++;
    const body = request.body as { name?: string; fail?: boolean; slow?: boolean } | null;
    if (body?.fail) throw new Error('kaputt');
    if (body?.slow) await new Promise((resolve) => setTimeout(resolve, 300));
    if (!body?.name) throw new HttpError(400, 'name_missing', 'Name fehlt.');
    return reply.code(201).send({ id: `thing-${calls}`, name: body.name });
  });
  app.post('/other', async () => ({ ok: true }));
  // Nicht-JSON-Body: wird roh angenommen (Hash über Content-Type und Länge)
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) =>
    done(null, body),
  );
  app.post('/upload', async () => {
    calls++;
    return { stored: calls };
  });
  app.get('/things', async () => ({ items: [] }));
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await handle.close();
});
beforeEach(async () => {
  calls = 0;
  await handle.sql`DELETE FROM idempotency_key`;
});

const post = (key: string | undefined, payload: unknown, url = '/things') =>
  app.inject({
    method: 'POST',
    url,
    payload: payload as object,
    headers: key ? { 'idempotency-key': key } : {},
  });

describe('Idempotency-Key (08 §1)', () => {
  it('gibt bei Wiederholung die erste Antwort unverändert zurück, ohne den Handler erneut zu laufen', async () => {
    const key = uuidv7();
    const first = await post(key, { name: 'a' });
    expect(first.statusCode).toBe(201);
    const second = await post(key, { name: 'a' });
    expect(second.statusCode).toBe(201);
    expect(second.body).toBe(first.body);
    expect(second.headers['idempotent-replay']).toBe('true');
    expect(first.headers['idempotent-replay']).toBeUndefined();
    expect(calls).toBe(1);
  });

  it('ohne Header läuft der Handler jedes Mal', async () => {
    await post(undefined, { name: 'a' });
    await post(undefined, { name: 'a' });
    expect(calls).toBe(2);
  });

  it('weist einen Schlüssel, der keine UUID ist, mit 400 ab', async () => {
    const res = await post('abc', { name: 'a' });
    expect(res.statusCode).toBe(400);
    expect(ApiErrorSchema.parse(res.json()).error.code).toBe('invalid_idempotency_key');
    expect(calls).toBe(0);
  });

  it('gleicher Schlüssel mit anderem Body → 422 idempotency_key_reused', async () => {
    const key = uuidv7();
    await post(key, { name: 'a' });
    const res = await post(key, { name: 'b' });
    expect(res.statusCode).toBe(422);
    expect(ApiErrorSchema.parse(res.json()).error.code).toBe('idempotency_key_reused');
    expect(calls).toBe(1);
  });

  it('unterscheidet Pfade: gleicher Schlüssel an anderem Pfad ist eine neue Anfrage', async () => {
    const key = uuidv7();
    await post(key, { name: 'a' });
    const other = await post(key, { name: 'a' }, '/other');
    expect(other.json()).toEqual({ ok: true });
    expect(other.headers['idempotent-replay']).toBeUndefined();
  });

  it('speichert auch 4xx-Antworten und gibt sie bei Wiederholung zurück', async () => {
    const key = uuidv7();
    const first = await post(key, { nope: 1 });
    expect(first.statusCode).toBe(400);
    const second = await post(key, { nope: 1 });
    expect(second.statusCode).toBe(400);
    expect(second.body).toBe(first.body);
    expect(calls).toBe(1);
  });

  it('speichert 5xx nicht: der Schlüssel wird wieder frei', async () => {
    const key = uuidv7();
    expect((await post(key, { fail: true })).statusCode).toBe(500);
    const rows = await handle.sql`SELECT 1 FROM idempotency_key`;
    expect(rows).toHaveLength(0);
    // gleiche Anfrage nochmal: Handler läuft erneut (kein 422/409)
    expect((await post(key, { fail: true })).statusCode).toBe(500);
    expect(calls).toBe(2);
  });

  it('meldet 409, solange die erste Anfrage noch läuft', async () => {
    const key = uuidv7();
    const [a, b] = await Promise.all([
      post(key, { name: 'a', slow: true }),
      (async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return post(key, { name: 'a', slow: true });
      })(),
    ]);
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(409);
    expect(ApiErrorSchema.parse(b.json()).error.code).toBe('idempotency_key_in_progress');
    expect(calls).toBe(1);
  });

  it('GET ignoriert den Header', async () => {
    const res = await app.inject({ url: '/things', headers: { 'idempotency-key': 'egal' } });
    expect(res.statusCode).toBe(200);
  });

  it('behandelt Nicht-JSON-Anfragen über Content-Type und Länge', async () => {
    const key = uuidv7();
    const send = (body: string) =>
      app.inject({
        method: 'POST',
        url: '/upload',
        payload: body,
        headers: { 'idempotency-key': key, 'content-type': 'application/octet-stream' },
      });
    const first = await send('12345');
    expect(first.json()).toEqual({ stored: 1 });
    const again = await send('abcde'); // gleiche Länge → gilt als Wiederholung
    expect(again.headers['idempotent-replay']).toBe('true');
    expect(again.json()).toEqual({ stored: 1 });
    expect((await send('123456')).statusCode).toBe(422);
    expect(calls).toBe(1);
  });

  it('löscht beim Start Einträge, die älter als 24 h sind', async () => {
    const oldKey = uuidv7();
    const freshKey = uuidv7();
    await handle.sql`INSERT INTO idempotency_key (key, method, path, request_hash, status, created_at)
      VALUES (${oldKey}, 'POST', '/things', 'h', 201, now() - interval '25 hours'),
             (${freshKey}, 'POST', '/things', 'h', 201, now() - interval '23 hours')`;
    expect(await purgeIdempotencyKeys(handle.db)).toBe(1);
    const left = await handle.sql`SELECT key FROM idempotency_key`;
    expect(left.map((r) => r.key)).toEqual([freshKey]);
  });
});
