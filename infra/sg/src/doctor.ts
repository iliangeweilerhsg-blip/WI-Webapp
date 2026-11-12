// `sg doctor`: prüft die Voraussetzungen und liefert eine Checkliste mit Lösungshinweisen.
import { closeSync, fstatSync, lstatSync, openSync, readSync, type Stats } from 'node:fs';
import { join } from 'node:path';
import { DB_PORT, healthUrl, type SgConfig } from './config.ts';
import { processAlive } from './liveness.ts';
import { READ_FLAGS } from './nofollow.ts';
import type { System } from './system.ts';

export type CheckStatus = 'ok' | 'fail' | 'info';

export interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
  /** Konkreter Lösungshinweis, nur bei `fail`. */
  hint?: string;
}

/** Darunter weist `sg doctor` auf knappen Speicher im Datenordner hin (Hinweis, kein Fehler). */
export const MIN_FREE_BYTES = 10 * 1024 ** 3;

export const MIN_NODE = { major: 22, minor: 18 } as const;

export function parseVersion(version: string): { major: number; minor: number; patch: number } | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

export function checkNode(version: string): CheckResult {
  const name = `Node.js ≥ ${MIN_NODE.major}.${MIN_NODE.minor}`;
  const v = parseVersion(version);
  const ok = v !== null && v.major === MIN_NODE.major && v.minor >= MIN_NODE.minor;
  if (ok) return { name, status: 'ok', detail: `v${version}` };
  return {
    name,
    status: 'fail',
    detail: `v${version} gefunden`,
    hint: `Node ${MIN_NODE.major}.${MIN_NODE.minor} oder neuer (22.x) installieren, z. B. "nvm install 22" (die Datei .nvmrc legt die Version fest).`,
  };
}

async function checkTool(
  sys: System,
  name: string,
  cmd: string,
  args: string[],
  hint: string,
): Promise<CheckResult> {
  const r = await sys.run(cmd, args);
  if (!r.ok) return { name, status: 'fail', detail: 'nicht gefunden', hint };
  return { name, status: 'ok', detail: firstLine(r.stdout) };
}

function firstLine(text: string): string {
  return text.split('\n')[0]?.trim() ?? '';
}

export async function checkDocker(sys: System): Promise<CheckResult> {
  const name = 'Docker';
  const version = await sys.run('docker', ['--version']);
  if (!version.ok) {
    return {
      name,
      status: 'fail',
      detail: 'nicht installiert',
      hint: 'Docker Desktop oder OrbStack installieren (siehe infra/README.md).',
    };
  }
  const info = await sys.run('docker', ['info']);
  if (!info.ok) {
    return {
      name,
      status: 'fail',
      detail: 'läuft nicht',
      hint: 'Docker Desktop bzw. OrbStack starten und warten, bis es bereit ist. Danach "pnpm sg doctor" erneut ausführen.',
    };
  }
  const compose = await sys.run('docker', ['compose', 'version']);
  if (!compose.ok) {
    return {
      name,
      status: 'fail',
      detail: 'läuft, aber "docker compose" fehlt',
      hint: 'Das Compose-Plugin installieren bzw. Docker Desktop/OrbStack aktualisieren.',
    };
  }
  return { name, status: 'ok', detail: `läuft (${firstLine(version.stdout)})` };
}

export async function checkPort(
  sys: System,
  port: number,
  hosts: string[],
  what: string,
  /** Satz(e), die zum Port passen; danach folgt immer der Hinweis auf "lsof" */
  hint: string,
): Promise<CheckResult> {
  const name = `Port ${port} frei (${what})`;
  let free = true;
  for (const host of hosts) if (!(await sys.portFree(port, host))) free = false;
  if (free) return { name, status: 'ok', detail: 'frei' };
  return {
    name,
    status: 'fail',
    detail: 'belegt',
    hint: `${hint} Sonst das Programm beenden, das Port ${port} nutzt (macOS: "lsof -i :${port}").`,
  };
}

export function checkDataDir(sys: System, cfg: SgConfig): CheckResult {
  const name = `Datenordner beschreibbar (${cfg.dataDir})`;
  if (sys.dirWritable(cfg.dataDir)) return { name, status: 'ok', detail: 'ja' };
  return {
    name,
    status: 'fail',
    detail: 'nicht beschreibbar',
    hint: 'Rechte des Ordners bzw. des übergeordneten Ordners prüfen oder mit SG_DATA_DIR einen anderen Ordner wählen.',
  };
}

/** GiB mit einer Nachkommastelle, abgeschnitten (nicht gerundet): knapp unter 10 GB zeigt "9,9", nie "10,0". */
function formatGb(bytes: number): string {
  const tenths = Math.floor((bytes / 1024 ** 3) * 10) / 10;
  return tenths.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function checkFreeSpace(sys: System, cfg: SgConfig): CheckResult {
  const name = 'Freier Speicher (Hinweis)';
  const free = sys.freeBytes(cfg.dataDir);
  if (free === undefined) return { name, status: 'info', detail: 'nicht feststellbar' };
  if (free >= MIN_FREE_BYTES)
    return { name, status: 'ok', detail: `${formatGb(free)} GB frei im Datenordner` };
  return {
    name,
    status: 'info',
    detail: `Wenig Speicher frei: ${formatGb(free)} GB im Datenordner. Aufnahmen und Backups brauchen Platz.`,
  };
}

export function checkAppleSilicon(sys: System): CheckResult {
  const name = 'Apple Silicon (Hinweis)';
  if (sys.platform === 'darwin' && sys.arch === 'arm64') {
    return { name, status: 'info', detail: 'Apple Silicon erkannt. Das ist die vorgesehene Plattform.' };
  }
  if (sys.platform === 'darwin') {
    return { name, status: 'info', detail: 'Intel-Mac. Lokale Transkription ist dort deutlich langsamer.' };
  }
  return {
    name,
    status: 'info',
    detail: `${sys.platform}/${sys.arch}. Vorgesehen ist ein Mac mit Apple Silicon.`,
  };
}

export async function runChecks(sys: System, cfg: SgConfig): Promise<CheckResult[]> {
  return [
    checkNode(sys.nodeVersion),
    await checkTool(
      sys,
      'pnpm',
      'pnpm',
      ['--version'],
      'pnpm installieren: "corepack enable" (Version steht in package.json).',
    ),
    await checkTool(
      sys,
      'uv',
      'uv',
      ['--version'],
      'uv installieren: "brew install uv" oder https://docs.astral.sh/uv/ (für den Python-Worker).',
    ),
    await checkTool(
      sys,
      'ffmpeg',
      'ffmpeg',
      ['-version'],
      'ffmpeg installieren: "brew install ffmpeg" (der Worker braucht es für das Audio, Job audio_finalize).',
    ),
    await checkDocker(sys),
    await checkPort(
      sys,
      cfg.corePort,
      ['0.0.0.0', '127.0.0.1'],
      'Core',
      'Läuft sg schon? Dann zuerst "pnpm sg stop". Für den Core lässt sich der Port mit SG_CORE_PORT ändern.',
    ),
    await checkPort(
      sys,
      DB_PORT,
      ['127.0.0.1'],
      'Postgres',
      'Läuft schon eine andere Datenbank oder Studien-Gehirn? Dann "pnpm sg stop".',
    ),
    checkDataDir(sys, cfg),
    checkFreeSpace(sys, cfg),
    checkAppleSilicon(sys),
  ];
}

const SYMBOL: Record<CheckStatus, string> = { ok: '✓', fail: '✗', info: 'ℹ' };

export function formatChecks(results: CheckResult[]): string {
  const lines: string[] = [];
  for (const r of results) {
    lines.push(`${SYMBOL[r.status]} ${r.name}: ${r.detail}`);
    if (r.status === 'fail' && r.hint) lines.push(`    → ${r.hint}`);
  }
  const failed = results.filter((r) => r.status === 'fail').length;
  lines.push('');
  lines.push(
    failed === 0
      ? 'Alles bereit.'
      : `${failed} Prüfung(en) fehlgeschlagen. Bitte die Hinweise oben beachten.`,
  );
  return lines.join('\n');
}

export function doctorExitCode(results: CheckResult[]): number {
  return results.some((r) => r.status === 'fail') ? 1 : 0;
}

/**
 * Inhalt von `<Datenordner>/run/core.lock`, nur gelesen:
 * - `missing`: Datei fehlt
 * - `pid`: gültige PID
 * - `invalid`: leer, kaputt oder zu groß für eine PID-Datei
 * - `special`: keine normale Datei (symbolischer Link, Ordner, FIFO, Gerät). Der Core legt so etwas nie an
 * - `unreadable`: lässt sich nicht lesen (z. B. `EACCES`)
 */
export type LockRead =
  | { kind: 'missing' }
  | { kind: 'pid'; pid: number }
  | { kind: 'invalid' }
  | { kind: 'special' }
  | { kind: 'unreadable'; code: string };

/** Zugriffe der Sperrdatei-Prüfung (im Test ersetzbar). `sg doctor` löscht nie etwas, darum gibt es nur Lesezugriffe. */
export interface LockDoctorIo {
  readLock(path: string): LockRead;
  alive(pid: number): boolean;
  /** Antwortet der Core unter `/api/v1/health`? */
  coreReachable(): Promise<boolean>;
}

/** Eine PID-Datei des Core ist `<pid>\n`; mehr wird nie gelesen */
const LOCK_MAX_BYTES = 64;

function errnoCode(error: unknown): string {
  return (error as NodeJS.ErrnoException).code ?? 'unbekannt';
}

/**
 * Liest die Sperrdatei, ohne hängen zu bleiben: kein Folgen eines symbolischen Links, kein Warten an einem FIFO
 * (`O_NONBLOCK`), höchstens `LOCK_MAX_BYTES` Bytes. Gleiche PID-Regel wie `parsePid` im Core (`instance-lock.ts`).
 */
export function readLockFileSafe(path: string): LockRead {
  let info: Stats;
  try {
    info = lstatSync(path);
  } catch (error) {
    const code = errnoCode(error);
    return code === 'ENOENT' ? { kind: 'missing' } : { kind: 'unreadable', code };
  }
  if (!info.isFile()) return { kind: 'special' };
  if (info.size > LOCK_MAX_BYTES) return { kind: 'invalid' };
  let fd: number;
  try {
    // Zwischen lstat und open kann die Datei getauscht werden: darum `O_NOFOLLOW | O_NONBLOCK`, Typ danach per fstat
    fd = openSync(path, READ_FLAGS);
  } catch (error) {
    const code = errnoCode(error);
    if (code === 'ENOENT') return { kind: 'missing' };
    if (code === 'ELOOP') return { kind: 'special' };
    return { kind: 'unreadable', code };
  }
  try {
    if (!fstatSync(fd).isFile()) return { kind: 'special' };
    const buf = Buffer.alloc(LOCK_MAX_BYTES + 1);
    const n = readSync(fd, buf, 0, buf.length, 0);
    if (n > LOCK_MAX_BYTES) return { kind: 'invalid' };
    const pid = Number(buf.toString('utf8', 0, n).trim());
    return Number.isInteger(pid) && pid > 0 ? { kind: 'pid', pid } : { kind: 'invalid' };
  } catch (error) {
    return { kind: 'unreadable', code: errnoCode(error) };
  } finally {
    closeSync(fd);
  }
}

export function realLockDoctorIo(cfg: SgConfig): LockDoctorIo {
  return {
    readLock: readLockFileSafe,
    alive: processAlive,
    async coreReachable() {
      try {
        const res = await fetch(healthUrl(cfg), { signal: AbortSignal.timeout(1500) });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Prüft `<Datenordner>/run/core.lock` (#174, #292). Nie `fail` und nie schreibend: Eine veraltete Datei übernimmt der
 * nächste Start selbst. Zuerst die Datei, dann der Health-Abruf: Startet der Core währenddessen, ist die Datei schon
 * lange vor dem Port da (Meldung „startet vielleicht gerade“); stoppt er, ist zuerst der Port zu.
 */
export async function checkCoreLock(cfg: SgConfig, io: LockDoctorIo): Promise<CheckResult> {
  const name = 'Core-Sperrdatei (Hinweis)';
  const path = join(cfg.dataDir, 'run', 'core.lock');
  const lock = io.readLock(path);
  const reachable = await io.coreReachable();
  const info = (detail: string): CheckResult => ({ name, status: 'info', detail });
  // Antwortet ein Core, ohne dass eine lebende PID in der Datei steht, würde ein zweiter Start ihn nicht erkennen
  const unguarded = reachable
    ? ` Der Core antwortet aber unter ${healthUrl(cfg)}: Ein zweiter Start würde ihn nicht erkennen (ältere Version oder Datei von Hand geändert). Den Core mit "sg stop" beenden und neu starten.`
    : '';

  switch (lock.kind) {
    case 'missing':
      if (!reachable) return { name, status: 'ok', detail: 'keine Datei, der Core läuft nicht' };
      return info(`${path} fehlt.${unguarded}`);
    case 'unreadable':
      return info(`${path} lässt sich nicht lesen (${lock.code}). Gehört die Datei einem anderen Benutzer?`);
    case 'special':
      return info(
        `${path} ist keine normale Datei (z. B. ein symbolischer Link oder Ordner). Der Core legt so etwas nie an ` +
          `und startet damit womöglich nicht. Den Eintrag von Hand löschen ("sg doctor" löscht nichts).`,
      );
    case 'invalid':
      return info(`${path} ist leer oder kaputt. Die Datei wird beim nächsten Start übernommen.${unguarded}`);
    case 'pid':
      break;
  }
  if (!io.alive(lock.pid)) {
    return info(
      `${path} ist veraltet (PID ${lock.pid} läuft nicht mehr, z. B. nach einem Absturz). Die Datei wird beim nächsten Start übernommen.${unguarded}`,
    );
  }
  if (reachable) return { name, status: 'ok', detail: `Core läuft (PID ${lock.pid})` };
  return info(
    `PID ${lock.pid} lebt, aber der Core antwortet nicht unter ${healthUrl(cfg)}. Vielleicht startet er gerade noch. ` +
      `Sonst trägt möglicherweise ein fremder Prozess diese PID (PID-Wiederverwendung nach einem Absturz). ` +
      `Dann die Datei ${path} von Hand löschen ("sg doctor" löscht nichts).`,
  );
}
