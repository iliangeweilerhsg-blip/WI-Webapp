// `pnpm sg restore --automatisch [--trigger zeitplan|manuell]` (F-DAT-02, docs/VERTRAEGE.md §13): der monatliche
// Restore-Test. Der Core startet ihn (Zeitplan oder „Jetzt testen“), er läuft ohne Rückfrage und schreibt sein
// Ergebnis nach `setting` (Schlüssel `restore_test`), das der Core in `GET /backups` ausliefert.
//
// Vertrauen: `pg_restore` führt SQL als Superuser aus, ein fremder Stand im Ziel wäre also Codeausführung. Darum
// wird nur ein Stand getestet, zu dem es einen eigenen, protokollierten Lauf gibt (`backup_run` mit state `fertig`,
// Stand und der von `sg backup` eingetragenen Prüfsumme des Dumps) und dessen Manifest genau diese Prüfsumme trägt.
// Die Datenbank ist die Vertrauensquelle, das Ziel nicht. Stände ohne Lauf-Eintrag werden nie angefasst.
import { SINGLE_USER_ID } from '@sg/shared';
import { checkBackupTarget } from '@sg/shared/backup-target';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readBackupSettings, errorText } from './backup.ts';
import {
  dropDatabase,
  loadStand,
  restoreIntoScratch,
  reportOk,
  StandError,
  type RestoreDeps,
} from './restore.ts';
import { safeIdent } from './pg.ts';

export const RESTORE_TEST_TRIGGERS = ['zeitplan', 'manuell'] as const;
export type RestoreTestTrigger = (typeof RESTORE_TEST_TRIGGERS)[number];

export type RestoreTestReason =
  | 'kein_ziel'
  | 'kein_backup'
  | 'ziel_nicht_erreichbar'
  | 'nicht_authentisch'
  | 'beschaedigt'
  | 'dateien_abweichend'
  | 'tabellen_fehlen'
  | 'restore_fehlgeschlagen'
  | 'abgebrochen'
  | 'intern';

/** Wert von `setting.restore_test` (entspricht `RestoreTest` in packages/schemas) */
export interface RestoreTestValue {
  state: 'laeuft' | 'ok' | 'fehler';
  trigger: RestoreTestTrigger;
  started_at: string;
  finished_at: string | null;
  stand: string | null;
  /** true = jüngster erfolgreicher Lauf, false = älterer, null = unbekannt */
  is_latest: boolean | null;
  reason: RestoreTestReason | null;
  error: string | null;
}

export const RESTORE_TEST_KEY = 'restore_test';
/** Wie viele der jüngsten eigenen Läufe geprüft werden, falls Stände inzwischen ausgedünnt wurden */
const CANDIDATES = 5;

export interface AutoRestoreOptions {
  trigger: RestoreTestTrigger;
}

async function writeResult(deps: Pick<RestoreDeps, 'pg'>, value: RestoreTestValue): Promise<void> {
  await deps.pg.query(
    `INSERT INTO setting (key, value, user_id) VALUES ('${RESTORE_TEST_KEY}', :'value'::jsonb, :'user'::uuid)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, deleted_at = NULL, updated_at = now()`,
    { value: JSON.stringify(value), user: SINGLE_USER_ID },
  );
}

/** Beginn des laufenden Tests, wenn der Core ihn schon eingetragen hat (sonst jetzt) */
async function startedAt(deps: Pick<RestoreDeps, 'pg'>, fallback: Date): Promise<string> {
  const rows = await deps.pg.query(
    `SELECT value->>'started_at' FROM setting
      WHERE key = '${RESTORE_TEST_KEY}' AND deleted_at IS NULL AND value->>'state' = 'laeuft'`,
  );
  return rows[0]?.[0] ? rows[0][0] : fallback.toISOString();
}

/** Aufräumen nach einem Absturz: übrig gebliebene Wegwerf-Datenbanken des automatischen Tests */
async function dropLeftovers(deps: RestoreDeps): Promise<void> {
  const prefix = `${deps.pg.database}_autotest_`.toLowerCase().replace(/[\\_%]/g, (c) => `\\${c}`);
  const rows = await deps.pg.query(
    `SELECT datname FROM pg_database WHERE datname LIKE :'pattern'`,
    { pattern: `${prefix}%` },
    'postgres',
  );
  for (const [name] of rows) {
    if (typeof name === 'string') await dropDatabase(deps.pg, safeIdent(name));
  }
}

/** Fertig: Exit-Code 0 = Test bestanden, 1 = nicht bestanden. Das Ergebnis steht in jedem Fall in `setting`. */
export async function runAutoRestoreTest(deps: RestoreDeps, options: AutoRestoreOptions): Promise<number> {
  const { cfg, pg, log, err } = deps;
  const now = deps.now ?? (() => new Date());
  const started = await startedAt(deps, now()).catch(() => now().toISOString());
  const base = { trigger: options.trigger, started_at: started } as const;
  const finish = async (
    result:
      | { state: 'ok'; stand: string }
      | { state: 'fehler'; stand: string | null; reason: RestoreTestReason; error: string },
  ): Promise<number> => {
    const value: RestoreTestValue = {
      ...base,
      state: result.state,
      finished_at: now().toISOString(),
      stand: result.stand,
      is_latest: isLatest,
      reason: result.state === 'fehler' ? result.reason : null,
      error: result.state === 'fehler' ? result.error.slice(0, 500) : null,
    };
    try {
      await writeResult(deps, value);
    } catch (e) {
      err(`Das Ergebnis des Restore-Tests ließ sich nicht speichern: ${errorText(e, cfg)}`);
      return 1;
    }
    return result.state === 'ok' ? 0 : 1;
  };
  const fail = (stand: string | null, reason: RestoreTestReason, message: string): Promise<number> => {
    err(`Restore-Test fehlgeschlagen: ${message}`);
    return finish({ state: 'fehler', stand, reason, error: message });
  };

  let currentStand: string | null = null;
  let isLatest: boolean | null = null;
  try {
    await dropLeftovers(deps).catch((e: unknown) =>
      err(`Übrig gebliebene Wegwerf-Datenbanken ließen sich nicht entfernen: ${errorText(e, cfg)}`),
    );

    const { target } = await readBackupSettings(pg);
    if (!target) return await fail(null, 'kein_ziel', 'Es ist kein Backup-Ziel eingestellt.');
    let resolved: string;
    try {
      resolved = checkBackupTarget(target, cfg.dataDir, { createMissing: false });
    } catch (e) {
      return await fail(
        null,
        'ziel_nicht_erreichbar',
        `Das Backup-Ziel ist nicht erreichbar: ${(e as Error).message}`,
      );
    }

    // Nur eigene, protokollierte Läufe für genau dieses Ziel (Einstellung `data.backup_target`)
    const runs = await pg.query(
      `SELECT stand, dump_sha256 FROM backup_run
        WHERE state = 'fertig' AND deleted_at IS NULL AND stand IS NOT NULL AND dump_sha256 IS NOT NULL
          AND target = :'target'
        ORDER BY started_at DESC, id DESC LIMIT ${CANDIDATES}`,
      { target },
    );
    const candidate = runs.find(([stand]) => stand && existsSync(join(resolved, stand, 'manifest.json')));
    if (!candidate) {
      return await fail(
        null,
        'kein_backup',
        'Im Backup-Ziel gibt es keinen Stand, der zu einem eigenen, abgeschlossenen Backup-Lauf gehört.',
      );
    }
    const [stand, sha] = candidate as [string, string];
    currentStand = stand;
    // War es der jüngste erfolgreiche Lauf? (Sonst lag der jüngste nicht mehr im Ziel oder hatte keine Prüfsumme.)
    const newest = await pg.query(
      `SELECT stand FROM backup_run
        WHERE state = 'fertig' AND deleted_at IS NULL AND stand IS NOT NULL AND target = :'target'
        ORDER BY started_at DESC, id DESC LIMIT 1`,
      { target },
    );
    isLatest = newest[0]?.[0] === undefined ? null : newest[0][0] === stand;

    let loaded;
    try {
      loaded = await loadStand(resolved, stand, sha);
    } catch (e) {
      if (e instanceof StandError) return await fail(stand, e.reason, e.message);
      throw e;
    }
    // Der Dump wird in eine private Kopie gelesen und dabei geprüft; eingespielt wird nur diese Kopie (B1)
    const report = await restoreIntoScratch(
      { ...deps, random: deps.random ?? (() => Math.random().toString(36).slice(2, 8)) },
      loaded.dir,
      loaded.manifest,
      'autotest',
    ).catch((e: unknown) => {
      if (e instanceof StandError) throw e; // Prüfsumme der Kopie stimmt nicht: wird unten wie oben gemeldet
      throw new RestoreRunError(errorText(e, cfg));
    });

    for (const d of report.differences) {
      log(
        `Hinweis: ${d.table} hat ${d.actual} statt ${d.expected} Zeilen (Schreibzugriffe während des Backups?).`,
      );
    }
    if (report.missingTables.length > 0) {
      return await fail(
        stand,
        'tabellen_fehlen',
        `In der wiederhergestellten Datenbank fehlen Tabellen: ${report.missingTables.join(', ')}.`,
      );
    }
    if (!report.mediaOk) {
      return await fail(
        stand,
        'dateien_abweichend',
        'Die Dateien (media/vault) im Stand weichen vom Manifest ab (Anzahl oder Größe).',
      );
    }
    if (!reportOk(report)) return await fail(stand, 'intern', 'Die Prüfung ergab kein eindeutiges Ergebnis.');
    log(`Restore-Test bestanden: Stand ${stand} lässt sich wiederherstellen.`);
    return await finish({ state: 'ok', stand });
  } catch (e) {
    if (e instanceof StandError) return fail(currentStand, e.reason, e.message);
    if (e instanceof RestoreRunError) return fail(currentStand, 'restore_fehlgeschlagen', e.message);
    return fail(currentStand, 'intern', errorText(e, cfg));
  }
}

class RestoreRunError extends Error {}
