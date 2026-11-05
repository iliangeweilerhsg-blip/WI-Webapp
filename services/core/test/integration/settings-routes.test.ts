// GET/PATCH /settings (VERTRAEGE §7.5, §14)
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiErrorSchema, SettingsSchema, SINGLE_USER_ID, type Settings } from '@sg/shared';
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
      data: { backup_target: dir, backup_encryption: false, backup_time: '04:30' },
    });
    expect(settings.data).toEqual({
      backup_target: realpathSync(dir),
      backup_encryption: false,
      backup_time: '04:30',
    });
    const cleared = await patchOk({ data: { backup_target: null } });
    expect(cleared.data.backup_target).toBeNull();
    expect(cleared.data.backup_time).toBe('04:30');
  });

  it('backup_encryption: true ergibt 400 backup_encryption_unavailable und ändert nichts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sg-backup-'));
    const res = await patch({ data: { backup_target: dir, backup_encryption: true } });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res).code).toBe('backup_encryption_unavailable');
    expect((await get()).data).toEqual(DEFAULT_SETTINGS.data);
    // Ausschalten bleibt erlaubt
    expect((await patchOk({ data: { backup_encryption: false } })).data.backup_encryption).toBe(false);
  });

  it('Altbestand backup_encryption=true bleibt lesbar und lässt sich ausschalten', async () => {
    await t.handle
      .sql`INSERT INTO setting (key, value, user_id) VALUES ('data', '{"backup_encryption": true}'::jsonb, ${SINGLE_USER_ID})`;
    expect((await get()).data.backup_encryption).toBe(true);
    expect((await patchOk({ data: { backup_time: '05:00' } })).data.backup_encryption).toBe(true);
    expect((await patchOk({ data: { backup_encryption: false } })).data.backup_encryption).toBe(false);
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
      ['Mikrofon-ID zu lang', { lecture: { microphone_id: 'x'.repeat(257) } }],
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

    const expectInvalid = async (target: string) => {
      const res = await patch({ data: { backup_target: target } });
      expect(res.statusCode, res.body).toBe(400);
      expect(errorOf(res).code).toBe('backup_target_invalid');
    };

    it('leerer Pfad', () => expectInvalid(''));

    it('Datenordner und Ordner darin', async () => {
      const inner = join(t.config.dataDir, 'backups');
      mkdirSync(inner, { recursive: true });
      await expectInvalid(t.config.dataDir);
      await expectInvalid(inner);
      const link = join(mkdtempSync(join(tmpdir(), 'sg-backup-')), 'zum-datenordner');
      symlinkSync(inner, link);
      await expectInvalid(link);
    });

    it('Systemordner', async () => {
      for (const path of ['/proc', '/sys', '/dev', '/proc/self']) await expectInvalid(path);
    });

    it('nicht beschreibbarer Ordner', async (ctx) => {
      if (process.getuid?.() === 0) return ctx.skip();
      const dir = mkdtempSync(join(tmpdir(), 'sg-backup-'));
      chmodSync(dir, 0o555);
      await expectInvalid(dir);
    });

    it('bei ungültigem Ziel wird auch der Rest der Anfrage nicht gespeichert', async () => {
      const res = await patch({ data: { backup_target: 'relativ' }, lecture: { toolbar_side: 'links' } });
      expect(res.statusCode).toBe(400);
      expect((await get()).lecture.toolbar_side).toBe('rechts');
    });

    it('speichert den normalisierten Pfad (realpath, ohne „..“ und Symlink)', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'sg-backup-'));
      mkdirSync(join(dir, 'ziel'));
      const link = join(dir, 'link');
      symlinkSync(join(dir, 'ziel'), link);
      const settings = await patchOk({ data: { backup_target: `${link}/../ziel/.` } });
      expect(settings.data.backup_target).toBe(realpathSync(join(dir, 'ziel')));
    });
  });

  describe('nur lokal ändern', () => {
    let remote: TestApp;
    beforeAll(async () => {
      remote = await startTestApp(
        {},
        {
          verifyDeviceToken: async () => ({ deviceId: '0190f6a2-0000-7000-8000-0000000000f1' }),
        },
      );
    });
    afterAll(async () => {
      await remote.close();
    });
    const fromNetwork = (payload: object) =>
      remote.app.inject({
        method: 'PATCH',
        url: URL,
        remoteAddress: '192.168.1.20',
        headers: { host: 'mac.local:4710', authorization: 'Bearer EXAMPLEdevicetoken000' },
        payload,
      });

    it('backup_target aus dem Netz: 403 local_only, nichts gespeichert', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'sg-backup-'));
      for (const target of [dir, null]) {
        const res = await fromNetwork({
          lecture: { toolbar_side: 'links' },
          data: { backup_target: target },
        });
        expect(res.statusCode, res.body).toBe(403);
        expect(errorOf(res).code).toBe('local_only');
      }
      expect((await get()).lecture.toolbar_side).toBe('rechts');
    });

    it('andere Einstellungen aus dem Netz sind erlaubt', async () => {
      const res = await fromNetwork({ data: { backup_time: '05:00' }, pen: { double_tap: 'aus' } });
      expect(res.statusCode, res.body).toBe(200);
      expect((await get()).data.backup_time).toBe('05:00');
    });
  });

  it('parallele PATCHes verschiedener Felder gehen nicht verloren (15 Runden à 24)', async () => {
    const fields = Array.from({ length: 24 }, (_, i) => i);
    for (let round = 0; round < 15; round += 1) {
      await t.handle.sql`TRUNCATE setting`;
      const values = fields.map((i) => 1 + ((round * 7 + i * 13) % 500));
      const names = [
        'auto_stop_after_end_min',
        'auto_stop_quiet_window_min',
        'auto_stop_hard_after_end_min',
        'auto_stop_silence_min',
        'auto_stop_max_duration_min',
        'auto_stop_extend_min',
      ] as const;
      const sends = fields.map((i) => {
        const name = names[i % names.length] as (typeof names)[number];
        // Mehrere PATCHes je Feld: der letzte Wert je Feld ist unbestimmt, alle Werte sind gültig
        return patch(
          i < 6
            ? { lecture: { [name]: values[i] } }
            : i < 12
              ? { pen: { double_tap: 'aus' } }
              : i < 18
                ? { general: { content_lang: 'en' } }
                : { data: { backup_time: '04:00' } },
        );
      });
      const responses = await Promise.all(sends);
      for (const res of responses) expect(res.statusCode, res.body).toBe(200);
      const settings = await get();
      names.forEach((name, i) => expect(settings.lecture[name]).toBe(values[i]));
      expect(settings.pen.double_tap).toBe('aus');
      expect(settings.general.content_lang).toBe('en');
      expect(settings.data.backup_time).toBe('04:00');
    }
  });
});
