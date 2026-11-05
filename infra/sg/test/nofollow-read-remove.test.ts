// #119: Ausdünnen und Restore-Quelle ohne Symlink-Folgen (verankertes Löschen und Lesen)
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { copyTree, readManifest, removeStalePartials, removeStand, treeSize } from '../src/backup-files.ts';
import { NoFollowReader, NoFollowRemover, NoFollowWriter, UnsafeTargetError } from '../src/nofollow.ts';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'sg-nf119-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Ordner des Opfers außerhalb des Ziels mit `count` Dateien `f<i>.jpg` */
function victim(count = 5): string {
  const dir = join(tmp(), 'opfer');
  mkdirSync(dir);
  for (let i = 1; i <= count; i++) writeFileSync(join(dir, `f${i}.jpg`), `OPFER${i}`);
  return dir;
}

/** Angreifer: Ordner beiseiteschieben und an seiner Stelle einen Symlink auf `to` anlegen */
function swapForLink(dir: string, to: string): string {
  const aside = `${dir}-weg`;
  renameSync(dir, aside);
  symlinkSync(to, dir);
  return aside;
}

/** Ein Stand im Ziel mit Manifest und `media/photos/f1..f5.jpg` */
function stand(target: string, name = '20261101T030000Z'): string {
  const dir = join(target, name);
  mkdirSync(join(dir, 'media', 'photos'), { recursive: true });
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({ version: 1, stand: name, dump: { sha256: 'a' } }),
  );
  for (let i = 1; i <= 5; i++) writeFileSync(join(dir, 'media', 'photos', `f${i}.jpg`), `STAND${i}`);
  return dir;
}

describe('Ausdünnen ohne Symlink-Folgen (N1)', () => {
  it('entfernt einen Stand vollständig; Symlinks darin werden als Eintrag gelöscht, nie verfolgt', () => {
    const target = tmp();
    const opfer = victim();
    const dir = stand(target);
    symlinkSync(opfer, join(dir, 'media', 'link-auf-opfer'));
    symlinkSync(join(opfer, 'f1.jpg'), join(dir, 'media', 'photos', 'datei-link'));
    expect(removeStand(target, '20261101T030000Z')).toBe(true);
    expect(existsSync(dir)).toBe(false);
    expect(readdirSync(opfer)).toHaveLength(5);
  });

  it('Tausch von media/photos gegen einen Symlink während des Löschens: kein Opfer-Eintrag verschwindet', () => {
    const target = tmp();
    const opfer = victim();
    const dir = stand(target);
    const photos = join(dir, 'media', 'photos');
    let swapped = false;
    const result = removeStand(target, '20261101T030000Z', {
      step: (op, phase, d) => {
        // nach der Prüfung der Ebene, unmittelbar vor dem Auflisten: photos/ gegen einen Link tauschen
        if (op === 'readdir' && phase === 'before' && d === photos && !swapped) {
          swapped = true;
          swapForLink(photos, opfer);
        }
      },
    });
    expect(swapped).toBe(true);
    expect(readdirSync(opfer).sort()).toEqual(['f1.jpg', 'f2.jpg', 'f3.jpg', 'f4.jpg', 'f5.jpg']);
    // Fail-closed: Der Ordner ist beim Betreten der Einträge nicht mehr der gesehene, der Rest bleibt stehen
    expect(readdirSync(`${photos}-weg`)).toHaveLength(5);
    expect(result).toBe('teilweise');
  });

  it('S1: Abbruch mitten im Löschen lässt manifest.json stehen, der nächste Lauf entfernt den Rest', () => {
    const target = tmp();
    const opfer = victim();
    const dir = stand(target);
    writeFileSync(join(dir, 'db.dump'), 'DUMP');
    const media = join(dir, 'media');
    let swapped = false;
    const first = removeStand(target, '20261101T030000Z', {
      step: (op, phase, d) => {
        if (op === 'readdir' && phase === 'before' && d === media && !swapped) {
          swapped = true;
          swapForLink(media, opfer);
        }
      },
    });
    expect(swapped).toBe(true);
    expect(first).toBe('teilweise');
    // Der Rest ist weiter ein Stand (mit Manifest), keine Waise
    expect(readManifest(dir)).not.toBeNull();
    expect(readdirSync(opfer)).toHaveLength(5);
    // Der Angreifer hört auf; der nächste Lauf löscht den Rest verankert (den Link nur als Eintrag)
    expect(removeStand(target, '20261101T030000Z')).toBe(true);
    expect(existsSync(dir)).toBe(false);
    expect(readdirSync(opfer)).toHaveLength(5);
  });

  it('S1b: neue Datei im Stand-Ordner während des Löschens: manifest.json bleibt, der nächste Lauf entfernt alles', () => {
    const target = tmp();
    const dir = stand(target);
    writeFileSync(join(dir, 'db.dump'), 'DUMP');
    let planted = false;
    const first = removeStand(target, '20261101T030000Z', {
      step: (op, phase, d, name) => {
        if (op === 'unlink' && phase === 'before' && d === dir && name === 'db.dump' && !planted) {
          planted = true;
          writeFileSync(join(dir, 'neu-vom-angreifer.txt'), 'X');
        }
      },
    });
    expect(planted).toBe(true);
    expect(first).toBe('teilweise');
    expect(readManifest(dir)).not.toBeNull(); // keine Waise
    expect(removeStand(target, '20261101T030000Z')).toBe(true);
    expect(existsSync(dir)).toBe(false);
  });

  it('Tausch des Elternordners direkt vor unlink: gelöscht wird nur im eigenen Ordner', () => {
    const target = tmp();
    const opfer = victim();
    const dir = stand(target);
    const photos = join(dir, 'media', 'photos');
    let aside = '';
    removeStand(target, '20261101T030000Z', {
      step: (op, phase, d) => {
        if (op === 'unlink' && phase === 'before' && d === photos && !aside)
          aside = swapForLink(photos, opfer);
      },
    });
    expect(aside).not.toBe('');
    expect(readdirSync(opfer)).toHaveLength(5);
    // Die erste Datei wurde relativ im echten Ordner gelöscht (das cwd hängt an der Inode), danach bricht es ab
    expect(readdirSync(aside).sort()).toEqual(['f2.jpg', 'f3.jpg', 'f4.jpg', 'f5.jpg']);
  });

  it('Tausch direkt vor rmdir: kein fremder Ordner wird entfernt', () => {
    const target = tmp();
    const opfer = victim();
    mkdirSync(join(opfer, 'photos'));
    const dir = stand(target);
    const media = join(dir, 'media');
    let aside = '';
    removeStand(target, '20261101T030000Z', {
      step: (op, phase, d, name) => {
        if (op === 'rmdir' && phase === 'before' && d === media && name === 'photos' && !aside) {
          aside = swapForLink(media, opfer);
        }
      },
    });
    expect(aside).not.toBe('');
    expect(lstatSync(join(opfer, 'photos')).isDirectory()).toBe(true);
    expect(existsSync(join(aside, 'photos'))).toBe(false);
  });

  it('removeStalePartials: dasselbe für alte .partial-Ordner', () => {
    const target = tmp();
    const opfer = victim();
    const partial = join(target, '.20261101T030000Z.partial');
    mkdirSync(join(partial, 'media'), { recursive: true });
    writeFileSync(join(partial, 'media', 'f1.jpg'), 'X');
    const media = join(partial, 'media');
    let swapped = false;
    const removed = removeStalePartials(target, Date.parse('2026-11-05T00:00:00Z'), 86_400_000, {
      step: (op, phase, d) => {
        if (op === 'readdir' && phase === 'before' && d === media && !swapped) {
          swapped = true;
          swapForLink(media, opfer);
        }
      },
    });
    expect(swapped).toBe(true);
    expect(readdirSync(opfer)).toHaveLength(5);
    expect(removed).toEqual([]); // nicht vollständig: Rest bleibt stehen
  });

  it('der Remover folgt auch einem Symlink als oberstem Eintrag nicht', () => {
    const target = tmp();
    const opfer = victim();
    symlinkSync(opfer, join(target, 'x'));
    const remover = new NoFollowRemover();
    remover.adopt(target);
    expect(remover.removeTree(target, 'x')).toEqual([]);
    expect(existsSync(join(target, 'x'))).toBe(false);
    expect(readdirSync(opfer)).toHaveLength(5);
  });
});

describe('Restore-Quelle ohne Symlink-Folgen (#119 Punkt 2)', () => {
  function reader(standDir: string): NoFollowReader {
    const r = new NoFollowReader();
    r.adopt(join(standDir, '..'));
    r.child(join(standDir, '..'), standDir.split('/').pop() as string);
    return r;
  }

  it('treeSize (streng): Symlink auf einen Ordner im Stand ist ein Fehler statt mitgezählt', () => {
    const target = tmp();
    const opfer = victim();
    const dir = stand(target);
    rmSync(join(dir, 'media', 'photos'), { recursive: true });
    symlinkSync(opfer, join(dir, 'media', 'photos'));
    const r = reader(dir);
    const media = r.child(dir, 'media') as string;
    expect(() => treeSize(media, { reader: r, strict: true })).toThrow(UnsafeTargetError);
    // ohne Strenge (Datenordner) wird der Link nur nicht gezählt
    expect(treeSize(join(dir, 'media'))).toEqual({ files: 0, bytes: 0 });
  });

  it('copyTree (streng): Symlink auf einen Ordner im Stand bricht ab, nichts vom Opfer wird kopiert', () => {
    const target = tmp();
    const opfer = victim();
    const dir = stand(target);
    symlinkSync(opfer, join(dir, 'media', 'fremd'));
    const r = reader(dir);
    const media = r.child(dir, 'media') as string;
    const data = tmp();
    expect(() =>
      copyTree(media, join(data, 'media.neu'), null, undefined, { reader: r, strictSource: true }),
    ).toThrow(UnsafeTargetError);
    expect(existsSync(join(data, 'media.neu', 'fremd'))).toBe(false);
  });

  it('copyTree (streng): Tausch eines Quellordners zwischen Prüfung und Auflisten/Öffnen bricht ab', () => {
    for (const op of ['readdir', 'open'] as const) {
      const target = tmp();
      const opfer = victim();
      const dir = stand(target);
      const photos = join(dir, 'media', 'photos');
      const r = new NoFollowReader({
        step: (o, phase, d) => {
          if (o === op && phase === 'before' && d === photos && !lstatSync(photos).isSymbolicLink()) {
            swapForLink(photos, opfer);
          }
        },
      });
      r.adopt(target);
      r.child(target, '20261101T030000Z');
      const media = r.child(dir, 'media') as string;
      const data = tmp();
      try {
        copyTree(media, join(data, 'media.neu'), null, undefined, { reader: r, strictSource: true });
      } catch (error) {
        expect(error).toBeInstanceOf(UnsafeTargetError);
      }
      const out = join(data, 'media.neu', 'photos');
      const copied = existsSync(out) ? readdirSync(out).map((f) => readFileSync(join(out, f), 'utf8')) : [];
      // Was kopiert wurde, stammt aus dem echten Stand-Ordner, nie vom Opfer
      expect(copied.every((c) => c.startsWith('STAND'))).toBe(true);
    }
  });

  it('Tausch des Ordners direkt vor open: geöffnet wird trotzdem die Datei im echten Ordner (verankert)', () => {
    const target = tmp();
    const opfer = victim();
    const dir = join(target, '20261101T030000Z');
    mkdirSync(join(dir, 'media', 'photos'), { recursive: true });
    writeFileSync(join(dir, 'media', 'photos', 'f1.jpg'), 'STAND1');
    const photos = join(dir, 'media', 'photos');
    let swapped = false;
    const r = new NoFollowReader({
      step: (op, phase, d) => {
        if (op === 'open' && phase === 'before' && d === photos && !swapped) {
          swapped = true;
          swapForLink(photos, opfer);
        }
      },
    });
    r.adopt(target);
    r.child(target, '20261101T030000Z');
    const media = r.child(dir, 'media') as string;
    const data = tmp();
    copyTree(media, join(data, 'media.neu'), null, undefined, { reader: r, strictSource: true });
    expect(swapped).toBe(true);
    expect(readFileSync(join(data, 'media.neu', 'photos', 'f1.jpg'), 'utf8')).toBe('STAND1');
  });

  it('Symlink als Datei im Stand: streng ein Fehler', () => {
    const target = tmp();
    const opfer = victim();
    const dir = stand(target);
    symlinkSync(join(opfer, 'f1.jpg'), join(dir, 'media', 'photos', 'link.jpg'));
    const r = reader(dir);
    const media = r.child(dir, 'media') as string;
    expect(() =>
      copyTree(media, join(tmp(), 'media.neu'), null, undefined, { reader: r, strictSource: true }),
    ).toThrow(UnsafeTargetError);
  });
});

describe('Hardlink-Quelle verankert (N2)', () => {
  it('voriger Stand wird vor dem Nachsehen gegen einen Link aufs Opfer getauscht: kein Hardlink auf die Opferdatei', () => {
    const base = tmp();
    const target = join(base, 'ziel');
    mkdirSync(target);
    // Datenordner mit a.jpg; voriger Stand mit gleicher Größe und Zeit; Opfer ebenso (sonst würde nie verlinkt)
    const data = join(base, 'daten', 'media');
    mkdirSync(data, { recursive: true });
    const t = new Date('2026-01-01T10:00:00Z');
    writeFileSync(join(data, 'a.jpg'), 'AAAA');
    utimesSync(join(data, 'a.jpg'), t, t);
    const prev = join(target, '20261101T030000Z', 'media');
    mkdirSync(prev, { recursive: true });
    writeFileSync(join(prev, 'a.jpg'), 'AAAA');
    utimesSync(join(prev, 'a.jpg'), t, t);
    const opfer = join(base, 'opfer');
    mkdirSync(opfer);
    writeFileSync(join(opfer, 'a.jpg'), 'GEHE');
    utimesSync(join(opfer, 'a.jpg'), t, t);

    const r = new NoFollowReader({}, true);
    r.adopt(target);
    r.adopt(data);
    const prevDir = r.child(r.child(target, '20261101T030000Z') as string, 'media');
    const out = new NoFollowWriter();
    out.adopt(target);
    const stats = copyTree(data, join(target, 'neu'), prevDir, undefined, {
      out,
      reader: r,
      beforeCopy: () => swapForLink(prev, opfer),
    });
    expect(stats.linked).toBe(0);
    expect(lstatSync(join(opfer, 'a.jpg')).nlink).toBe(1);
    expect(readFileSync(join(target, 'neu', 'a.jpg'), 'utf8')).toBe('AAAA');
  });
});
