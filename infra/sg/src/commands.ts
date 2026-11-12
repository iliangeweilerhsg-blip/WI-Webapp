// Die Befehle start, stop, migrate, doctor, backup, restore, moodle.
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { HealthSchema, type Health } from '@sg/shared';
import {
  backupBeforeMigrate,
  backupCommand,
  recoverRestoreIfOpen,
  restoreCommand,
} from './backup-commands.ts';
import type { CommandName } from './cli.ts';
import { appUrl, childEnv, CORE_STOP_TIMEOUT_S, healthUrl, type SgConfig } from './config.ts';
import { checkCoreLock, doctorExitCode, formatChecks, realLockDoctorIo, runChecks } from './doctor.ts';
import { checkIpadApp, ipadCommand } from './ipad-hint.ts';
import { moodleCommand, realMoodleDeps } from './moodle.ts';
import {
  clearStopMarker,
  createLinePrefixer,
  ensureDataDir,
  groupAlive,
  hasFile,
  readService,
  removePid,
  setStopMarker,
  signalGroup,
  sleep,
  stopRequested,
  terminateGroup,
  writePid,
  type ServiceName,
  type TerminateOptions,
} from './procs.ts';
import { realSystem } from './system.ts';
import {
  ensureTunnelBuild,
  superviseTunnel,
  tunnelBinaryProblem,
  tunnelCommand,
  tunnelEnv,
  TUNNEL_EXIT_CONFIG,
  TUNNEL_STOP_TIMEOUT_S,
  type TunnelBuildIo,
  type TunnelExit,
} from './tunnel.ts';
import { realTunnelDoctorIo, runTunnelChecks } from './tunnel-doctor.ts';
import { ensureWebBuild, type PrepareIo } from './webbuild.ts';

const log = (msg: string): void => console.log(`[sg] ${msg}`);
const err = (msg: string): void => console.error(`[sg] ${msg}`);

export type HealthVerdict =
  | { state: 'ready'; health: Health }
  | { state: 'db-error'; health: Health }
  | { state: 'invalid'; error: string };

/** Bewertet eine Antwort von GET /api/v1/health gegen den Typ `Health` aus @sg/shared. */
export function evaluateHealth(body: unknown): HealthVerdict {
  const r = HealthSchema.safeParse(body);
  if (!r.success) return { state: 'invalid', error: r.error.message };
  return r.data.db === 'ok' ? { state: 'ready', health: r.data } : { state: 'db-error', health: r.data };
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

export interface MigrateOptions {
  /** Backup vor ausstehenden Migrationen überspringen (`--ohne-backup`) */
  skipBackup?: boolean;
}

export async function migrate(cfg: SgConfig, options: MigrateOptions = {}): Promise<number> {
  if (!availability(cfg.repoRoot).core) {
    err('services/core fehlt noch (Ticket T0-04). Migrationen sind erst danach möglich.');
    return 1;
  }
  // Backup mit trigger = vor_migration (VERTRAEGE §13), wenn Migrationen ausstehen und ein Ziel eingestellt ist
  if (!options.skipBackup && !(await backupBeforeMigrate(cfg))) return 1;
  log('Führe Datenbank-Migrationen aus …');
  const code = await runInherit('pnpm', ['--filter', '@sg/core', 'migrate'], cfg);
  if (code !== 0)
    err(`Migration fehlgeschlagen (Exit-Code ${code}). Läuft die Datenbank? Prüfen: "pnpm sg doctor".`);
  return code;
}

async function waitForHealthy(cfg: SgConfig, dead: () => string | null, timeoutMs = 60000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let warnedDb = false;
  while (Date.now() < deadline) {
    if (dead()) return false;
    try {
      const res = await fetch(healthUrl(cfg), { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const verdict = evaluateHealth(await res.json());
        if (verdict.state === 'ready') {
          log(`Core ist bereit (Version ${verdict.health.version}, Datenbank: ${verdict.health.db}).`);
          return true;
        }
        if (verdict.state === 'invalid') {
          err(`Antwort von ${healthUrl(cfg)} entspricht nicht dem Typ Health: ${verdict.error}`);
          return false;
        }
        if (!warnedDb) {
          warnedDb = true;
          err('Core läuft, meldet aber einen Datenbank-Fehler (db: "fehler"). Warte weiter …');
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
  child: ChildProcess;
  /** Der Anführer (pnpm/uv) ist beendet. */
  exited: boolean;
  /** Exit-Code und Signal des Anführers, sobald er beendet ist (UX-12: der Tunnel-Helfer meldet Konfigurationsfehler mit 78). */
  exitCode: number | null;
  exitSignal: NodeJS.Signals | null;
  exitedPromise: Promise<void>;
  /** Anführer beendet und alle Ausgabekanäle geschlossen (Enkel halten Pipes offen). */
  closed: Promise<void>;
}

/**
 * Core direkt mit Node starten, mit demselben Einstieg wie das `start`-Skript von `@sg/core` (`node src/main.ts`,
 * ein Test hält beides gleich). Über `pnpm --filter … start` würde pnpm beim gewollten Beenden (SIGTERM) zusätzlich
 * `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL` und `ELIFECYCLE` ausgeben, obwohl alles sauber endet. Nebenbei entfällt ein
 * Zwischenprozess in der Prozessgruppe.
 */
export const CORE_ENTRY = 'src/main.ts';

export function coreCommand(cfg: SgConfig): { cmd: string; args: string[]; cwd: string } {
  return { cmd: process.execPath, args: [CORE_ENTRY], cwd: join(cfg.repoRoot, 'services', 'core') };
}

function startService(
  cfg: SgConfig,
  name: ServiceName,
  cmd: string,
  args: string[],
  cwd = cfg.repoRoot,
  env: Record<string, string> = childEnv(cfg, process.env),
): Service {
  const child = spawn(cmd, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true, // eigene Prozessgruppe (pgid === pid)
  });
  let markExited!: () => void;
  let markClosed!: () => void;
  const svc: Service = {
    name,
    child,
    exited: false,
    exitCode: null,
    exitSignal: null,
    exitedPromise: new Promise<void>((r) => (markExited = r)),
    closed: new Promise<void>((r) => (markClosed = r)),
  };
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
  child.once('error', (e) => {
    err(`${name}: Start fehlgeschlagen: ${e.message}`);
    svc.exited = true;
    markExited();
    markClosed();
  });
  child.once('exit', (code, signal) => {
    svc.exited = true;
    svc.exitCode = code;
    svc.exitSignal = signal;
    markExited();
  });
  child.once('close', () => markClosed());
  if (child.pid !== undefined) {
    try {
      writePid(cfg, name, child.pid);
    } catch (e) {
      signalGroup(child.pid, 'SIGKILL');
      throw e;
    }
  }
  return svc;
}

function stopOptions(cfg: SgConfig, name: ServiceName, force?: () => boolean): TerminateOptions {
  const worker = name === 'worker';
  const graceS = worker
    ? cfg.workerStopTimeoutS
    : name === 'tunnel'
      ? TUNNEL_STOP_TIMEOUT_S
      : CORE_STOP_TIMEOUT_S;
  return {
    graceMs: graceS * 1000,
    // uv leitet SIGTERM an Python weiter; ein Signal an die ganze Gruppe träfe Python doppelt.
    leaderOnly: worker,
    force,
    onWait: () =>
      log(
        worker
          ? `Worker: warte auf laufenden Job … (bis zu ${graceS} s, zweites Strg+C bricht sofort ab)`
          : name === 'tunnel'
            ? `Tunnel-Helfer: warte auf sauberes Beenden … (bis zu ${graceS} s)`
            : `Core: warte auf sauberes Beenden … (bis zu ${graceS} s)`,
      ),
  };
}

function prepareIo(cfg: SgConfig): PrepareIo {
  return { run: (cmd, args) => runInherit(cmd, args, cfg), log, err, hasFile };
}

function tunnelBuildIo(cfg: SgConfig): TunnelBuildIo {
  return {
    platform: process.platform,
    hasFile,
    hasSwift: async () => (await realSystem().run('swift', ['--version'])).ok,
    run: (cmd, args) => runInherit(cmd, args, cfg),
    log,
    err,
  };
}

export async function start(cfg: SgConfig): Promise<number> {
  const avail = availability(cfg.repoRoot);
  if (!avail.core) {
    err('services/core fehlt noch (Ticket T0-04). Core kann nicht gestartet werden.');
    return 1;
  }

  const existing = (['core', 'worker', 'tunnel'] as const).filter((n) => readService(cfg, n) !== null);
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
  clearStopMarker(cfg);

  // UX-17: Haben sich die iPad-Quellen seit dem bestätigten Aufspielen geändert? Der Hinweis erscheint, sobald alles läuft.
  const ipadNote = checkIpadApp(cfg);

  log('Starte PostgreSQL (docker compose) …');
  const up = await runInherit('docker', composeArgs(cfg, 'up', '-d', '--wait'), cfg);
  if (up !== 0) {
    err('Datenbank konnte nicht gestartet werden. Läuft Docker? Prüfen mit "pnpm sg doctor".');
    return 1;
  }

  // Ein unterbrochener Restore wird zuerst abgeschlossen oder zurückgebaut (Journal im Datenordner)
  if (!(await recoverRestoreIfOpen(cfg))) return 1;

  await ensureWebBuild(cfg, prepareIo(cfg), avail.web);

  // UX-12: Der Tunnel-Helfer wird bei Bedarf gebaut. Scheitert das, läuft der Rest trotzdem (nur ohne Direktverbindung).
  const tunnelBuild = await ensureTunnelBuild(cfg, tunnelBuildIo(cfg));

  if ((await migrate(cfg)) !== 0) return 1;

  const services: Service[] = [];
  let tunnel: Service | null = null;
  let tunnelLoop: Promise<void> | null = null;
  let shuttingDown = false;
  let forced = false;
  let shutdownPromise: Promise<void> | null = null;
  let exitCode = 0;

  // waitOnly: `sg stop` signalisiert selbst – dann nur warten, sonst bekommen die Dienste das Signal doppelt.
  const shutdown = (reason: string, waitOnly = false): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;
    shuttingDown = true;
    log(`${reason} – beende Tunnel-Helfer, Core und Worker …`);
    const terminate = async (s: Service): Promise<void> => {
      const pid = s.child.pid;
      if (pid === undefined) return;
      const gone = await terminateGroup(pid, { ...stopOptions(cfg, s.name, () => forced), waitOnly });
      if (gone) removePid(cfg, s.name);
      else err(`${s.name}: Prozessgruppe ${pid} ließ sich nicht beenden.`);
    };
    // Der Helfer zuerst: Er reicht an den Core weiter und braucht ihn nicht mehr, wenn er beendet wird.
    shutdownPromise = (async () => {
      if (tunnel) await terminate(tunnel);
      await Promise.all(services.map(terminate));
    })();
    return shutdownPromise;
  };

  let signalCount = 0;
  const onSignal = (sig: NodeJS.Signals): void => {
    signalCount++;
    if (signalCount === 1) {
      if (shutdownPromise) log('Wird bereits beendet – erneut Strg+C zum sofortigen Abbruch.');
      void shutdown(`${sig} empfangen`);
    } else if (!forced) {
      forced = true;
      exitCode = 130;
      err(`Zweites Signal (${sig}) – sende SIGKILL an alle Prozessgruppen.`);
      for (const s of tunnel ? [tunnel, ...services] : services) {
        if (s.child.pid !== undefined) signalGroup(s.child.pid, 'SIGKILL');
      }
    }
  };
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
  for (const sig of signals) process.on(sig, onSignal);
  // Letzter Versuch, falls sg selbst unerwartet endet: keine verwaisten Gruppen hinterlassen.
  const onProcessExit = (): void => {
    for (const s of tunnel ? [tunnel, ...services] : services) {
      if (s.child.pid !== undefined && groupAlive(s.child.pid)) signalGroup(s.child.pid, 'SIGKILL');
    }
  };
  process.on('exit', onProcessExit);

  try {
    const core = coreCommand(cfg);
    services.push(startService(cfg, 'core', core.cmd, core.args, core.cwd));
    if (avail.worker) {
      services.push(startService(cfg, 'worker', 'uv', ['run', '--project', 'services/worker', 'sg-worker']));
    } else {
      err('services/worker fehlt noch (Ticket T0-05). Es läuft nur der Core, Jobs werden nicht verarbeitet.');
    }
  } catch (e) {
    err(`Dienste konnten nicht gestartet werden: ${(e as Error).message}`);
    exitCode = 1;
    forced = true;
    await shutdown('Startfehler');
  }

  // Stirbt ein Dienst unerwartet, wird der andere ebenfalls beendet. Nach `sg stop` ist das gewollt.
  for (const s of services) {
    s.child.once('exit', (code, signal) => {
      log(`${s.name} beendet (${signal ?? `Exit-Code ${code}`}).`);
      if (shuttingDown) return;
      if (stopRequested(cfg)) {
        void shutdown('"sg stop" erkannt', true);
      } else {
        exitCode = 1;
        void shutdown(`${s.name} ist unerwartet beendet`);
      }
    });
  }

  if (!shuttingDown) {
    const ready = await waitForHealthy(cfg, () => {
      const dead = services.find((s) => s.exited);
      return dead ? dead.name : null;
    });
    if (!shuttingDown) {
      if (ready) {
        log(`Studien-Gehirn läuft: ${appUrl(cfg)}`);
        if (ipadNote !== null) for (const line of ipadNote.split('\n')) log(line);
        log('Mit Strg+C beenden.');
        // Der Helfer startet erst jetzt, nach dem Core, und wird überwacht (Neustart nach Absturz mit Grenze)
        if (tunnelBuild.status === 'ready') {
          tunnelLoop = superviseTunnel({
            spawn: async (): Promise<TunnelExit> => {
              // Vor jedem Start: Nie eine fremde oder von anderen austauschbare Binärdatei starten
              const problem = tunnelBinaryProblem(cfg);
              if (problem !== null) {
                err(
                  `Tunnel-Helfer wird nicht gestartet: ${problem} Abhilfe: apps/mac-tunnel/.build löschen, ` +
                    '"pnpm sg stop" und "pnpm sg start" (baut neu).',
                );
                return { code: TUNNEL_EXIT_CONFIG, signal: null };
              }
              removePid(cfg, 'tunnel');
              const command = tunnelCommand(cfg);
              // Eigene, schlanke Umgebung: keine Datenbank-URL, keine API-Schlüssel im Prozess, der im Funk lauscht
              const svc = startService(
                cfg,
                'tunnel',
                command.cmd,
                command.args,
                command.cwd,
                tunnelEnv(process.env),
              );
              tunnel = svc;
              await svc.exitedPromise;
              return { code: svc.exitCode, signal: svc.exitSignal };
            },
            isStopping: () => shuttingDown || stopRequested(cfg),
            sleep,
            now: () => Date.now(),
            log,
            err,
          });
        }
        if (process.platform === 'darwin') {
          const opener = spawn('open', [appUrl(cfg)], { stdio: 'ignore', detached: true });
          opener.on('error', (e) =>
            err(`Browser konnte nicht geöffnet werden (${e.message}). Bitte ${appUrl(cfg)} öffnen.`),
          );
          opener.unref();
        }
      } else {
        err(`Core antwortet nicht wie erwartet unter ${healthUrl(cfg)}. Logs oben prüfen.`);
        exitCode = 1;
        await shutdown('Core nicht bereit');
      }
    }
  }

  await Promise.all(services.map((s) => s.exitedPromise));
  if (shutdownPromise) await shutdownPromise;
  if (tunnelLoop) await tunnelLoop;
  // Enkel können die Pipes noch kurz offen halten; nicht ewig darauf warten.
  // Der Timer wird danach gelöscht, sonst hielte er den Prozess 3 s am Leben.
  let giveUp: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.all(services.map((s) => s.closed)),
    new Promise<void>((resolve) => (giveUp = setTimeout(resolve, 3000))),
  ]);
  clearTimeout(giveUp);

  for (const sig of signals) process.off(sig, onSignal);
  process.off('exit', onProcessExit);
  return exitCode;
}

/** Reihenfolge beim Beenden: erst der Tunnel-Helfer (er reicht an den Core weiter), dann der Worker, zuletzt der Core. */
export const STOP_ORDER = ['tunnel', 'worker', 'core'] as const satisfies readonly ServiceName[];

/** Beendet die von sg gestarteten Dienste in `STOP_ORDER`. true, wenn alle weg sind. */
export async function stopServices(cfg: SgConfig): Promise<boolean> {
  let ok = true;
  setStopMarker(cfg);
  try {
    for (const name of STOP_ORDER) {
      const pid = readService(cfg, name);
      if (pid === null) continue;
      log(`Beende ${name} (Prozessgruppe ${pid}) …`);
      if (await terminateGroup(pid, stopOptions(cfg, name))) removePid(cfg, name);
      else {
        err(`${name} (Prozessgruppe ${pid}) ließ sich nicht beenden.`);
        ok = false;
      }
    }
  } finally {
    clearStopMarker(cfg);
  }
  return ok;
}

export async function stop(cfg: SgConfig): Promise<number> {
  if (!(await stopServices(cfg))) {
    err('Die Datenbank wird nicht gestoppt, solange Core oder Worker noch laufen.');
    return 1;
  }
  log('Stoppe PostgreSQL (docker compose stop) …');
  const code = await runInherit('docker', composeArgs(cfg, 'stop'), cfg);
  if (code !== 0) {
    err(
      'docker compose stop ist fehlgeschlagen (läuft Docker?). Die Datenbank war evtl. gar nicht gestartet.',
    );
    return 1;
  }
  return 0;
}

export async function doctor(cfg: SgConfig): Promise<number> {
  const sys = realSystem();
  const results = [
    ...(await runChecks(sys, cfg)),
    await checkCoreLock(cfg, realLockDoctorIo(cfg)),
    ...(await runTunnelChecks(cfg, realTunnelDoctorIo(cfg, sys))),
  ];
  console.log(formatChecks(results));
  return doctorExitCode(results);
}

export async function dispatch(command: CommandName, cfg: SgConfig, rest: string[] = []): Promise<number> {
  switch (command) {
    case 'start':
      return start(cfg);
    case 'stop':
      return stop(cfg);
    case 'migrate': {
      const unknown = rest.filter((a) => a !== '--ohne-backup');
      if (unknown.length > 0) {
        err(`Unbekannte Option "${unknown[0]}". Erlaubt: --ohne-backup.`);
        return 1;
      }
      return migrate(cfg, { skipBackup: rest.includes('--ohne-backup') });
    }
    case 'doctor':
      return doctor(cfg);
    case 'backup':
      return backupCommand(cfg, rest);
    case 'restore':
      return restoreCommand(cfg, rest);
    case 'moodle':
      return moodleCommand(cfg, rest, realMoodleDeps());
    case 'ipad':
      return ipadCommand(cfg, rest);
  }
}
