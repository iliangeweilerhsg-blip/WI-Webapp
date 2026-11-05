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
import { describe, expect, it } from 'vitest';
import { hasOpenPermissions } from '../../src/config.ts';
import { createLogger, initialLogDay, rotateLogs } from '../../src/logger.ts';

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
