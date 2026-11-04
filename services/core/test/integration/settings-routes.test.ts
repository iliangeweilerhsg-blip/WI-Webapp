// GET/PATCH /settings (VERTRAEGE §7.5, §14)
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiErrorSchema, SettingsSchema, type Settings } from '@sg/shared';
import { DEFAULT_SETTINGS } from '../../src/services/settings.ts';
import { startTestApp, type TestApp } from './helpers.ts';

let t: TestApp;
beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => {
  await t.handle.sql`TRUNCATE setting`;
  await t.close();
});
beforeEach(async () => {
  await t.handle.sql`TRUNCATE setting`;
});

const URL = '/api/v1/settings';
const get = async () => {
  const res = await t.request({ method: 'GET', url: URL });
  expect(res.statusCode, res.body).toBe(200);
  return SettingsSchema.parse(res.json());
};
const patch = (payload: unknown) => t.request({ method: 'PATCH', url: URL, payload: payload as object });
const patchOk = async (payload: unknown): Promise<Settings> => {
  const res = await patch(payload);
  expect(res.statusCode, res.body).toBe(200);
  return SettingsSchema.parse(res.json());
};
const errorOf = (res: { json: () => unknown }) => ApiErrorSchema.parse(res.json()).error;

describe('GET /settings', () => {
  it('liefert die Standards und data_dir aus der Konfiguration', async () => {
    const settings = await get();
    expect(settings.general).toEqual({
      data_dir: t.config.dataDir,
      content_lang: 'de',
      appearance: 'system',
    });
    expect(settings.lecture).toEqual(DEFAULT_SETTINGS.lecture);
    expect(settings.pen).toEqual(DEFAULT_SETTINGS.pen);
    expect(settings.data).toEqual(DEFAULT_SETTINGS.data);
  });
});

describe('PATCH /settings', () => {
  it('ändert den Bereich „general“ und lässt data_dir unangetastet', async () => {
    const settings = await patchOk({ general: { content_lang: 'en', appearance: 'dunkel' } });
    expect(settings.general).toEqual({
      data_dir: t.config.dataDir,
      content_lang: 'en',
      appearance: 'dunkel',
    });
    expect(await get()).toEqual(settings);
  });

  it('ändert den Bereich „lecture“, auch mit null für das Mikrofon', async () => {
    await patchOk({ lecture: { microphone_id: 'mic-1', auto_stop_max_duration_min: 180 } });
    const settings = await patchOk({
      lecture: { toolbar_side: 'links', default_layout: 'fokus', default_ink_mode: 'auf_folie' },
    });
    expect(settings.lecture).toEqual({
      ...DEFAULT_SETTINGS.lecture,
      microphone_id: 'mic-1',
      auto_stop_max_duration_min: 180,
      toolbar_side: 'links',
      default_layout: 'fokus',
      default_ink_mode: 'auf_folie',
    });
    const reset = await patchOk({ lecture: { microphone_id: null } });
    expect(reset.lecture.microphone_id).toBeNull();
    expect(reset.lecture.auto_stop_max_duration_min).toBe(180);
  });

  it('ändert den Bereich „pen“ inklusive Lieblingsfarben', async () => {
    const settings = await patchOk({
      pen: { double_tap: 'system', squeeze: 'aus', shape_recognition: true, favorite_colors: ['#112233FF'] },
    });
    expect(settings.pen).toEqual({
      double_tap: 'system',
      squeeze: 'aus',
      shape_recognition: true,
      favorite_colors: ['#112233FF'],
    });
  });

  it('ändert den Bereich „data“ mit gültigem Backup-Ordner', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sg-backup-'));
    const settings = await patchOk({
      data: { backup_target: dir, backup_encryption: true, backup_time: '04:30' },
    });
    expect(settings.data).toEqual({ backup_target: dir, backup_encryption: true, backup_time: '04:30' });
    const cleared = await patchOk({ data: { backup_target: null } });
    expect(cleared.data.backup_target).toBeNull();
    expect(cleared.data.backup_time).toBe('04:30');
  });

  it('Teil-Update lässt alle anderen Felder und Bereiche unverändert', async () => {
    const before = await patchOk({ lecture: { auto_stop_warning_s: 30 }, pen: { shape_recognition: true } });
    const after = await patchOk({ lecture: { auto_stop_extend_min: 20 } });
    expect(after.lecture).toEqual({ ...before.lecture, auto_stop_extend_min: 20 });
    expect(after.pen).toEqual(before.pen);
    expect(after.general).toEqual(before.general);
    expect(after.data).toEqual(before.data);
  });

  it('leerer Body und leere Bereiche ändern nichts', async () => {
    const before = await get();
    expect(await patchOk({})).toEqual(before);
    expect(await patchOk({ lecture: {}, pen: {} })).toEqual(before);
    const [row] = await t.handle.sql`SELECT count(*)::int AS n FROM setting`;
    expect(row?.n).toBe(0);
  });

  it('speichert nur die geänderten Felder, ohne Standardwerte (§14.1)', async () => {
    await patchOk({ lecture: { auto_stop_silence_min: 20 } });
    const rows = await t.handle.sql`SELECT key, value FROM setting`;
    expect(rows.map((r) => ({ key: r.key, value: r.value }))).toEqual([
      { key: 'lecture', value: { auto_stop_silence_min: 20 } },
    ]);
  });

  it('wiederholtes Senden desselben Updates ist unschädlich', async () => {
    const first = await patchOk({ lecture: { auto_stop_silence_min: 20 } });
    expect(await patchOk({ lecture: { auto_stop_silence_min: 20 } })).toEqual(first);
  });

  it('ein gelöschter Bereich wird neu angelegt, ohne alte Werte', async () => {
    await patchOk({ pen: { double_tap: 'aus' } });
    await t.handle.sql`UPDATE setting SET deleted_at = now() WHERE key = 'pen'`;
    const settings = await patchOk({ pen: { squeeze: 'radierer' } });
    expect(settings.pen).toEqual({ ...DEFAULT_SETTINGS.pen, squeeze: 'radierer' });
  });

  describe('ungültige Werte (400, nichts wird gespeichert)', () => {
    const cases: [string, unknown][] = [
      ['data_dir ist nur lesbar', { general: { data_dir: '/anderswo' } }],
      ['unbekannter Bereich', { ki: { an: true } }],
      ['unbekanntes Feld', { lecture: { gibt_es_nicht: 1 } }],
      ['Aufzählung', { general: { appearance: 'bunt' } }],
      ['Sprache', { general: { content_lang: 'fr' } }],
      ['Minuten 0', { lecture: { auto_stop_after_end_min: 0 } }],
      ['Minuten keine ganze Zahl', { lecture: { auto_stop_silence_min: 1.5 } }],
      ['Hinweis negativ', { lecture: { auto_stop_warning_s: -1 } }],
      ['Layout', { lecture: { default_layout: 'riesig' } }],
      ['Händigkeit', { lecture: { toolbar_side: 'oben' } }],
      ['Stift-Aktion', { pen: { double_tap: 'explodieren' } }],
      ['Formerkennung kein Boolean', { pen: { shape_recognition: 'ja' } }],
      ['Farbe ohne Alpha', { pen: { favorite_colors: ['#112233'] } }],
      ['mehr als 8 Farben', { pen: { favorite_colors: Array<string>(9).fill('#112233FF') } }],
      ['Uhrzeit', { data: { backup_time: '24:00' } }],
      ['Uhrzeit ohne Doppelpunkt', { data: { backup_time: '0300' } }],
    ];
    for (const [name, payload] of cases) {
      it(name, async () => {
        const res = await patch(payload);
        expect(res.statusCode, res.body).toBe(400);
        expect(errorOf(res).code).toBe('validation_failed');
        const [row] = await t.handle.sql`SELECT count(*)::int AS n FROM setting`;
        expect(row?.n).toBe(0);
      });
    }

    it('Kombination aus gültigem und ungültigem Bereich speichert nichts', async () => {
      const res = await patch({ lecture: { toolbar_side: 'links' }, pen: { double_tap: 'nix' } });
      expect(res.statusCode).toBe(400);
      expect((await get()).lecture.toolbar_side).toBe('rechts');
    });
  });

  describe('backup_target_invalid', () => {
    it('relativer Pfad', async () => {
      const res = await patch({ data: { backup_target: 'backups/hier' } });
      expect(res.statusCode).toBe(400);
      expect(errorOf(res).code).toBe('backup_target_invalid');
    });

    it('Ordner existiert nicht', async () => {
      const res = await patch({
        data: { backup_target: join(tmpdir(), 'sg-gibt-es-garantiert-nicht-7f3a') },
      });
      expect(res.statusCode).toBe(400);
      expect(errorOf(res).code).toBe('backup_target_invalid');
    });

    it('Pfad ist eine Datei', async () => {
      const file = join(mkdtempSync(join(tmpdir(), 'sg-backup-')), 'datei.txt');
      writeFileSync(file, 'x');
      const res = await patch({ data: { backup_target: file } });
      expect(res.statusCode).toBe(400);
      expect(errorOf(res).code).toBe('backup_target_invalid');
    });

    it('bei ungültigem Ziel wird auch der Rest der Anfrage nicht gespeichert', async () => {
      const res = await patch({ data: { backup_target: 'relativ' }, lecture: { toolbar_side: 'links' } });
      expect(res.statusCode).toBe(400);
      expect((await get()).lecture.toolbar_side).toBe('rechts');
    });
  });
});
