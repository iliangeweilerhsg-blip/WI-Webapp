import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  acquireCoreLock,
  CoreLockHeldError,
  coreLockPath,
  lockHeldMessage,
} from '../../src/lib/instance-lock.ts';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sg-lock-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const alive = (pids: number[]) => (pid: number) => pids.includes(pid);
const content = () => readFileSync(coreLockPath(dir), 'utf8').trim();

describe('Core-Sperrdatei (#174)', () => {
  it('legt die Datei mit Rechten 0600 im Ordner 0700 an und gibt sie frei', () => {
    const lock = acquireCoreLock(dir, { pid: 4001 });
    expect(content()).toBe('4001');
    expect(statSync(coreLockPath(dir)).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, 'run')).mode & 0o777).toBe(0o700);
    lock.release();
    lock.release();
    expect(existsSync(coreLockPath(dir))).toBe(false);
  });

  it('lehnt einen zweiten Start ab, solange der erste lebt, und lässt die Datei unberührt', () => {
    acquireCoreLock(dir, { pid: 4001 });
    let caught: unknown;
    try {
      acquireCoreLock(dir, { pid: 4002, alive: alive([4001]) });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CoreLockHeldError);
    expect(lockHeldMessage(caught as CoreLockHeldError)).toContain('läuft bereits (PID 4001)');
    expect(content()).toBe('4001');
    expect(readdirSync(join(dir, 'run'))).toEqual(['core.lock']);
  });

  it('übernimmt eine veraltete Datei (Prozess tot)', () => {
    acquireCoreLock(dir, { pid: 4001 });
    const lock = acquireCoreLock(dir, { pid: 4002, alive: alive([]) });
    expect(content()).toBe('4002');
    expect(readdirSync(join(dir, 'run'))).toEqual(['core.lock']);
    lock.release();
  });

  it('übernimmt kaputte Dateien und die eigene alte PID', () => {
    acquireCoreLock(dir, { pid: 4001 });
    writeFileSync(coreLockPath(dir), 'müll');
    acquireCoreLock(dir, { pid: 4002, alive: () => true });
    expect(content()).toBe('4002');
    writeFileSync(coreLockPath(dir), '4003\n');
    acquireCoreLock(dir, { pid: 4003, alive: () => true });
    expect(content()).toBe('4003');
  });

  it('löscht beim Freigeben nur die eigene PID', () => {
    const lock = acquireCoreLock(dir, { pid: 4001 });
    writeFileSync(coreLockPath(dir), '4002\n');
    lock.release();
    expect(content()).toBe('4002');
  });

  it('erlaubt zwei Kerne mit getrennten Datenordnern', () => {
    const other = mkdtempSync(join(tmpdir(), 'sg-lock-'));
    try {
      acquireCoreLock(dir, { pid: 4001 });
      expect(() => acquireCoreLock(other, { pid: 4002, alive: alive([4001]) })).not.toThrow();
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('Neustart direkt nach Freigabe klappt', () => {
    acquireCoreLock(dir, { pid: 4001 }).release();
    expect(() => acquireCoreLock(dir, { pid: 4002, alive: alive([4001]) })).not.toThrow();
  });
});
