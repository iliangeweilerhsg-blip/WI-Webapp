// `pnpm sg restore [<stand>] [--test] [--ziel <pfad>] [--ja]` (F-DAT-02, docs/VERTRAEGE.md §13)
//
// Ohne Stand: vorhandene Stände auflisten.
// `--test`: Stand in eine Wegwerf-Datenbank einspielen, Objekte zählen, Datenbank wieder löschen. Läuft auch bei
//   laufendem Core und fasst weder die echte Datenbank noch den Datenordner an.
// Vollständig: nur bei gestopptem Core und Worker. Der Stand kommt zuerst in eine NEUE Datenbank und in neue
//   Ordner neben den alten; erst dann wird getauscht. Die alten Daten bleiben unter anderem Namen liegen
//   (`<db>_vor_restore_<zeit>`, `media.vor-restore-<zeit>`), nichts wird gelöscht. Backup-Hardlinks werden nie
//   übernommen: Der Datenordner bekommt echte Kopien, sonst würden spätere Änderungen den Stand verändern.
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
  copyTree,
  DUMP_FILE,
  listStands,
  readManifest,
  standDate,
  STAND_RE,
  treeSize,
  type Manifest,
} from './backup-files.ts';
import {
  COUNT_TABLES,
  countObjects,
  errorText,
  readBackupSettings,
  validateTarget,
  type BackupIo,
} from './backup.ts';
import type { SgConfig } from './config.ts';
import { NoFollowReader, UnsafeTargetError, type Identity } from './nofollow.ts';
import { safeIdent, type PgAccess } from './pg.ts';
import { StandError, withVerifiedDump } from './staging.ts';

export { StandError };

export interface RestoreDeps extends BackupIo {
  cfg: Pick<SgConfig, 'dataDir' | 'databaseUrl'>;
  pg: PgAccess;
  /** Läuft der Core oder der Worker? (Pid-Dateien und Health-Abfrage) */
  servicesRunning: () => Promise<string[]>;
  /** Frage stellen, `true` = ja */
  confirm: (question: string) => Promise<boolean>;
  now?: () => Date;
  random?: () => string;
  /** Anzahl der Migrationen im Code (`services/core/drizzle`), `undefined` = nicht prüfen */
  codeMigrations?: number;
}

export interface RestoreOptions {
  stand?: string | undefined;
  test: boolean;
  target?: string | undefined;
  yes: boolean;
}

const lower = (stand: string): string => stand.toLowerCase();

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = n;
  let unit = -1;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/** Zeigt die Stände im Ziel */
export function listStandsText(target: string): string[] {
  const lines: string[] = [];
  for (const stand of listStands(target)) {
    const manifest = readManifest(join(target, stand));
    if (!manifest) continue;
    const size = manifest.dump.bytes + manifest.media.bytes + manifest.vault.bytes;
    lines.push(`  ${stand}  ${manifest.trigger.padEnd(13)} ${formatBytes(size)}`);
  }
  return lines;
}

/**
 * Stand finden und prüfen: Manifest da, Dump vorhanden. Mit `expectedSha` (Prüfsumme aus `backup_run.dump_sha256`,
 * der Vertrauensquelle) muss auch das Manifest genau diese Prüfsumme tragen: Ein Stand mit erfundenem Manifest samt
 * passendem Dump wird so abgelehnt. Die Prüfsumme des Dumps selbst wird erst beim Einspielen gebildet
 * (`withVerifiedDump`): Prüfen und Einspielen betreffen so dieselben Bytes (kein Austausch dazwischen, TOCTOU).
 * Mit `maxDumpBytes` (aus `backup_run.size_bytes`, M-1 aus #114) darf das Manifest keinen größeren Dump nennen: Die
 * Größe im Manifest begrenzt die Prüfkopie, darf aber selbst nicht beliebig groß gefälscht sein.
 */
export async function loadStand(
  target: string,
  stand: string,
  expectedSha?: string,
  maxDumpBytes?: number,
): Promise<{ dir: string; manifest: Manifest }> {
  if (!STAND_RE.test(stand)) throw new Error(`„${stand}“ ist kein Stand (erwartet z. B. 20261104T030012Z).`);
  const dir = join(target, stand);
  const manifest = readManifest(dir);
  if (!manifest) {
    throw new StandError('beschaedigt', `Der Stand ${stand} ist im Ziel nicht vorhanden oder unvollständig.`);
  }
  if (manifest.stand !== stand || (expectedSha !== undefined && manifest.dump.sha256 !== expectedSha)) {
    throw new StandError(
      'nicht_authentisch',
      `Das Manifest des Standes ${stand} passt nicht zum protokollierten Backup-Lauf. Der Stand wird nicht eingespielt.`,
    );
  }
  if (maxDumpBytes !== undefined && !(manifest.dump.bytes <= maxDumpBytes)) {
    throw new StandError(
      'nicht_authentisch',
      `Das Manifest des Standes ${stand} nennt einen größeren Dump, als der protokollierte Backup-Lauf war. Der Stand wird nicht eingespielt.`,
    );
  }
  if (!existsSync(join(dir, DUMP_FILE)))
    throw new StandError('beschaedigt', `Im Stand ${stand} fehlt ${DUMP_FILE}.`);
  return { dir, manifest };
}

/** Prüfsumme und Größe eines eigenen Laufs (`backup_run`) zu einem Stand */
export interface RunAnchor {
  sha256: string;
  /** `backup_run.size_bytes` (Dump plus Dateien), `undefined` = unbekannt */
  sizeBytes: number | undefined;
}

/**
 * Eigener, fertiger Lauf zu `stand` mit Prüfsumme (Härtung aus #114): Gibt es ihn, verlangt auch der Restore von Hand
 * (`--test <stand>`, `<stand>`) genau diese Prüfsumme. Ein im Ziel ausgetauschter eigener Stand führt so kein fremdes
 * SQL aus. Gesucht wird nur nach dem Standnamen (er ist der Startzeitpunkt des Laufs), unabhängig vom Ziel, damit
 * das auch mit `--ziel` gilt. `null`: kein solcher Lauf oder die Datenbank ist nicht erreichbar.
 */
export async function runAnchor(pg: PgAccess, stand: string): Promise<RunAnchor | null> {
  if (!STAND_RE.test(stand)) return null;
  const [row] = await pg.query(
    `SELECT dump_sha256, coalesce(size_bytes::text, '') FROM backup_run
      WHERE state = 'fertig' AND deleted_at IS NULL AND dump_sha256 <> '' AND stand = :'stand'
      ORDER BY started_at DESC, id DESC LIMIT 1`,
    { stand },
  );
  if (!row?.[0]) return null;
  const size = row[1] ? Number(row[1]) : NaN;
  return { sha256: row[0], sizeBytes: Number.isSafeInteger(size) ? size : undefined };
}

/** Dump des Standes in den privaten Ordner kopieren, dabei prüfen, dann mit genau dieser Kopie weitermachen */
export function withStandDump<T>(
  deps: Pick<RestoreDeps, 'cfg'>,
  dir: string,
  manifest: Manifest,
  fn: (verifiedCopy: string) => Promise<T>,
): Promise<T> {
  return withVerifiedDump(
    deps.cfg.dataDir,
    join(dir, DUMP_FILE),
    { sha256: manifest.dump.sha256, bytes: manifest.dump.bytes },
    manifest.stand,
    fn,
  );
}

/** Ein Verstoß beim Lesen des Standes (Symlink, Sonderdatei, Tausch) ist ein beschädigter Stand */
function asStandError<T>(dir: string, fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof UnsafeTargetError) {
      throw new StandError(
        'beschaedigt',
        `Im Stand ${basename(dir)} liegt ein Symlink oder eine Sonderdatei, oder es wurde während des Lesens etwas ausgetauscht (${error.message}). Der Stand ist beschädigt.`,
      );
    }
    throw error;
  }
}

export interface StandTree {
  reader: NoFollowReader;
  media: string | null;
  vault: string | null;
}

/**
 * Stand im Ziel verankert öffnen (#119): Der Stand-Ordner, `media/` und `vault/` werden ohne Symlink-Folgen betreten
 * (`NoFollowReader`). Ein Symlink an ihrer Stelle oder darunter ergibt `StandError('beschaedigt')`.
 */
export function openStandTree(dir: string, targetId?: Identity): StandTree {
  return asStandError(dir, () => {
    const reader = new NoFollowReader();
    const parent = dirname(dir);
    // Mit der Identität aus `validateTarget` (dev/ino) statt per `statSync` neu zu sehen (#161): Wurde das Ziel
    // nach der Prüfung ersetzt, scheitert der erste Zugriff.
    reader.adopt(parent, targetId);
    const standDir = reader.child(parent, basename(dir));
    if (!standDir) throw new UnsafeTargetError(`${dir} fehlt.`);
    return { reader, media: reader.child(standDir, 'media'), vault: reader.child(standDir, 'vault') };
  });
}

/**
 * Dateianzahl und Größen des Standes gegen das Manifest (.DS_Store u. Ä. zählen auf beiden Seiten nie). Gelesen wird
 * verankert ohne Symlink-Folgen; ein Symlink im Stand ergibt `StandError('beschaedigt')`.
 */
export function standFilesMatch(dir: string, manifest: Manifest, targetId?: Identity): boolean {
  const tree = openStandTree(dir, targetId);
  const size = (path: string | null) =>
    path
      ? asStandError(dir, () => treeSize(path, { reader: tree.reader, strict: true }))
      : { files: 0, bytes: 0 };
  const media = size(tree.media);
  const vault = size(tree.vault);
  return (
    media.files === manifest.media.files &&
    media.bytes === manifest.media.bytes &&
    vault.files === manifest.vault.files &&
    vault.bytes === manifest.vault.bytes
  );
}

export async function dropDatabase(pg: PgAccess, name: string): Promise<void> {
  await pg.query(`DROP DATABASE IF EXISTS ${safeIdent(name)} WITH (FORCE)`, {}, 'postgres');
}

export async function runRestore(deps: RestoreDeps, options: RestoreOptions): Promise<number> {
  const { cfg, pg, log, err } = deps;
  try {
    if ((await recoverRestore(deps)) !== null) return 0;
    const setting = options.target ?? (await readBackupSettings(pg).catch(() => ({ target: null }))).target;
    if (!setting) {
      err(
        'Kein Backup-Ziel bekannt. Gib es mit --ziel <pfad> an oder stelle es unter Einstellungen → Daten ein.',
      );
      return 2;
    }
    // Ziel einmal prüfen und mit dieser Identität (dev/ino) übernehmen, nicht später per `statSync` (#161)
    const { path: target, dev, ino } = validateTarget(setting, cfg.dataDir, false, false);
    const targetId: Identity = { dev, ino };

    if (!options.stand) {
      const lines = listStandsText(target);
      if (lines.length === 0) {
        err(`Im Ziel ${target} gibt es keine Stände.`);
        return 1;
      }
      log(`Stände in ${target} (neueste zuerst):`);
      for (const line of lines) log(line);
      log('Wiederherstellen: pnpm sg restore <stand>   Test: pnpm sg restore --test <stand>');
      return 0;
    }

    // Gehört der Stand zu einem eigenen Lauf, gilt dessen Prüfsumme (und Größe) auch hier. Ohne Datenbank (etwa
    // beim Restore nach einem Datenbankschaden) bleibt es bei der Prüfung gegen das Manifest.
    let anchor: RunAnchor | null = null;
    let anchorRead = false;
    try {
      anchor = await runAnchor(pg, options.stand);
      anchorRead = true;
    } catch (error) {
      log(
        `Hinweis: backup_run ist nicht lesbar (${errorText(error, cfg)}). Der Stand wird nur gegen sein Manifest geprüft.`,
      );
    }
    const { dir, manifest } = await loadStand(target, options.stand, anchor?.sha256, anchor?.sizeBytes);
    if (anchor)
      log(`Stand ${options.stand} gehört zu einem eigenen Backup-Lauf, seine Prüfsumme wird verlangt.`);
    else if (anchorRead)
      log(
        `Hinweis: Zum Stand ${options.stand} gibt es keinen eigenen Backup-Lauf mit Prüfsumme. Er wird nur gegen sein Manifest geprüft.`,
      );
    return options.test
      ? await testRestore(deps, dir, manifest, targetId)
      : await fullRestore(deps, options, dir, manifest, targetId);
  } catch (error) {
    err(`Wiederherstellung fehlgeschlagen: ${errorText(error, cfg)}`);
    return 1;
  }
}

// ---------------------------------------------------------------- Test

export interface RestoreTestReport {
  counts: Record<string, number>;
  /** Tabellen mit anderer Zeilenzahl als im Manifest (Richtwert, Schreibzugriffe während des Backups sind möglich) */
  differences: { table: string; expected: number; actual: number }[];
  missingTables: string[];
  mediaOk: boolean;
}

export const reportOk = (report: RestoreTestReport): boolean =>
  report.missingTables.length === 0 && report.mediaOk;

/**
 * Spielt den Dump in eine Wegwerf-Datenbank ein, zählt die Objekte, vergleicht mit dem Manifest und löscht die
 * Datenbank danach IMMER wieder (auch bei Fehlern). Gemeinsame Prüflogik von `restore --test` und dem
 * automatischen Monatstest. `prefix` trennt die Namen (`restoretest` von Hand, `autotest` automatisch).
 */
export async function restoreIntoScratch(
  deps: Pick<RestoreDeps, 'cfg' | 'pg' | 'log' | 'err' | 'random'>,
  dir: string,
  manifest: Manifest,
  prefix = 'restoretest',
  targetId?: Identity,
): Promise<RestoreTestReport> {
  const { pg, log, err } = deps;
  const suffix = (deps.random ?? (() => Math.random().toString(36).slice(2, 8)))();
  const name = safeIdent(`${pg.database}_${prefix}_${suffix}`.toLowerCase());
  // Erst die Kopie prüfen (Prüfsumme), dann die Wegwerf-Datenbank anlegen: Ein beschädigter oder ausgetauschter
  // Dump kostet keine Datenbank und wird nie eingespielt. Eingespielt wird nur die geprüfte Kopie.
  return withStandDump(deps, dir, manifest, async (verifiedDump) => {
    log(`Teste Stand ${manifest.stand} in der Wegwerf-Datenbank ${name} …`);
    try {
      await dropDatabase(pg, name);
      await pg.query(`CREATE DATABASE ${name}`, {}, 'postgres');
      await pg.restore(name, verifiedDump);
      const counts = await countObjects(pg, name);
      const missingTables = Object.keys(manifest.counts).filter((t) => !(t in counts));
      const differences = Object.entries(manifest.counts)
        .filter(([table, expected]) => table in counts && counts[table] !== expected)
        .map(([table, expected]) => ({ table, expected, actual: counts[table] as number }));
      const mediaOk = standFilesMatch(dir, manifest, targetId);
      return { counts, differences, missingTables, mediaOk };
    } finally {
      await dropDatabase(pg, name).catch((e: unknown) =>
        err(`Wegwerf-Datenbank ${name} ließ sich nicht löschen: ${errorText(e, deps.cfg)}`),
      );
    }
  });
}

async function testRestore(
  deps: RestoreDeps,
  dir: string,
  manifest: Manifest,
  targetId?: Identity,
): Promise<number> {
  const { log, err } = deps;
  const report = await restoreIntoScratch(deps, dir, manifest, 'restoretest', targetId);

  log('Objekte in der wiederhergestellten Datenbank:');
  for (const table of COUNT_TABLES) {
    const n = report.counts[table];
    if (n !== undefined) log(`  ${table.padEnd(16)} ${n}`);
  }
  log(`Dateien (media/vault): ${report.mediaOk ? 'vollständig' : 'ABWEICHEND vom Manifest'}`);
  for (const d of report.differences) {
    log(
      `Hinweis: ${d.table} hat ${d.actual} statt ${d.expected} Zeilen (Schreibzugriffe während des Backups?).`,
    );
  }
  const ok = reportOk(report);
  if (report.missingTables.length > 0) err(`Tabellen fehlen: ${report.missingTables.join(', ')}`);
  log(ok ? `Test bestanden: Stand ${manifest.stand} lässt sich wiederherstellen.` : 'Test NICHT bestanden.');
  return ok ? 0 : 1;
}

// ---------------------------------------------------------------- Vollständig

/** Journal eines laufenden Restores (`<Datenordner>/restore.journal.json`) */
export interface RestoreJournal {
  version: 1;
  stand: string;
  live: string;
  fresh: string;
  old: string;
  dirs: { name: 'media' | 'vault'; staged: string; previous: string; hadLive: boolean }[];
  /** preparing: nichts getauscht · swapping: Ordner werden getauscht · die Datenbank-Umbenennung ist der Commit */
  phase: 'preparing' | 'swapping';
}

export const journalPath = (dataDir: string): string => join(dataDir, 'restore.journal.json');

export function readJournal(dataDir: string): RestoreJournal | null {
  try {
    const parsed = JSON.parse(readFileSync(journalPath(dataDir), 'utf8')) as RestoreJournal;
    return parsed.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

function writeJournal(dataDir: string, journal: RestoreJournal): void {
  writeFileSync(journalPath(dataDir), `${JSON.stringify(journal, null, 2)}\n`);
}

async function existingDatabases(pg: PgAccess, names: string[]): Promise<Set<string>> {
  const rows = await pg.query(
    `SELECT datname FROM pg_database WHERE datname = ANY(string_to_array(:'names', ','))`,
    { names: names.join(',') },
    'postgres',
  );
  return new Set(rows.map((r) => r[0] as string));
}

/**
 * Schließt einen unterbrochenen Restore ab oder baut ihn zurück. Der Commit-Punkt ist die Datenbank-Umbenennung
 * (eine Transaktion): Ist sie passiert (die alte Datenbank `old` existiert), werden die Ordner fertig getauscht,
 * sonst wird alles zurückgebaut (Ordner zurück, neue Datenbank und gestagte Kopien löschen). Jeder Schritt prüft
 * den Ist-Zustand und lässt sich beliebig oft wiederholen. Rückgabe: `null` = kein Journal, sonst was geschehen ist.
 */
export async function recoverRestore(
  deps: Pick<RestoreDeps, 'cfg' | 'pg' | 'log' | 'err'>,
): Promise<'abgeschlossen' | 'zurueckgebaut' | null> {
  const { cfg, pg, log } = deps;
  const journal = readJournal(cfg.dataDir);
  if (!journal) return null;
  log(`Ein unterbrochener Restore (Stand ${journal.stand}) wurde gefunden. Prüfe den Zustand …`);
  const dbs = await existingDatabases(pg, [journal.live, journal.fresh, journal.old]);
  const committed = dbs.has(journal.old) && !dbs.has(journal.fresh);
  const current = (name: string) => join(cfg.dataDir, name);

  if (committed) {
    for (const d of journal.dirs) {
      if (existsSync(d.staged)) {
        if (existsSync(current(d.name))) renameSync(current(d.name), d.previous);
        renameSync(d.staged, current(d.name));
      }
    }
    rmSync(journalPath(cfg.dataDir), { force: true });
    log(`Der Restore des Standes ${journal.stand} wurde abgeschlossen. Starte danach mit "pnpm sg start".`);
    return 'abgeschlossen';
  }

  for (const d of journal.dirs) {
    if (existsSync(d.previous)) {
      // Ordner war schon getauscht: den wiederhergestellten zurück in den Zwischenordner, den alten zurück
      if (existsSync(current(d.name)) && !existsSync(d.staged)) renameSync(current(d.name), d.staged);
      if (!existsSync(current(d.name))) renameSync(d.previous, current(d.name));
    }
    // Es gab vorher keinen Ordner, der wiederhergestellte ist schon getauscht: wieder entfernen
    if (!d.hadLive && !existsSync(d.staged) && existsSync(current(d.name)))
      renameSync(current(d.name), d.staged);
    rmSync(d.staged, { recursive: true, force: true });
  }
  if (dbs.has(journal.fresh)) await dropDatabase(pg, journal.fresh);
  rmSync(journalPath(cfg.dataDir), { force: true });
  log(
    `Der unterbrochene Restore wurde zurückgebaut, deine Daten sind unverändert. ` +
      `Führe bei Bedarf "pnpm sg restore ${journal.stand}" erneut aus.`,
  );
  return 'zurueckgebaut';
}

async function fullRestore(
  deps: RestoreDeps,
  options: RestoreOptions,
  dir: string,
  manifest: Manifest,
  targetId?: Identity,
): Promise<number> {
  const { cfg, pg, log, err } = deps;
  const running = await deps.servicesRunning();
  if (running.length > 0) {
    err(
      `${running.join(' und ')} läuft noch. Zuerst "pnpm sg stop" ausführen, die Wiederherstellung braucht stillstehende Daten.`,
    );
    return 3;
  }

  // Prüfungen vor jeder Änderung
  if (!standFilesMatch(dir, manifest, targetId)) {
    err(
      `Die Dateien im Stand ${manifest.stand} stimmen nicht mit dem Manifest überein (Anzahl oder Größe). ` +
        'Der Stand ist unvollständig oder beschädigt, es wurde nichts verändert.',
    );
    return 1;
  }
  if (deps.codeMigrations !== undefined && typeof manifest.migrations === 'number') {
    if (manifest.migrations > deps.codeMigrations) {
      err(
        `Der Stand ${manifest.stand} stammt von einer neueren Version der App (Schema ${manifest.migrations}, ` +
          `diese Version kennt ${deps.codeMigrations}). Aktualisiere zuerst die App (git pull, pnpm install) und wiederhole den Restore.`,
      );
      return 1;
    }
    if (manifest.migrations < deps.codeMigrations) {
      log(
        `Hinweis: Der Stand hat ein älteres Schema (${manifest.migrations} statt ${deps.codeMigrations} Migrationen). ` +
          'Die Migration läuft beim nächsten "pnpm sg start" bzw. "pnpm sg migrate".',
      );
    }
  }

  if (!options.yes) {
    const ok = await deps.confirm(
      `Stand ${manifest.stand} (${standDate(manifest.stand).toLocaleString('de-DE')}) wiederherstellen? ` +
        'Die aktuellen Daten werden zur Seite gelegt, aber nicht gelöscht. (ja/nein)',
    );
    if (!ok) {
      log('Abgebrochen.');
      return 1;
    }
  }

  const stamp = lower(
    (deps.now ?? (() => new Date()))()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}Z$/, 'Z'),
  );
  const live = safeIdent(pg.database);
  const fresh = safeIdent(`${live}_restore_${stamp}`);
  const old = safeIdent(`${live}_vor_restore_${stamp}`);
  // media/ und vault/ des Standes verankert, ohne Symlink-Folgen (#119)
  const tree = openStandTree(dir, targetId);
  const journal: RestoreJournal = {
    version: 1,
    stand: manifest.stand,
    live,
    fresh,
    old,
    phase: 'preparing',
    dirs: (['media', 'vault'] as const)
      .filter((name) => tree[name] !== null)
      .map((name) => ({
        name,
        staged: join(cfg.dataDir, `${name}.neu-${stamp}`),
        previous: join(cfg.dataDir, `${name}.vor-restore-${stamp}`),
        hadLive: existsSync(join(cfg.dataDir, name)),
      })),
  };
  for (const name of ['media', 'vault'] as const) {
    if (tree[name] === null) {
      log(`Der Stand enthält kein ${name}/. Das aktuelle ${name}/ bleibt unverändert.`);
    }
  }
  // Erst die Kopie des Dumps prüfen (Prüfsumme über dieselben Bytes, die `pg_restore` liest), dann ändern
  return withStandDump(deps, dir, manifest, (verifiedDump) =>
    swapIn(deps, dir, manifest, journal, stamp, live, fresh, old, verifiedDump, tree),
  );
}

async function swapIn(
  deps: RestoreDeps,
  dir: string,
  manifest: Manifest,
  journal: RestoreJournal,
  stamp: string,
  live: string,
  fresh: string,
  old: string,
  verifiedDump: string,
  tree: StandTree,
): Promise<number> {
  const { cfg, pg, log, err } = deps;
  // Das Journal steht vor der ersten Änderung: Bricht der Prozess ab, räumt der nächste Start auf
  writeJournal(cfg.dataDir, journal);

  try {
    log(`Spiele den Dump in die neue Datenbank ${fresh} ein …`);
    await dropDatabase(pg, fresh);
    await pg.query(`CREATE DATABASE ${fresh}`, {}, 'postgres');
    await pg.restore(fresh, verifiedDump);

    // Neue Epoche: verbundene Clients erkennen die Wiederherstellung und laden neu (§11.1)
    const [hasMeta] = await pg.query(`SELECT to_regclass('sync_meta') IS NOT NULL`, {}, fresh);
    if (hasMeta?.[0] === 't') {
      await pg.query(`UPDATE sync_meta SET db_epoch = gen_random_uuid()`, {}, fresh);
      log('Neue Epoche gesetzt (sync_meta.db_epoch).');
    } else {
      log(
        'Der Stand hat noch kein sync_meta (älteres Schema). Die Epoche entsteht bei der nächsten Migration.',
      );
    }
    // Den Lauf, aus dem der Stand stammt, kann der Dump nur als "läuft" enthalten: abschließen. Andere offene Läufe sind tot.
    await pg.query(
      `UPDATE backup_run SET state = CASE WHEN to_char(started_at AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS"Z"') = :'stand'
                                        THEN 'fertig' ELSE 'fehler' END,
              finished_at = now(), stand = CASE WHEN to_char(started_at AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS"Z"') = :'stand' THEN :'stand' END,
              error = CASE WHEN to_char(started_at AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS"Z"') = :'stand' THEN NULL
                           ELSE 'Beim Wiederherstellen unvollständig' END
        WHERE state = 'laeuft'`,
      { stand: manifest.stand },
      fresh,
    );

    for (const d of journal.dirs) {
      log(`Kopiere ${d.name}/ aus dem Stand …`);
      // Ohne vorigen Stand: echte Kopien, keine Hardlinks ins Backup. Die Quelle wird verankert gelesen, ein Symlink
      // oder ein Tausch im Stand bricht ab (#119)
      const source = tree[d.name] as string;
      asStandError(dir, () =>
        copyTree(source, d.staged, null, undefined, { reader: tree.reader, strictSource: true }),
      );
    }

    journal.phase = 'swapping';
    writeJournal(cfg.dataDir, journal);
    for (const d of journal.dirs) {
      const live = join(cfg.dataDir, d.name);
      if (existsSync(live)) renameSync(live, d.previous);
      renameSync(d.staged, live);
    }

    log('Tausche die Datenbank …');
    await pg.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = :'db' AND pid <> pg_backend_pid()`,
      { db: live },
      'postgres',
    );
    // Beide Umbenennungen in einer Transaktion: Es gibt nie einen Zustand ohne Datenbank "<live>"
    await pg.query(
      `BEGIN;\nALTER DATABASE ${live} RENAME TO ${old};\nALTER DATABASE ${fresh} RENAME TO ${live};\nCOMMIT;`,
      {},
      'postgres',
    );
  } catch (error) {
    try {
      await recoverRestore(deps); // baut mit dem Journal zurück
    } catch (e) {
      err(
        `Der Rückbau ist fehlgeschlagen (${errorText(e, cfg)}). Führe "pnpm sg restore" oder "pnpm sg start" erneut aus, dann wird er wiederholt.`,
      );
    }
    throw error;
  }
  rmSync(journalPath(cfg.dataDir), { force: true });

  log(`Stand ${manifest.stand} ist wiederhergestellt. Starte danach mit "pnpm sg start".`);
  log(
    `Die bisherigen Daten bleiben als Sicherheitsnetz liegen (Datenbank "${old}", Ordner *.vor-restore-${stamp}). ` +
      `Willst du zu ihnen zurück, spiele mit "pnpm sg restore <stand>" einen früheren Stand ein.`,
  );
  return 0;
}
