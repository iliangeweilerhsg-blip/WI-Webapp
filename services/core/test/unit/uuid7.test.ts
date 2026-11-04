import { describe, expect, it } from 'vitest';
import { uuidv7, uuidv7Time } from '../../src/lib/uuid7.ts';

describe('uuidv7', () => {
  it('hat Version 7 und Variante 10', () => {
    const id = uuidv7();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('trägt den Zeitstempel in den ersten 48 Bit', () => {
    const now = Date.now() + 10_000_000; // sicher nach allen vorherigen Aufrufen
    expect(uuidv7Time(uuidv7(now))).toBe(now);
  });

  it('ist streng aufsteigend, auch innerhalb derselben Millisekunde und bei rückwärts laufender Uhr', () => {
    const base = Date.now() + 20_000_000;
    const ids = [uuidv7(base), uuidv7(base), uuidv7(base), uuidv7(base - 5), uuidv7(base + 1)];
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
  });

  it('bleibt bei Zählerüberlauf aufsteigend', () => {
    const base = Date.now() + 30_000_000;
    const ids = Array.from({ length: 5000 }, () => uuidv7(base));
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
