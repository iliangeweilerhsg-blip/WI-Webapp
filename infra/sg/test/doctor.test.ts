import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/config.ts';
import {
  checkFreeSpace,
  checkNode,
  doctorExitCode,
  MIN_FREE_BYTES,
  formatChecks,
  parseVersion,
  runChecks,
  type CheckResult,
} from '../src/doctor.ts';
import { freeBytesNearest, type RunResult, type System } from '../src/system.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cfg = resolveConfig({}, '/home/u', '/repo');
const OK: RunResult = { ok: true, stdout: 'x 1.0\n', stderr: '' };
const FAIL: RunResult = { ok: false, stdout: '', stderr: 'nope' };

function fakeSystem(over: Partial<System> & { failing?: string[] } = {}): System {
  const failing = over.failing ?? [];
  return {
    nodeVersion: '22.23.4',
    platform: 'darwin',
    arch: 'arm64',
    run: async (cmd, args) => (failing.includes([cmd, ...args].join(' ')) ? FAIL : OK),
    portFree: async () => true,
    dirWritable: () => true,
    freeBytes: () => 50 * 1024 ** 3,
    ...over,
  };
}

const byName = (results: CheckResult[], part: string): CheckResult => {
  const r = results.find((x) => x.name.includes(part));
  if (!r) throw new Error(`Prüfung "${part}" fehlt`);
  return r;
};

describe('parseVersion / checkNode', () => {
  it('parst Versionen', () => {
    expect(parseVersion('v22.18.0')).toEqual({ major: 22, minor: 18, patch: 0 });
    expect(parseVersion('kaputt')).toBeNull();
  });

  it('verlangt Node 22.18 bis 22.x', () => {
    expect(checkNode('22.18.0').status).toBe('ok');
    expect(checkNode('22.23.4').status).toBe('ok');
    expect(checkNode('22.17.9').status).toBe('fail');
    expect(checkNode('20.19.0').status).toBe('fail');
    expect(checkNode('23.0.0').status).toBe('fail');
    expect(checkNode('22.17.9').hint).toMatch(/nvm/);
  });
});

describe('runChecks', () => {
  it('meldet alles grün, wenn alles da ist', async () => {
    const results = await runChecks(fakeSystem(), cfg);
    expect(results.filter((r) => r.status === 'fail')).toEqual([]);
    expect(doctorExitCode(results)).toBe(0);
  });

  it('meldet Docker als "läuft nicht", wenn docker info scheitert', async () => {
    const results = await runChecks(fakeSystem({ failing: ['docker info'] }), cfg);
    const docker = byName(results, 'Docker');
    expect(docker.status).toBe('fail');
    expect(docker.detail).toBe('läuft nicht');
    expect(docker.hint).toMatch(/starten/);
    expect(doctorExitCode(results)).toBe(1);
  });

  it('meldet Docker als "nicht installiert"', async () => {
    const results = await runChecks(fakeSystem({ failing: ['docker --version'] }), cfg);
    expect(byName(results, 'Docker').detail).toBe('nicht installiert');
  });

  it('erkennt fehlendes Compose-Plugin', async () => {
    const results = await runChecks(fakeSystem({ failing: ['docker compose version'] }), cfg);
    expect(byName(results, 'Docker').detail).toMatch(/compose/);
  });

  it('erkennt fehlendes uv und pnpm', async () => {
    const results = await runChecks(fakeSystem({ failing: ['uv --version', 'pnpm --version'] }), cfg);
    expect(byName(results, 'uv').status).toBe('fail');
    expect(byName(results, 'pnpm').status).toBe('fail');
  });

  it('erkennt belegte Ports', async () => {
    const results = await runChecks(fakeSystem({ portFree: async (p) => p !== 4710 }), cfg);
    expect(byName(results, '4710').status).toBe('fail');
    expect(byName(results, '5432').status).toBe('ok');
  });

  it('der Port-Hinweis passt zum Port: SG_CORE_PORT nur beim Core', async () => {
    const core = byName(await runChecks(fakeSystem({ portFree: async (p) => p !== 4710 }), cfg), '4710');
    expect(core.hint).toMatch(/SG_CORE_PORT/);
    const db = byName(await runChecks(fakeSystem({ portFree: async (p) => p !== 5432 }), cfg), '5432');
    expect(db.status).toBe('fail');
    expect(db.hint).not.toMatch(/SG_CORE_PORT/);
    expect(db.hint).toMatch(/Läuft schon eine andere Datenbank oder Studien-Gehirn\? Dann "pnpm sg stop"\./);
    expect(db.hint).toMatch(/lsof -i :5432/);
  });

  it('erkennt nicht beschreibbaren Datenordner', async () => {
    const results = await runChecks(fakeSystem({ dirWritable: () => false }), cfg);
    expect(byName(results, 'Datenordner').status).toBe('fail');
  });

  it('Apple Silicon ist nur ein Hinweis', async () => {
    const linux = await runChecks(fakeSystem({ platform: 'linux', arch: 'x64' }), cfg);
    expect(byName(linux, 'Apple Silicon').status).toBe('info');
    const mac = await runChecks(fakeSystem(), cfg);
    expect(byName(mac, 'Apple Silicon').detail).toMatch(/Apple Silicon erkannt/);
  });
});

describe('ffmpeg', () => {
  it('ist ok, wenn ffmpeg antwortet', async () => {
    const r = byName(await runChecks(fakeSystem(), cfg), 'ffmpeg');
    expect(r.status).toBe('ok');
  });

  it('meldet fehlendes ffmpeg mit Abhilfe und Exit-Code 1', async () => {
    const results = await runChecks(fakeSystem({ failing: ['ffmpeg -version'] }), cfg);
    const r = byName(results, 'ffmpeg');
    expect(r.status).toBe('fail');
    expect(r.hint).toMatch(/brew install ffmpeg/);
    expect(doctorExitCode(results)).toBe(1);
  });

  it('startet ffmpeg mit Argument-Array', async () => {
    const calls: Array<[string, string[]]> = [];
    await runChecks(fakeSystem({ run: async (c, a) => (calls.push([c, a]), OK) }), cfg);
    expect(calls).toContainEqual(['ffmpeg', ['-version']]);
  });
});

describe('checkFreeSpace', () => {
  it('ist ok ab 10 GB', () => {
    const r = checkFreeSpace(fakeSystem({ freeBytes: () => MIN_FREE_BYTES }), cfg);
    expect(r.status).toBe('ok');
  });

  it('warnt unter 10 GB, ohne Abbruch', async () => {
    const sys = fakeSystem({ freeBytes: () => 7.3 * 1024 ** 3 });
    const r = checkFreeSpace(sys, cfg);
    expect(r.status).toBe('info');
    expect(r.detail).toBe(
      'Wenig Speicher frei: 7,3 GB im Datenordner. Aufnahmen und Backups brauchen Platz.',
    );
    const results = await runChecks(sys, cfg);
    expect(doctorExitCode(results)).toBe(0);
    expect(formatChecks(results)).toContain('Wenig Speicher frei');
  });

  it('Gegenprobe: 1 Byte unter 10 GB ist ein Hinweis und zeigt nicht "10,0"', () => {
    const r = checkFreeSpace(fakeSystem({ freeBytes: () => MIN_FREE_BYTES - 1 }), cfg);
    expect(r.status).toBe('info');
    expect(r.detail).toContain('9,9 GB');
  });

  it('meldet "nicht feststellbar", wenn die Messung fehlschlägt', () => {
    const r = checkFreeSpace(fakeSystem({ freeBytes: () => undefined }), cfg);
    expect(r.status).toBe('info');
    expect(r.detail).toBe('nicht feststellbar');
  });

  it('misst im Datenordner', () => {
    const asked: string[] = [];
    checkFreeSpace(fakeSystem({ freeBytes: (p) => (asked.push(p), 1) }), cfg);
    expect(asked).toEqual([cfg.dataDir]);
  });
});

describe('freeBytesNearest (echtes Dateisystem)', () => {
  it('misst bei fehlendem Datenordner im nächsten vorhandenen Elternordner', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sg-free-'));
    try {
      const own = freeBytesNearest(dir);
      expect(own).toBeGreaterThan(0);
      // gleiches Dateisystem, nur ungefähr gleich, weil parallel andere Tests schreiben
      expect(Math.abs((freeBytesNearest(join(dir, 'fehlt', 'tiefer')) ?? 0) - (own ?? 0))).toBeLessThan(
        1024 ** 3,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('formatChecks', () => {
  it('zeigt Häkchen, Kreuze und Hinweise', async () => {
    const results = await runChecks(fakeSystem({ failing: ['docker info'] }), cfg);
    const text = formatChecks(results);
    expect(text).toContain('✓ Node.js');
    expect(text).toContain('✗ Docker: läuft nicht');
    expect(text).toContain('    → Docker Desktop');
    expect(text).toContain('1 Prüfung(en) fehlgeschlagen');
  });
});
