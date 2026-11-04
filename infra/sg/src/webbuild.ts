// Hält Abhängigkeiten und Static Export der Web-App vor `sg start` aktuell.
//
// Der Owner aktualisiert mit `git pull` und startet mit `pnpm sg start`. Ohne diese Prüfungen
// fehlten nach einem Pull neue Pakete (Build scheitert) bzw. der Core lieferte einen veralteten
// Export aus. Darum:
//  1. Weicht `pnpm-lock.yaml` von der installierten Kopie (`node_modules/.pnpm/lock.yaml`) ab,
//     wird `pnpm install --frozen-lockfile` ausgeführt.
//  2. Der Export wird neu gebaut, wenn er fehlt oder sich die Quellen seit dem letzten Build durch
//     `sg start` geändert haben (Fingerabdruck aus Git-Baum-Hashes, Stempel neben dem Export).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { SgConfig } from './config.ts';

/** Quellen, aus denen der Export entsteht (relativ zum Repo). Overrides/Patches stecken im Lockfile. */
export const WEB_SOURCES = [
  'apps/web',
  'packages',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
] as const;

const GIT_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------- Abhängigkeiten

/**
 * true, wenn die installierten Pakete zum Lockfile passen. pnpm legt beim Installieren eine
 * byte-gleiche Kopie des Lockfiles unter node_modules/.pnpm/lock.yaml ab.
 * null, wenn das Repo kein Lockfile hat (dann gibt es nichts zu prüfen).
 */
export function depsInSync(repoRoot: string): boolean | null {
  let wanted: Buffer;
  try {
    wanted = readFileSync(join(repoRoot, 'pnpm-lock.yaml'));
  } catch {
    return null;
  }
  try {
    return wanted.equals(readFileSync(join(repoRoot, 'node_modules', '.pnpm', 'lock.yaml')));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- Static Export

export type WebBuildReason = 'missing' | 'outdated';

export interface WebBuildState {
  /** index.html liegt im Export-Ordner. */
  indexExists: boolean;
  /** Der Export-Ordner ist der Standardordner des Repos (nicht per SG_WEB_DIR umgelenkt). */
  defaultWebDir: boolean;
  /** Fingerabdruck der aktuellen Quellen, null wenn nicht bestimmbar (kein Git). */
  fingerprint: string | null;
  /** Fingerabdruck des letzten erfolgreichen Builds durch `sg start`, null wenn unbekannt. */
  stamp: string | null;
}

/** Liefert den Grund für einen Build oder null, wenn der vorhandene Export passt. */
export function webBuildReason(s: WebBuildState): WebBuildReason | null {
  if (!s.indexExists) return 'missing';
  // Ein umgelenkter Export wird nie überschrieben; ohne Git lässt sich Veraltung nicht erkennen.
  if (!s.defaultWebDir || s.fingerprint === null) return null;
  return s.stamp === s.fingerprint ? null : 'outdated';
}

export function defaultWebDir(cfg: SgConfig): boolean {
  return resolve(cfg.webDir) === resolve(join(cfg.repoRoot, 'apps', 'web', 'out'));
}

function git(repoRoot: string, args: string[]): string {
  return execFileSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: GIT_TIMEOUT_MS,
  });
}

/** Git-Baum-Hashes der Quellen im letzten Commit. Null ohne Git, ohne Commit oder bei fehlender Quelle. */
export function webFingerprint(repoRoot: string): string | null {
  try {
    const hashes = git(repoRoot, ['rev-parse', ...WEB_SOURCES.map((p) => `HEAD:${p}`)])
      .trim()
      .split(/\s+/);
    return hashes.length === WEB_SOURCES.length && hashes.every((h) => /^[0-9a-f]{40,64}$/.test(h))
      ? hashes.join(':')
      : null;
  } catch {
    return null;
  }
}

/** true, wenn die Quellen nicht committete Änderungen haben (dann passt der Stempel nicht zu HEAD). */
export function webSourcesDirty(repoRoot: string): boolean {
  try {
    return git(repoRoot, ['status', '--porcelain', '--', ...WEB_SOURCES]).trim() !== '';
  } catch {
    return true;
  }
}

/** Der Stempel liegt neben dem Export (gitignored), nicht im Datenordner und nicht im ausgelieferten out/. */
export function webStampFile(repoRoot: string): string {
  return join(repoRoot, 'apps', 'web', '.sg-build-stamp');
}

export function readWebStamp(repoRoot: string): string | null {
  try {
    const s = readFileSync(webStampFile(repoRoot), 'utf8').trim();
    return s === '' ? null : s;
  } catch {
    return null;
  }
}

export function writeWebStamp(repoRoot: string, fingerprint: string): void {
  writeFileSync(webStampFile(repoRoot), `${fingerprint}\n`);
}

// ---------------------------------------------------------------- Ablauf in `sg start`

export interface PrepareIo {
  /** Führt einen Befehl im Repo aus und liefert den Exit-Code. */
  run: (cmd: string, args: string[]) => Promise<number>;
  log: (msg: string) => void;
  err: (msg: string) => void;
  hasFile: (path: string) => boolean;
}

/** Installiert fehlende/veraltete Pakete. false, wenn das nötig war und gescheitert ist. */
export async function ensureDeps(cfg: SgConfig, io: PrepareIo): Promise<boolean> {
  if (depsInSync(cfg.repoRoot) !== false) return true;
  io.log('Pakete haben sich geändert (z. B. nach git pull), installiere sie (pnpm install) …');
  const code = await io.run('pnpm', ['install', '--frozen-lockfile']);
  if (code === 0) return true;
  io.err('"pnpm install" ist fehlgeschlagen. Bitte die Meldung oben an Claude schicken.');
  return false;
}

/** Baut den Static Export, wenn er fehlt oder veraltet ist. Bricht nie ab: Der Core startet in jedem Fall. */
export async function ensureWebBuild(cfg: SgConfig, io: PrepareIo, webAvailable: boolean): Promise<void> {
  const index = join(cfg.webDir, 'index.html');
  const isDefault = defaultWebDir(cfg);
  const fingerprint = webFingerprint(cfg.repoRoot);
  if (isDefault && fingerprint === null && webAvailable) {
    io.log(
      'Hinweis: Ohne Git lässt sich nicht erkennen, ob die Web-App veraltet ist. Gebaut wird nur, wenn sie fehlt.',
    );
  }
  const reason = webBuildReason({
    indexExists: io.hasFile(index),
    defaultWebDir: isDefault,
    fingerprint,
    stamp: readWebStamp(cfg.repoRoot),
  });
  if (reason === null) return;
  if (!webAvailable) {
    io.err(`Web-App fehlt noch (Ticket T0-06, erwartet in ${cfg.webDir}). Core startet nur mit der API.`);
    return;
  }

  io.log(
    reason === 'missing'
      ? 'Static Export der Web-App fehlt, baue ihn (pnpm --filter @sg/web build) …'
      : 'Web-App hat sich seit dem letzten Build geändert, baue neu (pnpm --filter @sg/web build) …',
  );
  const code = await io.run('pnpm', ['--filter', '@sg/web', 'build']);
  if (code !== 0) {
    // Next leert out/ während des Exports – ob noch ein alter Stand da ist, zeigt erst die Prüfung danach.
    io.err(
      io.hasFile(index)
        ? 'Build der Web-App fehlgeschlagen. Der Core liefert den bisherigen (älteren) Stand aus.'
        : 'Build der Web-App fehlgeschlagen. Der Core startet trotzdem, liefert aber keine Oberfläche aus.',
    );
    return;
  }
  // Nur ein Build aus sauberem Stand passt zum Fingerabdruck von HEAD.
  if (fingerprint === null || !isDefault || webSourcesDirty(cfg.repoRoot)) return;
  try {
    writeWebStamp(cfg.repoRoot, fingerprint);
  } catch (e) {
    io.err(
      `Build-Stempel konnte nicht gespeichert werden (${(e as Error).message}). Beim nächsten Start wird erneut gebaut.`,
    );
  }
}
