import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { contrast } from '../scripts/contrast.mjs';
import { outputs, loadTokens } from '../scripts/generate.mjs';

const tokens = loadTokens();
const modes = ['light', 'dark'] as const;

describe('Kontrast (WCAG 2.1 AA, Text >= 4,5 : 1)', () => {
  it('hat genau 12 Modulfarben mod-01 bis mod-12', () => {
    expect(Object.keys(tokens.module)).toEqual(
      Array.from({ length: 12 }, (_, i) => `mod-${String(i + 1).padStart(2, '0')}`),
    );
  });

  for (const mode of modes) {
    const c = tokens.color[mode];
    for (const [name, value] of Object.entries<{ light: string; dark: string }>(tokens.module)) {
      it(`${name} (${mode}) gegen bg und surface`, () => {
        expect(contrast(value[mode], c.bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(value[mode], c.surface)).toBeGreaterThanOrEqual(4.5);
      });
    }
    it(`Text, gedämpfter Text und Akzent (${mode})`, () => {
      expect(contrast(c.text, c.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c['text-muted'], c.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c['text-muted'], c.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.accent, c.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c['accent-contrast'], c.accent)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.record, c.bg)).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe('Raster und Bewegung', () => {
  it('Abstände liegen im 4-pt-Raster', () => {
    for (const v of Object.values<number>(tokens.space)) expect(v % 4).toBe(0);
  });
  it('Übergänge sind höchstens 150 ms', () => {
    for (const v of Object.values<number>(tokens.motion)) expect(v).toBeLessThanOrEqual(150);
  });
});

describe('Generator', () => {
  it('CSS enthält Hell-, Dunkel- und prefers-color-scheme-Block', () => {
    const css = outputs()['tokens.css'];
    expect(css).toContain(':root[data-theme="dark"]');
    expect(css).toContain('prefers-color-scheme: dark');
    expect(css).toContain('--sg-mod-12:');
  });
  it('generated/ ist aktuell', () => {
    for (const [name, content] of Object.entries(outputs())) {
      const file = new URL(`../generated/${name}`, import.meta.url);
      expect(readFileSync(file, 'utf8')).toBe(content);
    }
  });
});
