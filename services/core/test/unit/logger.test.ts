import { chmodSync, existsSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hasOpenPermissions } from '../../src/config.ts';
import { rotateLogs } from '../../src/logger.ts';

const DAY = 24 * 60 * 60 * 1000;

function touch(file: string, mtime: Date): void {
  writeFileSync(file, 'x');
  utimesSync(file, mtime, mtime);
}

describe('rotateLogs', () => {
  const now = new Date('2026-11-04T12:00:00Z');

  it('benennt core.log vom Vortag in core-YYYY-MM-DD.log um', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sg-core-log-'));
    touch(join(dir, 'core.log'), new Date(now.getTime() - DAY));
    expect(rotateLogs(dir, now)).toBe(true);
    expect(existsSync(join(dir, 'core.log'))).toBe(false);
    expect(existsSync(join(dir, 'core-2026-11-03.log'))).toBe(true);
  });

  it('lässt die heutige core.log in Ruhe', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sg-core-log-'));
    touch(join(dir, 'core.log'), new Date(now.getTime() - 60_000));
    expect(rotateLogs(dir, now)).toBe(false);
    expect(existsSync(join(dir, 'core.log'))).toBe(true);
  });

  it('löscht Archive, die älter als 14 Tage sind, und behält jüngere', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sg-core-log-'));
    touch(join(dir, 'core-2026-10-01.log'), new Date(now.getTime() - 34 * DAY));
    touch(join(dir, 'core-2026-10-25.log'), new Date(now.getTime() - 10 * DAY));
    touch(join(dir, 'worker.log'), new Date(now.getTime() - 99 * DAY)); // fremde Datei bleibt
    rotateLogs(dir, now);
    expect(existsSync(join(dir, 'core-2026-10-01.log'))).toBe(false);
    expect(existsSync(join(dir, 'core-2026-10-25.log'))).toBe(true);
    expect(existsSync(join(dir, 'worker.log'))).toBe(true);
  });

  it('legt den Ordner an, wenn er fehlt', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'sg-core-log-')), 'logs');
    expect(rotateLogs(dir, now)).toBe(false);
    expect(existsSync(dir)).toBe(true);
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
