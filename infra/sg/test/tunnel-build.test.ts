import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveConfig, type SgConfig } from '../src/config.ts';
import {
  ensureTunnelBuild,
  readTunnelStamp,
  RestartLimiter,
  superviseTunnel,
  tunnelBinary,
  tunnelBinaryProblem,
  tunnelBuildReason,
  tunnelCommand,
  tunnelSourceFingerprint,
  tunnelStampFile,
  TUNNEL_EXIT_CONFIG,
  type SuperviseDeps,
  type TunnelBuildIo,
  type TunnelExit,
} from '../src/tunnel.ts';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'sg-tunnel-test-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Ein Repo mit einem Swift-Paket im Stil von apps/mac-tunnel */
function makeRepo(): { cfg: SgConfig; write: (rel: string, text: string) => void } {
  const root = tmp();
  const cfg = resolveConfig({ SG_DATA_DIR: join(root, 'data') }, '/home/u', join(root, 'repo'));
  const write = (rel: string, text: string): void => {
    const full = join(cfg.tunnelPackageDir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, text);
  };
  write('Package.swift', '// package\n');
  write('Sources/TunnelKit/A.swift', 'let a = 1\n');
  write('Sources/sg-tunnel/main.swift', 'print("x")\n');
  write('Tests/TunnelKitTests/T.swift', 'import XCTest\n');
  return { cfg, write };
}

describe('tunnelCommand', () => {
  it('übergibt nur Dateipfade und --p2p, nie eine Core-URL oder ein Token', () => {
    const cfg = resolveConfig({ SG_DATA_DIR: '/data' }, '/home/u', '/repo');
    const c = tunnelCommand(cfg);
    expect(c.cmd).toBe('/repo/apps/mac-tunnel/.build/release/sg-tunnel');
    expect(c.args).toEqual([
      '--keys',
      '/data/secrets/tunnel-keys.json',
      '--socket',
      '/data/run/tunnel.sock',
      '--status',
      '/data/run/tunnel-state.json',
      '--p2p',
      'on',
    ]);
    expect(c.args.join(' ')).not.toMatch(/core-url|token|http/i);
  });

  it('SG_TUNNEL_P2P=0 schaltet die Ankündigung im Funk aus', () => {
    const cfg = resolveConfig({ SG_DATA_DIR: '/data', SG_TUNNEL_P2P: '0' }, '/home/u', '/repo');
    expect(tunnelCommand(cfg).args.slice(-2)).toEqual(['--p2p', 'off']);
  });
});

describe('tunnelSourceFingerprint', () => {
  it('ändert sich mit Quellen und Package.swift, nicht mit Tests, .build und .DS_Store', () => {
    const { cfg, write } = makeRepo();
    const base = tunnelSourceFingerprint(cfg.tunnelPackageDir);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(tunnelSourceFingerprint(cfg.tunnelPackageDir)).toBe(base);

    write('Tests/TunnelKitTests/T.swift', 'import XCTest\n// anders\n');
    write('.build/release/sg-tunnel', 'binär');
    write('Sources/TunnelKit/.DS_Store', 'müll');
    expect(tunnelSourceFingerprint(cfg.tunnelPackageDir)).toBe(base);

    write('Sources/TunnelKit/A.swift', 'let a = 2\n');
    const afterSource = tunnelSourceFingerprint(cfg.tunnelPackageDir);
    expect(afterSource).not.toBe(base);

    write('Package.swift', '// anderes package\n');
    const afterPackage = tunnelSourceFingerprint(cfg.tunnelPackageDir);
    expect(afterPackage).not.toBe(afterSource);

    write('Sources/TunnelKit/B.swift', 'let b = 1\n');
    expect(tunnelSourceFingerprint(cfg.tunnelPackageDir)).not.toBe(afterPackage);
  });

  it('unterscheidet Dateinamen (gleicher Inhalt, anderer Name)', () => {
    const one = makeRepo();
    const two = makeRepo();
    two.write('Sources/TunnelKit/A.swift', '');
    one.write('Sources/TunnelKit/A.swift', '');
    expect(tunnelSourceFingerprint(one.cfg.tunnelPackageDir)).toBe(
      tunnelSourceFingerprint(two.cfg.tunnelPackageDir),
    );
    one.write('Sources/TunnelKit/C.swift', 'x');
    two.write('Sources/TunnelKit/D.swift', 'x');
    expect(tunnelSourceFingerprint(one.cfg.tunnelPackageDir)).not.toBe(
      tunnelSourceFingerprint(two.cfg.tunnelPackageDir),
    );
  });

  it('fehlendes Paket ergibt null', () => {
    expect(tunnelSourceFingerprint(join(tmp(), 'gibt-es-nicht'))).toBeNull();
  });

  it('zählt einen Symlink mit seinem Ziel, ohne ihm zu folgen', () => {
    const { cfg, write } = makeRepo();
    write('Sources/TunnelKit/real.txt', 'a');
    symlinkSync('real.txt', join(cfg.tunnelPackageDir, 'Sources/TunnelKit/link.txt'));
    const before = tunnelSourceFingerprint(cfg.tunnelPackageDir);
    expect(before).not.toBeNull();
    symlinkSync('/etc/hostname', join(cfg.tunnelPackageDir, 'Sources/TunnelKit/link2.txt'));
    expect(tunnelSourceFingerprint(cfg.tunnelPackageDir)).not.toBe(before);
  });
});

describe('tunnelBinaryProblem', () => {
  /** Programm wie bei SwiftPM: `.build/release` ist ein Symlink auf den Ordner der Zielplattform */
  function makeBuilt(): { cfg: SgConfig; real: string } {
    const { cfg } = makeRepo();
    const realDir = join(cfg.tunnelPackageDir, '.build', 'arm64-apple-macosx', 'release');
    mkdirSync(realDir, { recursive: true });
    symlinkSync('arm64-apple-macosx/release', join(cfg.tunnelPackageDir, '.build', 'release'));
    const real = join(realDir, 'sg-tunnel');
    writeFileSync(real, '#!/bin/sh\n');
    chmodSync(real, 0o755);
    for (const d of [cfg.repoRoot, join(cfg.repoRoot, 'apps'), cfg.tunnelPackageDir]) chmodSync(d, 0o755);
    return { cfg, real };
  }
  const uid = process.getuid?.();

  it('eigenes, nur für den Besitzer beschreibbares Programm im Repo: startbar', () => {
    const { cfg } = makeBuilt();
    expect(tunnelBinaryProblem(cfg, uid)).toBeNull();
  });

  it('fehlendes Programm: nicht startbar', () => {
    const { cfg } = makeRepo();
    expect(tunnelBinaryProblem(cfg, uid)).toContain('fehlt');
  });

  it('fremder Besitzer: nicht startbar', () => {
    const { cfg } = makeBuilt();
    expect(tunnelBinaryProblem(cfg, (uid ?? 0) + 1)).toContain('anderen Benutzer');
  });

  it('für die Gruppe beschreibbares Programm oder beschreibbarer Ordner: nicht startbar', () => {
    const { cfg, real } = makeBuilt();
    chmodSync(real, 0o775);
    expect(tunnelBinaryProblem(cfg, uid)).toContain('beschreibbar');
    chmodSync(real, 0o755);
    chmodSync(join(cfg.tunnelPackageDir, '.build'), 0o777);
    expect(tunnelBinaryProblem(cfg, uid)).toContain('beschreibbar');
  });

  it('Symlink aus dem Repo heraus: nicht startbar', () => {
    const { cfg } = makeRepo();
    const outside = join(tmp(), 'sg-tunnel');
    writeFileSync(outside, '#!/bin/sh\n');
    chmodSync(outside, 0o755);
    mkdirSync(join(cfg.tunnelPackageDir, '.build', 'release'), { recursive: true });
    symlinkSync(outside, tunnelBinary(cfg));
    expect(tunnelBinaryProblem(cfg, uid)).toContain('aus dem Repo heraus');
  });
});

describe('tunnelBuildReason', () => {
  it('baut bei fehlendem Programm, bei geänderten Quellen, sonst nicht', () => {
    expect(tunnelBuildReason({ binaryExists: false, fingerprint: 'a', stamp: 'a' })).toBe('missing');
    expect(tunnelBuildReason({ binaryExists: true, fingerprint: 'b', stamp: 'a' })).toBe('outdated');
    expect(tunnelBuildReason({ binaryExists: true, fingerprint: 'a', stamp: null })).toBe('outdated');
    expect(tunnelBuildReason({ binaryExists: true, fingerprint: 'a', stamp: 'a' })).toBeNull();
    // Quellen nicht bestimmbar: ein vorhandenes Programm wird nicht angefasst
    expect(tunnelBuildReason({ binaryExists: true, fingerprint: null, stamp: null })).toBeNull();
  });
});

interface FakeBuild {
  io: TunnelBuildIo;
  runs: string[][];
  logs: string[];
  errs: string[];
}

function fakeBuildIo(
  cfg: SgConfig,
  over: Partial<TunnelBuildIo> & { buildCode?: number; swift?: boolean } = {},
): FakeBuild {
  const runs: string[][] = [];
  const logs: string[] = [];
  const errs: string[] = [];
  const io: TunnelBuildIo = {
    platform: over.platform ?? 'darwin',
    hasFile: over.hasFile ?? existsSync,
    hasSwift: over.hasSwift ?? (async () => over.swift ?? true),
    run:
      over.run ??
      (async (cmd, args) => {
        runs.push([cmd, ...args]);
        if ((over.buildCode ?? 0) === 0) {
          // Ein erfolgreicher Bau legt das Programm an
          mkdirSync(join(tunnelBinary(cfg), '..'), { recursive: true });
          writeFileSync(tunnelBinary(cfg), '#!/bin/sh\n');
        }
        return over.buildCode ?? 0;
      }),
    log: (m) => logs.push(m),
    err: (m) => errs.push(m),
  };
  return { io, runs, logs, errs };
}

describe('ensureTunnelBuild', () => {
  it('baut beim ersten Start, schreibt den Stempel und baut danach nicht mehr', async () => {
    const { cfg } = makeRepo();
    const first = fakeBuildIo(cfg);
    expect(await ensureTunnelBuild(cfg, first.io)).toEqual({ status: 'ready' });
    expect(first.runs).toEqual([['swift', 'build', '-c', 'release', '--package-path', cfg.tunnelPackageDir]]);
    expect(first.logs.join('\n')).toMatch(/noch nicht gebaut/);
    expect(readTunnelStamp(cfg)).toBe(tunnelSourceFingerprint(cfg.tunnelPackageDir));

    const second = fakeBuildIo(cfg);
    expect(await ensureTunnelBuild(cfg, second.io)).toEqual({ status: 'ready' });
    expect(second.runs).toEqual([]);
    expect(second.errs).toEqual([]);
  });

  it('baut nur bei geänderter Prüfsumme neu', async () => {
    const { cfg, write } = makeRepo();
    await ensureTunnelBuild(cfg, fakeBuildIo(cfg).io);
    // Änderung an Tests oder .build: kein Bau
    write('Tests/TunnelKitTests/T.swift', 'import XCTest\n// egal\n');
    const unchanged = fakeBuildIo(cfg);
    await ensureTunnelBuild(cfg, unchanged.io);
    expect(unchanged.runs).toEqual([]);
    // Änderung an den Quellen: Bau
    write('Sources/TunnelKit/A.swift', 'let a = 3\n');
    const changed = fakeBuildIo(cfg);
    expect(await ensureTunnelBuild(cfg, changed.io)).toEqual({ status: 'ready' });
    expect(changed.runs).toHaveLength(1);
    expect(changed.logs.join('\n')).toMatch(/geändert/);
    expect(readTunnelStamp(cfg)).toBe(tunnelSourceFingerprint(cfg.tunnelPackageDir));
  });

  it('fehlt Swift, startet der Rest ohne Helfer und sg sagt es deutlich', async () => {
    const { cfg } = makeRepo();
    const fake = fakeBuildIo(cfg, { swift: false });
    expect(await ensureTunnelBuild(cfg, fake.io)).toEqual({ status: 'failed', why: 'no-swift' });
    expect(fake.runs).toEqual([]);
    expect(fake.errs.join('\n')).toMatch(/Swift fehlt/);
    expect(fake.errs.join('\n')).toMatch(/xcode-select --install/);
    expect(fake.errs.join('\n')).toMatch(/Alles andere läuft weiter/);
  });

  it('startet auch ein vorhandenes, aber veraltetes Programm nicht, wenn Swift fehlt', async () => {
    const { cfg, write } = makeRepo();
    await ensureTunnelBuild(cfg, fakeBuildIo(cfg).io);
    write('Sources/TunnelKit/A.swift', 'let a = 4\n');
    const fake = fakeBuildIo(cfg, { swift: false });
    expect(await ensureTunnelBuild(cfg, fake.io)).toEqual({ status: 'failed', why: 'no-swift' });
  });

  it('scheitert der Bau, gibt es keinen Stempel und der Rest läuft weiter', async () => {
    const { cfg } = makeRepo();
    const fake = fakeBuildIo(cfg, { buildCode: 1 });
    expect(await ensureTunnelBuild(cfg, fake.io)).toEqual({ status: 'failed', why: 'build-failed' });
    expect(fake.errs.join('\n')).toMatch(/Bau des Tunnel-Helfers fehlgeschlagen/);
    expect(() => readFileSync(tunnelStampFile(cfg))).toThrow();
    expect(readTunnelStamp(cfg)).toBeNull();
  });

  it('ein Bau ohne Programm gilt als gescheitert', async () => {
    const { cfg } = makeRepo();
    const fake = fakeBuildIo(cfg, { run: async () => 0 });
    expect(await ensureTunnelBuild(cfg, fake.io)).toEqual({ status: 'failed', why: 'no-binary' });
  });

  it('schreibt keinen Stempel, wenn sich die Quellen während des Baus ändern', async () => {
    const { cfg, write } = makeRepo();
    const fake = fakeBuildIo(cfg, {
      run: async () => {
        mkdirSync(join(tunnelBinary(cfg), '..'), { recursive: true });
        writeFileSync(tunnelBinary(cfg), 'x');
        write('Sources/TunnelKit/A.swift', 'let a = 99\n');
        return 0;
      },
    });
    expect(await ensureTunnelBuild(cfg, fake.io)).toEqual({ status: 'ready' });
    expect(readTunnelStamp(cfg)).toBeNull();
  });

  it('überspringt alles mit SG_TUNNEL=0, außerhalb von macOS und ohne Paket', async () => {
    const { cfg } = makeRepo();
    const off = resolveConfig({ SG_TUNNEL: '0', SG_DATA_DIR: cfg.dataDir }, '/home/u', cfg.repoRoot);
    const a = fakeBuildIo(off);
    expect(await ensureTunnelBuild(off, a.io)).toEqual({ status: 'skipped', why: 'disabled' });
    expect(a.runs).toEqual([]);

    const b = fakeBuildIo(cfg, { platform: 'linux' });
    expect(await ensureTunnelBuild(cfg, b.io)).toEqual({ status: 'skipped', why: 'platform' });
    expect(b.runs).toEqual([]);

    const empty = resolveConfig({ SG_DATA_DIR: join(tmp(), 'd') }, '/home/u', join(tmp(), 'leer'));
    const c = fakeBuildIo(empty);
    expect(await ensureTunnelBuild(empty, c.io)).toEqual({ status: 'skipped', why: 'no-package' });
    expect(c.errs.join('\n')).toMatch(/fehlt/);
  });
});

describe('RestartLimiter', () => {
  it('erlaubt 5 Neustarts in 10 Minuten, den sechsten nicht', () => {
    const limiter = new RestartLimiter();
    const start = 1_000_000;
    for (let i = 0; i < 5; i++) expect(limiter.allow(start + i * 1000)).toBe(true);
    expect(limiter.allow(start + 6000)).toBe(false);
    // Nach Ablauf des Fensters (vom ersten Neustart an) geht es wieder
    expect(limiter.allow(start + 10 * 60 * 1000 + 1)).toBe(true);
  });
});

describe('superviseTunnel', () => {
  function deps(exits: TunnelExit[], over: Partial<SuperviseDeps> = {}) {
    const events: string[] = [];
    let clock = 0;
    let spawned = 0;
    const d: SuperviseDeps = {
      spawn: async () => {
        spawned++;
        const next = exits.shift();
        if (!next) throw new Error('kein weiterer Exit vorbereitet');
        return next;
      },
      isStopping: () => false,
      sleep: async (ms) => {
        clock += ms;
        events.push(`sleep ${ms}`);
      },
      now: () => clock,
      log: (m) => events.push(`log ${m}`),
      err: (m) => events.push(`err ${m}`),
      ...over,
    };
    return { d, events, spawned: () => spawned };
  }

  it('startet nach einem Absturz neu, höchstens 5-mal, dann Meldung', async () => {
    const crash: TunnelExit = { code: 1, signal: null };
    const { d, events, spawned } = deps(Array.from({ length: 10 }, () => crash));
    await superviseTunnel(d);
    expect(spawned()).toBe(6); // 1 Start + 5 Neustarts
    expect(events.filter((e) => e.startsWith('log Starte den Tunnel-Helfer neu'))).toHaveLength(5);
    expect(events.at(-1)).toMatch(/err Der Tunnel-Helfer ist 5-mal in 10 Minuten ausgefallen/);
  });

  it('startet nach Signalen und Exit-Code 0 neu (unerwartet beendet)', async () => {
    const { d, spawned } = deps([
      { code: null, signal: 'SIGSEGV' },
      { code: 0, signal: null },
      { code: 78, signal: null },
    ]);
    await superviseTunnel(d);
    expect(spawned()).toBe(3);
  });

  it('startet bei einem Konfigurationsfehler (Exit-Code 78) nie neu', async () => {
    const { d, events, spawned } = deps([{ code: TUNNEL_EXIT_CONFIG, signal: null }]);
    await superviseTunnel(d);
    expect(spawned()).toBe(1);
    expect(events.join('\n')).toMatch(/Konfigurationsfehler/);
    expect(events.join('\n')).toMatch(/Kein Neustart/);
  });

  it('startet nach gewolltem Beenden (Strg+C, sg stop) nicht neu', async () => {
    let stopping = false;
    let calls = 0;
    const { d } = deps([], {
      spawn: async () => {
        calls++;
        stopping = true; // das Beenden kommt, während der Helfer läuft
        return { code: null, signal: 'SIGTERM' };
      },
      isStopping: () => stopping,
    });
    await superviseTunnel(d);
    expect(calls).toBe(1);
  });

  it('bricht ab, wenn das Beenden während der Wartezeit kommt', async () => {
    let stopping = false;
    const { d, spawned } = deps(
      [
        { code: 1, signal: null },
        { code: 1, signal: null },
      ],
      {
        sleep: async () => {
          stopping = true;
        },
        isStopping: () => stopping,
      },
    );
    await superviseTunnel(d);
    expect(spawned()).toBe(1);
  });

  it('ein Startfehler zählt wie ein Absturz', async () => {
    let n = 0;
    const events: string[] = [];
    await superviseTunnel({
      spawn: async () => {
        n++;
        throw new Error('ENOENT');
      },
      isStopping: () => false,
      sleep: async () => undefined,
      now: () => 0,
      log: () => undefined,
      err: (m) => events.push(m),
    });
    expect(n).toBe(6);
    expect(events.join('\n')).toMatch(/konnte nicht gestartet werden: ENOENT/);
  });
});
