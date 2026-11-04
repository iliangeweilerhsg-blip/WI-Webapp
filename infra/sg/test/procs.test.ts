import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { availability, composeArgs, evaluateHealth } from '../src/commands.ts';
import { resolveConfig } from '../src/config.ts';
import {
  createLinePrefixer,
  ensureDataDir,
  groupAlive,
  pidFile,
  processInfo,
  readService,
  signalGroup,
  sleep,
  terminateGroup,
  writePid,
  type ProcessInfoFn,
} from '../src/procs.ts';

const dirs: string[] = [];
const groups: number[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'sg-test-'));
  dirs.push(d);
  return d;
}
function testCfg() {
  return resolveConfig({ SG_DATA_DIR: join(tmp(), 'd') }, '/h', '/repo');
}
/** Startet ein Shell-Skript als eigene Prozessgruppe (wie sg die Dienste startet). */
function spawnGroup(script: string): number {
  const child = spawn('sh', ['-c', script], { detached: true, stdio: 'ignore' });
  child.unref();
  if (child.pid === undefined) throw new Error('spawn fehlgeschlagen');
  groups.push(child.pid);
  return child.pid;
}
afterEach(() => {
  for (const g of groups.splice(0)) signalGroup(g, 'SIGKILL');
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('createLinePrefixer', () => {
  it('setzt Präfixe, puffert unvollständige Zeilen', () => {
    const out: string[] = [];
    const p = createLinePrefixer('[core]', (l) => out.push(l));
    p.push('eins\nzw');
    p.push('ei\r\ndrei');
    expect(out).toEqual(['[core] eins', '[core] zwei']);
    p.flush();
    expect(out).toEqual(['[core] eins', '[core] zwei', '[core] drei']);
  });
});

describe('ensureDataDir', () => {
  it('legt die Struktur an, Datenordner und config mit Rechten 700', () => {
    const cfg = testCfg();
    ensureDataDir(cfg);
    ensureDataDir(cfg); // idempotent
    for (const sub of ['config', 'media/decks', 'media/sheets', 'vault', 'backups', 'logs', 'run']) {
      expect(statSync(join(cfg.dataDir, sub)).isDirectory()).toBe(true);
    }
    expect(statSync(cfg.dataDir).mode & 0o777).toBe(0o700);
    expect(statSync(join(cfg.dataDir, 'config')).mode & 0o777).toBe(0o700);
  });
});

describe('PID-Dateien mit Identität', () => {
  it('erkennt einen echten Prozess wieder', () => {
    const cfg = testCfg();
    const pid = spawnGroup('sleep 30');
    writePid(cfg, 'core', pid);
    expect(readService(cfg, 'core')).toBe(pid);
    expect(existsSync(pidFile(cfg, 'core'))).toBe(true);
  });

  it('verwirft veraltete Dateien mit wiederverwendeter PID, ohne etwas zu beenden', () => {
    const cfg = testCfg();
    // „Fremder“ Prozess, der zufällig die gespeicherte PID trägt
    const pid = spawnGroup('sleep 30');
    writePid(cfg, 'core', pid);
    const other: ProcessInfoFn = (p) => {
      const i = processInfo(p);
      return i ? { ...i, identity: 'Mon Jan  1 00:00:00 2001 anderer-prozess' } : null;
    };
    expect(readService(cfg, 'core', other)).toBeNull();
    expect(existsSync(pidFile(cfg, 'core'))).toBe(false);
    expect(groupAlive(pid)).toBe(true); // nichts gekillt
  });

  it('verwirft Einträge, deren Prozess kein Gruppenführer ist', () => {
    const cfg = testCfg();
    const pid = spawnGroup('sleep 30');
    writePid(cfg, 'worker', pid);
    const notLeader: ProcessInfoFn = (p) => {
      const i = processInfo(p);
      return i ? { ...i, pgid: p + 1 } : null;
    };
    expect(readService(cfg, 'worker', notLeader)).toBeNull();
    expect(existsSync(pidFile(cfg, 'worker'))).toBe(false);
  });

  it('verwirft Einträge toter Prozesse und kaputte Dateien', () => {
    const cfg = testCfg();
    expect(readService(cfg, 'core')).toBeNull(); // keine Datei
    const pid = spawnGroup('exit 0');
    writePid(cfg, 'core', pid, () => ({ identity: 'x', pgid: pid }));
    return sleep(300).then(() => {
      expect(readService(cfg, 'core')).toBeNull();
      writeFileSync(pidFile(cfg, 'worker'), 'müll');
      expect(readService(cfg, 'worker')).toBeNull();
      expect(existsSync(pidFile(cfg, 'worker'))).toBe(false);
    });
  });
});

describe('terminateGroup', () => {
  // Wrapper endet bei SIGTERM sofort, das Kind ignoriert SIGTERM und lebt weiter.
  const stubborn = `sh -c 'trap "" TERM; exec sleep 30' & trap "exit 0" TERM; wait`;

  it('beendet die ganze Gruppe, auch wenn nur der Anführer auf SIGTERM endet', async () => {
    const pid = spawnGroup(stubborn);
    await sleep(300);
    expect(groupAlive(pid)).toBe(true);
    const gone = await terminateGroup(pid, { graceMs: 600, killWaitMs: 2000 });
    expect(gone).toBe(true);
    expect(groupAlive(pid)).toBe(false);
  });

  it('SIGTERM nur an den Anführer: Gruppe wird erst nach der Gnadenfrist per SIGKILL beendet', async () => {
    // Das Kind würde SIGTERM nicht ignorieren, bekommt es aber nicht.
    const pid = spawnGroup(`sleep 30 & trap "exit 0" TERM; wait`);
    await sleep(300);
    const t0 = Date.now();
    const gone = await terminateGroup(pid, { graceMs: 800, leaderOnly: true, killWaitMs: 2000 });
    expect(gone).toBe(true);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(700);
    expect(groupAlive(pid)).toBe(false);
  });

  it('force bricht die Gnadenfrist sofort ab', async () => {
    const pid = spawnGroup(`trap "" TERM; sleep 30`);
    await sleep(300);
    const t0 = Date.now();
    const gone = await terminateGroup(pid, { graceMs: 60000, force: () => true, killWaitMs: 2000 });
    expect(gone).toBe(true);
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it('waitOnly sendet kein SIGTERM, wartet nur und eskaliert nach der Gnadenfrist', async () => {
    // Würde bei SIGTERM sofort enden – darf es aber nicht bekommen.
    const pid = spawnGroup(`trap "exit 0" TERM; sleep 30 & wait`);
    await sleep(300);
    const t0 = Date.now();
    const gone = await terminateGroup(pid, { graceMs: 800, waitOnly: true, killWaitMs: 2000 });
    expect(gone).toBe(true);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(700);
    expect(groupAlive(pid)).toBe(false);
  });

  it('meldet true für eine nicht (mehr) vorhandene Gruppe', async () => {
    const pid = spawnGroup('exit 0');
    await sleep(300);
    expect(await terminateGroup(pid, { graceMs: 100 })).toBe(true);
  });
});

describe('Hilfsfunktionen der Befehle', () => {
  it('evaluateHealth validiert gegen den Typ Health', () => {
    expect(evaluateHealth({ status: 'ok', db: 'ok', version: '0.0.1' }).state).toBe('ready');
    expect(evaluateHealth({ status: 'ok', db: 'fehler', version: '0.0.1' }).state).toBe('db-error');
    const bad = evaluateHealth({ status: 'ok' });
    expect(bad.state).toBe('invalid');
    expect(bad.state === 'invalid' && bad.error.length).toBeGreaterThan(0);
    expect(evaluateHealth(null).state).toBe('invalid');
  });

  it('composeArgs nutzt die Compose-Datei des Repos', () => {
    const cfg = resolveConfig({}, '/h', '/repo');
    expect(composeArgs(cfg, 'up', '-d')).toEqual([
      'compose',
      '-f',
      '/repo/infra/docker-compose.yml',
      'up',
      '-d',
    ]);
  });

  it('availability meldet fehlende Bausteine', () => {
    expect(availability(tmp())).toEqual({ core: false, worker: false, web: false });
  });
});
