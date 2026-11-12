// GET /system/power (UX-315, VERTRAEGE §7.7)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiErrorSchema, SystemPowerSchema } from '@sg/shared';
import { startTestApp, type TestApp } from './helpers.ts';

let t: TestApp;
beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => {
  await t.close();
});

describe('GET /api/v1/system/power', () => {
  it('lokal ohne Token: 200 im Schema (ohne macOS: kein Akku, kein Fehler)', async () => {
    const res = await t.request({ method: 'GET', url: '/api/v1/system/power' });
    expect(res.statusCode).toBe(200);
    const body = SystemPowerSchema.parse(res.json());
    if (process.platform !== 'darwin') {
      expect(body).toMatchObject({ has_battery: false, percent: null, on_ac: null });
    }
  });

  it('aus dem Netz ohne Token: 401 (mit Token 403 local_only, siehe tunnel.test.ts)', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/v1/system/power',
      remoteAddress: '192.168.1.50',
      headers: { host: '192.168.1.20:4710' },
    });
    expect(res.statusCode).toBe(401);
    expect(ApiErrorSchema.parse(res.json()).error.code).toBe('device_token_required');
  });
});
