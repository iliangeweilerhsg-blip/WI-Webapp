import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/config.ts';
import { IPAD_UPDATE_NOTE, checkIpadApp, readIpadStamp } from '../src/ipad-hint.ts';

const dirs: string[] = [];
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'sg-ipad-hint-'));
  dirs.push(root);
  const cfg = resolveConfig({ SG_DATA_DIR: join(root, 'data') }, root, root);
  mkdirSync(join(cfg.dataDir, 'run'), { recursive: true });
  return cfg;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

describe('checkIpadApp (UX-17)', () => {
  it('beim ersten Start: kein Hinweis, Stand wird gemerkt', () => {
    const cfg = setup();
    expect(checkIpadApp(cfg, A)).toBeNull();
    expect(readIpadStamp(cfg)).toBe(A);
  });

  it('unveränderter Stand: kein Hinweis', () => {
    const cfg = setup();
    checkIpadApp(cfg, A);
    expect(checkIpadApp(cfg, A)).toBeNull();
  });

  it('geänderter Stand: Hinweis einmal, danach gemerkt', () => {
    const cfg = setup();
    checkIpadApp(cfg, A);
    expect(checkIpadApp(cfg, B)).toBe(IPAD_UPDATE_NOTE);
    expect(readIpadStamp(cfg)).toBe(B);
    expect(checkIpadApp(cfg, B)).toBeNull();
  });

  it('ohne Git-Stand (null): kein Hinweis, nichts gemerkt', () => {
    const cfg = setup();
    expect(checkIpadApp(cfg, null)).toBeNull();
    expect(readIpadStamp(cfg)).toBeNull();
  });

  it('nicht beschreibbarer Datenordner bricht nichts ab', () => {
    const cfg = setup();
    rmSync(join(cfg.dataDir, 'run'), { recursive: true });
    expect(checkIpadApp(cfg, A)).toBeNull();
  });
});
