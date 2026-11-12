// UX-315: Schwellen für die Akku-Hinweise
import { describe, expect, it } from 'vitest';
import type { SystemPower } from '@sg/shared';
import { isBatteryLow, isBatteryLowForStart } from '../src/lib/system.ts';

const power = (over: Partial<SystemPower> = {}): SystemPower => ({
  has_battery: true,
  percent: 50,
  on_ac: false,
  measured_at: '2026-11-12T08:00:00Z',
  ...over,
});

describe('isBatteryLow (Statusleiste, unter 20 %)', () => {
  it('nur im Akkubetrieb unter 20 %', () => {
    expect(isBatteryLow(power({ percent: 19 }))).toBe(true);
    expect(isBatteryLow(power({ percent: 20 }))).toBe(false);
    expect(isBatteryLow(power({ percent: 5, on_ac: true }))).toBe(false);
  });
  it('schweigt bei unbekannter Quelle, ohne Akku und ohne Antwort', () => {
    expect(isBatteryLow(power({ percent: 5, on_ac: null }))).toBe(false);
    expect(isBatteryLow(power({ has_battery: false, percent: null, on_ac: null }))).toBe(false);
    expect(isBatteryLow(undefined)).toBe(false);
  });
});

describe('isBatteryLowForStart (Start-Karte, unter 40 %)', () => {
  it('Grenze bei 40 %', () => {
    expect(isBatteryLowForStart(power({ percent: 39 }))).toBe(true);
    expect(isBatteryLowForStart(power({ percent: 40 }))).toBe(false);
    expect(isBatteryLowForStart(power({ percent: 10, on_ac: true }))).toBe(false);
    expect(isBatteryLowForStart(undefined)).toBe(false);
  });
});
