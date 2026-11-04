// registerInkHandlers meldet alle Op-Arten dieses Bereichs an (VERTRAEGE §16.2); writePartFile begrenzt die Größe
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '../../src/errors.ts';
import { writePartFile } from '../../src/services/pages.ts';

const registered = vi.hoisted(() => new Map<string, unknown>());
vi.mock('../../src/sync/handlers.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/sync/handlers.ts')>()),
  registerOpHandler: (kind: string, handler: unknown) => {
    registered.set(kind, handler);
  },
}));

const { registerInkHandlers } = await import('../../src/sync/handlers/ink.ts');

describe('registerInkHandlers', () => {
  beforeEach(() => registered.clear());

  it('meldet jede Op-Art von Core-Ink genau einmal an', () => {
    registerInkHandlers({ dataDir: '/tmp/unused' });
    expect([...registered.keys()].sort()).toEqual(
      [
        'notebook.create',
        'notebook.update',
        'notebook.delete',
        'notebook.restore',
        'page.create',
        'page.update',
        'page.delete',
        'page.restore',
        'stroke.add',
        'stroke.remove',
        'element.upsert',
        'element.remove',
        'drawing.snapshot',
        'photo.add',
      ].sort(),
    );
    for (const handler of registered.values()) expect(typeof handler).toBe('function');
  });
});

describe('writePartFile', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sg-part-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('schreibt .part, bildet sha256 und Größe', async () => {
    const part = await writePartFile(Readable.from([Buffer.from('abc')]), join(dir, 'ok.bin'), 10);
    expect(part).toMatchObject({
      size: 3,
      sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    });
    expect(part.partPath.endsWith('.part')).toBe(true);
    expect(existsSync(join(dir, 'ok.bin'))).toBe(false);
  });

  it('bricht über dem Limit mit 413 ab und räumt auf (auch ohne Content-Length)', async () => {
    const error = await writePartFile(
      Readable.from([Buffer.alloc(6), Buffer.alloc(6)]),
      join(dir, 'big.bin'),
      10,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ statusCode: 413, code: 'file_too_large' });
    expect(readdirSync(dir).filter((n) => n.startsWith('big.bin'))).toEqual([]);
  });
});
