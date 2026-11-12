// Speicherplatz (UX-11): Größe des Datenordners, Zwischenspeicher, Datenbankgröße
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SystemStorageSchema } from '@sg/shared';
import type { Db } from '../../src/db/client.ts';
import { measureDir, StorageMeter } from '../../src/services/storage.ts';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sg-storage-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function fill(path: string, bytes: number) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, Buffer.alloc(bytes));
}

function fakeDb(bytes: string | number | 'fehler' | 'haengt'): Db {
  const execute = vi.fn(async () => {
    if (bytes === 'fehler') throw new Error('keine Verbindung');
    if (bytes === 'haengt') return new Promise(() => undefined);
    return [{ bytes }];
  });
  return { execute } as unknown as Db;
}

describe('measureDir', () => {
  it('summiert Dateien und teilt nach media und vault auf', async () => {
    fill(join(dir, 'media', 'recordings', 'a', 'full.m4a'), 1000);
    fill(join(dir, 'media', 'photos', 'p.jpg'), 200);
    fill(join(dir, 'vault', 'Notiz.md'), 30);
    fill(join(dir, 'logs', 'core.log'), 4);
    const sizes = await measureDir(dir);
    expect(sizes).toEqual({ total: 1234, media: 1200, vault: 30 });
  });

  it('folgt Symlinks nicht', async () => {
    fill(join(dir, 'media', 'a.bin'), 100);
    const outside = mkdtempSync(join(tmpdir(), 'sg-storage-out-'));
    try {
      fill(join(outside, 'gross.bin'), 50_000);
      symlinkSync(outside, join(dir, 'media', 'link'));
      const sizes = await measureDir(dir);
      // Der Symlink zählt nur mit seiner eigenen (kleinen) Größe
      expect(sizes.total).toBeLessThan(1000);
      expect(sizes.media).toBe(sizes.total);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('ein fehlender Ordner ergibt 0', async () => {
    expect(await measureDir(join(dir, 'gibt-es-nicht'))).toEqual({ total: 0, media: 0, vault: 0 });
  });
});

describe('StorageMeter', () => {
  it('liefert eine gültige Antwort mit Aufteilung und Datenbankgröße', async () => {
    fill(join(dir, 'media', 'a.bin'), 500);
    const meter = new StorageMeter({ dataDir: dir, db: fakeDb('73400320') });
    const result = await meter.read();
    expect(SystemStorageSchema.safeParse(result).success).toBe(true);
    expect(result.data_dir_size_bytes).toBe(500);
    expect(result.media_bytes).toBe(500);
    expect(result.vault_bytes).toBe(0);
    expect(result.db_bytes).toBe(73_400_320);
    expect(result.data_dir_free_bytes).toBeGreaterThan(0);
  });

  it('misst die Größe nicht bei jedem Aufruf neu, den freien Platz schon', async () => {
    fill(join(dir, 'media', 'a.bin'), 100);
    let now = 1_000_000;
    const meter = new StorageMeter({ dataDir: dir, db: fakeDb(1), ttlMs: 60_000, now: () => now });
    const first = await meter.read();
    fill(join(dir, 'media', 'b.bin'), 900);
    now += 30_000;
    const second = await meter.read();
    expect(second.data_dir_size_bytes).toBe(100);
    expect(second.measured_at).toBe(first.measured_at);
    now += 31_000;
    const third = await meter.read();
    expect(third.data_dir_size_bytes).toBe(1000);
    expect(third.measured_at).toBe(new Date(now).toISOString());
  });

  it('gleichzeitige Aufrufe teilen sich einen Durchlauf', async () => {
    fill(join(dir, 'media', 'a.bin'), 10);
    const meter = new StorageMeter({ dataDir: dir, db: fakeDb(1) });
    const [a, b] = await Promise.all([meter.read(), meter.read()]);
    expect(a.measured_at).toBe(b.measured_at);
  });

  it('db_bytes fehlt, wenn die Abfrage scheitert oder hängt', async () => {
    const failing = await new StorageMeter({ dataDir: dir, db: fakeDb('fehler') }).read();
    expect('db_bytes' in failing).toBe(false);
    const hanging = await new StorageMeter({ dataDir: dir, db: fakeDb('haengt'), dbTimeoutMs: 20 }).read();
    expect('db_bytes' in hanging).toBe(false);
  });

  it('ein fehlender Datenordner wirft (die Route macht daraus 503)', async () => {
    const meter = new StorageMeter({ dataDir: join(dir, 'gibt-es-nicht'), db: fakeDb(1) });
    await expect(meter.read()).rejects.toThrow();
  });
});
