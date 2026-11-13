// `core.lock` aus Sicht von `sg restore` (#316): eigene Fassung in `src/core-lock.ts`, geprüft mit echten Dateien und
// gegen die Funktion des Core selbst (`services/core/src/lib/instance-lock.ts`), damit beide nicht auseinanderlaufen.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  acquireCoreLock as acquireCoreLockOfCore,
  CoreLockHeldError as CoreHeldErrorOfCore,
} from '../../../services/core/src/lib/instance-lock.ts';
import { acquireCoreLock, CoreLockHeldError, releaseOnSignal, type SignalHost } from '../src/core-lock.ts';

const CORE_LOCK_MODULE = new URL('../../../services/core/src/lib/instance-lock.ts', import.meta.url).href;

let dataDir: string;
let lockPath: string;
const children: ChildProcess[] = [];

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sg-corelock-'));
  lockPath = join(dataDir, 'run', 'core.lock');
});
afterEach(() => {
  for (const c of children.splice(0)) c.kill('SIGKILL');
  rmSync(dataDir, { recursive: true, force: true });
});

function writeLock(content: string): void {
  mkdirSync(join(dataDir, 'run'), { recursive: true });
  writeFileSync(lockPath, content);
}

/** PID eines beendeten Prozesses (lebt sicher nicht mehr) */
function deadPid(): number {
  return spawnSync(process.execPath, ['-e', '0']).pid;
}

/** Ein lebender fremder Prozess */
function livingPid(): number {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  children.push(child);
  return child.pid as number;
}

describe('acquireCoreLock (sg)', () => {
  it('legt die Datei im Format "<pid>\\n" an und gibt sie bei release frei', () => {
    const lock = acquireCoreLock(dataDir);
    expect(readFileSync(lockPath, 'utf8')).toBe(`${process.pid}\n`);
    lock.release();
    expect(existsSync(lockPath)).toBe(false);
    lock.release(); // mehrfach aufrufbar
    expect(readdirSync(join(dataDir, 'run'))).toEqual([]);
  });

  it('fremde lebende PID: wirft CoreLockHeldError, die Datei bleibt unverändert', () => {
    const other = livingPid();
    writeLock(`${other}\n`);
    expect(() => acquireCoreLock(dataDir)).toThrow(CoreLockHeldError);
    expect(readFileSync(lockPath, 'utf8')).toBe(`${other}\n`);
    expect(readdirSync(join(dataDir, 'run')).sort()).toEqual(['core.lock']);
  });

  it('tote PID: Datei wird übernommen, keine Reste', () => {
    writeLock(`${deadPid()}\n`);
    const lock = acquireCoreLock(dataDir);
    expect(readFileSync(lockPath, 'utf8')).toBe(`${process.pid}\n`);
    lock.release();
    expect(readdirSync(join(dataDir, 'run'))).toEqual([]);
  });

  it('kaputte oder leere Datei wird übernommen', () => {
    writeLock('kein-pid');
    acquireCoreLock(dataDir).release();
    writeLock('');
    acquireCoreLock(dataDir).release();
    expect(existsSync(lockPath)).toBe(false);
  });

  it('release löscht nie eine fremde Datei (PID nicht die eigene)', () => {
    const lock = acquireCoreLock(dataDir);
    const other = livingPid();
    writeFileSync(lockPath, `${other}\n`); // jemand hat die Datei ausgetauscht
    lock.release();
    expect(readFileSync(lockPath, 'utf8')).toBe(`${other}\n`);
  });

  it('release löscht auch keine Datei, die ein späterer Prozess neu angelegt hat', () => {
    const lock = acquireCoreLock(dataDir, { pid: 4242, alive: () => true });
    rmSync(lockPath);
    writeLock('4343\n');
    lock.release();
    expect(readFileSync(lockPath, 'utf8')).toBe('4343\n');
  });

  it('übernimmt eine Übernahme-Sperre eines abgestürzten Starts', () => {
    writeLock(`${deadPid()}\n`);
    writeFileSync(`${lockPath}.takeover`, `${deadPid()}\n`);
    const lock = acquireCoreLock(dataDir);
    expect(readFileSync(lockPath, 'utf8')).toBe(`${process.pid}\n`);
    lock.release();
    expect(existsSync(`${lockPath}.takeover`)).toBe(false);
  });
});

describe('Verträglichkeit mit dem Core', () => {
  it('ein Core, der startet, während sg die Datei hält, erkennt sie als belegt (wie bei einem zweiten Core)', () => {
    const lock = acquireCoreLock(dataDir);
    let thrown: unknown;
    try {
      // Der Core hat eine andere PID; aus seiner Sicht lebt die PID von sg (dieser Prozess)
      acquireCoreLockOfCore(dataDir, { pid: process.pid + 100_000, alive: (pid) => pid === process.pid });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CoreHeldErrorOfCore);
    expect((thrown as CoreHeldErrorOfCore).pid).toBe(process.pid);
    expect(readFileSync(lockPath, 'utf8')).toBe(`${process.pid}\n`); // unverändert
    lock.release();
  });

  it('derselbe Fall mit echtem Prozess: ein zweiter Core-Start in einem Kindprozess scheitert', () => {
    const lock = acquireCoreLock(dataDir);
    const script =
      `import { acquireCoreLock } from ${JSON.stringify(CORE_LOCK_MODULE)};` +
      `try { acquireCoreLock(${JSON.stringify(dataDir)}); process.exit(0); } ` +
      `catch (e) { process.exit(e.name === 'CoreLockHeldError' ? 7 : 1); }`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script]);
    expect(result.status).toBe(7);
    lock.release();
    expect(existsSync(lockPath)).toBe(false);
  });

  it('der Core übernimmt eine Datei im Format von sg, deren Prozess tot ist', () => {
    writeLock(`${deadPid()}\n`);
    const lock = acquireCoreLockOfCore(dataDir);
    expect(readFileSync(lockPath, 'utf8')).toBe(`${process.pid}\n`);
    lock.release();
  });

  it('sg erkennt die Datei des Core als belegt und übernimmt sie nicht', () => {
    const lock = acquireCoreLockOfCore(dataDir, { pid: 4242, alive: () => true });
    expect(() => acquireCoreLock(dataDir, { alive: (pid) => pid === 4242 })).toThrow(CoreLockHeldError);
    expect(readFileSync(lockPath, 'utf8')).toBe('4242\n');
    lock.release();
  });

  it('beide achten auf dieselbe Übernahme-Sperre (core.lock.takeover) eines lebenden Prozesses', () => {
    const other = livingPid();
    writeLock(`${deadPid()}\n`);
    writeFileSync(`${lockPath}.takeover`, `${other}\n`);
    expect(() => acquireCoreLock(dataDir)).toThrow(CoreLockHeldError);
    expect(() => acquireCoreLockOfCore(dataDir)).toThrow(CoreHeldErrorOfCore);
    expect(readFileSync(`${lockPath}.takeover`, 'utf8')).toBe(`${other}\n`);
  });

  it('beide Fassungen schreiben dieselben Bytes', () => {
    const a = acquireCoreLock(dataDir, { pid: 4711 });
    const bytesSg = readFileSync(lockPath);
    a.release();
    const b = acquireCoreLockOfCore(dataDir, { pid: 4711 });
    const bytesCore = readFileSync(lockPath);
    b.release();
    expect(bytesSg.equals(bytesCore)).toBe(true);
  });
});

describe('releaseOnSignal', () => {
  function fakeHost() {
    const listeners = new Map<string, () => void>();
    const exits: number[] = [];
    const host: SignalHost = {
      on: (event, listener) => listeners.set(event, listener),
      off: (event) => listeners.delete(event),
      exit: (code) => {
        exits.push(code);
        return undefined as never;
      },
    };
    return { host, listeners, exits };
  }

  it('Strg+C gibt die Datei frei und beendet mit 130', () => {
    const lock = acquireCoreLock(dataDir);
    const { host, listeners, exits } = fakeHost();
    releaseOnSignal(lock, host);
    listeners.get('SIGINT')?.();
    expect(existsSync(lockPath)).toBe(false);
    expect(exits).toEqual([130]);
  });

  it('nach dem Entfernen der Handler reagiert nichts mehr', () => {
    const lock = acquireCoreLock(dataDir);
    const { host, listeners } = fakeHost();
    const unhook = releaseOnSignal(lock, host);
    unhook();
    expect(listeners.size).toBe(0);
    lock.release();
  });
});
