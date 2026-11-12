import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/config.ts';
import { processAlive } from '../src/liveness.ts';
import {
  checkCoreLock,
  checkFreeSpace,
  type LockDoctorIo,
  type LockRead,
  readLockFileSafe,
  checkNode,
  doctorExitCode,
  MIN_FREE_BYTES,
  formatChecks,
  parseVersion,
  runChecks,
  type CheckResult,
} from '../src/doctor.ts';
import { freeBytesNearest, type RunResult, type System } from '../src/system.ts';

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

describe('checkCoreLock', () => {
  const lockCfg = resolveConfig({ SG_DATA_DIR: '/data' }, '/home/u', '/repo');
  const io = (lock: LockRead, alive: boolean, reachable: boolean): LockDoctorIo => ({
    readLock: () => lock,
    alive: () => alive,
    coreReachable: async () => reachable,
  });
  const pid = (n: number): LockRead => ({ kind: 'pid', pid: n });

  it('keine Datei und kein Core: ok', async () => {
    expect((await checkCoreLock(lockCfg, io({ kind: 'missing' }, false, false))).status).toBe('ok');
  });

  it('keine Datei, aber der Core antwortet: Hinweis, kein Fehler', async () => {
    const r = await checkCoreLock(lockCfg, io({ kind: 'missing' }, false, true));
    expect(r.status).toBe('info');
    expect(r.detail).toMatch(/fehlt.*zweiter Start würde ihn nicht erkennen/);
  });

  it('lebende PID und Core erreichbar: ok', async () => {
    const r = await checkCoreLock(lockCfg, io(pid(4242), true, true));
    expect(r.status).toBe('ok');
    expect(r.detail).toMatch(/4242/);
  });

  it('tote PID: veraltet, wird beim nächsten Start übernommen (kein Fehler)', async () => {
    const r = await checkCoreLock(lockCfg, io(pid(4242), false, false));
    expect(r.status).toBe('info');
    expect(r.detail).toMatch(/veraltet.*nächsten Start übernommen/);
    expect(r.detail).not.toMatch(/zweiter Start/);
  });

  it('tote PID, aber ein Core antwortet: Hinweis, dass ein zweiter Start ihn nicht erkennt', async () => {
    const r = await checkCoreLock(lockCfg, io(pid(4242), false, true));
    expect(r.status).toBe('info');
    expect(r.detail).toMatch(/veraltet.*zweiter Start würde ihn nicht erkennen/);
  });

  it('leere oder kaputte Datei: Hinweis, kein Fehler', async () => {
    const r = await checkCoreLock(lockCfg, io({ kind: 'invalid' }, false, false));
    expect(r.status).toBe('info');
    expect(r.detail).toMatch(/leer oder kaputt.*übernommen/);
    expect(r.detail).not.toMatch(/zweiter Start/);
    const live = await checkCoreLock(lockCfg, io({ kind: 'invalid' }, false, true));
    expect(live.detail).toMatch(/zweiter Start würde ihn nicht erkennen/);
  });

  it('nicht lesbar oder keine normale Datei: Hinweis mit Pfad, kein Fehler', async () => {
    const denied = await checkCoreLock(lockCfg, io({ kind: 'unreadable', code: 'EACCES' }, false, true));
    expect(denied.status).toBe('info');
    expect(denied.detail).toMatch(/nicht lesen \(EACCES\)/);
    expect(denied.detail).not.toMatch(/fehlt/);
    const special = await checkCoreLock(lockCfg, io({ kind: 'special' }, false, false));
    expect(special.status).toBe('info');
    expect(special.detail).toContain('/data/run/core.lock ist keine normale Datei');
    expect(doctorExitCode([denied, special])).toBe(0);
  });

  it('lebende PID, Core nicht erreichbar: PID-Wiederverwendung und Pfad zum Löschen', async () => {
    const r = await checkCoreLock(lockCfg, io(pid(4242), true, false));
    expect(r.status).toBe('info');
    expect(r.detail).toMatch(/fremder Prozess/);
    expect(r.detail).toContain('/data/run/core.lock');
    expect(doctorExitCode([r])).toBe(0);
  });

  it('processAlive (aus liveness.ts, gleiche Regel wie im Core): eigener Prozess lebt, unbelegte PID nicht', () => {
    expect(processAlive(process.pid)).toBe(true);
    expect(processAlive(2 ** 22 + 12345)).toBe(false);
  });
});

describe('readLockFileSafe', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sg-lock-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const lock = () => join(dir, 'core.lock');

  it('fehlt, gültige PID, leer, kaputt', () => {
    expect(readLockFileSafe(lock())).toEqual({ kind: 'missing' });
    writeFileSync(lock(), '4242\n');
    expect(readLockFileSafe(lock())).toEqual({ kind: 'pid', pid: 4242 });
    writeFileSync(lock(), '');
    expect(readLockFileSafe(lock())).toEqual({ kind: 'invalid' });
    writeFileSync(lock(), 'abc');
    expect(readLockFileSafe(lock())).toEqual({ kind: 'invalid' });
    writeFileSync(lock(), '-3\n');
    expect(readLockFileSafe(lock())).toEqual({ kind: 'invalid' });
  });

  it('große Datei wird nicht gelesen, sondern gilt als kaputt', () => {
    writeFileSync(lock(), `4242${' '.repeat(10_000)}`);
    expect(readLockFileSafe(lock())).toEqual({ kind: 'invalid' });
  });

  it('symbolischer Link, Ordner und FIFO: keine normale Datei, ohne zu folgen oder zu hängen', () => {
    writeFileSync(join(dir, 'ziel'), '4242\n');
    symlinkSync(join(dir, 'ziel'), lock());
    expect(readLockFileSafe(lock())).toEqual({ kind: 'special' });
    rmSync(lock());
    symlinkSync(join(dir, 'fehlt'), lock());
    expect(readLockFileSafe(lock())).toEqual({ kind: 'special' });
    rmSync(lock());
    mkdirSync(lock());
    expect(readLockFileSafe(lock())).toEqual({ kind: 'special' });
    rmSync(lock(), { recursive: true });
    if (process.platform !== 'win32') {
      execFileSync('mkfifo', [lock()]);
      expect(readLockFileSafe(lock())).toEqual({ kind: 'special' });
    }
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'ohne Leserechte: nicht lesbar (EACCES)',
    () => {
      writeFileSync(lock(), '4242\n', { mode: 0o000 });
      expect(readLockFileSafe(lock())).toEqual({ kind: 'unreadable', code: 'EACCES' });
    },
  );
});
