import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  trigger: string;
  target: string;
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

  async query(sql: string, vars: Record<string, string> = {}, db?: string): Promise<string[][]> {
    this.queries.push({ sql, vars, db });
    if (sql.includes('Abgebrochen: kein Abschluss')) return [];
    if (sql.includes("NULLIF(:'id'")) return [[String(this.otherActive)]];
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
        Object.assign(run, { state: 'fertig', stand: vars.stand as string, size: vars.size as string });
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
    expect(s.pg.restored).toEqual([
      { db: `sg_restore_${stamp}`, file: join(s.target, '20261104T030012Z', 'db.dump') },
    ]);
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
    expect(validateTarget(join(parent, 'neu'), dataDir)).toBe(join(realpathSync(parent), 'neu'));
    expect(() => validateTarget(join(parent, 'a', 'b'), dataDir)).toThrow(/nicht vorhanden/);
  });

  it('löst Symlinks auf: Ergebnis ist der echte Pfad', () => {
    const dataDir = tmp();
    const real = tmp();
    const link = join(tmp(), 'link');
    symlinkSync(real, link);
    expect(validateTarget(link, dataDir)).toBe(realpathSync(real));
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
