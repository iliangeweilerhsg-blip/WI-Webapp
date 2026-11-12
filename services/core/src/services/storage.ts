// Speicherplatz (UX-11, VERTRAEGE §7.6): freier Platz des Datenträgers und Größe der Daten.
// Der freie Platz ist billig (`statfs`) und wird bei jedem Aufruf frisch gelesen. Die Größe des Datenordners
// braucht einen Durchlauf über alle Dateien und wird darum zwischengespeichert (Zeitstempel `measured_at`).
import { lstat, readdir, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import type { SystemStorage } from '@sg/shared';
import type { Db } from '../db/client.ts';

/** So lange gilt eine gemessene Größe, bevor der nächste Aufruf neu misst */
export const STORAGE_SIZE_TTL_MS = 5 * 60_000;
/** Höchstzeit für die Abfrage der Datenbankgröße; danach fehlt `db_bytes` */
const DB_SIZE_TIMEOUT_MS = 2000;

/** Höchstzeit eines Durchlaufs über den Datenordner (ms); danach gilt der Teilstand als Untergrenze */
export const STORAGE_WALK_TIME_LIMIT_MS = 15_000;
/** Höchstzahl der Einträge eines Durchlaufs; danach gilt der Teilstand als Untergrenze */
export const STORAGE_WALK_MAX_ENTRIES = 1_000_000;

export interface DirSizes {
  total: number;
  media: number;
  vault: number;
  /** false: der Durchlauf hat eine Grenze erreicht, die Summen sind eine Untergrenze */
  complete: boolean;
}

export interface MeasureDirLimits {
  /** Höchstzeit in ms (Standard `STORAGE_WALK_TIME_LIMIT_MS`) */
  timeLimitMs?: number;
  /** Höchstzahl der Einträge (Standard `STORAGE_WALK_MAX_ENTRIES`) */
  maxEntries?: number;
  /** Uhr in ms (nur für Tests) */
  now?: () => number;
}

/**
 * Summe der Dateigrößen unter `root`, aufgeteilt nach dem ersten Pfadteil (`media`, `vault`). Symlinks werden nicht
 * verfolgt (sie zählen mit ihrer eigenen Größe, ein Link auf einen Ordner führt nicht aus dem Datenordner heraus),
 * unlesbare Einträge und Dateien, die während des Durchlaufs verschwinden, werden übersprungen.
 * Der Durchlauf ist begrenzt (Zeit und Zahl der Einträge), damit sehr viele Dateien den Core nicht beschäftigen:
 * Wird eine Grenze erreicht, endet er mit `complete: false` und den bis dahin gezählten Größen.
 */
export async function measureDir(root: string, limits: MeasureDirLimits = {}): Promise<DirSizes> {
  const now = limits.now ?? Date.now;
  const deadline = now() + (limits.timeLimitMs ?? STORAGE_WALK_TIME_LIMIT_MS);
  const maxEntries = limits.maxEntries ?? STORAGE_WALK_MAX_ENTRIES;
  const sizes: DirSizes = { total: 0, media: 0, vault: 0, complete: true };
  let seen = 0;
  const pending: Array<{ dir: string; top: string | null }> = [{ dir: root, top: null }];
  while (pending.length > 0) {
    const { dir, top } = pending.pop()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      seen += 1;
      if (seen > maxEntries || now() > deadline) {
        sizes.complete = false;
        return sizes;
      }
      const path = join(dir, entry.name);
      const group = top ?? entry.name;
      // Dirent aus readdir: ein Symlink ist nie `isDirectory()`, er wird also nicht betreten
      if (entry.isDirectory()) {
        pending.push({ dir: path, top: group });
        continue;
      }
      let size: number;
      try {
        size = (await lstat(path)).size;
      } catch {
        continue;
      }
      sizes.total += size;
      if (group === 'media') sizes.media += size;
      else if (group === 'vault') sizes.vault += size;
    }
  }
  return sizes;
}

interface CachedSizes extends DirSizes {
  measuredAt: number;
}

export interface StorageMeterOptions {
  dataDir: string;
  db: Db;
  ttlMs?: number;
  /** Höchstzeit für `pg_database_size` (ms) */
  dbTimeoutMs?: number;
  now?: () => number;
  /** Grenzen des Durchlaufs (nur für Tests anders als der Standard) */
  walkLimits?: Omit<MeasureDirLimits, 'now'>;
  /** Meldet einen Durchlauf, der eine Grenze erreicht hat */
  onIncomplete?: (sizes: DirSizes) => void;
}

/** Misst Speicherplatz; die Größe des Datenordners wird höchstens alle `ttlMs` neu bestimmt. */
export class StorageMeter {
  private cache: CachedSizes | null = null;
  private inflight: Promise<CachedSizes> | null = null;
  private readonly ttlMs: number;
  private readonly now: () => number;

  private readonly options: StorageMeterOptions;

  constructor(options: StorageMeterOptions) {
    this.options = options;
    this.ttlMs = options.ttlMs ?? STORAGE_SIZE_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  private sizes(): Promise<CachedSizes> {
    const cached = this.cache;
    if (cached && this.now() - cached.measuredAt < this.ttlMs) return Promise.resolve(cached);
    // Gleichzeitige Aufrufe teilen sich einen Durchlauf
    // Auch ein unvollständiger Durchlauf gilt `ttlMs` lang, sonst liefe der teure Durchlauf bei jedem Aufruf
    this.inflight ??= measureDir(this.options.dataDir, { ...this.options.walkLimits, now: this.now })
      .then((s) => {
        if (!s.complete) this.options.onIncomplete?.(s);
        return (this.cache = { ...s, measuredAt: this.now() });
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  private async dbBytes(): Promise<number | undefined> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), this.options.dbTimeoutMs ?? DB_SIZE_TIMEOUT_MS);
    });
    try {
      const rows = await Promise.race([
        this.options.db.execute<{ bytes: string | number }>(
          sql`SELECT pg_database_size(current_database())::bigint AS bytes`,
        ),
        timeout,
      ]);
      const bytes = Number(rows[0]?.bytes);
      return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : undefined;
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  async read(): Promise<SystemStorage> {
    // `statfs` scheitert, wenn der Datenordner fehlt: der Fehler geht an die Route
    const fs = await statfs(this.options.dataDir);
    const free = Math.max(0, Math.floor(Number(fs.bavail) * Number(fs.bsize)));
    const [sizes, db] = await Promise.all([this.sizes(), this.dbBytes()]);
    return {
      data_dir_free_bytes: free,
      data_dir_size_bytes: sizes.total,
      media_bytes: sizes.media,
      vault_bytes: sizes.vault,
      ...(db === undefined ? {} : { db_bytes: db }),
      measured_at: new Date(sizes.measuredAt).toISOString(),
    };
  }
}
