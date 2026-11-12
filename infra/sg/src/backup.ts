// `pnpm sg backup` (F-DAT-01, docs/VERTRAEGE.md §13): pg_dump -Fc plus inkrementelle Kopie von media/ und vault/
// nach <ziel>/<stand>/, Eintrag in `backup_run`, danach Ausdünnen nach 14/8/6.
//
// Aufbau eines Standes:
//   <ziel>/<stand>/db.dump        pg_dump -Fc
//   <ziel>/<stand>/media/…        Kopie (unveränderte Dateien als Hardlink auf den vorigen Stand)
//   <ziel>/<stand>/vault/…
//   <ziel>/<stand>/manifest.json  Prüfsumme des Dumps, Zähler (für `sg restore --test`)
// **Nicht** im Stand (UX-12, Plan E3): `secrets/` (Tunnel-Schlüssel je Gerät, `secrets/tunnel-keys.json`) und `run/`. Ein
// Stand enthält nur die Datenbank, `media/` und `vault/`. Wer das ändert, muss `test/backup.test.ts` („Tunnel-Schlüssel
// gehören nie ins Backup“) bewusst anpassen: Ein Backup mit Schlüsseln erlaubte, sich als Mac auszugeben.
// Der Lauf schreibt zuerst nach <ziel>/.<stand>.partial und benennt erst am Ende um: Ein Stand ohne Manifest gibt
// es nie unter seinem endgültigen Namen.
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, existsSync, lstatSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SINGLE_USER_ID } from '@sg/shared';
import { checkBackupTarget } from '@sg/shared/backup-target';
import {
  copyTree,
  describeLeft,
  DUMP_FILE,
  plainCause,
  rootCause,
  listStands,
  MANIFEST_FILE,
  readManifest,
  readManifestAt,
  removeStalePartialsReport,
  removeStandReport,
  ownedByThisUser,
  ownedDir,
  selectRetention,
  STAND_RE,
  standName,
  targetOwner,
  type CopyStats,
  type Manifest,
  type TargetDir,
} from './backup-files.ts';
import type { SgConfig } from './config.ts';
import { removeRunPids, runLiveness, sweepDeadRunPids, writeRunPid } from './liveness.ts';
import { NoFollowReader, NoFollowWriter, UnsafeTargetError, type NoFollowHooks } from './nofollow.ts';
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
  // Transkript und Rückblick (T2-01, VERTRAEGE §18.1)
  'transcript',
  'transcript_segment',
  'slide_segment',
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
  hooks?: {
    afterDumpCopy?: (destination: string) => void | Promise<void>;
    /** Nur für Tests: läuft direkt nach `validateTarget` (Tausch des Ziels nach der Prüfung, H2) */
    afterValidate?: (target: string) => void;
  };
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
 * Datenträger legt keinen Ordner an). `writable = false` (Restore) verlangt kein Schreibrecht: ein schreibgeschütztes
 * Ziel bleibt lesbar.
 *
 * Rückgabe: aufgelöster Pfad und Identität (`dev`/`ino` per `lstat`, H2 aus #124). Der ganze Lauf verankert das Ziel
 * mit genau dieser Identität (Schreiben, Lesen, Ausdünnen): Wird es danach ausgetauscht, scheitert jeder Zugriff,
 * statt in einem anderen Ordner zu schreiben oder zu löschen.
 */
export function validateTarget(
  target: string,
  dataDir: string,
  createMissing = true,
  writable = true,
): TargetDir {
  const path = checkBackupTarget(target, dataDir, { createMissing, writable });
  const info = lstatSync(path);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new UnsafeTargetError(`${path} wurde nach der Prüfung ersetzt. Der Lauf bricht ab.`);
  }
  return { path, dev: info.dev, ino: info.ino };
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

    const targetDir = validateTarget(targetSetting, cfg.dataDir);
    deps.hooks?.afterValidate?.(targetDir.path);
    const target = targetDir.path;
    const stand = standName(started);
    const finalDir = join(target, stand);
    const partial = join(target, `.${stand}.partial`);
    // Das Ziel ist nicht vertrauenswürdig (#113): nichts darin wird überschrieben oder über einen Symlink erreicht.
    // Ein schon vorhandener Stand oder `.partial` gleichen Namens lässt den Lauf scheitern, gelöscht wird dabei nichts.
    if (lstatSync(finalDir, { throwIfNoEntry: false })) throw new Error(`Den Stand ${stand} gibt es schon.`);
    const out = new NoFollowWriter(deps.targetHooks);
    out.adopt(target, targetDir);
    const created = out.mkdir(partial);
    let owner: number | undefined;

    try {
      // Eigen ist im Ziel, was den Besitzer des eigenen `.partial` hat (#183), nicht zwingend den Benutzer des Laufs.
      // `targetOwner` prüft per Probedatei, dass das `.partial` nicht beim Anlegen getauscht wurde.
      owner = targetOwner(out, partial, created);
      out.owner = owner;
      // Voriger Stand für Hardlinks: nur ein eigener (H-1, #161). Ein erfundener Stand im Ziel darf nie die Quelle
      // sein, sonst verlinkt der neue Stand Dateien, die einem Dritten gehören.
      let previous: string | null = null;
      try {
        previous = ownStandsIn(target, await readOwnedStands(pg, targetSetting), undefined, owner)[0] ?? null;
      } catch (error) {
        err(
          `Die eigenen Stände ließen sich nicht aus backup_run lesen (${errorText(error, cfg)}). Es wird ohne Hardlinks vollständig kopiert.`,
        );
      }
      log(`Backup ${stand} nach ${target} (${options.trigger}) …`);
      const runUid = process.getuid?.();
      if (owner !== undefined && owner !== runUid) log(foreignOwnerNote(owner, runUid));

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
      reader.adopt(target, targetDir);
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
        copyTree(source, join(partial, sub), prevSub, stats[sub], { out, reader, owner });
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
    // Gezählt und gelöscht werden nur eigene Stände laut `backup_run` (H-1, #161), der neue Stand nie
    let thinned: ThinResult | null = null;
    try {
      const owned = await readOwnedStands(pg, targetSetting);
      thinned = thin(targetDir, { owned, current: stand, owner }, now().getTime(), log, deps.targetHooks);
    } catch (error) {
      err(`Ausdünnen alter Stände fehlgeschlagen: ${errorText(error, cfg)}`);
    }
    const ownerWarn = thinned ? foreignOwnerWarning(thinned.foreign ?? []) : null;
    if (ownerWarn) err(`Warnung: ${ownerWarn}`);
    if (runId && thinned) await recordLeftovers(deps, runId, targetSetting, thinned.left, ownerWarn);
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

/** Ein eigener Stand laut `backup_run` (H-1, #161) */
export interface OwnedStand {
  trigger: string;
  /** `backup_run.dump_sha256`, `null` bei Läufen vor Migration 0004 */
  sha256: string | null;
}

/** Eigene Stände eines Ziels: Standname → Lauf */
export type OwnedStands = ReadonlyMap<string, OwnedStand>;

/**
 * Stände, die nachweislich von uns stammen (H-1, #161): Läufe in `backup_run` mit `state = fertig`, genau diesem Ziel
 * (`target` wie in der Einstellung) und `stand`. Die Datenbank ist die Vertrauensquelle (VERTRAEGE §13), das Ziel
 * nicht: Wer dort nur Ordner anlegen kann, soll mit erfundenen Ständen weder die Aufbewahrung belegen noch den
 * „vorigen Stand“ für Hardlinks stellen können.
 */
export async function readOwnedStands(pg: PgAccess, targetSetting: string): Promise<OwnedStands> {
  const rows = await pg.query(
    `SELECT stand, trigger, coalesce(dump_sha256, '') FROM backup_run
      WHERE state = 'fertig' AND deleted_at IS NULL AND stand IS NOT NULL AND target = :'target'`,
    { target: targetSetting },
  );
  const owned = new Map<string, OwnedStand>();
  for (const [stand, trigger, sha] of rows) {
    if (!stand || !STAND_RE.test(stand)) continue;
    owned.set(stand, { trigger: trigger ?? '', sha256: sha ? sha : null });
  }
  return owned;
}

/**
 * Eigene Stände im Ziel, neueste zuerst: Ordner mit gültigem Manifest (`listStands`), zu dem es einen eigenen Lauf
 * gibt. Das Manifest muss diesen Stand nennen und, wenn der Lauf eine Prüfsumme hat, genau diese tragen. Ein
 * ausgetauschter oder umbenannter Ordner unter einem eigenen Namen zählt so nicht als eigener Stand.
 * `owner`: Besitzer eigener Ordner im Ziel (`targetOwner`, #183), ohne Angabe der Benutzer dieses Prozesses.
 */
export function ownStandsIn(
  base: string,
  owned: OwnedStands,
  stands = listStands(base),
  owner?: number,
): string[] {
  return classifyStands(base, owned, stands, owner).own;
}

/**
 * Wie `ownStandsIn`, dazu `foreign` (#183): Stände, zu denen Lauf und Manifest passen, deren Ordner aber einen anderen
 * Besitzer als `owner` hat. Sie zählen nicht als eigen (ein fremder Ordner mit kopiertem Manifest sieht genauso aus),
 * werden aber gemeldet: Stammen sie doch aus eigenen Läufen (früher als anderer Benutzer, per `sudo`, mit anderen
 * Einhängeoptionen), werden sie nie ausgedünnt und das Ziel läuft voll.
 */
export function classifyStands(
  base: string,
  owned: OwnedStands,
  stands: string[],
  owner?: number,
): { own: string[]; foreign: string[] } {
  const own: string[] = [];
  const foreign: string[] = [];
  for (const stand of stands) {
    const dir = join(base, stand);
    if (!matchesOwnRun(owned, stand, readManifest(dir))) continue;
    // Ein Ordner eines anderen Benutzers mit kopiertem Manifest unter dem Namen eines eigenen Standes (der echte wurde
    // weggeschoben) ist kein eigener Stand: Er würde sonst zur Hardlink-Quelle oder beim Ausdünnen samt Inhalt gelöscht.
    if (ownedByThisUser(dir, owner)) own.push(stand);
    else foreign.push(stand);
  }
  return { own, foreign };
}

/** Log: Das Ziel meldet für eigene Ordner einen anderen Besitzer als den Benutzer des Laufs (#183) */
export function foreignOwnerNote(owner: number, runUid: number | undefined): string {
  return (
    `Das Backup-Ziel meldet für Ordner, die dieser Lauf anlegt, den Besitzer uid ${owner}, der Lauf selbst läuft als ` +
    `uid ${runUid ?? '?'} (etwa eine SMB-/CIFS-Freigabe ohne uid= oder ein Lauf per sudo auf NFS mit root_squash). ` +
    `Als eigene Stände gelten darum Ordner mit uid ${owner}. Meldet das Ziel für alle Ordner diesen Besitzer, ` +
    `unterscheidet sg backup dort eigene nicht von fremden Ordnern; dann schützen nur backup_run und die Prüfsumme im Manifest.`
  );
}

/**
 * Warnung für die Oberfläche (`backup_run.warning`), wenn Stände eigener Läufe einen anderen Besitzer haben als die
 * Ordner dieses Laufs (#183, `classifyStands`). `null`: keine.
 */
export function foreignOwnerWarning(foreign: string[]): string | null {
  if (foreign.length === 0) return null;
  const what =
    foreign.length === 1
      ? 'Ein Backup-Stand im Ziel gehört'
      : `${foreign.length} Backup-Stände im Ziel gehören`;
  return (
    `${what} einem anderen Benutzer als die neuen Stände, etwa nach einem Lauf per sudo oder einer geänderten ` +
    `Freigabe. Solche Stände werden weder ausgedünnt noch für unveränderte Dateien genutzt, jeder Lauf kopiert ` +
    `dann alles und das Ziel kann volllaufen. Prüfe die Besitzer der Ordner im Backup-Ziel.`
  );
}

/** Nennt `manifest` den Stand `stand`, gibt es dazu einen eigenen Lauf, und trägt es (falls bekannt) dessen Prüfsumme? */
function matchesOwnRun(owned: OwnedStands, stand: string, manifest: Manifest | null): boolean {
  const run = owned.get(stand);
  if (!run || !manifest || manifest.stand !== stand) return false;
  return run.sha256 === null || manifest.dump.sha256 === run.sha256;
}

/** Was beim Ausdünnen als eigen gilt (H-1, #161) */
export interface ThinOwnership {
  /** Eigene Stände laut `backup_run` (`readOwnedStands`) */
  owned: OwnedStands;
  /** Der Stand des laufenden Backups: wird nie gelöscht */
  current?: string;
  /** Besitzer eigener Ordner im Ziel (`targetOwner`, #183); ohne Angabe der Benutzer dieses Prozesses */
  owner?: number | undefined;
}

/** So viele Stände vor Migrationen bleiben unabhängig von der Ausdünnung erhalten */
export const KEEP_PRE_MIGRATION = 3;

/** Ein Stand oder `.partial`, der beim Ausdünnen stehen blieb (H3, #124) */
export interface Leftover {
  name: string;
  /** Ursache mit Eintrag, für das Log (mit Fehlercode) */
  reason: string;
  /** Ursache als Code (`EACCES`, `getauscht`, …), daraus der Text der Oberfläche */
  cause: string;
}

export interface ThinResult {
  removed: string[];
  left: Leftover[];
  /** Stände eigener Läufe mit anderem Besitzer als `own.owner` (#183): nicht ausgedünnt (fehlt, wenn keine) */
  foreign?: string[];
}

/**
 * Alte Stände nach 14/8/6 entfernen und alte `.partial`-Ordner (älter als 1 Tag) aufräumen.
 * Die letzten 3 Stände mit `trigger = vor_migration` bleiben zusätzlich immer erhalten.
 * Gezählt und gelöscht werden nur eigene Stände (`own`, H-1 aus #161): Ordner ohne eigenen Lauf in `backup_run`
 * bleiben unangetastet und belegen keinen Platz in der Aufbewahrung. `own.current` wird nie gelöscht.
 * Das Ziel wird mit der Identität aus `validateTarget` verankert (H2). Rückgabe: entfernte Stände und Reste, die
 * stehen blieben, mit ihrer tatsächlichen Ursache (H3).
 */
export function thin(
  target: TargetDir,
  own: ThinOwnership,
  nowMs: number,
  log: (message: string) => void = () => {},
  hooks?: NoFollowHooks,
): ThinResult {
  const base = target.path;
  const result: ThinResult = { removed: [], left: [] };
  const partials = removeStalePartialsReport(target, nowMs, 86_400_000, hooks, own.owner);
  for (const { name, left } of partials.left) {
    const reason = describeLeft(left, join(base, name));
    result.left.push({ name, reason, cause: rootCause(left)?.cause ?? 'unbekannt' });
    log(`Alten halbfertigen Lauf ${name} nicht vollständig entfernt: ${reason}. Der Rest bleibt stehen.`);
  }
  for (const { name, why } of partials.kept) {
    log(
      why === 'manifest'
        ? `Halbfertiger Lauf ${name} enthält ein Manifest (etwa ein umbenannter Stand) und wird nicht gelöscht. Prüfe das Backup-Ziel.`
        : `Der Ordner ${name} gehört einem anderen Benutzer, stammt also nicht aus sg backup, und wird nicht gelöscht. Prüfe das Backup-Ziel.`,
    );
  }
  const all = listStands(base); // neueste zuerst
  const { own: stands, foreign } = classifyStands(base, own.owned, all, own.owner);
  if (all.length > stands.length) {
    log(
      `${all.length - stands.length} Ordner im Ziel sehen wie Stände aus, gehören aber zu keinem eigenen Backup-Lauf. Sie zählen nicht zur Aufbewahrung und werden nicht gelöscht.`,
    );
  }
  if (foreign.length > 0) {
    result.foreign = foreign;
    const owner = own.owner ?? process.getuid?.();
    const shown =
      foreign.slice(0, 5).join(', ') + (foreign.length > 5 ? ` und ${foreign.length - 5} weitere` : '');
    log(
      `${foreign.length} davon passen zu eigenen Läufen in backup_run, ihr Ordner gehört aber einem anderen Benutzer als die Ordner dieses Laufs (uid ${owner ?? '?'}): ${shown}. ` +
        `Ursache ist meist ein früherer Lauf als anderer Benutzer (etwa per sudo) oder eine geänderte Freigabe, es kann aber auch ein fremder Ordner unter dem Namen eines Standes sein. ` +
        `Diese Stände werden weder ausgedünnt noch für Hardlinks genutzt, jeder Lauf kopiert darum alles vollständig. Prüfe die Besitzer im Backup-Ziel.`,
    );
  }
  const protectedStands = new Set(
    stands.filter((s) => own.owned.get(s)?.trigger === 'vor_migration').slice(0, KEEP_PRE_MIGRATION),
  );
  if (own.current) protectedStands.add(own.current);
  const { remove } = selectRetention(stands);
  for (const stand of remove) {
    if (protectedStands.has(stand)) continue;
    // Unmittelbar vor dem Löschen erneut prüfen und das Löschen an genau diesen Ordner binden (TOCTOU, H-1 aus #161):
    // Schiebt jemand während des Ausdünnens einen Stand, der bleiben soll, unter diesen Namen, bleibt er stehen.
    // Das Manifest wird in genau dem geprüften Ordner gelesen (`readManifestAt`), nicht erneut über den Namen.
    const seen = ownedDir(join(base, stand), own.owner);
    if (!seen || !matchesOwnRun(own.owned, stand, readManifestAt(target, stand, seen, hooks))) {
      log(
        `Der Stand ${stand} hat sich während des Ausdünnens verändert und wird nicht gelöscht. Prüfe das Backup-Ziel.`,
      );
      continue;
    }
    const report = removeStandReport(target, stand, hooks, seen);
    if (report.status === true) {
      result.removed.push(stand);
      log(`Alten Stand ${stand} entfernt.`);
    } else if (report.status === 'teilweise') {
      const reason = describeLeft(report.left, join(base, stand));
      result.left.push({ name: stand, reason, cause: rootCause(report.left)?.cause ?? 'unbekannt' });
      log(
        `Alten Stand ${stand} nicht vollständig entfernt: ${reason}. Der Rest bleibt stehen, der nächste Lauf versucht es erneut.`,
      );
    }
  }
  return result;
}

/** Höchstlänge von `backup_run.warning` (wie `error`) */
const WARNING_MAX = 500;

/**
 * Warnung für die Oberfläche, wenn Reste schon nach dem vorigen Lauf stehen blieben (`null`: keine). Ein ruhiger Satz
 * ohne Fehlercodes (die stehen im Log), mit den Ordnernamen (geprüfte Muster, keine Namen aus dem Stand). Passen
 * nicht alle Namen in 500 Zeichen, folgt „und N weitere“.
 */
export function leftoverWarning(stuck: Leftover[]): string | null {
  const [first] = stuck;
  if (!first) return null;
  const partial = (l: Leftover) => l.name.startsWith('.');
  const cause = plainCause(first.cause);
  if (stuck.length === 1) {
    const what = partial(first) ? 'Ein unvollständiger Stand' : 'Ein alter Backup-Stand';
    return `${what} lässt sich seit mehreren Läufen nicht löschen (${cause}). Prüfe das Backup-Ziel und lösche den Ordner „${first.name}“ von Hand.`;
  }
  const what = stuck.every(partial)
    ? `${stuck.length} unvollständige Stände`
    : stuck.some(partial)
      ? `${stuck.length} alte Ordner im Backup-Ziel`
      : `${stuck.length} alte Backup-Stände`;
  const head = `${what} lassen sich seit mehreren Läufen nicht löschen (${cause}). Prüfe das Backup-Ziel und lösche die Ordner von Hand: `;
  const names = stuck.map((l) => `„${l.name}“`);
  for (let shown = names.length; shown >= 1; shown--) {
    const rest = names.length - shown;
    const text = `${head}${names.slice(0, shown).join(', ')}${rest > 0 ? ` und ${rest} weitere` : ''}.`;
    if (text.length <= WARNING_MAX) return text;
  }
  return `${head.slice(0, WARNING_MAX - 1)}…`;
}

/**
 * Reste des Ausdünnens am Lauf festhalten (`backup_run.thin_left`) und warnen, wenn ein Rest schon nach dem vorigen
 * Lauf mit demselben Ziel stehen blieb (`backup_run.warning`, H3). `extra`: eine weitere Warnung (Besitzer, #183), die
 * vor der zu den Resten steht. Fehlt die Spalte (Backup vor der Migration, die sie anlegt), passiert nichts. Fehler
 * hier machen das Backup nicht ungültig.
 */
export async function recordLeftovers(
  deps: Pick<BackupDeps, 'pg' | 'err' | 'cfg'>,
  runId: string,
  targetSetting: string,
  left: Leftover[],
  extra: string | null = null,
): Promise<void> {
  const { pg } = deps;
  try {
    const [has] = await pg.query(
      `SELECT count(*) FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'backup_run' AND column_name = 'thin_left'`,
    );
    if (Number(has?.[0] ?? 0) === 0) return;
    const [previous] = await pg.query(
      `SELECT array_to_string(thin_left, '/') FROM backup_run
        WHERE state = 'fertig' AND target = :'target' AND id <> :'id'::uuid AND thin_left IS NOT NULL
          AND deleted_at IS NULL
        ORDER BY finished_at DESC NULLS LAST, id DESC LIMIT 1`,
      { id: runId, target: targetSetting },
    );
    const before = new Set((previous?.[0] ?? '').split('/').filter((name) => name !== ''));
    const stuck = leftoverWarning(left.filter((l) => before.has(l.name)));
    if (stuck) deps.err(`Warnung: ${stuck}`);
    const warning = joinWarnings(extra, stuck);
    await pg.query(
      `UPDATE backup_run SET thin_left = string_to_array(:'left', '/'), warning = NULLIF(:'warning', ''),
              updated_at = now()
        WHERE id = :'id'::uuid`,
      { id: runId, left: left.map((l) => l.name).join('/'), warning: warning ?? '' },
    );
  } catch (error) {
    deps.err(`Reste des Ausdünnens ließen sich nicht eintragen: ${errorText(error, deps.cfg)}`);
  }
}

/** Zwei Warnungen in einem Text für `backup_run.warning`, höchstens 500 Zeichen (`null`: keine) */
function joinWarnings(first: string | null, second: string | null): string | null {
  const text = [first, second].filter((w): w is string => w !== null && w !== '').join(' ');
  if (text === '') return null;
  return text.length <= WARNING_MAX ? text : `${text.slice(0, WARNING_MAX - 1)}…`;
}
