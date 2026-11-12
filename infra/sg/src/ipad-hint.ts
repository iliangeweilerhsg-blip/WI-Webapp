// UX-17: Hinweis nach einem Update, wenn die iPad-App neu aufgespielt werden muss.
// `sg` merkt sich im Datenordner, welcher Stand der iPad-Quellen zuletzt als aufgespielt bestätigt wurde
// (`pnpm sg ipad aufgespielt`). Weicht der Stand im Repo (Git, HEAD) davon ab, meldet `sg start` das bei jedem Start,
// bis man das Aufspielen bestätigt. Ob die App auf dem iPad wirklich neu ist, kann `sg` nicht sehen.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SgConfig } from './config.ts';

export const IPAD_STAMP_FILE = 'ipad-app-stand.txt';

/**
 * Alles, woraus Xcode die iPad-App baut (`apps/ipad/project.yml`, Abschnitt `sources`, samt Symlinks unter
 * `apps/ipad`). Ein Test prüft, dass jeder Quellpfad aus `project.yml` hier abgedeckt ist. Fehlende Pfade sind erlaubt
 * (z. B. der Spike-Ordner, sobald er wegfällt).
 */
export const IPAD_SOURCE_PATHS = [
  'apps/ipad',
  'apps/mac-tunnel/Sources/TunnelShared',
  'packages/schemas/generated/swift',
  'packages/schemas/swift-support',
  'spikes/s6-p2p/Sources/SpikeShared',
] as const;

export const IPAD_CONFIRM_COMMAND = 'pnpm sg ipad aufgespielt';

export const IPAD_UPDATE_NOTE = [
  'iPad-App neu aufspielen: Die Quellen der iPad-App haben sich seit dem letzten Aufspielen geändert.',
  'Anleitung: docs/anleitungen/IPAD.md (Schritt 1 und 6). Die Kopplung bleibt erhalten.',
  `Danach bestätigen mit: ${IPAD_CONFIRM_COMMAND}`,
].join('\n');

/**
 * Fingerabdruck der iPad-Quellen im Stand von HEAD (Git-Objekt-IDs der Pfade aus `IPAD_SOURCE_PATHS`).
 * `null` ohne Git, außerhalb eines Repos (z. B. entpackter Ordner) oder wenn `apps/ipad` fehlt.
 */
export function ipadTreeId(repoRoot: string): string | null {
  let out: string;
  try {
    out = execFileSync('git', ['ls-tree', 'HEAD', '--', ...IPAD_SOURCE_PATHS], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    });
  } catch {
    return null;
  }
  return fingerprint(out);
}

/** Aus der Ausgabe von `git ls-tree HEAD -- <pfade>`: sha256 über die sortierten Zeilen, `null` ohne `apps/ipad` */
export function fingerprint(lsTreeOutput: string): string | null {
  const lines = lsTreeOutput
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^\d{6} (tree|blob|commit) [0-9a-f]{40,64}\t\S/.test(l))
    .sort();
  if (!lines.some((l) => l.endsWith('\tapps/ipad'))) return null;
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

export function ipadStampPath(cfg: SgConfig): string {
  return join(cfg.runDir, IPAD_STAMP_FILE);
}

export function readIpadStamp(cfg: SgConfig): string | null {
  try {
    const text = readFileSync(ipadStampPath(cfg), 'utf8').trim();
    return text === '' ? null : text;
  } catch {
    return null;
  }
}

export function writeIpadStamp(cfg: SgConfig, id: string): void {
  mkdirSync(cfg.runDir, { recursive: true });
  const path = ipadStampPath(cfg);
  writeFileSync(`${path}.tmp`, `${id}\n`, { mode: 0o644 });
  renameSync(`${path}.tmp`, path);
}

/**
 * Für `sg start`: der Hinweis, solange sich die iPad-Quellen seit dem zuletzt bestätigten Aufspielen geändert haben.
 * Beim allerersten Start (noch kein Stand gemerkt) wird nur der Stand gemerkt, ohne Hinweis. Fehler hier brechen den
 * Start nie ab.
 */
export function checkIpadApp(cfg: SgConfig, treeId: string | null = ipadTreeId(cfg.repoRoot)): string | null {
  if (treeId === null) return null;
  try {
    const confirmed = readIpadStamp(cfg);
    if (confirmed === null) {
      writeIpadStamp(cfg, treeId);
      return null;
    }
    return confirmed === treeId ? null : IPAD_UPDATE_NOTE;
  } catch {
    return null;
  }
}

/** `sg ipad` zeigt den Stand, `sg ipad aufgespielt` bestätigt das Aufspielen */
export function ipadCommand(
  cfg: SgConfig,
  rest: string[],
  treeId: string | null = ipadTreeId(cfg.repoRoot),
  print: (line: string) => void = (l) => console.log(l),
): number {
  const [sub, ...extra] = rest;
  if ((sub !== undefined && sub !== 'aufgespielt') || extra.length > 0) {
    print(
      `Unbekannte Option "${sub === 'aufgespielt' ? extra[0] : sub}". Erlaubt: pnpm sg ipad [aufgespielt].`,
    );
    return 1;
  }
  if (treeId === null) {
    print('Den Stand der iPad-App kann sg hier nicht bestimmen (kein Git-Repository oder Git fehlt).');
    return sub === 'aufgespielt' ? 1 : 0;
  }
  if (sub === 'aufgespielt') {
    try {
      writeIpadStamp(cfg, treeId);
    } catch (e) {
      print(`Konnte den Stand nicht speichern: ${(e as Error).message}`);
      return 1;
    }
    print(
      'Gemerkt: Die iPad-App entspricht dem aktuellen Stand. sg start meldet sich erst nach der nächsten Änderung wieder.',
    );
    return 0;
  }
  const confirmed = readIpadStamp(cfg);
  if (confirmed === null) print(`Noch kein Stand gemerkt. Nach dem Aufspielen: ${IPAD_CONFIRM_COMMAND}`);
  else if (confirmed === treeId)
    print('Die iPad-App ist aktuell: Die Quellen sind seit dem letzten Aufspielen gleich.');
  else print(IPAD_UPDATE_NOTE);
  return 0;
}
