// getSettings: Standards aus VERTRAEGE §14.1, gespeicherte Werte Feld für Feld darüber.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SettingsSchema, SINGLE_USER_ID } from '@sg/shared';
import { createDb, type DbHandle } from '../../src/db/client.ts';
import { setting } from '../../src/db/schema/index.ts';
import {
  DEFAULT_SETTINGS,
  getAiSettings,
  getLearningSettings,
  getSettings,
} from '../../src/services/settings.ts';
import { testDatabaseUrl } from './helpers.ts';

let handle: DbHandle;
const CONFIG = { dataDir: '/tmp/sg-einstellungen-test' };

beforeAll(() => {
  handle = createDb(testDatabaseUrl());
});
afterAll(async () => {
  await handle.sql`TRUNCATE setting`;
  await handle.close();
});
beforeEach(async () => {
  await handle.sql`TRUNCATE setting`;
});

const store = (key: string, value: unknown, deleted = false) =>
  handle.db
    .insert(setting)
    .values({ key, value, userId: SINGLE_USER_ID, deletedAt: deleted ? new Date() : null });

describe('getSettings', () => {
  it('liefert ohne gespeicherte Werte alle Standards (VERTRAEGE §14.1)', async () => {
    const settings = SettingsSchema.parse(await getSettings(handle.db, CONFIG));
    expect(settings).toEqual({
      general: { data_dir: '/tmp/sg-einstellungen-test', content_lang: 'de', appearance: 'system' },
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
      // Bereich `ai` (VERTRAEGE §20.7)
      ai: { monthly_budget_eur: 10, auto_accept: 'aus' },
      // Bereich `learning` (VERTRAEGE §21.9)
      learning: { review_budget_minutes: 20, new_cards_per_day: 20 },
    });
  });

  it('Bereich learning: gespeicherte Felder über den Standards, ungültige und unbekannte zählen nicht (§21.9)', async () => {
    await store('learning', { review_budget_minutes: 45, new_cards_per_day: 500, modell: 'x' });
    const expected = { review_budget_minutes: 45, new_cards_per_day: 20 };
    expect((await getSettings(handle.db, CONFIG)).learning).toEqual(expected);
    expect(await getLearningSettings(handle.db)).toEqual(expected);
    await handle.sql`TRUNCATE setting`;
    for (const bad of [4, 121, 30.5, '30', null]) {
      await handle.sql`TRUNCATE setting`;
      await store('learning', { review_budget_minutes: bad, new_cards_per_day: 0 });
      expect(await getLearningSettings(handle.db)).toEqual({
        review_budget_minutes: 20,
        new_cards_per_day: 0,
      });
    }
  });

  it('Bereich ai: gespeicherte Felder über den Standards, ungültige und unbekannte zählen nicht (§20.7)', async () => {
    await store('ai', { monthly_budget_eur: 25, auto_accept: 'bunt', modell: 'x' });
    expect((await getSettings(handle.db, CONFIG)).ai).toEqual({ monthly_budget_eur: 25, auto_accept: 'aus' });
    expect(await getAiSettings(handle.db)).toEqual({ monthly_budget_eur: 25, auto_accept: 'aus' });
    await handle.sql`TRUNCATE setting`;
    // außerhalb 0..1000, falscher Typ: Standard 10 (wie der Worker, §20.5)
    for (const bad of [-1, 1000.5, '20', null, true]) {
      await handle.sql`TRUNCATE setting`;
      await store('ai', { monthly_budget_eur: bad, auto_accept: 'nur_beziehungen' });
      expect(await getAiSettings(handle.db), String(bad)).toEqual({
        monthly_budget_eur: 10,
        auto_accept: 'nur_beziehungen',
      });
    }
    // 0 ist gültig (schaltet die Cloud-KI ab), ein gelöschter Bereich zählt nicht
    await handle.sql`TRUNCATE setting`;
    await store('ai', { monthly_budget_eur: 0 });
    expect((await getAiSettings(handle.db)).monthly_budget_eur).toBe(0);
    await handle.sql`TRUNCATE setting`;
    await store('ai', { monthly_budget_eur: 99 }, true);
    expect(await getAiSettings(handle.db)).toEqual(DEFAULT_SETTINGS.ai);
    expect(SettingsSchema.parse(await getSettings(handle.db, CONFIG)).ai).toEqual(DEFAULT_SETTINGS.ai);
  });

  it('legt gespeicherte Felder über die Standards; ungültige, unbekannte und gelöschte Werte zählen nicht', async () => {
    await store('lecture', {
      auto_stop_silence_min: 20,
      microphone_id: 'mic-1',
      auto_stop_max_duration_min: 0,
    });
    await store('pen', { favorite_colors: ['#FF0000FF'], squeeze: 'kneifen', unbekannt: 1 });
    await store('general', { appearance: 'dunkel', data_dir: '/woanders' });
    await store('data', 'kein Objekt');
    await store('ki', { modell: 'x' }); // späterer Bereich, gehört nicht zu Settings
    const settings = SettingsSchema.parse(await getSettings(handle.db, CONFIG));
    expect(settings.lecture).toEqual({
      ...DEFAULT_SETTINGS.lecture,
      auto_stop_silence_min: 20,
      microphone_id: 'mic-1',
    });
    expect(settings.pen).toEqual({ ...DEFAULT_SETTINGS.pen, favorite_colors: ['#FF0000FF'] });
    // data_dir kommt immer aus der App-Konfiguration (SG_DATA_DIR)
    expect(settings.general).toEqual({
      data_dir: '/tmp/sg-einstellungen-test',
      content_lang: 'de',
      appearance: 'dunkel',
    });
    expect(settings.data).toEqual(DEFAULT_SETTINGS.data);

    await handle.sql`TRUNCATE setting`;
    await store('data', { backup_target: '/Volumes/Backup' }, true);
    expect((await getSettings(handle.db, CONFIG)).data.backup_target).toBeNull();
  });

  it('gibt die Standards nicht als geteilte Objekte heraus', async () => {
    const a = await getSettings(handle.db, CONFIG);
    a.pen.favorite_colors.push('#123456FF');
    const b = await getSettings(handle.db, CONFIG);
    expect(b.pen.favorite_colors).toHaveLength(8);
  });
});
