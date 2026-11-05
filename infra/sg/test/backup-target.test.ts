// Gemeinsame Backup-Ziel-Prüfung (@sg/shared/backup-target), sync (CLI) und async (Core)
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackupTargetError, checkBackupTarget, checkBackupTargetAsync } from '@sg/shared/backup-target';

// Ein Pfad mit dem Namen „ALIAS“ gilt für statSync als derselbe Ordner wie `aliasOf` (simuliert Bind-Mount,
// Firmlink, andere Groß-/Kleinschreibung oder NFD, die sich unter Linux nicht direkt herstellen lassen).
let aliasOf: string | null = null;
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const wrapped = ((path: Parameters<typeof actual.statSync>[0], ...rest: unknown[]) => {
    const target = typeof path === 'string' && aliasOf && path.endsWith('/ALIAS') ? aliasOf : path;
    return (actual.statSync as (...args: unknown[]) => unknown)(target, ...rest);
  }) as typeof actual.statSync;
  return { ...actual, statSync: wrapped };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const wrapped = ((path: Parameters<typeof actual.stat>[0], ...rest: unknown[]) => {
    const target = typeof path === 'string' && aliasOf && path.endsWith('/ALIAS') ? aliasOf : path;
    return (actual.stat as (...args: unknown[]) => Promise<unknown>)(target, ...rest);
  }) as typeof actual.stat;
  return { ...actual, stat: wrapped };
});

const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'sg-bt-')));
afterEach(() => {
  aliasOf = null;
});

const sync = (target: string, dataDir: string) => checkBackupTarget(target, dataDir, { createMissing: true });
const asyncCore = (target: string, dataDir: string) =>
  checkBackupTargetAsync(target, dataDir, { createMissing: false });

describe('Backup-Ziel: Identität (dev/ino)', () => {
  it('erkennt den Datenordner unter anderem Namen (Groß-/Kleinschreibung, Bind-Mount, Firmlink)', () => {
    const dataDir = tmp();
    mkdirSync(join(dataDir, 'media'));
    const parent = tmp();
    aliasOf = dataDir;
    expect(() => sync(join(parent, 'ALIAS', 'media'), dataDir)).toThrow(BackupTargetError);
    expect(() => sync(join(parent, 'ALIAS', 'x'), dataDir)).toThrow(/Datenordner/);
  });

  it('erkennt media/ unter anderem Namen, auch wenn media/ außerhalb des Datenordners liegt', () => {
    const dataDir = tmp();
    const elsewhere = tmp();
    symlinkSync(elsewhere, join(dataDir, 'media'));
    const parent = tmp();
    aliasOf = join(dataDir, 'media');
    expect(() => sync(join(parent, 'ALIAS'), dataDir)).toThrow(/media/);
    // Symlink-Ziel selbst ist ebenfalls gesperrt
    aliasOf = null;
    expect(() => sync(elsewhere, dataDir)).toThrow(/media/);
  });

  it('async: erkennt Datenordner und media/ über dev/ino unter anderem Namen', async () => {
    const dataDir = tmp();
    mkdirSync(join(dataDir, 'media'));
    const parent = tmp();
    aliasOf = dataDir;
    await expect(asyncCore(join(parent, 'ALIAS', 'x'), dataDir)).rejects.toThrow(/Datenordner/);
    await expect(asyncCore(join(parent, 'ALIAS', 'media'), dataDir)).rejects.toThrow(BackupTargetError);
    aliasOf = join(dataDir, 'media');
    await expect(asyncCore(join(parent, 'ALIAS'), dataDir)).rejects.toThrow(/media/);
    // unabhängiger Ordner bleibt erlaubt
    aliasOf = dataDir;
    const other = tmp();
    expect(await asyncCore(other, dataDir)).toBe(other);
  });

  it('lässt einen unabhängigen Ordner zu', () => {
    const dataDir = tmp();
    const other = tmp();
    aliasOf = dataDir;
    expect(sync(other, dataDir)).toBe(other);
  });
});

describe('Backup-Ziel: Regeln für Core (async) und CLI (sync)', () => {
  it('Datenordner und alles darin ist gesperrt, mit Empfehlung', async () => {
    const dataDir = tmp();
    mkdirSync(join(dataDir, 'backups'));
    for (const target of [dataDir, join(dataDir, 'backups')]) {
      expect(() => sync(target, dataDir)).toThrow(/externen Platte/);
      await expect(asyncCore(target, dataDir)).rejects.toThrow(/externen Platte/);
    }
  });

  it('Symlink in den Datenordner wird aufgelöst und abgelehnt', async () => {
    const dataDir = tmp();
    const link = join(tmp(), 'l');
    symlinkSync(dataDir, link);
    expect(() => sync(link, dataDir)).toThrow(/Datenordner/);
    await expect(asyncCore(join(link, 'neu'), dataDir)).rejects.toThrow(/Datenordner/);
  });

  it('gültiges Ziel: gleicher aufgelöster Pfad in beiden Varianten', async () => {
    const dataDir = tmp();
    const real = tmp();
    const link = join(tmp(), 'l');
    symlinkSync(real, link);
    expect(sync(link, dataDir)).toBe(real);
    expect(await asyncCore(link, dataDir)).toBe(real);
  });

  it('Symlink ins Leere: CLI legt das Linkziel an, Core lehnt mit Meldung ab', async () => {
    const dataDir = tmp();
    const parent = tmp();
    const link = join(tmp(), 'tot');
    symlinkSync(join(parent, 'noch-nicht'), link);
    await expect(asyncCore(link, dataDir)).rejects.toThrow(BackupTargetError);
    expect(sync(link, dataDir)).toBe(join(parent, 'noch-nicht'));
    expect(statSync(join(parent, 'noch-nicht')).isDirectory()).toBe(true);
  });

  it('Datei als Elternteil: BackupTargetError statt rohem Fehler', async () => {
    const file = join(tmp(), 'datei');
    writeFileSync(file, 'x');
    expect(() => sync(join(file, 'x'), tmp())).toThrow(/kein Ordner/);
    await expect(asyncCore(join(file, 'x'), tmp())).rejects.toThrow(/kein Ordner/);
  });

  it('Systemordner, relative Pfade, NUL', async () => {
    const dataDir = tmp();
    expect(() => sync('/proc', dataDir)).toThrow(/System/);
    await expect(asyncCore('/dev/shm', dataDir)).rejects.toThrow(/System/);
    expect(() => sync('relativ', dataDir)).toThrow(/absolut/);
    await expect(asyncCore('/tmp/a\0b', dataDir)).rejects.toThrow(/absolut/);
  });
});

describe('Backup-Ziel: `..` und relative Links mit echten Ordnern', () => {
  it('`..` nach einem Symlink gilt für dessen Ziel (<B>/l1/../vault mit l1 → <daten>/media)', async () => {
    const dataDir = tmp();
    mkdirSync(join(dataDir, 'media'));
    mkdirSync(join(dataDir, 'vault'));
    const b = tmp();
    symlinkSync(join(dataDir, 'media'), join(b, 'l1'));
    const target = `${b}/l1/../vault`;
    expect(() => sync(target, dataDir)).toThrow(/vault/);
    await expect(asyncCore(target, dataDir)).rejects.toThrow(/vault/);
    // textlich wäre es <B>/vault: darf nicht angelegt werden
    expect(existsSync(join(b, 'vault'))).toBe(false);
  });

  it('`..` nach einem Symlink auf einen unbedenklichen Ordner löst gegen dessen Ziel auf', async () => {
    const dataDir = tmp();
    const real = tmp();
    mkdirSync(join(real, 'sub'));
    mkdirSync(join(real, 'ok'));
    const b = tmp();
    symlinkSync(join(real, 'sub'), join(b, 'l1'));
    expect(sync(`${b}/l1/../ok`, dataDir)).toBe(join(real, 'ok'));
    expect(await asyncCore(`${b}/l1/../ok`, dataDir)).toBe(join(real, 'ok'));
  });

  it('`..` in media und Symlink-Ketten werden weiter abgelehnt', async () => {
    const dataDir = tmp();
    mkdirSync(join(dataDir, 'media'));
    const b = tmp();
    expect(() => sync(`${dataDir}/media/../media/x`, dataDir)).toThrow(/media/);
    await expect(asyncCore(`${dataDir}/media/a/../b`, dataDir)).rejects.toThrow(/media/);
    symlinkSync(join(dataDir, 'media'), join(b, 'k2'));
    symlinkSync(join(b, 'k2'), join(b, 'k1'));
    expect(() => sync(join(b, 'k1'), dataDir)).toThrow(/media/);
    await expect(asyncCore(join(b, 'k1'), dataDir)).rejects.toThrow(/media/);
  });

  it('ELOOP: Endlosschleife aus Links', async () => {
    const dataDir = tmp();
    const b = tmp();
    symlinkSync(join(b, 'b'), join(b, 'a'));
    symlinkSync(join(b, 'a'), join(b, 'b'));
    expect(() => sync(join(b, 'a'), dataDir)).toThrow(/Endlosschleife/);
    await expect(asyncCore(join(b, 'a'), dataDir)).rejects.toThrow(/Endlosschleife/);
  });

  it('relativer Link ins Leere wird gegen den echten Ordner aufgelöst (via/a/deep → real/deep, tot → ../ziel-ok/neu)', async () => {
    const dataDir = tmp();
    const base = tmp();
    mkdirSync(join(base, 'via', 'a'), { recursive: true });
    mkdirSync(join(base, 'real', 'deep'), { recursive: true });
    mkdirSync(join(base, 'real', 'ziel-ok'));
    symlinkSync(join(base, 'real', 'deep'), join(base, 'via', 'a', 'deep'));
    symlinkSync('../ziel-ok/neu', join(base, 'real', 'deep', 'tot'));
    const target = join(base, 'via', 'a', 'deep', 'tot');
    const expected = join(base, 'real', 'ziel-ok', 'neu');
    await expect(asyncCore(target, dataDir)).rejects.toThrow(BackupTargetError);
    expect(sync(target, dataDir)).toBe(expected);
    expect(statSync(expected).isDirectory()).toBe(true);
    // textlich (gegen via/a) wäre es via/ziel-ok/neu gewesen
    expect(existsSync(join(base, 'via', 'ziel-ok'))).toBe(false);
  });

  it('Core meldet den richtigen Pfad, wenn das Ziel existiert', async () => {
    const dataDir = tmp();
    const base = tmp();
    mkdirSync(join(base, 'via', 'a'), { recursive: true });
    mkdirSync(join(base, 'real', 'deep'), { recursive: true });
    mkdirSync(join(base, 'real', 'ziel-ok', 'neu'), { recursive: true });
    symlinkSync(join(base, 'real', 'deep'), join(base, 'via', 'a', 'deep'));
    symlinkSync('../ziel-ok/neu', join(base, 'real', 'deep', 'tot'));
    expect(await asyncCore(join(base, 'via', 'a', 'deep', 'tot'), dataDir)).toBe(
      join(base, 'real', 'ziel-ok', 'neu'),
    );
  });
});
