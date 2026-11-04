import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/config.ts';
import {
  defaultWebDir,
  depsInSync,
  ensureDeps,
  ensureWebBuild,
  readWebStamp,
  webBuildReason,
  webFingerprint,
  webSourcesDirty,
  webStampFile,
  writeWebStamp,
  type PrepareIo,
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

/** Git-Umgebung unabhängig von globaler Konfiguration (Signatur, Hooks) und umgebenden Repos. */
function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_CEILING_DIRECTORIES: tmpdir(),
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
  };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[k];
  return env;
}
function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'ignore', env: gitEnv() });
}
/** Die Funktionen unter Test rufen git selbst auf – dieselbe isolierte Umgebung für den Testprozess. */
function withGitEnv<T>(fn: () => T): T {
  const saved = { ...process.env };
  Object.assign(process.env, gitEnv());
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete process.env[k];
  try {
    return fn();
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
}

/** Mini-Repo mit allen Quellen der Web-App. */
function repo(): string {
  const r = tmp();
  git(r, 'init', '-q');
  git(r, 'config', 'user.email', 'test@example.invalid');
  git(r, 'config', 'user.name', 'Test');
  mkdirSync(join(r, 'apps', 'web'), { recursive: true });
  mkdirSync(join(r, 'packages', 'shared'), { recursive: true });
  writeFileSync(join(r, 'apps', 'web', 'page.tsx'), 'eins');
  writeFileSync(join(r, 'apps', 'web', '.gitignore'), '.sg-build-stamp\nout/\n');
  writeFileSync(join(r, 'packages', 'shared', 'index.ts'), 'eins');
  writeFileSync(join(r, 'pnpm-lock.yaml'), 'lock');
  writeFileSync(join(r, 'pnpm-workspace.yaml'), 'packages: []');
  writeFileSync(join(r, 'tsconfig.base.json'), '{}');
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

  it('baut neu bei geänderten Quellen oder fehlendem Stempel', () => {
    expect(webBuildReason({ ...base, stamp: 'alt' })).toBe('outdated');
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

describe('webFingerprint / webSourcesDirty', () => {
  it('ändert sich nur durch Commits an den Quellen der Web-App', () => {
    withGitEnv(() => {
      const r = repo();
      const first = webFingerprint(r);
      expect(first).toMatch(/^[0-9a-f]+(:[0-9a-f]+){4}$/);

      writeFileSync(join(r, 'README.md'), 'anders');
      git(r, 'commit', '-qam', 'readme');
      expect(webFingerprint(r)).toBe(first);

      let last = first;
      for (const f of [
        'packages/shared/index.ts',
        'apps/web/page.tsx',
        'tsconfig.base.json',
        'pnpm-workspace.yaml',
      ]) {
        writeFileSync(join(r, f), `neu ${f}`);
        git(r, 'commit', '-qam', f);
        const now = webFingerprint(r);
        expect(now).not.toBe(last);
        last = now;
      }
    });
  });

  it('erkennt nicht committete Änderungen, ignoriert aber den Stempel selbst', () => {
    withGitEnv(() => {
      const r = repo();
      expect(webSourcesDirty(r)).toBe(false);
      writeWebStamp(r, 'x');
      expect(webSourcesDirty(r)).toBe(false);
      writeFileSync(join(r, 'apps', 'web', 'page.tsx'), 'lokal');
      expect(webSourcesDirty(r)).toBe(true);
    });
  });

  it('liefert null ohne Git-Repo', () => {
    withGitEnv(() => expect(webFingerprint(tmp())).toBeNull());
  });
});

describe('depsInSync', () => {
  it('vergleicht das Lockfile mit der installierten Kopie', () => {
    const r = tmp();
    expect(depsInSync(r)).toBeNull();
    writeFileSync(join(r, 'pnpm-lock.yaml'), 'lock: 1');
    expect(depsInSync(r)).toBe(false);
    mkdirSync(join(r, 'node_modules', '.pnpm'), { recursive: true });
    writeFileSync(join(r, 'node_modules', '.pnpm', 'lock.yaml'), 'lock: 1');
    expect(depsInSync(r)).toBe(true);
    writeFileSync(join(r, 'pnpm-lock.yaml'), 'lock: 2');
    expect(depsInSync(r)).toBe(false);
  });
});

describe('Stempel und Standardordner', () => {
  it('liegt neben dem Export und wird gelesen/geschrieben', () => {
    const r = tmp();
    mkdirSync(join(r, 'apps', 'web'), { recursive: true });
    expect(webStampFile(r)).toBe(join(r, 'apps', 'web', '.sg-build-stamp'));
    expect(readWebStamp(r)).toBeNull();
    writeWebStamp(r, 'abc:def');
    expect(readWebStamp(r)).toBe('abc:def');
  });

  it('erkennt den Standard-Exportordner', () => {
    expect(defaultWebDir(resolveConfig({}, '/h', '/repo'))).toBe(true);
    expect(defaultWebDir(resolveConfig({ SG_WEB_DIR: '/repo/apps/web/out/' }, '/h', '/repo'))).toBe(true);
    expect(defaultWebDir(resolveConfig({ SG_WEB_DIR: '/anders/out' }, '/h', '/repo'))).toBe(false);
  });
});

// ---------------------------------------------------------------- Ablauf in sg start

interface FakeIo extends PrepareIo {
  calls: string[];
  logs: string[];
  errors: string[];
}
function fakeIo(opts: { exit?: number; files?: Set<string>; onRun?: () => void } = {}): FakeIo {
  const io: FakeIo = {
    calls: [],
    logs: [],
    errors: [],
    run: (cmd, args) => {
      io.calls.push([cmd, ...args].join(' '));
      opts.onRun?.();
      return Promise.resolve(opts.exit ?? 0);
    },
    log: (m) => io.logs.push(m),
    err: (m) => io.errors.push(m),
    hasFile: (p) => opts.files?.has(p) ?? existsSync(p),
  };
  return io;
}
const BUILD = 'pnpm --filter @sg/web build';

describe('ensureDeps', () => {
  it('installiert nur, wenn das Lockfile abweicht, und meldet Fehlschläge', async () => {
    const r = tmp();
    const cfg = resolveConfig({ SG_DATA_DIR: join(r, 'd') }, '/h', r);
    writeFileSync(join(r, 'pnpm-lock.yaml'), 'lock');

    const ok = fakeIo();
    expect(await ensureDeps(cfg, ok)).toBe(true);
    expect(ok.calls).toEqual(['pnpm install --frozen-lockfile']);

    const bad = fakeIo({ exit: 1 });
    expect(await ensureDeps(cfg, bad)).toBe(false);
    expect(bad.errors.join()).toContain('pnpm install');

    mkdirSync(join(r, 'node_modules', '.pnpm'), { recursive: true });
    writeFileSync(join(r, 'node_modules', '.pnpm', 'lock.yaml'), 'lock');
    const none = fakeIo();
    expect(await ensureDeps(cfg, none)).toBe(true);
    expect(none.calls).toEqual([]);
  });
});

describe('ensureWebBuild', () => {
  function setup() {
    const r = repo();
    const cfg = resolveConfig({ SG_DATA_DIR: join(r, 'd') }, '/h', r);
    const index = join(cfg.webDir, 'index.html');
    return { r, cfg, index };
  }

  it('baut bei fehlendem Export und schreibt danach den Stempel', async () => {
    await withGitEnv(async () => {
      const { r, cfg, index } = setup();
      const io = fakeIo({
        onRun: () => {
          mkdirSync(cfg.webDir, { recursive: true });
          writeFileSync(index, 'x');
        },
      });
      await ensureWebBuild(cfg, io, true);
      expect(io.calls).toEqual([BUILD]);
      expect(readWebStamp(r)).toBe(webFingerprint(r));

      const again = fakeIo();
      await ensureWebBuild(cfg, again, true);
      expect(again.calls).toEqual([]);
    });
  });

  it('baut nach einem Commit an den Quellen neu', async () => {
    await withGitEnv(async () => {
      const { r, cfg, index } = setup();
      mkdirSync(cfg.webDir, { recursive: true });
      writeFileSync(index, 'x');
      writeWebStamp(r, webFingerprint(r) ?? '');
      writeFileSync(join(r, 'apps', 'web', 'page.tsx'), 'zwei');
      git(r, 'commit', '-qam', 'zwei');
      const io = fakeIo();
      await ensureWebBuild(cfg, io, true);
      expect(io.calls).toEqual([BUILD]);
      expect(io.logs.join()).toContain('geändert');
      expect(readWebStamp(r)).toBe(webFingerprint(r));
    });
  });

  it('schreibt bei fehlgeschlagenem Build keinen Stempel und meldet den tatsächlichen Zustand', async () => {
    await withGitEnv(async () => {
      const { r, cfg, index } = setup();
      mkdirSync(cfg.webDir, { recursive: true });
      writeFileSync(index, 'x');
      const kept = fakeIo({ exit: 1 });
      await ensureWebBuild(cfg, kept, true);
      expect(readWebStamp(r)).toBeNull();
      expect(kept.errors.join()).toContain('bisherigen');

      const wiped = fakeIo({ exit: 1, onRun: () => rmSync(cfg.webDir, { recursive: true, force: true }) });
      await ensureWebBuild(cfg, wiped, true);
      expect(wiped.errors.join()).toContain('keine Oberfläche');
    });
  });

  it('schreibt keinen Stempel, wenn die Quellen lokal geändert sind', async () => {
    await withGitEnv(async () => {
      const { r, cfg, index } = setup();
      writeFileSync(join(r, 'apps', 'web', 'page.tsx'), 'lokal');
      const io = fakeIo({
        onRun: () => {
          mkdirSync(cfg.webDir, { recursive: true });
          writeFileSync(index, 'x');
        },
      });
      await ensureWebBuild(cfg, io, true);
      expect(io.calls).toEqual([BUILD]);
      expect(readWebStamp(r)).toBeNull();
    });
  });

  it('meldet eine fehlende Web-App, ohne zu bauen', async () => {
    await withGitEnv(async () => {
      const { cfg } = setup();
      const io = fakeIo();
      await ensureWebBuild(cfg, io, false);
      expect(io.calls).toEqual([]);
      expect(io.errors.join()).toContain('Web-App fehlt');
    });
  });
});
