// Architekturtests T1-24 (Plan §5.6): Keine KI und kein Job löst eine Moodle-Aktion aus.
// Vorschau und Ausführen erreicht nur der Klick-Handler der Web-App über `routes/moodle.ts`. Die Tests sichern, dass
// UNSER Code das nie anders tut. Ein fremdes Programm am Mac kann das nicht verhindern (VERTRAEGE §5).
import { readdirSync, readFileSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const coreSrc = join(repoRoot, 'services', 'core', 'src');
const workerSrc = join(repoRoot, 'services', 'worker', 'src');

function walk(dir: string, extension: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__pycache__' || entry.name === 'node_modules') continue;
      out.push(...walk(full, extension));
    } else if (entry.name.endsWith(extension)) {
      out.push(full);
    }
  }
  return out;
}

interface Source {
  /** Pfad relativ zu `services/core/src`, mit `/` */
  path: string;
  /** Text ohne Zeilen- und Blockkommentare */
  code: string;
  raw: string;
}

/** Entfernt reine Kommentarzeilen (`//`, `/*`, ` *`), damit eine Erwähnung dort keinen Treffer ergibt */
function stripComments(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join('\n');
}

const coreFiles: Source[] = walk(coreSrc, '.ts').map((file) => {
  const raw = readFileSync(file, 'utf8');
  return { path: relative(coreSrc, file).split(sep).join('/'), raw, code: stripComments(raw) };
});

const only = (sources: Source[], pattern: RegExp) =>
  sources
    .filter((s) => pattern.test(s.code))
    .map((s) => s.path)
    .sort();

describe('Architektur Core: nur routes/moodle.ts erreicht Moodle-Aktionen', () => {
  it('es wurden Dateien gefunden (Test ist nicht leer)', () => {
    expect(coreFiles.length).toBeGreaterThan(30);
    expect(coreFiles.map((f) => f.path)).toContain('routes/moodle.ts');
  });

  it('die Zeichenfolge „moodle/actions“ steht nur in routes/moodle.ts (Pfad und Import)', () => {
    // Auch in Kommentaren und Zeichenketten: so fällt ein Aufruf über die Adresse auf
    expect(coreFiles.filter((f) => f.raw.includes('moodle/actions')).map((f) => f.path)).toEqual([
      'routes/moodle.ts',
    ]);
  });

  /**
   * Alle Modulpfade einer Datei, aufgelöst relativ zu `services/core/src`, ohne Endung: statisch (`from`, auch
   * `export … from`), nur für Nebenwirkungen (`import '…'`), dynamisch (`import(…)`) und `require(…)`, mit beiden
   * Anführungszeichen und Backticks. So umgeht eine andere Schreibweise den Test nicht.
   */
  function importsOf(source: Source): string[] {
    const specifier = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(['"`])([^'"`]+)\1/g;
    const dir = posix.dirname(source.path);
    const out: string[] = [];
    for (const match of source.code.matchAll(specifier)) {
      const spec = match[2] ?? '';
      if (!spec.startsWith('.')) continue;
      out.push(
        posix
          .normalize(posix.join(dir, spec))
          .replace(/\.(?:[cm]?[jt]s)$/, '')
          .replace(/\/index$/, ''),
      );
    }
    return out;
  }
  const importersOf = (target: string) =>
    coreFiles
      .filter((f) => importsOf(f).includes(target))
      .map((f) => f.path)
      .sort();

  it('importsOf erkennt alle Schreibweisen (Gegenprobe)', () => {
    const probe = (code: string, path = 'moodle/sync.ts') => importsOf({ path, code, raw: code });
    expect(probe("import { x } from './actions.ts';")).toEqual(['moodle/actions']);
    expect(probe('import { x } from "./actions.js";')).toEqual(['moodle/actions']);
    expect(probe("const m = await import('./actions');")).toEqual(['moodle/actions']);
    expect(probe('const m = await import(`./actions.ts`);')).toEqual(['moodle/actions']);
    expect(probe("export * from './actions.ts';")).toEqual(['moodle/actions']);
    expect(probe("import './actions.ts';")).toEqual(['moodle/actions']);
    expect(probe("const m = require('../moodle/actions.ts');", 'routes/x.ts')).toEqual(['moodle/actions']);
  });

  it('actions.ts (Handler) importieren nur routes/moodle.ts und moodle/index.ts', () => {
    expect(importersOf('moodle/actions')).toEqual(['moodle/index.ts', 'routes/moodle.ts']);
  });

  it('Bestätigungscodes und Sperren importiert nur moodle/index.ts', () => {
    expect(importersOf('moodle/confirmations')).toEqual(['moodle/index.ts']);
    expect(importersOf('moodle/locks')).toEqual(['moodle/index.ts']);
  });

  it('Registry, Bestätigungscodes, Sperren und Katalog tauchen nur dort auf, wo sie hingehören', () => {
    // Job-Handler, sync.ts und alle anderen Routen kennen weder Handler noch Codes. Auch kein
    // `Pick<MoodleServices, 'actions'>` und kein Zugriff `moodle['actions']`
    const allowed = new Set([
      'routes/moodle.ts',
      'moodle/index.ts',
      'moodle/actions.ts',
      'moodle/confirmations.ts',
      'moodle/locks.ts',
    ]);
    const pattern =
      /\b(MoodleActionRegistry|MoodleActionHandler|ConfirmationStore|KeyedMutex|DEFAULT_ACTION_HANDLERS|MOODLE_ACTION_SPECS)\b|\bconfirmations\b|\bmoodle\.actions\b|\bmoodle\.locks\b|['"`](?:actions|locks)['"`]/;
    const offenders = only(coreFiles, pattern).filter((path) => !allowed.has(path));
    expect(offenders).toEqual([]);
  });

  it('client.write (schreibender Moodle-Aufruf) steht nur in moodle/actions.ts und moodle/client.ts', () => {
    expect(only(coreFiles, /\bclient\.write\b|\.write<[^>]*>\(\s*'(?:core|mod)_/)).toEqual([
      'moodle/actions.ts',
    ]);
    expect(only(coreFiles, /\basync write\b|\bwrite<T/)).toEqual(['moodle/client.ts']);
  });

  it('kein app.inject und kein Aufruf des eigenen Ports (lokale Aufrufe kämen ohne Token durch)', () => {
    expect(only(coreFiles, /\.inject\(|light-my-request/)).toEqual([]);
    // Ausgehendes HTTP gibt es nur an diesen Stellen. Jede neue Datei muss hier bewusst eingetragen werden
    const outbound =
      /\bfetch\(|^import\s+(?!type\b)[^;]*from\s+'node:https?'|from\s+'undici'|\bnew WebSocket\b/m;
    expect(only(coreFiles, outbound)).toEqual([
      'lib/worker-client.ts',
      'moodle/client.ts',
      'plugins/tunnel-server.ts',
      'services/calendar-fetch.ts',
    ]);
    // und keine davon kennt den Port des Core
    for (const path of ['lib/worker-client.ts', 'moodle/client.ts', 'services/calendar-fetch.ts']) {
      const file = coreFiles.find((f) => f.path === path);
      expect(file?.code, path).not.toMatch(/CORE_PORT|config\.port|corePort/);
    }
  });

  it('der Core ruft selbst kein Modell auf', () => {
    expect(
      only(coreFiles, /api\.anthropic\.com|@anthropic-ai|from\s+'anthropic'|\bmessages\.create\b/),
    ).toEqual([]);
  });
});

describe('Architektur Worker: kein Moodle, keine Werkzeuge für Modelle', () => {
  const workerFiles = walk(workerSrc, '.py').map((file) => ({
    path: relative(workerSrc, file).split(sep).join('/'),
    text: readFileSync(file, 'utf8'),
  }));

  it('es wurden Dateien gefunden (Test ist nicht leer)', () => {
    expect(workerFiles.map((f) => f.path)).toContain('sg_worker/ai/llm.py');
  });

  it('die Zeichenfolge „/moodle/“ kommt im Worker nicht vor', () => {
    expect(workerFiles.filter((f) => f.text.includes('/moodle/')).map((f) => f.path)).toEqual([]);
  });

  it('kein Modellaufruf übergibt tools (weder tools= noch der Schlüssel "tools")', () => {
    const offenders = workerFiles
      .filter((f) => /\btools\s*=|["']tools["']|\btool_choice\b/.test(f.text))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});
