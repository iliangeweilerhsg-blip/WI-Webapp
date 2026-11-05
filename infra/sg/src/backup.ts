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
import { createReadStream, existsSync, lstatSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SINGLE_USER_ID } from '@sg/shared';
import { checkBackupTarget } from '@sg/shared/backup-target';
import {
  copyTree,
  DUMP_FILE,
  listStands,
  MANIFEST_FILE,
  readManifest,
  removeStalePartials,
  removeStand,
  selectRetention,
  standName,
  type CopyStats,
  type Manifest,
} from './backup-files.ts';
import type { SgConfig } from './config.ts';
import { removeRunPids, runLiveness, sweepDeadRunPids, writeRunPid } from './liveness.ts';
import { NoFollowReader, NoFollowWriter, type NoFollowHooks } from './nofollow.ts';
import { scrubSecrets, type PgAccess } from './pg.ts';
import { copyAndHash, makePrivateDir } from './staging.ts';

export const BACKUP_TRIGGERS = ['zeitplan', 'manuell', 'vor_migration'] as const;
export type BackupTrigger = (typeof BACKUP_TRIGGERS)[number];

/** Ein Lauf im Zustand `laeuft`, der älter ist, gilt als abgestürzt (wie im Core) */
export const STALE_RUN_HOURS = 6;
/** Ein Restore-Test im Zustand `laeuft`, der älter ist, gilt als abgebrochen (wie im Core) */
export const RESTORE_TEST_STALE_HOURS = 2;
/** Name der PID-Datei des automatischen Restore-Tests (`liveness.ts`) */
export const RESTORE_TEST_PID_NAME = 'restore-test';

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
  // Moodle-Abgleich (T1-23, 08 §9.4)
  'moodle_course_link',
  'moodle_item',
  'moodle_deadline',
  // Automatische Kurszuordnung (#141)
  'moodle_course_decided',
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
  /** Lebt dieser Prozess noch? (Tests; Standard: `process.kill(pid, 0)`) */
  alive?: (pid: number) => boolean;
  /** Nur für Tests: läuft direkt nachdem der Dump ins Ziel kopiert wurde (Austausch durch einen Angreifer) */
  hooks?: { afterDumpCopy?: (destination: string) => void | Promise<void> };
  /** Nur für Tests: Tausch zwischen Prüfung und Systemaufruf im Ziel (`NoFollowWriter`) */
  targetHooks?: NoFollowHooks;
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
 * Prüft das Ziel mit der gemeinsamen Regel aus `@sg/shared/backup-target` (wie `PATCH /settings`): absoluter Pfad,
 * Symlinks aufgelöst, nicht im Datenordner (auch nicht in `media/` oder `vault/`: sonst kopiert sich das Backup in
 * sich selbst), kein Systemordner. Ein fehlender Ordner wird angelegt, wenn der Elternordner existiert (ein nicht eingehängter
 * Datenträger legt keinen Ordner an).
 */
export function validateTarget(target: string, dataDir: string): string {
  return checkBackupTarget(target, dataDir, { createMissing: true });
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

/** Angewendete Migrationen (Schemaversion des Dumps), `null` wenn die Tabelle fehlt */
export async function migrationCount(pg: PgAccess, db?: string): Promise<number | null> {
  const [has] = await pg.query(`SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL`, {}, db);
  if (has?.[0] !== 't') return null;
  const [n] = await pg.query(`SELECT count(*) FROM drizzle.__drizzle_migrations`, {}, db);
  return Number(n?.[0] ?? 0);
}

/**
 * Läuft gerade ein Restore-Test? (Schlüssel `restore_test`, älter als 2 Stunden gilt als abgestürzt, wie im Core.)
 * Rückgabe: `started_at` des laufenden Tests oder `null`. Lebt der Prozess des Tests nachweislich nicht mehr
 * (PID-Datei, `liveness.ts`), wird der Eintrag sofort auf `fehler`/`abgebrochen` gesetzt und blockiert nicht (#113).
 */
export async function runningRestoreTest(
  pg: PgAccess,
  dataDir: string,
  alive?: (pid: number) => boolean,
): Promise<string | null> {
  const rows = await pg.query(
    `SELECT value->>'started_at' FROM setting
      WHERE key = 'restore_test' AND deleted_at IS NULL AND value->>'state' = 'laeuft'
        AND (value->>'started_at')::timestamptz > now() - interval '${RESTORE_TEST_STALE_HOURS} hours'`,
  );
  const started = rows[0]?.[0];
  if (started === undefined) return null;
  if (runLiveness(dataDir, RESTORE_TEST_PID_NAME, started, alive) !== 'tot') return started;
  // Nur genau diesen Lauf beenden (gleicher Beginn, noch `laeuft`): ein inzwischen neu gestarteter bleibt
  await pg.query(
    `UPDATE setting SET value = value || :'patch'::jsonb, updated_at = now()
      WHERE key = 'restore_test' AND deleted_at IS NULL AND value->>'state' = 'laeuft'
        AND value->>'started_at' = :'started'`,
    {
      started,
      patch: JSON.stringify({
        state: 'fehler',
        finished_at: new Date().toISOString(),
        reason: 'abgebrochen',
        error: 'Der Restore-Test wurde unterbrochen (der Prozess lebt nicht mehr, etwa nach einem Absturz).',
      }),
    },
  );
  removeRunPids(dataDir, RESTORE_TEST_PID_NAME, started);
  return null;
}

export const RESTORE_TEST_RUNNING_MESSAGE =
  'Es läuft gerade ein Restore-Test. Backup und Restore-Test laufen nie gleichzeitig (das Ausdünnen könnte den getesteten Stand löschen). Versuche es in ein paar Minuten erneut.';

/** Meldung mit Ausweg: wann der Eintrag spätestens als abgebrochen gilt */
export function restoreTestRunningMessage(startedAt: string): string {
  const until = new Date(Date.parse(startedAt) + RESTORE_TEST_STALE_HOURS * 3600_000);
  const when = Number.isNaN(until.getTime())
    ? `${RESTORE_TEST_STALE_HOURS} Stunden nach dem Start`
    : until.toLocaleString('de-CH');
  return `${RESTORE_TEST_RUNNING_MESSAGE} Läuft keiner mehr (etwa nach einem Absturz, ohne dass sich das feststellen ließ), gilt der Test spätestens ab ${when} als abgebrochen. Vor einer Migration hilft sofort: "pnpm sg migrate --ohne-backup".`;
}

/** Läufe im Zustand `laeuft`, die älter als 6 Stunden sind, gelten als abgestürzt */
async function markStaleRuns(pg: PgAccess): Promise<void> {
  await pg.query(
    `UPDATE backup_run SET state = 'fehler', finished_at = now(), updated_at = now(),
            error = 'Abgebrochen: kein Abschluss innerhalb von ${STALE_RUN_HOURS} Stunden'
      WHERE state = 'laeuft' AND started_at < now() - interval '${STALE_RUN_HOURS} hours'`,
  );
}

/**
 * Läuft schon ein anderes Backup? Läufe, deren Prozess nachweislich nicht mehr lebt (PID-Datei), werden dabei
 * sofort als abgebrochen eingetragen und zählen nicht (#113).
 */
async function otherRunActive(
  pg: PgAccess,
  exceptId: string | null,
  dataDir: string,
  alive?: (pid: number) => boolean,
): Promise<boolean> {
  const rows = await pg.query(
    `SELECT id FROM backup_run
      WHERE state = 'laeuft' AND started_at >= now() - interval '${STALE_RUN_HOURS} hours'
        AND (:'id' = '' OR id <> NULLIF(:'id', '')::uuid)`,
    { id: exceptId ?? '' },
  );
  let active = 0;
  for (const [id] of rows) {
    if (!id) continue;
    if (runLiveness(dataDir, `backup-${id}`, id, alive) !== 'tot') {
      active += 1;
      continue;
    }
    await pg.query(
      `UPDATE backup_run SET state = 'fehler', finished_at = now(), updated_at = now(),
              error = 'Abgebrochen: der Backup-Prozess lebt nicht mehr (etwa nach einem Absturz)'
        WHERE id = :'id'::uuid AND state = 'laeuft'`,
      { id },
    );
    removeRunPids(dataDir, `backup-${id}`, id);
  }
  return active > 0;
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

  let removePid = (): void => {};
  try {
    await markStaleRuns(pg);
    const testStarted = await runningRestoreTest(pg, cfg.dataDir, deps.alive);
    if (testStarted !== null) {
      const message = restoreTestRunningMessage(testStarted);
      // Mit Zeile vom Core: als Fehler eintragen, damit „läuft“ nicht stehen bleibt
      if (runId) return await fail(message, 4);
      err(message);
      return 4;
    }
    if (!options.runId && (await otherRunActive(pg, null, cfg.dataDir, deps.alive))) {
      err(
        `Es läuft bereits ein Backup. Läuft keines mehr (etwa nach einem Absturz, ohne dass sich das feststellen ließ), gilt es spätestens ${STALE_RUN_HOURS} Stunden nach seinem Start als abgebrochen. Vor einer Migration hilft sofort: "pnpm sg migrate --ohne-backup".`,
      );
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

    // Nach den Prüfungen oben braucht kein `laeuft` mehr die Dateien toter Prozesse: verwaiste aufräumen (H2)
    sweepDeadRunPids(cfg.dataDir, deps.alive);
    // PID-Datei: stürzt dieser Prozess ab, erkennt der nächste Lauf das sofort statt erst nach 6 Stunden
    if (runId) removePid = writeRunPid(cfg.dataDir, `backup-${runId}`, runId);

    if (!targetSetting) return await fail('Es ist kein Backup-Ziel eingestellt (Einstellungen → Daten).', 2);
    if (settings.encryption) {
      return await fail(
        'Verschlüsselte Backups (age) sind noch nicht umgesetzt. Wähle in den Einstellungen → Daten „Ohne Verschlüsselung sichern“, um unverschlüsselt zu sichern.',
        2,
      );
    }

    const target = validateTarget(targetSetting, cfg.dataDir);
    const stand = standName(started);
    const finalDir = join(target, stand);
    const partial = join(target, `.${stand}.partial`);
    // Das Ziel ist nicht vertrauenswürdig (#113): nichts darin wird überschrieben oder über einen Symlink erreicht.
    // Ein schon vorhandener Stand oder `.partial` gleichen Namens lässt den Lauf scheitern, gelöscht wird dabei nichts.
    if (lstatSync(finalDir, { throwIfNoEntry: false })) throw new Error(`Den Stand ${stand} gibt es schon.`);
    const out = new NoFollowWriter(deps.targetHooks);
    out.adopt(target);
    out.mkdir(partial);

    try {
      const previous = listStands(target)[0] ?? null;
      log(`Backup ${stand} nach ${target} (${options.trigger}) …`);

      log('Sichere die Datenbank (pg_dump) …');
      // Der Dump entsteht in einem privaten Ordner, nicht im Ziel: Dort kann ihn niemand austauschen, während
      // `pg_dump` schreibt. Die Prüfsumme (`dump_sha256`, Manifest) entsteht aus genau diesen Bytes. Das Ziel
      // bekommt nur eine Kopie; wird sie dort verändert, stimmt die Prüfsumme nicht mehr und der Stand wird
      // nie eingespielt (VERTRAEGE §13).
      const dumpFile = join(partial, DUMP_FILE);
      const { bytes: dumpBytes, sha: dumpSha } = await dumpPrivately(deps, dumpFile, out);
      const counts = await countObjects(pg);
      const [version] = await pg.query(`SHOW server_version`);
      const migrations = await migrationCount(pg);

      const stats: Record<'media' | 'vault', CopyStats> = {
        media: { files: 0, bytes: 0, linked: 0, copied: 0, vanished: 0 },
        vault: { files: 0, bytes: 0, linked: 0, copied: 0, vanished: 0 },
      };
      // Gelesen wird verankert (#119): der Datenordner als vertrauenswürdige Quelle (Verschwundenes zählt nur), der
      // vorige Stand im Ziel ohne Symlink-Folgen. Nur Dateien, die dort genau so liegen, werden verlinkt.
      const reader = new NoFollowReader(deps.targetHooks, true);
      reader.adopt(target);
      const previousDir = previous ? reader.child(target, previous, 'skip') : null;
      for (const sub of ['media', 'vault'] as const) {
        const source = join(cfg.dataDir, sub);
        if (!existsSync(source)) continue;
        log(`Kopiere ${sub}/ …`);
        reader.adopt(source);
        let prevSub: string | null = null;
        try {
          prevSub = previousDir ? reader.child(previousDir, sub, 'skip') : null;
        } catch {
          prevSub = null; // voriger Stand nicht lesbar: alles kopieren
        }
        copyTree(source, join(partial, sub), prevSub, stats[sub], { out, reader });
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
        migrations,
        dump: { file: DUMP_FILE, bytes: dumpBytes, sha256: dumpSha },
        counts,
        media: { files: stats.media.files, bytes: stats.media.bytes },
        vault: { files: stats.vault.files, bytes: stats.vault.bytes },
      };
      out.writeFile(join(partial, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
      out.renameDir(partial, finalDir);
      const size = dumpBytes + stats.media.bytes + stats.vault.bytes;

      if (runId) {
        await pg.query(
          `UPDATE backup_run SET state = 'fertig', finished_at = now(), updated_at = now(), error = NULL,
                  size_bytes = :'size'::bigint, stand = :'stand', dump_sha256 = :'sha'
            WHERE id = :'id'::uuid`,
          { id: runId, size: String(size), stand, sha: dumpSha },
        );
      }
      log(`Backup ${stand} fertig (${size} Bytes).`);
    } catch (error) {
      // Nur Eigenes entfernen, nie einem Symlink folgend; Fremdes bleibt liegen (Ausdünnen räumt alte .partial weg)
      const left = out.cleanup();
      if (left.length > 0) {
        err(
          `Im Ziel bleiben ${left.length} Einträge liegen, die nicht von diesem Lauf stammen oder ersetzt wurden.`,
        );
      }
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
    return await fail(errorText(error, cfg), 1);
  } finally {
    removePid();
  }
}

/**
 * `pg_dump` in einen privaten Ordner (0700 im Datenordner), dabei Prüfsumme bilden, dann ins Ziel kopieren.
 * Der private Ordner wird immer gelöscht.
 */
async function dumpPrivately(
  deps: Pick<BackupDeps, 'cfg' | 'pg' | 'hooks'>,
  destination: string,
  out: NoFollowWriter,
): Promise<{ bytes: number; sha: string }> {
  const dir = makePrivateDir(deps.cfg.dataDir, 'backup');
  try {
    const privateDump = join(dir, DUMP_FILE);
    await deps.pg.dump(privateDump);
    const bytes = statSync(privateDump).size;
    if (bytes === 0) throw new Error('pg_dump hat keine Daten geliefert.');
    // Eine Lesung: die Kopie ins Ziel und ihre Prüfsumme stammen aus denselben Bytes. Die Datei im Ziel wird danach
    // nie wieder gelesen (sie kann dort jederzeit ausgetauscht werden, B2).
    const sha = await copyAndHash(privateDump, destination, () => out.openNew(destination, 0o600));
    await deps.hooks?.afterDumpCopy?.(destination);
    return { bytes, sha };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** So viele Stände vor Migrationen bleiben unabhängig von der Ausdünnung erhalten */
export const KEEP_PRE_MIGRATION = 3;

/**
 * Alte Stände nach 14/8/6 entfernen und alte `.partial`-Ordner (älter als 1 Tag) aufräumen.
 * Die letzten 3 Stände mit `trigger = vor_migration` bleiben zusätzlich immer erhalten.
 */
export function thin(target: string, nowMs: number, log: (message: string) => void = () => {}): string[] {
  removeStalePartials(target, nowMs, 86_400_000);
  const stands = listStands(target); // neueste zuerst
  const protectedStands = new Set(
    stands
      .filter((s) => readManifest(join(target, s))?.trigger === 'vor_migration')
      .slice(0, KEEP_PRE_MIGRATION),
  );
  const { remove } = selectRetention(stands);
  const removed: string[] = [];
  for (const stand of remove) {
    if (protectedStands.has(stand)) continue;
    const result = removeStand(target, stand);
    if (result === true) {
      removed.push(stand);
      log(`Alten Stand ${stand} entfernt.`);
    } else if (result === 'teilweise') {
      log(
        `Alten Stand ${stand} nicht vollständig entfernt: Im Ziel wurde während des Löschens etwas ausgetauscht. Der Rest bleibt stehen.`,
      );
    }
  }
  return removed;
}
