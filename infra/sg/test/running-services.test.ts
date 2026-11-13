// `runningServices` (sg restore): Der Core zählt auch dann als laufend, wenn nur die Sperrdatei `run/core.lock`
// eine lebende PID trägt (#316, Sperrdatei seit #292). Veraltete oder fehlende Datei blockiert nicht.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { blockedByLockOnly, runningServices, type RunningIo } from '../src/backup-commands.ts';
import { resolveConfig, type SgConfig } from '../src/config.ts';
import { coreLockHeld, type LockRead } from '../src/doctor.ts';

let dataDir: string;
let cfg: SgConfig;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sg-running-'));
  cfg = resolveConfig({ SG_DATA_DIR: dataDir }, tmpdir(), '/repo');
});
afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

function writeLock(content: string): void {
  mkdirSync(join(dataDir, 'run'), { recursive: true });
  writeFileSync(join(dataDir, 'run', 'core.lock'), content);
}

/** PID eines beendeten Prozesses (lebt sicher nicht mehr) */
function deadPid(): number {
  return spawnSync(process.execPath, ['-e', '0']).pid;
}

const noHealth: Pick<RunningIo, 'coreReachable'> = { coreReachable: async () => false };

describe('runningServices mit Sperrdatei', () => {
  it('Sperrdatei mit lebender PID: Core läuft (auch ohne Pid-Datei und ohne Health-Antwort)', async () => {
    writeLock(`${process.pid}\n`);
    expect(await runningServices(cfg, { lockHeld: () => coreLockHeld(cfg), ...noHealth })).toEqual(['Core']);
  });

  it('Sperrdatei mit toter PID: blockiert nicht', async () => {
    writeLock(`${deadPid()}\n`);
    expect(await runningServices(cfg, { lockHeld: () => coreLockHeld(cfg), ...noHealth })).toEqual([]);
  });

  it('fehlende Sperrdatei: blockiert nicht', async () => {
    expect(await runningServices(cfg, { lockHeld: () => coreLockHeld(cfg), ...noHealth })).toEqual([]);
  });

  it('kaputte Sperrdatei: blockiert nicht', async () => {
    writeLock('kein-pid\n');
    expect(await runningServices(cfg, { lockHeld: () => coreLockHeld(cfg), ...noHealth })).toEqual([]);
  });

  it('antwortender Core ohne Sperrdatei: weiter erkannt', async () => {
    expect(
      await runningServices(cfg, { lockHeld: () => coreLockHeld(cfg), coreReachable: async () => true }),
    ).toEqual(['Core']);
  });

  it('Core nur einmal gemeldet, auch wenn Sperrdatei und Health beide zutreffen', async () => {
    expect(await runningServices(cfg, { lockHeld: () => true, coreReachable: async () => true })).toEqual([
      'Core',
    ]);
  });
});

describe('blockedByLockOnly', () => {
  it('Sperrdatei mit lebender PID, keine PID-Datei, keine Health-Antwort: nur die Sperrdatei blockiert', async () => {
    writeLock(`${process.pid}\n`);
    expect(await blockedByLockOnly(cfg, { lockHeld: () => coreLockHeld(cfg), ...noHealth })).toBe(true);
  });

  it('antwortet der Core: nicht nur die Sperrdatei', async () => {
    expect(await blockedByLockOnly(cfg, { lockHeld: () => true, coreReachable: async () => true })).toBe(
      false,
    );
  });

  it('Sperrdatei nicht belegt (fehlt oder PID tot): nein', async () => {
    expect(await blockedByLockOnly(cfg, { lockHeld: () => coreLockHeld(cfg), ...noHealth })).toBe(false);
    writeLock(`${deadPid()}\n`);
    expect(await blockedByLockOnly(cfg, { lockHeld: () => coreLockHeld(cfg), ...noHealth })).toBe(false);
  });
});

describe('coreLockHeld', () => {
  const held = (lock: LockRead, alive: boolean): boolean =>
    coreLockHeld(cfg, { readLock: () => lock, alive: () => alive });

  it('nur gültige, lebende PID zählt', () => {
    expect(held({ kind: 'pid', pid: 42 }, true)).toBe(true);
    expect(held({ kind: 'pid', pid: 42 }, false)).toBe(false);
    for (const kind of ['missing', 'invalid', 'special'] as const) expect(held({ kind }, true)).toBe(false);
    expect(held({ kind: 'unreadable', code: 'EACCES' }, true)).toBe(false);
  });
});
