import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { contrast } from '../scripts/contrast.mjs';
import { outputs, loadTokens } from '../scripts/generate.mjs';

const tokens = loadTokens();

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
}
/** HSL-Farbton in Grad */
function hue(hex: string): number {
  const [r, g, b] = rgb(hex);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
/** HSL-Sättigung 0..1 */
function saturation(hex: string): number {
  const [r, g, b] = rgb(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  return max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
}
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
    it(`nicht-textuelle Elemente: border-strong >= 3 : 1 (${mode})`, () => {
      for (const bg of [c.bg, c.surface, c['surface-raised']]) {
        expect(contrast(c['border-strong'], bg)).toBeGreaterThanOrEqual(3);
      }
    });
    it(`Suchtreffer im PDF-Viewer (${mode}): Seite ist immer weiß, Text bleibt lesbar, Rahmen sichtbar`, () => {
      const page = '#ffffff';
      const pageText = tokens.color.light.text; // die Seite bleibt auch im dunklen Modus weiß
      // Die Treffer liegen mit multiply über der weißen Seite: dunkler Text darunter muss lesbar bleiben
      expect(contrast(pageText, c.hit)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(pageText, c['hit-active'])).toBeGreaterThanOrEqual(4.5);
      // Treffer heben sich von der Seite ab, der aktive deutlicher als die übrigen
      expect(contrast(c.hit, page)).toBeGreaterThanOrEqual(1.2);
      expect(contrast(c['hit-active'], page)).toBeGreaterThan(contrast(c.hit, page));
      expect(contrast(c['hit-outline'], page)).toBeGreaterThanOrEqual(3);
    });
    it(`keine Modulfarbe ist mit Aufnahme-Rot verwechselbar: Sättigung deutlich geringer (${mode})`, () => {
      for (const value of Object.values<{ light: string; dark: string }>(tokens.module)) {
        const hueClose = Math.min(hue(value[mode]), 360 - hue(value[mode])) < 25 || hue(value[mode]) > 335;
        if (hueClose) expect(saturation(c.record) - saturation(value[mode])).toBeGreaterThan(0.25);
      }
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
