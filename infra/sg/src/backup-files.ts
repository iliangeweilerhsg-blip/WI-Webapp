// Dateien eines Backups: Standnamen, Aufbewahrung (Ausdünnen) und inkrementelles Kopieren mit Hardlinks.
import { createHash } from 'node:crypto';
import { closeSync, existsSync, lstatSync, readdirSync, readSync, type Stats } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import type { FilesRef } from './file-sums.ts';
import {
  type AnchoredDirs,
  hashFdAt,
  NoFollowReader,
  NoFollowRemover,
  NoFollowWriter,
  readSmallRegularFile,
  UnsafeTargetError,
  type Identity,
  type LeftBehind,
  type NoFollowHooks,
} from './nofollow.ts';

/** Standname `YYYYMMDDTHHMMSSZ` (UTC), so auch `BackupRun.stand` im Schema */
export const STAND_RE = /^[0-9]{8}T[0-9]{6}Z$/;

export function standName(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

/** Zeitpunkt (UTC) eines Standnamens */
export function standDate(stand: string): Date {
  if (!STAND_RE.test(stand)) throw new Error(`Ungültiger Stand: ${stand}`);
  const iso = `${stand.slice(0, 4)}-${stand.slice(4, 6)}-${stand.slice(6, 8)}T${stand.slice(9, 11)}:${stand.slice(11, 13)}:${stand.slice(13, 15)}Z`;
  return new Date(iso);
}

// ---------------------------------------------------------------- Aufbewahrung

export const RETENTION = { daily: 14, weekly: 8, monthly: 6 } as const;

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** ISO-Woche in UTC als sortierbarer Schlüssel `YYYY-Www` */
function weekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7);
}

export interface RetentionResult {
  keep: string[];
  remove: string[];
}

/**
 * Welche Stände bleiben (F-DAT-01): 14 tägliche, 8 wöchentliche, 6 monatliche. Gestaffelt, damit die Stufen
 * nicht doppelt zählen:
 * 1. täglich: der jeweils neueste Stand der 14 jüngsten Tage, an denen es einen gibt,
 * 2. wöchentlich: von den älteren Ständen der neueste je ISO-Woche, für die 8 jüngsten Wochen,
 * 3. monatlich: von den noch älteren Ständen der neueste je Monat, für die 6 jüngsten Monate.
 * Alles andere kann gelöscht werden. Der neueste Stand bleibt immer.
 */
export function selectRetention(stands: string[], opts: Partial<typeof RETENTION> = {}): RetentionResult {
  const limits = { ...RETENTION, ...opts };
  const sorted = [...new Set(stands)]
    .filter((s) => STAND_RE.test(s))
    .sort()
    .reverse(); // neueste zuerst
  const keep = new Set<string>();

  const days = new Set<string>();
  let oldestDaily: string | null = null;
  for (const stand of sorted) {
    const key = dayKey(standDate(stand));
    if (days.has(key)) continue;
    if (days.size >= limits.daily) break;
    days.add(key);
    keep.add(stand);
    oldestDaily = key;
  }

  const weeks = new Set<string>();
  let oldestWeek: string | null = null;
  for (const stand of sorted) {
    const date = standDate(stand);
    if (oldestDaily !== null && dayKey(date) >= oldestDaily) continue;
    const key = weekKey(date);
    if (weeks.has(key)) continue;
    if (weeks.size >= limits.weekly) break;
    weeks.add(key);
    keep.add(stand);
    oldestWeek = key;
  }

  const months = new Set<string>();
  for (const stand of sorted) {
    const date = standDate(stand);
    if (oldestDaily !== null && dayKey(date) >= oldestDaily) continue;
    // Stände aus Wochen, die die Wochenstufe schon abdeckt, zählen nicht noch einmal
    if (oldestWeek !== null && weekKey(date) >= oldestWeek) continue;
    const key = monthKey(date);
    if (months.has(key)) continue;
    if (months.size >= limits.monthly) break;
    months.add(key);
    keep.add(stand);
  }

  return { keep: sorted.filter((s) => keep.has(s)), remove: sorted.filter((s) => !keep.has(s)) };
}

// ---------------------------------------------------------------- Kopieren

export interface CopyStats {
  files: number;
  bytes: number;
  /** Per Hardlink aus dem vorigen Stand übernommen (unverändert) */
  linked: number;
  copied: number;
  /** Dateien, die während des Kopierens verschwunden sind (Upload-Abschluss, Löschen) */
  vanished: number;
}

/** Namen, die nie ins Backup gehören: halbe Uploads und Zwischenordner */
export function skipped(name: string): boolean {
  // `*.partial`: ein halber Stand (zweite Schutzlinie, falls ein Ziel doch im Quellbaum liegt)
  return name.endsWith('.part') || name.endsWith('.partial') || name === '.tmp' || name === '.DS_Store';
}

/** Schlüssel eines Pfades in `files.sha256` und beim Vergleich (Unicode-NFC, #114 N-1) */
export const pathKey = (path: string): string => path.normalize('NFC');

/**
 * Zwei Einträge, deren Pfade nach NFC gleich sind (#114 N-1): Die Prüfsummenliste könnte sie nicht unterscheiden, ein
 * Ziel, das Namen normalisiert (HFS+, exFAT, manche SMB-/NAS-Freigaben), auch nicht. Das Backup bricht ab (fail-closed).
 */
export class NameConflictError extends Error {}

export function nameConflictText(a: string, b: string): string {
  return (
    `„${a}“ und „${b}“ unterscheiden sich nur in der Unicode-Schreibweise (NFC/NFD) und wären im Backup nicht ` +
    'unterscheidbar. Benenne eine der beiden um, dann läuft das Backup wieder.'
  );
}

export interface CopyTreeOptions {
  /** Nur für Tests: läuft vor dem Kopieren jeder Datei */
  beforeCopy?: (path: string) => void;
  /** Schreiber für `dst` (sonst ein eigener, der den Elternordner von `dst` übernimmt) */
  out?: NoFollowWriter;
  /**
   * Liest `src` und `prev` verankert (#119). Beide müssen ihm bekannt sein; ohne `reader` übernimmt `copyTree` sie als
   * vertrauenswürdig (Datenordner, Tests).
   */
  reader?: NoFollowReader;
  /**
   * Quelle ist ein Stand im Ziel (Restore): Ein Symlink, eine Sonderdatei oder ein unterwegs verschwundener oder
   * ausgetauschter Eintrag ist ein Fehler (`UnsafeTargetError`), statt übersprungen zu werden.
   */
  strictSource?: boolean;
  /**
   * Besitzer (uid), den eigene Dateien im Ziel haben (#183): der des eigenen, gerade angelegten `.partial`
   * (`targetOwner`). Nur Dateien des vorigen Standes mit genau diesem Besitzer werden verlinkt. Ohne Angabe: der
   * Benutzer dieses Prozesses.
   */
  owner?: number | undefined;
  /**
   * Sammelt die SHA-256 jeder Datei des Stands (Schlüssel: Pfad relativ zu `src`), gebildet aus den Bytes, die aus der
   * Quelle gelesen wurden (#114 N-1). Beim Kopieren entsteht sie nebenbei, bei verlinkten Dateien durch Lesen der Quelle.
   */
  sums?: Map<string, string>;
  /**
   * Nur mit `sums`: Eine unveränderte Datei des vorigen Standes hat nicht die Prüfsumme der Quelle (der vorige Stand ist
   * an dieser Datei beschädigt oder manipuliert, oder die Quelle hat sich bei gleicher Größe und Zeit geändert, #324).
   * Sie wird dann kopiert statt verlinkt; hier kommt die Meldung (Pfad relativ zu `src`; `differs`: Prüfsumme weicht ab,
   * `unreadable`: Datei im vorigen Stand nicht lesbar). Ohne diese Angabe wird der Fall still behandelt.
   */
  onDamagedLink?: (path: string, reason: 'differs' | 'unreadable') => void;
}

/**
 * Kopiert den Baum `src` nach `dst`. Unveränderte Dateien (gleiche Größe und Änderungszeit wie im vorigen Stand
 * `prev`) werden dorthin verlinkt statt kopiert: so entsteht aus jedem Lauf ein vollständiger Stand, der nur
 * die Änderungen belegt (inkrementell). Geht ein Hardlink nicht (anderes Dateisystem), wird kopiert.
 * Symbolische Links und Sonderdateien werden übersprungen (mit `strictSource`: Fehler).
 *
 * `dst` darf noch nicht existieren. Geschrieben wird nur über den `NoFollowWriter` (#113), gelesen nur über den
 * `NoFollowReader` (#119): Jeder Ordner von `src` und `prev` wird verankert betreten, Dateien werden relativ mit
 * `O_NOFOLLOW` geöffnet. Ein Symlink in der Quelle wird nie verfolgt.
 */
export function copyTree(
  src: string,
  dst: string,
  prev: string | null,
  stats?: CopyStats,
  options: CopyTreeOptions = {},
): CopyStats {
  const result = stats ?? { files: 0, bytes: 0, linked: 0, copied: 0, vanished: 0 };
  const strict = options.strictSource === true;
  let out = options.out;
  if (!out) {
    out = new NoFollowWriter();
    out.adopt(dirname(dst));
  }
  let reader = options.reader;
  if (!reader) {
    reader = new NoFollowReader({}, !strict);
    try {
      reader.adopt(src);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (prev && existsSync(prev)) reader.adopt(prev);
  }
  const owner = options.owner ?? process.getuid?.();
  copyLevel(src, dst, prev && reader.knows(prev) ? prev : null, result, {
    beforeCopy: options.beforeCopy,
    out,
    reader,
    strict,
    owner,
    sums: options.sums,
    onDamagedLink: options.onDamagedLink,
  });
  return result;
}

interface Level {
  beforeCopy?: ((path: string) => void) | undefined;
  out: NoFollowWriter;
  reader: NoFollowReader;
  strict: boolean;
  /** Besitzer eigener Dateien im Ziel (`undefined`: ohne Unix-Besitzer, nicht geprüft) */
  owner: number | undefined;
  sums?: Map<string, string> | undefined;
  onDamagedLink?: ((path: string, reason: 'differs' | 'unreadable') => void) | undefined;
}

/**
 * SHA-256 der Datei `name` im vorigen Stand, wenn sie noch genau die Datei `old` ist (Identität und Größe) und lesbar.
 * Sonst `undefined` (nicht verlinken, kopieren). Gelesen werden höchstens `old.size + 1` Bytes: Die Datei liegt im Ziel,
 * wer es beschreiben kann, könnte sie sonst (gleiche Inode) beliebig wachsen lassen und den Lauf so aufhalten.
 */
function prevSha(reader: NoFollowReader, prev: string, name: string, old: Stats): string | undefined {
  try {
    const opened = reader.open(prev, name);
    try {
      const info = opened.info;
      if (info.dev !== old.dev || info.ino !== old.ino || info.size !== old.size) return undefined;
      const hash = createHash('sha256');
      const buffer = Buffer.allocUnsafe(Math.min(1024 * 1024, old.size + 1));
      let total = 0;
      for (;;) {
        const n = readSync(opened.fd, buffer, 0, Math.min(buffer.length, old.size + 1 - total), total);
        if (n === 0) break;
        total += n;
        if (total > old.size) return undefined; // gewachsen
        hash.update(buffer.subarray(0, n));
      }
      return total === old.size ? hash.digest('hex') : undefined;
    } finally {
      closeSync(opened.fd);
    }
  } catch {
    return undefined;
  }
}

function unsafe(message: string): UnsafeTargetError {
  return new UnsafeTargetError(message);
}

/** Voriger Stand: Fehler beim Nachsehen heißen nur „nicht verlinken“ (kopiert wird dann immer) */
function prevChild(reader: NoFollowReader, prev: string | null, name: string): string | null {
  if (!prev) return null;
  try {
    return reader.child(prev, name, 'skip');
  } catch {
    return null;
  }
}

function prevFile(reader: NoFollowReader, prev: string | null, name: string): Stats | undefined {
  if (!prev) return undefined;
  try {
    const info = reader.stat(prev, name);
    return info?.isFile() ? info : undefined;
  } catch {
    return undefined;
  }
}

function copyLevel(
  src: string,
  dst: string,
  prev: string | null,
  result: CopyStats,
  level: Level,
  rel = '',
): void {
  const { out, reader, strict } = level;
  out.mkdir(dst);
  let entries: { name: string; info: Stats }[];
  try {
    entries = reader.list(src);
  } catch (error) {
    if (!strict && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      result.vanished += 1;
      return;
    }
    throw error;
  }
  // Prüfsummen (Backup): zwei Namen, die nach NFC gleich sind, vor dem Kopieren ablehnen. Ein normalisierendes Ziel
  // scheiterte sonst mitten im Lauf mit „gibt es schon“, ein anderes bekäme zwei Dateien unter einem Listenschlüssel.
  if (level.sums) {
    const keys = new Map<string, string>();
    for (const { name, info } of entries) {
      if (skipped(name) || info.isSymbolicLink() || !(info.isDirectory() || info.isFile())) continue;
      const key = pathKey(name);
      const other = keys.get(key);
      if (other !== undefined)
        throw new NameConflictError(nameConflictText(join(src, other), join(src, name)));
      keys.set(key, name);
    }
  }
  for (const { name, info } of entries) {
    if (skipped(name)) continue;
    const from = join(src, name);
    const to = join(dst, name);
    if (!info.isSymbolicLink() && info.isDirectory()) {
      copyLevel(
        reader.enter(src, name, info),
        to,
        prevChild(reader, prev, name),
        result,
        level,
        rel === '' ? name : `${rel}/${name}`,
      );
      continue;
    }
    if (info.isSymbolicLink() || !info.isFile()) {
      if (strict) throw unsafe(`${from} ist ein Symlink oder eine Sonderdatei.`);
      continue;
    }
    let opened: { fd: number; info: Stats };
    try {
      level.beforeCopy?.(from);
      opened = reader.open(src, name);
    } catch (error) {
      const vanished = (error as NodeJS.ErrnoException).code === 'ENOENT';
      // Im Datenordner: inzwischen verschwunden oder kein reguläre Datei mehr → überspringen und zählen
      if (!strict && (vanished || error instanceof UnsafeTargetError)) {
        result.vanished += 1;
        continue;
      }
      if (strict && vanished) throw unsafe(`${from} ist während des Lesens verschwunden.`);
      throw error;
    }
    try {
      const real = opened.info;
      if (strict && (real.dev !== info.dev || real.ino !== info.ino)) {
        throw unsafe(`${from} wurde während des Lesens ausgetauscht.`);
      }
      let how: 'linked' | 'copied' = 'copied';
      const old = prevFile(reader, prev, name);
      const relPath = rel === '' ? name : `${rel}/${name}`;
      let sha: string | undefined;
      // Nur eigene Dateien verlinken (H-1, #161): Die Besitzerprüfung des vorigen Standes (`ownStandsIn`) läuft vor
      // `pg_dump`, gelesen wird er erst danach. Tauscht ihn jemand dazwischen gegen einen eigenen Ordner, gehören
      // dessen Dateien nicht diesem Benutzer und werden kopiert statt verlinkt (sonst änderte er später den neuen Stand).
      // „Eigen“ heißt: derselbe Besitzer wie das eigene `.partial` (#183), nicht zwingend der Benutzer des Prozesses.
      if (
        old &&
        (level.owner === undefined || old.uid === level.owner) &&
        old.size === real.size &&
        Math.abs(old.mtimeMs - real.mtimeMs) < 2 &&
        // Ohne Hardlinks im Ziel (exFAT, manche SMB/NAS-Freigaben) bringt das Prüfen des vorigen Standes nichts: direkt
        // kopieren und dabei hashen, jede Datei wird genau einmal gelesen.
        out.canLink(dst)
      ) {
        // Backup mit Prüfsummen (#324): Die Prüfsumme kommt aus der Quelle. Der Link gilt nur, wenn auch die Datei im
        // vorigen Stand dieselbe Prüfsumme hat; sonst bekäme der neue Stand eine Datei, die nicht zu seiner Liste passt
        // und sich nicht wiederherstellen ließe. Die Quelle wird mit festen Positionen gelesen (`hashFdAt`), damit sie bei
        // Abweichung noch von vorn kopiert werden kann.
        let linkable = true;
        if (level.sums) {
          sha = hashFdAt(opened.fd);
          const previousSha = prevSha(reader, prev as string, name, old);
          if (previousSha !== sha) {
            linkable = false;
            sha = undefined;
            level.onDamagedLink?.(relPath, previousSha === undefined ? 'unreadable' : 'differs');
          }
        }
        // `old` stammt aus dem verankerten Ordner des vorigen Standes: der Link wird nur behalten, wenn er genau auf
        // diese Datei zeigt (N2). Kein Hardlink möglich: kopieren.
        if (linkable && out.link(join(prev as string, name), to, old)) how = 'linked';
        else sha = undefined;
      }
      if (how === 'copied') sha = out.copyFromFd(opened.fd, to, real);
      if (level.sums && sha !== undefined) level.sums.set(relPath, sha);
      result.files += 1;
      result.bytes += real.size;
      result[how] += 1;
    } finally {
      closeSync(opened.fd);
    }
  }
  // Der private Ordner für Hardlinks (H1) gehört nie zum Stand
  out.endLinks(dst);
}

/**
 * Summe der Dateigrößen unterhalb von `dir`, verankert gelesen (#119). Mit `strict` (Stand im Ziel) ist ein Symlink
 * oder eine Sonderdatei ein Fehler (`UnsafeTargetError`), sonst wird sie nicht gezählt. `reader` muss `dir` kennen;
 * ohne `reader` wird `dir` als vertrauenswürdig übernommen.
 */
export function treeSize(
  dir: string,
  options: { reader?: NoFollowReader; strict?: boolean } = {},
): { files: number; bytes: number } {
  const strict = options.strict === true;
  let reader = options.reader;
  if (!reader) {
    reader = new NoFollowReader({}, !strict);
    try {
      reader.adopt(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { files: 0, bytes: 0 };
      throw error;
    }
  }
  return sizeLevel(reader, dir, strict);
}

function sizeLevel(reader: NoFollowReader, dir: string, strict: boolean): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  let entries: { name: string; info: Stats }[];
  try {
    entries = reader.list(dir);
  } catch (error) {
    if (!strict && (error as NodeJS.ErrnoException).code === 'ENOENT') return { files, bytes };
    throw error;
  }
  for (const { name, info } of entries) {
    if (skipped(name)) continue; // wie beim Kopieren: .DS_Store, *.part, .tmp zählen nie
    if (!info.isSymbolicLink() && info.isDirectory()) {
      const sub = sizeLevel(reader, reader.enter(dir, name, info), strict);
      files += sub.files;
      bytes += sub.bytes;
    } else if (!info.isSymbolicLink() && info.isFile()) {
      bytes += info.size;
      files += 1;
    } else if (strict) {
      throw unsafe(`${join(dir, name)} ist ein Symlink oder eine Sonderdatei.`);
    }
  }
  return { files, bytes };
}

// ---------------------------------------------------------------- Stände im Ziel

export interface Manifest {
  version: 1;
  stand: string;
  created_at: string;
  trigger: string;
  pg_server_version: string | null;
  /** Anzahl angewendeter Drizzle-Migrationen beim Backup (Schemaversion), `null` = unbekannt */
  migrations?: number | null;
  dump: { file: string; bytes: number; sha256: string };
  /** Zeilen je Tabelle in der Live-Datenbank kurz nach dem Dump (Richtwert für `restore --test`) */
  counts: Record<string, number>;
  media: { files: number; bytes: number };
  vault: { files: number; bytes: number };
  /**
   * Prüfsummenliste von `media/` und `vault/` (#114 N-1). Fehlt bei Ständen vor dieser Version: Dort gibt es nur
   * Anzahl und Größe.
   */
  files?: FilesRef;
}

export const MANIFEST_FILE = 'manifest.json';
export const DUMP_FILE = 'db.dump';
const MANIFEST_MAX_BYTES = 1024 * 1024;

export function readManifest(standDir: string): Manifest | null {
  try {
    // Das Ziel ist nicht vertrauenswürdig: kein Symlink, keine FIFO (würde hängen), höchstens 1 MB
    const raw = readSmallRegularFile(join(standDir, MANIFEST_FILE), MANIFEST_MAX_BYTES);
    if (raw === null) return null;
    return parseManifest(raw);
  } catch {
    // fehlt oder kaputt
  }
  return null;
}

function parseManifest(raw: Buffer): Manifest | null {
  const parsed: unknown = JSON.parse(raw.toString('utf8'));
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    (parsed as Manifest).version === 1 &&
    typeof (parsed as Manifest).stand === 'string' &&
    typeof (parsed as Manifest).dump?.sha256 === 'string'
  ) {
    return parsed as Manifest;
  }
  return null;
}

/**
 * Manifest des Ordners `<target>/<name>`, gelesen in genau dem Ordner mit der Identität `seen` (verankert, relativ,
 * ohne Symlink-Folgen). `null`, wenn unter dem Namen inzwischen ein anderer Ordner liegt, das Manifest fehlt oder
 * ungültig ist. So prüft, wer danach mit `removeTree(…, seen)` löscht, das Manifest desselben Ordners, den er löscht:
 * Ein kurzer Tausch nur während des Lesens (A→B→A) täuscht die Prüfung nicht mehr (TOCTOU, H-1 aus #161).
 */
export function readManifestAt(
  target: string | TargetDir,
  name: string,
  seen: Identity,
  hooks?: NoFollowHooks,
): Manifest | null {
  const reader = new NoFollowReader(hooks);
  let opened: { fd: number; info: Stats };
  try {
    const base = adoptTarget(reader, target);
    opened = reader.open(reader.enter(base, name, seen), MANIFEST_FILE);
  } catch {
    return null;
  }
  try {
    if (opened.info.size > MANIFEST_MAX_BYTES) return null;
    const buffer = Buffer.alloc(opened.info.size);
    let offset = 0;
    while (offset < buffer.length) {
      const n = readSync(opened.fd, buffer, offset, buffer.length - offset, null);
      if (n === 0) break;
      offset += n;
    }
    return parseManifest(buffer.subarray(0, offset));
  } catch {
    return null;
  } finally {
    closeSync(opened.fd);
  }
}

/** Vollständige Stände im Ziel (Ordner mit gültigem Manifest), neueste zuerst */
export function listStands(target: string): string[] {
  if (!existsSync(target)) return [];
  return readdirSync(target, { withFileTypes: true })
    .filter((e) => e.isDirectory() && STAND_RE.test(e.name) && readManifest(join(target, e.name)) !== null)
    .map((e) => e.name)
    .sort()
    .reverse();
}

/** Geprüftes Ziel mit der Identität, mit der es geprüft wurde (`validateTarget`, H2 aus #124) */
export interface TargetDir extends Identity {
  path: string;
}

/**
 * Ziel für den Remover übernehmen: mit Identität aus `validateTarget` (so im Lauf), sonst (nur Tests) wie gesehen.
 * Rückgabe: Pfad des Ziels.
 */
function adoptTarget(remover: AnchoredDirs, target: string | TargetDir): string {
  if (typeof target === 'string') {
    remover.adopt(target);
    return target;
  }
  remover.adopt(target.path, target);
  return target.path;
}

/** Ergebnis von `removeStandReport`: was stehen blieb, mit Ursache (H3) */
export interface RemoveReport {
  /** `true` = entfernt, `false` = kein Stand, `'teilweise'` = es bleibt etwas stehen */
  status: boolean | 'teilweise';
  left: LeftBehind[];
}

/**
 * Löscht nur Ordner, die wirklich ein Stand sind (Name passt, Manifest vorhanden). Gelöscht wird verankert, ohne je
 * einem Symlink zu folgen, auch wenn während des Löschens Ordner ausgetauscht werden (`NoFollowRemover`, #119).
 * Das Ziel wird mit seiner geprüften Identität verankert (`TargetDir`, H2): Ist es inzwischen ein anderer Ordner,
 * wird darin nichts gelöscht.
 */
export function removeStandReport(
  target: string | TargetDir,
  stand: string,
  hooks?: NoFollowHooks,
  expected?: Identity,
): RemoveReport {
  if (!STAND_RE.test(stand)) return { status: false, left: [] };
  if (readManifest(join(typeof target === 'string' ? target : target.path, stand)) === null) {
    return { status: false, left: [] };
  }
  const remover = new NoFollowRemover(hooks);
  const base = adoptTarget(remover, target);
  // Das Manifest geht zuletzt: Ein abgebrochener Rest bleibt ein Stand und wird beim nächsten Lauf weiter gelöscht
  const left = remover.removeTree(base, stand, MANIFEST_FILE, expected);
  return { status: left.length === 0 ? true : 'teilweise', left };
}

/** Wie `removeStandReport`, nur das Ergebnis: `true` = entfernt, `false` = kein Stand, `'teilweise'` = Rest bleibt */
export function removeStand(
  target: string | TargetDir,
  stand: string,
  hooks?: NoFollowHooks,
): boolean | 'teilweise' {
  return removeStandReport(target, stand, hooks).status;
}

/** Ergebnis von `removeStalePartialsReport` */
export interface PartialsReport {
  removed: string[];
  /**
   * Nicht angefasst (H-1, #161), weil der Ordner nicht nachweislich aus einem eigenen Lauf stammt:
   * - `manifest`: Darin liegt ein `manifest.json`. Ein abgebrochener Lauf hat fast nie eines, ein in
   *   `.<stand>.partial` umbenannter fertiger Stand dagegen schon. So bringt ein Umbenennen im Ziel `sg backup` nicht
   *   dazu, einen echten Stand zu löschen.
   * - `fremd`: Der Ordner gehört einem anderen Benutzer (`ownedByThisUser`). Er stammt nicht aus `sg backup` und kann
   *   darum alles Mögliche enthalten, etwa einen dorthin verschobenen echten Stand.
   */
  kept: { name: string; why: 'manifest' | 'fremd' }[];
  /** Nicht vollständig entfernte `.partial`-Ordner mit dem, was darin stehen blieb */
  left: { name: string; left: LeftBehind[] }[];
}

/**
 * Besitzer (uid), den Ordner haben, die dieser Lauf im Ziel anlegt (#183). Meist ist das der Benutzer des Prozesses.
 * Manche Ziele melden aber einen anderen: SMB/CIFS ohne `uid=` (alles gehört dem einhängenden Benutzer oder root), NFS
 * mit `root_squash` bei einem Lauf per `sudo` (alles gehört `nobody`). Mit `getuid()` gälte dort kein Stand als eigen:
 * nie ausgedünnt, nie verlinkt, das Ziel liefe voll. `undefined`: Plattform ohne Unix-Besitzer (Windows), nicht geprüft.
 *
 * Maßstab ist nicht das `lstat` des eigenen `.partial` (`created`, Rückgabe von `NoFollowWriter.mkdir`) allein: Tauscht
 * jemand den frisch angelegten Ordner zwischen `mkdir` und `lstat` gegen einen eigenen, gälte sonst seine uid als
 * „eigen“ (H-1 aus #161 wieder offen). Darum legt der Lauf im `.partial` exklusiv eine Probedatei an und nimmt deren
 * uid per `fstat` am eigenen Deskriptor (`ownerOfNew`). Ein Ziel mit Unix-Besitzern gibt Datei und Ordner desselben
 * Prozesses dieselbe uid, ein Ziel ohne meldet für beide dieselbe. Weicht `created` davon ab, wurde getauscht: Abbruch.
 */
export function targetOwner(out: NoFollowWriter, partial: string, created: Stats): number | undefined {
  if (process.getuid === undefined) return undefined;
  const owner = out.ownerOfNew(partial);
  if (created.uid !== owner) {
    throw new UnsafeTargetError(
      `${partial} wurde beim Anlegen ersetzt: Der Ordner gehört uid ${created.uid}, neue Dateien dieses Laufs gehören uid ${owner}. Der Lauf bricht ab.`,
    );
  }
  return owner;
}

/**
 * Ist `path` ein echter Ordner (kein Symlink) mit dem Besitzer `owner`? (H-1, #161; #183) `owner` ist der Besitzer
 * eigener Ordner im Ziel (`targetOwner`), ohne Angabe der Benutzer dieses Prozesses.
 * Was `sg backup` im Ziel anlegt, gehört immer diesem Besitzer. Wer im Ziel nur Ordner anlegen kann, erzeugt auf einem
 * Dateisystem mit Unix-Besitzern Ordner mit seinem eigenen Besitzer und kann so keinen eigenen Stand vortäuschen, auch
 * nicht mit einem kopierten Manifest. Auf Dateisystemen ohne Unix-Besitzer (exFAT, SMB/CIFS ohne Unix-Erweiterungen)
 * meldet der Kernel für alles denselben Besitzer; dort hilft die Prüfung nicht, schadet aber auch nicht (dort kann
 * ohnehin jeder mit Zugang alles ändern und löschen). Es bleiben `backup_run` und die Prüfsumme im Manifest.
 */
export function ownedByThisUser(path: string, owner?: number): boolean {
  return ownedDir(path, owner) !== null;
}

/**
 * Wie `ownedByThisUser`, mit der Identität des geprüften Ordners (`null`: nicht eigen). Wer danach löscht, bindet das
 * Löschen an genau diese Identität (`removeTree(…, expected)`): Ein inzwischen unter den Namen geschobener anderer
 * Ordner wird so nicht gelöscht (TOCTOU, H-1 aus #161).
 */
export function ownedDir(path: string, owner = process.getuid?.()): Identity | null {
  try {
    const info = lstatSync(path, { throwIfNoEntry: false });
    if (!info?.isDirectory()) return null;
    if (owner !== undefined && info.uid !== owner) return null;
    return { dev: info.dev, ino: info.ino };
  } catch {
    return null;
  }
}

/**
 * Liegt in `<base>/<name>` ein Eintrag `manifest.json`? Nachgesehen wird verankert in genau dem Ordner mit der
 * Identität `seen` (wie `readManifestAt`), ohne Symlink-Folgen. Im Zweifel ja, dann wird nichts gelöscht.
 */
function holdsManifestAt(
  target: string | TargetDir,
  name: string,
  seen: Identity,
  hooks?: NoFollowHooks,
): boolean {
  const reader = new NoFollowReader(hooks);
  try {
    const base = adoptTarget(reader, target);
    return reader.list(reader.enter(base, name, seen)).some((entry) => entry.name === MANIFEST_FILE);
  } catch {
    return true;
  }
}

/**
 * Halbfertige Läufe (`.<stand>.partial`) löschen, die älter als `olderThanMs` sind (verankert wie `removeStand`).
 * Nur Ordner mit dem Besitzer `owner` (`targetOwner`, ohne Angabe der Benutzer dieses Prozesses).
 */
export function removeStalePartialsReport(
  target: string | TargetDir,
  now: number,
  olderThanMs: number,
  hooks?: NoFollowHooks,
  owner?: number,
): PartialsReport {
  const report: PartialsReport = { removed: [], kept: [], left: [] };
  const remover = new NoFollowRemover(hooks);
  const base = typeof target === 'string' ? target : target.path;
  if (!existsSync(base)) return report;
  adoptTarget(remover, target);
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    const match = /^\.([0-9]{8}T[0-9]{6}Z)\.partial$/.exec(entry.name);
    if (!entry.isDirectory() || !match) continue;
    if (now - standDate(match[1] as string).getTime() < olderThanMs) continue;
    const seen = ownedDir(join(base, entry.name), owner);
    if (!seen) {
      report.kept.push({ name: entry.name, why: 'fremd' });
      continue;
    }
    if (holdsManifestAt(target, entry.name, seen, hooks)) {
      report.kept.push({ name: entry.name, why: 'manifest' });
      continue;
    }
    // Gelöscht wird nur genau der geprüfte Ordner (ein inzwischen hierher geschobener Stand bleibt stehen)
    const left = remover.removeTree(base, entry.name, undefined, seen);
    if (left.length === 0) report.removed.push(entry.name);
    else report.left.push({ name: entry.name, left });
  }
  return report;
}

/** Wie `removeStalePartialsReport`, nur die entfernten Namen */
export function removeStalePartials(
  target: string | TargetDir,
  now: number,
  olderThanMs: number,
  hooks?: NoFollowHooks,
): string[] {
  return removeStalePartialsReport(target, now, olderThanMs, hooks).removed;
}

/** Deutscher Text zu einer Ursache aus `LeftBehind` (H3: die tatsächliche Ursache, nicht pauschal „ausgetauscht“) */
export function causeText(cause: string): string {
  switch (cause) {
    case 'getauscht':
      return 'Im Ziel wurde während des Löschens etwas ausgetauscht';
    case 'hinzugekommen':
      return 'Während des Löschens kam im Stand etwas hinzu';
    case 'EACCES':
    case 'EPERM':
      return `Keine Berechtigung (${cause}), etwa durch Zugriffsrechte, ACLs oder eine Sperre (immutable)`;
    case 'ENOTEMPTY':
    case 'EEXIST':
      return `Ein Ordner ist nicht leer (${cause}), im Ziel kam etwas hinzu`;
    case 'EROFS':
      return 'Das Ziel ist schreibgeschützt (EROFS)';
    case 'EBUSY':
      return 'Ein Eintrag ist in Benutzung (EBUSY)';
    case 'unvollstaendig':
      return 'Darunter blieb etwas stehen';
    default:
      return `Systemfehler ${cause}`;
  }
}

/** Steuerzeichen und Zeilenumbrüche (Namen aus dem Ziel sind nicht vertrauenswürdig) als `?`, für Log und Anzeige */
export function oneLine(text: string): string {
  // eslint-disable-next-line no-control-regex -- Steuerzeichen sind genau das, was hier ersetzt wird
  return text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, '?');
}

/** Die tiefste Ursache, die nicht nur Folge ist (`unvollstaendig`); `undefined`, wenn nichts stehen blieb */
export function rootCause(left: LeftBehind[]): LeftBehind | undefined {
  return left.find((l) => l.cause !== 'unvollstaendig') ?? left[0];
}

/**
 * Ursache in einem Satz für das Log, mit dem betroffenen Eintrag relativ zu `base` (auf eine Zeile gebracht). Ist es
 * der Ordner selbst, ohne Eintrag. Leer, wenn nichts stehen blieb.
 */
export function describeLeft(left: LeftBehind[], base: string): string {
  const first = rootCause(left);
  if (!first) return '';
  const rel = oneLine(relative(base, first.path));
  return rel === '' ? causeText(first.cause) : `${causeText(first.cause)} (bei ${rel})`;
}

/** Ursache ohne Fachbegriffe, für die Oberfläche (`backup_run.warning`) */
export function plainCause(cause: string): string {
  switch (cause) {
    case 'EACCES':
    case 'EPERM':
      return 'keine Berechtigung';
    case 'EROFS':
      return 'das Ziel ist schreibgeschützt';
    case 'getauscht':
      return 'das Ziel wurde dabei verändert';
    case 'hinzugekommen':
    case 'ENOTEMPTY':
    case 'EEXIST':
      return 'im Ordner kam etwas hinzu';
    case 'EBUSY':
      return 'ein Eintrag ist in Benutzung';
    default:
      return 'Fehler beim Löschen';
  }
}
