import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/config.ts';
import {
  defaultWebDir,
  readWebStamp,
  webBuildReason,
  webFingerprint,
  writeWebStamp,
} from '../src/webbuild.ts';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'sg-webbuild-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

/** Mini-Repo mit den Quellordnern der Web-App. */
function repo(): string {
  const r = tmp();
  git(r, 'init', '-q');
  git(r, 'config', 'user.email', 'test@example.invalid');
  git(r, 'config', 'user.name', 'Test');
  mkdirSync(join(r, 'apps', 'web'), { recursive: true });
  mkdirSync(join(r, 'packages', 'shared'), { recursive: true });
  writeFileSync(join(r, 'apps', 'web', 'page.tsx'), 'eins');
  writeFileSync(join(r, 'packages', 'shared', 'index.ts'), 'eins');
  writeFileSync(join(r, 'pnpm-lock.yaml'), 'lock');
  writeFileSync(join(r, 'README.md'), 'readme');
  git(r, 'add', '.');
  git(r, 'commit', '-qm', 'eins');
  return r;
}

describe('webBuildReason', () => {
  const base = { indexExists: true, defaultWebDir: true, fingerprint: 'a', stamp: 'a' };

  it('baut, wenn der Export fehlt – auch ohne Git oder bei umgelenktem Ordner', () => {
    expect(webBuildReason({ ...base, indexExists: false })).toBe('missing');
    expect(webBuildReason({ ...base, indexExists: false, fingerprint: null })).toBe('missing');
    expect(webBuildReason({ ...base, indexExists: false, defaultWebDir: false })).toBe('missing');
  });

  it('baut neu, wenn sich die Quellen seit dem letzten Build geändert haben', () => {
    expect(webBuildReason({ ...base, stamp: 'alt' })).toBe('outdated');
  });

  it('baut neu, wenn kein Stempel existiert (Export stammt von vor dieser Prüfung)', () => {
    expect(webBuildReason({ ...base, stamp: null })).toBe('outdated');
  });

  it('baut nicht, wenn Stempel und Quellen übereinstimmen', () => {
    expect(webBuildReason(base)).toBeNull();
  });

  it('fasst einen per SG_WEB_DIR umgelenkten Export und Checkouts ohne Git nicht an', () => {
    expect(webBuildReason({ ...base, defaultWebDir: false, stamp: 'alt' })).toBeNull();
    expect(webBuildReason({ ...base, fingerprint: null, stamp: null })).toBeNull();
  });
});

describe('webFingerprint', () => {
  it('ändert sich nur durch Commits an den Quellen der Web-App', () => {
    const r = repo();
    const first = webFingerprint(r);
    expect(first).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);

    writeFileSync(join(r, 'README.md'), 'anders');
    git(r, 'commit', '-qam', 'readme');
    expect(webFingerprint(r)).toBe(first);

    writeFileSync(join(r, 'packages', 'shared', 'index.ts'), 'zwei');
    git(r, 'commit', '-qam', 'shared');
    const second = webFingerprint(r);
    expect(second).not.toBe(first);

    writeFileSync(join(r, 'apps', 'web', 'page.tsx'), 'zwei');
    git(r, 'commit', '-qam', 'web');
    expect(webFingerprint(r)).not.toBe(second);
  });

  it('liefert null ohne Git-Repo', () => {
    expect(webFingerprint(tmp())).toBeNull();
  });
});

describe('Stempel und Standardordner', () => {
  it('schreibt und liest den Stempel im run-Ordner', () => {
    const cfg = resolveConfig({ SG_DATA_DIR: join(tmp(), 'd') }, '/h', '/repo');
    expect(readWebStamp(cfg)).toBeNull();
    writeWebStamp(cfg, 'abc:def:123');
    expect(readWebStamp(cfg)).toBe('abc:def:123');
  });

  it('erkennt den Standard-Exportordner', () => {
    expect(defaultWebDir(resolveConfig({}, '/h', '/repo'))).toBe(true);
    expect(defaultWebDir(resolveConfig({ SG_WEB_DIR: '/anders/out' }, '/h', '/repo'))).toBe(false);
  });
});
