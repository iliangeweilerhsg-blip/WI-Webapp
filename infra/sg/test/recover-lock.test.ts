// `recoverRestoreIfOpen` baut ein offenes Restore-Journal nur unter `run/core.lock` zurück (#316)
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recoverRestoreIfOpen } from '../src/backup-commands.ts';
import { resolveConfig } from '../src/config.ts';
import {
  acquireCoreLock,
  markRestore,
  readRestoreMarker,
  releaseOnSignal,
  restoreMarkerPath,
  writeRestoreMarker,
  type SignalHost,
} from '../src/core-lock.ts';

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

  it('folgt keinem symbolischen Link: weder beim Schreiben noch beim Lesen', () => {
    mkdirSync(join(dataDir, 'run'), { recursive: true });
    const victim = join(dataDir, 'fremd.txt');
    writeFileSync(victim, '4242\n');
    symlinkSync(victim, restoreMarkerPath(dataDir));
    expect(readRestoreMarker(dataDir)).toBeNull();
    writeRestoreMarker(dataDir, 77);
    expect(readFileSync(victim, 'utf8')).toBe('4242\n');
    expect(readRestoreMarker(dataDir)).toBe(77);
  });

  it('FIFO oder zu große Datei: null, ohne zu hängen', () => {
    mkdirSync(join(dataDir, 'run'), { recursive: true });
    writeFileSync(restoreMarkerPath(dataDir), `${'1'.repeat(100)}\n`);
    expect(readRestoreMarker(dataDir)).toBeNull();
    rmSync(restoreMarkerPath(dataDir));
    execFileSync('mkfifo', [restoreMarkerPath(dataDir)]);
    expect(readRestoreMarker(dataDir)).toBeNull();
  });

  it('wird bei Strg+C zusammen mit der Sperre entfernt', () => {
    const lock = acquireCoreLock(dataDir);
    const marked = markRestore(lock, dataDir);
    expect(readRestoreMarker(dataDir)).toBe(process.pid);
    const handlers = new Map<string, () => void>();
    const host: SignalHost = {
      on: (event, listener) => handlers.set(event, listener),
      off: (event) => handlers.delete(event),
      exit: ((code: number) => {
        throw new Error(`exit ${code}`);
      }) as SignalHost['exit'],
    };
    releaseOnSignal(marked, host);
    expect(() => handlers.get('SIGINT')?.()).toThrow('exit 130');
    expect(existsSync(restoreMarkerPath(dataDir))).toBe(false);
    expect(existsSync(lock.path)).toBe(false);
  });
});
