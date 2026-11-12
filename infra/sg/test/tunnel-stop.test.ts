import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { STOP_ORDER, stopServices } from '../src/commands.ts';
import { resolveConfig } from '../src/config.ts';
import {
  pidFile,
  readService,
  signalGroup,
  sleep,
  stopRequested,
  writePid,
  type ServiceName,
} from '../src/procs.ts';

const dirs: string[] = [];
const groups: number[] = [];
afterEach(() => {
  for (const g of groups.splice(0)) signalGroup(g, 'SIGKILL');
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Ein Dienst als eigene Prozessgruppe (wie `sg start`), der beim SIGTERM seinen Namen in ein Protokoll schreibt. */
function spawnService(name: string, log: string): number {
  const script = `trap 'echo ${name} >> "${log}"; exit 0' TERM; while :; do sleep 0.05; done`;
  const child = spawn('sh', ['-c', script], { detached: true, stdio: 'ignore' });
  child.unref();
  if (child.pid === undefined) throw new Error('spawn fehlgeschlagen');
  groups.push(child.pid);
  return child.pid;
}

describe('sg stop: Reihenfolge', () => {
  it('beendet erst den Tunnel-Helfer, dann den Worker, zuletzt den Core', async () => {
    expect([...STOP_ORDER]).toEqual(['tunnel', 'worker', 'core']);

    const root = mkdtempSync(join(tmpdir(), 'sg-stop-test-'));
    dirs.push(root);
    const cfg = resolveConfig({ SG_DATA_DIR: join(root, 'd') }, '/h', '/repo');
    const log = join(root, 'order.log');
    const names: ServiceName[] = ['core', 'worker', 'tunnel'];
    for (const name of names) writePid(cfg, name, spawnService(name, log));
    await sleep(300); // die Skripte brauchen einen Moment, bis `trap` gesetzt ist

    expect(await stopServices(cfg)).toBe(true);

    expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual(['tunnel', 'worker', 'core']);
    for (const name of names) {
      expect(readService(cfg, name)).toBeNull();
      expect(existsSync(pidFile(cfg, name))).toBe(false);
    }
    // Der Marker „sg stop läuft“ bleibt nicht liegen
    expect(stopRequested(cfg)).toBe(false);
  }, 30_000);

  it('fehlt der Helfer (Swift fehlt, SG_TUNNEL=0), stoppt der Rest wie bisher', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sg-stop-test-'));
    dirs.push(root);
    const cfg = resolveConfig({ SG_DATA_DIR: join(root, 'd') }, '/h', '/repo');
    const log = join(root, 'order.log');
    writePid(cfg, 'core', spawnService('core', log));
    writePid(cfg, 'worker', spawnService('worker', log));
    await sleep(300);
    expect(await stopServices(cfg)).toBe(true);
    expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual(['worker', 'core']);
  }, 30_000);
});
