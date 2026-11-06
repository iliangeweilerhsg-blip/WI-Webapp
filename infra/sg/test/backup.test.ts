import {
  existsSync,
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
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveConfig } from '../src/config.ts';
import { copyTree, listStands, readManifest, standName, treeSize } from '../src/backup-files.ts';
import {
  backupBeforeMigrate,
  parseBackupArgs,
  parseRestoreArgs,
  preMigrationBackup,
} from '../src/backup-commands.ts';
import { errorText, runBackup, validateTarget, type BackupDeps } from '../src/backup.ts';
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

const dirs: string[] = [];
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

  async query(sql: string, vars: Record<string, string> = {}, db?: string): Promise<string[][]> {
    this.queries.push({ sql, vars, db });
    if (sql.includes('Abgebrochen: kein Abschluss')) return [];
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
        .map((r) => [r.stand as string, r.sha as string]);
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
  const deps: BackupDeps = {
    cfg: { dataDir, databaseUrl: 'postgres://sg:geheim-pw@127.0.0.1:5432/sg' },
    pg,
    log: (m) => logs.push(m),
    err: (m) => errs.push(m),
    now: () => new Date('2026-11-04T03:00:12Z'),
    newId: () => '019a4e14-0000-7000-8000-0000000000aa',
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

describe('H3 (#124): Warnung, wenn ein alter Stand über mehrere Läufe stehen bleibt', () => {
  /** Alter Stand mit Manifest im Ziel */
  function oldStand(target: string, name: string): string {
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
    const stuck = oldStand(target, '20261001T030000Z');
    oldStand(target, '20261001T040000Z');
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
    expect(second?.warning).toMatch(
      /seit mehreren Läufen nicht entfernen: 20261001T030000Z \(Keine Berechtigung \(EPERM\)/,
    );
    expect(second?.warning?.length).toBeLessThanOrEqual(500);
    expect(errs.join('\n')).toMatch(/Warnung: Im Backup-Ziel lässt sich ein alter Stand/);

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
