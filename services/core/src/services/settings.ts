// Globale Einstellungen (F-EIN-01, VERTRAEGE §14.1). getSettings aus T1-DB; PATCH baut T1-19.
//
// Gespeichert ist je Bereich (`general`, `lecture`, `pen`, `data`) eine Zeile in `setting` mit dem Bereichsobjekt
// OHNE Standardwerte. getSettings füllt fehlende oder ungültige Felder mit den Standards auf.
import { and, inArray } from 'drizzle-orm';
import {
  DataSettingsUpdateSchema,
  GeneralSettingsUpdateSchema,
  LectureSettingsUpdateSchema,
  PenSettingsUpdateSchema,
  type DataSettings,
  type GeneralSettings,
  type LectureSettings,
  type PenSettings,
  type Settings,
} from '@sg/shared';
import type { z } from 'zod';
import { loadConfig } from '../config.ts';
import type { DbOrTx } from '../db/client.ts';
import { notDeleted, setting } from '../db/schema/index.ts';

export const SETTING_KEYS = ['general', 'lecture', 'pen', 'data'] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

/** Standards aus VERTRAEGE §14.1 (ohne `general.data_dir`, das kommt aus SG_DATA_DIR) */
export const DEFAULT_SETTINGS: {
  general: Omit<GeneralSettings, 'data_dir'>;
  lecture: LectureSettings;
  pen: PenSettings;
  data: DataSettings;
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

/** Alle Phase-1-Bereiche mit Standards aufgefüllt (`GET /settings`) */
export async function getSettings(db: DbOrTx): Promise<Settings> {
  const rows = await db
    .select({ key: setting.key, value: setting.value })
    .from(setting)
    .where(and(inArray(setting.key, [...SETTING_KEYS]), notDeleted(setting)));
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  return {
    general: {
      data_dir: loadConfig().dataDir,
      ...mergeArea(DEFAULT_SETTINGS.general, stored.get('general'), GeneralSettingsUpdateSchema),
    },
    lecture: mergeArea(DEFAULT_SETTINGS.lecture, stored.get('lecture'), LectureSettingsUpdateSchema),
    pen: mergeArea(DEFAULT_SETTINGS.pen, stored.get('pen'), PenSettingsUpdateSchema),
    data: mergeArea(DEFAULT_SETTINGS.data, stored.get('data'), DataSettingsUpdateSchema),
  };
}
