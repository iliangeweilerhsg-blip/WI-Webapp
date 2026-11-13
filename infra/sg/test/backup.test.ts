import {
  cpSync,
  existsSync,
  lchownSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  renameSync,
  rmSync,
  symlinkSync,
  realpathSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Schreibgeschütztes Ziel simulieren (auch als root, der Dateirechte übergeht): `accessSync(W_OK)` auf einem Pfad
// in `readOnlyDirs` scheitert mit EACCES, wie bei einem read-only NAS, Snapshot oder schreibgeschütztem Stick.
const readOnlyDirs = vi.hoisted(() => new Set<string>());
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const accessSync = ((path: Parameters<typeof actual.accessSync>[0], mode?: number) => {
    if (typeof path === 'string' && mode === actual.constants.W_OK && readOnlyDirs.has(path)) {
      throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    }
    return actual.accessSync(path, mode);
  }) as typeof actual.accessSync;
  return { ...actual, accessSync };
});
import { resolveConfig } from '../src/config.ts';
import { acquireCoreLock } from '../src/core-lock.ts';
import { emptySums, formatFileList, NameConflictError, parseFileList } from '../src/file-sums.ts';
import {
  copyTree,
  listStands,
  readManifest,
  readManifestAt,
  removeStalePartialsReport,
  removeStandReport,
  standName,
  treeSize,
} from '../src/backup-files.ts';
import {
  backupBeforeMigrate,
  parseBackupArgs,
  parseRestoreArgs,
  preMigrationBackup,
} from '../src/backup-commands.ts';
import {
  errorText,
  runBackup,
  thin,
  validateTarget,
  type BackupDeps,
  type OwnedStands,
} from '../src/backup.ts';
import {
  createPg,
  openPg,
  parseDatabaseUrl,
  safeIdent,
  scrubSecrets,
  type Exec,
  type PgAccess,
} from '../src/pg.ts';
import { recoverRestore, runRestore, type RestoreDeps } from '../src/restore.ts';
import { runAutoRestoreTest } from '../src/restore-auto.ts';
import {
  copyAndHash,
  FREE_RESERVE_BYTES,
  freeBytes,
  SIZE_MISMATCH,
  withVerifiedDump,
} from '../src/staging.ts';

// Tests der Besitzerprüfung brauchen root (lchown auf fremde uid). Neue Root-Tests NUR über `rootIt` anlegen:
// Es setzt das Präfix „[root] “, nach dem der CI-Schritt „Backup-Tests mit root“ filtert und zählt.
const asRoot = process.getuid?.() === 0;
function rootIt(name: string, fn: () => Promise<void> | void, timeout?: number): void {
  it.skipIf(!asRoot)(`[root] ${name}`, fn, timeout);
}
// Wächter: In CI (SG_ROOT_TESTS=1) muss der Lauf wirklich root sein, sonst wären alle [root]-Tests still übersprungen.
it.runIf(process.env.SG_ROOT_TESTS === '1')('[root] Wächter: läuft wirklich als root', () => {
  expect(process.getuid?.()).toBe(0);
});

const dirs: string[] = [];
afterEach(() => readOnlyDirs.clear());
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'sg-backup-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

interface Run {
  id: string;
  state: string;
  error: string | null;
  stand: string | null;
  size: string | null;
  sha: string | null;
  trigger: string;
  target: string;
  /** `backup_run.thin_left` (H3, #124): Reste des Ausdünnens nach diesem Lauf */
  thinLeft?: string[] | null;
  warning?: string | null;
  /** `backup_run.files_sha256` (#114 N-1) */
  filesSha?: string | null;
}

/** Datenbank-Attrappe: erkennt die SQL-Texte der CLI und führt Buch über `backup_run` */
class FakePg implements PgAccess {
  mode = 'local' as const;
  database = 'sg';
  runs = new Map<string, Run>();
  queries: { sql: string; vars: Record<string, string>; db: string | undefined }[] = [];
  target: string | null = null;
  encryption = false;
  otherActive = 0;
  dumpImpl: (file: string) => Promise<void> = async (file) => writeFileSync(file, 'PGDMP-test');
  restoreImpl: (db: string, file: string) => Promise<void> = async () => {};
  renameFailsFor: string | null = null;
  databases = new Set(['sg']);
  tables = ['semester', 'module', 'setting'];
  counts: [string, string][] = [
    ['semester', '1'],
    ['module', '2'],
    ['setting', '0'],
  ];
  restored: { db: string; file: string }[] = [];
  /** Ergebnis des Restore-Tests (`setting.restore_test`), zuletzt geschrieben */
  testResult: Record<string, unknown> | null = null;
  leftovers: string[] = [];
  /** Läuft ein Restore-Test? (`setting.restore_test`) */
  testRunning = false;
  testStartedAt = '2026-11-04T02:59:00.000Z';
  /** Vom Backup als abgebrochen markierter Restore-Test (#113) */
  testAborted: Record<string, unknown> | null = null;
  /** Hat `backup_run` schon die Spalten aus `0008` (`thin_left`, `warning`)? */
  hasThinLeft = true;
  /** Hat `backup_run` schon die Spalte aus `0011` (`files_sha256`)? */
  hasFilesSha = true;

  async query(sql: string, vars: Record<string, string> = {}, db?: string): Promise<string[][]> {
    this.queries.push({ sql, vars, db });
    if (sql.includes('Abgebrochen: kein Abschluss')) return [];
    if (sql.includes("AND stand = :'stand'")) {
      // Eigener Lauf zum Stand (restore von Hand, Härtung aus #114)
      const run = [...this.runs.values()]
        .filter((r) => r.state === 'fertig' && r.stand === vars.stand && r.sha)
        .reverse()[0];
      return run ? [[run.sha as string, run.size ?? '', run.filesSha ?? '']] : [];
    }
    if (sql.includes("SELECT stand, trigger, coalesce(dump_sha256, '')")) {
      // Eigene Stände (H-1, #161)
      return [...this.runs.values()]
        .filter((r) => r.state === 'fertig' && r.stand && r.target === vars.target)
        .map((r) => [r.stand as string, r.trigger, r.sha ?? '']);
    }
    if (sql.includes("NULLIF(:'id'")) {
      return Array.from({ length: this.otherActive }, (_, i) => [
        `019a4e14-0000-7000-8000-0000000000${String(i).padStart(2, '0')}`,
      ]);
    }
    if (sql.includes("value->>'backup_target'")) {
      return this.target === null && !this.encryption ? [] : [[this.target ?? '', String(this.encryption)]];
    }
    if (sql.includes('SELECT count(*) FROM backup_run WHERE id')) {
      return [[this.runs.has(vars.id as string) ? '1' : '0']];
    }
    if (sql.includes('INSERT INTO backup_run')) {
      this.runs.set(vars.id as string, {
        id: vars.id as string,
        state: 'laeuft',
        error: null,
        stand: null,
        size: null,
        sha: null,
        trigger: vars.trigger as string,
        target: vars.target as string,
      });
      return [];
    }
    if (sql.includes("column_name = :'column'")) {
      return [[vars.column === 'files_sha256' ? (this.hasFilesSha ? '1' : '0') : '1']];
    }
    if (sql.includes('pg_tables')) return this.tables.map((t) => [t]);
    if (sql.includes('UNION ALL')) return this.counts;
    if (sql.includes('SHOW server_version')) return [['16.4']];
    if (sql.includes("SET state = 'fertig'")) {
      const run = this.runs.get(vars.id as string);
      if (run)
        Object.assign(run, {
          state: 'fertig',
          stand: vars.stand as string,
          size: vars.size as string,
          sha: vars.sha as string,
        });
      // Anker der Dateiliste nur, wenn das UPDATE die Spalte setzt (Migration 0011, #114 N-1)
      if (run && sql.includes("files_sha256 = :'files'")) run.filesSha = vars.files as string;
      return [];
    }
    if (sql.includes("SET state = 'fehler'")) {
      const run = this.runs.get(vars.id as string);
      if (run) Object.assign(run, { state: 'fehler', error: vars.error as string });
      return [];
    }
    const create = /^CREATE DATABASE (\w+)/.exec(sql);
    if (create) this.databases.add(create[1] as string);
    const drop = /^DROP DATABASE IF EXISTS (\w+)/.exec(sql);
    if (drop) this.databases.delete(drop[1] as string);
    if (sql.includes('FROM backup_run') && sql.includes('dump_sha256 IS NOT NULL')) {
      return [...this.runs.values()]
        .filter((r) => r.state === 'fertig' && r.stand && r.sha && r.target === vars.target)
        .reverse()
        .map((r) => [r.stand as string, r.sha as string, r.size ?? '', r.filesSha ?? '']);
    }
    if (sql.includes("INSERT INTO setting (key, value, user_id) VALUES ('restore_test'")) {
      this.testResult = JSON.parse(vars.value as string) as Record<string, unknown>;
      return [];
    }
    if (sql.includes("key = 'restore_test'") && sql.includes('now() - interval')) {
      return this.testRunning ? [[this.testStartedAt]] : [];
    }
    if (sql.includes("UPDATE setting SET value = value || :'patch'")) {
      if (this.testRunning && vars.started === this.testStartedAt) {
        this.testRunning = false;
        this.testAborted = JSON.parse(vars.patch as string) as Record<string, unknown>;
      }
      return [];
    }
    if (sql.includes('SELECT stand FROM backup_run')) {
      const newest = [...this.runs.values()]
        .filter((r) => r.state === 'fertig' && r.stand && r.target === vars.target)
        .reverse()[0];
      return newest ? [[newest.stand as string]] : [];
    }
    if (sql.includes("value->>'started_at'")) return [];
    if (sql.includes('datname LIKE')) return this.leftovers.map((n) => [n]);
    if (sql.includes('FROM pg_database')) {
      return (vars.names ?? '')
        .split(',')
        .filter((n) => this.databases.has(n))
        .map((n) => [n]);
    }
    if (sql.startsWith('BEGIN;')) {
      if (this.renameFailsFor) throw new Error('rename kaputt');
      for (const m of sql.matchAll(/ALTER DATABASE (\w+) RENAME TO (\w+)/g)) {
        this.databases.delete(m[1] as string);
        this.databases.add(m[2] as string);
      }
    }
    if (sql.includes("to_regclass('sync_meta')")) return [['t']];
    if (sql.includes("column_name = 'thin_left'")) return [[this.hasThinLeft ? '1' : '0']];
    if (sql.includes("array_to_string(thin_left, '/')")) {
      const previous = [...this.runs.values()]
        .filter(
          (r) => r.state === 'fertig' && r.target === vars.target && r.id !== vars.id && r.thinLeft != null,
        )
        .reverse()[0];
      return previous ? [[(previous.thinLeft as string[]).join('/')]] : [];
    }
    if (sql.includes('SET thin_left = ')) {
      const run = this.runs.get(vars.id as string);
      if (run) {
        run.thinLeft = (vars.left as string).split('/').filter((n) => n !== '');
        run.warning = vars.warning === '' ? null : (vars.warning as string);
      }
      return [];
    }
    return [];
  }
  async dump(file: string): Promise<void> {
    await this.dumpImpl(file);
  }
  async restore(db: string, file: string): Promise<void> {
    this.restored.push({ db, file });
    await this.restoreImpl(db, file);
  }
}

function setup(over: Partial<FakePg> = {}) {
  const dataDir = tmp();
  const target = join(tmp(), 'ziel');
  mkdirSync(target);
  mkdirSync(join(dataDir, 'media', 'photos'), { recursive: true });
  writeFileSync(join(dataDir, 'media', 'photos', 'a.jpg'), 'JPEG');
  mkdirSync(join(dataDir, 'vault'), { recursive: true });
  writeFileSync(join(dataDir, 'vault', 'n.md'), '# Notiz');
  const pg = Object.assign(new FakePg(), { target }, over);
  const logs: string[] = [];
  const errs: string[] = [];
  let ids = 0;
  const deps: BackupDeps = {
    cfg: { dataDir, databaseUrl: 'postgres://sg:geheim-pw@127.0.0.1:5432/sg' },
    pg,
    log: (m) => logs.push(m),
    err: (m) => errs.push(m),
    now: () => new Date('2026-11-04T03:00:12Z'),
    // Erster Lauf `…aa`, jeder weitere eine eigene ID (eigene Stände zählen nach `backup_run`, H-1 aus #161)
    newId: () =>
      ids++ === 0
        ? '019a4e14-0000-7000-8000-0000000000aa'
        : `019a4e14-0000-7000-8000-1${String(ids).padStart(11, '0')}`,
  };
  return { dataDir, target, pg, deps, logs, errs };
}

describe('runBackup', () => {
  it('legt einen vollständigen Stand an und schreibt backup_run (laeuft → fertig)', async () => {
    const { target, pg, deps, logs } = setup();
    const code = await runBackup(deps, { trigger: 'manuell' });
    expect(code).toBe(0);
    const stand = '20261104T030012Z';
    expect(readdirSync(target)).toEqual([stand]);
    expect(readFileSync(join(target, stand, 'db.dump'), 'utf8')).toBe('PGDMP-test');
    expect(readFileSync(join(target, stand, 'media', 'photos', 'a.jpg'), 'utf8')).toBe('JPEG');
    expect(readFileSync(join(target, stand, 'vault', 'n.md'), 'utf8')).toBe('# Notiz');
    const manifest = readManifest(join(target, stand));
    expect(manifest).toMatchObject({
      version: 1,
      stand,
      trigger: 'manuell',
      pg_server_version: '16.4',
      counts: { semester: 1, module: 2, setting: 0 },
      media: { files: 1, bytes: 4 },
      vault: { files: 1, bytes: 7 },
    });
    expect(manifest?.dump.sha256).toMatch(/^[0-9a-f]{64}$/);
    const run = pg.runs.get('019a4e14-0000-7000-8000-0000000000aa');
    expect(run).toMatchObject({ state: 'fertig', stand, trigger: 'manuell', target });
    expect(Number(run?.size)).toBe(10 + 4 + 7);
    expect(logs.join('\n')).toContain('fertig');
  });

  it('übernimmt die vom Core angelegte Zeile (--run-id) statt eine neue anzulegen', async () => {
    const { pg, deps } = setup();
    const id = '019a4e14-0000-7000-8000-0000000000bb';
    pg.runs.set(id, {
      id,
      state: 'laeuft',
      error: null,
      stand: null,
      size: null,
      sha: null,
      trigger: 'manuell',
      target: pg.target!,
    });
    expect(await runBackup(deps, { trigger: 'manuell', runId: id })).toBe(0);
    expect(pg.runs.size).toBe(1);
    expect(pg.runs.get(id)?.state).toBe('fertig');
  });

  it('zweiter Stand: unveränderte Dateien sind Hardlinks, geänderte neu; beide Stände vollständig', async () => {
    const { dataDir, target, deps } = setup();
    await runBackup(deps, { trigger: 'zeitplan' });
    writeFileSync(join(dataDir, 'vault', 'n.md'), '# Notiz neu und länger');
    const second = { ...deps, now: () => new Date('2026-11-05T03:00:00Z') };
    expect(await runBackup(second, { trigger: 'zeitplan' })).toBe(0);
    const [newer, older] = listStands(target) as [string, string];
    expect(lstatSync(join(target, newer, 'media', 'photos', 'a.jpg')).ino).toBe(
      lstatSync(join(target, older, 'media', 'photos', 'a.jpg')).ino,
    );
    expect(readFileSync(join(target, older, 'vault', 'n.md'), 'utf8')).toBe('# Notiz');
    expect(readFileSync(join(target, newer, 'vault', 'n.md'), 'utf8')).toBe('# Notiz neu und länger');
  });

  it('ohne Ziel: Exit 2, keine Zeile', async () => {
    const { pg, deps, errs } = setup({ target: null });
    expect(await runBackup(deps, { trigger: 'manuell' })).toBe(2);
    expect(pg.runs.size).toBe(0);
    expect(errs.join()).toContain('kein Backup-Ziel');
  });

  it('B2: Manipulation des Ziels während des Dumps ergibt nie eine Prüfsumme fremder Bytes (Lauf scheitert, kein Stand)', async () => {
    const { pg, deps, target } = setup();
    pg.dumpImpl = async (file) => {
      writeFileSync(file, 'PGDMP-echt');
      // Angreifer mit Schreibrecht im Ziel legt/ersetzt die Dump-Datei im .partial-Ordner
      for (const name of readdirSync(target)) {
        if (name.endsWith('.partial')) writeFileSync(join(target, name, 'db.dump'), 'PGDMP-evil');
      }
    };
    const code = await runBackup(deps, { trigger: 'zeitplan' });
    const evil = createHash('sha256').update('PGDMP-evil').digest('hex');
    const echt = createHash('sha256').update('PGDMP-echt').digest('hex');
    for (const run of pg.runs.values()) expect(run.sha).not.toBe(evil);
    if (code === 0) {
      // Wenn der Lauf gelingt, gehören Prüfsumme, Manifest und Datei im Stand zu den Bytes von pg_dump
      expect([...pg.runs.values()][0]?.sha).toBe(echt);
      expect(readManifest(join(target, '20261104T030012Z'))?.dump.sha256).toBe(echt);
      expect(readFileSync(join(target, '20261104T030012Z', 'db.dump'), 'utf8')).toBe('PGDMP-echt');
    } else {
      expect([...pg.runs.values()][0]?.state).toBe('fehler');
      expect(existsSync(join(target, '20261104T030012Z'))).toBe(false);
    }
  });

  it('B2: Prüfsumme im Lauf und im Manifest = Bytes von pg_dump (Normalfall)', async () => {
    const { pg, deps, target } = setup();
    pg.dumpImpl = async (file) => writeFileSync(file, 'PGDMP-echt');
    expect(await runBackup(deps, { trigger: 'zeitplan' })).toBe(0);
    const echt = createHash('sha256').update('PGDMP-echt').digest('hex');
    expect([...pg.runs.values()][0]?.sha).toBe(echt);
    expect(readManifest(join(target, '20261104T030012Z'))?.dump.sha256).toBe(echt);
  });

  it('B2: der Dump entsteht im privaten Ordner (nicht im Ziel), der danach gelöscht ist', async () => {
    const { pg, deps, dataDir, target } = setup();
    const seen: string[] = [];
    pg.dumpImpl = async (file) => {
      seen.push(file);
      writeFileSync(file, 'PGDMP-x');
    };
    expect(await runBackup(deps, { trigger: 'zeitplan' })).toBe(0);
    expect(seen[0]?.startsWith(join(dataDir, 'tmp'))).toBe(true);
    expect(seen[0]?.startsWith(target)).toBe(false);
    expect(existsSync(dirname(seen[0] as string))).toBe(false);
  });

  it('S2: läuft ein Restore-Test, startet kein Backup (Exit 4, klare Meldung, kein Dump)', async () => {
    const { pg, deps, errs } = setup();
    pg.testRunning = true;
    expect(await runBackup(deps, { trigger: 'manuell' })).toBe(4);
    expect(errs.join('\n')).toContain('Restore-Test');
    expect(pg.runs.size).toBe(0);
  });

  it('S2: mit Zeile vom Core wird sie als Fehler eingetragen statt auf „läuft“ zu bleiben', async () => {
    const { pg, deps } = setup();
    const id = '019a4e14-0000-7000-8000-0000000000dd';
    pg.runs.set(id, {
      id,
      state: 'laeuft',
      error: null,
      stand: null,
      size: null,
      sha: null,
      trigger: 'zeitplan',
      target: pg.target as string,
    });
    pg.testRunning = true;
    expect(await runBackup(deps, { trigger: 'zeitplan', runId: id })).toBe(4);
    expect(pg.runs.get(id)).toMatchObject({ state: 'fehler' });
    expect(pg.runs.get(id)?.error).toContain('Restore-Test');
  });

  it('Verschlüsselung eingeschaltet: Lauf scheitert mit Hinweis, es entsteht kein unverschlüsselter Stand', async () => {
    const { target, pg, deps } = setup({ encryption: true });
    expect(await runBackup(deps, { trigger: 'manuell' })).toBe(2);
    expect(readdirSync(target)).toEqual([]);
    const [run] = [...pg.runs.values()];
    expect(run?.state).toBe('fehler');
    expect(run?.error).toContain('age');
  });

  it('läuft schon eins: Exit 4 ohne eigene Zeile', async () => {
    const { pg, deps } = setup({ otherActive: 1 });
    expect(await runBackup(deps, { trigger: 'manuell' })).toBe(4);
    expect(pg.runs.size).toBe(0);
  });

  it('pg_dump scheitert: Zeile "fehler", kein halber Stand, Fehler ohne Passwort', async () => {
    const { target, pg, deps, errs } = setup();
    pg.dumpImpl = async () => {
      throw new Error(
        'pg_dump fehlgeschlagen: connection to postgres://sg:geheim-pw@127.0.0.1:5432/sg failed, password geheim-pw',
      );
    };
    expect(await runBackup(deps, { trigger: 'manuell' })).toBe(1);
    expect(readdirSync(target)).toEqual([]);
    const [run] = [...pg.runs.values()];
    expect(run?.state).toBe('fehler');
    expect(run?.error).not.toContain('geheim-pw');
    expect(run?.error).toContain('pg_dump fehlgeschlagen');
    expect(errs.join('\n')).not.toContain('geheim-pw');
  });

  it('nicht vorhandenes Ziel (Datenträger fehlt): Fehler, nichts angelegt', async () => {
    const { pg, deps } = setup();
    pg.target = join(tmp(), 'gibt-es-nicht', 'ziel');
    expect(await runBackup(deps, { trigger: 'manuell' })).toBe(1);
    expect([...pg.runs.values()][0]?.error).toContain('Datenträger');
  });

  it('dünnt nach dem Lauf aus: 20 Tage → höchstens die 14 Tagesstände plus ältere Stufen, der neue bleibt', async () => {
    const { target, deps } = setup();
    for (let day = 0; day < 20; day += 1) {
      const date = new Date(Date.UTC(2026, 9, 10 + day, 3, 0, 0));
      expect(await runBackup({ ...deps, now: () => date }, { trigger: 'zeitplan' })).toBe(0);
    }
    const stands = listStands(target);
    expect(stands[0]).toBe('20261029T030000Z');
    expect(stands.length).toBeLessThan(20);
    expect(stands.slice(0, 14)).toHaveLength(14);
    // Hardlinks: Alle verbliebenen Stände sind vollständig lesbar
    for (const stand of stands) {
      expect(readFileSync(join(target, stand, 'media', 'photos', 'a.jpg'), 'utf8')).toBe('JPEG');
    }
  });
});

describe('Ziel prüfen', () => {
  it('lehnt relative Pfade und Ziele in media/ oder vault/ ab', () => {
    const dataDir = tmp();
    expect(() => validateTarget('relativ/pfad', dataDir)).toThrow(/absolut/);
    expect(() => validateTarget(join(dataDir, 'media'), dataDir)).toThrow(/media/);
    expect(() => validateTarget(join(dataDir, 'vault', 'x'), dataDir)).toThrow(/vault/);
    // der ganze Datenordner ist gesperrt, auch backups/ darin
    mkdirSync(join(dataDir, 'backups'));
    expect(() => validateTarget(join(dataDir, 'backups'), dataDir)).toThrow(/Datenordner.*externe/s);
    expect(() => validateTarget(dataDir, dataDir)).toThrow(/Datenordner/);
  });
});

describe('Geheimnisse', () => {
  it('scrubSecrets maskiert Passwörter in URLs, PGPASSWORD und übergebene Geheimnisse', () => {
    expect(scrubSecrets('x postgres://sg:pw123@host/db y')).toBe('x postgres://sg:***@host/db y');
    expect(scrubSecrets('PGPASSWORD=abc docker')).toBe('PGPASSWORD=*** docker');
    expect(scrubSecrets('das passwort ist hunter2!', ['hunter2'])).toBe('das passwort ist ***!');
  });

  it('errorText entfernt Passwort und Datenordner', () => {
    const cfg = { dataDir: '/Users/x/StudienGehirn', databaseUrl: 'postgres://sg:p%40ss@127.0.0.1/sg' };
    const text = errorText(new Error('Fehler in /Users/x/StudienGehirn/media bei p@ss'), cfg);
    expect(text).toBe('Fehler in <SG_DATA_DIR>/media bei ***');
  });
});

describe('Argumente', () => {
  it('backup', () => {
    expect(parseBackupArgs([])).toEqual({ ok: true, trigger: 'manuell' });
    expect(
      parseBackupArgs([
        '--trigger',
        'zeitplan',
        '--run-id',
        '019a4e14-0000-7000-8000-0000000000aa',
        '--ziel',
        '/x',
      ]),
    ).toEqual({ ok: true, trigger: 'zeitplan', runId: '019a4e14-0000-7000-8000-0000000000aa', target: '/x' });
    expect(parseBackupArgs(['--trigger', 'x']).ok).toBe(false);
    expect(parseBackupArgs(['--run-id', 'nix']).ok).toBe(false);
    expect(parseBackupArgs(['--komisch']).ok).toBe(false);
  });
  it('restore', () => {
    expect(parseRestoreArgs([])).toEqual({ ok: true, test: false, yes: false });
    expect(parseRestoreArgs(['20261104T030012Z', '--ja'])).toEqual({
      ok: true,
      test: false,
      yes: true,
      stand: '20261104T030012Z',
    });
    expect(parseRestoreArgs(['--test']).ok).toBe(false);
    expect(parseRestoreArgs(['--test', 'a', '--ziel', '/z'])).toEqual({
      ok: true,
      test: true,
      yes: false,
      stand: 'a',
      target: '/z',
    });
    expect(parseRestoreArgs(['a', 'b']).ok).toBe(false);
  });

  it('restore --automatisch: nur Auslöser erlaubt, kein Stand und kein fremdes Ziel', () => {
    expect(parseRestoreArgs(['--automatisch'])).toEqual({ ok: true, auto: true, trigger: 'manuell' });
    expect(parseRestoreArgs(['--automatisch', '--trigger', 'zeitplan'])).toEqual({
      ok: true,
      auto: true,
      trigger: 'zeitplan',
    });
    expect(parseRestoreArgs(['--automatisch', '--trigger', 'vor_migration']).ok).toBe(false);
    expect(parseRestoreArgs(['--automatisch', '20261104T030012Z']).ok).toBe(false);
    expect(parseRestoreArgs(['--automatisch', '--ziel', '/fremd']).ok).toBe(false);
    expect(parseRestoreArgs(['--automatisch', '--test']).ok).toBe(false);
    expect(parseRestoreArgs(['--trigger', 'zeitplan']).ok).toBe(false);
  });
});

describe('Backup vor Migration', () => {
  const base = { log: () => {}, err: () => {} };
  function pgWith(rows: Record<string, string[][]>): PgAccess {
    return {
      mode: 'local',
      database: 'sg',
      async query(sql: string) {
        for (const [key, value] of Object.entries(rows)) if (sql.includes(key)) return value;
        return [];
      },
      async dump() {},
      async restore() {},
    };
  }

  it('neue Datenbank (keine Tabellen) und nichts Ausstehendes: kein Backup', async () => {
    let called = 0;
    const run = async () => ((called += 1), 0);
    expect(
      await preMigrationBackup({ ...base, pg: pgWith({ to_regclass: [['f', 'f']] }), journalCount: 4, run }),
    ).toBe('skipped');
    const pending = pgWith({ to_regclass: [['t', 't']], 'count(*) FROM drizzle': [['4']] });
    expect(await preMigrationBackup({ ...base, pg: pending, journalCount: 4, run })).toBe('skipped');
    expect(called).toBe(0);
  });

  it('ausstehende Migration ohne Ziel: Hinweis, Migration läuft', async () => {
    const warnings: string[] = [];
    const pg = pgWith({ to_regclass: [['t', 't']], 'count(*) FROM drizzle': [['3']] });
    const result = await preMigrationBackup({
      ...base,
      err: (m) => warnings.push(m),
      pg,
      journalCount: 4,
      run: async () => 0,
    });
    expect(result).toBe('skipped');
    expect(warnings.join()).toContain('ohne Backup');
  });

  it('ausstehende Migration mit Ziel: Backup mit vor_migration; scheitert es, wird die Migration abgebrochen', async () => {
    const pg = pgWith({
      to_regclass: [['t', 't']],
      'count(*) FROM drizzle': [['3']],
      "value->>'backup_target'": [['/ziel', 'false']],
    });
    const triggers: string[] = [];
    expect(
      await preMigrationBackup({ ...base, pg, journalCount: 4, run: async (t) => (triggers.push(t), 0) }),
    ).toBe('ok');
    expect(triggers).toEqual(['vor_migration']);
    expect(await preMigrationBackup({ ...base, pg, journalCount: 4, run: async () => 1 })).toBe('failed');
  });
});

describe('pg (Docker und lokal)', () => {
  const cfg = {
    databaseUrl: 'postgres://sg:geheim@127.0.0.1:5432/sg',
    composeFile: '/repo/infra/docker-compose.yml',
  };

  it('parseDatabaseUrl und safeIdent', () => {
    expect(parseDatabaseUrl('postgres://u%40:p%3A@h:1234/db1')).toEqual({
      host: 'h',
      port: '1234',
      user: 'u@',
      password: 'p:',
      database: 'db1',
    });
    expect(safeIdent('sg_restore_2026')).toBe('sg_restore_2026');
    expect(() => safeIdent('x; DROP DATABASE sg')).toThrow();
  });

  it('Docker: kein Passwort in den Argumenten, SQL über stdin, Dump in Datei', async () => {
    const calls: { cmd: string; args: string[]; options: unknown }[] = [];
    const exec: Exec = async (cmd, args, options) => {
      calls.push({ cmd, args, options });
      return { code: 0, stdout: 'a\x1fb\n', stderr: '' };
    };
    const pg = createPg(cfg, exec, 'docker');
    expect(await pg.query("SELECT :'x'", { x: '1' })).toEqual([['a', 'b']]);
    await pg.dump('/tmp/x.dump');
    const all = JSON.stringify(calls);
    expect(all).not.toContain('geheim');
    expect(calls[0]?.cmd).toBe('docker');
    expect(calls[0]?.args.slice(0, 6)).toEqual(['compose', '-f', cfg.composeFile, 'exec', '-T', 'db']);
    expect(calls[0]?.options).toMatchObject({ input: "SELECT :'x'" });
    expect(calls[1]?.args).toContain('pg_dump');
    expect(calls[1]?.options).toMatchObject({ stdoutFile: '/tmp/x.dump' });
  });

  it('lokal: Passwort nur in der Umgebung, Fehlermeldungen ohne Passwort', async () => {
    const calls: { cmd: string; args: string[]; options: { env?: Record<string, string | undefined> } }[] =
      [];
    const exec: Exec = async (cmd, args, options) => {
      calls.push({ cmd, args, options: options ?? {} });
      return {
        code: 1,
        stdout: '',
        stderr: 'FATAL: password authentication failed for postgres://sg:geheim@127.0.0.1',
      };
    };
    const pg = createPg(cfg, exec, 'local');
    await expect(pg.dump('/tmp/x')).rejects.toThrow(/Sicherung der Datenbank/);
    await expect(pg.dump('/tmp/x')).rejects.not.toThrow(/geheim/);
    expect(calls[0]?.options.env).toEqual({ PGPASSWORD: 'geheim' });
    expect(JSON.stringify(calls[0]?.args)).not.toContain('geheim');
  });

  it('lokal: pg_dump/pg_restore passend zur Server-Version suchen, sonst das Programm im PATH nehmen', async () => {
    const calls: { cmd: string; args: string[] }[] = [];
    const exec: Exec = async (cmd, args) => {
      calls.push({ cmd, args });
      // Server 99: keine passende Installation, also Rückfall auf den PATH
      return { code: 0, stdout: cmd === 'psql' ? '990000\n' : '', stderr: '' };
    };
    const pg = createPg(cfg, exec, 'local');
    await pg.dump('/tmp/x');
    await pg.restore('sg_x', '/tmp/x');
    expect(calls.map((c) => c.cmd)).toEqual(['psql', 'pg_dump', 'psql', 'pg_restore']);
    expect(calls[0]?.args).toContain('SHOW server_version_num');
    // Ohne lesbare Version (Fehler der Abfrage) ebenfalls PATH
    const calls2: string[] = [];
    const pg2 = createPg(
      cfg,
      async (cmd) => {
        calls2.push(cmd);
        return cmd === 'psql' ? { code: 2, stdout: '', stderr: 'x' } : { code: 0, stdout: '', stderr: '' };
      },
      'local',
    );
    await pg2.dump('/tmp/x');
    expect(calls2).toEqual(['psql', 'pg_dump']);
    // Keine reine Ziffernfolge: nicht in einen Pfad einsetzen, sondern PATH
    const calls3: string[] = [];
    const pg3 = createPg(
      cfg,
      async (cmd) => {
        calls3.push(cmd);
        return { code: 0, stdout: cmd === 'psql' ? '16/../../x\n' : '', stderr: '' };
      },
      'local',
    );
    await pg3.restore('sg_x', '/tmp/x');
    expect(calls3).toEqual(['psql', 'pg_restore']);
  });

  it('lokal: Werkzeug passt nicht zur Server-Version, dann nennt die Meldung die Version zum Installieren', async () => {
    const pg = createPg(
      cfg,
      async (cmd) =>
        cmd === 'psql'
          ? { code: 0, stdout: '990003\n', stderr: '' }
          : {
              code: 1,
              stdout: '',
              stderr:
                'pg_restore: error: could not execute query: ERROR:  unrecognized configuration parameter "transaction_timeout"',
            },
      'local',
    );
    await expect(pg.restore('sg_x', '/tmp/x')).rejects.toThrow(
      /brew install postgresql@99.*postgresql-client-99/,
    );
  });

  it('openPg wählt Docker, wenn der Container läuft, sonst lokal, sonst Fehler', async () => {
    const make =
      (dockerOut: string, local: number): Exec =>
      async (cmd) =>
        cmd === 'docker'
          ? { code: 0, stdout: dockerOut, stderr: '' }
          : { code: local, stdout: '', stderr: '' };
    expect((await openPg(cfg, make('abc123\n', 0), undefined)).mode).toBe('docker');
    expect((await openPg(cfg, make('', 0), undefined)).mode).toBe('local');
    await expect(openPg(cfg, make('', 127), undefined)).rejects.toThrow(/pg_dump/);
    expect((await openPg(cfg, make('', 127), 'local')).mode).toBe('local');
  });
});

// ---------------------------------------------------------------- Restore

function restoreSetup(over: Partial<FakePg> = {}) {
  const base = setup(over);
  const logs: string[] = [];
  const errs: string[] = [];
  const asked: string[] = [];
  const state = { running: [] as string[], answer: true };
  const deps: RestoreDeps = {
    cfg: base.deps.cfg,
    pg: base.pg,
    log: (m) => logs.push(m),
    err: (m) => errs.push(m),
    servicesRunning: async () => state.running,
    confirm: async (q) => (asked.push(q), state.answer),
    now: () => new Date('2026-11-10T08:00:00Z'),
    random: () => 'abc123',
  };
  return { ...base, deps, logs, errs, asked, state, backupDeps: base.deps };
}

describe('runRestore', () => {
  it('--test: Stand ohne eigenen Lauf in backup_run → Hinweis, geprüft wird nur gegen das Manifest', async () => {
    const s = restoreSetup();
    await runBackup(s.backupDeps, { trigger: 'manuell' });
    s.pg.runs.clear();
    expect(await runRestore(s.deps, { stand: '20261104T030012Z', test: true, yes: false })).toBe(0);
    expect(s.logs.join('\n')).toMatch(/keinen eigenen Backup-Lauf mit Prüfsumme/);
  });

  it('ohne Stand: listet die Stände', async () => {
    const s = restoreSetup();
    await runBackup(s.backupDeps, { trigger: 'manuell' });
    expect(await runRestore(s.deps, { test: false, yes: false })).toBe(0);
    expect(s.logs.join('\n')).toContain('20261104T030012Z');
  });

  it('--test: spielt in eine Wegwerf-Datenbank, zählt, löscht sie wieder; Dateien stimmen', async () => {
    const s = restoreSetup();
    await runBackup(s.backupDeps, { trigger: 'manuell' });
    const code = await runRestore(s.deps, { stand: '20261104T030012Z', test: true, yes: false });
    expect(code).toBe(0);
    const names = s.pg.restored.map((r) => r.db);
    expect(names).toEqual(['sg_restoretest_abc123']);
    const sqls = s.pg.queries.map((q) => q.sql);
    const create = sqls.findIndex((q) => q.includes('CREATE DATABASE sg_restoretest_abc123'));
    const drops = sqls
      .map((q, i) => (q.includes('DROP DATABASE IF EXISTS sg_restoretest_abc123') ? i : -1))
      .filter((i) => i >= 0);
    expect(create).toBeGreaterThan(-1);
    expect(drops.at(-1)).toBeGreaterThan(create);
    expect(s.logs.join('\n')).toContain('Test bestanden');
    expect(s.logs.join('\n')).toMatch(/semester\s+1/);
  });

  it('--test: Wegwerf-Datenbank wird auch bei einem Fehler gelöscht; Prüfsumme verhindert beschädigte Stände', async () => {
    const s = restoreSetup();
    await runBackup(s.backupDeps, { trigger: 'manuell' });
    s.pg.restoreImpl = async () => {
      throw new Error('pg_restore kaputt');
    };
    expect(await runRestore(s.deps, { stand: '20261104T030012Z', test: true, yes: false })).toBe(1);
    expect(s.pg.queries.some((q) => q.sql.includes('DROP DATABASE IF EXISTS sg_restoretest_abc123'))).toBe(
      true,
    );

    writeFileSync(join(s.target, '20261104T030012Z', 'db.dump'), 'verändert');
    const before = s.pg.restored.length;
    expect(await runRestore(s.deps, { stand: '20261104T030012Z', test: true, yes: false })).toBe(1);
    expect(s.pg.restored.length).toBe(before);
    expect(s.errs.join('\n')).toContain('Prüfsumme');
  });

  it('--test: fehlende Datei im Stand fällt auf', async () => {
    const s = restoreSetup();
    await runBackup(s.backupDeps, { trigger: 'manuell' });
    rmSync(join(s.target, '20261104T030012Z', 'media', 'photos', 'a.jpg'));
    expect(await runRestore(s.deps, { stand: '20261104T030012Z', test: true, yes: false })).toBe(1);
  });

  it('unbekannter oder ungültiger Stand: Fehler, nichts angefasst', async () => {
    const s = restoreSetup();
    expect(await runRestore(s.deps, { stand: '20300101T000000Z', test: false, yes: true })).toBe(1);
    expect(await runRestore(s.deps, { stand: '../etc', test: false, yes: true })).toBe(1);
    expect(s.pg.restored).toEqual([]);
  });

  it('vollständig: verweigert bei laufendem Core, fragt nach, tauscht Datenbank und Ordner, behält das Alte', async () => {
    const s = restoreSetup();
    await runBackup(s.backupDeps, { trigger: 'manuell' });
    // Daten ändern, die der Restore zurückholen soll
    writeFileSync(join(s.dataDir, 'vault', 'n.md'), '# nach dem Backup geändert');
    writeFileSync(join(s.dataDir, 'media', 'photos', 'neu.jpg'), 'neu');

    s.state.running = ['Core'];
    expect(await runRestore(s.deps, { stand: '20261104T030012Z', test: false, yes: true })).toBe(3);
    expect(s.pg.restored).toEqual([]);
    s.state.running = [];

    s.state.answer = false;
    expect(await runRestore(s.deps, { stand: '20261104T030012Z', test: false, yes: false })).toBe(1);
    expect(s.asked).toHaveLength(1);
    expect(s.pg.restored).toEqual([]);

    s.state.answer = true;
    expect(await runRestore(s.deps, { stand: '20261104T030012Z', test: false, yes: false })).toBe(0);
    const stamp = '20261110t080000z';
    // Eingespielt wird die geprüfte private Kopie im Datenordner, nie der Pfad im Ziel (B1)
    expect(s.pg.restored.map((r) => r.db)).toEqual([`sg_restore_${stamp}`]);
    expect(s.pg.restored[0]?.file.startsWith(join(s.dataDir, 'tmp'))).toBe(true);
    const sqls = s.pg.queries.map((q) => q.sql);
    const epoch = sqls.findIndex((q) => q.includes('SET db_epoch = gen_random_uuid()'));
    const swap = sqls.findIndex((q) => q.startsWith('BEGIN;'));
    expect(epoch).toBeGreaterThan(-1);
    expect(swap).toBeGreaterThan(epoch);
    // Beide Umbenennungen in EINER Transaktion
    expect(sqls[swap]).toContain(`ALTER DATABASE sg RENAME TO sg_vor_restore_${stamp};`);
    expect(sqls[swap]).toContain(`ALTER DATABASE sg_restore_${stamp} RENAME TO sg;`);
    expect(sqls[swap]).toMatch(/COMMIT;$/);
    expect(s.pg.queries[epoch]?.db).toBe(`sg_restore_${stamp}`);
    expect([...s.pg.databases].sort()).toEqual(['sg', `sg_vor_restore_${stamp}`]);
    expect(existsSync(join(s.dataDir, 'restore.journal.json'))).toBe(false);

    // Dateien: Stand wiederhergestellt, Altes daneben
    expect(readFileSync(join(s.dataDir, 'vault', 'n.md'), 'utf8')).toBe('# Notiz');
    expect(existsSync(join(s.dataDir, 'media', 'photos', 'neu.jpg'))).toBe(false);
    expect(readFileSync(join(s.dataDir, `vault.vor-restore-${stamp}`, 'n.md'), 'utf8')).toBe(
      '# nach dem Backup geändert',
    );
    expect(existsSync(join(s.dataDir, `media.vor-restore-${stamp}`, 'photos', 'neu.jpg'))).toBe(true);
    // Echte Kopien, keine Hardlinks ins Backup
    expect(lstatSync(join(s.dataDir, 'media', 'photos', 'a.jpg')).nlink).toBe(1);
    expect(readdirSync(s.dataDir).filter((n) => n.includes('.neu-'))).toEqual([]);
  });

  it('vollständig: scheitert der Datenbanktausch, werden Ordner und Datenbank zurückgebaut', async () => {
    const s = restoreSetup();
    await runBackup(s.backupDeps, { trigger: 'manuell' });
    writeFileSync(join(s.dataDir, 'vault', 'n.md'), '# aktuell');
    s.pg.renameFailsFor = 'ja';
    expect(await runRestore(s.deps, { stand: '20261104T030012Z', test: false, yes: true })).toBe(1);
    expect(readFileSync(join(s.dataDir, 'vault', 'n.md'), 'utf8')).toBe('# aktuell');
    expect(readdirSync(s.dataDir).filter((n) => n.includes('vor-restore') || n.includes('.neu-'))).toEqual(
      [],
    );
    expect([...s.pg.databases]).toEqual(['sg']);
    expect(existsSync(join(s.dataDir, 'restore.journal.json'))).toBe(false);
  });

  it('vollständig: Dateien weichen vom Manifest ab → nichts wird verändert', async () => {
    const s = restoreSetup();
    await runBackup(s.backupDeps, { trigger: 'manuell' });
    writeFileSync(join(s.target, '20261104T030012Z', 'media', 'photos', 'extra.jpg'), 'x');
    expect(await runRestore(s.deps, { stand: '20261104T030012Z', test: false, yes: true })).toBe(1);
    expect(s.pg.restored).toEqual([]);
    expect(s.errs.join('\n')).toContain('Manifest');
    expect(existsSync(join(s.dataDir, 'restore.journal.json'))).toBe(false);
  });

  it('.DS_Store im Stand und im Datenordner zählt nie', async () => {
    const s = restoreSetup();
    writeFileSync(join(s.dataDir, 'media', '.DS_Store'), 'x');
    await runBackup(s.backupDeps, { trigger: 'manuell' });
    writeFileSync(join(s.target, '20261104T030012Z', 'media', '.DS_Store'), 'y');
    expect(await runRestore(s.deps, { stand: '20261104T030012Z', test: true, yes: false })).toBe(0);
  });

  it('Schemaversion: neuerer Dump bricht ab, älterer ist erlaubt', async () => {
    const s = restoreSetup();
    const original = s.pg.query.bind(s.pg);
    s.pg.query = async (sql, vars, db) =>
      sql.includes('drizzle.__drizzle_migrations') && sql.includes('count')
        ? [['5']]
        : sql.includes("to_regclass('drizzle.__drizzle_migrations')")
          ? [['t']]
          : original(sql, vars, db);
    await runBackup(s.backupDeps, { trigger: 'manuell' });
    expect(readManifest(join(s.target, '20261104T030012Z'))?.migrations).toBe(5);

    expect(
      await runRestore(
        { ...s.deps, codeMigrations: 4 },
        { stand: '20261104T030012Z', test: false, yes: true },
      ),
    ).toBe(1);
    expect(s.errs.join('\n')).toContain('neueren Version');
    expect(s.pg.restored).toEqual([]);

    expect(
      await runRestore(
        { ...s.deps, codeMigrations: 6 },
        { stand: '20261104T030012Z', test: false, yes: true },
      ),
    ).toBe(0);
    expect(s.logs.join('\n')).toContain('älteres Schema');
  });

  it('Restore setzt den Quelllauf auf fertig, andere offene Läufe auf Fehler', async () => {
    const s = restoreSetup();
    await runBackup(s.backupDeps, { trigger: 'manuell' });
    await runRestore(s.deps, { stand: '20261104T030012Z', test: false, yes: true });
    const q = s.pg.queries.find((x) => x.sql.includes("THEN 'fertig' ELSE 'fehler'"));
    expect(q?.vars).toEqual({ stand: '20261104T030012Z' });
  });
});

describe('recoverRestore (Journal)', () => {
  function journalSetup(dbs: string[], swappedDirs: boolean) {
    const s = restoreSetup();
    s.pg.databases = new Set(dbs);
    const stamp = '20261110t080000z';
    const dirs = (['media', 'vault'] as const).map((name) => ({
      name,
      staged: join(s.dataDir, `${name}.neu-${stamp}`),
      previous: join(s.dataDir, `${name}.vor-restore-${stamp}`),
      hadLive: true,
    }));
    for (const d of dirs) {
      mkdirSync(d.staged, { recursive: true });
      writeFileSync(join(d.staged, 'neu.txt'), 'wiederhergestellt');
      if (swappedDirs) {
        renameSync(join(s.dataDir, d.name), d.previous);
        renameSync(d.staged, join(s.dataDir, d.name));
      }
    }
    writeFileSync(
      join(s.dataDir, 'restore.journal.json'),
      JSON.stringify({
        version: 1,
        stand: '20261104T030012Z',
        live: 'sg',
        fresh: `sg_restore_${stamp}`,
        old: `sg_vor_restore_${stamp}`,
        phase: 'swapping',
        dirs,
      }),
    );
    return { ...s, stamp };
  }

  it('Abbruch vor dem Datenbank-Commit mit getauschten Ordnern: alles zurück', async () => {
    const s = journalSetup(['sg', 'sg_restore_20261110t080000z'], true);
    expect(await recoverRestore(s.deps)).toBe('zurueckgebaut');
    expect(readFileSync(join(s.dataDir, 'vault', 'n.md'), 'utf8')).toBe('# Notiz');
    expect(readdirSync(s.dataDir).filter((n) => n.includes('.neu-') || n.includes('vor-restore'))).toEqual(
      [],
    );
    expect([...s.pg.databases]).toEqual(['sg']);
    expect(existsSync(join(s.dataDir, 'restore.journal.json'))).toBe(false);
    // Idempotent: ohne Journal passiert nichts
    expect(await recoverRestore(s.deps)).toBeNull();
  });

  it('Abbruch während des Kopierens (nichts getauscht): gestagte Ordner und neue Datenbank weg', async () => {
    const s = journalSetup(['sg', 'sg_restore_20261110t080000z'], false);
    expect(await recoverRestore(s.deps)).toBe('zurueckgebaut');
    expect(readFileSync(join(s.dataDir, 'vault', 'n.md'), 'utf8')).toBe('# Notiz');
    expect([...s.pg.databases]).toEqual(['sg']);
  });

  it('Abbruch nach dem Datenbank-Commit, Ordner noch nicht getauscht: wird abgeschlossen', async () => {
    const s = journalSetup(['sg', 'sg_vor_restore_20261110t080000z'], false);
    expect(await recoverRestore(s.deps)).toBe('abgeschlossen');
    expect(readFileSync(join(s.dataDir, 'vault', 'neu.txt'), 'utf8')).toBe('wiederhergestellt');
    expect(readFileSync(join(s.dataDir, `vault.vor-restore-${s.stamp}`, 'n.md'), 'utf8')).toBe('# Notiz');
    expect(existsSync(join(s.dataDir, 'restore.journal.json'))).toBe(false);
  });

  it('Abbruch zwischen zwei Ordner-Umbenennungen (Live-Ordner fehlt kurz): wird zurückgebaut', async () => {
    const s = journalSetup(['sg', 'sg_restore_20261110t080000z'], false);
    renameSync(join(s.dataDir, 'media'), join(s.dataDir, `media.vor-restore-${s.stamp}`));
    expect(await recoverRestore(s.deps)).toBe('zurueckgebaut');
    expect(readFileSync(join(s.dataDir, 'media', 'photos', 'a.jpg'), 'utf8')).toBe('JPEG');
  });

  it('Rückbau über runRestore hält core.lock und gibt sie danach frei; fremde lebende PID bricht ab', async () => {
    const s = journalSetup(['sg', 'sg_restore_20261110t080000z'], false);
    const lockPath = join(s.dataDir, 'run', 'core.lock');
    let heldDuring: string | null = null;
    const deps: RestoreDeps = {
      ...s.deps,
      holdLock: () => {
        const lock = acquireCoreLock(s.dataDir);
        heldDuring = readFileSync(lockPath, 'utf8');
        return lock;
      },
    };
    expect(await runRestore(deps, { stand: '20261104T030012Z', test: false, yes: true })).toBe(0);
    expect(heldDuring).toBe(`${process.pid}\n`);
    expect(existsSync(lockPath)).toBe(false);

    // Zweiter Versuch mit offenem Journal, aber fremdem Core: nichts wird zurückgebaut
    const s2 = journalSetup(['sg', 'sg_restore_20261110t080000z'], false);
    const foreign = livingChild();
    mkdirSync(join(s2.dataDir, 'run'), { recursive: true });
    writeFileSync(join(s2.dataDir, 'run', 'core.lock'), `${foreign}\n`);
    const deps2: RestoreDeps = { ...s2.deps, holdLock: () => acquireCoreLock(s2.dataDir) };
    expect(await runRestore(deps2, { stand: '20261104T030012Z', test: false, yes: true })).toBe(3);
    expect(existsSync(join(s2.dataDir, 'restore.journal.json'))).toBe(true);
    expect([...s2.pg.databases].sort()).toEqual(['sg', 'sg_restore_20261110t080000z']);
  });
});

const spawned: ChildProcess[] = [];
afterEach(() => {
  for (const c of spawned.splice(0)) c.kill('SIGKILL');
});

/** Ein lebender fremder Prozess (PID) */
function livingChild(): number {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  spawned.push(child);
  return child.pid as number;
}

/** PID eines beendeten Prozesses */
function deadChildPid(): number {
  return spawnSync(process.execPath, ['-e', '0']).pid;
}

describe('vollständiger Restore hält core.lock (#316)', () => {
  function lockSetup() {
    const s = restoreSetup();
    const lockPath = join(s.dataDir, 'run', 'core.lock');
    const seen: Array<string | null> = [];
    const deps: RestoreDeps = {
      ...s.deps,
      holdLock: () => acquireCoreLock(s.dataDir),
      confirm: async (q) => {
        // Die Rückfrage läuft schon unter der Sperre
        seen.push(existsSync(lockPath) ? readFileSync(lockPath, 'utf8') : null);
        return s.deps.confirm(q);
      },
    };
    return { ...s, deps, lockPath, seen };
  }

  it('Erfolg: Sperre mit eigener PID während des Restores, danach frei', async () => {
    const s = lockSetup();
    await runBackup(s.backupDeps, { trigger: 'manuell' });
    expect(await runRestore(s.deps, { stand: '20261104T030012Z', test: false, yes: false })).toBe(0);
    expect(s.seen).toEqual([`${process.pid}\n`]);
    expect(existsSync(s.lockPath)).toBe(false);
    expect(readdirSync(join(s.dataDir, 'run'))).toEqual([]);
  });

  it('Fehler beim Tausch: Sperre wird trotzdem freigegeben', async () => {
    const s = lockSetup();
    await runBackup(s.backupDeps, { trigger: 'manuell' });
    s.pg.renameFailsFor = 'ja';
    expect(await runRestore(s.deps, { stand: '20261104T030012Z', test: false, yes: true })).toBe(1);
    expect(existsSync(s.lockPath)).toBe(false);
  });

  it('Abbruch bei der Rückfrage ("nein"): Sperre frei', async () => {
    const s = lockSetup();
    await runBackup(s.backupDeps, { trigger: 'manuell' });
    s.state.answer = false;
    expect(await runRestore(s.deps, { stand: '20261104T030012Z', test: false, yes: false })).toBe(1);
    expect(existsSync(s.lockPath)).toBe(false);
  });

  it('Ausnahme mitten im Restore: Sperre frei', async () => {
    const s = lockSetup();
    await runBackup(s.backupDeps, { trigger: 'manuell' });
    const deps: RestoreDeps = { ...s.deps, confirm: async () => Promise.reject(new Error('Abbruch')) };
    expect(await runRestore(deps, { stand: '20261104T030012Z', test: false, yes: false })).toBe(1);
    expect(existsSync(s.lockPath)).toBe(false);
  });

  it('fremde lebende PID in der Sperrdatei: Abbruch mit der Meldung für laufenden Core, Datei unverändert', async () => {
    const s = lockSetup();
    await runBackup(s.backupDeps, { trigger: 'manuell' });
    const foreign = livingChild();
    mkdirSync(join(s.dataDir, 'run'), { recursive: true });
    writeFileSync(s.lockPath, `${foreign}\n`);
    expect(await runRestore(s.deps, { stand: '20261104T030012Z', test: false, yes: true })).toBe(3);
    expect(s.errs.join('\n')).toContain('Core läuft noch. Zuerst "pnpm sg stop" ausführen');
    expect(s.pg.restored).toEqual([]);
    expect(readFileSync(s.lockPath, 'utf8')).toBe(`${foreign}\n`); // eine fremde Datei wird nie gelöscht
  });

  it('tote PID in der Sperrdatei: wird übernommen, Restore läuft, danach ist die Datei weg', async () => {
    const s = lockSetup();
    await runBackup(s.backupDeps, { trigger: 'manuell' });
    mkdirSync(join(s.dataDir, 'run'), { recursive: true });
    writeFileSync(s.lockPath, `${deadChildPid()}\n`);
    expect(await runRestore(s.deps, { stand: '20261104T030012Z', test: false, yes: true })).toBe(0);
    expect(existsSync(s.lockPath)).toBe(false);
  });

  it('ohne Sperrfehler: Prüfungen vor der Sperre (laufender Core) berühren die Datei nicht', async () => {
    const s = lockSetup();
    await runBackup(s.backupDeps, { trigger: 'manuell' });
    s.state.running = ['Core'];
    expect(await runRestore(s.deps, { stand: '20261104T030012Z', test: false, yes: true })).toBe(3);
    expect(existsSync(s.lockPath)).toBe(false);
  });

  it('--test braucht die Sperre nicht (läuft auch bei laufendem Core)', async () => {
    const s = lockSetup();
    await runBackup(s.backupDeps, { trigger: 'manuell' });
    const foreign = livingChild();
    mkdirSync(join(s.dataDir, 'run'), { recursive: true });
    writeFileSync(s.lockPath, `${foreign}\n`);
    expect(await runRestore(s.deps, { stand: '20261104T030012Z', test: true, yes: false })).toBe(0);
    expect(readFileSync(s.lockPath, 'utf8')).toBe(`${foreign}\n`);
  });

  it('Meldung: blockiert nur die Sperrdatei, verweist sie zusätzlich auf "pnpm sg doctor"', async () => {
    const s = lockSetup();
    await runBackup(s.backupDeps, { trigger: 'manuell' });
    s.state.running = ['Core'];
    const deps: RestoreDeps = { ...s.deps, lockOnly: async () => true };
    expect(await runRestore(deps, { stand: '20261104T030012Z', test: false, yes: true })).toBe(3);
    const msg = s.errs.join('\n');
    expect(msg).toContain('Zuerst "pnpm sg stop" ausführen');
    expect(msg).toContain('pnpm sg doctor');
  });

  it('Meldung: andere Fälle behalten den bisherigen Wortlaut ohne doctor-Hinweis', async () => {
    const s = lockSetup();
    await runBackup(s.backupDeps, { trigger: 'manuell' });
    s.state.running = ['Core'];
    const deps: RestoreDeps = { ...s.deps, lockOnly: async () => false };
    expect(await runRestore(deps, { stand: '20261104T030012Z', test: false, yes: true })).toBe(3);
    expect(s.errs.join('\n')).not.toContain('doctor');
    expect(s.errs.join('\n')).toBe(
      'Core läuft noch. Zuerst "pnpm sg stop" ausführen, die Wiederherstellung braucht stillstehende Daten.',
    );
  });

  it('Meldung: scheitert das Belegen der Datei und nur sie blockiert, kommt der doctor-Hinweis', async () => {
    const s = lockSetup();
    await runBackup(s.backupDeps, { trigger: 'manuell' });
    const foreign = livingChild();
    mkdirSync(join(s.dataDir, 'run'), { recursive: true });
    writeFileSync(s.lockPath, `${foreign}\n`);
    const deps: RestoreDeps = { ...s.deps, lockOnly: async () => true };
    expect(await runRestore(deps, { stand: '20261104T030012Z', test: false, yes: true })).toBe(3);
    expect(s.errs.join('\n')).toContain('pnpm sg doctor');
  });
});

describe('Ziel prüfen: gemeinsame Regeln mit dem Core', () => {
  it('lehnt Systemordner ab', () => {
    const dataDir = tmp();
    expect(() => validateTarget('/proc', dataDir)).toThrow(/System/);
    expect(() => validateTarget('/dev/shm', dataDir)).toThrow(/System/);
  });

  it('legt fehlenden Zielordner an, wenn der Elternordner existiert; sonst Fehler', () => {
    const dataDir = tmp();
    const parent = tmp();
    expect(validateTarget(join(parent, 'neu'), dataDir).path).toBe(join(realpathSync(parent), 'neu'));
    expect(() => validateTarget(join(parent, 'a', 'b'), dataDir)).toThrow(/nicht vorhanden/);
  });

  it('löst Symlinks auf: Ergebnis ist der echte Pfad', () => {
    const dataDir = tmp();
    const real = tmp();
    const link = join(tmp(), 'link');
    symlinkSync(real, link);
    expect(validateTarget(link, dataDir).path).toBe(realpathSync(real));
  });

  it('lehnt eine Datei als Ziel ab', () => {
    const file = join(tmp(), 'datei');
    writeFileSync(file, 'x');
    expect(() => validateTarget(file, tmp())).toThrow(/kein Ordner/);
  });
});

describe('Backup: Robustheit', () => {
  it('Symlink als Ziel auf media/ wird abgelehnt', () => {
    const dataDir = tmp();
    mkdirSync(join(dataDir, 'media'));
    const link = join(tmp(), 'ziel-link');
    symlinkSync(join(dataDir, 'media'), link);
    expect(() => validateTarget(link, dataDir)).toThrow(/media/);
    // auch ein Unterordner hinter dem Link
    mkdirSync(join(dataDir, 'media', 'x'));
    expect(() => validateTarget(join(link, 'x'), dataDir)).toThrow(/media/);
  });

  it('Dateien, die beim Kopieren verschwinden, werden übersprungen und gezählt', () => {
    const root = tmp();
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'a.txt'), 'A');
    writeFileSync(join(root, 'src', 'weg.txt'), 'W');
    const stats = copyTree(join(root, 'src'), join(root, 'dst'), null, undefined, {
      beforeCopy: (path) => path.endsWith('weg.txt') && rmSync(path),
    });
    expect(stats).toMatchObject({ files: 1, bytes: 1, vanished: 1 });
    expect(existsSync(join(root, 'dst', 'weg.txt'))).toBe(false);
    // treeSize eines verschwundenen Ordners wirft nicht
    expect(treeSize(join(root, 'gibt-es-nicht'))).toEqual({ files: 0, bytes: 0 });
  });

  it('die letzten 3 vor_migration-Stände bleiben trotz Ausdünnung', async () => {
    const s = setup();
    // 6 Migrations-Stände an 6 Tagen weit in der Vergangenheit (alle würden sonst ausgedünnt), dazu 14 neuere tägliche
    for (let i = 0; i < 6; i += 1) {
      const date = new Date(Date.UTC(2025, 0, 1 + i * 40, 3));
      expect(await runBackup({ ...s.deps, now: () => date }, { trigger: 'vor_migration' })).toBe(0);
    }
    for (let i = 0; i < 20; i += 1) {
      const date = new Date(Date.UTC(2026, 9, 1 + i, 3));
      expect(await runBackup({ ...s.deps, now: () => date }, { trigger: 'zeitplan' })).toBe(0);
    }
    const migStands = listStands(s.target).filter(
      (st) => readManifest(join(s.target, st))?.trigger === 'vor_migration',
    );
    expect(migStands.length).toBeGreaterThanOrEqual(3);
    // Die 3 neuesten Migrations-Stände sind alle noch da
    for (const i of [3, 4, 5]) {
      const stand = standName(new Date(Date.UTC(2025, 0, 1 + i * 40, 3)));
      expect(existsSync(join(s.target, stand)), stand).toBe(true);
    }
  });
});

describe('Backup vor der Migration ist fail-closed', () => {
  it('ohne Docker und pg_dump wird nicht migriert (Hinweis auf --ohne-backup)', async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((m: string) => void errors.push(m));
    const exec: Exec = async () => ({ code: 127, stdout: '', stderr: 'nicht gefunden' });
    const cfg = resolveConfig({ SG_DATA_DIR: tmp() }, '/h', '/repo');
    expect(await backupBeforeMigrate(cfg, exec)).toBe(false);
    spy.mockRestore();
    expect(errors.join('\n')).toContain('--ohne-backup');
    expect(errors.join('\n')).toContain('nicht ausgeführt');
  });
});

describe('Schreibgeschütztes Backup-Ziel (read-only NAS, Snapshot, Stick)', () => {
  async function readOnlyAfterBackup() {
    const s = restoreSetup();
    expect(await runBackup(s.backupDeps, { trigger: 'zeitplan' })).toBe(0);
    readOnlyDirs.add(realpathSync(s.target));
    return s;
  }

  it('sg backup scheitert weiter an einem nicht beschreibbaren Ziel', async () => {
    const s = restoreSetup();
    readOnlyDirs.add(realpathSync(s.target));
    expect(() => validateTarget(s.target, s.dataDir)).toThrow(/nicht beschreibbar/);
    expect(await runBackup(s.backupDeps, { trigger: 'manuell' })).toBe(1);
  });

  it('validateTarget ohne Schreibprüfung akzeptiert das Ziel, die übrigen Prüfungen bleiben', () => {
    const s = restoreSetup();
    readOnlyDirs.add(realpathSync(s.target));
    expect(validateTarget(s.target, s.dataDir, false, false).path).toBe(realpathSync(s.target));
    expect(() => validateTarget('relativ/pfad', s.dataDir, false, false)).toThrow(/absolut/);
    expect(() => validateTarget(join(s.dataDir, 'media'), s.dataDir, false, false)).toThrow(/media/);
    expect(() => validateTarget(join(s.target, 'fehlt'), s.dataDir, false, false)).toThrow(/nicht vorhanden/);
  });

  it('sg restore --test und vollständig laufen von einem schreibgeschützten Ziel', async () => {
    const s = await readOnlyAfterBackup();
    expect(await runRestore(s.deps, { stand: '20261104T030012Z', test: true, yes: false })).toBe(0);
    expect(await runRestore(s.deps, { test: false, yes: false })).toBe(0);
    expect(s.errs).toEqual([]);
  });

  it('der Monatstest läuft von einem schreibgeschützten Ziel', async () => {
    const s = await readOnlyAfterBackup();
    expect(await runAutoRestoreTest(s.deps, { trigger: 'zeitplan' })).toBe(0);
    expect(s.pg.testResult).toMatchObject({ state: 'ok' });
  });
});

describe('Automatischer Restore-Test (F-DAT-02)', () => {
  const STAND = '20261104T030012Z';

  async function prepared(over: Partial<FakePg> = {}) {
    const s = restoreSetup(over);
    expect(await runBackup(s.backupDeps, { trigger: 'zeitplan' })).toBe(0);
    return s;
  }
  const dropsOf = (pg: FakePg) =>
    pg.queries.filter((q) => q.sql.startsWith('DROP DATABASE IF EXISTS sg_autotest_')).length;

  it('eigener Stand: Test bestanden, Ergebnis gespeichert, Wegwerf-Datenbank wieder gelöscht', async () => {
    const s = await prepared();
    expect(await runAutoRestoreTest(s.deps, { trigger: 'zeitplan' })).toBe(0);
    expect(s.pg.restored.map((r) => r.db)).toEqual(['sg_autotest_abc123']);
    expect(s.pg.databases.has('sg_autotest_abc123')).toBe(false);
    expect(s.pg.testResult).toMatchObject({
      state: 'ok',
      trigger: 'zeitplan',
      stand: STAND,
      is_latest: true,
      reason: null,
      error: null,
      finished_at: '2026-11-10T08:00:00.000Z',
    });
  });

  it('pg_restore scheitert: Ergebnis "fehler", Datenbank trotzdem gelöscht, Text ohne Passwort', async () => {
    const s = await prepared();
    s.pg.restoreImpl = async () => {
      throw new Error('kaputt postgres://sg:geheim-pw@127.0.0.1/sg');
    };
    expect(await runAutoRestoreTest(s.deps, { trigger: 'manuell' })).toBe(1);
    expect(s.pg.databases.has('sg_autotest_abc123')).toBe(false);
    expect(s.pg.testResult).toMatchObject({
      state: 'fehler',
      reason: 'restore_fehlgeschlagen',
      stand: STAND,
    });
    expect(JSON.stringify(s.pg.testResult)).not.toContain('geheim-pw');
  });

  it('fremder Stand ohne Lauf-Eintrag wird nie eingespielt', async () => {
    const s = await prepared();
    s.pg.runs.clear(); // der Stand liegt im Ziel, aber es gibt keinen eigenen Lauf dazu
    expect(await runAutoRestoreTest(s.deps, { trigger: 'zeitplan' })).toBe(1);
    expect(s.pg.restored).toEqual([]);
    expect(s.pg.testResult).toMatchObject({ state: 'fehler', reason: 'kein_backup' });
  });

  it('Lauf ohne Prüfsumme (Altbestand) und Lauf für anderes Ziel zählen nicht', async () => {
    const s = await prepared();
    for (const run of s.pg.runs.values()) run.sha = null;
    expect(await runAutoRestoreTest(s.deps, { trigger: 'zeitplan' })).toBe(1);
    expect(s.pg.testResult).toMatchObject({ reason: 'kein_backup' });
    for (const run of s.pg.runs.values()) Object.assign(run, { sha: 'a'.repeat(64), target: '/anderes' });
    expect(await runAutoRestoreTest(s.deps, { trigger: 'zeitplan' })).toBe(1);
    expect(s.pg.restored).toEqual([]);
  });

  it('erfundenes Manifest samt passendem Dump: Prüfsumme weicht vom Lauf-Eintrag ab, nichts wird eingespielt', async () => {
    const s = await prepared();
    const dir = join(s.target, STAND);
    writeFileSync(join(dir, 'db.dump'), 'PGDMP-boese');
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as {
      dump: { sha256: string; bytes: number };
    };
    manifest.dump.sha256 = createHash('sha256').update('PGDMP-boese').digest('hex');
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
    expect(await runAutoRestoreTest(s.deps, { trigger: 'zeitplan' })).toBe(1);
    expect(s.pg.restored).toEqual([]);
    expect(s.pg.testResult).toMatchObject({ state: 'fehler', reason: 'nicht_authentisch', stand: STAND });
  });

  it('beschädigter Dump (Manifest stimmt, Datei nicht): "beschaedigt"', async () => {
    const s = await prepared();
    writeFileSync(join(s.target, STAND, 'db.dump'), 'verändert');
    expect(await runAutoRestoreTest(s.deps, { trigger: 'zeitplan' })).toBe(1);
    expect(s.pg.restored).toEqual([]);
    expect(s.pg.testResult).toMatchObject({ reason: 'beschaedigt' });
  });

  it('fehlende Datei in media/: "dateien_abweichend"', async () => {
    const s = await prepared();
    rmSync(join(s.target, STAND, 'media', 'photos', 'a.jpg'));
    expect(await runAutoRestoreTest(s.deps, { trigger: 'zeitplan' })).toBe(1);
    expect(s.pg.testResult).toMatchObject({ reason: 'dateien_abweichend' });
    expect(s.pg.databases.has('sg_autotest_abc123')).toBe(false);
  });

  it('Stand fehlt im Ziel: ältere eigene Stände werden versucht, sonst "kein_backup"', async () => {
    const s = await prepared();
    rmSync(join(s.target, STAND), { recursive: true });
    expect(await runAutoRestoreTest(s.deps, { trigger: 'zeitplan' })).toBe(1);
    expect(s.pg.testResult).toMatchObject({ reason: 'kein_backup' });
  });

  it('ohne Backup-Ziel und mit nicht erreichbarem Ziel', async () => {
    const s = await prepared();
    Object.assign(s.pg, { target: null });
    expect(await runAutoRestoreTest(s.deps, { trigger: 'zeitplan' })).toBe(1);
    expect(s.pg.testResult).toMatchObject({ reason: 'kein_ziel' });
    s.pg.target = join(s.target, 'gibt-es-nicht', 'tief');
    expect(await runAutoRestoreTest(s.deps, { trigger: 'zeitplan' })).toBe(1);
    expect(s.pg.testResult).toMatchObject({ reason: 'ziel_nicht_erreichbar' });
  });

  it('is_latest: false, wenn der jüngste Lauf keinen Stand mehr im Ziel hat (älterer wird getestet)', async () => {
    const s = await prepared();
    const newer = '019a4e14-0000-7000-8000-0000000000cc';
    s.pg.runs.set(newer, {
      id: newer,
      state: 'fertig',
      error: null,
      stand: '20261105T030000Z',
      size: '1',
      sha: 'b'.repeat(64),
      trigger: 'zeitplan',
      target: s.pg.target as string,
    });
    expect(await runAutoRestoreTest(s.deps, { trigger: 'zeitplan' })).toBe(0);
    expect(s.pg.testResult).toMatchObject({ state: 'ok', stand: STAND, is_latest: false });
  });

  /**
   * B1 (TOCTOU): Zwischen Prüfsumme und `pg_restore` tauscht ein Angreifer die Datei im Ziel aus. Eingespielt werden
   * muss die geprüfte, private Kopie, nie der Pfad im Ziel.
   */
  async function swapDuringRestore(s: Awaited<ReturnType<typeof prepared>>) {
    const seen: { path: string; content: string; fileMode: number; dirMode: number; inTarget: boolean }[] =
      [];
    const targetDump = join(s.target, STAND, 'db.dump');
    const original = readFileSync(targetDump, 'utf8');
    s.pg.restoreImpl = async (_db, file) => {
      writeFileSync(targetDump, 'EVIL-DUMP'); // Angreifer, kurz bevor pg_restore die Datei öffnet
      seen.push({
        path: file,
        content: readFileSync(file, 'utf8'),
        fileMode: statSync(file).mode & 0o777,
        dirMode: statSync(dirname(file)).mode & 0o777,
        inTarget: file.startsWith(s.target),
      });
    };
    return { seen, original, targetDump };
  }

  it('B1: automatischer Test spielt die geprüfte private Kopie ein, nicht den (ausgetauschten) Pfad im Ziel', async () => {
    const s = await prepared();
    const { seen, original } = await swapDuringRestore(s);
    expect(await runAutoRestoreTest(s.deps, { trigger: 'zeitplan' })).toBe(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.content).toBe(original);
    expect(seen[0]?.inTarget).toBe(false);
    expect(seen[0]?.path.startsWith(join(s.dataDir, 'tmp'))).toBe(true);
    expect(seen[0]?.fileMode).toBe(0o600);
    expect(seen[0]?.dirMode).toBe(0o700);
    // Die Kopie ist danach gelöscht
    expect(existsSync(dirname(seen[0]?.path as string))).toBe(false);
  });

  it('B1: dasselbe bei `restore --test <stand>` von Hand', async () => {
    const s = await prepared();
    const { seen, original } = await swapDuringRestore(s);
    expect(await runRestore(s.deps, { stand: STAND, test: true, yes: false })).toBe(0);
    expect(seen[0]?.content).toBe(original);
    expect(seen[0]?.inTarget).toBe(false);
  });

  it('B1: dasselbe beim vollständigen `restore <stand>`', async () => {
    const s = await prepared();
    const { seen, original } = await swapDuringRestore(s);
    expect(await runRestore(s.deps, { stand: STAND, test: false, yes: true })).toBe(0);
    expect(seen[0]?.content).toBe(original);
    expect(seen[0]?.inTarget).toBe(false);
    expect(existsSync(dirname(seen[0]?.path as string))).toBe(false);
  });

  it('B1: Austausch VOR dem Kopieren: Prüfsumme der Kopie stimmt nicht, pg_restore wird nie aufgerufen, Kopie weg', async () => {
    const s = await prepared();
    writeFileSync(join(s.target, STAND, 'db.dump'), 'EVIL-DUMP');
    expect(await runAutoRestoreTest(s.deps, { trigger: 'zeitplan' })).toBe(1);
    expect(s.pg.restored).toEqual([]);
    expect(s.pg.testResult).toMatchObject({ reason: 'beschaedigt' });
    const stage = join(s.dataDir, 'tmp');
    expect(existsSync(stage) ? readdirSync(stage) : []).toEqual([]);
  });

  it('B1: die private Kopie wird auch bei einem Fehler von pg_restore gelöscht', async () => {
    const s = await prepared();
    s.pg.restoreImpl = async () => {
      throw new Error('kaputt');
    };
    expect(await runAutoRestoreTest(s.deps, { trigger: 'zeitplan' })).toBe(1);
    const stage = join(s.dataDir, 'tmp');
    expect(existsSync(stage) ? readdirSync(stage) : []).toEqual([]);
  });

  it('räumt übrig gebliebene Wegwerf-Datenbanken eines abgestürzten Tests auf', async () => {
    const s = await prepared();
    s.pg.databases.add('sg_autotest_alt999');
    s.pg.leftovers = ['sg_autotest_alt999'];
    expect(await runAutoRestoreTest(s.deps, { trigger: 'zeitplan' })).toBe(0);
    expect(s.pg.databases.has('sg_autotest_alt999')).toBe(false);
    expect(dropsOf(s.pg)).toBeGreaterThan(1);
  });
});

describe('Backup-Ziel ohne Symlink-Folgen (#113)', () => {
  const STAND = '20261104T030012Z';
  const PARTIAL = `.${STAND}.partial`;
  function outside(): { dir: string; file: string } {
    const dir = join(tmp(), 'benutzer');
    mkdirSync(dir);
    const file = join(dir, 'wichtig.txt');
    writeFileSync(file, 'GEHEIM');
    return { dir, file };
  }

  it('.partial/manifest.json als Symlink auf eine fremde Datei: wird nicht überschrieben, Lauf scheitert, Eigenes weg', async () => {
    const { pg, deps, target, errs } = setup();
    const { file } = outside();
    pg.dumpImpl = async (f) => {
      writeFileSync(f, 'PGDMP-x');
      symlinkSync(file, join(target, PARTIAL, 'manifest.json'));
    };
    expect(await runBackup(deps, { trigger: 'manuell' })).toBe(1);
    expect(readFileSync(file, 'utf8')).toBe('GEHEIM');
    expect([...pg.runs.values()][0]).toMatchObject({ state: 'fehler', sha: null });
    expect(existsSync(join(target, STAND))).toBe(false);
    // Aufgeräumt wurde nur Eigenes: db.dump, media/ und vault/ sind weg, der fremde Link bleibt liegen
    expect(readdirSync(join(target, PARTIAL))).toEqual(['manifest.json']);
    expect(lstatSync(join(target, PARTIAL, 'manifest.json')).isSymbolicLink()).toBe(true);
    expect(errs.join('\n')).toContain('liegen');
  });

  it('.partial/db.dump als Symlink: Lauf scheitert, fremde Datei unverändert', async () => {
    const { pg, deps, target } = setup();
    const { file } = outside();
    pg.dumpImpl = async (f) => {
      writeFileSync(f, 'PGDMP-x');
      symlinkSync(file, join(target, PARTIAL, 'db.dump'));
    };
    expect(await runBackup(deps, { trigger: 'manuell' })).toBe(1);
    expect(readFileSync(file, 'utf8')).toBe('GEHEIM');
  });

  it('vorhandenes .partial (auch als Symlink auf einen fremden Ordner): Lauf scheitert, nichts gelöscht oder geschrieben', async () => {
    const { pg, deps, target } = setup();
    const { dir, file } = outside();
    symlinkSync(dir, join(target, PARTIAL));
    expect(await runBackup(deps, { trigger: 'manuell' })).toBe(1);
    expect(readdirSync(dir)).toEqual(['wichtig.txt']);
    expect(readFileSync(file, 'utf8')).toBe('GEHEIM');
    expect(lstatSync(join(target, PARTIAL)).isSymbolicLink()).toBe(true);
    expect([...pg.runs.values()][0]?.state).toBe('fehler');
  });

  it('.partial wird während des Laufs gegen einen Symlink getauscht: nichts landet außerhalb, nichts wird dort gelöscht', async () => {
    const { pg, deps, target } = setup();
    const { dir } = outside();
    mkdirSync(join(dir, 'media'));
    writeFileSync(join(dir, 'db.dump'), 'BENUTZER');
    pg.dumpImpl = async (f) => {
      writeFileSync(f, 'PGDMP-x');
      renameSync(join(target, PARTIAL), join(target, 'versteckt'));
      symlinkSync(dir, join(target, PARTIAL));
    };
    expect(await runBackup(deps, { trigger: 'manuell' })).toBe(1);
    expect(readdirSync(dir).sort()).toEqual(['db.dump', 'media', 'wichtig.txt']);
    expect(readFileSync(join(dir, 'db.dump'), 'utf8')).toBe('BENUTZER');
    expect(readdirSync(join(dir, 'media'))).toEqual([]);
  });

  it('media/ im .partial wird vor dem Kopieren durch einen Symlink ersetzt: Lauf scheitert, fremder Ordner unverändert', async () => {
    const { pg, deps, target, dataDir } = setup();
    const { dir } = outside();
    writeFileSync(join(dataDir, 'media', 'wichtig.txt'), 'BACKUP-INHALT');
    pg.dumpImpl = async (f) => {
      writeFileSync(f, 'PGDMP-x');
      symlinkSync(dir, join(target, PARTIAL, 'media'));
    };
    expect(await runBackup(deps, { trigger: 'manuell' })).toBe(1);
    expect(readFileSync(join(dir, 'wichtig.txt'), 'utf8')).toBe('GEHEIM');
    expect(readdirSync(dir)).toEqual(['wichtig.txt']);
  });

  it('Stand gleichen Namens existiert schon (auch als Symlink): Fehler, nichts angefasst', async () => {
    const { pg, deps, target } = setup();
    const { dir } = outside();
    symlinkSync(dir, join(target, STAND));
    expect(await runBackup(deps, { trigger: 'manuell' })).toBe(1);
    expect(readdirSync(dir)).toEqual(['wichtig.txt']);
    expect(existsSync(join(target, PARTIAL))).toBe(false);
    expect([...pg.runs.values()][0]?.state).toBe('fehler');
  });

  it('Hardlink-Quelle im vorigen Stand ist ein Symlink: nicht verlinkt, sondern kopiert', async () => {
    const { deps, target } = setup();
    expect(await runBackup(deps, { trigger: 'zeitplan' })).toBe(0);
    const { file } = outside();
    const prev = join(target, STAND, 'vault', 'n.md');
    rmSync(prev);
    symlinkSync(file, prev);
    const second = { ...deps, now: () => new Date('2026-11-05T03:00:00Z') };
    expect(await runBackup(second, { trigger: 'zeitplan' })).toBe(0);
    const copy = join(target, '20261105T030000Z', 'vault', 'n.md');
    expect(lstatSync(copy).isFile()).toBe(true);
    expect(readFileSync(copy, 'utf8')).toBe('# Notiz');
    expect(lstatSync(copy).ino).not.toBe(lstatSync(file).ino);
  });
});

describe('B2: Prüfsumme nie aus der Datei im Ziel (#113)', () => {
  it('Zieldatei wird direkt nach dem Kopieren ausgetauscht: Prüfsumme in Lauf und Manifest = Bytes von pg_dump', async () => {
    // Gegenprobe: Ein Rückfall auf `sha256File(destination)` in dumpPrivately macht diesen Test rot
    const { pg, deps, target } = setup();
    pg.dumpImpl = async (file) => writeFileSync(file, 'PGDMP-echt');
    let swapped = '';
    deps.hooks = {
      afterDumpCopy: (destination) => {
        swapped = destination;
        writeFileSync(destination, 'PGDMP-evil'); // derselbe Pfad, andere Bytes
      },
    };
    expect(await runBackup(deps, { trigger: 'zeitplan' })).toBe(0);
    const echt = createHash('sha256').update('PGDMP-echt').digest('hex');
    expect(swapped).toBe(join(target, '.20261104T030012Z.partial', 'db.dump'));
    expect([...pg.runs.values()][0]?.sha).toBe(echt);
    expect(readManifest(join(target, '20261104T030012Z'))?.dump.sha256).toBe(echt);
    // Der Austausch ist wirklich passiert: der Stand trägt die fremden Bytes und fällt beim Einspielen auf
    expect(readFileSync(join(target, '20261104T030012Z', 'db.dump'), 'utf8')).toBe('PGDMP-evil');
  });
});

describe('Hängendes „läuft“ nach einem Absturz (#113)', () => {
  const pidFile = (dataDir: string, name: string, pid = 999_999) =>
    join(dataDir, 'tmp', `lauf-${name}.${pid}.json`);
  function writePid(dataDir: string, name: string, run: string, pid = 999_999) {
    mkdirSync(join(dataDir, 'tmp'), { recursive: true });
    writeFileSync(pidFile(dataDir, name, pid), JSON.stringify({ pid, run }));
  }

  it('Restore-Test „läuft“, sein Prozess lebt nicht mehr: sofort abgebrochen, Backup läuft', async () => {
    const { pg, deps, dataDir } = setup({ testRunning: true });
    writePid(dataDir, 'restore-test', pg.testStartedAt);
    deps.alive = () => false;
    expect(await runBackup(deps, { trigger: 'vor_migration' })).toBe(0);
    expect(pg.testAborted).toMatchObject({ state: 'fehler', reason: 'abgebrochen' });
    expect(existsSync(pidFile(dataDir, 'restore-test'))).toBe(false);
  });

  it('Prozess lebt, PID-Datei fehlt oder gehört zu einem anderen Lauf: Exit 4 mit Ausweg', async () => {
    for (const variant of ['lebt', 'fehlt', 'anderer'] as const) {
      const { pg, deps, dataDir, errs } = setup({ testRunning: true });
      if (variant !== 'fehlt') {
        writePid(dataDir, 'restore-test', variant === 'lebt' ? pg.testStartedAt : 'anders');
      }
      deps.alive = () => variant === 'lebt';
      expect(await runBackup(deps, { trigger: 'vor_migration' })).toBe(4);
      expect(pg.testAborted).toBeNull();
      const text = errs.join('\n');
      expect(text).toContain('Restore-Test');
      expect(text).toContain('spätestens ab');
      expect(text).toContain('--ohne-backup');
    }
  });

  it('anderes Backup „läuft“, sein Prozess lebt nicht mehr: als Fehler eingetragen, neues Backup läuft', async () => {
    const { pg, deps, dataDir } = setup({ otherActive: 1 });
    const id = '019a4e14-0000-7000-8000-000000000000';
    writePid(dataDir, `backup-${id}`, id);
    deps.alive = () => false;
    expect(await runBackup(deps, { trigger: 'vor_migration' })).toBe(0);
    const update = pg.queries.find((q) => q.sql.includes('lebt nicht mehr') && q.sql.includes('backup_run'));
    expect(update?.vars.id).toBe(id);
    expect(existsSync(pidFile(dataDir, `backup-${id}`))).toBe(false);
  });

  it('H1: zwei Prozesse desselben Restore-Tests, einer per kill -9 beendet: der andere blockiert weiter', async () => {
    const { pg, deps, dataDir } = setup({ testRunning: true });
    writePid(dataDir, 'restore-test', pg.testStartedAt, 1001);
    writePid(dataDir, 'restore-test', pg.testStartedAt, 1002);
    deps.alive = (pid) => pid === 1002;
    expect(await runBackup(deps, { trigger: 'vor_migration' })).toBe(4);
    expect(pg.testAborted).toBeNull();
    expect(existsSync(pidFile(dataDir, 'restore-test', 1002))).toBe(true);
  });

  it('H2: verwaiste Dateien toter Prozesse räumt das nächste Backup auf, lebende bleiben', async () => {
    const { deps, dataDir } = setup();
    writePid(dataDir, 'backup-019a4e14-0000-7000-8000-0000000000e1', 'x', 3001);
    writePid(dataDir, 'restore-test', 'alt', 3002);
    writePid(dataDir, 'restore-test', 'lebt', 3003);
    deps.alive = (pid) => pid === 3003;
    expect(await runBackup(deps, { trigger: 'manuell' })).toBe(0);
    expect(readdirSync(join(dataDir, 'tmp'))).toEqual(['lauf-restore-test.3003.json']);
  });

  it('anderes Backup ohne PID-Datei: weiter Exit 4, Meldung mit Ausweg', async () => {
    const { deps, errs } = setup({ otherActive: 1 });
    deps.alive = () => false;
    expect(await runBackup(deps, { trigger: 'vor_migration' })).toBe(4);
    expect(errs.join('\n')).toContain('--ohne-backup');
  });

  it('Backup und Restore-Test legen ihre PID-Datei während des Laufs an und entfernen sie danach', async () => {
    const s = restoreSetup();
    const seen: string[] = [];
    const runId = '019a4e14-0000-7000-8000-0000000000aa';
    s.pg.dumpImpl = async (file) => {
      writeFileSync(file, 'PGDMP-test');
      seen.push(readFileSync(pidFile(s.dataDir, `backup-${runId}`, process.pid), 'utf8'));
    };
    expect(await runBackup(s.backupDeps, { trigger: 'zeitplan' })).toBe(0);
    expect(JSON.parse(seen[0] as string)).toEqual({ pid: process.pid, run: runId });
    expect(existsSync(pidFile(s.dataDir, `backup-${runId}`, process.pid))).toBe(false);

    s.pg.restoreImpl = async () => {
      seen.push(readFileSync(pidFile(s.dataDir, 'restore-test', process.pid), 'utf8'));
    };
    expect(await runAutoRestoreTest(s.deps, { trigger: 'zeitplan' })).toBe(0);
    // Ohne Eintrag vom Core ist die Kennung der eigene Beginn
    expect(JSON.parse(seen[1] as string)).toEqual({ pid: process.pid, run: '2026-11-10T08:00:00.000Z' });
    expect(existsSync(pidFile(s.dataDir, 'restore-test', process.pid))).toBe(false);
  });
});

describe('Restore liest den Stand ohne Symlink-Folgen (#119)', () => {
  const STAND = '20261104T030012Z';
  /** media/photos im Stand gegen einen Link auf einen fremden Ordner mit passend großer Datei tauschen */
  function plantLink(target: string): string {
    const fremd = join(tmp(), 'fremd');
    mkdirSync(fremd);
    writeFileSync(join(fremd, 'a.jpg'), 'GEHE'); // gleiche Größe wie 'JPEG': das Manifest passt weiter
    const photos = join(target, STAND, 'media', 'photos');
    rmSync(photos, { recursive: true });
    symlinkSync(fremd, photos);
    return fremd;
  }

  it('automatischer Test: Symlink unter media/ ergibt "beschaedigt"', async () => {
    const s = restoreSetup();
    expect(await runBackup(s.backupDeps, { trigger: 'zeitplan' })).toBe(0);
    plantLink(s.target);
    expect(await runAutoRestoreTest(s.deps, { trigger: 'zeitplan' })).toBe(1);
    expect(s.pg.testResult).toMatchObject({ state: 'fehler', reason: 'beschaedigt' });
  });

  it('vollständiger Restore: Symlink unter media/ bricht vor jeder Änderung ab, keine fremde Datei im Datenordner', async () => {
    const s = restoreSetup();
    expect(await runBackup(s.backupDeps, { trigger: 'manuell' })).toBe(0);
    plantLink(s.target);
    expect(await runRestore(s.deps, { stand: STAND, test: false, yes: true })).toBe(1);
    expect(s.errs.join('\n')).toContain('beschädigt');
    expect(s.pg.restored).toEqual([]);
    expect(readFileSync(join(s.dataDir, 'media', 'photos', 'a.jpg'), 'utf8')).toBe('JPEG');
    expect(existsSync(join(s.dataDir, 'restore.journal.json'))).toBe(false);
  });

  it('restore --test: ebenso "beschädigt"', async () => {
    const s = restoreSetup();
    expect(await runBackup(s.backupDeps, { trigger: 'manuell' })).toBe(0);
    plantLink(s.target);
    expect(await runRestore(s.deps, { stand: STAND, test: true, yes: false })).toBe(1);
    expect(s.errs.join('\n')).toContain('beschädigt');
  });

  it('Stand-Ordner selbst als Symlink: "beschaedigt"', async () => {
    const s = restoreSetup();
    expect(await runBackup(s.backupDeps, { trigger: 'zeitplan' })).toBe(0);
    const echt = join(tmp(), 'echt');
    renameSync(join(s.target, STAND), echt);
    symlinkSync(echt, join(s.target, STAND));
    expect(await runAutoRestoreTest(s.deps, { trigger: 'zeitplan' })).toBe(1);
    expect(s.pg.testResult).toMatchObject({ reason: 'beschaedigt' });
  });
});

describe('Restore übernimmt das Ziel mit der Identität aus validateTarget (#161)', () => {
  const STAND = '20261104T030012Z';
  /** Angreifer: Ziel nach der Prüfung beiseiteschieben, an seiner Stelle eine Kopie (gleicher Pfad, anderer Ordner) */
  function swapTarget(target: string): void {
    renameSync(target, `${target}.alt`);
    cpSync(`${target}.alt`, target, { recursive: true });
  }

  it('automatischer Test: Ziel während des Einspielens ersetzt → "beschaedigt"', async () => {
    const s = restoreSetup();
    expect(await runBackup(s.backupDeps, { trigger: 'zeitplan' })).toBe(0);
    s.pg.restoreImpl = async () => swapTarget(s.target);
    expect(await runAutoRestoreTest(s.deps, { trigger: 'zeitplan' })).toBe(1);
    expect(s.pg.testResult).toMatchObject({ state: 'fehler', reason: 'beschaedigt' });
  });

  it('Gegenprobe: automatischer Test ohne Tausch besteht', async () => {
    const s = restoreSetup();
    expect(await runBackup(s.backupDeps, { trigger: 'zeitplan' })).toBe(0);
    expect(await runAutoRestoreTest(s.deps, { trigger: 'zeitplan' })).toBe(0);
  });

  it('restore --test: Ziel während des Einspielens ersetzt → "beschädigt"', async () => {
    const s = restoreSetup();
    expect(await runBackup(s.backupDeps, { trigger: 'manuell' })).toBe(0);
    s.pg.restoreImpl = async () => swapTarget(s.target);
    expect(await runRestore(s.deps, { stand: STAND, test: true, yes: false })).toBe(1);
    expect(s.errs.join('\n')).toContain('beschädigt');
  });

  it('vollständiger Restore: Ziel während der Rückfrage ersetzt → Abbruch vor jeder Änderung', async () => {
    const s = restoreSetup();
    expect(await runBackup(s.backupDeps, { trigger: 'manuell' })).toBe(0);
    s.deps.confirm = async () => (swapTarget(s.target), true);
    expect(await runRestore(s.deps, { stand: STAND, test: false, yes: false })).toBe(1);
    expect(s.errs.join('\n')).toContain('beschädigt');
    expect(s.pg.restored).toEqual([]);
    expect(existsSync(join(s.dataDir, 'restore.journal.json'))).toBe(false);
  });
});

describe('H2 (#124): Schreiber und Leser verankern das Ziel mit der Identität aus validateTarget', () => {
  /** Angreifer: Ziel beiseiteschieben, an seiner Stelle ein Symlink auf einen fremden Ordner */
  function swapTarget(target: string): string {
    const fremd = join(tmp(), 'fremd');
    mkdirSync(fremd);
    renameSync(target, `${target}-weg`);
    symlinkSync(fremd, target);
    return fremd;
  }

  it('Schreiber: Ziel direkt nach der Prüfung getauscht → nichts landet im fremden Ordner', async () => {
    const { target, pg, deps } = setup();
    let fremd = '';
    deps.hooks = { afterValidate: () => (fremd = swapTarget(target)) };
    expect(await runBackup(deps, { trigger: 'manuell' })).toBe(1);
    expect(readdirSync(fremd)).toEqual([]);
    expect(pg.runs.get('019a4e14-0000-7000-8000-0000000000aa')?.state).toBe('fehler');
  });

  it('Leser: Ziel vor dem Lesen des vorigen Standes getauscht → Abbruch schon beim Ziel', async () => {
    const { target, pg, deps } = setup();
    expect(await runBackup(deps, { trigger: 'manuell' })).toBe(0);
    const previous = readdirSync(target)[0] as string;
    deps.now = () => new Date('2026-11-05T03:00:12Z');
    deps.newId = () => '019a4e14-0000-7000-8000-0000000000ab';
    deps.hooks = {
      afterDumpCopy: () => {
        const fremd = swapTarget(target);
        // Der fremde Ordner sieht aus wie das Ziel mit demselben vorigen Stand
        mkdirSync(join(fremd, previous, 'media', 'photos'), { recursive: true });
      },
    };
    expect(await runBackup(deps, { trigger: 'manuell' })).toBe(1);
    expect(pg.runs.get('019a4e14-0000-7000-8000-0000000000ab')?.error).toContain(
      `${target} wurde während des Laufs ersetzt (Symlink`,
    );
  });
});

describe('H3 (#124): Warnung, wenn ein alter Stand über mehrere Läufe stehen bleibt', () => {
  /** Alter, eigener Stand mit Manifest im Ziel (samt Lauf in `backup_run`, H-1 aus #161) */
  function oldStand(pg: FakePg, target: string, name: string): string {
    const id = `019a4e14-0000-7000-8000-2${name.slice(4, 8)}${name.slice(9, 15)}0`;
    pg.runs.set(id, {
      id,
      state: 'fertig',
      error: null,
      stand: name,
      size: '4',
      sha: 'a',
      trigger: 'zeitplan',
      target,
    });
    const dir = join(target, name);
    mkdirSync(join(dir, 'media'), { recursive: true });
    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify({ version: 1, stand: name, dump: { sha256: 'a' } }),
    );
    writeFileSync(join(dir, 'db.dump'), 'DUMP');
    return dir;
  }

  it('erster Lauf: nur Log mit Ursache; zweiter Lauf: Warnung am Lauf; danach entfernt: keine Warnung', async () => {
    const { target, pg, deps, logs, errs } = setup();
    // Zwei Stände am selben Tag: das Ausdünnen entfernt den älteren. Er lässt sich nicht löschen (z. B. immutable).
    const stuck = oldStand(pg, target, '20261001T030000Z');
    oldStand(pg, target, '20261001T040000Z');
    let locked = true;
    deps.targetHooks = {
      step: (op, phase, d) => {
        if (locked && op === 'unlink' && phase === 'before' && d === stuck) {
          throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
        }
      },
    };
    const ids = [
      '019a4e14-0000-7000-8000-0000000000c1',
      '019a4e14-0000-7000-8000-0000000000c2',
      '019a4e14-0000-7000-8000-0000000000c3',
    ];
    let n = 0;
    deps.newId = () => ids[n] as string;

    expect(await runBackup(deps, { trigger: 'manuell' })).toBe(0);
    expect(pg.runs.get(ids[0] as string)).toMatchObject({
      state: 'fertig',
      thinLeft: ['20261001T030000Z'],
      warning: null,
    });
    expect(logs.join('\n')).toMatch(
      /20261001T030000Z nicht vollständig entfernt: Keine Berechtigung \(EPERM\)/,
    );
    expect(logs.join('\n')).not.toMatch(/ausgetauscht/);

    n = 1;
    deps.now = () => new Date('2026-11-05T03:00:12Z');
    expect(await runBackup(deps, { trigger: 'zeitplan' })).toBe(0);
    const second = pg.runs.get(ids[1] as string);
    expect(second?.thinLeft).toEqual(['20261001T030000Z']);
    expect(second?.warning).toBe(
      'Ein alter Backup-Stand lässt sich seit mehreren Läufen nicht löschen (keine Berechtigung). Prüfe das Backup-Ziel und lösche den Ordner „20261001T030000Z“ von Hand.',
    );
    expect(errs.join('\n')).toMatch(/Warnung: Ein alter Backup-Stand lässt sich/);

    // Sperre aufgehoben: der nächste Lauf entfernt den Rest, keine Warnung mehr
    locked = false;
    n = 2;
    deps.now = () => new Date('2026-11-06T03:00:12Z');
    expect(await runBackup(deps, { trigger: 'zeitplan' })).toBe(0);
    expect(pg.runs.get(ids[2] as string)).toMatchObject({ thinLeft: [], warning: null });
    expect(existsSync(stuck)).toBe(false);
  });

  it('Datenbank ohne die neuen Spalten (Backup vor der Migration): Lauf fertig, nichts eingetragen', async () => {
    const { pg, deps, errs } = setup({ hasThinLeft: false });
    expect(await runBackup(deps, { trigger: 'vor_migration' })).toBe(0);
    expect(pg.queries.some((q) => q.sql.includes('SET thin_left'))).toBe(false);
    expect(errs).toEqual([]);
  });
});

describe('H-1 (#161): erfundene Stände im Ziel zählen nicht und werden nie gelöscht', () => {
  /** Ein Ordner, der wie ein Stand aussieht (nur ein Manifest), von jemandem, der im Ziel nur Ordner anlegen kann */
  function fakeStand(target: string, name: string): string {
    const dir = join(target, name);
    mkdirSync(dir);
    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify({ version: 1, stand: name, dump: { sha256: 'x' } }),
    );
    return dir;
  }
  /** 28 Standnamen in 28 verschiedenen Monaten ab 2030: belegen alle Stufen der Aufbewahrung (14 + 8 + 6) */
  const futureNames = (): string[] =>
    Array.from({ length: 28 }, (_, i) => standName(new Date(Date.UTC(2030, i, 1, 0, 0, 0))));
  /** Stand mit Manifest (Prüfsumme `sha`) und Dump, wie ihn ein eigener Lauf hinterlässt */
  function realStand(target: string, name: string, sha = 'a'): string {
    const dir = join(target, name);
    mkdirSync(join(dir, 'media'), { recursive: true });
    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify({ version: 1, stand: name, dump: { sha256: sha } }),
    );
    writeFileSync(join(dir, 'db.dump'), 'DUMP');
    return dir;
  }
  const own = (entries: [string, string][]): OwnedStands =>
    new Map(entries.map(([stand, sha]) => [stand, { trigger: 'zeitplan', sha256: sha }]));
  function checkedTarget() {
    const target = join(tmp(), 'ziel');
    mkdirSync(target);
    return { target, checked: validateTarget(target, tmp()) };
  }

  it('28 erfundene Stände in der Zukunft: alle echten Stände bleiben, auch der neue; die erfundenen bleiben liegen', async () => {
    const { target, deps, logs } = setup();
    const real: string[] = [];
    for (let day = 0; day < 5; day += 1) {
      const date = new Date(Date.UTC(2026, 10, 1 + day, 3));
      expect(await runBackup({ ...deps, now: () => date }, { trigger: 'zeitplan' })).toBe(0);
      real.push(standName(date));
    }
    const fakes = futureNames();
    for (const name of fakes) fakeStand(target, name);
    const date = new Date(Date.UTC(2026, 10, 6, 3));
    expect(await runBackup({ ...deps, now: () => date }, { trigger: 'zeitplan' })).toBe(0);
    real.push(standName(date));
    for (const stand of real) expect(readManifest(join(target, stand)), stand).not.toBeNull();
    for (const stand of fakes) expect(existsSync(join(target, stand, 'manifest.json')), stand).toBe(true);
    expect(logs.join('\n')).toMatch(/28 Ordner im Ziel sehen wie Stände aus, gehören aber zu keinem eigenen/);
  });

  it('erfundener Stand am selben Tag (T235959Z) verdrängt den echten Stand dieses Tages nicht', () => {
    const { target, checked } = checkedTarget();
    realStand(target, '20261001T030000Z');
    fakeStand(target, '20261001T235959Z');
    const result = thin(
      checked,
      { owned: own([['20261001T030000Z', 'a']]) },
      Date.parse('2026-11-05T00:00:00Z'),
    );
    expect(result.removed).toEqual([]);
    expect(readdirSync(target).sort()).toEqual(['20261001T030000Z', '20261001T235959Z']);
  });

  it('der Stand des laufenden Backups wird nie gelöscht, auch wenn eigene Stände in der Zukunft liegen', () => {
    const { target, checked } = checkedTarget();
    const future = futureNames();
    for (const stand of future) realStand(target, stand);
    const current = '20261104T030012Z';
    realStand(target, current);
    const owned = own([...future, current].map((s): [string, string] => [s, 'a']));
    thin(checked, { owned, current }, Date.parse('2026-11-04T03:01:00Z'));
    expect(readManifest(join(target, current))).not.toBeNull();
  });

  it('eigener Name, aber Manifest mit fremder Prüfsumme: zählt nicht und wird nicht gelöscht', () => {
    const { target, checked } = checkedTarget();
    realStand(target, '20261001T030000Z', 'fremd');
    realStand(target, '20261001T040000Z', 'b');
    const owned = own([
      ['20261001T030000Z', 'a'],
      ['20261001T040000Z', 'b'],
    ]);
    const result = thin(checked, { owned }, Date.parse('2026-11-05T00:00:00Z'));
    expect(result.removed).toEqual([]);
    expect(readdirSync(target).sort()).toEqual(['20261001T030000Z', '20261001T040000Z']);
  });

  it('erfundener neuerer Stand wird nicht zum vorigen Stand: keine Hardlinks auf fremde Dateien', async () => {
    const { dataDir, target, deps } = setup();
    expect(await runBackup(deps, { trigger: 'zeitplan' })).toBe(0); // 20261104T030012Z
    const ownFile = join(target, '20261104T030012Z', 'media', 'photos', 'a.jpg');
    // Neuer als der echte Stand, mit einer Datei gleicher Größe und Zeit wie im Datenordner
    const fake = fakeStand(target, '20261104T120000Z');
    mkdirSync(join(fake, 'media', 'photos'), { recursive: true });
    const evil = join(fake, 'media', 'photos', 'a.jpg');
    writeFileSync(evil, 'BOES');
    const source = statSync(join(dataDir, 'media', 'photos', 'a.jpg'));
    utimesSync(evil, source.atime, source.mtime);

    const next = { ...deps, now: () => new Date('2026-11-05T03:00:00Z') };
    expect(await runBackup(next, { trigger: 'zeitplan' })).toBe(0);
    const copied = join(target, '20261105T030000Z', 'media', 'photos', 'a.jpg');
    expect(lstatSync(copied).ino).not.toBe(lstatSync(evil).ino);
    expect(lstatSync(copied).ino).toBe(lstatSync(ownFile).ino); // verlinkt auf den eigenen Stand
    expect(readFileSync(copied, 'utf8')).toBe('JPEG');
  });

  it('ein in .<stand>.partial umbenannter echter Stand wird beim Aufräumen nicht gelöscht', async () => {
    const { target, deps, logs } = setup();
    expect(await runBackup(deps, { trigger: 'zeitplan' })).toBe(0);
    const renamed = join(target, '.20261001T030000Z.partial');
    renameSync(join(target, '20261104T030012Z'), renamed);
    const next = { ...deps, now: () => new Date('2026-11-05T03:00:00Z') };
    expect(await runBackup(next, { trigger: 'zeitplan' })).toBe(0);
    expect(readManifest(renamed)).not.toBeNull();
    expect(readFileSync(join(renamed, 'media', 'photos', 'a.jpg'), 'utf8')).toBe('JPEG');
    expect(logs.join('\n')).toMatch(/\.20261001T030000Z\.partial enthält ein Manifest/);
  });

  /** Wie von einem anderen Benutzer angelegt: Besitzer des ganzen Baums wird `FREMD` (nur als root möglich) */
  const FREMD = 4242;
  function chownTree(path: string): void {
    lchownSync(path, FREMD, FREMD);
    if (!lstatSync(path).isDirectory()) return;
    for (const name of readdirSync(path)) chownTree(join(path, name));
  }
  rootIt(
    'Ordner eines anderen Benutzers mit kopiertem Manifest unter eigenem Standnamen: weder Hardlink-Quelle noch gelöscht',
    async () => {
      const { dataDir, target, deps, logs } = setup();
      expect(await runBackup(deps, { trigger: 'zeitplan' })).toBe(0); // 20261104T030012Z
      const real = join(target, '20261104T030012Z');
      // Der Angreifer schiebt den echten Stand weg (dafür reicht Schreibrecht im Ziel) und legt unter seinem Namen
      // einen eigenen Ordner mit dem kopierten Manifest (Prüfsumme stimmt) und einer Datei gleicher Größe und Zeit an.
      const manifest = readFileSync(join(real, 'manifest.json'));
      renameSync(real, join(target, 'weggeschoben'));
      mkdirSync(join(real, 'media', 'photos'), { recursive: true });
      writeFileSync(join(real, 'manifest.json'), manifest);
      writeFileSync(join(real, 'db.dump'), 'DUMP');
      const evil = join(real, 'media', 'photos', 'a.jpg');
      writeFileSync(evil, 'BOES');
      const source = statSync(join(dataDir, 'media', 'photos', 'a.jpg'));
      utimesSync(evil, source.atime, source.mtime);
      chownTree(real);

      // Gleicher Tag: als eigener Stand wäre der Ordner Hardlink-Quelle und würde danach ausgedünnt
      const next = { ...deps, now: () => new Date('2026-11-04T05:00:00Z') };
      expect(await runBackup(next, { trigger: 'zeitplan' })).toBe(0);
      const copied = join(target, '20261104T050000Z', 'media', 'photos', 'a.jpg');
      expect(lstatSync(copied).ino).not.toBe(lstatSync(evil).ino);
      expect(readFileSync(copied, 'utf8')).toBe('JPEG');
      expect(readFileSync(evil, 'utf8')).toBe('BOES');
      expect(logs.join('\n')).toMatch(/1 Ordner im Ziel sehen wie Stände aus/);
    },
  );

  rootIt(
    'alter .partial eines anderen Benutzers mit einem hineingeschobenen echten Stand wird nicht gelöscht',
    async () => {
      const { target, deps, logs } = setup();
      expect(await runBackup(deps, { trigger: 'zeitplan' })).toBe(0); // 20261104T030012Z
      const fake = join(target, '.20261001T030000Z.partial');
      mkdirSync(fake);
      chownTree(fake);
      // Das Manifest liegt eine Ebene tiefer: Die Prüfung auf ein Manifest im .partial greift hier nicht
      renameSync(join(target, '20261104T030012Z'), join(fake, 'drin'));
      const next = { ...deps, now: () => new Date('2026-11-05T03:00:00Z') };
      expect(await runBackup(next, { trigger: 'zeitplan' })).toBe(0);
      expect(readManifest(join(fake, 'drin'))).not.toBeNull();
      expect(readFileSync(join(fake, 'drin', 'media', 'photos', 'a.jpg'), 'utf8')).toBe('JPEG');
      expect(logs.join('\n')).toMatch(/\.20261001T030000Z\.partial gehört einem anderen Benutzer/);
    },
  );

  rootIt(
    'voriger Stand wird erst während pg_dump gegen einen fremden Ordner getauscht (TOCTOU): keine Hardlinks auf fremde Dateien',
    async () => {
      const { dataDir, target, pg, deps } = setup();
      expect(await runBackup(deps, { trigger: 'zeitplan' })).toBe(0); // 20261104T030012Z
      const real = join(target, '20261104T030012Z');
      const evil = join(real, 'media', 'photos', 'a.jpg');
      // Die Besitzerprüfung (`ownStandsIn`) läuft vor pg_dump, der vorige Stand wird erst danach gelesen. Genau
      // dazwischen schiebt der Angreifer den echten Stand weg und legt unter seinem Namen einen eigenen Ordner an.
      const dump = pg.dumpImpl;
      pg.dumpImpl = async (file) => {
        const manifest = readFileSync(join(real, 'manifest.json'));
        renameSync(real, join(target, 'weggeschoben'));
        mkdirSync(join(real, 'media', 'photos'), { recursive: true });
        writeFileSync(join(real, 'manifest.json'), manifest);
        writeFileSync(evil, 'BOES');
        const source = statSync(join(dataDir, 'media', 'photos', 'a.jpg'));
        utimesSync(evil, source.atime, source.mtime);
        chownTree(real);
        await dump(file);
      };
      const next = { ...deps, now: () => new Date('2026-11-05T03:00:00Z') };
      expect(await runBackup(next, { trigger: 'zeitplan' })).toBe(0);
      const copied = join(target, '20261105T030000Z', 'media', 'photos', 'a.jpg');
      expect(lstatSync(copied).ino).not.toBe(lstatSync(evil).ino);
      expect(lstatSync(copied).uid).toBe(process.getuid?.());
      expect(readFileSync(copied, 'utf8')).toBe('JPEG');
    },
  );

  it('TOCTOU: ein behaltener Stand, der während des Ausdünnens unter den Namen eines alten geschoben wird, bleibt', () => {
    const { target, checked } = checkedTarget();
    const names = ['20261001T010000Z', '20261001T020000Z', '20261001T030000Z'];
    for (const n of names) realStand(target, n);
    const keep = names[2] as string;
    let swapped = false;
    const logs: string[] = [];
    thin(
      checked,
      { owned: own(names.map((n): [string, string] => [n, 'a'])) },
      Date.parse('2026-11-05T00:00:00Z'),
      (m) => logs.push(m),
      {
        step: (op, phase, _dir, name) => {
          if (swapped || op !== 'rmdir' || phase !== 'before') return;
          // Gerade wird der erste alte Stand gelöscht: den zweiten wegschieben, den behaltenen an seine Stelle
          const other = names.find((n) => n !== name && n !== keep) as string;
          if (!existsSync(join(target, other))) return;
          swapped = true;
          renameSync(join(target, other), join(target, 'weggeschoben'));
          renameSync(join(target, keep), join(target, other));
        },
      },
    );
    expect(swapped).toBe(true);
    const survivors = readdirSync(target).filter((n) => readManifest(join(target, n))?.stand === keep);
    expect(survivors).toHaveLength(1);
    expect(logs.join('\n')).toMatch(/hat sich während des Ausdünnens verändert/);
  });

  it('removeStandReport mit geprüfter Identität: ein inzwischen anderer Ordner unter dem Namen wird nicht gelöscht', () => {
    const { target, checked } = checkedTarget();
    realStand(target, '20261001T010000Z');
    realStand(target, '20261001T020000Z');
    const seen = lstatSync(join(target, '20261001T010000Z'));
    renameSync(join(target, '20261001T010000Z'), join(target, 'weggeschoben'));
    renameSync(join(target, '20261001T020000Z'), join(target, '20261001T010000Z'));
    const report = removeStandReport(checked, '20261001T010000Z', undefined, seen);
    expect(report.status).toBe('teilweise');
    expect(report.left[0]?.cause).toBe('getauscht');
    expect(readManifest(join(target, '20261001T010000Z'))?.stand).toBe('20261001T020000Z');
  });

  it('Manifest-Prüfung vor dem Ausdünnen liest im geprüften Ordner, nicht über den Namen (Tausch A→B→A)', () => {
    const { target, checked } = checkedTarget();
    realStand(target, '20261001T010000Z');
    realStand(target, '20261001T030000Z');
    const seenOld = lstatSync(join(target, '20261001T010000Z'));
    const seenKeep = lstatSync(join(target, '20261001T030000Z'));
    // Geprüft wurde der behaltene Stand (er lag kurz unter dem alten Namen), inzwischen liegt dort wieder der alte:
    // Über den Namen gelesen sähe das Manifest gültig aus, im geprüften Ordner gelesen nicht.
    expect(readManifestAt(checked, '20261001T010000Z', seenKeep)).toBeNull();
    expect(readManifestAt(checked, '20261001T010000Z', seenOld)?.stand).toBe('20261001T010000Z');
    // Symlink unter dem Namen auf einen anderen als den geprüften Ordner: wird nicht gelesen
    symlinkSync(join(target, '20261001T030000Z'), join(target, '20261001T020000Z'));
    expect(readManifestAt(checked, '20261001T020000Z', seenOld)).toBeNull();
  });

  it('TOCTOU .partial: ein nach der Prüfung unter den Namen geschobener echter Stand wird nicht gelöscht', () => {
    const { target, checked } = checkedTarget();
    const partial = '.20261001T010000Z.partial';
    mkdirSync(join(target, partial, 'media'), { recursive: true });
    realStand(target, '20261001T030000Z');
    let swapped = false;
    const report = removeStalePartialsReport(checked, Date.parse('2026-11-05T00:00:00Z'), 86_400_000, {
      step: (op, phase, dir) => {
        if (swapped || op !== 'readdir' || phase !== 'before' || dir !== join(target, partial)) return;
        // Besitzer geprüft, Manifest gerade nachgesehen: jetzt den echten Stand unter den Namen des .partial schieben
        swapped = true;
        renameSync(join(target, partial), join(target, 'weggeschoben'));
        renameSync(join(target, '20261001T030000Z'), join(target, partial));
      },
    });
    expect(swapped).toBe(true);
    expect(report.removed).toEqual([]);
    expect(report.left[0]?.left[0]?.cause).toBe('getauscht');
    expect(readManifest(join(target, partial))?.stand).toBe('20261001T030000Z');
    expect(readFileSync(join(target, partial, 'db.dump'), 'utf8')).toBe('DUMP');
  });

  it('backup_run nicht lesbar: nicht ausgedünnt und ohne Hardlinks kopiert (fail-closed), Lauf trotzdem fertig', async () => {
    const { target, pg, deps, errs } = setup();
    expect(await runBackup(deps, { trigger: 'zeitplan' })).toBe(0); // 20261104T030012Z
    const query = pg.query.bind(pg);
    pg.query = async (sql, vars, db) => {
      if (sql.includes('SELECT stand, trigger')) throw new Error('Datenbank weg');
      return query(sql, vars, db);
    };
    // Gleicher Tag: ohne den Fehler würde der ältere Stand ausgedünnt und die Datei verlinkt
    const next = { ...deps, now: () => new Date('2026-11-04T05:00:00Z') };
    expect(await runBackup(next, { trigger: 'zeitplan' })).toBe(0);
    expect(readdirSync(target).sort()).toEqual(['20261104T030012Z', '20261104T050000Z']);
    expect(lstatSync(join(target, '20261104T050000Z', 'media', 'photos', 'a.jpg')).ino).not.toBe(
      lstatSync(join(target, '20261104T030012Z', 'media', 'photos', 'a.jpg')).ino,
    );
    expect(errs.join('\n')).toMatch(/ohne Hardlinks/);
    expect(errs.join('\n')).toMatch(/Ausdünnen alter Stände fehlgeschlagen/);
  });
});

describe('#183: Ziel mit fremder uid (SMB/CIFS ohne uid=, NFS mit root_squash)', () => {
  const FREMD = 4242;
  const ANDERER = 4343;
  /** Besitzer des ganzen Baums ändern (nur als root möglich) */
  function chownTree(path: string, uid: number): void {
    lchownSync(path, uid, uid);
    if (!lstatSync(path).isDirectory()) return;
    for (const name of readdirSync(path)) chownTree(join(path, name), uid);
  }
  /** Wie ein Ziel, das für alles den Besitzer `uid` meldet: jeder neue Ordner bekommt ihn */
  const reportsOwner = (uid: number): BackupDeps['targetHooks'] => ({
    step: (op, phase, dir, name) => {
      // Ordner und Dateien: Ein solches Ziel meldet für alles, was der Lauf anlegt, denselben Besitzer
      if ((op === 'mkdir' || op === 'create') && phase === 'after') lchownSync(join(dir, name), uid, uid);
    },
  });
  const runWith = (
    pg: { runs: Map<string, { stand: string | null; warning?: string | null }> },
    stand: string,
  ) => [...pg.runs.values()].find((r) => r.stand === stand);
  function realStand(target: string, name: string): string {
    const dir = join(target, name);
    mkdirSync(join(dir, 'media'), { recursive: true });
    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify({ version: 1, stand: name, dump: { sha256: 'a' } }),
    );
    writeFileSync(join(dir, 'db.dump'), 'DUMP');
    return dir;
  }
  const own = (names: string[]): OwnedStands =>
    new Map(names.map((stand) => [stand, { trigger: 'zeitplan', sha256: 'a' }]));

  it('thin: eigen ist, was den Besitzer des eigenen .partial hat; Stände eines anderen Besitzers bleiben und werden gemeldet', () => {
    const target = join(tmp(), 'ziel');
    mkdirSync(target);
    const checked = validateTarget(target, tmp());
    const names = ['20261001T010000Z', '20261001T030000Z'];
    for (const n of names) realStand(target, n);
    mkdirSync(join(target, '.20261001T020000Z.partial'));
    const uid = process.getuid?.() ?? 0;
    const logs: string[] = [];
    // Neue Ordner hätten im Ziel einen anderen Besitzer: die vorhandenen zählen nicht als eigen, nichts wird gelöscht
    const other = thin(
      checked,
      { owned: own(names), owner: uid + 1 },
      Date.parse('2026-11-05T00:00:00Z'),
      (m) => logs.push(m),
    );
    expect(other.removed).toEqual([]);
    expect(other.foreign).toEqual(['20261001T030000Z', '20261001T010000Z']);
    expect(readdirSync(target).sort()).toEqual(['.20261001T020000Z.partial', ...names]);
    expect(logs.join('\n')).toMatch(
      /2 davon passen zu eigenen Läufen in backup_run, ihr Ordner gehört aber einem anderen Benutzer/,
    );
    expect(logs.join('\n')).toMatch(/\.20261001T020000Z\.partial gehört einem anderen Benutzer/);
    // Gegenprobe: mit dem Besitzer der Ordner wird ausgedünnt und der alte .partial aufgeräumt
    const same = thin(checked, { owned: own(names), owner: uid }, Date.parse('2026-11-05T00:00:00Z'));
    expect(same.removed).toEqual(['20261001T010000Z']);
    expect(same.foreign).toBeUndefined();
    expect(readdirSync(target)).toEqual(['20261001T030000Z']);
  });

  it('copyTree: verlinkt nur Dateien mit dem Besitzer eigener Ordner (owner)', () => {
    const root = tmp();
    const src = join(root, 'src');
    mkdirSync(src);
    writeFileSync(join(src, 'a.txt'), 'AAAA');
    const first = copyTree(src, join(root, 's1'), null);
    expect(first.copied).toBe(1);
    const uid = process.getuid?.() ?? 0;
    expect(copyTree(src, join(root, 's2'), join(root, 's1'), undefined, { owner: uid + 1 }).linked).toBe(0);
    expect(copyTree(src, join(root, 's3'), join(root, 's1'), undefined, { owner: uid }).linked).toBe(1);
  });

  rootIt(
    'Ziel meldet für alles eine fremde uid: ausgedünnt und verlinkt, das Log nennt den Grund',
    async () => {
      const { target, pg, deps, logs, errs } = setup();
      expect(await runBackup(deps, { trigger: 'zeitplan' })).toBe(0); // 20261104T030012Z
      chownTree(target, FREMD);
      const old = join(target, '20261104T030012Z');
      const oldIno = lstatSync(join(old, 'media', 'photos', 'a.jpg')).ino;
      // Gleicher Tag: der ältere Stand wird ausgedünnt, unveränderte Dateien kommen als Hardlink
      const next = { ...deps, now: () => new Date('2026-11-04T05:00:00Z'), targetHooks: reportsOwner(FREMD) };
      expect(await runBackup(next, { trigger: 'zeitplan' })).toBe(0);
      expect(readdirSync(target)).toEqual(['20261104T050000Z']);
      const stand = join(target, '20261104T050000Z');
      expect(lstatSync(stand).uid).toBe(FREMD);
      expect(lstatSync(join(stand, 'media', 'photos', 'a.jpg')).ino).toBe(oldIno);
      expect(readFileSync(join(stand, 'media', 'photos', 'a.jpg'), 'utf8')).toBe('JPEG');
      const log = logs.join('\n');
      expect(log).toMatch(
        /meldet für Ordner, die dieser Lauf anlegt, den Besitzer uid 4242, der Lauf selbst läuft als uid 0/,
      );
      expect(log).toMatch(/1 Dateien, 0 neu kopiert, 1 unverändert/);
      expect(log).toMatch(/Alten Stand 20261104T030012Z entfernt/);
      expect(errs.join('\n')).not.toMatch(/Warnung/);
      expect(runWith(pg, '20261104T050000Z')?.warning ?? null).toBeNull();
    },
  );

  rootIt(
    'Gegenprobe auf demselben Ziel: Ordner eines dritten Besitzers mit kopiertem Manifest ist weder Hardlink-Quelle noch gelöscht',
    async () => {
      const { dataDir, target, deps, logs } = setup();
      expect(await runBackup(deps, { trigger: 'zeitplan' })).toBe(0); // 20261104T030012Z
      chownTree(target, FREMD);
      const real = join(target, '20261104T030012Z');
      const manifest = readFileSync(join(real, 'manifest.json'));
      renameSync(real, join(target, 'weggeschoben'));
      mkdirSync(join(real, 'media', 'photos'), { recursive: true });
      writeFileSync(join(real, 'manifest.json'), manifest);
      writeFileSync(join(real, 'db.dump'), 'DUMP');
      const evil = join(real, 'media', 'photos', 'a.jpg');
      writeFileSync(evil, 'BOES');
      const source = statSync(join(dataDir, 'media', 'photos', 'a.jpg'));
      utimesSync(evil, source.atime, source.mtime);
      chownTree(real, ANDERER);

      const next = { ...deps, now: () => new Date('2026-11-04T05:00:00Z'), targetHooks: reportsOwner(FREMD) };
      expect(await runBackup(next, { trigger: 'zeitplan' })).toBe(0);
      const copied = join(target, '20261104T050000Z', 'media', 'photos', 'a.jpg');
      expect(lstatSync(copied).ino).not.toBe(lstatSync(evil).ino);
      expect(readFileSync(copied, 'utf8')).toBe('JPEG');
      expect(readFileSync(evil, 'utf8')).toBe('BOES');
      expect(readManifest(join(target, 'weggeschoben'))).not.toBeNull();
      expect(logs.join('\n')).toMatch(/1 Ordner im Ziel sehen wie Stände aus/);
    },
  );

  rootIt(
    'Stände eines früheren Laufs als anderer Benutzer: nicht ausgedünnt, nicht verlinkt, Warnung am Lauf und im Log',
    async () => {
      const { target, pg, deps, logs, errs } = setup();
      expect(await runBackup(deps, { trigger: 'zeitplan' })).toBe(0); // 20261104T030012Z
      const old = join(target, '20261104T030012Z');
      chownTree(old, FREMD); // etwa früher ohne sudo gelaufen, jetzt als root
      const next = { ...deps, now: () => new Date('2026-11-04T05:00:00Z') };
      expect(await runBackup(next, { trigger: 'zeitplan' })).toBe(0);
      expect(readdirSync(target).sort()).toEqual(['20261104T030012Z', '20261104T050000Z']);
      expect(lstatSync(join(target, '20261104T050000Z', 'media', 'photos', 'a.jpg')).ino).not.toBe(
        lstatSync(join(old, 'media', 'photos', 'a.jpg')).ino,
      );
      expect(logs.join('\n')).toMatch(
        /1 davon passen zu eigenen Läufen in backup_run, ihr Ordner gehört aber einem anderen Benutzer als die Ordner dieses Laufs \(uid 0\): 20261104T030012Z/,
      );
      const warning =
        'Ein Backup-Stand im Ziel gehört einem anderen Benutzer als die neuen Stände, etwa nach einem Lauf per sudo oder einer geänderten Freigabe. Solche Stände werden weder ausgedünnt noch für unveränderte Dateien genutzt, jeder Lauf kopiert dann alles und das Ziel kann volllaufen. Prüfe die Besitzer der Ordner im Backup-Ziel.';
      expect(runWith(pg, '20261104T050000Z')?.warning).toBe(warning);
      expect(errs.join('\n')).toContain(`Warnung: ${warning}`);
    },
  );

  rootIt(
    'Wettlauf beim Anlegen des .partial: ein untergeschobener fremder Ordner wird nicht zum Maßstab für „eigen“',
    async () => {
      const { target, deps, logs, errs } = setup();
      expect(await runBackup(deps, { trigger: 'zeitplan' })).toBe(0); // 20261104T030012Z, Besitzer root
      const name = '.20261104T050000Z.partial';
      const evil = join(target, name);
      // Der Angreifer tauscht das frisch angelegte .partial (zwischen mkdir und lstat) gegen einen eigenen Ordner
      const swap: BackupDeps['targetHooks'] = {
        step: (op, phase, dir, entry) => {
          if (op !== 'mkdir' || phase !== 'after' || entry !== name) return;
          renameSync(join(dir, entry), join(dir, 'geklaut'));
          mkdirSync(evil);
          lchownSync(evil, ANDERER, ANDERER);
        },
      };
      const next = { ...deps, now: () => new Date('2026-11-04T05:00:00Z'), targetHooks: swap };
      expect(await runBackup(next, { trigger: 'zeitplan' })).not.toBe(0);
      // Nichts landet im Ordner des Angreifers (leer wieder entfernt), seine uid gilt nirgends als eigen
      expect(existsSync(evil) ? readdirSync(evil) : []).toEqual([]);
      expect(existsSync(join(target, '20261104T050000Z'))).toBe(false);
      expect(logs.join('\n')).not.toMatch(/uid 4343/);
      // Abbruch genau durch die Probe (`targetOwner`), nicht durch eine andere Meldung mit „ersetzt“
      expect(errs.join('\n')).toMatch(
        /beim Anlegen ersetzt: Der Ordner gehört uid 4343, neue Dateien dieses Laufs gehören uid 0/,
      );
      expect(readManifest(join(target, '20261104T030012Z'))).not.toBeNull();
    },
  );

  rootIt(
    'Wettlauf beim Anlegen des .partial: ein Symlink an Stelle der Probedatei wird nie verfolgt',
    async () => {
      const { target, deps, errs } = setup();
      expect(await runBackup(deps, { trigger: 'zeitplan' })).toBe(0);
      const name = '.20261104T050000Z.partial';
      const evil = join(target, name);
      const victim = join(dirname(target), 'opfer.txt');
      writeFileSync(victim, 'ORIGINAL');
      const swap: BackupDeps['targetHooks'] = {
        step: (op, phase, dir, entry) => {
          if (op !== 'mkdir' || phase !== 'after' || entry !== name) return;
          renameSync(join(dir, entry), join(dir, 'geklaut'));
          mkdirSync(evil);
          symlinkSync(victim, join(evil, '.sg-besitzer.partial'));
          lchownSync(evil, ANDERER, ANDERER);
        },
      };
      const next = { ...deps, now: () => new Date('2026-11-04T05:00:00Z'), targetHooks: swap };
      expect(await runBackup(next, { trigger: 'zeitplan' })).not.toBe(0);
      expect(readFileSync(victim, 'utf8')).toBe('ORIGINAL');
      expect(lstatSync(join(evil, '.sg-besitzer.partial')).isSymbolicLink()).toBe(true);
      expect(existsSync(join(target, '20261104T050000Z'))).toBe(false);
      expect(errs.join('\n')).toMatch(/sg-besitzer\.partial gibt es schon/);
    },
  );
});

describe('M-1 (#114): Größengrenze für die Prüfkopie des Dumps', () => {
  const STAND = '20261104T030012Z';
  /** Ersetzt `db.dump` durch eine sparse Datei mit `bytes` Bytes (belegt auf der Platte fast nichts) */
  function sparseDump(dir: string, bytes: number): void {
    const dump = join(dir, 'db.dump');
    rmSync(dump);
    writeFileSync(dump, '');
    truncateSync(dump, bytes);
  }
  function setManifestBytes(dir: string, bytes: number): void {
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as {
      dump: { bytes: number };
    };
    manifest.dump.bytes = bytes;
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  }
  const restoreLeftovers = (dataDir: string): string[] =>
    existsSync(join(dataDir, 'tmp'))
      ? readdirSync(join(dataDir, 'tmp')).filter((n) => n.startsWith('restore-'))
      : [];

  it('copyAndHash: falsche Größe → Abbruch vor dem Anlegen der Kopie', async () => {
    const base = tmp();
    const src = join(base, 'riesig');
    writeFileSync(src, '');
    truncateSync(src, 2 * 1024 ** 3);
    await expect(copyAndHash(src, join(base, 'kopie'), undefined, 4)).rejects.toMatchObject({
      code: SIZE_MISMATCH,
    });
    expect(existsSync(join(base, 'kopie'))).toBe(false);
  });

  it('restore --test: übergroßer sparse Dump (Manifest unverändert) wird nicht kopiert', async () => {
    const s = restoreSetup();
    expect(await runBackup(s.backupDeps, { trigger: 'manuell' })).toBe(0);
    sparseDump(join(s.target, STAND), 64 * 1024 * 1024);
    expect(await runRestore(s.deps, { stand: STAND, test: true, yes: false })).toBe(1);
    expect(s.pg.restored).toEqual([]);
    expect(s.errs.join('\n')).toMatch(/nicht die Größe aus dem Manifest/);
    expect(restoreLeftovers(s.dataDir)).toEqual([]);
  });

  it('automatischer Test: übergroßer Dump samt gefälschter Größe im Manifest → nicht_authentisch (Grenze aus backup_run)', async () => {
    const s = restoreSetup();
    expect(await runBackup(s.backupDeps, { trigger: 'zeitplan' })).toBe(0);
    const dir = join(s.target, STAND);
    sparseDump(dir, 2 * 1024 ** 4);
    setManifestBytes(dir, 2 * 1024 ** 4);
    expect(await runAutoRestoreTest(s.deps, { trigger: 'zeitplan' })).toBe(1);
    expect(s.pg.restored).toEqual([]);
    expect(s.pg.testResult).toMatchObject({ state: 'fehler', reason: 'nicht_authentisch', stand: STAND });
    expect(restoreLeftovers(s.dataDir)).toEqual([]);
  });

  it('Prüfkopie passt nicht mit Reserve auf die Platte → klare Meldung, nichts kopiert, fn nie aufgerufen', async () => {
    // Freier Platz wird vorgegeben: ein echter übergroßer Dump würde ohne die Prüfung die Platte des Testrechners füllen
    const dataDir = tmp();
    const src = join(tmp(), 'db.dump');
    writeFileSync(src, 'PGDMP-test');
    const sha256 = createHash('sha256').update('PGDMP-test').digest('hex');
    const called: string[] = [];
    const run = withVerifiedDump(
      dataDir,
      src,
      { sha256, bytes: 10 },
      STAND,
      async (copy) => void called.push(copy),
      () => FREE_RESERVE_BYTES + 5,
    );
    await expect(run).rejects.toThrow(/zu wenig Platz frei/);
    expect(called).toEqual([]);
    expect(restoreLeftovers(dataDir)).toEqual([]);
    // Mit genug Platz geht es
    await withVerifiedDump(
      dataDir,
      src,
      { sha256, bytes: 10 },
      STAND,
      async (copy) => void called.push(copy),
      () => FREE_RESERVE_BYTES + 10,
    );
    expect(called).toHaveLength(1);
  });

  it('freeBytes liefert den freien Platz des Datenordners', () => {
    expect(freeBytes(tmp())).toBeGreaterThan(0);
  });

  it('Manifest ohne gültige Größe: fail-closed', async () => {
    const s = restoreSetup();
    expect(await runBackup(s.backupDeps, { trigger: 'manuell' })).toBe(0);
    setManifestBytes(join(s.target, STAND), -1);
    s.pg.runs.clear();
    expect(await runRestore(s.deps, { stand: STAND, test: true, yes: false })).toBe(1);
    expect(s.pg.restored).toEqual([]);
    expect(s.errs.join('\n')).toMatch(/keine gültige Größe/);
  });
});

describe('Härtung aus #114: restore von Hand verlangt die Prüfsumme eines eigenen Laufs', () => {
  const STAND = '20261104T030012Z';
  /** Angreifer tauscht Dump und Prüfsumme im Manifest passend aus (gleiche Größe) */
  function forge(dir: string): void {
    writeFileSync(join(dir, 'db.dump'), 'PGDMP-boes');
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as {
      dump: { sha256: string };
    };
    manifest.dump.sha256 = createHash('sha256').update('PGDMP-boes').digest('hex');
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  }

  it('--test: ausgetauschter eigener Stand wird nicht eingespielt', async () => {
    const s = restoreSetup();
    expect(await runBackup(s.backupDeps, { trigger: 'manuell' })).toBe(0);
    forge(join(s.target, STAND));
    expect(await runRestore(s.deps, { stand: STAND, test: true, yes: false })).toBe(1);
    expect(s.pg.restored).toEqual([]);
    expect(s.errs.join('\n')).toMatch(/passt nicht zum protokollierten Backup-Lauf/);
  });

  it('vollständig: ebenso, vor jeder Änderung', async () => {
    const s = restoreSetup();
    expect(await runBackup(s.backupDeps, { trigger: 'manuell' })).toBe(0);
    forge(join(s.target, STAND));
    expect(await runRestore(s.deps, { stand: STAND, test: false, yes: true })).toBe(1);
    expect(s.pg.restored).toEqual([]);
    expect(s.pg.databases).toEqual(new Set(['sg']));
  });

  it('ohne eigenen Lauf (fremder Stand) bleibt es beim Manifest, wie dokumentiert', async () => {
    const s = restoreSetup();
    expect(await runBackup(s.backupDeps, { trigger: 'manuell' })).toBe(0);
    forge(join(s.target, STAND));
    s.pg.runs.clear();
    expect(await runRestore(s.deps, { stand: STAND, test: true, yes: false })).toBe(0);
  });
});

// UX-12 (Plan E3, §5.1): Die Tunnel-Schlüssel liegen in `<SG_DATA_DIR>/secrets/tunnel-keys.json` und dürfen nie ins
// Backup. `sg backup` sichert nur die Datenbank, `media/` und `vault/`. Ein Test hält das fest, damit eine spätere
// Änderung (z. B. „den ganzen Datenordner sichern“) nicht still Geheimnisse mitnimmt.
describe('Tunnel-Schlüssel gehören nie ins Backup (UX-12, E3)', () => {
  const TUNNEL_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';

  function withSecrets(dataDir: string): void {
    const secrets = join(dataDir, 'secrets');
    mkdirSync(secrets, { mode: 0o700 });
    const file = join(secrets, 'tunnel-keys.json');
    writeFileSync(
      file,
      JSON.stringify({
        v: 1,
        devices: [{ device_id: '019a4e14-0000-7000-8000-0000000000a1', tunnel_key: TUNNEL_KEY }],
      }),
      { mode: 0o600 },
    );
    // Auch ein Weg über Symlinks in `media/` und `vault/` führt nicht zu den Schlüsseln (Symlinks werden nie verfolgt)
    symlinkSync(secrets, join(dataDir, 'media', 'geheim'));
    symlinkSync(file, join(dataDir, 'vault', 'tunnel-keys.json'));
    // `run/` (Socket, Worker-Token) ist ebenfalls nicht Teil eines Standes
    mkdirSync(join(dataDir, 'run'), { mode: 0o700 });
    writeFileSync(join(dataDir, 'run', 'tunnel.sock'), 'KEIN-SOCKET');
  }

  function filesOf(dir: string): string[] {
    return readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name));
  }

  it('der Stand enthält weder die Schlüsseldatei noch einen Schlüssel noch den Ordner secrets/', async () => {
    const { dataDir, target, deps } = setup();
    withSecrets(dataDir);
    expect(await runBackup(deps, { trigger: 'manuell' })).toBe(0);
    const stand = join(target, '20261104T030012Z');
    const files = filesOf(stand);
    expect(files.length).toBeGreaterThan(3);
    for (const file of files) {
      expect(file, file).not.toMatch(/tunnel-keys|secrets|tunnel\.sock/);
      expect(readFileSync(file).includes(TUNNEL_KEY), file).toBe(false);
    }
    // Nur Datenbank, Manifest, media/ und vault/ sind im Stand
    expect(readdirSync(stand).sort()).toEqual(['db.dump', 'files.sha256', 'manifest.json', 'media', 'vault']);
  });

  it('auch ein zweiter, inkrementeller Lauf nimmt die Schlüssel nicht mit', async () => {
    const { dataDir, target, deps } = setup();
    withSecrets(dataDir);
    expect(await runBackup(deps, { trigger: 'zeitplan' })).toBe(0);
    const second: BackupDeps = { ...deps, now: () => new Date('2026-11-05T03:00:12Z') };
    expect(await runBackup(second, { trigger: 'zeitplan' })).toBe(0);
    expect(readdirSync(target)).toHaveLength(2);
    for (const stand of readdirSync(target)) {
      for (const file of filesOf(join(target, stand))) {
        expect(readFileSync(file).includes(TUNNEL_KEY), file).toBe(false);
      }
    }
  });

  it('ein Backup-Ziel im Ordner secrets/ wird abgelehnt (liegt im Datenordner)', () => {
    const { dataDir } = setup();
    withSecrets(dataDir);
    expect(() => validateTarget(join(dataDir, 'secrets'), dataDir)).toThrow();
  });
});

// ---------------------------------------------------------------- Prüfsummen für media/ und vault/ (#114 N-1)

describe('Prüfsummen für media/ und vault/ (#114 N-1)', () => {
  const STAND = '20261104T030012Z';
  const sha = (text: string) => createHash('sha256').update(text).digest('hex');

  async function prepared(over: Partial<FakePg> = {}) {
    const s = restoreSetup(over);
    expect(await runBackup(s.backupDeps, { trigger: 'manuell' })).toBe(0);
    return s;
  }
  const standDir = (s: { target: string }) => join(s.target, STAND);
  const manifestOf = (s: { target: string }) =>
    JSON.parse(readFileSync(join(standDir(s), 'manifest.json'), 'utf8')) as Record<string, unknown> & {
      files?: { file: string; count: number; sha256: string };
    };
  const writeManifest = (s: { target: string }, manifest: unknown) =>
    writeFileSync(join(standDir(s), 'manifest.json'), JSON.stringify(manifest));
  const restoreTest = (s: { deps: RestoreDeps }) =>
    runRestore(s.deps, { stand: STAND, test: true, yes: false });
  const restoreFull = (s: { deps: RestoreDeps }) =>
    runRestore(s.deps, { stand: STAND, test: false, yes: true });

  /** Nichts wurde angefasst: alte Daten, keine Zwischenordner, kein Journal, keine neue Datenbank */
  function expectUntouched(s: { dataDir: string; pg: FakePg }) {
    expect(readFileSync(join(s.dataDir, 'media', 'photos', 'a.jpg'), 'utf8')).toBe('JPEG');
    expect(readFileSync(join(s.dataDir, 'vault', 'n.md'), 'utf8')).toBe('# Notiz');
    expect(readdirSync(s.dataDir).filter((n) => /neu-|vor-restore|journal/.test(n))).toEqual([]);
    expect([...s.pg.databases]).toEqual(['sg']);
  }

  it('Backup: files.sha256 enthält die echte SHA-256 jeder Datei, Manifest und backup_run tragen die Prüfsumme der Liste', async () => {
    const s = await prepared();
    const list = readFileSync(join(standDir(s), 'files.sha256'), 'utf8');
    expect(list).toBe(`${sha('JPEG')}\tmedia/photos/a.jpg\n${sha('# Notiz')}\tvault/n.md\n`);
    expect(manifestOf(s).files).toEqual({ file: 'files.sha256', count: 2, sha256: sha(list) });
    expect([...s.pg.runs.values()][0]?.filesSha).toBe(sha(list));
  });

  it('inkrementeller Lauf (Hardlinks): auch verlinkte Dateien stehen mit ihrer Prüfsumme in der Liste', async () => {
    const s = await prepared();
    const second: BackupDeps = { ...s.backupDeps, now: () => new Date('2026-11-05T03:00:12Z') };
    expect(await runBackup(second, { trigger: 'manuell' })).toBe(0);
    const list = readFileSync(join(s.target, '20261105T030012Z', 'files.sha256'), 'utf8');
    expect(list).toContain(`${sha('JPEG')}\tmedia/photos/a.jpg\n`);
    expect(list).toContain(`${sha('# Notiz')}\tvault/n.md\n`);
  });

  it('Dateinamen mit Zeilenumbruch und Backslash bleiben eindeutig', async () => {
    const s = restoreSetup();
    writeFileSync(join(s.dataDir, 'media', 'a\nb\\c.txt'), 'x');
    expect(await runBackup(s.backupDeps, { trigger: 'manuell' })).toBe(0);
    expect(readFileSync(join(standDir(s), 'files.sha256'), 'utf8')).toContain(
      `${sha('x')}\tmedia/a\\nb\\\\c.txt\n`,
    );
    expect(await restoreTest(s)).toBe(0);
  });

  it('unverändert: --test und vollständiger Restore bestehen, Prüfsummen werden geprüft und gemeldet', async () => {
    const s = await prepared();
    expect(await restoreTest(s)).toBe(0);
    expect(s.logs.join('\n')).toMatch(/Prüfsummen \(media\/vault\): alle Dateien stimmen/);
    expect(await restoreFull(s)).toBe(0);
    expect(s.logs.join('\n')).toMatch(/Prüfe die Prüfsummen von media\/ \(1 Dateien\)/);
  });

  it('manipulierte Datei mit gleicher Größe: --test schlägt fehl', async () => {
    const s = await prepared();
    writeFileSync(join(standDir(s), 'media', 'photos', 'a.jpg'), 'JPEX');
    expect(await restoreTest(s)).toBe(1);
    expect(s.logs.join('\n')).toMatch(/weicht von der Prüfsumme ab/);
  });

  it('manipulierte Datei mit gleicher Größe: vollständiger Restore bricht ab, nichts wird verändert', async () => {
    const s = await prepared();
    writeFileSync(join(standDir(s), 'media', 'photos', 'a.jpg'), 'JPEX');
    expect(await restoreFull(s)).toBe(1);
    expect(s.errs.join('\n')).toMatch(/stimmen nicht mit den Prüfsummen überein.*media\/photos\/a\.jpg/);
    expect(s.errs.join('\n')).toMatch(/deine Daten sind unverändert/);
    expectUntouched(s);
  });

  it('manipulierte Datei in vault/: vollständiger Restore bricht ab, nichts wird verändert', async () => {
    const s = await prepared();
    writeFileSync(join(standDir(s), 'vault', 'n.md'), '# Notiy');
    expect(await restoreFull(s)).toBe(1);
    expect(s.errs.join('\n')).toMatch(/vault\/n\.md/);
    expectUntouched(s);
  });

  it('fehlende Datei (Anzahl und Größe bleiben durch eine andere Datei gleich): bricht ab, nichts wird verändert', async () => {
    const s = await prepared();
    rmSync(join(standDir(s), 'media', 'photos', 'a.jpg'));
    writeFileSync(join(standDir(s), 'media', 'photos', 'b.jpg'), 'JPEG');
    expect(await restoreFull(s)).toBe(1);
    expect(s.errs.join('\n')).toMatch(/zusätzliche Datei media\/photos\/b\.jpg/);
    expectUntouched(s);
    expect(await restoreTest(s)).toBe(1);
    expect(s.logs.join('\n')).toMatch(/media\/photos\/a\.jpg fehlt/);
  });

  it('fehlende Datei ohne Ersatz: bricht ab (Anzahl weicht ab), nichts wird verändert', async () => {
    const s = await prepared();
    rmSync(join(standDir(s), 'vault', 'n.md'));
    expect(await restoreFull(s)).toBe(1);
    expectUntouched(s);
  });

  it('veränderte Liste files.sha256: passt nicht zum Manifest, Stand wird nicht eingespielt', async () => {
    const s = await prepared();
    const path = join(standDir(s), 'files.sha256');
    writeFileSync(path, readFileSync(path, 'utf8').replace(sha('JPEG'), sha('JPEX')));
    expect(await restoreFull(s)).toBe(1);
    expect(s.errs.join('\n')).toMatch(/passt nicht zur Prüfsumme im Manifest/);
    expectUntouched(s);
  });

  it('fehlende Liste files.sha256 bei vorhandenem Manifest-Eintrag: bricht ab', async () => {
    const s = await prepared();
    rmSync(join(standDir(s), 'files.sha256'));
    expect(await restoreFull(s)).toBe(1);
    expect(s.errs.join('\n')).toMatch(/fehlt files\.sha256/);
    expectUntouched(s);
  });

  it('Angreifer ändert Datei, Liste UND Manifest: backup_run entlarvt es (Prüfsumme der Liste)', async () => {
    const s = await prepared();
    const list = `${sha('JPEX')}\tmedia/photos/a.jpg\n${sha('# Notiz')}\tvault/n.md\n`;
    writeFileSync(join(standDir(s), 'media', 'photos', 'a.jpg'), 'JPEX');
    writeFileSync(join(standDir(s), 'files.sha256'), list);
    writeManifest(s, { ...manifestOf(s), files: { file: 'files.sha256', count: 2, sha256: sha(list) } });
    expect(await restoreFull(s)).toBe(1);
    expect(s.errs.join('\n')).toMatch(/passen nicht zum protokollierten Backup-Lauf/);
    expectUntouched(s);
    s.errs.length = 0;
    expect(await restoreTest(s)).toBe(1);
  });

  it('Herabstufung: Manifest ohne Liste bei einem Lauf mit Prüfsumme wird abgelehnt', async () => {
    const s = await prepared();
    const { files: _files, ...old } = manifestOf(s);
    writeManifest(s, old);
    writeFileSync(join(standDir(s), 'media', 'photos', 'a.jpg'), 'JPEX');
    expect(await restoreFull(s)).toBe(1);
    expect(s.errs.join('\n')).toMatch(/passen nicht zum protokollierten Backup-Lauf/);
    expectUntouched(s);
  });

  it('alter Stand ohne Prüfsummen (Manifest ohne files, Lauf ohne files_sha256) bleibt wiederherstellbar, mit Hinweis', async () => {
    const s = await prepared();
    const { files: _files, ...old } = manifestOf(s);
    writeManifest(s, old);
    rmSync(join(standDir(s), 'files.sha256'));
    for (const run of s.pg.runs.values()) run.filesSha = null;
    expect(await restoreTest(s)).toBe(0);
    expect(s.logs.join('\n')).toMatch(/keine Prüfsummen für media\/ und vault\/.*Anzahl und Größe/);
    s.logs.length = 0;
    expect(await restoreFull(s)).toBe(0);
    expect(s.logs.join('\n')).toMatch(/keine Prüfsummen für media\/ und vault\//);
    expect(existsSync(join(s.dataDir, 'media.vor-restore-20261110t080000z'))).toBe(true);
  });

  it('alter Stand ohne Prüfsummen: eine Änderung bleibt (wie bisher) unbemerkt, solange Anzahl und Größe passen', async () => {
    // Dokumentiert die Grenze: Nur neue Stände sind durch Prüfsummen geschützt
    const s = await prepared();
    const { files: _files, ...old } = manifestOf(s);
    writeManifest(s, old);
    for (const run of s.pg.runs.values()) run.filesSha = null;
    writeFileSync(join(standDir(s), 'media', 'photos', 'a.jpg'), 'JPEX');
    expect(await restoreTest(s)).toBe(0);
  });

  it('Datenbank vor Migration 0011 (ohne Spalte files_sha256): Backup und Restore laufen, Dateien gelten über das Manifest', async () => {
    const s = restoreSetup({ hasFilesSha: false });
    expect(await runBackup(s.backupDeps, { trigger: 'manuell' })).toBe(0);
    expect([...s.pg.runs.values()][0]?.filesSha).toBeUndefined();
    expect(s.pg.queries.some((q) => q.sql.includes('files_sha256 = '))).toBe(false);
    expect(await restoreTest(s)).toBe(0);
    writeFileSync(join(standDir(s), 'media', 'photos', 'a.jpg'), 'JPEX');
    expect(await restoreFull(s)).toBe(1);
    expectUntouched(s);
  });

  it('automatischer Test: bestanden; manipulierte Datei gibt dateien_abweichend mit Pfad', async () => {
    const s = await prepared();
    expect(await runAutoRestoreTest(s.deps, { trigger: 'manuell' })).toBe(0);
    writeFileSync(join(standDir(s), 'media', 'photos', 'a.jpg'), 'JPEX');
    expect(await runAutoRestoreTest(s.deps, { trigger: 'manuell' })).toBe(1);
    expect(s.pg.testResult).toMatchObject({ state: 'fehler', reason: 'dateien_abweichend' });
    expect(String(s.pg.testResult?.error)).toMatch(/media\/photos\/a\.jpg/);
    expect(s.pg.databases.has('sg_autotest_abc123')).toBe(false);
  });

  it('automatischer Test: Liste und Manifest ausgetauscht → nicht_authentisch', async () => {
    const s = await prepared();
    const list = `${sha('JPEX')}\tmedia/photos/a.jpg\n${sha('# Notiz')}\tvault/n.md\n`;
    writeFileSync(join(standDir(s), 'media', 'photos', 'a.jpg'), 'JPEX');
    writeFileSync(join(standDir(s), 'files.sha256'), list);
    writeManifest(s, { ...manifestOf(s), files: { file: 'files.sha256', count: 2, sha256: sha(list) } });
    expect(await runAutoRestoreTest(s.deps, { trigger: 'manuell' })).toBe(1);
    expect(s.pg.testResult).toMatchObject({ state: 'fehler', reason: 'nicht_authentisch' });
    expect(s.pg.restored).toEqual([]);
  });

  it('große Datei wird streamend gehasht (mehr als ein Block)', async () => {
    const s = restoreSetup();
    const big = Buffer.alloc(3 * 1024 * 1024 + 17, 7);
    writeFileSync(join(s.dataDir, 'media', 'audio.m4a'), big);
    expect(await runBackup(s.backupDeps, { trigger: 'manuell' })).toBe(0);
    const want = createHash('sha256').update(big).digest('hex');
    expect(readFileSync(join(standDir(s), 'files.sha256'), 'utf8')).toContain(`${want}\tmedia/audio.m4a\n`);
    expect(await restoreFull(s)).toBe(0);
  });
});

// ---------------------------------------------------------------- Unicode-Normalisierung der Prüfsummenliste

describe('Prüfsummen: Unicode-Normalisierung (NFC/NFD) der Pfade (#114 N-1)', () => {
  const STAND = '20261104T030012Z';
  const sha = (text: string) => createHash('sha256').update(text).digest('hex');
  const NFC = 'Übung 1.md'.normalize('NFC');
  const NFD = 'Übung 1.md'.normalize('NFD');
  const standDir = (s: { target: string }) => join(s.target, STAND);
  const restoreTest = (s: { deps: RestoreDeps }) =>
    runRestore(s.deps, { stand: STAND, test: true, yes: false });
  const restoreFull = (s: { deps: RestoreDeps }) =>
    runRestore(s.deps, { stand: STAND, test: false, yes: true });

  /**
   * Unterscheidet das Dateisystem unter `dir` NFC- und NFD-Namen? (ext4: ja; APFS/HFS+: nein, dort lassen sich die
   * Fälle mit zwei Schreibweisen nicht nachstellen)
   */
  function distinguishesNfd(): boolean {
    const dir = mkdtempSync(join(tmpdir(), 'sg-nfd-'));
    try {
      writeFileSync(join(dir, NFC), '');
      return !existsSync(join(dir, NFD));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const twoForms = distinguishesNfd();

  it('Liste: Pfade werden in NFC geschrieben, gelesen und verglichen', () => {
    const sums = emptySums();
    sums.vault.set(`Ordner Ä/${NFD}`, sha('x'));
    const { text } = formatFileList(sums);
    expect(text).toBe(`${sha('x')}\tvault/${`Ordner Ä/${NFC}`.normalize('NFC')}\n`);
    expect(text.includes(NFD)).toBe(false);
    // Eine Liste mit NFD (etwa von Hand oder aus einer älteren Fassung) ergibt dieselben Schlüssel
    const parsed = parseFileList(`${sha('x')}\tvault/${NFD}\n`);
    expect([...(parsed?.vault.keys() ?? [])]).toEqual([NFC]);
  });

  it('Liste: zwei Pfade, die nach NFC gleich sind, sind ein Konflikt (Schreiben und Lesen)', () => {
    const sums = emptySums();
    sums.vault.set(NFC, sha('a'));
    sums.vault.set(NFD, sha('b'));
    expect(() => formatFileList(sums)).toThrow(NameConflictError);
    expect(parseFileList(`${sha('a')}\tvault/${NFC}\n${sha('b')}\tvault/${NFD}\n`)).toBeNull();
  });

  it('Umlaute, Leerzeichen und Tabs im Namen: Backup, --test und Restore', async () => {
    const s = restoreSetup();
    const name = 'Ä ö\tü ß.txt';
    mkdirSync(join(s.dataDir, 'vault', 'Grüße Ordner'));
    writeFileSync(join(s.dataDir, 'vault', 'Grüße Ordner', name), 'Inhalt');
    expect(await runBackup(s.backupDeps, { trigger: 'manuell' })).toBe(0);
    expect(readFileSync(join(standDir(s), 'files.sha256'), 'utf8')).toContain(
      `${sha('Inhalt')}\tvault/Grüße Ordner/${name}\n`,
    );
    expect(await restoreTest(s)).toBe(0);
    expect(await restoreFull(s)).toBe(0);
    expect(readFileSync(join(s.dataDir, 'vault', 'Grüße Ordner', name), 'utf8')).toBe('Inhalt');
  });

  it.skipIf(!twoForms)(
    'Ziel gibt Namen in NFD zurück, die Liste hat NFC: --test und Restore bestehen, wiederhergestellt wird der Name aus dem Stand, nur einmal',
    async () => {
      const s = restoreSetup();
      mkdirSync(join(s.dataDir, 'vault', 'Ärger'));
      writeFileSync(join(s.dataDir, 'vault', 'Ärger', NFC), 'Notiz');
      expect(await runBackup(s.backupDeps, { trigger: 'manuell' })).toBe(0);
      expect(readFileSync(join(standDir(s), 'files.sha256'), 'utf8')).toContain(`vault/Ärger/${NFC}\n`);
      // Wie ein normalisierendes Ziel (HFS+, NAS): Ordner und Datei stehen dort in NFD
      const nfdDir = 'Ärger'.normalize('NFD');
      renameSync(join(standDir(s), 'vault', 'Ärger'), join(standDir(s), 'vault', nfdDir));
      renameSync(join(standDir(s), 'vault', nfdDir, NFC), join(standDir(s), 'vault', nfdDir, NFD));
      expect(await restoreTest(s)).toBe(0);
      expect(s.logs.join('\n')).toMatch(/Prüfsummen \(media\/vault\): alle Dateien stimmen/);
      expect(await restoreFull(s)).toBe(0);
      expect(readdirSync(join(s.dataDir, 'vault')).sort()).toEqual(['n.md', nfdDir].sort());
      expect(readdirSync(join(s.dataDir, 'vault', nfdDir))).toEqual([NFD]);
      expect(readFileSync(join(s.dataDir, 'vault', nfdDir, NFD), 'utf8')).toBe('Notiz');
    },
  );

  it.skipIf(!twoForms)('Quelle schreibt NFD: die Liste trägt NFC, --test besteht', async () => {
    const s = restoreSetup();
    writeFileSync(join(s.dataDir, 'vault', NFD), 'Notiz');
    expect(await runBackup(s.backupDeps, { trigger: 'manuell' })).toBe(0);
    const list = readFileSync(join(standDir(s), 'files.sha256'), 'utf8');
    expect(list).toContain(`${sha('Notiz')}\tvault/${NFC}\n`);
    expect(list.includes(NFD)).toBe(false);
    expect(await restoreTest(s)).toBe(0);
  });

  it.skipIf(!twoForms)(
    'Kollision in der Quelle (NFC und NFD nebeneinander): Backup bricht mit klarer Meldung ab',
    async () => {
      const s = restoreSetup();
      writeFileSync(join(s.dataDir, 'vault', NFC), 'eins');
      writeFileSync(join(s.dataDir, 'vault', NFD), 'zwei');
      expect(await runBackup(s.backupDeps, { trigger: 'manuell' })).toBe(1);
      const run = [...s.pg.runs.values()][0];
      expect(run?.state).toBe('fehler');
      expect(run?.error).toMatch(/nur in der Unicode-Schreibweise \(NFC\/NFD\)/);
      expect(existsSync(standDir(s))).toBe(false);
    },
  );

  it.skipIf(!twoForms)(
    'Kollision im Stand (Angreifer legt einen NFD-Zwilling an): Restore bricht vor jeder Änderung ab, --test schlägt fehl',
    async () => {
      const s = restoreSetup();
      writeFileSync(join(s.dataDir, 'vault', NFC), 'Notiz');
      expect(await runBackup(s.backupDeps, { trigger: 'manuell' })).toBe(0);
      // Zwilling statt der Datei n.md: Anzahl und Größe bleiben gleich
      rmSync(join(standDir(s), 'vault', 'n.md'));
      writeFileSync(join(standDir(s), 'vault', NFD), '# Notiz');
      expect(await restoreFull(s)).toBe(1);
      expect(s.errs.join('\n')).toMatch(/gibt es doppelt/);
      expect(s.errs.join('\n')).toMatch(/deine Daten sind unverändert/);
      expect(readFileSync(join(s.dataDir, 'vault', 'n.md'), 'utf8')).toBe('# Notiz');
      expect(readdirSync(s.dataDir).filter((n) => /neu-|vor-restore|journal/.test(n))).toEqual([]);
      expect([...s.pg.databases]).toEqual(['sg']);
      expect(await restoreTest(s)).toBe(1);
      expect(s.logs.join('\n')).toMatch(/gibt es doppelt/);
    },
  );

  it.skipIf(!twoForms)(
    'Ordner-Zwilling im Stand (Dateien auf NFC- und NFD-Ordner verteilt): Restore bricht vor jeder Änderung ab',
    async () => {
      const s = restoreSetup();
      mkdirSync(join(s.dataDir, 'vault', 'Ärger'));
      writeFileSync(join(s.dataDir, 'vault', 'Ärger', 'a.md'), 'A');
      writeFileSync(join(s.dataDir, 'vault', 'Ärger', 'b.md'), 'B');
      expect(await runBackup(s.backupDeps, { trigger: 'manuell' })).toBe(0);
      // Jede Datei passt für sich zur Liste, liegt aber in einem von zwei Ordnern gleichen Namens
      const nfdDir = join(standDir(s), 'vault', 'Ärger'.normalize('NFD'));
      mkdirSync(nfdDir);
      renameSync(join(standDir(s), 'vault', 'Ärger', 'b.md'), join(nfdDir, 'b.md'));
      expect(await restoreFull(s)).toBe(1);
      expect(s.errs.join('\n')).toMatch(/Ordner vault\/.* gibt es doppelt/);
      expect([...s.pg.databases]).toEqual(['sg']);
      expect(await restoreTest(s)).toBe(1);
    },
  );

  it('zusätzliche Datei im Stand wird vor dem Kopieren erkannt und nie in den Datenordner kopiert', async () => {
    const s = restoreSetup();
    expect(await runBackup(s.backupDeps, { trigger: 'manuell' })).toBe(0);
    const manifestPath = join(standDir(s), 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      vault: { files: number; bytes: number };
    };
    // Angreifer passt Anzahl und Größe im Manifest an (nicht verankert), die Liste kann er nicht ändern
    writeFileSync(join(standDir(s), 'vault', 'gross.bin'), 'x'.repeat(1000));
    manifest.vault = { files: manifest.vault.files + 1, bytes: manifest.vault.bytes + 1000 };
    writeFileSync(manifestPath, JSON.stringify(manifest));
    expect(await restoreFull(s)).toBe(1);
    expect(s.errs.join('\n')).toMatch(/zusätzliche Datei vault\/gross\.bin/);
    expect(s.logs.join('\n')).not.toMatch(/Kopiere vault\//);
    expect([...s.pg.databases]).toEqual(['sg']);
  });
});
