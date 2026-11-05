// Schreiben ins Backup-Ziel, ohne Symlinks zu folgen (Sicherheit, docs/VERTRAEGE.md §13, #113).
//
// Wer das Ziel beschreiben kann (USB-Platte, NAS, iCloud-Ordner), kann dort jederzeit Einträge umbenennen oder durch
// Symlinks ersetzen, auch im halbfertigen Stand `.<stand>.partial`. Ein Pfad wie `<ziel>/.<stand>.partial/db.dump`
// kann darum bei jedem Systemaufruf woanders hinführen, auch zwischen einer Prüfung und dem Aufruf danach.
//
// Node kennt kein `openat`/`unlinkat`. Ersatz ist das Arbeitsverzeichnis: Es hängt an der Inode, nicht am Pfad.
//   - Jeder Zugriff läuft in `inDir`: `chdir(<ordner>)`, dann `lstat('.')` gegen die beim Anlegen gespeicherte
//     Identität (`dev`/`ino`). Stimmt sie nicht, war irgendein Ordner im Pfad ausgetauscht: Abbruch.
//   - Danach nur **relative Namen ohne `/`** (`openSync(name)`, `mkdirSync(name)`, `unlinkSync(name)`, …). Sie
//     beziehen sich auf genau diese Inode, egal was im Pfad danach umbenannt oder ersetzt wird.
//   - Alles in `inDir` ist synchron (kein `await`), danach geht es per `chdir` zurück (`finally`). Kein anderer Code
//     sieht das geänderte Arbeitsverzeichnis. Die CLI nutzt sonst nur absolute Pfade.
// Dazu:
//   - Ordner entstehen einzeln (`mkdir` ohne `recursive`). Ein schon vorhandener Eintrag lässt den Lauf scheitern.
//   - Dateien entstehen exklusiv (`O_CREAT | O_EXCL | O_NOFOLLOW`), es wird nie etwas überschrieben. Geschrieben wird
//     über den Deskriptor, Zeiten per `futimes`.
//   - Aufräumen löscht nur, was dieser Schreiber selbst angelegt hat und was `lstat` im verankerten Ordner noch
//     unverändert zeigt (`unlink`, Ordner per `rmdir`, nur leere). Fremde Einträge bleiben liegen.
// Grenze: `link` und das Lesen des vorigen Standes nutzen absolute Pfade im Ziel (nur lesend bzw. als Quelle eines
// Hardlinks, der danach geprüft und sonst wieder entfernt wird).
import {
  closeSync,
  constants,
  fstatSync,
  futimesSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeSync,
  type Stats,
} from 'node:fs';
import { basename, dirname } from 'node:path';

/** Neue Datei: nur schreiben, muss neu entstehen, ein Symlink an ihrer Stelle wird nie verfolgt */
export const NEW_FILE_FLAGS =
  constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;
/** Quelle lesen: Symlink nicht verfolgen, eine FIFO blockiert `open` nicht (die Typprüfung folgt per `fstat`) */
export const READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

/** Im Ziel wurde etwas ausgetauscht oder lag schon etwas im Weg: der Lauf bricht ab (fail-closed) */
export class UnsafeTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeTargetError';
  }
}

interface Identity {
  dev: number;
  ino: number;
}

function identity(info: Identity): Identity {
  return { dev: info.dev, ino: info.ino };
}

function sameNode(a: Identity, b: Identity): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

export type NoFollowOp = 'mkdir' | 'create' | 'link' | 'rename' | 'unlink' | 'rmdir';

export interface NoFollowHooks {
  /**
   * Nur für Tests: läuft im verankerten Ordner `dir` nach der Identitätsprüfung unmittelbar vor (`before`) bzw. nach
   * (`after`) dem Systemaufruf für `name`. Ein Test tauscht hier Ordner aus wie ein Angreifer.
   */
  step?: (op: NoFollowOp, phase: 'before' | 'after', dir: string, name: string) => void;
}

const CHUNK = 1024 * 1024;

function exists(name: string): Stats | undefined {
  return lstatSync(name, { throwIfNoEntry: false });
}

/** Schreiber für einen Baum, den ein Lauf neu anlegt (`.<stand>.partial` im Ziel, Restore-Ordner im Datenordner) */
export class NoFollowWriter {
  private readonly dirs = new Map<string, Identity>();
  private readonly adopted = new Set<string>();
  private readonly files = new Map<string, Identity>();

  private readonly hooks: NoFollowHooks;

  constructor(hooks: NoFollowHooks = {}) {
    this.hooks = hooks;
  }

  /**
   * Übernimmt einen vorhandenen, vertrauenswürdigen Ordner als Ausgangspunkt (das per `realpath` geprüfte Ziel, der
   * Datenordner). Er wird nie gelöscht. Seine Identität gilt ab jetzt: Wird er ersetzt, scheitert jeder Zugriff.
   */
  adopt(dir: string): void {
    const info = statSync(dir);
    if (!info.isDirectory()) throw new UnsafeTargetError(`${dir} ist kein Ordner.`);
    this.dirs.set(dir, identity(info));
    this.adopted.add(dir);
  }

  /** `fn` mit `dir` als Arbeitsverzeichnis, nachdem geprüft ist, dass es genau der eigene Ordner ist */
  private inDir<T>(dir: string, fn: () => T): T {
    const expected = this.dirs.get(dir);
    if (!expected) throw new UnsafeTargetError(`${dir} wurde nicht von diesem Lauf angelegt.`);
    const back = process.cwd();
    try {
      process.chdir(dir);
    } catch {
      throw new UnsafeTargetError(
        `${dir} wurde während des Laufs ersetzt oder entfernt. Der Lauf bricht ab.`,
      );
    }
    try {
      if (!sameNode(lstatSync('.'), expected)) {
        throw new UnsafeTargetError(
          `${dir} wurde während des Laufs ersetzt (Symlink oder fremder Ordner im Pfad). Der Lauf bricht ab.`,
        );
      }
      return fn();
    } finally {
      process.chdir(back);
    }
  }

  private step(op: NoFollowOp, phase: 'before' | 'after', dir: string, name: string): void {
    this.hooks.step?.(op, phase, dir, name);
  }

  /** Legt den Ordner `path` neu an. Sein Elternordner muss von diesem Schreiber sein (angelegt oder übernommen). */
  mkdir(path: string): void {
    const parent = dirname(path);
    const name = basename(path);
    const info = this.inDir(parent, () => {
      this.step('mkdir', 'before', parent, name);
      try {
        mkdirSync(name);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new UnsafeTargetError(
            `${path} gibt es schon. Der Lauf bricht ab, ohne etwas zu überschreiben.`,
          );
        }
        throw error;
      }
      this.step('mkdir', 'after', parent, name);
      const created = exists(name);
      if (!created || created.isSymbolicLink() || !created.isDirectory()) {
        throw new UnsafeTargetError(`${path} wurde während des Laufs ersetzt.`);
      }
      return created;
    });
    this.dirs.set(path, identity(info));
  }

  /** Legt `path` exklusiv an (Ordner muss von diesem Schreiber sein). Rückgabe: Dateideskriptor zum Schreiben */
  openNew(path: string, mode = 0o644): number {
    const parent = dirname(path);
    const name = basename(path);
    return this.inDir(parent, () => {
      this.step('create', 'before', parent, name);
      let fd: number;
      try {
        fd = openSync(name, NEW_FILE_FLAGS, mode);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'EEXIST' || code === 'ELOOP') {
          throw new UnsafeTargetError(
            `${path} gibt es schon. Der Lauf bricht ab, ohne etwas zu überschreiben.`,
          );
        }
        throw error;
      }
      this.files.set(path, identity(fstatSync(fd)));
      return fd;
    });
  }

  /** Neue Datei mit festem Inhalt */
  writeFile(path: string, data: string | Buffer, mode = 0o644): void {
    const fd = this.openNew(path, mode);
    try {
      const buffer = typeof data === 'string' ? Buffer.from(data) : data;
      let offset = 0;
      while (offset < buffer.length) offset += writeSync(fd, buffer, offset, buffer.length - offset);
    } finally {
      closeSync(fd);
    }
  }

  /**
   * Kopiert die reguläre Datei `from` (absoluter Pfad im vertrauenswürdigen Datenordner) nach `to` (neu, exklusiv) mit
   * Rechten und Zeiten von `info`. `from` wird ohne Symlink-Folgen geöffnet; ist sie inzwischen keine reguläre Datei
   * mehr, ergibt das `ENOENT` (wie verschwunden).
   */
  copyFile(from: string, to: string, info: Stats): void {
    let input: number;
    try {
      input = openSync(from, READ_FLAGS);
    } catch (error) {
      // Inzwischen ein Symlink: wie eine verschwundene Datei behandeln (übersprungen und gezählt)
      if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
        throw Object.assign(new Error(`${from} ist keine reguläre Datei mehr.`), { code: 'ENOENT' });
      }
      throw error;
    }
    try {
      if (!fstatSync(input).isFile()) {
        throw Object.assign(new Error(`${from} ist keine reguläre Datei mehr.`), { code: 'ENOENT' });
      }
      const output = this.openNew(to, info.mode & 0o777);
      try {
        const buffer = Buffer.allocUnsafe(CHUNK);
        for (;;) {
          const n = readSync(input, buffer, 0, buffer.length, null);
          if (n === 0) break;
          let offset = 0;
          while (offset < n) offset += writeSync(output, buffer, offset, n - offset);
        }
        futimesSync(output, info.atime, info.mtime);
      } finally {
        closeSync(output);
      }
    } finally {
      closeSync(input);
    }
  }

  /**
   * Hardlink `to` auf die vorhandene Datei `existing` (voriger Stand), die beim Prüfen die Identität `expected` hatte.
   * Zeigt der neue Eintrag danach nicht genau auf diese Datei, wird er wieder entfernt und `false` zurückgegeben (der
   * Aufrufer kopiert dann). `false` auch, wenn kein Hardlink möglich ist. Ein Eintrag an der Stelle von `to` ist ein
   * Fehler.
   */
  link(existing: string, to: string, expected: Identity): boolean {
    const parent = dirname(to);
    const name = basename(to);
    return this.inDir(parent, () => {
      this.step('link', 'before', parent, name);
      try {
        linkSync(existing, name);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new UnsafeTargetError(
            `${to} gibt es schon. Der Lauf bricht ab, ohne etwas zu überschreiben.`,
          );
        }
        return false;
      }
      this.step('link', 'after', parent, name);
      const info = exists(name);
      if (!info || info.isSymbolicLink() || !info.isFile() || !sameNode(info, expected)) {
        // Nicht die geprüfte Datei: den gerade angelegten Eintrag im eigenen Ordner wieder entfernen
        if (info && !info.isDirectory()) unlinkSync(name);
        return false;
      }
      this.files.set(to, identity(info));
      return true;
    });
  }

  /**
   * Benennt den eigenen Ordner `from` in `to` um (gleicher Elternordner). `to` darf nicht existieren. Danach muss
   * unter `to` genau dieser Ordner liegen, sonst Fehler (es wird dann nichts gelöscht).
   */
  renameDir(from: string, to: string): void {
    const parent = dirname(from);
    if (dirname(to) !== parent) throw new Error('renameDir: nur innerhalb desselben Ordners');
    const fromName = basename(from);
    const toName = basename(to);
    const expected = this.dirs.get(from);
    if (!expected || this.adopted.has(from)) {
      throw new UnsafeTargetError(`${from} wurde nicht von diesem Lauf angelegt.`);
    }
    this.inDir(parent, () => {
      const before = exists(fromName);
      if (!before || before.isSymbolicLink() || !before.isDirectory() || !sameNode(before, expected)) {
        throw new UnsafeTargetError(`${from} wurde während des Laufs ersetzt. Der Lauf bricht ab.`);
      }
      if (exists(toName)) {
        throw new UnsafeTargetError(`${to} gibt es schon. Der Lauf bricht ab, ohne etwas zu überschreiben.`);
      }
      this.step('rename', 'before', parent, fromName);
      renameSync(fromName, toName);
      this.step('rename', 'after', parent, toName);
      const after = exists(toName);
      if (!after || after.isSymbolicLink() || !after.isDirectory() || !sameNode(after, expected)) {
        throw new UnsafeTargetError(`${to} ist nach dem Umbenennen nicht der Ordner dieses Laufs.`);
      }
    });
  }

  /** Eine eigene Datei wieder entfernen (z. B. wenn die Quelle beim Kopieren verschwunden ist) */
  removeOwnFile(path: string): void {
    const expected = this.files.get(path);
    if (!expected) return;
    this.files.delete(path);
    try {
      this.inDir(dirname(path), () => this.removeIfSame(dirname(path), basename(path), expected));
    } catch {
      // Ordner ausgetauscht: nichts löschen
    }
  }

  /**
   * Aufräumen nach einem Fehler: nur eigene Dateien und Ordner, nur wenn `lstat` sie im verankerten Ordner
   * unverändert zeigt (nie einem Symlink folgend). Rückgabe: Pfade, die liegen bleiben.
   */
  cleanup(): string[] {
    const left: string[] = [];
    for (const [path, expected] of [...this.files].reverse()) {
      const dir = dirname(path);
      const name = basename(path);
      try {
        this.inDir(dir, () => {
          if (!this.removeIfSame(dir, name, expected) && exists(name)) left.push(path);
        });
      } catch {
        left.push(path);
      }
    }
    this.files.clear();
    const dirs = [...this.dirs]
      .filter(([path]) => !this.adopted.has(path))
      .sort((a, b) => b[0].length - a[0].length); // tiefste zuerst
    for (const [path, expected] of dirs) {
      const parent = dirname(path);
      const name = basename(path);
      try {
        this.inDir(parent, () => {
          const info = exists(name);
          if (!info) return;
          if (info.isSymbolicLink() || !info.isDirectory() || !sameNode(info, expected)) {
            left.push(path);
            return;
          }
          this.step('rmdir', 'before', parent, name);
          try {
            rmdirSync(name); // nur leere Ordner: fremde Einträge darin bleiben
          } catch {
            left.push(path);
          }
        });
      } catch {
        left.push(path);
      }
    }
    return left;
  }

  /** Im verankerten Ordner: `name` löschen, wenn es noch genau die eigene Datei ist */
  private removeIfSame(dir: string, name: string, expected: Identity): boolean {
    const info = exists(name);
    if (!info || info.isSymbolicLink() || info.isDirectory() || !sameNode(info, expected)) return false;
    this.step('unlink', 'before', dir, name);
    unlinkSync(name);
    return true;
  }
}

/**
 * Liest eine kleine reguläre Datei, ohne einem Symlink zu folgen und ohne an einer FIFO oder einem Gerät zu hängen.
 * `null`, wenn sie fehlt, keine reguläre Datei ist oder größer als `maxBytes`.
 */
export function readSmallRegularFile(path: string, maxBytes: number): Buffer | null {
  let fd: number;
  try {
    fd = openSync(path, READ_FLAGS);
  } catch {
    return null;
  }
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.size > maxBytes) return null;
    const buffer = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < buffer.length) {
      const n = readSync(fd, buffer, offset, buffer.length - offset, null);
      if (n === 0) break;
      offset += n;
    }
    return buffer.subarray(0, offset);
  } finally {
    closeSync(fd);
  }
}
