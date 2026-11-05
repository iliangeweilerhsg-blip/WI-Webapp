// Gemeinsame Prüfung von `data.backup_target` (VERTRAEGE §14.1), genutzt von Core (`PATCH /settings`) und CLI
// (`sg backup`). Nutzt node:fs und ist deshalb NICHT Teil des Barrel-Exports (`@sg/shared`), den auch die
// Web-App bündelt, sondern nur über `@sg/shared/backup-target` erreichbar.
import { accessSync, constants, existsSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

/** Systemordner, die nie Backup-Ziel sein dürfen (Linux und macOS) */
export const FORBIDDEN_TARGET_PREFIXES = ['/proc', '/sys', '/dev', '/System', '/private/var/db'];

/** Ungültiges Backup-Ziel; `message` ist für Nutzer gedacht (Deutsch) */
export class BackupTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupTargetError';
  }
}

export interface BackupTargetOptions {
  /**
   * - `whole` (Core): der ganze Datenordner `SG_DATA_DIR` samt Inhalt ist verboten.
   * - `media-vault` (CLI): nur `media/` und `vault/` sind verboten (sonst kopiert sich das Backup in sich selbst);
   *   `backups/` im Datenordner bleibt für `sg backup --ziel` erlaubt (08 §7).
   */
  dataDirPolicy: 'whole' | 'media-vault';
  /** Fehlt der Ordner, aber der Elternordner existiert: anlegen (CLI) statt ablehnen (Core) */
  createMissing: boolean;
}

const isInside = (path: string, folder: string) => path === folder || path.startsWith(`${folder}/`);

/** `realpath` des tiefsten vorhandenen Elternordners plus der noch fehlende Rest */
function realResolve(path: string): string {
  const rest: string[] = [];
  let current = resolve(path);
  while (!existsSync(current)) {
    const parent = resolve(current, '..');
    rest.unshift(current.slice(parent.length + 1));
    if (parent === current) break;
    current = parent;
  }
  return join(realpathSync(current), ...rest);
}

/**
 * Prüft ein Backup-Ziel und liefert den aufgelösten Pfad (`resolve` + `realpath`, Symlinks aufgelöst).
 * Regeln: absoluter Pfad, kein Systemordner, nicht im Datenordner (je nach `dataDirPolicy`) bzw. in `media/`/`vault/`,
 * Ordner vorhanden (oder mit `createMissing` wenigstens der Elternordner) und beschreibbar.
 */
export function checkBackupTarget(target: string, dataDir: string, options: BackupTargetOptions): string {
  if (target === '' || target.includes('\0') || !isAbsolute(target)) {
    throw new BackupTargetError('Der Backup-Ordner muss ein absoluter Pfad sein.');
  }
  const resolved = resolve(target);
  const full = realResolve(resolved);

  if (options.dataDirPolicy === 'whole') {
    const dataDirs = [resolve(dataDir), realResolve(dataDir)];
    if (dataDirs.some((dir) => isInside(full, dir) || isInside(resolved, dir))) {
      throw new BackupTargetError('Der Backup-Ordner darf nicht der Datenordner oder ein Ordner darin sein.');
    }
  } else {
    for (const sub of ['media', 'vault']) {
      const rel = relative(realResolve(join(dataDir, sub)), full);
      if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
        throw new BackupTargetError(`Das Backup-Ziel darf nicht in „${sub}“ des Datenordners liegen.`);
      }
    }
  }
  if (FORBIDDEN_TARGET_PREFIXES.some((prefix) => isInside(full, prefix) || isInside(resolved, prefix))) {
    throw new BackupTargetError('Dieser Systemordner ist als Backup-Ziel nicht erlaubt.');
  }

  if (!existsSync(full)) {
    if (!options.createMissing) {
      throw new BackupTargetError('Der Backup-Ordner ist nicht vorhanden oder nicht beschreibbar.');
    }
    if (!existsSync(resolve(full, '..'))) {
      throw new BackupTargetError('Das Backup-Ziel ist nicht vorhanden (Datenträger nicht angeschlossen?).');
    }
    mkdirSync(full);
  }
  if (!statSync(full).isDirectory()) throw new BackupTargetError('Der Backup-Pfad ist kein Ordner.');
  try {
    accessSync(full, constants.W_OK);
  } catch {
    throw new BackupTargetError('Der Backup-Ordner ist nicht vorhanden oder nicht beschreibbar.');
  }
  return full;
}
