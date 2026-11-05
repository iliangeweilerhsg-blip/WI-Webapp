// Gemeinsame Backup-Ziel-Prüfung (@sg/shared/backup-target), sync (CLI) und async (Core)
import { mkdirSync, mkdtempSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
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
