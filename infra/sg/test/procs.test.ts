import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { availability, composeArgs, parseHealth } from '../src/commands.ts';
import { resolveConfig } from '../src/config.ts';
import { createLinePrefixer, ensureDataDir, isAlive, readPid, removePid, writePid } from '../src/procs.ts';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'sg-test-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
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
  it('legt die Struktur an, config mit Rechten 700', () => {
    const root = tmp();
    const cfg = resolveConfig({ SG_DATA_DIR: join(root, 'data') }, '/h', '/repo');
    ensureDataDir(cfg);
    ensureDataDir(cfg); // idempotent
    for (const sub of ['config', 'media/decks', 'media/sheets', 'vault', 'backups', 'logs', 'run']) {
      expect(statSync(join(cfg.dataDir, sub)).isDirectory()).toBe(true);
    }
    expect(statSync(join(cfg.dataDir, 'config')).mode & 0o777).toBe(0o700);
  });
});

describe('PID-Dateien', () => {
  it('schreibt, liest und löscht', () => {
    const cfg = resolveConfig({ SG_DATA_DIR: join(tmp(), 'd') }, '/h', '/repo');
    expect(readPid(cfg, 'core')).toBeNull();
    writePid(cfg, 'core', 4242);
    expect(readPid(cfg, 'core')).toBe(4242);
    removePid(cfg, 'core');
    expect(readPid(cfg, 'core')).toBeNull();
  });

  it('ignoriert kaputte Inhalte', () => {
    const cfg = resolveConfig({ SG_DATA_DIR: join(tmp(), 'd') }, '/h', '/repo');
    writePid(cfg, 'worker', 1);
    writeFileSync(join(cfg.runDir, 'worker.pid'), 'müll');
    expect(readPid(cfg, 'worker')).toBeNull();
  });

  it('isAlive erkennt den eigenen Prozess', () => {
    expect(isAlive(process.pid)).toBe(true);
  });
});

describe('Hilfsfunktionen der Befehle', () => {
  it('parseHealth validiert gegen den Typ Health', () => {
    expect(parseHealth({ status: 'ok', db: 'ok', version: '0.0.1' })).toEqual({
      status: 'ok',
      db: 'ok',
      version: '0.0.1',
    });
    expect(parseHealth({ status: 'ok' })).toBeNull();
    expect(parseHealth(null)).toBeNull();
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
