// Schreiben ins Backup-Ziel, ohne Symlinks zu folgen (Sicherheit, docs/VERTRAEGE.md §13, #113).
//
// Wer das Ziel beschreiben kann (USB-Platte, NAS, iCloud-Ordner), kann dort jederzeit Einträge umbenennen oder durch
// Symlinks ersetzen, auch im halbfertigen Stand `.<stand>.partial`. Ohne Vorsicht würde die CLI dann Dateien
// außerhalb des Ziels überschreiben oder löschen. Darum gilt für alles, was ein Lauf im Ziel anlegt:
//   - Ordner entstehen einzeln (`mkdir` ohne `recursive`). Ein schon vorhandener Eintrag lässt den Lauf scheitern.
//     Die Identität (`dev`/`ino`) jedes angelegten Ordners wird festgehalten.
//   - Vor und nach jedem Schreiben in einen Ordner prüft `lstat` dessen Pfad: echter Ordner, kein Symlink, dieselbe
//     Identität. Ein ausgetauschter Ordner irgendwo im Pfad fällt so auf, weil der Pfad dann zu einem anderen Ordner
//     führt.
//   - Dateien entstehen exklusiv (`O_CREAT | O_EXCL | O_NOFOLLOW`). Steht an ihrer Stelle schon eine Datei oder ein
//     Symlink, scheitert der Lauf. Es wird nie etwas überschrieben. Zeiten werden über den Dateideskriptor gesetzt.
//   - Aufräumen löscht nur, was dieser Schreiber selbst angelegt hat, und nur, wenn `lstat` noch genau diese Datei
//     bzw. diesen Ordner zeigt. Ordner werden mit `rmdir` entfernt (nur leere). Fremde Einträge bleiben liegen.
// Grenze: Node kennt kein `openat`/`unlinkat`. Zwischen Prüfung und Systemaufruf bleibt ein sehr kurzes Fenster, in
// dem ein Ordner im Pfad getauscht werden kann. Dank `O_EXCL` kann ein Schreiben dabei höchstens eine **neue** Datei
// anlegen, nie eine bestehende überschreiben. Die Prüfung danach lässt den Lauf dann scheitern.
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
  unlinkSync,
  writeSync,
  type Stats,
} from 'node:fs';
import { dirname } from 'node:path';

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

function sameNode(a: Identity, b: Identity): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

const CHUNK = 1024 * 1024;

/** Schreiber für einen Baum, den ein Lauf neu anlegt (`.<stand>.partial` im Ziel, Restore-Ordner im Datenordner) */
export class NoFollowWriter {
  private readonly dirs = new Map<string, Identity>();
  private readonly files = new Map<string, Identity>();

  /**
   * Legt den Ordner `path` neu an. Ist der Elternordner von diesem Schreiber, wird er vorher und nachher geprüft;
   * sonst ist `path` die Wurzel des Baums (ihr Elternordner gilt als vertrauenswürdig, etwa das per `realpath`
   * geprüfte Ziel). Ein schon vorhandener Eintrag (auch ein Symlink) ergibt einen Fehler.
   */
  mkdir(path: string): void {
    const parent = dirname(path);
    const own = this.dirs.has(parent);
    if (own) this.checkDir(parent);
    try {
      mkdirSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new UnsafeTargetError(
          `${path} gibt es schon. Der Lauf bricht ab, ohne etwas zu überschreiben.`,
        );
      }
      throw error;
    }
    const info = lstatSync(path);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new UnsafeTargetError(`${path} wurde während des Laufs ersetzt.`);
    }
    this.dirs.set(path, { dev: info.dev, ino: info.ino });
    if (own) this.checkDir(parent);
  }

  /** Wirft, wenn `path` nicht mehr genau der von diesem Schreiber angelegte, echte Ordner ist */
  checkDir(path: string): void {
    const expected = this.dirs.get(path);
    if (!expected) throw new UnsafeTargetError(`${path} wurde nicht von diesem Lauf angelegt.`);
    const info = lstatSync(path, { throwIfNoEntry: false });
    if (!info || info.isSymbolicLink() || !info.isDirectory() || !sameNode(info, expected)) {
      throw new UnsafeTargetError(
        `${path} wurde während des Laufs ersetzt oder entfernt (Symlink oder fremder Ordner). Der Lauf bricht ab.`,
      );
    }
  }

  /**
   * Prüfung um das Anlegen einer Datei, deren Deskriptor jemand anders öffnet (`copyAndHash`):
   * `before()` prüft den Ordner, `after(fd-Info)` merkt sich die Datei und prüft den Ordner erneut.
   */
  guard(path: string): { before: () => void; after: (info: Identity) => void } {
    const parent = dirname(path);
    return {
      before: () => this.checkDir(parent),
      after: (info) => {
        this.files.set(path, { dev: info.dev, ino: info.ino });
        this.checkDir(parent);
      },
    };
  }

  /** Legt `path` exklusiv an (Ordner muss von diesem Schreiber sein). Rückgabe: Dateideskriptor zum Schreiben */
  openNew(path: string, mode = 0o644): number {
    const { before, after } = this.guard(path);
    before();
    let fd: number;
    try {
      fd = openSync(path, NEW_FILE_FLAGS, mode);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EEXIST' || code === 'ELOOP') {
        throw new UnsafeTargetError(
          `${path} gibt es schon. Der Lauf bricht ab, ohne etwas zu überschreiben.`,
        );
      }
      throw error;
    }
    try {
      after(fstatSync(fd));
    } catch (error) {
      closeSync(fd);
      throw error;
    }
    return fd;
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
   * Kopiert die reguläre Datei `from` nach `to` (neu, exklusiv) mit Rechten und Zeiten von `info`. `from` wird
   * ohne Symlink-Folgen geöffnet; ist sie inzwischen keine reguläre Datei mehr, ergibt das `ENOENT` (wie verschwunden).
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
   * Hardlink `to` auf die vorhandene Datei `existing`, die beim Prüfen die Identität `expected` hatte. Zeigt der
   * neue Eintrag danach nicht genau auf diese Datei (etwa weil `existing` inzwischen ein Symlink ist und das System
   * ihm folgt), wird der Link wieder entfernt und `false` zurückgegeben (der Aufrufer kopiert dann). `false` auch,
   * wenn kein Hardlink möglich ist (anderes Dateisystem). Ein Eintrag an der Stelle von `to` ist ein Fehler.
   */
  link(existing: string, to: string, expected: Identity): boolean {
    const { before, after } = this.guard(to);
    before();
    try {
      linkSync(existing, to);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') {
        throw new UnsafeTargetError(`${to} gibt es schon. Der Lauf bricht ab, ohne etwas zu überschreiben.`);
      }
      return false;
    }
    const info = lstatSync(to, { throwIfNoEntry: false });
    if (!info || info.isSymbolicLink() || !info.isFile() || !sameNode(info, expected)) {
      // Nicht die geprüfte Datei: den eigenen, gerade angelegten Eintrag wieder entfernen
      if (info) this.removeIfSame(to, info);
      this.checkDir(dirname(to));
      return false;
    }
    after(info);
    return true;
  }

  /**
   * Benennt den Wurzelordner `from` (von diesem Schreiber) in `to` um. `to` darf nicht existieren. Danach muss unter
   * `to` genau dieser Ordner liegen, sonst Fehler (es wird dann nichts gelöscht).
   */
  renameDir(from: string, to: string): void {
    this.checkDir(from);
    if (lstatSync(to, { throwIfNoEntry: false })) {
      throw new UnsafeTargetError(`${to} gibt es schon. Der Lauf bricht ab, ohne etwas zu überschreiben.`);
    }
    renameSync(from, to);
    const expected = this.dirs.get(from) as Identity;
    const info = lstatSync(to, { throwIfNoEntry: false });
    if (!info || info.isSymbolicLink() || !info.isDirectory() || !sameNode(info, expected)) {
      throw new UnsafeTargetError(`${to} ist nach dem Umbenennen nicht der Ordner dieses Laufs.`);
    }
  }

  /** Eine eigene Datei wieder entfernen (z. B. wenn die Quelle beim Kopieren verschwunden ist) */
  removeOwnFile(path: string): void {
    const expected = this.files.get(path);
    if (!expected) return;
    this.removeIfSame(path, expected);
    this.files.delete(path);
  }

  /**
   * Aufräumen nach einem Fehler: nur eigene Dateien und Ordner, nur wenn `lstat` sie unverändert zeigt (nie einem
   * Symlink folgend). Rückgabe: Pfade, die liegen bleiben (fremde Einträge, ausgetauschte Ordner).
   */
  cleanup(): string[] {
    const left: string[] = [];
    for (const [path, expected] of [...this.files].reverse()) {
      if (!this.removeIfSame(path, expected) && lstatSync(path, { throwIfNoEntry: false })) left.push(path);
    }
    this.files.clear();
    const dirs = [...this.dirs].sort((a, b) => b[0].length - a[0].length); // tiefste zuerst
    for (const [path, expected] of dirs) {
      const info = lstatSync(path, { throwIfNoEntry: false });
      if (!info) continue;
      if (info.isSymbolicLink() || !info.isDirectory() || !sameNode(info, expected)) {
        left.push(path);
        continue;
      }
      try {
        rmdirSync(path); // nur leere Ordner: fremde Einträge darin bleiben
      } catch {
        left.push(path);
      }
    }
    return left;
  }

  private removeIfSame(path: string, expected: Identity): boolean {
    const info = lstatSync(path, { throwIfNoEntry: false });
    if (!info || info.isSymbolicLink() || info.isDirectory() || !sameNode(info, expected)) return false;
    unlinkSync(path);
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
