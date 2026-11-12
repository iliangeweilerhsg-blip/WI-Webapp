// UX-17: Hinweis nach einem Update, wenn die iPad-App neu aufgespielt werden muss.
// `sg start` merkt sich den Stand des Ordners `apps/ipad` (Git-Baum-ID von HEAD) im Datenordner. Hat er sich seit dem
// letzten Start geändert, ist die iPad-App auf dem Gerät womöglich älter als der Mac (z. B. anderes Sync-Protokoll).
import { execFileSync } from 'node:child_process';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SgConfig } from './config.ts';

export const IPAD_STAMP_FILE = 'ipad-app-stand.txt';

export const IPAD_UPDATE_NOTE =
  'iPad-App neu aufspielen: Seit dem letzten Start hat sich apps/ipad geändert. Siehe docs/anleitungen/UPDATE.md und IPAD.md.';

/** Git-Baum-ID von `apps/ipad` im aktuellen Stand, `null` ohne Git oder Ordner */
export function ipadTreeId(repoRoot: string): string | null {
  try {
    const out = execFileSync('git', ['rev-parse', '--verify', '--quiet', 'HEAD:apps/ipad'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();
    return /^[0-9a-f]{40,64}$/.test(out) ? out : null;
  } catch {
    return null;
  }
}

export function ipadStampPath(cfg: SgConfig): string {
  return join(cfg.dataDir, 'run', IPAD_STAMP_FILE);
}

export function readIpadStamp(cfg: SgConfig): string | null {
  try {
    const text = readFileSync(ipadStampPath(cfg), 'utf8').trim();
    return text === '' ? null : text;
  } catch {
    return null;
  }
}

function writeIpadStamp(cfg: SgConfig, id: string): void {
  const path = ipadStampPath(cfg);
  writeFileSync(`${path}.tmp`, `${id}\n`, { mode: 0o644 });
  renameSync(`${path}.tmp`, path);
}

/**
 * Vergleicht den Stand mit dem letzten Start und merkt sich den neuen. Gibt den Hinweis zurück, wenn sich `apps/ipad`
 * geändert hat. Beim allerersten Start (kein Stand gemerkt) gibt es keinen Hinweis. Fehler hier brechen den Start nie ab.
 */
export function checkIpadApp(cfg: SgConfig, treeId: string | null = ipadTreeId(cfg.repoRoot)): string | null {
  if (treeId === null) return null;
  try {
    const previous = readIpadStamp(cfg);
    if (previous !== treeId) writeIpadStamp(cfg, treeId);
    return previous !== null && previous !== treeId ? IPAD_UPDATE_NOTE : null;
  } catch {
    return null;
  }
}
