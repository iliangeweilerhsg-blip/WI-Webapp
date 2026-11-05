// Dateien eines Backups: Standnamen, Aufbewahrung (Ausdünnen) und inkrementelles Kopieren mit Hardlinks.
import {
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
} from 'node:fs';
import { join } from 'node:path';

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
}

/** Namen, die nie ins Backup gehören: halbe Uploads und Zwischenordner */
function skipped(name: string): boolean {
  return name.endsWith('.part') || name === '.tmp' || name === '.DS_Store';
}

/**
 * Kopiert den Baum `src` nach `dst`. Unveränderte Dateien (gleiche Größe und Änderungszeit wie im vorigen Stand
 * `prev`) werden dorthin verlinkt statt kopiert: so entsteht aus jedem Lauf ein vollständiger Stand, der nur
 * die Änderungen belegt (inkrementell). Geht ein Hardlink nicht (anderes Dateisystem), wird kopiert.
 * Symbolische Links und Sonderdateien werden übersprungen.
 */
export function copyTree(src: string, dst: string, prev: string | null, stats?: CopyStats): CopyStats {
  const result = stats ?? { files: 0, bytes: 0, linked: 0, copied: 0 };
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (skipped(entry.name)) continue;
    const from = join(src, entry.name);
    const to = join(dst, entry.name);
    const before = prev ? join(prev, entry.name) : null;
    if (entry.isDirectory()) {
      copyTree(from, to, before && existsSync(before) ? before : null, result);
      continue;
    }
    if (!entry.isFile()) continue;
    const info = lstatSync(from);
    result.files += 1;
    result.bytes += info.size;
    if (before) {
      const old = lstatSync(before, { throwIfNoEntry: false });
      if (old?.isFile() && old.size === info.size && Math.abs(old.mtimeMs - info.mtimeMs) < 2) {
        try {
          linkSync(before, to);
          result.linked += 1;
          continue;
        } catch {
          // kein Hardlink möglich: kopieren
        }
      }
    }
    copyFileSync(from, to);
    utimesSync(to, info.atime, info.mtime);
    result.copied += 1;
  }
  return result;
}

/** Summe der Dateigrößen unterhalb von `dir` */
export function treeSize(dir: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = treeSize(full);
      files += sub.files;
      bytes += sub.bytes;
    } else if (entry.isFile()) {
      files += 1;
      bytes += lstatSync(full).size;
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
  dump: { file: string; bytes: number; sha256: string };
  /** Zeilen je Tabelle in der Live-Datenbank kurz nach dem Dump (Richtwert für `restore --test`) */
  counts: Record<string, number>;
  media: { files: number; bytes: number };
  vault: { files: number; bytes: number };
}

export const MANIFEST_FILE = 'manifest.json';
export const DUMP_FILE = 'db.dump';

export function readManifest(standDir: string): Manifest | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(standDir, MANIFEST_FILE), 'utf8'));
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

/** Löscht nur Ordner, die wirklich ein Stand sind (Name passt, Manifest vorhanden) */
export function removeStand(target: string, stand: string): boolean {
  if (!STAND_RE.test(stand)) return false;
  const dir = join(target, stand);
  if (readManifest(dir) === null) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

/** Halbfertige Läufe (`.<stand>.partial`) löschen, die älter als `olderThanMs` sind */
export function removeStalePartials(target: string, now: number, olderThanMs: number): string[] {
  const removed: string[] = [];
  if (!existsSync(target)) return removed;
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    const match = /^\.([0-9]{8}T[0-9]{6}Z)\.partial$/.exec(entry.name);
    if (!entry.isDirectory() || !match) continue;
    if (now - standDate(match[1] as string).getTime() < olderThanMs) continue;
    rmSync(join(target, entry.name), { recursive: true, force: true });
    removed.push(entry.name);
  }
  return removed;
}
