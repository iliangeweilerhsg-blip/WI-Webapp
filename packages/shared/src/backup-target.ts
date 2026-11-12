// Gemeinsame Prüfung von `data.backup_target` (VERTRAEGE §14.1), genutzt von Core (`PATCH /settings`, asynchron)
// und CLI (`sg backup`, synchron). Nutzt node:fs und ist deshalb NICHT Teil des Barrel-Exports (`@sg/shared`), den
// auch die Web-App bündelt, sondern nur über `@sg/shared/backup-target` erreichbar.
//
// Regeln (für beide gleich):
// - absoluter Pfad, ohne NUL
// - Symlinks aufgelöst, Komponente für Komponente (relative Links gegen den echten Ordner des Links). `..` wird dabei
//   für den vorhandenen Teil des Pfads erst NACH dem Auflösen eines davor liegenden Symlinks ausgewertet (wie der
//   Kernel): `/link/../x` meint den Elternordner des Link-ZIELS. Ab der ersten nicht vorhandenen Komponente gibt es
//   keinen Symlink mehr, dort wird `..` rein textlich ausgewertet.
// - Schreibweise vom Dateisystem (`realpath` native), damit Groß-/Kleinschreibung und NFD/NFC auf macOS nicht täuschen
// - zusätzlich Identität (`dev`/`ino`) aller vorhandenen Vorfahren gegen Datenordner, `media/` und `vault/`: erkennt
//   dasselbe Verzeichnis auch über Bind-Mounts, Firmlinks oder abweichende Schreibweise
// - der ganze Datenordner (`SG_DATA_DIR`) samt Inhalt ist gesperrt, ebenso Systemordner
// - Ordner vorhanden (mit `createMissing` wenigstens der Elternordner, dann wird er angelegt) und beschreibbar
import {
  accessSync,
  constants,
  lstatSync,
  mkdirSync,
  readlinkSync,
  realpathSync,
  statSync,
  type Stats,
} from 'node:fs';
import { access, lstat, mkdir, readlink, realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';

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
  /** Fehlt der Ordner, aber der Elternordner existiert: anlegen (CLI) statt ablehnen (Core) */
  createMissing: boolean;
  /** Schreibrecht verlangen (Standard `true`). `false` für Lesezugriffe wie Restore von einem schreibgeschützten Ziel */
  writable?: boolean;
}

const MAX_LINK_HOPS = 40;

const DATA_DIR_HINT =
  'Ein Backup im Datenordner schützt nicht vor Plattendefekt oder versehentlichem Löschen. ' +
  'Wähle einen Ordner außerhalb, z. B. auf einer externen Platte, in iCloud Drive oder in einem anderen Ordner.';

const isInside = (path: string, folder: string) => {
  const rel = relative(folder, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

const codeOf = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code;

/** Übersetzt Dateisystemfehler in eine verständliche Meldung */
function fsError(error: unknown): BackupTargetError {
  if (error instanceof BackupTargetError) return error;
  switch (codeOf(error)) {
    case 'ENOENT':
      return new BackupTargetError(
        'Der Backup-Ordner ist nicht vorhanden (Datenträger nicht angeschlossen?).',
      );
    case 'ENOTDIR':
      return new BackupTargetError('Ein Teil des Backup-Pfads ist kein Ordner.');
    case 'EEXIST':
      return new BackupTargetError('Am Backup-Pfad liegt bereits etwas anderes (kein Ordner).');
    case 'EACCES':
    case 'EPERM':
    case 'EROFS':
      return new BackupTargetError('Der Backup-Ordner ist nicht beschreibbar.');
    case 'ELOOP':
      return new BackupTargetError('Der Backup-Pfad enthält eine Endlosschleife aus Verknüpfungen.');
    default:
      return new BackupTargetError('Der Backup-Ordner ist nicht vorhanden oder nicht beschreibbar.');
  }
}

const sameFile = (a: Stats | undefined, b: Stats | undefined) =>
  a !== undefined && b !== undefined && a.ino !== 0 && a.ino === b.ino && a.dev === b.dev;

/** Vorfahren von `path` samt `path` selbst (von innen nach außen) */
function ancestors(path: string): string[] {
  const result: string[] = [];
  for (let current = path; ; current = dirname(current)) {
    result.push(current);
    if (dirname(current) === current) return result;
  }
}

/** Geschützte Ordner relativ zum Datenordner */
const protectedFolders = (dataDir: string) => [
  { path: join(dataDir, 'media'), name: 'media' },
  { path: join(dataDir, 'vault'), name: 'vault' },
  { path: dataDir, name: null },
];

/** Prüft die reinen Pfadregeln gegen die bereits aufgelösten Pfade; wirft bei Verstoß */
function checkPaths(
  full: string,
  resolved: string,
  folders: { name: string | null; paths: string[] }[],
): void {
  for (const folder of folders) {
    if (!folder.paths.some((p) => isInside(full, p) || isInside(resolved, p))) continue;
    if (folder.name) {
      throw new BackupTargetError(
        `Das Backup-Ziel darf nicht in „${folder.name}“ des Datenordners liegen. ${DATA_DIR_HINT}`,
      );
    }
    throw new BackupTargetError(
      `Das Backup-Ziel darf nicht der Datenordner oder ein Ordner darin sein. ${DATA_DIR_HINT}`,
    );
  }
  if (FORBIDDEN_TARGET_PREFIXES.some((prefix) => isInside(full, prefix) || isInside(resolved, prefix))) {
    throw new BackupTargetError('Dieser Systemordner ist als Backup-Ziel nicht erlaubt.');
  }
}

function checkInput(target: string): string {
  if (target === '' || target.includes('\0') || !isAbsolute(target)) {
    throw new BackupTargetError('Der Backup-Ordner muss ein absoluter Pfad sein.');
  }
  // bewusst NICHT `resolve(target)`: das würde `..` textlich vor den Symlinks auswerten
  return target;
}

const splitParts = (path: string) => path.split(sep).filter((part) => part !== '' && part !== '.');
const rawParts = (path: string) => splitParts(path.slice(parse(path).root.length));

/** Nächster Stand nach einer Komponente: bei einem Symlink werden dessen Komponenten vorangestellt */
function stepFor(current: string, part: string, link: string | undefined) {
  if (link === undefined) return { current: join(current, part), prepend: [] as string[] };
  return { current: isAbsolute(link) ? parse(current).root : current, prepend: splitParts(link) };
}

// ---------------------------------------------------------------- synchron (CLI)

/**
 * Löst `path` auf wie der Kernel: Komponente für Komponente, `..` nach einem Symlink gilt für dessen Ziel, relative
 * Links werden gegen den echten Ordner des Links aufgelöst, Symlinks ins Leere über ihr Linkziel. Danach liefert
 * `realpath` (native: Schreibweise des Dateisystems) den tiefsten vorhandenen Vorfahren plus den fehlenden Rest.
 */
function realResolveSync(path: string): string {
  const queue = rawParts(path);
  let current = parse(path).root;
  let hops = 0;
  while (queue.length > 0) {
    const part = queue.shift() as string;
    if (part === '..') {
      current = dirname(current);
      continue;
    }
    const next = join(current, part);
    let link: string | undefined;
    try {
      if (lstatSync(next).isSymbolicLink()) link = readlinkSync(next);
    } catch (error) {
      if (codeOf(error) !== 'ENOENT') throw fsError(error);
    }
    if (link !== undefined && ++hops > MAX_LINK_HOPS) throw fsError({ code: 'ELOOP' });
    const step = stepFor(current, part, link);
    current = step.current;
    queue.unshift(...step.prepend);
  }
  const rest: string[] = [];
  for (;;) {
    try {
      return join(realpathSync.native(current), ...rest);
    } catch (error) {
      if (codeOf(error) !== 'ENOENT') throw fsError(error);
    }
    const parent = dirname(current);
    if (parent === current) throw fsError({ code: 'ENOENT' });
    rest.unshift(basename(current));
    current = parent;
  }
}

const statOrUndefined = (path: string): Stats | undefined => {
  try {
    return statSync(path);
  } catch {
    return undefined;
  }
};

/**
 * Prüft ein Backup-Ziel (synchron, für die CLI) und liefert den aufgelösten Pfad. Fehlerfälle werfen
 * `BackupTargetError` mit deutscher Meldung.
 */
export function checkBackupTarget(target: string, dataDir: string, options: BackupTargetOptions): string {
  const resolved = checkInput(target);
  try {
    const full = realResolveSync(resolved);
    const folders = protectedFolders(dataDir).map(({ path, name }) => ({
      name,
      paths: [...new Set([resolve(path), realResolveSync(path)])],
    }));
    checkPaths(full, full, folders);
    // Identität: jeder vorhandene Vorfahre darf nicht derselbe Ordner wie Datenordner, media/ oder vault/ sein
    const guarded = protectedFolders(dataDir).map(({ path, name }) => ({
      name,
      info: statOrUndefined(path),
    }));
    for (const ancestor of ancestors(full)) {
      const info = statOrUndefined(ancestor);
      const hit = guarded.find((g) => sameFile(info, g.info));
      if (hit) {
        throw new BackupTargetError(
          hit.name
            ? `Das Backup-Ziel darf nicht in „${hit.name}“ des Datenordners liegen. ${DATA_DIR_HINT}`
            : `Das Backup-Ziel darf nicht der Datenordner oder ein Ordner darin sein. ${DATA_DIR_HINT}`,
        );
      }
    }

    const info = statOrUndefined(full);
    if (!info) {
      if (!options.createMissing) throw fsError({ code: 'ENOENT' });
      if (!statOrUndefined(dirname(full))?.isDirectory()) {
        throw new BackupTargetError(
          'Das Backup-Ziel ist nicht vorhanden (Datenträger nicht angeschlossen?).',
        );
      }
      mkdirSync(full);
    } else if (!info.isDirectory()) {
      throw new BackupTargetError('Der Backup-Pfad ist kein Ordner.');
    }
    if (options.writable !== false) accessSync(full, constants.W_OK);
    return full;
  } catch (error) {
    throw fsError(error);
  }
}

// ---------------------------------------------------------------- asynchron (Core)

/** Wie `realResolveSync`, asynchron */
async function realResolve(path: string): Promise<string> {
  const queue = rawParts(path);
  let current = parse(path).root;
  let hops = 0;
  while (queue.length > 0) {
    const part = queue.shift() as string;
    if (part === '..') {
      current = dirname(current);
      continue;
    }
    const next = join(current, part);
    let link: string | undefined;
    try {
      if ((await lstat(next)).isSymbolicLink()) link = await readlink(next);
    } catch (error) {
      if (codeOf(error) !== 'ENOENT') throw fsError(error);
    }
    if (link !== undefined && ++hops > MAX_LINK_HOPS) throw fsError({ code: 'ELOOP' });
    const step = stepFor(current, part, link);
    current = step.current;
    queue.unshift(...step.prepend);
  }
  const rest: string[] = [];
  for (;;) {
    try {
      return join(await realpath(current), ...rest);
    } catch (error) {
      if (codeOf(error) !== 'ENOENT') throw fsError(error);
    }
    const parent = dirname(current);
    if (parent === current) throw fsError({ code: 'ENOENT' });
    rest.unshift(basename(current));
    current = parent;
  }
}

const statAsync = (path: string): Promise<Stats | undefined> => stat(path).catch(() => undefined);

/**
 * Wie `checkBackupTarget`, aber asynchron (`fs/promises`): Der Core blockiert die Event-Loop nicht, wenn ein
 * Netz- oder iCloud-Laufwerk hängt. `fs.promises.realpath` löst nativ auf.
 */
export async function checkBackupTargetAsync(
  target: string,
  dataDir: string,
  options: BackupTargetOptions,
): Promise<string> {
  const resolved = checkInput(target);
  try {
    const full = await realResolve(resolved);
    const folders = await Promise.all(
      protectedFolders(dataDir).map(async ({ path, name }) => ({
        name,
        paths: [...new Set([resolve(path), await realResolve(path)])],
      })),
    );
    checkPaths(full, full, folders);
    const guarded = await Promise.all(
      protectedFolders(dataDir).map(async ({ path, name }) => ({ name, info: await statAsync(path) })),
    );
    for (const ancestor of ancestors(full)) {
      const info = await statAsync(ancestor);
      const hit = guarded.find((g) => sameFile(info, g.info));
      if (hit) {
        throw new BackupTargetError(
          hit.name
            ? `Das Backup-Ziel darf nicht in „${hit.name}“ des Datenordners liegen. ${DATA_DIR_HINT}`
            : `Das Backup-Ziel darf nicht der Datenordner oder ein Ordner darin sein. ${DATA_DIR_HINT}`,
        );
      }
    }

    const info = await statAsync(full);
    if (!info) {
      if (!options.createMissing) throw fsError({ code: 'ENOENT' });
      if (!(await statAsync(dirname(full)))?.isDirectory()) {
        throw new BackupTargetError(
          'Das Backup-Ziel ist nicht vorhanden (Datenträger nicht angeschlossen?).',
        );
      }
      await mkdir(full);
    } else if (!info.isDirectory()) {
      throw new BackupTargetError('Der Backup-Pfad ist kein Ordner.');
    }
    if (options.writable !== false) await access(full, constants.W_OK);
    return full;
  } catch (error) {
    throw fsError(error);
  }
}
