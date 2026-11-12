// `sg doctor`: prüft die Voraussetzungen und liefert eine Checkliste mit Lösungshinweisen.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DB_PORT, healthUrl, type SgConfig } from './config.ts';
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

/** Zugriffe der Sperrdatei-Prüfung (im Test ersetzbar). `sg doctor` löscht nie etwas, darum gibt es nur Lesezugriffe. */
export interface LockDoctorIo {
  /** Inhalt von `core.lock`: `null` = Datei fehlt, `pid: null` = leer oder kaputt */
  readLock(path: string): { pid: number | null } | null;
  alive(pid: number): boolean;
  /** Antwortet der Core unter `/api/v1/health`? */
  coreReachable(): Promise<boolean>;
}

/**
 * Lebt der Prozess? Kopie von `processAlive` aus `services/core/src/lib/instance-lock.ts` (#174): `sg` hängt nicht
 * vom Core-Paket ab. `EPERM` heißt: lebt, gehört nur einem anderen Benutzer. Bei Änderungen beide Stellen anpassen.
 */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

export function realLockDoctorIo(cfg: SgConfig): LockDoctorIo {
  return {
    readLock(path) {
      let text: string;
      try {
        text = readFileSync(path, 'utf8');
      } catch {
        return null;
      }
      const pid = Number(text.trim());
      return { pid: Number.isInteger(pid) && pid > 0 ? pid : null };
    },
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

/** Prüft `<Datenordner>/run/core.lock` (#174, #292). Nie `fail`: Eine veraltete Datei übernimmt der nächste Start. */
export async function checkCoreLock(cfg: SgConfig, io: LockDoctorIo): Promise<CheckResult> {
  const name = 'Core-Sperrdatei (Hinweis)';
  const path = join(cfg.dataDir, 'run', 'core.lock');
  const lock = io.readLock(path);
  const reachable = await io.coreReachable();
  if (lock === null) {
    if (!reachable) return { name, status: 'ok', detail: 'keine Datei, der Core läuft nicht' };
    return {
      name,
      status: 'info',
      detail: `Der Core antwortet, aber ${path} fehlt (ältere Version oder Datei von Hand gelöscht). Ein zweiter Core würde nicht erkannt.`,
    };
  }
  if (lock.pid === null) {
    return {
      name,
      status: 'info',
      detail: `${path} ist leer oder kaputt. Das ist harmlos, die Datei wird beim nächsten Start übernommen.`,
    };
  }
  if (!io.alive(lock.pid)) {
    return {
      name,
      status: 'info',
      detail: `veraltet (PID ${lock.pid} läuft nicht mehr, z. B. nach einem Absturz). Die Datei wird beim nächsten Start übernommen.`,
    };
  }
  if (reachable) return { name, status: 'ok', detail: `Core läuft (PID ${lock.pid})` };
  return {
    name,
    status: 'info',
    detail:
      `PID ${lock.pid} lebt, aber der Core antwortet nicht unter ${healthUrl(cfg)}. Vielleicht startet er gerade noch. ` +
      `Sonst trägt möglicherweise ein fremder Prozess diese PID (PID-Wiederverwendung nach einem Absturz). ` +
      `Dann die Datei ${path} von Hand löschen ("sg doctor" löscht nichts).`,
  };
}
