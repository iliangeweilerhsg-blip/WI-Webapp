// Prüfsummen für `media/` und `vault/` im Backup (#114 N-1, docs/VERTRAEGE.md §13).
//
// Jeder Stand enthält neben `manifest.json` die Liste `files.sha256`: eine Zeile je Datei, `<sha256>\t<pfad>` mit
// Pfaden wie `media/audio/a.m4a`, sortiert, Zeilenumbruch und Backslash im Pfad maskiert. Das Manifest nennt Anzahl und
// SHA-256 der Liste (`manifest.files`); dieselbe SHA-256 steht in `backup_run.files_sha256` (Migration 0011). Die
// Datenbank ist damit die Vertrauensquelle: Wer im Ziel eine Datei UND die Liste ändert, ändert die Prüfsumme der
// Liste und fällt gegenüber `backup_run` auf (wie beim Dump).
//
// Berechnet wird streamend (1-MiB-Blöcke): Audio kann mehrere GB groß sein, nichts wird ganz in den Speicher geladen.
import { createHash } from 'node:crypto';
import { closeSync, type Stats } from 'node:fs';
import { join } from 'node:path';
import { skipped } from './backup-files.ts';
import { hashFd, NoFollowReader, UnsafeTargetError } from './nofollow.ts';

export const FILES_FILE = 'files.sha256';
/** Höchstgröße der Liste (rund 100 Byte je Datei: reicht für über 2 Mio. Dateien) */
export const FILES_MAX_BYTES = 256 * 1024 * 1024;
const MAX_PROBLEMS = 10;

export type SumSub = 'media' | 'vault';
export const SUBS: readonly SumSub[] = ['media', 'vault'];

/** Eintrag `files` im Manifest */
export interface FilesRef {
  file: typeof FILES_FILE;
  count: number;
  /** SHA-256 der Datei `files.sha256` (hex) */
  sha256: string;
}

export const HEX64 = /^[0-9a-f]{64}$/;

/** Prüfsummen je Unterordner, Schlüssel ist der Pfad relativ zu `media/` bzw. `vault/` */
export type SumMap = Record<SumSub, Map<string, string>>;

export const emptySums = (): SumMap => ({ media: new Map(), vault: new Map() });

export { hashFd };

const escapePath = (path: string): string =>
  path.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r');

function unescapePath(text: string): string | null {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i] as string;
    if (c !== '\\') {
      out += c;
      continue;
    }
    const next = text[i + 1];
    i += 1;
    if (next === '\\') out += '\\';
    else if (next === 'n') out += '\n';
    else if (next === 'r') out += '\r';
    else return null;
  }
  return out;
}

/** Liste als Text, sortiert nach Pfad (Byte-Reihenfolge) */
export function formatFileList(sums: SumMap): { text: string; count: number } {
  const lines: string[] = [];
  for (const sub of SUBS) {
    const keys = [...sums[sub].keys()].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    for (const key of keys) lines.push(`${sums[sub].get(key)}\t${escapePath(`${sub}/${key}`)}\n`);
  }
  return { text: lines.join(''), count: lines.length };
}

export const sha256Hex = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

/** Liste lesen. `null`: Aufbau ungültig (falsche Zeile, doppelter Pfad, fremder Unterordner). */
export function parseFileList(text: string): SumMap | null {
  const sums = emptySums();
  if (text === '') return sums;
  if (!text.endsWith('\n')) return null;
  for (const line of text.slice(0, -1).split('\n')) {
    const tab = line.indexOf('\t');
    if (tab !== 64) return null;
    const sha = line.slice(0, 64);
    if (!HEX64.test(sha)) return null;
    const path = unescapePath(line.slice(65));
    if (path === null) return null;
    const slash = path.indexOf('/');
    const sub = path.slice(0, slash);
    const rel = path.slice(slash + 1);
    if (slash < 1 || (sub !== 'media' && sub !== 'vault') || rel === '') return null;
    if (sums[sub].has(rel)) return null;
    sums[sub].set(rel, sha);
  }
  return sums;
}

export interface VerifyOptions {
  /** Liest `root` (verankert, ohne Symlink-Folgen); muss `root` kennen */
  reader: NoFollowReader;
  /** Ein Symlink oder eine Sonderdatei im Baum ist ein Fehler (`UnsafeTargetError`) statt übersprungen zu werden */
  strict: boolean;
  /** Wird nach jeder Datei aufgerufen (Fortschritt) */
  onFile?: (bytes: number) => void;
}

export interface VerifyResult {
  files: number;
  bytes: number;
  /** Höchstens 10 Abweichungen, lesbar (Pfad relativ zum Stand) */
  problems: string[];
}

/**
 * Hasht jede Datei unter `root` (streamend) und vergleicht mit `expected` (Schlüssel: Pfad relativ zu `root`). Meldet
 * Dateien mit anderer Prüfsumme (`abweichend`), nicht in der Liste (`zusätzlich`) und in der Liste, aber nicht da
 * (`fehlt`). Hört nach 10 Abweichungen auf. Dateien, die auch das Kopieren ignoriert (`skipped`), zählen nie.
 */
export function verifyTree(
  root: string | null,
  sub: SumSub,
  expected: Map<string, string>,
  options: VerifyOptions,
): VerifyResult {
  const result: VerifyResult = { files: 0, bytes: 0, problems: [] };
  const seen = new Set<string>();
  const full = (rel: string) => `${sub}/${rel}`;
  const problem = (text: string): boolean => {
    result.problems.push(text);
    return result.problems.length >= MAX_PROBLEMS;
  };

  const walk = (dir: string, rel: string): boolean => {
    for (const { name, info } of options.reader.list(dir)) {
      if (skipped(name)) continue;
      const path = rel === '' ? name : `${rel}/${name}`;
      if (!info.isSymbolicLink() && info.isDirectory()) {
        if (walk(options.reader.enter(dir, name, info), path)) return true;
        continue;
      }
      if (info.isSymbolicLink() || !info.isFile()) {
        if (options.strict)
          throw new UnsafeTargetError(`${join(dir, name)} ist ein Symlink oder eine Sonderdatei.`);
        continue;
      }
      const opened = options.reader.open(dir, name);
      let sha: string;
      let real: Stats;
      try {
        real = opened.info;
        sha = hashFd(opened.fd);
      } finally {
        closeSync(opened.fd);
      }
      result.files += 1;
      result.bytes += real.size;
      options.onFile?.(real.size);
      const want = expected.get(path);
      seen.add(path);
      if (want === undefined) {
        if (problem(`zusätzliche Datei ${full(path)}`)) return true;
      } else if (want !== sha) {
        if (problem(`Datei ${full(path)} weicht von der Prüfsumme ab`)) return true;
      }
    }
    return false;
  };

  if (root !== null && walk(root, '')) return result;
  for (const key of expected.keys()) {
    if (!seen.has(key) && problem(`Datei ${full(key)} fehlt`)) break;
  }
  return result;
}

/** Fortschritt höchstens alle `everyMs` Millisekunden melden */
export function progressLogger(
  log: (line: string) => void,
  label: string,
  everyMs = 5000,
  now: () => number = Date.now,
): (bytes: number) => void {
  let files = 0;
  let bytes = 0;
  let last = now();
  return (n: number) => {
    files += 1;
    bytes += n;
    if (now() - last >= everyMs) {
      last = now();
      log(`  ${label}: ${files} Dateien geprüft (${(bytes / 1024 / 1024).toFixed(0)} MB) …`);
    }
  };
}
