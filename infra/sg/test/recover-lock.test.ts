// `recoverRestoreIfOpen` baut ein offenes Restore-Journal nur unter `run/core.lock` zurück (#316)
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recoverRestoreIfOpen } from '../src/backup-commands.ts';
import { resolveConfig } from '../src/config.ts';
import { readRestoreMarker, writeRestoreMarker } from '../src/core-lock.ts';

let dataDir: string;
const children: ChildProcess[] = [];

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sg-recover-'));
});
afterEach(() => {
  for (const c of children.splice(0)) c.kill('SIGKILL');
  rmSync(dataDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const cfg = () => resolveConfig({ SG_DATA_DIR: dataDir }, '/home/u', '/repo');
const journal = () => join(dataDir, 'restore.journal.json');
const openJournal = () => writeFileSync(journal(), JSON.stringify({ version: 1, stand: 'x' }));

function livingPid(): number {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  children.push(child);
  return child.pid as number;
}

describe('recoverRestoreIfOpen', () => {
  it('ohne Journal: true, nichts wird gesperrt', async () => {
    const holdLock = vi.fn();
    expect(await recoverRestoreIfOpen(cfg(), holdLock)).toBe(true);
    expect(holdLock).not.toHaveBeenCalled();
    expect(existsSync(join(dataDir, 'run'))).toBe(false);
  });

  it('Sperre von einem anderen lebenden Prozess belegt: false, Journal bleibt', async () => {
    openJournal();
    mkdirSync(join(dataDir, 'run'), { recursive: true });
    writeFileSync(join(dataDir, 'run', 'core.lock'), `${livingPid()}\n`);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await recoverRestoreIfOpen(cfg())).toBe(false);
    expect(existsSync(journal())).toBe(true);
  });
});

describe('Restore-Markierung', () => {
  it('wird geschrieben und gelesen', () => {
    mkdirSync(join(dataDir, 'run'), { recursive: true });
    expect(readRestoreMarker(dataDir)).toBeNull();
    writeRestoreMarker(dataDir, 4242);
    expect(readRestoreMarker(dataDir)).toBe(4242);
  });
});
