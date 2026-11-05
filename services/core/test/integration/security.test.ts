import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiErrorSchema } from '@sg/shared';
import { startTestApp, TEST_PORT, type TestApp } from './helpers.ts';

const DEVICE_ID = '0190f6a2-0000-7000-8000-0000000000f1';

let t: TestApp;
beforeAll(async () => {
  t = await startTestApp({ devWebOrigin: 'http://localhost:3000' });
});
afterAll(async () => {
  await t.close();
});

function errorCode(body: unknown): string {
  return ApiErrorSchema.parse(body).error.code;
}

describe('Netz ohne Token (VERTRAEGE §5)', () => {
  it('Anfrage von fremder IP → 401 device_token_required', async () => {
    const res = await t.app.inject({
      url: '/api/v1/health',
      remoteAddress: '192.168.1.23',
      headers: { host: `192.168.1.5:${TEST_PORT}` },
    });
    expect(res.statusCode).toBe(401);
    expect(errorCode(res.json())).toBe('device_token_required');
  });

  it('mit unbekanntem Bearer-Token → 401 device_token_invalid', async () => {
    const res = await t.app.inject({
      url: '/api/v1/health',
      remoteAddress: '192.168.1.23',
      headers: { host: `192.168.1.5:${TEST_PORT}`, authorization: 'Bearer abc' },
    });
    expect(res.statusCode).toBe(401);
    expect(errorCode(res.json())).toBe('device_token_invalid');
  });

  it('gilt für alle Pfade, auch Web-App und unbekannte', async () => {
    for (const url of ['/', '/modul', '/api/v1/jobs', '/api/v1/openapi.json', '/api/v1/gibt-es-nicht']) {
      const res = await t.app.inject({ url, remoteAddress: '10.0.0.7' });
      expect(res.statusCode, url).toBe(401);
    }
  });

  it('ein Host-Header „localhost“ macht eine Netz-Anfrage nicht lokal', async () => {
    const res = await t.app.inject({
      url: '/api/v1/health',
      remoteAddress: '203.0.113.9',
      headers: { host: `localhost:${TEST_PORT}`, 'x-forwarded-for': '127.0.0.1' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('X-Forwarded-For: 127.0.0.1 macht eine Netz-Anfrage nicht lokal (trustProxy aus)', async () => {
    const res = await t.app.inject({
      url: '/api/v1/health',
      remoteAddress: '203.0.113.9',
      headers: { 'x-forwarded-for': '127.0.0.1', host: '203.0.113.5:4710' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('mit gültigem Token (Prüfer eingehängt) kommt die Anfrage durch', async () => {
    const ok = await startTestApp(
      {},
      {
        verifyDeviceToken: async (token) => (token === 'gueltig' ? { deviceId: DEVICE_ID } : null),
      },
    );
    try {
      const headers = { host: `192.168.1.5:${TEST_PORT}` };
      const good = await ok.app.inject({
        url: '/api/v1/health',
        remoteAddress: '192.168.1.23',
        headers: { ...headers, authorization: 'Bearer gueltig' },
      });
      expect(good.statusCode).toBe(200);
      const bad = await ok.app.inject({
        url: '/api/v1/health',
        remoteAddress: '192.168.1.23',
        headers: { ...headers, authorization: 'Bearer falsch' },
      });
      expect(bad.statusCode).toBe(401);
    } finally {
      await ok.close();
    }
  });
});

describe('Framework-Fehler (kaputte URL)', () => {
  it('lokal: 400 bad_request im ApiError-Format', async () => {
    const res = await t.request({ url: '/%E0%A4%A' });
    expect(res.statusCode).toBe(400);
    expect(errorCode(res.json())).toBe('bad_request');
  });

  it('Netz: Sicherheitsprüfung greift auch hier (401 statt 400)', async () => {
    const res = await t.app.inject({
      url: '/%E0%A4%A',
      remoteAddress: '192.168.1.23',
      headers: { host: `192.168.1.5:${TEST_PORT}` },
    });
    expect(res.statusCode).toBe(401);
    expect(errorCode(res.json())).toBe('device_token_required');
  });

  it('lokal mit falschem Host: 421', async () => {
    const res = await t.request({ url: '/%E0%A4%A', headers: { host: 'evil.example' } });
    expect(res.statusCode).toBe(421);
  });
});

describe('Lokal per Socket-Adresse', () => {
  it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1'])('%s braucht kein Token', async (remoteAddress) => {
    const res = await t.app.inject({
      url: '/api/v1/health',
      remoteAddress,
      headers: { host: `localhost:${TEST_PORT}` },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('Host-Allowlist gegen DNS-Rebinding', () => {
  it.each([
    `localhost:${TEST_PORT}`,
    `127.0.0.1:${TEST_PORT}`,
    `[::1]:${TEST_PORT}`,
    `LOCALHOST:${TEST_PORT}`,
  ])('lässt %s zu', async (host) => {
    const res = await t.request({ url: '/api/v1/health', headers: { host } });
    expect(res.statusCode).toBe(200);
  });

  it.each([
    'evil.example',
    `evil.example:${TEST_PORT}`,
    'localhost',
    'localhost:9999',
    `localhost.evil.example:${TEST_PORT}`,
  ])('lehnt lokale Anfrage mit Host %s ab (421 host_not_allowed)', async (host) => {
    const res = await t.request({ url: '/api/v1/health', headers: { host } });
    expect(res.statusCode).toBe(421);
    expect(errorCode(res.json())).toBe('host_not_allowed');
  });
});

describe('Origin-Prüfung gegen CSRF', () => {
  // Die Prüfung läuft vor dem Routing; die Route /noch-nicht-gebaut gibt es bewusst nicht,
  // darum zeigt „nicht 403“ (hier 404 not_found) zuverlässig, dass die Anfrage zugelassen wurde.
  const post = (origin?: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'POST') =>
    t.request({ method, url: '/api/v1/noch-nicht-gebaut', headers: origin ? { origin } : {} });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)(
    '%s mit fremdem Origin → 403 origin_not_allowed',
    async (method) => {
      const res = await post('http://evil.example', method);
      expect(res.statusCode).toBe(403);
      expect(errorCode(res.json())).toBe('origin_not_allowed');
    },
  );

  it('Origin „null“ wird abgelehnt', async () => {
    expect((await post('null')).statusCode).toBe(403);
  });

  it('gleicher Hostname, anderer Port → 403', async () => {
    expect((await post('http://localhost:3001')).statusCode).toBe(403);
  });

  it.each([
    `http://localhost:${TEST_PORT}`,
    `http://127.0.0.1:${TEST_PORT}`,
    `http://[::1]:${TEST_PORT}`,
    'http://localhost:3000',
  ])('lässt Origin %s zu', async (origin) => {
    expect((await post(origin)).statusCode).toBe(404);
  });

  it('ohne Origin-Header (curl, iPad-App) gilt nur die Token-Regel', async () => {
    expect((await post()).statusCode).toBe(404);
  });

  it('lesende Anfragen mit fremdem Origin werden nicht gesperrt (CORS verweigert nur die Header)', async () => {
    const res = await t.request({ url: '/api/v1/health', headers: { origin: 'http://evil.example' } });
    expect(res.statusCode).toBe(200);
  });

  it('Netz-Anfrage mit Token, aber fremdem Origin → 403', async () => {
    const ok = await startTestApp({}, { verifyDeviceToken: async () => ({ deviceId: DEVICE_ID }) });
    try {
      const res = await ok.app.inject({
        method: 'POST',
        url: '/api/v1/noch-nicht-gebaut',
        remoteAddress: '192.168.1.23',
        headers: {
          host: `192.168.1.5:${TEST_PORT}`,
          authorization: 'Bearer x',
          origin: 'http://evil.example',
        },
      });
      expect(res.statusCode).toBe(403);
      const same = await ok.app.inject({
        method: 'POST',
        url: '/api/v1/noch-nicht-gebaut',
        remoteAddress: '192.168.1.23',
        headers: {
          host: `192.168.1.5:${TEST_PORT}`,
          authorization: 'Bearer x',
          origin: `http://192.168.1.5:${TEST_PORT}`,
        },
      });
      expect(same.statusCode).toBe(404);
    } finally {
      await ok.close();
    }
  });
});
