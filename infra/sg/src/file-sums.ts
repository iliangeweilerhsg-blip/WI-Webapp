// Prüfsummen für `media/` und `vault/` im Backup (#114 N-1, docs/VERTRAEGE.md §13).
//
// Jeder Stand enthält neben `manifest.json` die Liste `files.sha256`: eine Zeile je Datei, `<sha256>\t<pfad>` mit
// Pfaden wie `media/audio/a.m4a`, sortiert, Zeilenumbruch und Backslash im Pfad maskiert. Das Manifest nennt Anzahl und
// SHA-256 der Liste (`manifest.files`); dieselbe SHA-256 steht in `backup_run.files_sha256` (Migration 0011). Die
// Datenbank ist damit die Vertrauensquelle: Wer im Ziel eine Datei UND die Liste ändert, ändert die Prüfsumme der
// Liste und fällt gegenüber `backup_run` auf (wie beim Dump).
//
// Pfade werden in Unicode-NFC geschrieben und verglichen: Manche Ziele (HFS+, exFAT, SMB-/NAS-Freigaben) geben Namen
// mit Umlaut in NFD zurück, die Quelle schreibt sie meist in NFC. Zwei Dateien, deren Pfade nach NFC gleich sind, sind
// ein Konflikt (fail-closed), beim Backup wie beim Prüfen.
//
// Berechnet wird streamend (1-MiB-Blöcke): Audio kann mehrere GB groß sein, nichts wird ganz in den Speicher geladen.
import { createHash } from 'node:crypto';
import { closeSync, readSync, type Stats } from 'node:fs';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { NameConflictError, nameConflictText, pathKey, skipped } from './backup-files.ts';
import { hashFd, NoFollowReader, UnsafeTargetError } from './nofollow.ts';

export const FILES_FILE = 'files.sha256';
/** Höchstgröße der Liste (rund 100 Byte je Datei: reicht für über 2 Mio. Dateien) */
export const FILES_MAX_BYTES = 256 * 1024 * 1024;
/**
 * Höchstlänge einer Zeile der Liste (Zeichen, ohne Zeilenumbruch). Eine echte Zeile hat 65 Zeichen plus Pfad; ein Pfad
 * von 1 Mio. Zeichen kommt praktisch nicht vor. Die Grenze hält den Puffer des Streaming-Lesers klein: Eine Liste ohne
 * Zeilenumbruch würde sonst ganz im Speicher landen und bei jedem Block neu durchsucht (vor dem Ankervergleich).
 */
export const FILES_MAX_LINE = 1024 * 1024;
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

export { NameConflictError, pathKey };

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

/**
 * Liste als Text: Pfade in NFC, sortiert nach Pfad (Byte-Reihenfolge). Ergeben zwei Pfade nach NFC denselben
 * Schlüssel, wirft das `NameConflictError` (fail-closed).
 */
export function formatFileList(sums: SumMap): { text: string; count: number } {
  const lines: string[] = [];
  for (const sub of SUBS) {
    const byKey = new Map<string, { path: string; sha: string }>();
    for (const [path, sha] of sums[sub]) {
      const key = pathKey(path);
      const other = byKey.get(key);
      if (other) throw new NameConflictError(nameConflictText(`${sub}/${other.path}`, `${sub}/${path}`));
      byKey.set(key, { path, sha });
    }
    const keys = [...byKey.keys()].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    for (const key of keys) lines.push(`${byKey.get(key)?.sha}\t${escapePath(`${sub}/${key}`)}\n`);
  }
  return { text: lines.join(''), count: lines.length };
}

export const sha256Hex = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

/**
 * Liest die Liste Stück für Stück (Streaming, #324): `feed` nimmt beliebig geschnittene Blöcke, `finish` liefert das
 * Ergebnis. Schlüssel sind die Pfade in NFC (auch wenn eine Liste sie anders schreibt). Ungültiger Aufbau (falsche
 * Zeile, doppelter Pfad, auch nach NFC, fremder Unterordner, letzte Zeile ohne Zeilenumbruch,
 * Zeile länger als `FILES_MAX_LINE`) merkt sich der Leser;
 * danach sammelt er nichts mehr, nimmt aber weiter Blöcke an (der Aufrufer hasht sie trotzdem zu Ende).
 */
export class FileListParser {
  private sums: SumMap | null = emptySums();
  private pending = '';
  private readonly decoder = new StringDecoder('utf8');

  /** `false`, sobald die Liste ungültig ist */
  get valid(): boolean {
    return this.sums !== null;
  }

  feed(chunk: Buffer): void {
    if (this.sums === null) return;
    this.pending += this.decoder.write(chunk);
    this.drain();
  }

  /** `null`: Aufbau ungültig. Leere Liste (`''`) ist gültig. */
  finish(): SumMap | null {
    if (this.sums === null) return null;
    this.pending += this.decoder.end();
    this.drain();
    if (this.sums !== null && this.pending !== '') this.sums = null; // letzte Zeile ohne Zeilenumbruch
    return this.sums;
  }

  private drain(): void {
    let from = 0;
    for (;;) {
      const nl = this.pending.indexOf('\n', from);
      if (nl < 0) break;
      if (!this.line(this.pending.slice(from, nl))) {
        this.sums = null;
        this.pending = '';
        return;
      }
      from = nl + 1;
    }
    this.pending = this.pending.slice(from);
    if (this.pending.length > FILES_MAX_LINE) {
      // Zeile zu lang: ungültig, nichts mehr puffern
      this.sums = null;
      this.pending = '';
    }
  }

  private line(line: string): boolean {
    const sums = this.sums as SumMap;
    if (line.length > FILES_MAX_LINE) return false;
    const tab = line.indexOf('\t');
    if (tab !== 64) return false;
    const sha = line.slice(0, 64);
    if (!HEX64.test(sha)) return false;
    const path = unescapePath(line.slice(65));
    if (path === null) return false;
    const slash = path.indexOf('/');
    const sub = path.slice(0, slash);
    const rel = pathKey(path.slice(slash + 1));
    if (slash < 1 || (sub !== 'media' && sub !== 'vault') || rel === '') return false;
    if (sums[sub].has(rel)) return false;
    sums[sub].set(rel, sha);
    return true;
  }
}

/** Liste aus einem Text lesen (siehe `FileListParser`). `null`: Aufbau ungültig. */
export function parseFileList(text: string): SumMap | null {
  const parser = new FileListParser();
  parser.feed(Buffer.from(text, 'utf8'));
  return parser.finish();
}

export interface StreamedList {
  /** SHA-256 über alle gelesenen Bytes */
  sha256: string;
  bytes: number;
  /** `null`: Aufbau ungültig */
  sums: SumMap | null;
  /** `true`: mehr Bytes als `FILES_MAX_BYTES` (das Lesen wurde dort beendet) */
  tooLarge: boolean;
}

/**
 * Liest `files.sha256` aus `fd` in einem Durchgang: SHA-256 und Zeile für Zeile Parsen aus denselben Blöcken. Im Speicher
 * liegen nur ein Block und die geparsten Einträge, nie der ganze Text (#324). Das Ergebnis ist erst gültig, wenn der
 * Aufrufer `sha256` mit dem Anker verglichen hat; bis dahin hat das Lesen keine Nebenwirkungen (nichts wird geschrieben,
 * nichts weitergegeben). `read` nur für Tests.
 */
export function readFileListFd(
  fd: number,
  options: { chunkSize?: number; read?: typeof readSync } = {},
): StreamedList {
  const read = options.read ?? readSync;
  const buffer = Buffer.allocUnsafe(options.chunkSize ?? 1024 * 1024);
  const hash = createHash('sha256');
  const parser = new FileListParser();
  let bytes = 0;
  for (;;) {
    const n = read(fd, buffer, 0, buffer.length, null);
    if (n === 0) break;
    bytes += n;
    if (bytes > FILES_MAX_BYTES) return { sha256: '', bytes, sums: null, tooLarge: true };
    const block = buffer.subarray(0, n);
    hash.update(block);
    parser.feed(block);
  }
  return { sha256: hash.digest('hex'), bytes, sums: parser.finish(), tooLarge: false };
}

export interface VerifyOptions {
  /** Liest `root` (verankert, ohne Symlink-Folgen); muss `root` kennen */
  reader: NoFollowReader;
  /** Ein Symlink oder eine Sonderdatei im Baum ist ein Fehler (`UnsafeTargetError`) statt übersprungen zu werden */
  strict: boolean;
  /** Wird nach jeder Datei aufgerufen (Fortschritt) */
  onFile?: (bytes: number) => void;
  /**
   * `false`: nur Namen vergleichen (fehlt, zusätzlich, doppelt), keine Datei öffnen. Billige Vorprüfung vor dem
   * Kopieren. Standard: Inhalte hashen.
   */
  contents?: boolean;
}

export interface VerifyResult {
  files: number;
  bytes: number;
  /** Höchstens 10 Abweichungen, lesbar (Pfad relativ zum Stand) */
  problems: string[];
}

/**
 * Hasht jede Datei unter `root` (streamend) und vergleicht mit `expected` (Schlüssel: Pfad relativ zu `root` in NFC).
 * Meldet Dateien mit anderer Prüfsumme (`abweichend`), nicht in der Liste (`zusätzlich`, ohne sie zu hashen), in der
 * Liste, aber nicht da (`fehlt`), und zwei Dateien, deren Pfade nach NFC gleich sind (`doppelt`). Verglichen wird in
 * NFC: Ein Ziel, das Namen in NFD zurückgibt, passt so zur Liste. Hört nach 10 Abweichungen auf. Dateien, die auch das
 * Kopieren ignoriert (`skipped`), zählen nie.
 */
export function verifyTree(
  root: string | null,
  sub: SumSub,
  expected: Map<string, string>,
  options: VerifyOptions,
): VerifyResult {
  const result: VerifyResult = { files: 0, bytes: 0, problems: [] };
  /** Gesehene Schlüssel (NFC) mit dem Pfad, wie er im Baum steht: Dateien und, getrennt, Ordner */
  const seen = new Map<string, string>();
  const seenDirs = new Map<string, string>();
  const twinOf = (key: string) => seen.get(key) ?? seenDirs.get(key);
  const twinText = (path: string, twin: string) =>
    `${full(path)} gibt es doppelt (wie ${full(twin)}, andere Unicode-Schreibweise)`;
  const full = (rel: string) => `${sub}/${rel}`;
  const problem = (text: string): boolean => {
    result.problems.push(text);
    return result.problems.length >= MAX_PROBLEMS;
  };

  const walk = (dir: string, rel: string): boolean => {
    for (const { name, info } of options.reader.list(dir)) {
      if (skipped(name)) continue;
      const path = rel === '' ? name : `${rel}/${name}`;
      const key = pathKey(path);
      if (!info.isSymbolicLink() && info.isDirectory()) {
        // Zwei Ordner (oder Ordner und Datei) mit nach NFC gleichem Namen: Ein normalisierender Datenordner könnte sie
        // nicht beide anlegen, ein anderer verteilte die Dateien auf zwei Ordner
        const twin = twinOf(key);
        if (twin !== undefined) {
          if (problem(`Ordner ${twinText(path, twin)}`)) return true;
          continue;
        }
        seenDirs.set(key, path);
        if (walk(options.reader.enter(dir, name, info), path)) return true;
        continue;
      }
      if (info.isSymbolicLink() || !info.isFile()) {
        if (options.strict)
          throw new UnsafeTargetError(`${join(dir, name)} ist ein Symlink oder eine Sonderdatei.`);
        continue;
      }
      const twin = twinOf(key);
      if (twin !== undefined) {
        if (problem(`Datei ${twinText(path, twin)}`)) return true;
        continue;
      }
      seen.set(key, path);
      const want = expected.get(key);
      if (want === undefined || options.contents === false) {
        result.files += 1;
        result.bytes += info.size;
        options.onFile?.(info.size);
        if (want === undefined && problem(`zusätzliche Datei ${full(path)}`)) return true;
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
      if (want !== sha) {
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

/**
 * Vergleicht die beim Kopieren gebildeten Prüfsummen (`actual`, Schlüssel: Pfad relativ zu `media/` bzw. `vault/`) mit
 * der Liste (`expected`), ohne eine Datei zu lesen (#324). Gleiche Meldungen wie `verifyTree`: `weicht von der Prüfsumme
 * ab`, `zusätzliche Datei`, `fehlt`, `doppelt`. Verglichen wird in NFC. Höchstens 10 Meldungen.
 */
export function compareSums(
  sub: SumSub,
  expected: Map<string, string>,
  actual: Map<string, string>,
): string[] {
  const problems: string[] = [];
  const add = (text: string): boolean => {
    problems.push(text);
    return problems.length >= MAX_PROBLEMS;
  };
  const seen = new Map<string, string>();
  for (const [path, sha] of actual) {
    const key = pathKey(path);
    const twin = seen.get(key);
    if (twin !== undefined) {
      if (add(`Datei ${sub}/${path} gibt es doppelt (wie ${sub}/${twin}, andere Unicode-Schreibweise)`))
        return problems;
      continue;
    }
    seen.set(key, path);
    const want = expected.get(key);
    if (want === undefined) {
      if (add(`zusätzliche Datei ${sub}/${path}`)) return problems;
    } else if (want !== sha) {
      if (add(`Datei ${sub}/${path} weicht von der Prüfsumme ab`)) return problems;
    }
  }
  for (const key of expected.keys()) {
    if (!seen.has(key) && add(`Datei ${sub}/${key} fehlt`)) break;
  }
  return problems;
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
