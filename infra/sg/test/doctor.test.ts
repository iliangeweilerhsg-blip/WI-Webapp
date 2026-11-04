import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/config.ts';
import {
  checkNode,
  doctorExitCode,
  formatChecks,
  parseVersion,
  runChecks,
  type CheckResult,
} from '../src/doctor.ts';
import type { RunResult, System } from '../src/system.ts';

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
