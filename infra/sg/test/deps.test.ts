import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error -- reines JavaScript ohne Typdeklaration (läuft vor dem Laden der TS-Module)
import { depsInSync, syncDeps } from '../deps.mjs';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'sg-deps-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function lockRepo(lock: string, installed?: string): string {
  const r = tmp();
  writeFileSync(join(r, 'pnpm-lock.yaml'), lock);
  if (installed !== undefined) {
    mkdirSync(join(r, 'node_modules', '.pnpm'), { recursive: true });
    writeFileSync(join(r, 'node_modules', '.pnpm', 'lock.yaml'), installed);
  }
  return r;
}

describe('depsInSync', () => {
  it('vergleicht das Lockfile mit der installierten Kopie', () => {
    expect(depsInSync(tmp())).toBeNull();
    expect(depsInSync(lockRepo('lock: 1'))).toBe(false);
    expect(depsInSync(lockRepo('lock: 1', 'lock: 1'))).toBe(true);
    expect(depsInSync(lockRepo('lock: 2', 'lock: 1'))).toBe(false);
  });
});

describe('syncDeps', () => {
  it('installiert nur bei Abweichung', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const calls: string[] = [];
    const run = (cmd: string, args: string[]) => {
      calls.push([cmd, ...args].join(' '));
      return 0;
    };
    expect(syncDeps(lockRepo('a', 'a'), run)).toBe(true);
    expect(calls).toEqual([]);

    const r = lockRepo('b', 'a');
    const install = (cmd: string, args: string[]) => {
      calls.push([cmd, ...args].join(' '));
      writeFileSync(join(r, 'node_modules', '.pnpm', 'lock.yaml'), 'b');
      return 0;
    };
    expect(syncDeps(r, install)).toBe(true);
    expect(calls).toEqual(['pnpm install --frozen-lockfile']);
    expect(depsInSync(r)).toBe(true);
  });

  it('meldet ein gescheitertes Install', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(syncDeps(lockRepo('b', 'a'), () => 1)).toBe(false);
    expect(String(error.mock.calls[0]?.[0])).toContain('pnpm install');
  });

  it('merkt sich ein erfolgreiches Install, auch wenn pnpm die Kopie nicht neu schreibt', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const r = lockRepo('lock: 1\n\n', 'lock: 1\n');
    let installs = 0;
    const run = () => {
      installs += 1;
      return 0; // „Already up to date“ – Kopie bleibt unverändert
    };
    expect(syncDeps(r, run)).toBe(true);
    expect(readFileSync(join(r, 'node_modules', '.sg-deps'), 'utf8').trim()).toMatch(
      /^[0-9a-f]{64}:[0-9a-f]{64}$/,
    );
    expect(syncDeps(r, run)).toBe(true);
    expect(installs).toBe(1);
    writeFileSync(join(r, 'pnpm-lock.yaml'), 'lock: 2\n');
    expect(depsInSync(r)).toBe(false);
  });

  it('verwirft den Merker, wenn danach ein anderer Stand installiert wurde', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const r = lockRepo('lock: 1\n\n', 'lock: 1\n');
    expect(syncDeps(r, () => 0)).toBe(true);
    expect(depsInSync(r)).toBe(true);
    // anderes Lockfile installiert (Kopie ändert sich), dann Lockfile byte-gleich zurück
    writeFileSync(join(r, 'node_modules', '.pnpm', 'lock.yaml'), 'lock: alt\n');
    expect(depsInSync(r)).toBe(false);
  });
});
