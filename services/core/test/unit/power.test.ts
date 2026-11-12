// Akku des Macs (UX-315): pmset-Ausgabe lesen, Zwischenspeicher, Fehlerfälle
import { describe, expect, it, vi } from 'vitest';
import { SystemPowerSchema } from '@sg/shared';
import { PowerMeter, POWER_TTL_MS, parsePmset, runPmset } from '../../src/services/power.ts';

const BATTERY = `Now drawing from 'Battery Power'
 -InternalBattery-0 (id=4653155)\t14%; discharging; 0:41 remaining present: true
`;
const CHARGING = `Now drawing from 'AC Power'
 -InternalBattery-0 (id=4653155)\t87%; charging; 0:52 remaining present: true
`;
const CHARGED = `Now drawing from 'AC Power'
 -InternalBattery-0 (id=4653155)\t100%; charged; 0:00 remaining present: true
`;
const NO_BATTERY = `Now drawing from 'AC Power'
`;

describe('parsePmset', () => {
  it('Akkubetrieb', () => {
    expect(parsePmset(BATTERY)).toEqual({ has_battery: true, percent: 14, on_ac: false });
  });
  it('am Netzteil, ladend und voll', () => {
    expect(parsePmset(CHARGING)).toEqual({ has_battery: true, percent: 87, on_ac: true });
    expect(parsePmset(CHARGED)).toEqual({ has_battery: true, percent: 100, on_ac: true });
  });
  it('ohne Akku (Mac mini) oder bei unlesbarem Text: kein Akku', () => {
    const none = { has_battery: false, percent: null, on_ac: null };
    expect(parsePmset(NO_BATTERY)).toEqual(none);
    expect(parsePmset('')).toEqual(none);
    expect(parsePmset('Fehler: nicht verfügbar')).toEqual(none);
    expect(parsePmset(' -InternalBattery-0 (id=1)\t140%; x')).toEqual(none);
  });
  it('weitere echte Formen: nicht ladend am Netz, Ladeende, ältere macOS, ohne Schätzung', () => {
    expect(
      parsePmset(`Now drawing from 'AC Power'
 -InternalBattery-0 (id=4653155)\t80%; AC attached; not charging present: true
`),
    ).toEqual({ has_battery: true, percent: 80, on_ac: true });
    expect(
      parsePmset(`Now drawing from 'AC Power'
 -InternalBattery-0 (id=4653155)\t99%; finishing charge; 0:05 remaining present: true
`),
    ).toEqual({ has_battery: true, percent: 99, on_ac: true });
    expect(
      parsePmset(`Currently drawing from 'Battery Power'
 -InternalBattery-0\t9%; discharging; (no estimate) present: true
`),
    ).toEqual({ has_battery: true, percent: 9, on_ac: false });
  });
  it('unbekannte Quelle: on_ac null', () => {
    expect(parsePmset(' -InternalBattery-0 (id=1)\t50%; discharging;')).toEqual({
      has_battery: true,
      percent: 50,
      on_ac: null,
    });
  });
});

describe('PowerMeter', () => {
  it('liest unter macOS über pmset und passt zum Schema', async () => {
    const run = vi.fn(async () => BATTERY);
    const meter = new PowerMeter({ platform: 'darwin', run, now: () => Date.parse('2026-11-12T08:00:00Z') });
    const value = await meter.read();
    expect(SystemPowerSchema.safeParse(value).success).toBe(true);
    expect(value).toEqual({
      has_battery: true,
      percent: 14,
      on_ac: false,
      measured_at: '2026-11-12T08:00:00.000Z',
    });
  });

  it('Linux: kein Akku, pmset läuft nie', async () => {
    const run = vi.fn(async () => BATTERY);
    const value = await new PowerMeter({ platform: 'linux', run }).read();
    expect(value).toMatchObject({ has_battery: false, percent: null, on_ac: null });
    expect(run).not.toHaveBeenCalled();
  });

  it('scheitert pmset: kein Akku, kein Fehler, Meldung an onError', async () => {
    const onError = vi.fn();
    const meter = new PowerMeter({
      platform: 'darwin',
      run: async () => {
        throw new Error('Zeitüberschreitung');
      },
      onError,
    });
    const value = await meter.read();
    expect(value).toMatchObject({ has_battery: false, percent: null, on_ac: null });
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('gilt 30 Sekunden, danach neu', async () => {
    let t = 1_000_000;
    const run = vi.fn(async () => BATTERY);
    const meter = new PowerMeter({ platform: 'darwin', run, now: () => t });
    await meter.read();
    t += POWER_TTL_MS - 1;
    await meter.read();
    expect(run).toHaveBeenCalledTimes(1);
    t += 1;
    await meter.read();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('gleichzeitige Aufrufe teilen sich einen Lauf', async () => {
    const run = vi.fn(async () => CHARGING);
    const meter = new PowerMeter({ platform: 'darwin', run });
    const [a, b] = await Promise.all([meter.read(), meter.read()]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });
});

describe('runPmset', () => {
  it.skipIf(process.platform === 'darwin')('ohne pmset (Linux): Fehler statt Absturz', async () => {
    await expect(runPmset()).rejects.toBeInstanceOf(Error);
  });
});
