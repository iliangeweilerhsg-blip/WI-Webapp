// Hält die installierten Pakete passend zum Lockfile, BEVOR die CLI ihre eigenen Abhängigkeiten
// (z. B. @sg/shared → zod) lädt. Nach `git pull` mit neuer Abhängigkeit würde `pnpm sg …` sonst
// schon beim Import mit ERR_MODULE_NOT_FOUND abbrechen. Reines JavaScript, nur Node-Bordmittel.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Merker: Lockfile-Hash nach erfolgreichem Install (falls pnpm die Kopie nicht byte-gleich schreibt). */
const MARKER = '.sg-deps';

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * true, wenn die installierten Pakete zum Lockfile passen, null ohne Lockfile.
 * pnpm legt beim Installieren eine Kopie des Lockfiles unter node_modules/.pnpm/lock.yaml ab.
 * @param {string} repoRoot
 * @returns {boolean | null}
 */
export function depsInSync(repoRoot) {
  let wanted;
  try {
    wanted = readFileSync(join(repoRoot, 'pnpm-lock.yaml'));
  } catch {
    return null;
  }
  try {
    if (wanted.equals(readFileSync(join(repoRoot, 'node_modules', '.pnpm', 'lock.yaml')))) return true;
  } catch {
    // keine Kopie → Merker prüfen
  }
  try {
    return readFileSync(join(repoRoot, 'node_modules', MARKER), 'utf8').trim() === sha256(wanted);
  } catch {
    return false;
  }
}

/**
 * Installiert per `pnpm install --frozen-lockfile`, wenn nötig.
 * @param {string} repoRoot
 * @param {(cmd: string, args: string[]) => number} [run] Exit-Code des Befehls (für Tests ersetzbar)
 * @returns {boolean} false, wenn ein nötiges Install fehlgeschlagen ist
 */
export function syncDeps(repoRoot, run = defaultRun(repoRoot)) {
  if (depsInSync(repoRoot) !== false) return true;
  console.log('[sg] Pakete haben sich geändert (z. B. nach git pull), installiere sie (pnpm install) …');
  if (run('pnpm', ['install', '--frozen-lockfile']) !== 0) {
    console.error('[sg] "pnpm install" ist fehlgeschlagen. Bitte die Meldung oben an Claude schicken.');
    return false;
  }
  if (depsInSync(repoRoot) === false) {
    // pnpm meldet „aktuell“, hat die Kopie aber nicht neu geschrieben (z. B. anders formatiertes Lockfile).
    try {
      writeFileSync(
        join(repoRoot, 'node_modules', MARKER),
        `${sha256(readFileSync(join(repoRoot, 'pnpm-lock.yaml')))}\n`,
      );
    } catch {
      // Ohne Merker wird beim nächsten Start erneut (schnell) installiert.
    }
  }
  return true;
}

/** @param {string} cwd */
function defaultRun(cwd) {
  return (cmd, args) => {
    const r = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
    if (r.error) console.error(`[sg] "${cmd}" konnte nicht gestartet werden: ${r.error.message}`);
    return r.status ?? 1;
  };
}
