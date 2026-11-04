import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiErrorSchema, HealthSchema } from '@sg/shared';
import { startTestApp, type TestApp } from './helpers.ts';

let t: TestApp;
beforeAll(async () => {
  t = await startTestApp({ devWebOrigin: 'http://localhost:3000' });
});
afterAll(async () => {
  await t.close();
});

describe('GET /api/v1/health', () => {
  it('liefert exakt den Typ Health', async () => {
    const res = await t.request({ url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    const body = HealthSchema.parse(res.json()); // .strict(): keine zusätzlichen Felder
    expect(body).toEqual({ status: 'ok', db: 'ok', version: '0.0.0' });
  });
});

describe('Fehlerformat', () => {
  it('unbekannte API-Route → 404 ApiError', async () => {
    const res = await t.request({ url: '/api/v1/gibt-es-nicht' });
    expect(res.statusCode).toBe(404);
    expect(ApiErrorSchema.parse(res.json()).error.code).toBe('not_found');
  });

  it('falsche Methode auf bekannter Route → 404 ApiError', async () => {
    const res = await t.request({ method: 'DELETE', url: '/api/v1/health' });
    expect(res.statusCode).toBe(404);
    expect(ApiErrorSchema.parse(res.json()).error.code).toBe('not_found');
  });

  it('ungültige Query → 400 validation_failed (Zod aus @sg/shared)', async () => {
    const res = await t.request({ url: '/api/v1/jobs?state=kaputt&session_id=keine-uuid' });
    expect(res.statusCode).toBe(400);
    const body = ApiErrorSchema.parse(res.json());
    expect(body.error.code).toBe('validation_failed');
    const issues = (body.error.details as { issues: { path: string }[] }).issues;
    expect(issues.map((i) => i.path).sort()).toEqual(['session_id', 'state']);
  });
});

describe('OpenAPI', () => {
  it('wird aus den Routen erzeugt', async () => {
    const res = await t.request({ url: '/api/v1/openapi.json' });
    expect(res.statusCode).toBe(200);
    const doc = res.json();
    expect(doc.openapi).toMatch(/^3\./);
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(['/api/v1/health', '/api/v1/jobs']));
    expect(doc.paths['/api/v1/jobs'].get.parameters.map((p: { name: string }) => p.name)).toEqual(
      expect.arrayContaining(['session_id', 'state', 'cursor', 'limit']),
    );
  });
});

describe('CORS', () => {
  it('erlaubt nur SG_DEV_WEB_ORIGIN', async () => {
    const dev = await t.request({
      method: 'OPTIONS',
      url: '/api/v1/jobs',
      headers: {
        origin: 'http://localhost:3000',
        'access-control-request-method': 'GET',
      },
    });
    expect(dev.headers['access-control-allow-origin']).toBe('http://localhost:3000');

    const other = await t.request({
      url: '/api/v1/health',
      headers: { origin: 'http://evil.example' },
    });
    expect(other.statusCode).toBe(200);
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('sendet ohne SG_DEV_WEB_ORIGIN keine CORS-Header', async () => {
    const plain = await startTestApp({ devWebOrigin: '' });
    try {
      const res = await plain.request({
        url: '/api/v1/health',
        headers: { origin: 'http://localhost:3000' },
      });
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      await plain.close();
    }
  });
});
