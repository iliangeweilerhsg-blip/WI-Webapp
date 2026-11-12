// #161 Teil 2 c): Der Restore übernimmt das Ziel mit der Identität aus `validateTarget` (dev/ino), nicht per `statSync`.
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateTarget } from '../src/backup.ts';
import { openStandTree, standFilesMatch, StandError } from '../src/restore.ts';
import type { Manifest } from '../src/backup-files.ts';

const STAND = '20261104T030012Z';
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup(): { target: string; stand: string; checked: ReturnType<typeof validateTarget> } {
  const root = mkdtempSync(join(tmpdir(), 'sg-restore-id-'));
  dirs.push(root);
  const target = join(root, 'ziel');
  mkdirSync(join(target, STAND, 'media'), { recursive: true });
  writeFileSync(join(target, STAND, 'media', 'a.txt'), 'abc');
  const checked = validateTarget(target, join(root, 'daten'), false);
  return { target: checked.path, stand: join(checked.path, STAND), checked };
}

/** Das Ziel wird nach der Prüfung durch einen anderen Ordner (gleicher Pfad, gleicher Inhalt) ersetzt */
function swapTarget(target: string): void {
  renameSync(target, `${target}.alt`);
  mkdirSync(join(target, STAND, 'media'), { recursive: true });
  writeFileSync(join(target, STAND, 'media', 'a.txt'), 'abc');
}

const manifest = {
  media: { files: 1, bytes: 3 },
  vault: { files: 0, bytes: 0 },
} as Manifest;

describe('Restore verankert das Ziel mit der Identität aus validateTarget (#161)', () => {
  it('unverändertes Ziel: Öffnen und Prüfen funktionieren', () => {
    const { stand, checked } = setup();
    const id = { dev: checked.dev, ino: checked.ino };
    expect(openStandTree(stand, id).media).not.toBeNull();
    expect(standFilesMatch(stand, manifest, id)).toBe(true);
  });

  it('ersetztes Ziel: scheitert mit beschaedigt', () => {
    const { target, stand, checked } = setup();
    const id = { dev: checked.dev, ino: checked.ino };
    swapTarget(target);
    expect(() => openStandTree(stand, id)).toThrow(StandError);
    expect(() => standFilesMatch(stand, manifest, id)).toThrow(/beschädigt|ausgetauscht/);
  });

  it('Gegenprobe: ohne übergebene Identität (statSync) bleibt der Tausch unbemerkt', () => {
    const { target, stand } = setup();
    swapTarget(target);
    expect(openStandTree(stand).media).not.toBeNull();
  });
});
