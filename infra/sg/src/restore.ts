// `pnpm sg restore [<stand>] [--test] [--ziel <pfad>] [--ja]` (F-DAT-02, docs/VERTRAEGE.md §13)
//
// Ohne Stand: vorhandene Stände auflisten.
// `--test`: Stand in eine Wegwerf-Datenbank einspielen, Objekte zählen, Datenbank wieder löschen. Läuft auch bei
//   laufendem Core und fasst weder die echte Datenbank noch den Datenordner an.
// Vollständig: nur bei gestopptem Core und Worker. Der Stand kommt zuerst in eine NEUE Datenbank und in neue
//   Ordner neben den alten; erst dann wird getauscht. Die alten Daten bleiben unter anderem Namen liegen
//   (`<db>_vor_restore_<zeit>`, `media.vor-restore-<zeit>`), nichts wird gelöscht. Backup-Hardlinks werden nie
//   übernommen: Der Datenordner bekommt echte Kopien, sonst würden spätere Änderungen den Stand verändern.
import { existsSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
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
  sha256File,
  type BackupIo,
} from './backup.ts';
import type { SgConfig } from './config.ts';
import { safeIdent, type PgAccess } from './pg.ts';

export interface RestoreDeps extends BackupIo {
  cfg: Pick<SgConfig, 'dataDir' | 'databaseUrl'>;
  pg: PgAccess;
  /** Läuft der Core oder der Worker? (Pid-Dateien und Health-Abfrage) */
  servicesRunning: () => Promise<string[]>;
  /** Frage stellen, `true` = ja */
  confirm: (question: string) => Promise<boolean>;
  now?: () => Date;
  random?: () => string;
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

/** Stand finden und prüfen: Manifest da, Dump vorhanden, Prüfsumme stimmt */
async function loadStand(target: string, stand: string): Promise<{ dir: string; manifest: Manifest }> {
  if (!STAND_RE.test(stand)) throw new Error(`„${stand}“ ist kein Stand (erwartet z. B. 20261104T030012Z).`);
  const dir = join(target, stand);
  const manifest = readManifest(dir);
  if (!manifest) throw new Error(`Der Stand ${stand} ist im Ziel nicht vorhanden oder unvollständig.`);
  const dump = join(dir, DUMP_FILE);
  if (!existsSync(dump)) throw new Error(`Im Stand ${stand} fehlt ${DUMP_FILE}.`);
  if ((await sha256File(dump)) !== manifest.dump.sha256) {
    throw new Error(
      `Die Prüfsumme von ${DUMP_FILE} im Stand ${stand} stimmt nicht. Der Stand ist beschädigt.`,
    );
  }
  return { dir, manifest };
}

async function dropDatabase(pg: PgAccess, name: string): Promise<void> {
  await pg.query(`DROP DATABASE IF EXISTS ${safeIdent(name)} WITH (FORCE)`, {}, 'postgres');
}

export async function runRestore(deps: RestoreDeps, options: RestoreOptions): Promise<number> {
  const { cfg, pg, log, err } = deps;
  try {
    const target = options.target ?? (await readBackupSettings(pg).catch(() => ({ target: null }))).target;
    if (!target) {
      err(
        'Kein Backup-Ziel bekannt. Gib es mit --ziel <pfad> an oder stelle es unter Einstellungen → Daten ein.',
      );
      return 2;
    }

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

    const { dir, manifest } = await loadStand(target, options.stand);
    return options.test
      ? await testRestore(deps, dir, manifest)
      : await fullRestore(deps, options, dir, manifest);
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

async function testRestore(deps: RestoreDeps, dir: string, manifest: Manifest): Promise<number> {
  const { pg, log, err } = deps;
  const suffix = (deps.random ?? (() => Math.random().toString(36).slice(2, 8)))();
  const name = safeIdent(`${pg.database}_restoretest_${suffix}`.toLowerCase());
  log(`Teste Stand ${manifest.stand} in der Wegwerf-Datenbank ${name} …`);
  await dropDatabase(pg, name);
  await pg.query(`CREATE DATABASE ${name}`, {}, 'postgres');
  let report: RestoreTestReport;
  try {
    await pg.restore(name, join(dir, DUMP_FILE));
    const counts = await countObjects(pg, name);
    const missingTables = Object.keys(manifest.counts).filter((t) => !(t in counts));
    const differences = Object.entries(manifest.counts)
      .filter(([table, expected]) => table in counts && counts[table] !== expected)
      .map(([table, expected]) => ({ table, expected, actual: counts[table] as number }));
    const media = existsSync(join(dir, 'media')) ? treeSize(join(dir, 'media')) : { files: 0, bytes: 0 };
    const vault = existsSync(join(dir, 'vault')) ? treeSize(join(dir, 'vault')) : { files: 0, bytes: 0 };
    const mediaOk =
      media.files === manifest.media.files &&
      media.bytes === manifest.media.bytes &&
      vault.files === manifest.vault.files &&
      vault.bytes === manifest.vault.bytes;
    report = { counts, differences, missingTables, mediaOk };
  } finally {
    await dropDatabase(pg, name).catch((e: unknown) =>
      err(`Wegwerf-Datenbank ${name} ließ sich nicht löschen: ${errorText(e, deps.cfg)}`),
    );
  }

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
  const ok = report.missingTables.length === 0 && report.mediaOk;
  if (report.missingTables.length > 0) err(`Tabellen fehlen: ${report.missingTables.join(', ')}`);
  log(ok ? `Test bestanden: Stand ${manifest.stand} lässt sich wiederherstellen.` : 'Test NICHT bestanden.');
  return ok ? 0 : 1;
}

// ---------------------------------------------------------------- Vollständig

async function fullRestore(
  deps: RestoreDeps,
  options: RestoreOptions,
  dir: string,
  manifest: Manifest,
): Promise<number> {
  const { cfg, pg, log, err } = deps;
  const running = await deps.servicesRunning();
  if (running.length > 0) {
    err(
      `${running.join(' und ')} läuft noch. Zuerst "pnpm sg stop" ausführen, die Wiederherstellung braucht stillstehende Daten.`,
    );
    return 3;
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
  const undo: (() => void | Promise<void>)[] = [];

  try {
    log(`Spiele den Dump in die neue Datenbank ${fresh} ein …`);
    await dropDatabase(pg, fresh);
    await pg.query(`CREATE DATABASE ${fresh}`, {}, 'postgres');
    undo.push(() => dropDatabase(pg, fresh));
    await pg.restore(fresh, join(dir, DUMP_FILE));

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

    // Ein im Dump noch laufender Backup-Lauf (der, aus dem der Stand stammt) wird nie abgeschlossen
    await pg.query(
      `UPDATE backup_run SET state = 'fehler', finished_at = now(), error = 'Beim Wiederherstellen unvollständig' WHERE state = 'laeuft'`,
      {},
      fresh,
    );

    const swaps: { name: 'media' | 'vault'; staged: string; previous: string }[] = [];
    for (const name of ['media', 'vault'] as const) {
      const source = join(dir, name);
      if (!existsSync(source)) {
        log(`Der Stand enthält kein ${name}/. Das aktuelle ${name}/ bleibt unverändert.`);
        continue;
      }
      const staged = join(cfg.dataDir, `${name}.neu-${stamp}`);
      log(`Kopiere ${name}/ aus dem Stand …`);
      undo.push(() => rmSync(staged, { recursive: true, force: true }));
      copyTree(source, staged, null); // ohne vorigen Stand: echte Kopien, keine Hardlinks ins Backup
      swaps.push({ name, staged, previous: join(cfg.dataDir, `${name}.vor-restore-${stamp}`) });
    }

    for (const swap of swaps) {
      const current = join(cfg.dataDir, swap.name);
      if (existsSync(current)) {
        renameSync(current, swap.previous);
        undo.push(() => renameSync(swap.previous, current));
      }
      renameSync(swap.staged, current);
      undo.push(() => renameSync(current, swap.staged));
    }

    log('Tausche die Datenbank …');
    await pg.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = :'db' AND pid <> pg_backend_pid()`,
      { db: live },
      'postgres',
    );
    await pg.query(`ALTER DATABASE ${live} RENAME TO ${old}`, {}, 'postgres');
    try {
      await pg.query(`ALTER DATABASE ${fresh} RENAME TO ${live}`, {}, 'postgres');
    } catch (error) {
      await pg.query(`ALTER DATABASE ${old} RENAME TO ${live}`, {}, 'postgres');
      throw error;
    }
  } catch (error) {
    for (const step of undo.reverse()) {
      try {
        await step();
      } catch (e) {
        err(`Rückbau fehlgeschlagen: ${errorText(e, cfg)}`);
      }
    }
    throw error;
  }

  log(`Stand ${manifest.stand} ist wiederhergestellt. Starte danach mit "pnpm sg start".`);
  {
    log(
      `Die bisherige Datenbank liegt als "${old}" daneben, vorhandene Ordner als media.vor-restore-${stamp} bzw. vault.vor-restore-${stamp}.`,
    );
    log('Wenn alles stimmt, kannst du sie von Hand löschen (DROP DATABASE bzw. Ordner löschen).');
  }
  return 0;
}
