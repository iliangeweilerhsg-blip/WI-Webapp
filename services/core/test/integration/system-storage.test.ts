// GET /system/storage (UX-11, VERTRAEGE §7.6)
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiErrorSchema, SystemStorageSchema } from '@sg/shared';
import { startTestApp, type TestApp } from './helpers.ts';

let t: TestApp;
beforeAll(async () => {
  t = await startTestApp();
  mkdirSync(join(t.config.dataDir, 'media', 'recordings'), { recursive: true });
  writeFileSync(join(t.config.dataDir, 'media', 'recordings', 'x.m4a'), Buffer.alloc(2048));
  mkdirSync(join(t.config.dataDir, 'vault'), { recursive: true });
  writeFileSync(join(t.config.dataDir, 'vault', 'n.md'), Buffer.alloc(100));
});
afterAll(async () => {
  await t.close();
});

describe('GET /api/v1/system/storage', () => {
  it('lokal ohne Token: freier Platz, Größe, Aufteilung und Datenbankgröße', async () => {
    const res = await t.request({ method: 'GET', url: '/api/v1/system/storage' });
    expect(res.statusCode).toBe(200);
    const body = SystemStorageSchema.parse(res.json());
    expect(body.data_dir_free_bytes).toBeGreaterThan(0);
    expect(body.data_dir_size_bytes).toBe(2148);
    expect(body.media_bytes).toBe(2048);
    expect(body.vault_bytes).toBe(100);
    expect(body.db_bytes).toBeGreaterThan(0);
    // Keine Pfade in der Antwort
    expect(res.body).not.toContain(t.config.dataDir);
  });

  it('aus dem Netz ohne Token: 401 device_token_required', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/v1/system/storage',
      remoteAddress: '192.168.1.50',
      headers: { host: '192.168.1.20:4710' },
    });
    expect(res.statusCode).toBe(401);
    expect(ApiErrorSchema.parse(res.json()).error.code).toBe('device_token_required');
  });

  it('der Zwischenspeicher hält die Größe, der freie Platz bleibt frisch', async () => {
    const first = SystemStorageSchema.parse(
      (await t.request({ method: 'GET', url: '/api/v1/system/storage' })).json(),
    );
    writeFileSync(join(t.config.dataDir, 'media', 'spaeter.bin'), Buffer.alloc(4096));
    const second = SystemStorageSchema.parse(
      (await t.request({ method: 'GET', url: '/api/v1/system/storage' })).json(),
    );
    expect(second.data_dir_size_bytes).toBe(first.data_dir_size_bytes);
    expect(second.measured_at).toBe(first.measured_at);
  });

  it('fehlt der Datenordner: 503 storage_unavailable', async () => {
    const broken = await startTestApp();
    try {
      rmSync(broken.config.dataDir, { recursive: true, force: true });
      const res = await broken.request({ method: 'GET', url: '/api/v1/system/storage' });
      expect(res.statusCode).toBe(503);
      expect(ApiErrorSchema.parse(res.json()).error.code).toBe('storage_unavailable');
    } finally {
      await broken.close();
    }
  });
});
