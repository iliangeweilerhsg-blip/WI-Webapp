// Zugriff auf PostgreSQL für Backup und Restore: über Docker (`docker compose exec`) oder lokal (`psql`, `pg_dump`).
// Die CLI hat keinen Datenbanktreiber (keine neue Abhängigkeit), darum laufen alle Abfragen über `psql`.
// Passwörter gehen nie in Argumente oder Logs: lokal als `PGPASSWORD` in der Umgebung, im Container gar nicht
// nötig (Socket-Anmeldung des offiziellen Images).
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type { SgConfig } from './config.ts';

const composeArgs = (cfg: Pick<SgConfig, 'composeFile'>, ...rest: string[]): string[] => [
  'compose',
  '-f',
  cfg.composeFile,
  ...rest,
];

export interface ExecOptions {
  /** Text für stdin */
  input?: string;
  /** Datei, die als stdin dient */
  stdinFile?: string;
  /** stdout in diese Datei schreiben (binär, z. B. `pg_dump -Fc`) */
  stdoutFile?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
}

export interface ExecResult {
  code: number;
  stdout: string;
  /** Die letzten 64 KB */
  stderr: string;
}

export type Exec = (cmd: string, args: string[], options?: ExecOptions) => Promise<ExecResult>;

const MAX_STDOUT = 16 * 1024 * 1024;
const MAX_STDERR = 64 * 1024;

export const realExec: Exec = (cmd, args, options = {}) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...options.env } as NodeJS.ProcessEnv,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result: ExecResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = options.timeoutMs
      ? setTimeout(() => {
          child.kill('SIGKILL');
          finish({ code: 124, stdout, stderr: `${stderr}\nZeitüberschreitung nach ${options.timeoutMs} ms` });
        }, options.timeoutMs)
      : undefined;
    child.once('error', (error) => finish({ code: 127, stdout, stderr: error.message }));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-MAX_STDERR);
    });
    const outDone = options.stdoutFile
      ? pipeline(child.stdout, createWriteStream(options.stdoutFile, { mode: 0o600 })).catch(
          (error: Error) => {
            stderr += `\n${error.message}`;
          },
        )
      : new Promise<void>((done) => {
          child.stdout.setEncoding('utf8');
          child.stdout.on('data', (chunk: string) => {
            if (stdout.length < MAX_STDOUT) stdout += chunk;
          });
          child.stdout.once('end', done);
        });
    if (options.stdinFile) {
      pipeline(createReadStream(options.stdinFile), child.stdin).catch(() => {});
    } else {
      child.stdin.on('error', () => {});
      child.stdin.end(options.input ?? '');
    }
    child.once('close', (code, signal) => {
      void outDone.then(() => finish({ code: code ?? (signal ? 1 : 0), stdout, stderr }));
    });
  });

export interface DbUrl {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
}

export function parseDatabaseUrl(url: string): DbUrl {
  const u = new URL(url);
  return {
    host: u.hostname || '127.0.0.1',
    port: u.port || '5432',
    user: decodeURIComponent(u.username || 'sg'),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, '') || 'sg'),
  };
}

/** Bezeichner, die wir selbst bilden (Datenbanknamen). Alles andere wird abgelehnt statt maskiert. */
export function safeIdent(name: string): string {
  if (!/^[A-Za-z0-9_]{1,63}$/.test(name)) throw new Error(`Ungültiger Datenbankname: ${name}`);
  return name;
}

/** Entfernt Zugangsdaten aus Text, der in Logs oder `backup_run.error` landen kann */
export function scrubSecrets(text: string, secrets: string[] = []): string {
  let out = text.replace(/([a-z][a-z0-9+.-]*:\/\/[^:/@\s]*):[^@/\s]*@/gi, '$1:***@');
  out = out.replace(/PGPASSWORD=\S+/g, 'PGPASSWORD=***');
  for (const secret of secrets) if (secret.length >= 3) out = out.split(secret).join('***');
  return out;
}

export interface PgAccess {
  mode: 'docker' | 'local';
  /** Datenbankname aus `DATABASE_URL` */
  database: string;
  /**
   * SQL über `psql -f -` ausführen. `vars` stehen als `:'name'` zur Verfügung (sicher gequotet).
   * Rückgabe: Zeilen mit Spalten (psql-Ausgabe `-At`, getrennt durch \x1f). Wirft bei Fehlern mit bereinigter Meldung.
   */
  query(sql: string, vars?: Record<string, string>, db?: string): Promise<string[][]>;
  /** `pg_dump -Fc` der Datenbank in eine Datei */
  dump(file: string): Promise<void>;
  /** `pg_restore` einer Datei in eine (leere) Datenbank */
  restore(db: string, file: string): Promise<void>;
}

const SEP = '\x1f';

export function createPg(
  cfg: Pick<SgConfig, 'databaseUrl' | 'composeFile'>,
  exec: Exec,
  mode: 'docker' | 'local',
): PgAccess {
  const url = parseDatabaseUrl(cfg.databaseUrl);
  const compose = (...rest: string[]) => composeArgs(cfg, 'exec', '-T', 'db', ...rest);
  const secrets = [url.password];
  const fail = (what: string, result: ExecResult): Error => {
    const raw = result.stderr.trim();
    let reason = '';
    if (/could not connect|connection refused|Connection refused|server closed the connection/i.test(raw)) {
      reason = ' Die Datenbank ist nicht erreichbar (läuft sie? "pnpm sg start" startet sie).';
    } else if (/password authentication failed|authentication failed/i.test(raw)) {
      reason =
        ' Die Anmeldung an der Datenbank wurde abgelehnt (Benutzer oder Passwort in DATABASE_URL prüfen).';
    } else if (result.code === 127) {
      reason = ' Das Programm wurde nicht gefunden.';
    }
    return new Error(
      `${what}.${reason} Technische Details (Exit-Code ${result.code}): ${scrubSecrets(raw, secrets).slice(-400)}`,
    );
  };
  const env = mode === 'local' ? { PGPASSWORD: url.password } : undefined;
  const connArgs = (db: string): string[] =>
    mode === 'docker'
      ? ['-U', url.user, '-d', db]
      : ['-h', url.host, '-p', url.port, '-U', url.user, '-d', db];

  return {
    mode,
    database: url.database,
    async query(sql, vars = {}, db = url.database) {
      const varArgs = Object.entries(vars).flatMap(([k, v]) => ['-v', `${k}=${v}`]);
      const base = [
        'psql',
        ...connArgs(db),
        '-X',
        '-q',
        '-A',
        '-t',
        '-F',
        SEP,
        '-v',
        'ON_ERROR_STOP=1',
        ...varArgs,
        '-f',
        '-',
      ];
      const result =
        mode === 'docker'
          ? await exec('docker', compose(...base), { input: sql })
          : await exec(base[0] as string, base.slice(1), { input: sql, ...(env ? { env } : {}) });
      if (result.code !== 0) throw fail('Die Datenbank-Abfrage (psql) ist fehlgeschlagen', result);
      return result.stdout
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => line.split(SEP));
    },
    async dump(file) {
      const base = ['pg_dump', '-Fc', ...connArgs(url.database)];
      const result =
        mode === 'docker'
          ? await exec('docker', compose(...base), { stdoutFile: file })
          : await exec(base[0] as string, base.slice(1), { stdoutFile: file, ...(env ? { env } : {}) });
      if (result.code !== 0) throw fail('Die Sicherung der Datenbank (pg_dump) ist fehlgeschlagen', result);
    },
    async restore(db, file) {
      const flags = ['--no-owner', '--exit-on-error'];
      if (mode === 'docker') {
        const result = await exec('docker', compose('pg_restore', ...connArgs(db), ...flags), {
          stdinFile: file,
        });
        if (result.code !== 0) throw fail('Das Einspielen des Dumps (pg_restore) ist fehlgeschlagen', result);
      } else {
        const result = await exec('pg_restore', [...connArgs(db), ...flags, file], { env: env ?? {} });
        if (result.code !== 0) throw fail('Das Einspielen des Dumps (pg_restore) ist fehlgeschlagen', result);
      }
    },
  };
}

/**
 * Wählt Docker (läuft der Container `db`?) oder lokale Werkzeuge (`pg_dump` im PATH).
 * `SG_PG_MODE=docker|local` erzwingt eine Seite.
 */
export async function openPg(
  cfg: Pick<SgConfig, 'databaseUrl' | 'composeFile'>,
  exec: Exec,
  forced: string | undefined = process.env.SG_PG_MODE,
): Promise<PgAccess> {
  if (forced === 'docker' || forced === 'local') return createPg(cfg, exec, forced);
  const ps = await exec('docker', composeArgs(cfg, 'ps', '-q', 'db'));
  if (ps.code === 0 && ps.stdout.trim() !== '') return createPg(cfg, exec, 'docker');
  const local = await exec('pg_dump', ['--version']);
  if (local.code === 0) return createPg(cfg, exec, 'local');
  throw new Error(
    'Weder der Datenbank-Container (docker compose, Dienst "db") läuft noch ist "pg_dump" installiert. ' +
      'Starte die Datenbank mit "pnpm sg start" oder installiere die PostgreSQL-Werkzeuge.',
  );
}
