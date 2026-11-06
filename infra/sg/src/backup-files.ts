// Dateien eines Backups: Standnamen, Aufbewahrung (Ausdünnen) und inkrementelles Kopieren mit Hardlinks.
import { closeSync, existsSync, readdirSync, type Stats } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import {
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
  copyLevel(src, dst, prev && reader.knows(prev) ? prev : null, result, { ...options, out, reader, strict });
  return result;
}

interface Level {
  beforeCopy?: ((path: string) => void) | undefined;
  out: NoFollowWriter;
  reader: NoFollowReader;
  strict: boolean;
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

function copyLevel(src: string, dst: string, prev: string | null, result: CopyStats, level: Level): void {
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
  for (const { name, info } of entries) {
    if (skipped(name)) continue;
    const from = join(src, name);
    const to = join(dst, name);
    if (!info.isSymbolicLink() && info.isDirectory()) {
      copyLevel(reader.enter(src, name, info), to, prevChild(reader, prev, name), result, level);
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
      if (old && old.size === real.size && Math.abs(old.mtimeMs - real.mtimeMs) < 2) {
        // `old` stammt aus dem verankerten Ordner des vorigen Standes: der Link wird nur behalten, wenn er genau auf
        // diese Datei zeigt (N2). Kein Hardlink möglich: kopieren.
        if (out.link(join(prev as string, name), to, old)) how = 'linked';
      }
      if (how === 'copied') out.copyFromFd(opened.fd, to, real);
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
}

export const MANIFEST_FILE = 'manifest.json';
export const DUMP_FILE = 'db.dump';
const MANIFEST_MAX_BYTES = 1024 * 1024;

export function readManifest(standDir: string): Manifest | null {
  try {
    // Das Ziel ist nicht vertrauenswürdig: kein Symlink, keine FIFO (würde hängen), höchstens 1 MB
    const raw = readSmallRegularFile(join(standDir, MANIFEST_FILE), MANIFEST_MAX_BYTES);
    if (raw === null) return null;
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
  } catch {
    // fehlt oder kaputt
  }
  return null;
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
function adoptTarget(remover: NoFollowRemover, target: string | TargetDir): string {
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
): RemoveReport {
  if (!STAND_RE.test(stand)) return { status: false, left: [] };
  if (readManifest(join(typeof target === 'string' ? target : target.path, stand)) === null) {
    return { status: false, left: [] };
  }
  const remover = new NoFollowRemover(hooks);
  const base = adoptTarget(remover, target);
  // Das Manifest geht zuletzt: Ein abgebrochener Rest bleibt ein Stand und wird beim nächsten Lauf weiter gelöscht
  const left = remover.removeTree(base, stand, MANIFEST_FILE);
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
  /** Nicht vollständig entfernte `.partial`-Ordner mit dem, was darin stehen blieb */
  left: { name: string; left: LeftBehind[] }[];
}

/** Halbfertige Läufe (`.<stand>.partial`) löschen, die älter als `olderThanMs` sind (verankert wie `removeStand`) */
export function removeStalePartialsReport(
  target: string | TargetDir,
  now: number,
  olderThanMs: number,
  hooks?: NoFollowHooks,
): PartialsReport {
  const report: PartialsReport = { removed: [], left: [] };
  const remover = new NoFollowRemover(hooks);
  const base = typeof target === 'string' ? target : target.path;
  if (!existsSync(base)) return report;
  adoptTarget(remover, target);
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    const match = /^\.([0-9]{8}T[0-9]{6}Z)\.partial$/.exec(entry.name);
    if (!entry.isDirectory() || !match) continue;
    if (now - standDate(match[1] as string).getTime() < olderThanMs) continue;
    const left = remover.removeTree(base, entry.name);
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
