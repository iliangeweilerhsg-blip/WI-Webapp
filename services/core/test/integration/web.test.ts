import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiErrorSchema } from '@sg/shared';
import { startTestApp, type TestApp } from './helpers.ts';

describe('Static Export unter /', () => {
  let t: TestApp;
  beforeAll(async () => {
    const webDir = mkdtempSync(join(tmpdir(), 'sg-core-web-'));
    mkdirSync(join(webDir, '_next'));
    writeFileSync(join(webDir, 'index.html'), '<html>START</html>');
    writeFileSync(join(webDir, 'modul.html'), '<html>MODUL</html>');
    writeFileSync(join(webDir, '_next', 'app.js'), 'console.log(1)');
    t = await startTestApp({ webDir });
  });
  afterAll(async () => {
    await t.close();
  });

  it('liefert index.html unter /', async () => {
    const res = await t.request({ url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('<html>START</html>');
  });

  it('liefert Dateien und die passende .html-Datei (Query-Parameter-Routen)', async () => {
    expect((await t.request({ url: '/_next/app.js' })).body).toBe('console.log(1)');
    expect((await t.request({ url: '/modul?id=0190f6a2-0000-7000-8000-000000000001' })).body).toBe(
      '<html>MODUL</html>',
    );
    expect((await t.request({ url: '/modul/' })).body).toBe('<html>MODUL</html>');
  });

  it('liefert index.html für unbekannte Seiten-Pfade', async () => {
    const res = await t.request({ url: '/gibt/es/nicht' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('<html>START</html>');
  });

  it('liefert 404 für fehlende Dateien mit Endung', async () => {
    expect((await t.request({ url: '/fehlt.js' })).statusCode).toBe(404);
    expect((await t.request({ url: '/_next/fehlt.css' })).statusCode).toBe(404);
  });

  it('liefert nie Dateien außerhalb des Export-Ordners', async () => {
    for (const url of [
      '/%2e%2e/%2e%2e/etc/passwd',
      '/..%2f..%2fetc%2fpasswd',
      '/..%5c..%5cetc%5cpasswd',
      '/%00',
    ]) {
      const res = await t.request({ url });
      expect(res.statusCode, url).toBeLessThan(500);
      expect(res.body, url).not.toContain('root:');
    }
  });

  it('antwortet unter /api nie mit HTML', async () => {
    const res = await t.request({ url: '/api/v1/nope' });
    expect(res.statusCode).toBe(404);
    expect(ApiErrorSchema.parse(res.json()).error.code).toBe('not_found');
    expect((await t.request({ url: '/api' })).statusCode).toBe(404);
  });
});

describe('Web-App fehlt', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startTestApp({ webDir: join(tmpdir(), 'sg-core-web-gibt-es-nicht') });
  });
  afterAll(async () => {
    await t.close();
  });

  it('zeigt eine freundliche Hinweisseite', async () => {
    for (const url of ['/', '/modul']) {
      const res = await t.request({ url });
      expect(res.statusCode).toBe(503);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain('Web-App');
      expect(res.body).toContain('pnpm --filter @sg/web build');
    }
  });

  it('die API läuft trotzdem', async () => {
    expect((await t.request({ url: '/api/v1/health' })).statusCode).toBe(200);
  });
});
