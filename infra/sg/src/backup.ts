// `pnpm sg backup` (F-DAT-01, docs/VERTRAEGE.md §13): pg_dump -Fc plus inkrementelle Kopie von media/ und vault/
// nach <ziel>/<stand>/, Eintrag in `backup_run`, danach Ausdünnen nach 14/8/6.
//
// Aufbau eines Standes:
//   <ziel>/<stand>/db.dump        pg_dump -Fc
//   <ziel>/<stand>/media/…        Kopie (unveränderte Dateien als Hardlink auf den vorigen Stand)
//   <ziel>/<stand>/vault/…
//   <ziel>/<stand>/manifest.json  Prüfsumme des Dumps, Zähler (für `sg restore --test`)
// Der Lauf schreibt zuerst nach <ziel>/.<stand>.partial und benennt erst am Ende um: Ein Stand ohne Manifest gibt
// es nie unter seinem endgültigen Namen.
import { createHash, randomBytes } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { SINGLE_USER_ID } from '@sg/shared';
import {
  copyTree,
  DUMP_FILE,
  listStands,
  MANIFEST_FILE,
  removeStalePartials,
  removeStand,
  selectRetention,
  standName,
  type CopyStats,
  type Manifest,
} from './backup-files.ts';
import type { SgConfig } from './config.ts';
import { scrubSecrets, type PgAccess } from './pg.ts';

export const BACKUP_TRIGGERS = ['zeitplan', 'manuell', 'vor_migration'] as const;
export type BackupTrigger = (typeof BACKUP_TRIGGERS)[number];

/** Ein Lauf im Zustand `laeuft`, der älter ist, gilt als abgestürzt (wie im Core) */
export const STALE_RUN_HOURS = 6;

/** Tabellen, deren Zeilenzahl ins Manifest kommt (Richtwert für den Restore-Test) */
export const COUNT_TABLES = [
  'semester',
  'module',
  'slide_deck',
  'slide',
  'exercise_sheet',
  'task',
  'calendar_source',
  'calendar_event',
  'session',
  'slide_event',
  'marker',
  'photo',
  'recording',
  'audio_chunk',
  'notebook',
  'page',
  'stroke',
  'page_element',
  'sync_op',
  'setting',
  'device',
] as const;

export interface BackupIo {
  log: (message: string) => void;
  err: (message: string) => void;
}

export interface BackupDeps extends BackupIo {
  cfg: Pick<SgConfig, 'dataDir' | 'databaseUrl'>;
  pg: PgAccess;
  now?: () => Date;
  newId?: () => string;
}

export interface BackupOptions {
  trigger: BackupTrigger;
  /** Zeile, die der Core für `POST /backup` schon angelegt hat */
  runId?: string | undefined;
  /** Ziel überschreiben (sonst `data.backup_target`) */
  target?: string | undefined;
}

/** UUIDv7 (RFC 9562), ohne Zähler: ein Lauf pro Prozess */
export function uuidv7(now = Date.now()): string {
  const bytes = randomBytes(16);
  bytes[0] = Math.floor(now / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(now / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(now / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(now / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(now / 2 ** 8) & 0xff;
  bytes[5] = now & 0xff;
  bytes[6] = 0x70 | ((bytes[6] ?? 0) & 0x0f);
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function sha256File(path: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .once('error', reject)
      .once('end', () => resolveHash(hash.digest('hex')));
  });
}

export interface BackupSettings {
  target: string | null;
  encryption: boolean;
}

/** `data.backup_target` und `data.backup_encryption` aus der Tabelle `setting` */
export async function readBackupSettings(pg: PgAccess): Promise<BackupSettings> {
  const rows = await pg.query(
    `SELECT value->>'backup_target', coalesce(value->>'backup_encryption', 'false')
       FROM setting WHERE key = 'data' AND deleted_at IS NULL`,
  );
  const [row] = rows;
  const target = row?.[0] ? row[0] : null;
  return { target: target && target !== '' ? target : null, encryption: row?.[1] === 'true' };
}

/**
 * Prüft das Ziel: absoluter Pfad, nicht in `media/` oder `vault/` (sonst kopiert sich das Backup in sich selbst),
 * Ordner vorhanden oder wenigstens der Elternordner (ein nicht eingehängter Datenträger legt keinen Ordner an).
 */
export function validateTarget(target: string, dataDir: string): string {
  if (!isAbsolute(target)) throw new Error('Das Backup-Ziel muss ein absoluter Pfad sein.');
  const full = resolve(target);
  for (const sub of ['media', 'vault']) {
    const inside = relative(join(dataDir, sub), full);
    if (inside === '' || (!inside.startsWith('..') && !isAbsolute(inside))) {
      throw new Error(`Das Backup-Ziel darf nicht in „${sub}“ des Datenordners liegen.`);
    }
  }
  if (!existsSync(full)) {
    const parent = resolve(full, '..');
    if (!existsSync(parent)) {
      throw new Error('Das Backup-Ziel ist nicht vorhanden (Datenträger nicht angeschlossen?).');
    }
    mkdirSync(full);
  }
  if (!statSync(full).isDirectory()) throw new Error('Das Backup-Ziel ist kein Ordner.');
  return full;
}

export async function countObjects(pg: PgAccess, db?: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  // Vor einer Migration fehlen evtl. die Tabellen der neueren Version: nur zählen, was es gibt
  const existing = new Set(
    (await pg.query(`SELECT tablename FROM pg_tables WHERE schemaname = current_schema()`, {}, db)).map(
      (r) => r[0],
    ),
  );
  const tables = COUNT_TABLES.filter((t) => existing.has(t));
  if (tables.length === 0) return counts;
  const sql = tables.map((t) => `SELECT '${t}', count(*) FROM ${t}`).join(' UNION ALL ');
  for (const [name, n] of await pg.query(sql, {}, db)) counts[name as string] = Number(n);
  return counts;
}

/** Läufe im Zustand `laeuft`, die älter als 6 Stunden sind, gelten als abgestürzt */
async function markStaleRuns(pg: PgAccess): Promise<void> {
  await pg.query(
    `UPDATE backup_run SET state = 'fehler', finished_at = now(), updated_at = now(),
            error = 'Abgebrochen: kein Abschluss innerhalb von ${STALE_RUN_HOURS} Stunden'
      WHERE state = 'laeuft' AND started_at < now() - interval '${STALE_RUN_HOURS} hours'`,
  );
}

async function otherRunActive(pg: PgAccess, exceptId: string | null): Promise<boolean> {
  const rows = await pg.query(
    `SELECT count(*) FROM backup_run
      WHERE state = 'laeuft' AND started_at >= now() - interval '${STALE_RUN_HOURS} hours'
        AND (:'id' = '' OR id <> NULLIF(:'id', '')::uuid)`,
    { id: exceptId ?? '' },
  );
  return Number(rows[0]?.[0] ?? 0) > 0;
}

/** Fehlertext für `backup_run.error`: ohne Zugangsdaten, ohne absolute Pfade des Datenordners, höchstens 500 Zeichen */
export function errorText(error: unknown, cfg: Pick<SgConfig, 'dataDir' | 'databaseUrl'>): string {
  const raw = error instanceof Error ? error.message : String(error);
  const url = (() => {
    try {
      return new URL(cfg.databaseUrl).password;
    } catch {
      return '';
    }
  })();
  return scrubSecrets(raw, [url, decodeURIComponent(url || '')])
    .split(cfg.dataDir)
    .join('<SG_DATA_DIR>')
    .slice(0, 500);
}

/**
 * Führt ein Backup aus. Rückgabe: Exit-Code (0 = Stand angelegt, 1 = Fehler, 2 = kein Ziel/Verschlüsselung nicht
 * möglich, 4 = es läuft schon eines). Schreibt `backup_run` (neu oder die vom Core angelegte Zeile).
 */
export async function runBackup(deps: BackupDeps, options: BackupOptions): Promise<number> {
  const { cfg, pg, log, err } = deps;
  const now = deps.now ?? (() => new Date());
  let runId = options.runId ?? null;
  const fail = async (message: string, code: number): Promise<number> => {
    err(`Backup fehlgeschlagen: ${message}`);
    if (runId) {
      try {
        await pg.query(
          `UPDATE backup_run SET state = 'fehler', error = :'error', finished_at = now(), updated_at = now()
            WHERE id = :'id'::uuid AND state = 'laeuft'`,
          { id: runId, error: message },
        );
      } catch (e) {
        err(`backup_run ließ sich nicht aktualisieren: ${errorText(e, cfg)}`);
      }
    }
    return code;
  };

  try {
    await markStaleRuns(pg);
    if (!options.runId && (await otherRunActive(pg, null))) {
      err('Es läuft bereits ein Backup.');
      return 4;
    }
    const settings = await readBackupSettings(pg);
    const targetSetting = options.target ?? settings.target;

    // Zeile anlegen (oder die vom Core übernehmen), damit auch Fehler sichtbar werden
    if (runId) {
      const rows = await pg.query(`SELECT count(*) FROM backup_run WHERE id = :'id'::uuid`, { id: runId });
      if (Number(rows[0]?.[0] ?? 0) === 0) runId = null; // unbekannt: wie ein Lauf ohne Vorgabe behandeln
    }
    const started = now();
    if (!runId && targetSetting) {
      runId = (deps.newId ?? uuidv7)();
      await pg.query(
        `INSERT INTO backup_run (id, user_id, started_at, target, state, trigger)
         VALUES (:'id'::uuid, :'user'::uuid, :'started'::timestamptz, :'target', 'laeuft', :'trigger')`,
        {
          id: runId,
          user: SINGLE_USER_ID,
          started: started.toISOString(),
          target: targetSetting,
          trigger: options.trigger,
        },
      );
    }

    if (!targetSetting) return await fail('Es ist kein Backup-Ziel eingestellt (Einstellungen → Daten).', 2);
    if (settings.encryption) {
      return await fail(
        'Verschlüsselte Backups (age) sind noch nicht umgesetzt. Schalte „Backup verschlüsseln“ aus, um unverschlüsselt zu sichern.',
        2,
      );
    }

    const target = validateTarget(targetSetting, cfg.dataDir);
    const stand = standName(started);
    const finalDir = join(target, stand);
    const partial = join(target, `.${stand}.partial`);
    if (existsSync(finalDir)) throw new Error(`Der Stand ${stand} gibt es schon.`);
    rmSync(partial, { recursive: true, force: true });
    mkdirSync(partial, { recursive: true });

    try {
      const previous = listStands(target)[0] ?? null;
      log(`Backup ${stand} nach ${target} (${options.trigger}) …`);

      log('Sichere die Datenbank (pg_dump) …');
      const dumpFile = join(partial, DUMP_FILE);
      await pg.dump(dumpFile);
      const dumpBytes = statSync(dumpFile).size;
      if (dumpBytes === 0) throw new Error('pg_dump hat keine Daten geliefert.');
      const dumpSha = await sha256File(dumpFile);
      const counts = await countObjects(pg);
      const [version] = await pg.query(`SHOW server_version`);

      const stats: Record<'media' | 'vault', CopyStats> = {
        media: { files: 0, bytes: 0, linked: 0, copied: 0 },
        vault: { files: 0, bytes: 0, linked: 0, copied: 0 },
      };
      for (const sub of ['media', 'vault'] as const) {
        const source = join(cfg.dataDir, sub);
        if (!existsSync(source)) continue;
        log(`Kopiere ${sub}/ …`);
        copyTree(source, join(partial, sub), previous ? join(target, previous, sub) : null, stats[sub]);
        log(
          `  ${stats[sub].files} Dateien, ${stats[sub].copied} neu kopiert, ${stats[sub].linked} unverändert`,
        );
      }

      const manifest: Manifest = {
        version: 1,
        stand,
        created_at: started.toISOString(),
        trigger: options.trigger,
        pg_server_version: version?.[0] ?? null,
        dump: { file: DUMP_FILE, bytes: dumpBytes, sha256: dumpSha },
        counts,
        media: { files: stats.media.files, bytes: stats.media.bytes },
        vault: { files: stats.vault.files, bytes: stats.vault.bytes },
      };
      writeFileSync(join(partial, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
      renameSync(partial, finalDir);
      const size = dumpBytes + stats.media.bytes + stats.vault.bytes;

      if (runId) {
        await pg.query(
          `UPDATE backup_run SET state = 'fertig', finished_at = now(), updated_at = now(), error = NULL,
                  size_bytes = :'size'::bigint, stand = :'stand'
            WHERE id = :'id'::uuid`,
          { id: runId, size: String(size), stand },
        );
      }
      log(`Backup ${stand} fertig (${size} Bytes).`);
    } catch (error) {
      rmSync(partial, { recursive: true, force: true });
      throw error;
    }

    // Ausdünnen erst nach einem erfolgreichen Lauf, Fehler dabei machen das Backup nicht ungültig
    try {
      thin(target, now().getTime(), log);
    } catch (error) {
      err(`Ausdünnen alter Stände fehlgeschlagen: ${errorText(error, cfg)}`);
    }
    return 0;
  } catch (error) {
    return fail(errorText(error, cfg), 1);
  }
}

/** Alte Stände nach 14/8/6 entfernen und alte `.partial`-Ordner (älter als 1 Tag) aufräumen */
export function thin(target: string, nowMs: number, log: (message: string) => void = () => {}): string[] {
  removeStalePartials(target, nowMs, 86_400_000);
  const { remove } = selectRetention(listStands(target));
  const removed: string[] = [];
  for (const stand of remove) {
    if (removeStand(target, stand)) {
      removed.push(stand);
      log(`Alten Stand ${stand} entfernt.`);
    }
  }
  return removed;
}
