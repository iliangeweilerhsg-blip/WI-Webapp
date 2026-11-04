import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ApiErrorSchema } from '@sg/shared';
import { HttpError } from '../../src/errors.ts';
import { registerErrorHandler } from '../../src/plugins/errors.ts';

const app = Fastify({ logger: false });
app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);
registerErrorHandler(app);

const typed = app.withTypeProvider<ZodTypeProvider>();
typed.get('/boom', async () => {
  throw new Error('geheime Details: Passwort=hunter2');
});
typed.get('/http', async () => {
  throw new HttpError(409, 'slide_deck_exists', 'Gibt es schon.', { id: 'x' });
});
typed.get('/http-ohne-details', async () => {
  throw new HttpError(404, 'slide_deck_not_found', 'Nicht gefunden.');
});
typed.get('/query', { schema: { querystring: z.object({ n: z.coerce.number().int() }) } }, async () => ({}));
typed.post('/body', { schema: { body: z.object({ name: z.string().min(1) }) } }, async () => ({}));

beforeAll(async () => {
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

describe('Fehlerformat ApiError (08 §1)', () => {
  it('HttpError → Status, Code, Meldung und Details', async () => {
    const res = await app.inject('/http');
    expect(res.statusCode).toBe(409);
    expect(ApiErrorSchema.parse(res.json())).toEqual({
      error: { code: 'slide_deck_exists', message: 'Gibt es schon.', details: { id: 'x' } },
    });
  });

  it('lässt details weg, wenn es keine gibt', async () => {
    const res = await app.inject('/http-ohne-details');
    expect(res.json()).toEqual({ error: { code: 'slide_deck_not_found', message: 'Nicht gefunden.' } });
  });

  it('Zod-Fehler in der Query → 400 validation_failed mit Pfad', async () => {
    const res = await app.inject('/query?n=abc');
    expect(res.statusCode).toBe(400);
    const body = ApiErrorSchema.parse(res.json());
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.details).toMatchObject({ in: 'querystring', issues: [{ path: 'n' }] });
  });

  it('Zod-Fehler im Body → 400 validation_failed', async () => {
    const res = await app.inject({ method: 'POST', url: '/body', payload: { name: '' } });
    expect(res.statusCode).toBe(400);
    const body = ApiErrorSchema.parse(res.json());
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.details).toMatchObject({ in: 'body', issues: [{ path: 'name' }] });
  });

  it('kaputtes JSON → 400 bad_request im ApiError-Format', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/body',
      headers: { 'content-type': 'application/json' },
      payload: '{kaputt',
    });
    expect(res.statusCode).toBe(400);
    expect(ApiErrorSchema.parse(res.json()).error.code).toBe('bad_request');
  });

  it('unerwarteter Fehler → 500 internal_error ohne interne Details', async () => {
    const res = await app.inject('/boom');
    expect(res.statusCode).toBe(500);
    expect(ApiErrorSchema.parse(res.json()).error.code).toBe('internal_error');
    expect(res.body).not.toContain('hunter2');
  });
});
