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
  readdirSync,
  readSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeSync,
  type Stats,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

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

export type NoFollowOp =
  'mkdir' | 'create' | 'link' | 'rename' | 'unlink' | 'rmdir' | 'readdir' | 'open' | 'lstat';

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

/**
 * Gemeinsame Grundlage: Ordner mit gespeicherter Identität und der verankerte Zugriff `inDir` (`chdir` plus
 * `lstat('.')`). Schreiber, Leser und Löschen bauen darauf auf.
 */
export class AnchoredDirs {
  protected readonly dirs = new Map<string, Identity>();
  protected readonly adopted = new Set<string>();
  protected readonly hooks: NoFollowHooks;

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

  /** Ist `dir` bekannt (übernommen, angelegt oder verankert betreten)? */
  knows(dir: string): boolean {
    return this.dirs.has(dir);
  }

  /**
   * `fn` mit `dir` als Arbeitsverzeichnis, nachdem geprüft ist, dass es genau der bekannte Ordner ist. Mit
   * `missing = 'enoent'` wird ein verschwundener Ordner als `ENOENT` gemeldet (Datenordner: wie verschwunden zählen),
   * sonst ist er ein Verstoß.
   */
  protected inDir<T>(dir: string, fn: () => T, missing: 'unsafe' | 'enoent' = 'unsafe'): T {
    const expected = this.dirs.get(dir);
    if (!expected) throw new UnsafeTargetError(`${dir} wurde nicht von diesem Lauf angelegt.`);
    const back = process.cwd();
    try {
      process.chdir(dir);
    } catch (error) {
      if (missing === 'enoent' && (error as NodeJS.ErrnoException).code === 'ENOENT') throw error;
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

  protected step(op: NoFollowOp, phase: 'before' | 'after', dir: string, name: string): void {
    this.hooks.step?.(op, phase, dir, name);
  }
}

/** Schreiber für einen Baum, den ein Lauf neu anlegt (`.<stand>.partial` im Ziel, Restore-Ordner im Datenordner) */
export class NoFollowWriter extends AnchoredDirs {
  private readonly files = new Map<string, Identity>();

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

  /** Kopiert aus dem offenen Deskriptor `input` (verankert geöffnet) nach `to` (neu, exklusiv), Rechte und Zeiten von `info` */
  copyFromFd(input: number, to: string, info: Stats): void {
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
 * Liest einen Baum im Ziel (Stand beim Restore, voriger Stand beim Backup) oder im Datenordner, ohne Symlinks zu
 * folgen (#119). Jeder Ordner wird verankert betreten (`chdir` plus Identität aus dem `lstat`, mit dem er gesehen
 * wurde), Einträge werden relativ mit `readdir('.')`/`lstat` gelesen und Dateien relativ mit `O_NOFOLLOW` geöffnet.
 * Ein Ordner, der beim Betreten nicht mehr der gesehene ist, ist ein Verstoß (`UnsafeTargetError`).
 */
export class NoFollowReader extends AnchoredDirs {
  private readonly missing: 'unsafe' | 'enoent';

  /** `missingIsVanished`: im Datenordner gilt ein inzwischen fehlender Ordner als verschwunden (`ENOENT`) */
  constructor(hooks: NoFollowHooks = {}, missingIsVanished = false) {
    super(hooks);
    this.missing = missingIsVanished ? 'enoent' : 'unsafe';
  }

  /** `lstat` von `name` im verankerten Ordner `dir` (`undefined`, wenn es fehlt) */
  stat(dir: string, name: string): Stats | undefined {
    return this.inDir(dir, () => exists(name), this.missing);
  }

  /**
   * Unterordner `name` von `dir`: `null`, wenn es ihn nicht gibt. Ist er ein Symlink oder kein Ordner, wirft das
   * `UnsafeTargetError` (oder bei `optional = 'skip'` ebenfalls `null`). Sonst wird er mit der gesehenen Identität
   * bekannt gemacht und sein Pfad zurückgegeben.
   */
  child(dir: string, name: string, other: 'fail' | 'skip' = 'fail'): string | null {
    const info = this.stat(dir, name);
    if (!info) return null;
    if (info.isSymbolicLink() || !info.isDirectory()) {
      if (other === 'skip') return null;
      throw new UnsafeTargetError(`${join(dir, name)} ist kein echter Ordner (Symlink oder Sonderdatei).`);
    }
    return this.enter(dir, name, info);
  }

  /** Unterordner aus `list` bekannt machen (Identität aus dem `lstat` beim Auflisten) */
  enter(dir: string, name: string, info: Identity): string {
    const path = join(dir, name);
    this.dirs.set(path, identity(info));
    return path;
  }

  /** Einträge von `dir` mit ihrem `lstat`, beides relativ im verankerten Ordner */
  list(dir: string): { name: string; info: Stats }[] {
    return this.inDir(
      dir,
      () => {
        this.step('readdir', 'before', dir, '.');
        const result: { name: string; info: Stats }[] = [];
        for (const name of readdirSync('.')) {
          this.step('lstat', 'before', dir, name);
          const info = exists(name);
          if (info) result.push({ name, info });
        }
        return result;
      },
      this.missing,
    );
  }

  /**
   * Öffnet die reguläre Datei `name` in `dir` relativ (`O_NOFOLLOW | O_NONBLOCK`). Ist sie ein Symlink, eine FIFO
   * oder ein Gerät, wirft das `UnsafeTargetError`; fehlt sie, `ENOENT`. Rückgabe: Deskriptor und `fstat`.
   */
  open(dir: string, name: string): { fd: number; info: Stats } {
    return this.inDir(
      dir,
      () => {
        this.step('open', 'before', dir, name);
        let fd: number;
        try {
          fd = openSync(name, READ_FLAGS);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
            throw new UnsafeTargetError(`${join(dir, name)} ist ein Symlink.`);
          }
          throw error;
        }
        const info = fstatSync(fd);
        if (!info.isFile()) {
          closeSync(fd);
          throw new UnsafeTargetError(`${join(dir, name)} ist keine reguläre Datei.`);
        }
        return { fd, info };
      },
      this.missing,
    );
  }
}

/**
 * Löscht `<parent>/<name>` samt Inhalt, ohne je einem Symlink zu folgen (Ausdünnen im Ziel, #119). `parent` muss
 * bekannt sein (übernommen). Jede Ebene wird verankert betreten (`chdir` plus Vergleich mit dem `lstat`, mit dem sie
 * gesehen wurde), gelöscht wird nur relativ (`unlink`, `rmdir`). Symlinks werden als Eintrag entfernt, nie verfolgt.
 * Weicht ein Ordner beim Betreten ab (Tausch), wird dort nicht weiter abgestiegen: Der Rest bleibt stehen
 * (fail-closed). Rückgabe: Pfade, die stehen bleiben.
 */
export class NoFollowRemover extends AnchoredDirs {
  removeTree(parent: string, name: string): string[] {
    const left: string[] = [];
    this.removeEntry(parent, name, left);
    return left;
  }

  private removeEntry(parent: string, name: string, left: string[]): void {
    const path = join(parent, name);
    let info: Stats | undefined;
    try {
      info = this.inDir(parent, () => exists(name));
    } catch {
      left.push(path);
      return;
    }
    if (!info) return;
    if (info.isSymbolicLink() || !info.isDirectory()) {
      try {
        this.inDir(parent, () => {
          const now = exists(name);
          if (!now || now.isDirectory()) return; // inzwischen ein Ordner: nicht hier
          this.step('unlink', 'before', parent, name);
          unlinkSync(name);
        });
      } catch {
        left.push(path);
      }
      return;
    }
    this.dirs.set(path, identity(info));
    let entries: string[];
    try {
      entries = this.inDir(path, () => {
        this.step('readdir', 'before', path, '.');
        return readdirSync('.');
      });
    } catch {
      left.push(path); // ausgetauscht: nicht weiter absteigen
      return;
    }
    for (const entry of entries) this.removeEntry(path, entry, left);
    try {
      this.inDir(parent, () => {
        const now = exists(name);
        if (!now || now.isSymbolicLink() || !now.isDirectory() || !sameNode(now, info)) {
          left.push(path);
          return;
        }
        this.step('rmdir', 'before', parent, name);
        rmdirSync(name);
      });
    } catch {
      left.push(path);
    }
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
