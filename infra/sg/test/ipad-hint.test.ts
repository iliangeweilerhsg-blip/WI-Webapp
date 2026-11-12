import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/config.ts';
import {
  IPAD_CONFIRM_COMMAND,
  IPAD_SOURCE_PATHS,
  IPAD_UPDATE_NOTE,
  checkIpadApp,
  fingerprint,
  ipadCommand,
  ipadTreeId,
  readIpadStamp,
} from '../src/ipad-hint.ts';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const dirs: string[] = [];
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'sg-ipad-hint-'));
  dirs.push(root);
  const cfg = resolveConfig({ SG_DATA_DIR: join(root, 'data') }, root, root);
  mkdirSync(cfg.runDir, { recursive: true });
  return cfg;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

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

  it('geänderter Stand: Hinweis bei jedem Start, bis das Aufspielen bestätigt ist', () => {
    const cfg = setup();
    checkIpadApp(cfg, A);
    expect(checkIpadApp(cfg, B)).toBe(IPAD_UPDATE_NOTE);
    expect(checkIpadApp(cfg, B)).toBe(IPAD_UPDATE_NOTE);
    expect(readIpadStamp(cfg)).toBe(A);
    expect(IPAD_UPDATE_NOTE).toContain(IPAD_CONFIRM_COMMAND);

    expect(ipadCommand(cfg, ['aufgespielt'], B, () => {})).toBe(0);
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
    rmSync(cfg.runDir, { recursive: true });
    writeFileSync(cfg.runDir, 'kein Ordner');
    expect(checkIpadApp(cfg, A)).toBeNull();
  });
});

describe('sg ipad', () => {
  it('zeigt den Stand und lehnt unbekannte Optionen ab', () => {
    const cfg = setup();
    const out: string[] = [];
    const print = (l: string) => out.push(l);
    expect(ipadCommand(cfg, [], A, print)).toBe(0);
    expect(out.pop()).toContain('Noch kein Stand gemerkt');
    expect(ipadCommand(cfg, ['aufgespielt'], A, print)).toBe(0);
    expect(ipadCommand(cfg, [], A, print)).toBe(0);
    expect(out.pop()).toContain('aktuell');
    expect(ipadCommand(cfg, [], B, print)).toBe(0);
    expect(out.pop()).toBe(IPAD_UPDATE_NOTE);
    expect(ipadCommand(cfg, ['--quatsch'], A, print)).toBe(1);
    expect(ipadCommand(cfg, ['aufgespielt', 'x'], A, print)).toBe(1);
  });

  it('ohne Git: Bestätigen schlägt fehl, Anzeige nicht', () => {
    const cfg = setup();
    expect(ipadCommand(cfg, [], null, () => {})).toBe(0);
    expect(ipadCommand(cfg, ['aufgespielt'], null, () => {})).toBe(1);
    expect(readIpadStamp(cfg)).toBeNull();
  });
});

describe('Fingerabdruck der iPad-Quellen', () => {
  const T = (sha: string, path: string) => `040000 tree ${sha}\t${path}`;
  const s1 = '1'.repeat(40);
  const s2 = '2'.repeat(40);

  it('ändert sich mit jedem abgedeckten Pfad, nicht mit der Reihenfolge', () => {
    const base = fingerprint([T(s1, 'apps/ipad'), T(s1, 'packages/schemas/swift-support')].join('\n'));
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint([T(s1, 'packages/schemas/swift-support'), T(s1, 'apps/ipad')].join('\n'))).toBe(base);
    expect(fingerprint([T(s1, 'apps/ipad'), T(s2, 'packages/schemas/swift-support')].join('\n'))).not.toBe(
      base,
    );
  });

  it('ohne apps/ipad (z. B. Repo eines Elternordners) gibt es keinen Stand', () => {
    expect(fingerprint('')).toBeNull();
    expect(fingerprint(T(s1, 'packages/schemas/swift-support'))).toBeNull();
  });

  it('ohne Git-Repository (entpackter Ordner) gibt es keinen Stand und keinen Absturz', () => {
    const root = mkdtempSync(join(tmpdir(), 'sg-ipad-nogit-'));
    dirs.push(root);
    mkdirSync(join(root, 'apps', 'ipad'), { recursive: true });
    expect(ipadTreeId(root)).toBeNull();
  });

  it('deckt jede Quelle aus apps/ipad/project.yml und jeden Symlink unter apps/ipad ab', () => {
    const ipadDir = join(REPO, 'apps', 'ipad');
    const covered = (p: string) => IPAD_SOURCE_PATHS.some((c) => p === c || p.startsWith(`${c}/`));
    const toRepo = (abs: string) => relative(REPO, abs).split(/[\\/]/).join(posix.sep);

    const yml = readFileSync(join(ipadDir, 'project.yml'), 'utf8');
    const sources = [...yml.matchAll(/^\s*-\s*path:\s*['"]?([^'"\s#]+)/gm)].map((m) => m[1] as string);
    expect(sources.length).toBeGreaterThan(0);

    const links: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        const st = lstatSync(p);
        if (st.isSymbolicLink()) links.push(resolve(dirname(p), readlinkSync(p)));
        else if (st.isDirectory()) walk(p);
      }
    };
    walk(ipadDir);

    for (const abs of [...sources.map((s) => resolve(ipadDir, s)), ...links]) {
      expect(covered(toRepo(abs)), `${toRepo(abs)} fehlt in IPAD_SOURCE_PATHS`).toBe(true);
    }
  });
});
