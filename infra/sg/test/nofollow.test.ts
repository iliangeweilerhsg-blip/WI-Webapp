// #113: Schreiben ins Backup-Ziel ohne Symlink-Folgen, FIFO/Gerät statt Datei, PID-Dateien laufender Läufe
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { copyTree, readManifest } from '../src/backup-files.ts';
import { removeRunPids, runLiveness, runPidPath, sweepDeadRunPids, writeRunPid } from '../src/liveness.ts';
import {
  NoFollowWriter,
  readSmallRegularFile,
  UnsafeTargetError,
  type NoFollowHooks,
} from '../src/nofollow.ts';
import { copyAndHash, NOT_REGULAR, StandError, withVerifiedDump } from '../src/staging.ts';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'sg-nf-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Ein Ordner „außerhalb des Ziels“ mit einer Datei des Benutzers */
function victim(): { dir: string; file: string } {
  const dir = join(tmp(), 'benutzer');
  mkdirSync(dir);
  const file = join(dir, 'wichtig.txt');
  writeFileSync(file, 'GEHEIM');
  return { dir, file };
}

function mkfifo(path: string): void {
  execFileSync('mkfifo', [path]);
}

/** Schreiber, der beim ersten `mkdir` dessen Elternordner übernimmt (wie `sg backup` das geprüfte Ziel) */
function writer(hooks?: NoFollowHooks): NoFollowWriter {
  const w = new NoFollowWriter(hooks);
  const mkdir = w.mkdir.bind(w);
  let first = true;
  w.mkdir = (path: string) => {
    if (first) w.adopt(dirname(path));
    first = false;
    mkdir(path);
  };
  return w;
}

/** Angreifer: Ordner `dir` beiseiteschieben und an seiner Stelle einen Symlink auf `to` anlegen */
function swapForLink(dir: string, to: string): string {
  const aside = `${dir}-weg`;
  renameSync(dir, aside);
  symlinkSync(to, dir);
  return aside;
}

describe('NoFollowWriter', () => {
  it('Symlink an der Stelle einer neuen Datei: Fehler, die fremde Datei bleibt unverändert', () => {
    const root = join(tmp(), '.x.partial');
    const { file } = victim();
    const out = writer();
    out.mkdir(root);
    symlinkSync(file, join(root, 'manifest.json'));
    expect(() => out.writeFile(join(root, 'manifest.json'), 'BACKUP')).toThrow(UnsafeTargetError);
    expect(readFileSync(file, 'utf8')).toBe('GEHEIM');
  });

  it('vorhandene Datei wird nie überschrieben', () => {
    const root = join(tmp(), 'r');
    const out = writer();
    out.mkdir(root);
    writeFileSync(join(root, 'a'), 'FREMD');
    expect(() => out.writeFile(join(root, 'a'), 'NEU')).toThrow(UnsafeTargetError);
    expect(readFileSync(join(root, 'a'), 'utf8')).toBe('FREMD');
  });

  it('vorhandener Wurzelordner oder Symlink an seiner Stelle: Fehler, nichts gelöscht', () => {
    const base = tmp();
    const { dir, file } = victim();
    symlinkSync(dir, join(base, '.x.partial'));
    expect(() => writer().mkdir(join(base, '.x.partial'))).toThrow(UnsafeTargetError);
    expect(lstatSync(join(base, '.x.partial')).isSymbolicLink()).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe('GEHEIM');
  });

  it('Wurzel durch Symlink ersetzt: kein Schreiben (auch keine neue Datei) außerhalb', () => {
    const base = tmp();
    const root = join(base, '.x.partial');
    const { dir } = victim();
    const out = writer();
    out.mkdir(root);
    renameSync(root, join(base, 'weg'));
    symlinkSync(dir, root);
    expect(() => out.writeFile(join(root, 'manifest.json'), 'BACKUP')).toThrow(UnsafeTargetError);
    expect(() => out.mkdir(join(root, 'media'))).toThrow(UnsafeTargetError);
    expect(readdirSync(dir)).toEqual(['wichtig.txt']);
  });

  it('Unterordner durch Symlink ersetzt (auch eine Ebene höher): Fehler vor dem Schreiben', () => {
    const base = tmp();
    const root = join(base, 'r');
    const { dir } = victim();
    mkdirSync(join(dir, 'photos'));
    const out = writer();
    out.mkdir(root);
    out.mkdir(join(root, 'media'));
    out.mkdir(join(root, 'media', 'photos'));
    // Angreifer tauscht media/ gegen einen Link auf einen Ordner, der auch photos/ enthält
    renameSync(join(root, 'media'), join(root, 'm2'));
    symlinkSync(dir, join(root, 'media'));
    expect(() => out.writeFile(join(root, 'media', 'photos', 'a.jpg'), 'JPEG')).toThrow(UnsafeTargetError);
    expect(readdirSync(join(dir, 'photos'))).toEqual([]);
  });

  it('Aufräumen löscht nur Eigenes und folgt keinem Symlink', () => {
    const base = tmp();
    const root = join(base, 'r');
    const { dir, file } = victim();
    writeFileSync(join(dir, 'a.txt'), 'BENUTZER');
    const out = writer();
    out.mkdir(root);
    out.mkdir(join(root, 'media'));
    out.writeFile(join(root, 'media', 'a.txt'), 'BACKUP');
    out.writeFile(join(root, 'db.dump'), 'DUMP');
    writeFileSync(join(root, 'fremd.txt'), 'FREMD');
    // media/ wird gegen einen Link auf den Ordner des Benutzers getauscht (dort gibt es auch a.txt)
    renameSync(join(root, 'media'), join(base, 'media-weg'));
    symlinkSync(dir, join(root, 'media'));
    const left = out.cleanup();
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('BENUTZER');
    expect(readFileSync(file, 'utf8')).toBe('GEHEIM');
    expect(existsSync(join(root, 'db.dump'))).toBe(false); // eigene Datei weg
    expect(readFileSync(join(root, 'fremd.txt'), 'utf8')).toBe('FREMD'); // fremde bleibt
    expect(lstatSync(join(root, 'media')).isSymbolicLink()).toBe(true); // Link bleibt, nicht verfolgt
    expect(left).toContain(join(root, 'media'));
    expect(left).toContain(join(root, 'media', 'a.txt'));
  });

  it('Aufräumen ohne Fremdes entfernt den ganzen eigenen Baum', () => {
    const root = join(tmp(), 'r');
    const out = writer();
    out.mkdir(root);
    out.mkdir(join(root, 'vault'));
    out.writeFile(join(root, 'vault', 'n.md'), '#');
    expect(out.cleanup()).toEqual([]);
    expect(existsSync(root)).toBe(false);
  });

  it('Umbenennen: Ziel vorhanden oder Wurzel ausgetauscht → Fehler, nichts gelöscht', () => {
    const base = tmp();
    const out = writer();
    out.mkdir(join(base, '.s.partial'));
    mkdirSync(join(base, 's'));
    expect(() => out.renameDir(join(base, '.s.partial'), join(base, 's'))).toThrow(UnsafeTargetError);
    rmSync(join(base, 's'), { recursive: true });
    const { dir } = victim();
    renameSync(join(base, '.s.partial'), join(base, 'weg'));
    symlinkSync(dir, join(base, '.s.partial'));
    expect(() => out.renameDir(join(base, '.s.partial'), join(base, 's'))).toThrow(UnsafeTargetError);
    expect(existsSync(join(base, 's'))).toBe(false);
  });

  it('Hardlink: zeigt der neue Eintrag nicht auf die geprüfte Datei, wird er entfernt (false)', () => {
    const base = tmp();
    const out = writer();
    out.mkdir(join(base, 'r'));
    writeFileSync(join(base, 'alt'), 'A');
    writeFileSync(join(base, 'anders'), 'B');
    const expected = lstatSync(join(base, 'anders')); // „geprüft“ wurde eine andere Datei
    expect(out.link(join(base, 'alt'), join(base, 'r', 'x'), expected)).toBe(false);
    expect(existsSync(join(base, 'r', 'x'))).toBe(false);
    expect(out.link(join(base, 'alt'), join(base, 'r', 'x'), lstatSync(join(base, 'alt')))).toBe(true);
    expect(lstatSync(join(base, 'r', 'x')).ino).toBe(lstatSync(join(base, 'alt')).ino);
  });
});

describe('copyTree schreibt ohne Symlink-Folgen', () => {
  it('Symlink im Ziel an der Stelle einer Kopie: Lauf scheitert, die Datei außerhalb bleibt', () => {
    const base = tmp();
    const { file } = victim();
    mkdirSync(join(base, 'src'));
    writeFileSync(join(base, 'src', 'a.jpg'), 'JPEG');
    const dst = join(base, 'dst');
    expect(() =>
      copyTree(join(base, 'src'), dst, null, undefined, {
        beforeCopy: () => symlinkSync(file, join(dst, 'a.jpg')),
      }),
    ).toThrow(UnsafeTargetError);
    expect(readFileSync(file, 'utf8')).toBe('GEHEIM');
  });

  it('Unterordner im Ziel wird während des Kopierens gegen einen Link getauscht: nichts landet außerhalb', () => {
    const base = tmp();
    const { dir } = victim();
    mkdirSync(join(base, 'src', 'sub'), { recursive: true });
    writeFileSync(join(base, 'src', 'sub', 'a.jpg'), 'JPEG');
    const dst = join(base, 'dst');
    expect(() =>
      copyTree(join(base, 'src'), dst, null, undefined, {
        beforeCopy: () => {
          renameSync(join(dst, 'sub'), join(base, 'sub-weg'));
          symlinkSync(dir, join(dst, 'sub'));
        },
      }),
    ).toThrow(UnsafeTargetError);
    expect(readdirSync(dir)).toEqual(['wichtig.txt']);
  });

  it('vorhandener Zielordner (oder Link darauf) wird nicht weiterverwendet', () => {
    const base = tmp();
    const { dir } = victim();
    mkdirSync(join(base, 'src'));
    writeFileSync(join(base, 'src', 'b.txt'), 'B');
    symlinkSync(dir, join(base, 'dst'));
    expect(() => copyTree(join(base, 'src'), join(base, 'dst'), null)).toThrow(UnsafeTargetError);
    expect(readdirSync(dir)).toEqual(['wichtig.txt']);
  });
});

describe('Lesen aus dem Ziel: FIFO, Gerät, Symlink', () => {
  it('copyAndHash weist FIFO und Gerät ab, ohne zu hängen; Symlink als Quelle → ELOOP', async () => {
    const base = tmp();
    mkfifo(join(base, 'fifo'));
    await expect(copyAndHash(join(base, 'fifo'), join(base, 'k1'))).rejects.toMatchObject({
      code: NOT_REGULAR,
    });
    await expect(copyAndHash('/dev/zero', join(base, 'k2'))).rejects.toMatchObject({ code: NOT_REGULAR });
    writeFileSync(join(base, 'echt'), 'X');
    symlinkSync(join(base, 'echt'), join(base, 'link'));
    await expect(copyAndHash(join(base, 'link'), join(base, 'k3'))).rejects.toMatchObject({ code: 'ELOOP' });
    expect(existsSync(join(base, 'k1')) || existsSync(join(base, 'k2')) || existsSync(join(base, 'k3'))).toBe(
      false,
    );
  });

  it('copyAndHash: Symlink an der Stelle der Kopie wird nicht verfolgt', async () => {
    const base = tmp();
    const { file } = victim();
    writeFileSync(join(base, 'src'), 'DUMP');
    symlinkSync(file, join(base, 'dst'));
    await expect(copyAndHash(join(base, 'src'), join(base, 'dst'))).rejects.toMatchObject({ code: 'EEXIST' });
    expect(readFileSync(file, 'utf8')).toBe('GEHEIM');
  });

  it('db.dump als FIFO im Stand: "beschaedigt" statt hängen', async () => {
    const dataDir = tmp();
    const stand = tmp();
    mkfifo(join(stand, 'db.dump'));
    const err = await withVerifiedDump(
      dataDir,
      join(stand, 'db.dump'),
      'a'.repeat(64),
      'S',
      async () => 1,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StandError);
    expect((err as StandError).reason).toBe('beschaedigt');
    expect((err as StandError).message).toContain('keine reguläre Datei');
  });

  it('manifest.json als FIFO oder Symlink gilt als fehlend (kein Hängen)', () => {
    const stand = tmp();
    mkfifo(join(stand, 'manifest.json'));
    expect(readManifest(stand)).toBeNull();
    const other = tmp();
    writeFileSync(join(other, 'm.json'), JSON.stringify({ version: 1, stand: 'x', dump: { sha256: 'a' } }));
    const stand2 = tmp();
    symlinkSync(join(other, 'm.json'), join(stand2, 'manifest.json'));
    expect(readManifest(stand2)).toBeNull();
    expect(readSmallRegularFile(join(other, 'm.json'), 4)).toBeNull(); // zu groß
  });
});

describe('Tausch zwischen Prüfung und Systemaufruf (S1, B1)', () => {
  // Der Hook läuft nach der Identitätsprüfung des Ordners, unmittelbar vor bzw. nach dem Systemaufruf. Ein Angreifer
  // tauscht dort den Ordner gegen einen Symlink auf einen fremden Ordner. Weil alles relativ zum verankerten
  // Arbeitsverzeichnis läuft, trifft der Aufruf trotzdem den eigenen Ordner.

  it('Aufräumen (B1): Tausch direkt vor unlink löscht nie die gleichnamige fremde Datei', () => {
    const base = tmp();
    const root = join(base, '.s.partial');
    const { dir } = victim();
    writeFileSync(join(dir, 'db.dump'), 'OPFER');
    let aside = '';
    const out = writer({
      step: (op, phase, d) => {
        if (op === 'unlink' && phase === 'before' && !aside) aside = swapForLink(d, dir);
      },
    });
    out.mkdir(root);
    out.writeFile(join(root, 'db.dump'), 'DUMP');
    out.cleanup();
    expect(readFileSync(join(dir, 'db.dump'), 'utf8')).toBe('OPFER');
    expect(existsSync(join(aside, 'db.dump'))).toBe(false); // die eigene Datei ist weg
  });

  it('Aufräumen: Tausch direkt vor rmdir entfernt keinen fremden Ordner', () => {
    const base = tmp();
    const root = join(base, 'r');
    const { dir } = victim();
    mkdirSync(join(dir, 'media'));
    let aside = '';
    const out = writer({
      step: (op, phase, d) => {
        if (op === 'rmdir' && phase === 'before' && d === root && !aside) aside = swapForLink(d, dir);
      },
    });
    out.mkdir(root);
    out.mkdir(join(root, 'media'));
    out.cleanup();
    expect(existsSync(join(dir, 'media'))).toBe(true);
    expect(existsSync(join(aside, 'media'))).toBe(false);
  });

  it('Schreiben: Tausch direkt vor open legt keine Datei im fremden Ordner an', () => {
    const base = tmp();
    const root = join(base, 'r');
    const { dir } = victim();
    let aside = '';
    const out = writer({
      step: (op, phase, d) => {
        if (op === 'create' && phase === 'before') aside = swapForLink(d, dir);
      },
    });
    out.mkdir(root);
    out.writeFile(join(root, 'manifest.json'), 'BACKUP');
    expect(readdirSync(dir)).toEqual(['wichtig.txt']);
    expect(readFileSync(join(aside, 'manifest.json'), 'utf8')).toBe('BACKUP');
  });

  it('mkdir: Tausch direkt vor mkdir legt keinen Ordner im fremden Ordner an', () => {
    const base = tmp();
    const root = join(base, 'r');
    const { dir } = victim();
    let aside = '';
    const out = writer({
      step: (op, phase, d) => {
        if (op === 'mkdir' && phase === 'before' && d === root) aside = swapForLink(d, dir);
      },
    });
    out.mkdir(root);
    out.mkdir(join(root, 'media'));
    expect(readdirSync(dir)).toEqual(['wichtig.txt']);
    expect(lstatSync(join(aside, 'media')).isDirectory()).toBe(true);
  });

  it('mkdir: der neue Ordner wird direkt danach gegen einen Symlink getauscht → Fehler', () => {
    const base = tmp();
    const { dir } = victim();
    const out = writer({
      step: (op, phase, d, name) => {
        if (op === 'mkdir' && phase === 'after' && name === 'media') swapForLink(join(d, name), dir);
      },
    });
    out.mkdir(join(base, 'r'));
    expect(() => out.mkdir(join(base, 'r', 'media'))).toThrow(UnsafeTargetError);
  });

  it('Umbenennen: .partial wird direkt vor rename getauscht → Fehler (der Stand ist nicht der eigene Ordner)', () => {
    const base = tmp();
    const { dir } = victim();
    const out = writer({
      step: (op, phase, d, name) => {
        if (op === 'rename' && phase === 'before') swapForLink(join(d, name), dir);
      },
    });
    out.mkdir(join(base, '.s.partial'));
    expect(() => out.renameDir(join(base, '.s.partial'), join(base, 's'))).toThrow(UnsafeTargetError);
    expect(readdirSync(dir)).toEqual(['wichtig.txt']);
  });

  it('Hardlink: der neue Eintrag wird direkt danach ausgetauscht → kein Link behalten', () => {
    const base = tmp();
    writeFileSync(join(base, 'alt'), 'A');
    const out = writer({
      step: (op, phase, d, name) => {
        if (op === 'link' && phase === 'after') {
          rmSync(join(d, name));
          writeFileSync(join(d, name), 'FREMD');
        }
      },
    });
    out.mkdir(join(base, 'r'));
    expect(out.link(join(base, 'alt'), join(base, 'r', 'x'), lstatSync(join(base, 'alt')))).toBe(false);
    expect(existsSync(join(base, 'r', 'x'))).toBe(false);
  });

  it('das Arbeitsverzeichnis ist danach wieder das alte, auch nach einem Fehler', () => {
    const before = process.cwd();
    const base = tmp();
    const out = writer();
    out.mkdir(join(base, 'r'));
    writeFileSync(join(base, 'r', 'a'), 'x');
    expect(() => out.writeFile(join(base, 'r', 'a'), 'y')).toThrow(UnsafeTargetError);
    expect(process.cwd()).toBe(before);
  });
});

describe('PID-Datei eines Laufs (liveness)', () => {
  it('lebt / tot / unbekannt; Entfernen nur der eigenen Datei', () => {
    const dataDir = tmp();
    expect(runLiveness(dataDir, 'restore-test', 'T1')).toBe('unbekannt');
    const remove = writeRunPid(dataDir, 'restore-test', 'T1', 4242);
    expect(runLiveness(dataDir, 'restore-test', 'T1', () => true)).toBe('lebt');
    expect(runLiveness(dataDir, 'restore-test', 'T1', () => false)).toBe('tot');
    expect(runLiveness(dataDir, 'restore-test', 'T2', () => false)).toBe('unbekannt'); // anderer Lauf
    remove();
    expect(existsSync(runPidPath(dataDir, 'restore-test', 4242))).toBe(false);
    writeRunPid(dataDir, 'restore-test', 'T3', 4343);
    writeFileSync(runPidPath(dataDir, 'restore-test', 4343), 'kaputt');
    expect(runLiveness(dataDir, 'restore-test', 'T3', () => false)).toBe('unbekannt');
  });

  it('H1: zwei Prozesse desselben Laufs haben je eine Datei; stirbt einer, lebt der Lauf weiter', () => {
    const dataDir = tmp();
    const removeA = writeRunPid(dataDir, 'restore-test', 'T', 1001);
    writeRunPid(dataDir, 'restore-test', 'T', 1002);
    const alive = (pid: number) => pid === 1002; // 1001 ist per kill -9 beendet
    expect(runLiveness(dataDir, 'restore-test', 'T', alive)).toBe('lebt');
    expect(runLiveness(dataDir, 'restore-test', 'T', () => false)).toBe('tot');
    removeA(); // A räumt nur die eigene Datei weg
    expect(existsSync(runPidPath(dataDir, 'restore-test', 1002))).toBe(true);
    removeRunPids(dataDir, 'restore-test', 'T');
    expect(runLiveness(dataDir, 'restore-test', 'T', alive)).toBe('unbekannt');
  });

  it('H2: verwaiste Dateien toter Prozesse werden aufgeräumt, lebende und der eigene bleiben', () => {
    const dataDir = tmp();
    writeRunPid(dataDir, 'backup-a', 'a', 2001);
    writeRunPid(dataDir, 'backup-b', 'b', 2002);
    writeRunPid(dataDir, 'restore-test', 'T', process.pid);
    writeFileSync(join(dataDir, 'tmp', 'lauf-kaputt.2003.json'), 'x');
    writeFileSync(join(dataDir, 'tmp', 'anderes.json'), 'x');
    expect(sweepDeadRunPids(dataDir, (pid) => pid === 2002)).toBe(2);
    expect(readdirSync(join(dataDir, 'tmp')).sort()).toEqual([
      'anderes.json',
      `lauf-backup-b.2002.json`,
      `lauf-restore-test.${process.pid}.json`,
    ]);
  });

  it('der eigene Prozess lebt (echtes process.kill), eine sicher freie PID nicht', () => {
    const dataDir = tmp();
    writeRunPid(dataDir, 'a', 'R');
    expect(runLiveness(dataDir, 'a', 'R')).toBe('lebt');
    // Ein beendeter Kindprozess: seine PID ist frei
    const pid = Number(execFileSync('sh', ['-c', 'echo $$']).toString().trim());
    writeRunPid(dataDir, 'b', 'R', pid);
    expect(runLiveness(dataDir, 'b', 'R')).toBe('tot');
  });
});
