// Globale Einstellungen (F-EIN-01, VERTRAEGE §14.1). getSettings aus T1-DB; PATCH baut T1-19.
//
// Gespeichert ist je Bereich (`general`, `lecture`, `pen`, `data`, `ai`) eine Zeile in `setting` mit dem Bereichsobjekt
// OHNE Standardwerte. getSettings füllt fehlende oder ungültige Felder mit den Standards auf.
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  SINGLE_USER_ID,
  AiSettingsUpdateSchema,
  DataSettingsUpdateSchema,
  GeneralSettingsUpdateSchema,
  LectureSettingsUpdateSchema,
  PenSettingsUpdateSchema,
  type AiSettings,
  type DataSettings,
  type GeneralSettings,
  type LectureSettings,
  type PenSettings,
  type Settings,
  type SettingsUpdate,
} from '@sg/shared';
import { BackupTargetError, checkBackupTargetAsync } from '@sg/shared/backup-target';
import type { z } from 'zod';
import type { Config } from '../config.ts';
import type { Db, DbOrTx } from '../db/client.ts';
import { notDeleted, setting } from '../db/schema/index.ts';
import { HttpError } from '../errors.ts';

export const SETTING_KEYS = ['general', 'lecture', 'pen', 'data', 'ai'] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

/** Standards aus VERTRAEGE §14.1 und §20.7 (ohne `general.data_dir`, das kommt aus SG_DATA_DIR) */
export const DEFAULT_SETTINGS: {
  general: Omit<GeneralSettings, 'data_dir'>;
  lecture: LectureSettings;
  pen: PenSettings;
  data: DataSettings;
  ai: AiSettings;
} = {
  general: { content_lang: 'de', appearance: 'system' },
  lecture: {
    microphone_id: null,
    auto_stop_after_end_min: 10,
    auto_stop_quiet_window_min: 3,
    auto_stop_hard_after_end_min: 30,
    auto_stop_silence_min: 15,
    auto_stop_max_duration_min: 240,
    auto_stop_warning_s: 60,
    auto_stop_extend_min: 15,
    default_layout: 'standard',
    default_ink_mode: 'freie_seite',
    toolbar_side: 'rechts',
  },
  pen: {
    double_tap: 'radierer',
    squeeze: 'werkzeugpalette',
    shape_recognition: false,
    favorite_colors: [
      '#1E2A44FF',
      '#C92A2AFF',
      '#1864ABFF',
      '#2B8A3EFF',
      '#E67700FF',
      '#5F3DC4FF',
      '#495057FF',
      '#000000FF',
    ],
  },
  data: { backup_target: null, backup_encryption: false, backup_time: '03:00' },
  // KI (§20.7): Der Worker liest denselben Bereich direkt aus `setting` und nutzt dieselben Standards
  ai: { monthly_budget_eur: 10, auto_accept: 'aus' },
};

/**
 * Gespeicherten Bereich über die Standards legen, Feld für Feld. Ungültige oder unbekannte Felder
 * (z. B. von Hand in der DB geändert) werden ignoriert, damit `GET /settings` immer schemagültig bleibt.
 */
function mergeArea<T extends object>(defaults: T, stored: unknown, schema: z.ZodObject): T {
  const result = structuredClone(defaults) as Record<string, unknown>;
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return result as T;
  for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
    if (!(key in result)) continue;
    const field = schema.shape[key];
    if (field && field.safeParse(value).success) result[key] = value;
  }
  return result as T;
}

/**
 * Alle Bereiche (Phase 1 und `ai`, §20.7) mit Standards aufgefüllt (`GET /settings`).
 * `general.data_dir` kommt aus der App-Konfiguration (`SG_DATA_DIR`), nie aus der Datenbank.
 */
export async function getSettings(db: DbOrTx, config: Pick<Config, 'dataDir'>): Promise<Settings> {
  const rows = await db
    .select({ key: setting.key, value: setting.value })
    .from(setting)
    .where(and(inArray(setting.key, [...SETTING_KEYS]), notDeleted(setting)));
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  return {
    general: {
      data_dir: config.dataDir,
      ...mergeArea(DEFAULT_SETTINGS.general, stored.get('general'), GeneralSettingsUpdateSchema),
    },
    lecture: mergeArea(DEFAULT_SETTINGS.lecture, stored.get('lecture'), LectureSettingsUpdateSchema),
    pen: mergeArea(DEFAULT_SETTINGS.pen, stored.get('pen'), PenSettingsUpdateSchema),
    data: mergeArea(DEFAULT_SETTINGS.data, stored.get('data'), DataSettingsUpdateSchema),
    ai: mergeArea(DEFAULT_SETTINGS.ai, stored.get('ai'), AiSettingsUpdateSchema),
  };
}

/**
 * Nur der Bereich `ai` (§20.7), mit Standards aufgefüllt: Monatsbudget und „automatisch annehmen“. Für Kosten und
 * KI-Status, die den Datenordner nicht brauchen. Fehlende oder ungültige Felder zählen wie im Worker als Standard.
 */
export async function getAiSettings(db: DbOrTx): Promise<AiSettings> {
  const [row] = await db
    .select({ value: setting.value })
    .from(setting)
    .where(and(eq(setting.key, 'ai'), notDeleted(setting)));
  return mergeArea(DEFAULT_SETTINGS.ai, row?.value, AiSettingsUpdateSchema);
}

/**
 * Zielordner für Backups (VERTRAEGE §7.5, §14.1): absoluter Pfad eines vorhandenen, beschreibbaren Ordners.
 * Gespeichert wird der normalisierte Pfad (`resolve` + `realpath`). Die Prüfung teilt sich der Core mit der CLI
 * (`@sg/shared/backup-target`). Abgelehnt werden `SG_DATA_DIR` samt Inhalt und Systemordner. Symlinks sind erlaubt,
 * das Backup (T1-18) prüft das Ziel beim Lauf erneut.
 */
async function normalizeBackupTarget(target: string, config: Pick<Config, 'dataDir'>): Promise<string> {
  try {
    return await checkBackupTargetAsync(target, config.dataDir, { createMissing: false });
  } catch (failure) {
    const message =
      failure instanceof BackupTargetError
        ? failure.message
        : 'Der Backup-Ordner ist nicht vorhanden oder nicht beschreibbar.';
    throw new HttpError(400, 'backup_target_invalid', message, { path: target });
  }
}

/**
 * `PATCH /settings`: führt die angegebenen Felder je Bereich zusammen (VERTRAEGE §14.1) und liefert den neuen Stand.
 * `general.data_dir` ist nicht änderbar (das Update-Schema kennt das Feld nicht). Das Zusammenführen geschieht
 * atomar in der Datenbank (`jsonb ||`), parallele Änderungen verschiedener Felder überschreiben sich nicht.
 */
export async function updateSettings(
  db: Db,
  config: Pick<Config, 'dataDir'>,
  update: SettingsUpdate,
): Promise<Settings> {
  // Verschlüsselung (age) ist nicht eingebunden: Einschalten wird abgelehnt (VERTRAEGE §14.1). Ausschalten geht immer.
  if (update.data?.backup_encryption === true) {
    throw new HttpError(
      400,
      'backup_encryption_unavailable',
      'Verschlüsselte Backups sind noch nicht verfügbar. Die Option lässt sich nicht einschalten.',
    );
  }
  const target = update.data?.backup_target;
  if (target !== undefined && target !== null) {
    update = {
      ...update,
      data: { ...update.data, backup_target: await normalizeBackupTarget(target, config) },
    };
  }
  return db.transaction(async (tx) => {
    for (const key of SETTING_KEYS) {
      const patch = update[key];
      if (!patch || Object.keys(patch).length === 0) continue;
      await tx
        .insert(setting)
        .values({ key, value: patch, userId: SINGLE_USER_ID })
        .onConflictDoUpdate({
          target: setting.key,
          set: {
            value: sql`(CASE WHEN jsonb_typeof(${setting.value}) = 'object' AND ${setting.deletedAt} IS NULL THEN ${setting.value} ELSE '{}'::jsonb END) || excluded.value`,
            deletedAt: null,
            updatedAt: sql`now()`,
          },
        });
    }
    return getSettings(tx, config);
  });
}
