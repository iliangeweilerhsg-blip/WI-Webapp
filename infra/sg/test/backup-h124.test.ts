// #124: Hardlink verankert (H1), Ziel-Identität durchreichen (H2), Ursache beim Ausdünnen (H3), Testlücke beim
// strengen dev/ino-Vergleich (Restore-Quelle)
import {
  chmodSync,
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
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  copyTree,
  describeLeft,
  oneLine,
  readManifest,
  removeStalePartialsReport,
  removeStandReport,
} from '../src/backup-files.ts';
import { leftoverWarning, thin, validateTarget, type Leftover, type OwnedStands } from '../src/backup.ts';
import {
  LINK_STAGING_DIR,
  NoFollowReader,
  NoFollowWriter,
  UnsafeTargetError,
  type NoFollowHooks,
} from '../src/nofollow.ts';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'sg-h124-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) {
    chmodRecursive(d);
    rmSync(d, { recursive: true, force: true });
  }
});

/** Rechte für das Aufräumen wiederherstellen (Tests, die Ordner sperren) */
function chmodRecursive(dir: string): void {
  try {
    const info = lstatSync(dir);
    if (info.isSymbolicLink() || !info.isDirectory()) return;
    chmodSync(dir, 0o755);
    for (const name of readdirSync(dir)) chmodRecursive(join(dir, name));
  } catch {
    // schon weg
  }
}

/** Angreifer: Ordner beiseiteschieben und an seiner Stelle einen Symlink auf `to` anlegen */
function swapForLink(dir: string, to: string): string {
  const aside = `${dir}-weg`;
  renameSync(dir, aside);
  symlinkSync(to, dir);
  return aside;
}

/**
 * Ist unter `root` ein Eintrag mit der Inode `ino` für einen anderen Benutzer erreichbar? Ein anderer Benutzer kommt
 * nur durch Ordner, die für „andere“ durchsuchbar sind (`o+x`). Symlinks werden nicht verfolgt.
 */
function reachableByOthers(root: string, ino: number): string | null {
  let info;
  try {
    info = lstatSync(root);
  } catch {
    return null;
  }
  if (info.isSymbolicLink()) return null;
  if (!info.isDirectory()) return info.ino === ino ? root : null;
  if ((info.mode & 0o001) === 0) return null;
  for (const name of readdirSync(root)) {
    const hit = reachableByOthers(join(root, name), ino);
    if (hit) return hit;
  }
  return null;
}

/** Ziel mit vorigem Stand `alt/media/photos/f1.jpg` und Opfer `opfer/f1.jpg` (gleicher Name) */
function linkScene() {
  const base = tmp();
  const prevPhotos = join(base, 'alt', 'media', 'photos');
  mkdirSync(prevPhotos, { recursive: true });
  writeFileSync(join(prevPhotos, 'f1.jpg'), 'STAND');
  const opfer = join(base, 'opfer');
  mkdirSync(opfer, { mode: 0o700 }); // für andere nicht durchsuchbar: nur über einen Link im Ziel erreichbar
  chmodSync(opfer, 0o700);
  writeFileSync(join(opfer, 'f1.jpg'), 'GEHEIM');
  chmodSync(join(opfer, 'f1.jpg'), 0o644);
  const victimIno = lstatSync(join(opfer, 'f1.jpg')).ino;
  const partial = join(base, '.s.partial');
  return { base, prevPhotos, opfer, victimIno, partial };
}

function writerFor(base: string, hooks?: NoFollowHooks): NoFollowWriter {
  const out = new NoFollowWriter(hooks);
  out.adopt(base);
  return out;
}

describe('H1: Hardlink entsteht im privaten Ordner und kommt erst geprüft an seinen Platz', () => {
  it('Tausch der Quelle gegen einen Link aufs Opfer: der fremde Link ist zu keinem Zeitpunkt für andere erreichbar', () => {
    const { base, prevPhotos, opfer, victimIno, partial } = linkScene();
    const expected = lstatSync(join(prevPhotos, 'f1.jpg'));
    const exposures: string[] = [];
    let swapped = false;
    let sawForeignLink = false;
    const out = writerFor(base, {
      step: (op, phase) => {
        if (op === 'link' && phase === 'before' && !swapped) {
          swapped = true;
          swapForLink(prevPhotos, opfer); // wie renameat2(RENAME_EXCHANGE) im falschen Moment
        }
        // An jedem Schritt nachsehen, ob ein anderer Benutzer die fremde Datei über das Ziel öffnen könnte
        const hit = reachableByOthers(partial, victimIno);
        if (hit) exposures.push(`${op}/${phase}: ${hit}`);
        if (op === 'link' && phase === 'after') {
          sawForeignLink = readdirSync(join(partial, 'photos', LINK_STAGING_DIR)).length > 0;
        }
      },
    });
    out.mkdir(partial);
    out.mkdir(join(partial, 'photos'));
    // Wie ein Ziel mit üblicher umask: der halbe Stand ist für andere durchsuchbar (unabhängig von der umask hier)
    chmodSync(partial, 0o755);
    chmodSync(join(partial, 'photos'), 0o755);
    expect(out.link(join(prevPhotos, 'f1.jpg'), join(partial, 'photos', 'f1.jpg'), expected)).toBe(false);
    expect(swapped).toBe(true);
    expect(sawForeignLink).toBe(true); // der Tausch hat getroffen: es gab einen Link auf die fremde Datei
    expect(exposures).toEqual([]);
    expect(existsSync(join(partial, 'photos', 'f1.jpg'))).toBe(false);
    out.endLinks(join(partial, 'photos'));
    expect(readdirSync(join(partial, 'photos'))).toEqual([]);
    expect(readFileSync(join(opfer, 'f1.jpg'), 'utf8')).toBe('GEHEIM');
  });

  it('der private Ordner ist 0700 und gehört dem Lauf; die geprüfte Datei kommt per Link an ihren Platz', () => {
    const { base, prevPhotos, partial } = linkScene();
    const expected = lstatSync(join(prevPhotos, 'f1.jpg'));
    let stagingMode = -1;
    const out = writerFor(base, {
      step: (op, phase, d) => {
        if (op === 'link' && phase === 'after') {
          stagingMode = lstatSync(d).mode & 0o777;
          expect(d).toBe(join(partial, 'photos', LINK_STAGING_DIR));
          expect(existsSync(join(partial, 'photos', 'f1.jpg'))).toBe(false);
        }
      },
    });
    out.mkdir(partial);
    out.mkdir(join(partial, 'photos'));
    expect(out.link(join(prevPhotos, 'f1.jpg'), join(partial, 'photos', 'f1.jpg'), expected)).toBe(true);
    expect(stagingMode).toBe(0o700);
    expect(lstatSync(join(partial, 'photos', 'f1.jpg')).ino).toBe(expected.ino);
    // im privaten Ordner bleibt nichts, er verschwindet mit endLinks
    expect(readdirSync(join(partial, 'photos', LINK_STAGING_DIR))).toEqual([]);
    out.endLinks(join(partial, 'photos'));
    expect(readdirSync(join(partial, 'photos'))).toEqual(['f1.jpg']);
  });

  it('ein Eintrag an der Zielstelle wird nie überschrieben (link statt rename)', () => {
    const { base, prevPhotos, partial } = linkScene();
    const expected = lstatSync(join(prevPhotos, 'f1.jpg'));
    const out = writerFor(base, {
      step: (op, phase) => {
        // Angreifer legt die Datei an, nachdem der Link geprüft ist und bevor er seinen Platz bekommt
        if (op === 'place' && phase === 'before') writeFileSync(join(partial, 'photos', 'f1.jpg'), 'FREMD');
      },
    });
    out.mkdir(partial);
    out.mkdir(join(partial, 'photos'));
    expect(() => out.link(join(prevPhotos, 'f1.jpg'), join(partial, 'photos', 'f1.jpg'), expected)).toThrow(
      UnsafeTargetError,
    );
    expect(readFileSync(join(partial, 'photos', 'f1.jpg'), 'utf8')).toBe('FREMD');
    expect(readdirSync(join(partial, 'photos', LINK_STAGING_DIR))).toEqual([]);
  });

  it('nach dem Platzieren ausgetauscht: Abbruch statt fremde Datei im Stand', () => {
    const { base, prevPhotos, partial } = linkScene();
    const expected = lstatSync(join(prevPhotos, 'f1.jpg'));
    const out = writerFor(base, {
      step: (op, phase, d, name) => {
        if (op === 'place' && phase === 'after') {
          rmSync(join(d, name));
          writeFileSync(join(d, name), 'FREMD');
        }
      },
    });
    out.mkdir(partial);
    out.mkdir(join(partial, 'photos'));
    expect(() => out.link(join(prevPhotos, 'f1.jpg'), join(partial, 'photos', 'f1.jpg'), expected)).toThrow(
      /nicht die geprüfte Datei/,
    );
  });

  it('Dateisystem meldet den privaten Ordner nicht als privat: kopieren statt verlinken, kein Rest', () => {
    const { base, prevPhotos, partial } = linkScene();
    const expected = lstatSync(join(prevPhotos, 'f1.jpg'));
    const out = writerFor(base, {
      step: (op, phase, d, name) => {
        if (op === 'mkdir' && phase === 'after' && name === LINK_STAGING_DIR) chmodSync(join(d, name), 0o755);
      },
    });
    out.mkdir(partial);
    out.mkdir(join(partial, 'photos'));
    expect(out.link(join(prevPhotos, 'f1.jpg'), join(partial, 'photos', 'f1.jpg'), expected)).toBe(false);
    expect(readdirSync(join(partial, 'photos'))).toEqual([]);
  });

  it('copyTree: Hardlinks wie bisher, der private Ordner bleibt nie im Stand', () => {
    const base = tmp();
    const src = join(base, 'src');
    mkdirSync(join(src, 'photos'), { recursive: true });
    writeFileSync(join(src, 'photos', 'a.jpg'), 'A');
    writeFileSync(join(src, 'b.txt'), 'B');
    const t = new Date('2026-01-01T00:00:00Z');
    utimesSync(join(src, 'photos', 'a.jpg'), t, t);
    utimesSync(join(src, 'b.txt'), t, t);
    copyTree(src, join(base, 'eins'), null);
    const stats = copyTree(src, join(base, 'zwei'), join(base, 'eins'));
    expect(stats.linked).toBe(2);
    expect(lstatSync(join(base, 'zwei', 'photos', 'a.jpg')).ino).toBe(
      lstatSync(join(base, 'eins', 'photos', 'a.jpg')).ino,
    );
    expect(readdirSync(join(base, 'zwei')).sort()).toEqual(['b.txt', 'photos']);
    expect(readdirSync(join(base, 'zwei', 'photos'))).toEqual(['a.jpg']);
  });
});

/** Ein Stand mit Manifest und `media/photos/f1..f3.jpg` */
function stand(target: string, name: string): string {
  const dir = join(target, name);
  mkdirSync(join(dir, 'media', 'photos'), { recursive: true });
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({ version: 1, stand: name, dump: { sha256: 'a' } }),
  );
  writeFileSync(join(dir, 'db.dump'), 'DUMP');
  for (let i = 1; i <= 3; i++) writeFileSync(join(dir, 'media', 'photos', `f${i}.jpg`), `STAND${i}`);
  return dir;
}

describe('H2: Ausdünnen verankert das Ziel mit der Identität aus validateTarget', () => {
  it('Ziel nach der Prüfung gegen einen Link auf einen fremden Ordner getauscht: dort wird nichts gelöscht', () => {
    const dataDir = tmp();
    const target = join(tmp(), 'ziel');
    mkdirSync(target);
    const checked = validateTarget(target, dataDir);
    // Fremder Ordner mit Ständen, die das Ausdünnen löschen würde (zwei am selben Tag: der ältere geht)
    const fremd = join(tmp(), 'fremd');
    mkdirSync(fremd);
    stand(fremd, '20261001T030000Z');
    stand(fremd, '20261001T040000Z');
    mkdirSync(join(fremd, '.20261001T030000Z.partial'));
    writeFileSync(join(fremd, '.20261001T030000Z.partial', 'x'), 'X');
    swapForLink(checked.path, fremd);

    const logs: string[] = [];
    const result = thin(
      checked,
      owned('20261001T030000Z', '20261001T040000Z'),
      Date.parse('2026-11-05T00:00:00Z'),
      (m) => logs.push(m),
    );
    expect(result.removed).toEqual([]);
    expect(readdirSync(fremd).sort()).toEqual([
      '.20261001T030000Z.partial',
      '20261001T030000Z',
      '20261001T040000Z',
    ]);
    expect(readdirSync(join(fremd, '20261001T030000Z', 'media', 'photos'))).toHaveLength(3);
    expect(result.left.map((l) => l.name).sort()).toEqual(['.20261001T030000Z.partial', '20261001T030000Z']);
    expect(logs.join('\n')).toMatch(/ausgetauscht/);
  });

  it('removeStandReport und removeStalePartialsReport einzeln: fremde Identität → nichts gelöscht', () => {
    const dataDir = tmp();
    const target = join(tmp(), 'ziel');
    mkdirSync(target);
    const checked = validateTarget(target, dataDir);
    const fremd = join(tmp(), 'fremd');
    mkdirSync(fremd);
    stand(fremd, '20261001T030000Z');
    mkdirSync(join(fremd, '.20261001T030000Z.partial'));
    swapForLink(checked.path, fremd);
    expect(removeStandReport(checked, '20261001T030000Z')).toMatchObject({
      status: 'teilweise',
      left: [{ cause: 'getauscht' }],
    });
    expect(
      removeStalePartialsReport(checked, Date.parse('2026-11-05T00:00:00Z'), 86_400_000).removed,
    ).toEqual([]);
    expect(readManifest(join(fremd, '20261001T030000Z'))).not.toBeNull();
    expect(existsSync(join(fremd, '.20261001T030000Z.partial'))).toBe(true);
  });

  it('unverändertes Ziel: Ausdünnen wie bisher', () => {
    const target = join(tmp(), 'ziel');
    mkdirSync(target);
    const checked = validateTarget(target, tmp());
    stand(target, '20261001T030000Z');
    stand(target, '20261001T040000Z');
    const result = thin(
      checked,
      owned('20261001T030000Z', '20261001T040000Z'),
      Date.parse('2026-11-05T00:00:00Z'),
    );
    expect(result).toEqual({ removed: ['20261001T030000Z'], left: [] });
    expect(readdirSync(target)).toEqual(['20261001T040000Z']);
  });
});

/** Diese Stände gelten als eigene Läufe (`backup_run`, H-1 aus #161); die Testmanifeste tragen die Prüfsumme `a` */
function owned(...stands: string[]): { owned: OwnedStands } {
  return { owned: new Map(stands.map((s) => [s, { trigger: 'zeitplan', sha256: 'a' }])) };
}

/** Fehler wie vom Kernel (`code`) */
function sysError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: simuliert`), { code });
}

describe('H3: Ursache, wenn ein Stand nicht entfernt werden kann', () => {
  it('keine Berechtigung (z. B. immutable, ACL): Log nennt EPERM bzw. EACCES, nicht „ausgetauscht“', () => {
    const target = tmp();
    const dir = stand(target, '20261001T030000Z');
    const photos = join(dir, 'media', 'photos');
    const report = removeStandReport(target, '20261001T030000Z', {
      step: (op, phase, d, name) => {
        if (op === 'unlink' && phase === 'before' && d === photos && name === 'f2.jpg')
          throw sysError('EPERM');
      },
    });
    expect(report.status).toBe('teilweise');
    const text = describeLeft(report.left, dir);
    expect(text).toContain('EPERM');
    expect(text).toContain('media/photos/f2.jpg');
    expect(text).not.toMatch(/ausgetauscht/);
    expect(readManifest(dir)).not.toBeNull(); // bleibt ein Stand, der nächste Lauf versucht es erneut
  });

  it('echt gesperrter Ordner (nur ohne root prüfbar): EACCES', () => {
    if (process.getuid?.() === 0) return; // root übergeht Dateirechte; der Fall oben simuliert den Fehler
    const target = tmp();
    const dir = stand(target, '20261001T030000Z');
    chmodSync(join(dir, 'media', 'photos'), 0o500);
    const report = removeStandReport(target, '20261001T030000Z');
    expect(describeLeft(report.left, dir)).toContain('EACCES');
  });

  it('Ordner nicht leer: ENOTEMPTY statt „ausgetauscht“', () => {
    const target = tmp();
    const dir = stand(target, '20261001T030000Z');
    const media = join(dir, 'media');
    let planted = false;
    const report = removeStandReport(target, '20261001T030000Z', {
      step: (op, phase, d, name) => {
        if (op === 'rmdir' && phase === 'before' && d === media && name === 'photos' && !planted) {
          planted = true;
          writeFileSync(join(media, 'photos', 'neu.jpg'), 'X');
        }
      },
    });
    expect(planted).toBe(true);
    const text = describeLeft(report.left, dir);
    expect(text).toContain('ENOTEMPTY');
    expect(text).toContain('media/photos');
    expect(text).not.toMatch(/ausgetauscht/);
  });

  it('echter Tausch bleibt als solcher gemeldet', () => {
    const target = tmp();
    const dir = stand(target, '20261001T030000Z');
    const photos = join(dir, 'media', 'photos');
    const fremd = tmp();
    let swapped = false;
    const report = removeStandReport(target, '20261001T030000Z', {
      step: (op, phase, d) => {
        if (op === 'readdir' && phase === 'before' && d === photos && !swapped) {
          swapped = true;
          swapForLink(photos, fremd);
        }
      },
    });
    expect(describeLeft(report.left, dir)).toMatch(/ausgetauscht/);
  });

  it('thin meldet die Ursache im Log und im Ergebnis', () => {
    const target = join(tmp(), 'ziel');
    mkdirSync(target);
    const checked = validateTarget(target, tmp());
    const dir = stand(target, '20261001T030000Z');
    stand(target, '20261001T040000Z');
    const logs: string[] = [];
    const own = owned('20261001T030000Z', '20261001T040000Z');
    const result = thin(checked, own, Date.parse('2026-11-05T00:00:00Z'), (m) => logs.push(m), {
      step: (op, phase, d) => {
        if (op === 'unlink' && phase === 'before' && d === dir) throw sysError('EACCES');
      },
    });
    expect(result.left).toEqual([
      { name: '20261001T030000Z', reason: expect.stringContaining('EACCES'), cause: 'EACCES' },
    ]);
    expect(logs.join('\n')).toMatch(
      /20261001T030000Z nicht vollständig entfernt: Keine Berechtigung \(EACCES\)/,
    );
    expect(logs.join('\n')).not.toMatch(/ausgetauscht/);
  });
});

describe('Testlücke: strenger dev/ino-Vergleich beim Lesen der Restore-Quelle', () => {
  it('Datei zwischen Auflisten und Öffnen gegen eine andere reguläre Datei getauscht: Abbruch', () => {
    const base = tmp();
    const src = join(base, 'stand');
    mkdirSync(join(src, 'media'), { recursive: true });
    writeFileSync(join(src, 'media', 'a.jpg'), 'ECHT');
    writeFileSync(join(base, 'andere.jpg'), 'UNTERGESCHOBEN');
    const reader = new NoFollowReader();
    reader.adopt(src);
    let swapped = false;
    expect(() =>
      copyTree(src, join(base, 'kopie'), null, undefined, {
        reader,
        strictSource: true,
        beforeCopy: (path) => {
          if (path.endsWith('a.jpg') && !swapped) {
            swapped = true;
            renameSync(join(base, 'andere.jpg'), path); // gleicher Name, reguläre Datei, andere Inode
          }
        },
      }),
    ).toThrow(/ausgetauscht/);
    expect(swapped).toBe(true);
    expect(existsSync(join(base, 'kopie', 'media', 'a.jpg'))).toBe(false);
  });
});

describe('H1: privater Ordner nur, wenn er wirklich privat ist (Nacharbeit Review #160)', () => {
  it('gehört er nicht dem Lauf (anderer Besitzer): kopieren statt verlinken, kein Rest', () => {
    const { base, prevPhotos, partial } = linkScene();
    const expected = lstatSync(join(prevPhotos, 'f1.jpg'));
    const out = writerFor(base);
    out.mkdir(partial);
    out.mkdir(join(partial, 'photos'));
    const uid = process.getuid?.() ?? 0;
    vi.spyOn(process, 'getuid').mockReturnValue(uid + 1);
    expect(out.link(join(prevPhotos, 'f1.jpg'), join(partial, 'photos', 'f1.jpg'), expected)).toBe(false);
    expect(readdirSync(join(partial, 'photos'))).toEqual([]);
  });

  it('Gruppe hat Rechte (0750): kopieren statt verlinken, kein Rest', () => {
    const { base, prevPhotos, partial } = linkScene();
    const expected = lstatSync(join(prevPhotos, 'f1.jpg'));
    const out = writerFor(base, {
      step: (op, phase, d, name) => {
        if (op === 'mkdir' && phase === 'after' && name === LINK_STAGING_DIR) chmodSync(join(d, name), 0o750);
      },
    });
    out.mkdir(partial);
    out.mkdir(join(partial, 'photos'));
    expect(out.link(join(prevPhotos, 'f1.jpg'), join(partial, 'photos', 'f1.jpg'), expected)).toBe(false);
    expect(readdirSync(join(partial, 'photos'))).toEqual([]);
  });

  it('privater Ordner vor endLinks ausgetauscht: Abbruch, der fremde Ordner bleibt', () => {
    const { base, prevPhotos, partial } = linkScene();
    const expected = lstatSync(join(prevPhotos, 'f1.jpg'));
    const photos = join(partial, 'photos');
    const out = writerFor(base);
    out.mkdir(partial);
    out.mkdir(photos);
    expect(out.link(join(prevPhotos, 'f1.jpg'), join(photos, 'f1.jpg'), expected)).toBe(true);
    // Angreifer: eigenen (leeren) Ordner an die Stelle des privaten legen
    renameSync(join(photos, LINK_STAGING_DIR), join(base, 'weg'));
    mkdirSync(join(photos, LINK_STAGING_DIR));
    expect(() => out.endLinks(photos)).toThrow(UnsafeTargetError);
    expect(existsSync(join(photos, LINK_STAGING_DIR))).toBe(true);
  });
});

describe('chdir ohne Zugriff: „nicht zugänglich“ statt „ausgetauscht“ (Nacharbeit Review #160)', () => {
  /** Kernel-Fehler wie von `chdir` */
  function chdirFails(dir: string, code: string): void {
    const real = process.chdir.bind(process);
    vi.spyOn(process, 'chdir').mockImplementation((to: string) => {
      if (to === dir) throw Object.assign(new Error(`${code}: chdir`), { code });
      real(to);
    });
  }

  it('simuliert (läuft auch als root): Ausdünnen nennt EACCES, Schreiber meldet „nicht zugänglich“', () => {
    const target = tmp();
    const dir = stand(target, '20261001T030000Z');
    const photos = join(dir, 'media', 'photos');
    chdirFails(photos, 'EACCES');
    const report = removeStandReport(target, '20261001T030000Z');
    expect(report.left[0]).toEqual({ path: photos, cause: 'EACCES' });
    expect(describeLeft(report.left, dir)).toMatch(/^Keine Berechtigung \(EACCES\)/);
    vi.restoreAllMocks();

    const out = new NoFollowWriter();
    out.adopt(target);
    chdirFails(target, 'EPERM');
    expect(() => out.mkdir(join(target, 'neu'))).toThrow(/nicht zugänglich \(EPERM\)/);
  });

  it('echt (nur ohne root): Ordner 0000 bzw. 0600 ergibt EACCES', () => {
    if (process.getuid?.() === 0) return; // root darf jeden Ordner betreten
    for (const mode of [0o000, 0o600]) {
      const target = tmp();
      const dir = stand(target, '20261001T030000Z');
      chmodSync(join(dir, 'media'), mode);
      const report = removeStandReport(target, '20261001T030000Z');
      expect(describeLeft(report.left, dir)).toContain('EACCES');
      chmodSync(join(dir, 'media'), 0o755);
    }
  });
});

describe('Texte (Nacharbeit Review #160)', () => {
  const left = (name: string, cause = 'EPERM'): Leftover => ({ name, reason: 'x', cause });

  it('Warnung ohne Fachbegriffe; ein .partial heißt „unvollständiger Stand“', () => {
    const one = leftoverWarning([left('20261001T030000Z')]);
    expect(one).toBe(
      'Ein alter Backup-Stand lässt sich seit mehreren Läufen nicht löschen (keine Berechtigung). Prüfe das Backup-Ziel und lösche den Ordner „20261001T030000Z“ von Hand.',
    );
    expect(one).not.toMatch(/EPERM|EACCES|ACL|partial/);
    expect(leftoverWarning([left('.20261001T030000Z.partial', 'getauscht')])).toMatch(
      /^Ein unvollständiger Stand lässt sich .* \(das Ziel wurde dabei verändert\)/,
    );
    expect(leftoverWarning([])).toBeNull();
  });

  it('viele Reste: höchstens 500 Zeichen, mit „und N weitere“', () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      left(`202610${String((i % 28) + 1).padStart(2, '0')}T0${i % 10}0000Z`),
    );
    const text = leftoverWarning(many) as string;
    expect(text.length).toBeLessThanOrEqual(500);
    expect(text).toMatch(/^60 alte Backup-Stände lassen sich/);
    expect(text).toMatch(/und \d+ weitere\.$/);
  });

  it('Log: kein „: .“, wenn der Stand-Ordner selbst bleibt; Namen aus dem Stand auf einer Zeile', () => {
    const base = '/ziel/20261001T030000Z';
    expect(describeLeft([{ path: base, cause: 'getauscht' }], base)).toBe(
      'Im Ziel wurde während des Löschens etwas ausgetauscht',
    );
    const text = describeLeft([{ path: `${base}/media/böse\nZeile\u0007.jpg`, cause: 'EPERM' }], base);
    expect(text).toContain('(bei media/böse?Zeile?.jpg)');
    expect(text.includes('\n') || text.includes('\u0007')).toBe(false);
    expect(oneLine('a\r\nb\u2028c')).toBe('a??b?c');
  });
});
