import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { hasOpenPermissions } from '../../src/config.ts';
import { createLogger, initialLogDay, loggerOptions, redactUrl, rotateLogs } from '../../src/logger.ts';

const DAY = 24 * 60 * 60 * 1000;

function touch(file: string, mtime: Date): void {
  writeFileSync(file, 'x');
  utimesSync(file, mtime, mtime);
}

describe('rotateLogs', () => {
  const now = new Date('2026-11-04T12:00:00Z');

  it('benennt core.log vom Vortag in core-<Tag>.log um und meldet den neuen Tag', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sg-core-log-'));
    touch(join(dir, 'core.log'), new Date(now.getTime() - DAY));
    expect(rotateLogs(dir, '2026-11-03', now)).toBe('2026-11-04');
    expect(existsSync(join(dir, 'core.log'))).toBe(false);
    expect(existsSync(join(dir, 'core-2026-11-03.log'))).toBe(true);
  });

  it('rotiert auch, wenn nach Mitternacht schon geschrieben wurde (mtime ist heute)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sg-core-log-'));
    const file = join(dir, 'core.log');
    writeFileSync(file, 'zeile von gestern\n');
    appendFileSync(file, 'zeile von heute 00:30\n');
    const afterMidnight = new Date('2026-11-04T00:30:00Z');
    utimesSync(file, afterMidnight, afterMidnight);
    expect(rotateLogs(dir, '2026-11-03', new Date('2026-11-04T00:45:00Z'))).toBe('2026-11-04');
    expect(existsSync(file)).toBe(false);
    expect(readFileSync(join(dir, 'core-2026-11-03.log'), 'utf8')).toContain('zeile von gestern');
  });

  it('lässt die Datei des heutigen Tages in Ruhe', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sg-core-log-'));
    touch(join(dir, 'core.log'), new Date(now.getTime() - 60_000));
    expect(rotateLogs(dir, '2026-11-04', now)).toBe('2026-11-04');
    expect(existsSync(join(dir, 'core.log'))).toBe(true);
  });

  it('löscht Archive, die älter als 14 Tage sind, und behält jüngere', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sg-core-log-'));
    touch(join(dir, 'core-2026-10-01.log'), new Date(now.getTime() - 34 * DAY));
    touch(join(dir, 'core-2026-10-25.log'), new Date(now.getTime() - 10 * DAY));
    touch(join(dir, 'worker.log'), new Date(now.getTime() - 99 * DAY)); // fremde Datei bleibt
    rotateLogs(dir, '2026-11-04', now);
    expect(existsSync(join(dir, 'core-2026-10-01.log'))).toBe(false);
    expect(existsSync(join(dir, 'core-2026-10-25.log'))).toBe(true);
    expect(existsSync(join(dir, 'worker.log'))).toBe(true);
  });

  it('legt den Ordner an, wenn er fehlt', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'sg-core-log-')), 'logs');
    expect(rotateLogs(dir, '2026-11-04', now)).toBe('2026-11-04');
    expect(existsSync(dir)).toBe(true);
  });
});

describe('initialLogDay', () => {
  it('nimmt den mtime-Tag einer vorhandenen Datei, sonst heute', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sg-core-log-'));
    const now = new Date('2026-11-04T12:00:00Z');
    expect(initialLogDay(dir, now)).toBe('2026-11-04');
    touch(join(dir, 'core.log'), new Date('2026-11-01T08:00:00Z'));
    expect(initialLogDay(dir, now)).toBe('2026-11-01');
  });
});

describe('hasOpenPermissions', () => {
  it('erkennt .env-Dateien, die nicht 600 sind', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sg-core-perm-'));
    const file = join(dir, '.env');
    writeFileSync(file, 'A=1');
    chmodSync(file, 0o600);
    expect(hasOpenPermissions(file)).toBe(false);
    chmodSync(file, 0o644);
    expect(hasOpenPermissions(file)).toBe(true);
  });
});

describe('Request-Log schwärzt geheime Query-Parameter (Issue #91)', () => {
  const SECRET = '00000000-0000-4000-8000-000000000091';

  it('redactUrl: nur geheime Namen, Rest und Reihenfolge bleiben', () => {
    expect(redactUrl('/devices/pairings?pairing_id=abc')).toBe('/devices/pairings?pairing_id=[Redacted]');
    expect(redactUrl('/x?limit=5&Token=a&code=1&cursor=z')).toBe(
      '/x?limit=5&Token=[Redacted]&code=[Redacted]&cursor=z',
    );
    expect(redactUrl('/x?pairing%5Fid=a&device_token=b')).toBe(
      '/x?pairing%5Fid=[Redacted]&device_token=[Redacted]',
    );
    expect(redactUrl('/x?pairing_id=a&pairing_id=b#f')).toBe(
      '/x?pairing_id=[Redacted]&pairing_id=[Redacted]#f',
    );
    expect(redactUrl('/devices')).toBe('/devices');
    expect(redactUrl('/x?')).toBe('/x?');
  });

  it('Namensgrenzen: harmlose Parameter bleiben lesbar, geheime werden geschwärzt', () => {
    for (const name of ['author', 'keyword', 'sort_key', 'session_id', 'limit', 'codec', 'tokens']) {
      expect(redactUrl(`/x?${name}=v`)).toBe(`/x?${name}=v`);
    }
    for (const name of [
      'pairing_id',
      'PAIRING_ID',
      'pairing%5Fid',
      'token',
      'access_token',
      'wstoken',
      'device-token',
      'code',
      'api_key',
      'secret',
    ]) {
      expect(redactUrl(`/x?a=1&${name}=v`)).toBe(`/x?a=1&${name}=[Redacted]`);
    }
  });

  it('printf-Argumente und Fehlerobjekte werden geschwärzt', () => {
    const lines: string[] = [];
    const logger = pino(loggerOptions({ logLevel: 'trace' }), { write: (c: string) => void lines.push(c) });
    logger.info('Route %s', '/x?pairing_id=GEHEIM1');
    logger.info({ a: 1 }, 'Route %s und %s', 'ok', '/y?token=GEHEIM2');
    logger.error(new Error('kaputt bei /z?pairing_id=GEHEIM3'));
    logger.error({ err: new Error('bei /z?access_token=GEHEIM4') }, 'Fehler');
    const log = lines.join('');
    expect(log).not.toMatch(/GEHEIM/);
    expect(log).toContain('"msg":"Route /x?pairing_id=[Redacted]"');
  });

  it('die pairing_id taucht im echten Log-Strom nicht auf (Request- und Fehlerzeilen)', async () => {
    const lines: string[] = [];
    const stream = { write: (chunk: string) => void lines.push(chunk) };
    const logger = pino(loggerOptions({ logLevel: 'trace' }), stream);
    const app = Fastify({ loggerInstance: logger });
    app.delete('/devices/pairings', async (request) => {
      request.log.info('handler');
      return {};
    });
    await app.inject({ method: 'DELETE', url: `/devices/pairings?pairing_id=${SECRET}&x=1` });
    await app.inject({ method: 'GET', url: `/unbekannt?pairing_id=${SECRET}` });
    await app.close();
    const log = lines.join('');
    expect(log).toContain('incoming request');
    expect(log).toContain('request completed');
    expect(log).not.toContain(SECRET);
    expect(log).toContain('pairing_id=[Redacted]&x=1');
  });
});

describe('Log-Schwärzung Moodle-Token (08 §9.1)', () => {
  it('schwärzt wstoken und token, auch eine Ebene tiefer', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sg-log-'));
    const logger = createLogger({ dataDir: dir, logLevel: 'info' });
    logger.info({ wstoken: 'geheim-eins', token: 'geheim-zwei', req: { token: 'geheim-drei' } }, 'test');
    const text = readFileSync(join(dir, 'logs', 'core.log'), 'utf8');
    expect(text).toContain('[Redacted]');
    expect(text).not.toMatch(/geheim-/);
  });
});
