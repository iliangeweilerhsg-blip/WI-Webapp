// Die Befehle start, stop, migrate, doctor, backup, restore.
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { HealthSchema, type Health } from '@sg/shared';
import type { CommandName } from './cli.ts';
import { appUrl, childEnv, healthUrl, type SgConfig } from './config.ts';
import { doctorExitCode, formatChecks, runChecks } from './doctor.ts';
import {
  createLinePrefixer,
  ensureDataDir,
  hasFile,
  isAlive,
  readPid,
  removePid,
  sleep,
  terminateGroup,
  writePid,
  type ServiceName,
} from './procs.ts';
import { realSystem } from './system.ts';

const log = (msg: string): void => console.log(`[sg] ${msg}`);
const err = (msg: string): void => console.error(`[sg] ${msg}`);

/** Prüft eine Antwort von GET /api/v1/health gegen den Typ `Health` aus @sg/shared. */
export function parseHealth(body: unknown): Health | null {
  const r = HealthSchema.safeParse(body);
  return r.success ? r.data : null;
}

export function composeArgs(cfg: SgConfig, ...rest: string[]): string[] {
  return ['compose', '-f', cfg.composeFile, ...rest];
}

/** Welche Bausteine im Repo vorhanden sind (Core/Worker entstehen in eigenen Tickets). */
export function availability(repoRoot: string): { core: boolean; worker: boolean; web: boolean } {
  return {
    core: hasFile(join(repoRoot, 'services', 'core', 'package.json')),
    worker: hasFile(join(repoRoot, 'services', 'worker', 'pyproject.toml')),
    web: hasFile(join(repoRoot, 'apps', 'web', 'package.json')),
  };
}

/** Führt einen Befehl im Vordergrund aus, Ausgabe geht direkt ins Terminal. */
function runInherit(cmd: string, args: string[], cfg: SgConfig, cwd = cfg.repoRoot): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: 'inherit', env: childEnv(cfg, process.env) });
    child.once('error', (e) => {
      err(`"${cmd}" konnte nicht gestartet werden: ${e.message}`);
      resolve(127);
    });
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

export async function migrate(cfg: SgConfig): Promise<number> {
  if (!availability(cfg.repoRoot).core) {
    err('services/core fehlt noch (Ticket T0-04). Migrationen sind erst danach möglich.');
    return 1;
  }
  log('Führe Datenbank-Migrationen aus …');
  const code = await runInherit('pnpm', ['--filter', '@sg/core', 'migrate'], cfg);
  if (code !== 0)
    err(`Migration fehlgeschlagen (Exit-Code ${code}). Läuft die Datenbank? Prüfen: "pnpm sg doctor".`);
  return code;
}

async function waitForHealthy(cfg: SgConfig, dead: () => string | null, timeoutMs = 60000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (dead()) return false;
    try {
      const res = await fetch(healthUrl(cfg), { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const health = parseHealth(await res.json());
        if (health) {
          log(`Core ist bereit (Version ${health.version}, Datenbank: ${health.db}).`);
          return true;
        }
      }
    } catch {
      // Core startet noch.
    }
    await sleep(500);
  }
  return false;
}

interface Service {
  name: ServiceName;
  cmd: string;
  args: string[];
  child: ChildProcess;
  exited: boolean;
}

function startService(cfg: SgConfig, name: ServiceName, cmd: string, args: string[]): Service {
  const child = spawn(cmd, args, {
    cwd: cfg.repoRoot,
    env: childEnv(cfg, process.env),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true, // eigene Prozessgruppe, damit Strg+C nicht ungeordnet alles trifft
  });
  const svc: Service = { name, cmd, args, child, exited: false };
  const prefix = `[${name}]`;
  for (const [stream, out] of [
    [child.stdout, console.log],
    [child.stderr, console.error],
  ] as const) {
    const p = createLinePrefixer(prefix, (l) => out(l));
    stream?.setEncoding('utf8');
    stream?.on('data', (c: string) => p.push(c));
    stream?.on('end', () => p.flush());
  }
  if (child.pid !== undefined) writePid(cfg, name, child.pid);
  child.once('error', (e) => {
    err(`${name}: Start fehlgeschlagen: ${e.message}`);
    svc.exited = true;
  });
  child.once('exit', (code, signal) => {
    svc.exited = true;
    removePid(cfg, name);
    log(`${name} beendet (${signal ?? `Exit-Code ${code}`}).`);
  });
  return svc;
}

export async function start(cfg: SgConfig): Promise<number> {
  const avail = availability(cfg.repoRoot);

  const existing = (['core', 'worker'] as const).filter((n) => {
    const pid = readPid(cfg, n);
    return pid !== null && isAlive(pid);
  });
  if (existing.length > 0) {
    err(`${existing.join(' und ')} läuft bereits. Zuerst "pnpm sg stop" ausführen.`);
    return 1;
  }

  log(`Datenordner: ${cfg.dataDir}`);
  try {
    ensureDataDir(cfg);
  } catch (e) {
    err(
      `Datenordner konnte nicht angelegt werden: ${(e as Error).message}. Mit SG_DATA_DIR einen anderen Ordner wählen.`,
    );
    return 1;
  }

  if (!avail.core) {
    err('services/core fehlt noch (Ticket T0-04). Core kann nicht gestartet werden.');
    return 1;
  }

  log('Starte PostgreSQL (docker compose) …');
  const up = await runInherit('docker', composeArgs(cfg, 'up', '-d', '--wait'), cfg);
  if (up !== 0) {
    err('Datenbank konnte nicht gestartet werden. Läuft Docker? Prüfen mit "pnpm sg doctor".');
    return 1;
  }

  if (!hasFile(join(cfg.webDir, 'index.html'))) {
    if (avail.web) {
      log('Static Export der Web-App fehlt, baue ihn (pnpm --filter @sg/web build) …');
      const code = await runInherit('pnpm', ['--filter', '@sg/web', 'build'], cfg);
      if (code !== 0) {
        err(
          'Build der Web-App fehlgeschlagen. Der Core startet trotzdem, liefert aber keine Oberfläche aus.',
        );
      }
    } else {
      err(`Web-App fehlt noch (Ticket T0-06, erwartet in ${cfg.webDir}). Core startet nur mit der API.`);
    }
  }

  if ((await migrate(cfg)) !== 0) return 1;

  const services: Service[] = [];
  services.push(startService(cfg, 'core', 'pnpm', ['--filter', '@sg/core', 'start']));
  if (avail.worker) {
    services.push(startService(cfg, 'worker', 'uv', ['run', '--project', 'services/worker', 'sg-worker']));
  } else {
    err('services/worker fehlt noch (Ticket T0-05). Es läuft nur der Core, Jobs werden nicht verarbeitet.');
  }

  let shuttingDown = false;
  let exitCode = 0;
  const shutdown = async (reason: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`${reason} – beende Core und Worker …`);
    await Promise.all(
      services.map(async (s) => {
        const pid = s.child.pid;
        if (pid !== undefined && !s.exited) await terminateGroup(pid);
        removePid(cfg, s.name);
      }),
    );
  };

  const onSignal = (sig: NodeJS.Signals): void => {
    void shutdown(`${sig} empfangen`);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  const allExited = Promise.all(
    services.map(
      (s) => new Promise<void>((resolve) => (s.exited ? resolve() : s.child.once('exit', () => resolve()))),
    ),
  );

  // Stirbt ein Dienst unerwartet, wird der andere ebenfalls beendet.
  for (const s of services) {
    s.child.once('exit', (code) => {
      if (!shuttingDown) {
        exitCode = code === 0 ? 0 : 1;
        void shutdown(`${s.name} ist unerwartet beendet`);
      }
    });
  }

  const ready = await waitForHealthy(cfg, () => {
    const dead = services.find((s) => s.exited);
    return dead ? dead.name : null;
  });
  if (!shuttingDown) {
    if (ready) {
      log(`Studien-Gehirn läuft: ${appUrl(cfg)}`);
      log('Mit Strg+C beenden.');
      if (process.platform === 'darwin') {
        spawn('open', [appUrl(cfg)], { stdio: 'ignore', detached: true }).unref();
      }
    } else {
      err(`Core antwortet nicht unter ${healthUrl(cfg)}. Logs oben prüfen.`);
      exitCode = 1;
      await shutdown('Core nicht erreichbar');
    }
  }

  await allExited;
  return exitCode;
}

export async function stop(cfg: SgConfig): Promise<number> {
  let failed = false;
  for (const name of ['worker', 'core'] as const) {
    const pid = readPid(cfg, name);
    if (pid === null) continue;
    if (!isAlive(pid)) {
      removePid(cfg, name);
      continue;
    }
    log(`Beende ${name} (PID ${pid}) …`);
    if (await terminateGroup(pid)) removePid(cfg, name);
    else {
      err(`${name} (PID ${pid}) ließ sich nicht beenden.`);
      failed = true;
    }
  }
  log('Stoppe PostgreSQL (docker compose stop) …');
  const code = await runInherit('docker', composeArgs(cfg, 'stop'), cfg);
  if (code !== 0) {
    err(
      'docker compose stop ist fehlgeschlagen (läuft Docker?). Die Datenbank war evtl. gar nicht gestartet.',
    );
    failed = true;
  }
  return failed ? 1 : 0;
}

export async function doctor(cfg: SgConfig): Promise<number> {
  const results = await runChecks(realSystem(), cfg);
  console.log(formatChecks(results));
  return doctorExitCode(results);
}

export function placeholder(command: 'backup' | 'restore'): number {
  err(`"sg ${command}" kommt mit T1-18.`);
  return 2;
}

export async function dispatch(command: CommandName, cfg: SgConfig): Promise<number> {
  switch (command) {
    case 'start':
      return start(cfg);
    case 'stop':
      return stop(cfg);
    case 'migrate':
      return migrate(cfg);
    case 'doctor':
      return doctor(cfg);
    case 'backup':
    case 'restore':
      return placeholder(command);
  }
}
