// Vorlagen-Geometrie (gleich wie iPad `InkTemplateGeometry.swift`, VERTRAEGE §7.4) und Folie unter den Notizen.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { InkPage } from '../src/components/ink/InkPage.tsx';
import {
  DOT_DIAMETER_PT,
  GRID_PT,
  LINE_WIDTH_PT,
  drawPaper,
  templateDots,
  templateLines,
} from '../src/components/ink/render.ts';
import { installCanvasMock, type CanvasLog } from './canvas-mock.ts';

let log: CanvasLog;
beforeEach(() => {
  log = installCanvasMock();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('Vorlagen-Geometrie wie auf dem iPad', () => {
  it('Konstanten', () => {
    expect(GRID_PT).toBe(14.173);
    expect(LINE_WIDTH_PT).toBe(0.7);
    expect(DOT_DIAMETER_PT).toBe(1.2);
  });

  // Tabelle: erwartete Werte nach InkTemplateGeometry.swift (A4 hoch und quer)
  const table = [
    { template: 'liniert', w: 595, h: 842, lines: 26, dots: 0 },
    { template: 'liniert', w: 842, h: 595, lines: 18, dots: 0 },
    { template: 'kariert', w: 595, h: 842, lines: 100, dots: 0 },
    { template: 'kariert', w: 842, h: 595, lines: 100, dots: 0 },
    { template: 'punktraster', w: 595, h: 842, lines: 0, dots: 2419 },
    { template: 'blanko', w: 595, h: 842, lines: 0, dots: 0 },
    { template: 'folie', w: 595, h: 842, lines: 0, dots: 0 },
  ] as const;
  it.each(table)('$template $w x $h: $lines Linien, $dots Punkte', ({ template, w, h, lines, dots }) => {
    expect(templateLines(template, w, h)).toHaveLength(lines);
    expect(templateDots(template, w, h)).toHaveLength(dots);
  });

  it('liniert: erste Linie bei 60, Abstand 30, Rand 40, letzte Linie über dem unteren Rand (20)', () => {
    const l = templateLines('liniert', 595, 842);
    expect(l[0]).toEqual({ x1: 40, y1: 60, x2: 555, y2: 60 });
    expect(l[1]!.y1 - l[0]!.y1).toBe(30);
    expect(l.at(-1)!.y1).toBe(810);
    expect(l.at(-1)!.y1).toBeLessThan(842 - 20);
  });

  it('kariert: Linienabstand 14,173, keine Linie auf dem Rand', () => {
    const l = templateLines('kariert', 595, 842);
    const horizontal = l.filter((x) => x.y1 === x.y2).map((x) => x.y1);
    const vertical = l.filter((x) => x.x1 === x.x2).map((x) => x.x1);
    expect(horizontal[0]).toBeCloseTo(14.173, 6);
    expect(horizontal[1]! - horizontal[0]!).toBeCloseTo(14.173, 6);
    expect(horizontal).toHaveLength(59);
    expect(vertical).toHaveLength(41);
    expect(vertical.at(-1)!).toBeLessThan(595);
    expect(l[0]).toEqual({ x1: 0, y1: 14.173, x2: 595, y2: 14.173 });
  });

  it('punktraster: erster Punkt bei (r, r), Punkte nur auf Kreuzungen im Inneren', () => {
    const d = templateDots('punktraster', 595, 842);
    expect(d[0]).toEqual([14.173, 14.173]);
    expect(d[1]).toEqual([2 * 14.173, 14.173]);
    expect(d.every(([x, y]) => x < 595 && y < 842)).toBe(true);
  });

  it('drawPaper kariert zeichnet Linien im 5-mm-Abstand; transparent lässt das Papier aus', () => {
    const ctx = document.createElement('canvas').getContext('2d')!;
    drawPaper(ctx, { width_pt: 595, height_pt: 842, template: 'kariert' });
    expect(log.calls[0]).toMatchObject({ name: 'fillRect' });
    expect(log.count('lineTo')).toBe(100);
    log.reset();
    drawPaper(ctx, { width_pt: 595, height_pt: 842, template: 'punktraster' }, true);
    expect(log.count('fillRect')).toBe(2419);
    expect(log.calls[0]!.args[0]).toBeCloseTo(14.173 - 0.6, 6);
  });
});

describe('<InkPage> mit Folie', () => {
  const SLIDE = '019a4e14-0000-7000-8000-0000000000a1';
  const SLIDE_B = '019a4e14-0000-7000-8000-0000000000a2';
  const under = (c: HTMLElement) => c.querySelector<HTMLCanvasElement>('canvas[data-layer="under"]')!;
  const img = (c: HTMLElement) => c.querySelector<HTMLImageElement>('img[data-layer="slide"]');
  const paperFills = () => log.calls.filter((c) => c.name === 'fillRect' && c.args[2] === 595).length;

  it('ohne background_slide_id: kein Bild, Papier wie bisher', () => {
    const { container } = render(
      <InkPage strokes={[]} width={300} page={{ template: 'liniert', background_slide_id: null }} />,
    );
    expect(img(container)).toBeNull();
    expect(paperFills()).toBe(1);
  });

  it('mit background_slide_id: Bild mit richtiger Adresse; Papier bis zum Laden, danach transparent', () => {
    const { container } = render(
      <InkPage strokes={[]} width={300} page={{ template: 'folie', background_slide_id: SLIDE }} />,
    );
    const image = img(container)!;
    expect(image.getAttribute('src')).toMatch(new RegExp(`/slides/${SLIDE}/image$`));
    expect(image.style.width).toBe('300px');
    // noch am Laden: deckendes Papier
    expect(paperFills()).toBe(1);
    log.reset();
    fireEvent.load(image);
    expect(paperFills()).toBe(0);
    expect(under(container).dataset.paint).toBe('full');
    expect(img(container)).not.toBeNull();
  });

  it('Bildfehler (404, Folie gelöscht): Bild weg, Papier bleibt, kein Fehlertext', () => {
    const { container } = render(
      <InkPage strokes={[]} width={300} page={{ template: 'folie', background_slide_id: SLIDE }} />,
    );
    fireEvent.error(img(container)!);
    expect(img(container)).toBeNull();
    expect(paperFills()).toBe(1);
    expect(container.textContent).toBe('');
  });

  it('Seitenwechsel von Folienseite zu freier Seite entfernt das Bild und malt Papier', () => {
    const { container, rerender } = render(
      <InkPage strokes={[]} width={300} page={{ template: 'folie', background_slide_id: SLIDE }} />,
    );
    fireEvent.load(img(container)!);
    log.reset();
    rerender(<InkPage strokes={[]} width={300} page={{ template: 'liniert', background_slide_id: null }} />);
    expect(img(container)).toBeNull();
    expect(paperFills()).toBe(1);
  });

  it('Wechsel auf eine andere Folie: neues Bild, bis es lädt wieder Papier', () => {
    const { container, rerender } = render(
      <InkPage strokes={[]} width={300} page={{ template: 'folie', background_slide_id: SLIDE }} />,
    );
    fireEvent.load(img(container)!);
    log.reset();
    rerender(<InkPage strokes={[]} width={300} page={{ template: 'folie', background_slide_id: SLIDE_B }} />);
    expect(img(container)!.getAttribute('src')).toMatch(new RegExp(`/slides/${SLIDE_B}/image$`));
    expect(paperFills()).toBe(1);
  });
});
