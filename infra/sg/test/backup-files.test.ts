import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  copyTree,
  listStands,
  readManifest,
  removeStalePartials,
  removeStand,
  selectRetention,
  standDate,
  standName,
  type Manifest,
} from '../src/backup-files.ts';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'sg-bf-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function write(path: string, content: string, mtime?: Date): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
  if (mtime) utimesSync(path, mtime, mtime);
}

describe('Standnamen', () => {
  it('UTC, ohne Trennzeichen und Millisekunden, und zurück', () => {
    const date = new Date('2026-11-04T03:00:12.345Z');
    expect(standName(date)).toBe('20261104T030012Z');
    expect(standDate('20261104T030012Z').toISOString()).toBe('2026-11-04T03:00:12.000Z');
    expect(() => standDate('2026-11-04')).toThrow();
  });
});

/** Ein Stand pro Tag um 03:00 UTC, `count` Tage rückwärts ab 2026-11-04 */
function dailyStands(count: number): string[] {
  const out: string[] = [];
  const end = Date.UTC(2026, 10, 4, 3, 0, 0);
  for (let i = 0; i < count; i += 1) out.push(standName(new Date(end - i * 86_400_000)));
  return out;
}

describe('selectRetention (14 täglich, 8 wöchentlich, 6 monatlich)', () => {
  it('behält alles, solange es weniger als 14 Tage sind', () => {
    const stands = dailyStands(10);
    const { keep, remove } = selectRetention(stands);
    expect(keep).toHaveLength(10);
    expect(remove).toEqual([]);
  });

  it('14 Tage täglich; danach nur noch je ein Stand pro Woche und Monat, höchstens 8 + 6', () => {
    const stands = dailyStands(400);
    const { keep } = selectRetention(stands);
    const days = keep.slice(0, 14).map((s) => s.slice(0, 8));
    expect(days).toEqual(dailyStands(14).map((s) => s.slice(0, 8)));
    // Die ersten 14 sind lückenlos täglich
    expect(keep.length).toBeGreaterThan(14);
    expect(keep.length).toBeLessThanOrEqual(14 + 8 + 6);
    // Wochenstufe: lückenlos aufeinanderfolgende Wochen, je Woche ein Stand, alle älter als die Tagesstufe
    const weekly = keep.slice(14, 14 + 8).map((s) => standDate(s).getTime());
    expect(weekly[0]!).toBeLessThan(standDate(keep[13] as string).getTime());
    for (let i = 1; i < weekly.length; i += 1) {
      const gapDays = ((weekly[i - 1] as number) - (weekly[i] as number)) / 86_400_000;
      expect(gapDays).toBeGreaterThanOrEqual(1);
      expect(gapDays).toBeLessThanOrEqual(13);
    }
    // Monatsstufe: je Monat höchstens einer, alle älter als die Wochenstufe
    const monthly = keep.slice(14 + 8);
    expect(monthly).toHaveLength(6);
    expect(new Set(monthly.map((s) => s.slice(0, 6))).size).toBe(6);
    expect(monthly[0]! < (keep[14 + 7] as string)).toBe(true);
  });

  it('nimmt pro Tag den neuesten Stand und löscht die übrigen desselben Tages', () => {
    const stands = ['20261104T010000Z', '20261104T030000Z', '20261104T230000Z', '20261103T120000Z'];
    const { keep, remove } = selectRetention(stands);
    expect(keep).toEqual(['20261104T230000Z', '20261103T120000Z']);
    expect(remove).toEqual(['20261104T030000Z', '20261104T010000Z']);
  });

  it('der neueste Stand bleibt immer; ungültige Namen werden ignoriert', () => {
    const { keep, remove } = selectRetention(['20261104T030000Z', 'unsinn', '20261104T030000Z']);
    expect(keep).toEqual(['20261104T030000Z']);
    expect(remove).toEqual([]);
  });

  it('seltene Backups: ältere Monate bleiben erhalten, auch ohne tägliche Stufe', () => {
    // Ein Backup pro Monat über 10 Monate
    const stands = Array.from({ length: 10 }, (_, i) => standName(new Date(Date.UTC(2026, 9 - i, 15, 3))));
    const { keep } = selectRetention(stands);
    // alles liegt in der Tagesstufe (je Tag einer, weniger als 14 Tage-Einträge)
    expect(keep).toHaveLength(10);
  });
});

describe('copyTree (inkrementell mit Hardlinks)', () => {
  it('kopiert alles, überspringt .part/.tmp, verlinkt Unverändertes auf den vorigen Stand', () => {
    const root = tmp();
    const src = join(root, 'src');
    const t0 = new Date('2026-01-01T10:00:00Z');
    write(join(src, 'a.txt'), 'AAA', t0);
    write(join(src, 'sub', 'b.txt'), 'BBB', t0);
    write(join(src, 'halb.part'), 'x');
    write(join(src, '.tmp', 'x'), 'x');

    const first = join(root, 'stand1');
    const stats1 = copyTree(src, first, null);
    expect(stats1).toMatchObject({ files: 2, bytes: 6, copied: 2, linked: 0 });
    expect(existsSync(join(first, 'halb.part'))).toBe(false);
    expect(existsSync(join(first, '.tmp'))).toBe(false);
    expect(readFileSync(join(first, 'sub', 'b.txt'), 'utf8')).toBe('BBB');
    expect(lstatSync(join(first, 'a.txt')).mtimeMs).toBe(t0.getTime());

    // Änderung: a.txt neu (andere Größe), b.txt gleich, c.txt neu
    write(join(src, 'a.txt'), 'AAAA', new Date('2026-01-02T10:00:00Z'));
    write(join(src, 'c.txt'), 'C', t0);
    const second = join(root, 'stand2');
    const stats2 = copyTree(src, second, first);
    expect(stats2).toMatchObject({ files: 3, copied: 2, linked: 1 });
    expect(lstatSync(join(second, 'sub', 'b.txt')).ino).toBe(lstatSync(join(first, 'sub', 'b.txt')).ino);
    expect(lstatSync(join(second, 'a.txt')).ino).not.toBe(lstatSync(join(first, 'a.txt')).ino);
    // Der alte Stand bleibt unverändert
    expect(readFileSync(join(first, 'a.txt'), 'utf8')).toBe('AAA');

    // Stand 1 löschen: Stand 2 bleibt vollständig lesbar
    rmSync(first, { recursive: true });
    expect(readFileSync(join(second, 'sub', 'b.txt'), 'utf8')).toBe('BBB');
  });

  it('ohne vorigen Stand entstehen nie Hardlinks (Restore-Kopien sind unabhängig)', () => {
    const root = tmp();
    const src = join(root, 'src');
    write(join(src, 'a.txt'), 'A');
    copyTree(src, join(root, 'ziel'), null);
    expect(lstatSync(join(root, 'ziel', 'a.txt')).nlink).toBe(1);
  });
});

describe('Stände im Ziel', () => {
  function manifest(stand: string): Manifest {
    return {
      version: 1,
      stand,
      created_at: standDate(stand).toISOString(),
      trigger: 'manuell',
      pg_server_version: '16',
      dump: { file: 'db.dump', bytes: 1, sha256: 'a'.repeat(64) },
      counts: {},
      media: { files: 0, bytes: 0 },
      vault: { files: 0, bytes: 0 },
    };
  }
  function makeStand(target: string, stand: string, complete = true): void {
    mkdirSync(join(target, stand), { recursive: true });
    if (complete) writeFileSync(join(target, stand, 'manifest.json'), JSON.stringify(manifest(stand)));
  }

  it('listStands: nur vollständige Stände, neueste zuerst; removeStand löscht nur echte Stände', () => {
    const target = tmp();
    makeStand(target, '20261101T030000Z');
    makeStand(target, '20261103T030000Z');
    makeStand(target, '20261102T030000Z', false);
    mkdirSync(join(target, 'fremder-ordner'));
    writeFileSync(join(target, 'fremder-ordner', 'x'), 'x');
    expect(listStands(target)).toEqual(['20261103T030000Z', '20261101T030000Z']);
    expect(readManifest(join(target, '20261103T030000Z'))?.stand).toBe('20261103T030000Z');

    expect(removeStand(target, '20261101T030000Z')).toBe(true);
    expect(removeStand(target, '20261102T030000Z')).toBe(false); // ohne Manifest: nicht anfassen
    expect(removeStand(target, 'fremder-ordner')).toBe(false);
    expect(removeStand(target, '../x')).toBe(false);
    expect(existsSync(join(target, 'fremder-ordner', 'x'))).toBe(true);
    expect(existsSync(join(target, '20261102T030000Z'))).toBe(true);
  });

  it('removeStalePartials entfernt nur alte .partial-Ordner', () => {
    const target = tmp();
    mkdirSync(join(target, '.20261101T030000Z.partial'));
    mkdirSync(join(target, '.20261104T030000Z.partial'));
    mkdirSync(join(target, '.fremd.partial'));
    const now = Date.UTC(2026, 10, 4, 4, 0, 0);
    expect(removeStalePartials(target, now, 86_400_000)).toEqual(['.20261101T030000Z.partial']);
    expect(existsSync(join(target, '.20261104T030000Z.partial'))).toBe(true);
    expect(existsSync(join(target, '.fremd.partial'))).toBe(true);
  });
});
