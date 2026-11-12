// Mac-Helfer `sg-tunnel` (UX-12, docs/plaene/UX-12-MAC-WIEDERFINDEN.md §5.2, PR 3): Bau bei Bedarf, Startkommando und
// Überwachung. `sg start` startet den Helfer nach dem Core, `sg stop` beendet ihn davor. Fehlt Swift oder scheitert der
// Bau, startet der Rest trotzdem (nur ohne Direktverbindung), und `sg` sagt es deutlich.
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { SgConfig } from './config.ts';

export const TUNNEL_PRODUCT = 'sg-tunnel';
/** Exit-Code des Helfers bei Konfigurationsfehlern (EX_CONFIG): falsche Rechte, fremder Besitzer, Pfad zu lang. */
export const TUNNEL_EXIT_CONFIG = 78;
/** Höchstens so viele Neustarts nach einem Absturz innerhalb des Fensters, danach gibt `sg` auf. */
export const TUNNEL_MAX_RESTARTS = 5;
export const TUNNEL_RESTART_WINDOW_MS = 10 * 60 * 1000;
/** Gnadenfrist beim Beenden des Helfers (er schließt nur Listener und Verbindungen). */
export const TUNNEL_STOP_TIMEOUT_S = 5;

export function tunnelBinary(cfg: SgConfig): string {
  return join(cfg.tunnelPackageDir, '.build', 'release', TUNNEL_PRODUCT);
}

/** Der Stempel liegt in `.build/` (gitignored): Wer den Bau löscht, löscht ihn mit. */
export function tunnelStampFile(cfg: SgConfig): string {
  return join(cfg.tunnelPackageDir, '.build', '.sg-source-stamp');
}

/**
 * Das Startkommando. Es gibt bewusst nur Dateipfade: kein `--core-url`, kein Token. Der Helfer spricht nie mit dem
 * Haupteingang des Core (Plan §5.2, Punkt 1).
 */
export function tunnelCommand(cfg: SgConfig): { cmd: string; args: string[]; cwd: string } {
  return {
    cmd: tunnelBinary(cfg),
    args: [
      '--keys',
      cfg.tunnelKeysFile,
      '--socket',
      cfg.tunnelSocket,
      '--status',
      cfg.tunnelStateFile,
      '--p2p',
      cfg.tunnelP2p ? 'on' : 'off',
    ],
    cwd: cfg.repoRoot,
  };
}

// ---------------------------------------------------------------- Prüfsumme der Quellen

/** Alle Dateien unter `dir`, nach Pfad sortiert (ohne Ordner). Symlinks zählen mit ihrem Ziel als Text. */
function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const entry of entries) {
      if (entry.name === '.DS_Store') continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(full);
    }
  };
  walk(dir);
  return out;
}

/**
 * Prüfsumme über `Package.swift` und `Sources/` des Swift-Pakets (Dateinamen und Inhalt). `null`, wenn das Paket
 * fehlt oder sich nicht lesen lässt. Tests und `.build/` fließen nicht ein: Sie ändern das Programm nicht.
 */
export function tunnelSourceFingerprint(packageDir: string): string | null {
  try {
    const hash = createHash('sha256');
    const files = [join(packageDir, 'Package.swift'), ...listFiles(join(packageDir, 'Sources'))];
    for (const file of files) {
      const info = lstatSync(file);
      const content = info.isSymbolicLink() ? Buffer.from(readlinkSync(file)) : readFileSync(file);
      const contentHash = createHash('sha256').update(content).digest('hex');
      hash.update(`${relative(packageDir, file)}\0${contentHash}\n`);
    }
    return hash.digest('hex');
  } catch {
    return null;
  }
}

export function readTunnelStamp(cfg: SgConfig): string | null {
  try {
    const text = readFileSync(tunnelStampFile(cfg), 'utf8').trim();
    return text === '' ? null : text;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- Bau

export type TunnelBuildReason = 'missing' | 'outdated';

export interface TunnelBuildState {
  binaryExists: boolean;
  /** Prüfsumme der aktuellen Quellen, `null` wenn nicht bestimmbar */
  fingerprint: string | null;
  /** Prüfsumme beim letzten erfolgreichen Bau durch `sg start` */
  stamp: string | null;
}

/** Liefert den Grund für einen Bau oder `null`, wenn das vorhandene Programm zu den Quellen passt. */
export function tunnelBuildReason(s: TunnelBuildState): TunnelBuildReason | null {
  if (!s.binaryExists) return 'missing';
  if (s.fingerprint === null) return null;
  return s.stamp === s.fingerprint ? null : 'outdated';
}

export interface TunnelBuildIo {
  platform: string;
  hasFile: (path: string) => boolean;
  /** Ist `swift` aufrufbar? */
  hasSwift: () => Promise<boolean>;
  /** Führt einen Befehl im Vordergrund aus (Ausgabe geht ins Terminal) und liefert den Exit-Code. */
  run: (cmd: string, args: string[]) => Promise<number>;
  log: (msg: string) => void;
  err: (msg: string) => void;
}

export type TunnelBuildResult =
  | { status: 'ready' }
  | { status: 'skipped'; why: 'disabled' | 'platform' | 'no-package' }
  | { status: 'failed'; why: 'no-swift' | 'build-failed' | 'no-binary' };

/**
 * Baut den Helfer, wenn das Programm fehlt oder die Quellen sich seit dem letzten Bau geändert haben. Bricht nie ab:
 * Das Ergebnis sagt `sg start`, ob der Helfer gestartet werden kann.
 */
export async function ensureTunnelBuild(cfg: SgConfig, io: TunnelBuildIo): Promise<TunnelBuildResult> {
  if (!cfg.tunnel) {
    io.log('Tunnel-Helfer aus (SG_TUNNEL=0): keine Direktverbindung vom iPad.');
    return { status: 'skipped', why: 'disabled' };
  }
  if (io.platform !== 'darwin') {
    io.log(`Tunnel-Helfer gibt es nur auf macOS (hier: ${io.platform}), er wird nicht gestartet.`);
    return { status: 'skipped', why: 'platform' };
  }
  if (!io.hasFile(join(cfg.tunnelPackageDir, 'Package.swift'))) {
    io.err(`Tunnel-Helfer fehlt (erwartet in ${cfg.tunnelPackageDir}). Es läuft nur der Rest.`);
    return { status: 'skipped', why: 'no-package' };
  }

  const binary = tunnelBinary(cfg);
  const fingerprint = tunnelSourceFingerprint(cfg.tunnelPackageDir);
  const reason = tunnelBuildReason({
    binaryExists: io.hasFile(binary),
    fingerprint,
    stamp: readTunnelStamp(cfg),
  });
  if (reason === null) return { status: 'ready' };

  if (!(await io.hasSwift())) {
    io.err(
      'Swift fehlt, der Tunnel-Helfer für die Direktverbindung vom iPad wird nicht gebaut und nicht gestartet. ' +
        'Xcode oder die Kommandozeilenwerkzeuge installieren ("xcode-select --install"), dann "pnpm sg stop" und "pnpm sg start". ' +
        'Alles andere läuft weiter.',
    );
    return { status: 'failed', why: 'no-swift' };
  }

  io.log(
    reason === 'missing'
      ? 'Tunnel-Helfer ist noch nicht gebaut, baue ihn (swift build -c release, der erste Bau dauert etwa eine Minute) …'
      : 'Der Tunnel-Helfer hat sich seit dem letzten Bau geändert, baue neu (swift build -c release) …',
  );
  const code = await io.run('swift', ['build', '-c', 'release', '--package-path', cfg.tunnelPackageDir]);
  if (code !== 0) {
    io.err(
      `Bau des Tunnel-Helfers fehlgeschlagen (Exit-Code ${code}). Er wird nicht gestartet, die Direktverbindung vom iPad geht nicht. ` +
        'Ausgabe oben prüfen, "pnpm sg doctor" zeigt den Zustand. Alles andere läuft weiter.',
    );
    return { status: 'failed', why: 'build-failed' };
  }
  if (!io.hasFile(binary)) {
    io.err(`Der Bau lief durch, aber ${binary} fehlt. Der Tunnel-Helfer wird nicht gestartet.`);
    return { status: 'failed', why: 'no-binary' };
  }
  // Stempel nur, wenn sich die Quellen während des Baus nicht geändert haben
  if (fingerprint !== null && tunnelSourceFingerprint(cfg.tunnelPackageDir) === fingerprint) {
    try {
      writeFileSync(tunnelStampFile(cfg), `${fingerprint}\n`);
    } catch (e) {
      io.err(
        `Bau-Stempel des Tunnel-Helfers konnte nicht gespeichert werden (${(e as Error).message}). Beim nächsten Start wird erneut gebaut.`,
      );
    }
  }
  return { status: 'ready' };
}

// ---------------------------------------------------------------- Überwachung

/** Gleitendes Fenster: höchstens `max` Neustarts innerhalb von `windowMs`. */
export class RestartLimiter {
  private times: number[] = [];
  private readonly max: number;
  private readonly windowMs: number;

  constructor(max = TUNNEL_MAX_RESTARTS, windowMs = TUNNEL_RESTART_WINDOW_MS) {
    this.max = max;
    this.windowMs = windowMs;
  }

  /** true: Neustart erlaubt (und mitgezählt). false: Grenze erreicht. */
  allow(now: number): boolean {
    this.times = this.times.filter((t) => now - t < this.windowMs);
    if (this.times.length >= this.max) return false;
    this.times.push(now);
    return true;
  }
}

export interface TunnelExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface SuperviseDeps {
  /** Startet den Helfer. Das Ergebnis wird erst fertig, wenn der Prozess beendet ist. */
  spawn: () => Promise<TunnelExit>;
  /** true, wenn das Ende gewollt ist (Strg+C, `sg stop`): dann kein Neustart */
  isStopping: () => boolean;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  log: (msg: string) => void;
  err: (msg: string) => void;
}

/**
 * Startet den Helfer und startet ihn nach einem Absturz neu: höchstens 5-mal in 10 Minuten, danach Meldung.
 * Konfigurationsfehler (Exit-Code 78) führen nie zu einem Neustart. Endet mit dem Helfer oder wenn aufgegeben wird.
 */
export async function superviseTunnel(
  deps: SuperviseDeps,
  limiter: RestartLimiter = new RestartLimiter(),
): Promise<void> {
  for (;;) {
    if (deps.isStopping()) return;
    let exit: TunnelExit;
    try {
      exit = await deps.spawn();
    } catch (e) {
      deps.err(`Tunnel-Helfer konnte nicht gestartet werden: ${(e as Error).message}`);
      exit = { code: null, signal: null };
    }
    if (deps.isStopping()) return;
    if (exit.code === TUNNEL_EXIT_CONFIG) {
      deps.err(
        'Der Tunnel-Helfer meldet einen Konfigurationsfehler (Meldung oben, meist Rechte oder Besitzer der Schlüsseldatei). ' +
          'Kein Neustart. Beheben, dann "pnpm sg stop" und "pnpm sg start". "pnpm sg doctor" zeigt Details.',
      );
      return;
    }
    deps.err(`Tunnel-Helfer beendet (${exit.signal ?? `Exit-Code ${exit.code}`}).`);
    if (!limiter.allow(deps.now())) {
      deps.err(
        `Der Tunnel-Helfer ist ${TUNNEL_MAX_RESTARTS}-mal in ${TUNNEL_RESTART_WINDOW_MS / 60000} Minuten ausgefallen. ` +
          'Kein weiterer Neustart, die Direktverbindung vom iPad geht nicht. "pnpm sg doctor" zeigt den Zustand, ' +
          '"pnpm sg stop" und "pnpm sg start" versucht es erneut. Alles andere läuft weiter.',
      );
      return;
    }
    await deps.sleep(1000);
    if (deps.isStopping()) return;
    deps.log('Starte den Tunnel-Helfer neu …');
  }
}

export function hasTunnelBinary(cfg: SgConfig): boolean {
  return existsSync(tunnelBinary(cfg));
}
