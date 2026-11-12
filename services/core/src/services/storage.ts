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

interface DirSizes {
  total: number;
  media: number;
  vault: number;
  measuredAt: number;
}

/**
 * Summe der Dateigrößen unter `root`, aufgeteilt nach dem ersten Pfadteil (`media`, `vault`). Symlinks werden nicht
 * verfolgt (sie zählen mit ihrer eigenen Größe), unlesbare Einträge und Dateien, die während des Durchlaufs
 * verschwinden, werden übersprungen.
 */
export async function measureDir(root: string): Promise<Omit<DirSizes, 'measuredAt'>> {
  const sizes = { total: 0, media: 0, vault: 0 };
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
      const path = join(dir, entry.name);
      const group = top ?? entry.name;
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

export interface StorageMeterOptions {
  dataDir: string;
  db: Db;
  ttlMs?: number;
  /** Höchstzeit für `pg_database_size` (ms) */
  dbTimeoutMs?: number;
  now?: () => number;
}

/** Misst Speicherplatz; die Größe des Datenordners wird höchstens alle `ttlMs` neu bestimmt. */
export class StorageMeter {
  private cache: DirSizes | null = null;
  private inflight: Promise<DirSizes> | null = null;
  private readonly ttlMs: number;
  private readonly now: () => number;

  private readonly options: StorageMeterOptions;

  constructor(options: StorageMeterOptions) {
    this.options = options;
    this.ttlMs = options.ttlMs ?? STORAGE_SIZE_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  private sizes(): Promise<DirSizes> {
    const cached = this.cache;
    if (cached && this.now() - cached.measuredAt < this.ttlMs) return Promise.resolve(cached);
    // Gleichzeitige Aufrufe teilen sich einen Durchlauf
    this.inflight ??= measureDir(this.options.dataDir)
      .then((s) => (this.cache = { ...s, measuredAt: this.now() }))
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
