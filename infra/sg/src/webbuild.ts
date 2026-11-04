// Entscheidet, ob `sg start` den Static Export der Web-App (neu) bauen muss.
//
// Nach `git pull` liegt sonst ein veralteter Export in apps/web/out, und der Owner sieht die alte
// Oberfläche. Darum merkt sich `sg start` einen Fingerabdruck der Quellen (Git-Baum-Hashes von
// apps/web, packages und dem Lockfile) und baut neu, sobald er sich ändert.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { SgConfig } from './config.ts';

/** Quellen, aus denen der Export entsteht (relativ zum Repo). */
export const WEB_SOURCES = ['apps/web', 'packages', 'pnpm-lock.yaml'] as const;

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

/** Git-Baum-Hashes der Quellen im letzten Commit. Lokale, nicht committete Änderungen zählen nicht. */
export function webFingerprint(repoRoot: string): string | null {
  try {
    const out = execFileSync('git', ['-C', repoRoot, 'rev-parse', ...WEB_SOURCES.map((p) => `HEAD:${p}`)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const hashes = out.split(/\s+/);
    return hashes.length === WEB_SOURCES.length && hashes.every((h) => /^[0-9a-f]{40,64}$/.test(h))
      ? hashes.join(':')
      : null;
  } catch {
    return null;
  }
}

function stampFile(cfg: SgConfig): string {
  return join(cfg.runDir, 'web-build.txt');
}

export function readWebStamp(cfg: SgConfig): string | null {
  try {
    const s = readFileSync(stampFile(cfg), 'utf8').trim();
    return s === '' ? null : s;
  } catch {
    return null;
  }
}

export function writeWebStamp(cfg: SgConfig, fingerprint: string): void {
  mkdirSync(cfg.runDir, { recursive: true });
  writeFileSync(stampFile(cfg), `${fingerprint}\n`);
}
