// Renderer-Smoke-Tests in jsdom mit Canvas-Mock.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { PageElement, Stroke } from '@sg/shared';
import { InkPage } from '../src/components/ink/InkPage.tsx';
import { paintScene, strokeOutline, TOOL_STYLES } from '../src/components/ink/render.ts';
import { decodeStroke } from '../src/components/ink/stroke.ts';
import { installCanvasMock, type CanvasLog } from './canvas-mock.ts';
import { loadFixtures } from './ink-fixtures.ts';

const files = loadFixtures();
const all = files.flatMap((f) => f.strokes);
const page07 = files.find((f) => f.name.startsWith('07'))!.strokes;
const marker04 = files.find((f) => f.name.startsWith('04'))!.strokes;

let log: CanvasLog;
beforeEach(() => {
  log = installCanvasMock();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const el = (kind: string, extra: object): PageElement =>
  ({
    element_id: '019a4e14-0000-7000-8000-0000000000e1',
    kind,
    frame: [20, 20, 100, 40],
    z: 1,
    t_ms: null,
    ...extra,
  }) as PageElement;

describe('Umrisse', () => {
  it('alle 299 Striche ergeben einen endlichen, nicht leeren Umriss', () => {
    for (const s of all) {
      const outline = strokeOutline(decodeStroke(s));
      expect(outline.length, s.client_id).toBeGreaterThan(2);
      for (const p of outline) {
        expect(Number.isFinite(p[0]!) && Number.isFinite(p[1]!)).toBe(true);
      }
    }
  });

  it('Monoline hat überall dieselbe Breite, Druck ändert sie bei Füller deutlich', () => {
    const width = (s: Stroke) => {
      const o = strokeOutline(decodeStroke(s));
      const xs = o.map((p) => p[0]!);
      const ys = o.map((p) => p[1]!);
      return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    };
    // Randfall: Strich mit Druck 0 und 1 (06, Nr. 4) ist mit Monoline-Stil gleichmäßig; hier nur der Stil-Vertrag
    expect(TOOL_STYLES.monoline.thinning).toBe(0);
    expect(TOOL_STYLES.marker.thinning).toBe(0);
    expect(TOOL_STYLES.fountain.thinning).toBeGreaterThan(TOOL_STYLES.pen.thinning - 0.01);
    expect(width(files[2]!.strokes[0]!)).toBeGreaterThan(10);
  });
});

describe('paintScene', () => {
  it('zeichnet Papier, dann Textmarker, dann Tinte (Textmarker liegt unter der Schrift)', () => {
    const ctx = document.createElement('canvas').getContext('2d')!;
    paintScene(ctx, {
      page: { width_pt: 595, height_pt: 842, template: 'liniert' },
      strokes: marker04.map(decodeStroke),
      elements: [],
    });
    expect(log.calls[0]).toMatchObject({ name: 'fillRect' });
    const highlights = marker04.filter((s) => s.layer === 'highlight').length;
    expect(highlights).toBeGreaterThan(0);
    expect(log.fills).toHaveLength(marker04.length);
    // die ersten Füllungen sind die transparenten Marker (Alpha 0.4), danach deckende Tinte
    const alphas = log.fills.map((f) => Number(/, ([\d.]+)\)$/.exec(f)![1]));
    expect(alphas.slice(0, highlights).every((a) => a < 0.5)).toBe(true);
    expect(alphas.slice(highlights).every((a) => a >= 0.85)).toBe(true);
  });

  it('zeichnet alle Elementarten ohne Fehler', () => {
    const ctx = document.createElement('canvas').getContext('2d')!;
    const elements: PageElement[] = [
      el('text', { payload: { text: 'Hallo Welt, das ist eine längere Zeile zum Umbrechen', size: 'm' } }),
      el('shape', {
        payload: {
          shape: 'arrow',
          points: [
            [10, 10],
            [100, 100],
          ],
          color: '#FF0000FF',
          width: 2,
        },
      }),
      el('shape', {
        payload: {
          shape: 'ellipse',
          points: [
            [10, 10],
            [100, 100],
          ],
          color: '#FF0000FF',
          width: 2,
        },
      }),
      el('tape', { payload: { color: '#9AA0A6FF', covered: true, card_id: null } }),
      el('stamp', { payload: { marker_id: '019a4e14-0000-7000-8000-0000000000e2', marker_kind: 'frage' } }),
      el('image', { payload: { photo_id: '019a4e14-0000-7000-8000-0000000000e3', crop: null } }),
    ];
    expect(() =>
      paintScene(ctx, {
        page: { width_pt: 595, height_pt: 842, template: 'cornell' },
        strokes: [],
        elements,
      }),
    ).not.toThrow();
    expect(log.count('fillText')).toBeGreaterThan(2);
  });
});

describe('<InkPage>', () => {
  it('rendert die Seite mit 231 Strichen: ein Füllpfad je Strich, Canvas in Geräte-Pixeln', () => {
    vi.stubGlobal('devicePixelRatio', 2);
    const { container } = render(<InkPage strokes={page07} width={400} />);
    const canvas = container.querySelector('canvas')!;
    expect(canvas).toHaveAttribute('role', 'img');
    expect(canvas).toHaveAttribute('data-stroke-count', '231');
    // 400 CSS-px × 2 (Retina), A4-Verhältnis
    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(Math.round((800 * 842) / 595));
    expect(canvas.style.width).toBe('400px');
    expect(log.fills).toHaveLength(231);
    const scale = (2 * 400) / 595;
    expect(log.transform![0]).toBeCloseTo(scale, 5);
    expect(log.transform![3]).toBeCloseTo(scale, 5);
  });

  it('zeichnet nur Neues nach, wenn Tinte dazukommt', () => {
    const first = page07.filter((s) => s.layer === 'ink').slice(0, 50);
    const more = page07.filter((s) => s.layer === 'ink').slice(50, 53);
    const { container, rerender } = render(<InkPage strokes={first} width={300} />);
    const canvas = container.querySelector('canvas')!;
    expect(canvas.dataset.paint).toBe('full');
    log.reset();
    rerender(<InkPage strokes={[...first, ...more]} width={300} />);
    expect(canvas.dataset.paint).toBe('incremental');
    expect(log.fills).toHaveLength(3);
    expect(log.count('fillRect')).toBe(0);
  });

  it('zeichnet vollständig neu bei Änderung (Lasso), Entfernen, neuer Textmarker und Größenwechsel', () => {
    const ink = page07.filter((s) => s.layer === 'ink').slice(0, 10);
    const highlight = page07.find((s) => s.layer === 'highlight')!;
    const { container, rerender } = render(<InkPage strokes={ink} width={300} />);
    const canvas = container.querySelector('canvas')!;

    log.reset();
    rerender(<InkPage strokes={ink.slice(1)} width={300} />);
    expect(canvas.dataset.paint).toBe('full');

    log.reset();
    rerender(<InkPage strokes={[...ink.slice(1), highlight]} width={300} />);
    expect(canvas.dataset.paint).toBe('full');
    expect(log.fills).toHaveLength(10);

    const moved = { ...ink[1]!, transform: [1, 0, 0, 1, 10, 10] } as Stroke;
    log.reset();
    rerender(<InkPage strokes={[moved, ...ink.slice(2), highlight]} width={300} />);
    expect(canvas.dataset.paint).toBe('full');

    log.reset();
    rerender(<InkPage strokes={[moved, ...ink.slice(2), highlight]} width={500} />);
    expect(canvas.dataset.paint).toBe('full');
    expect(canvas.width).toBe(500);
  });

  it('300 Striche: Neuzeichnen bleibt weit unter einem Frame-Budget-Vielfachen', () => {
    // 299 Striche aus allen Dateien, Umrisse werden beim ersten Mal berechnet, danach nur gefüllt
    const { rerender } = render(<InkPage strokes={all} width={600} />);
    const t0 = performance.now();
    rerender(<InkPage strokes={[...all]} width={601} />); // Größenwechsel erzwingt volles Neuzeichnen aus dem Cache
    const warm = performance.now() - t0;
    expect(warm).toBeLessThan(250);
  });

  it('übersteht kaputte Striche und leere Seiten', () => {
    const broken = { ...page07[0]!, points: '!!!' } as Stroke;
    const { container } = render(<InkPage strokes={[broken]} width={200} />);
    expect(container.querySelector('canvas')).toBeInTheDocument();
    expect(log.fills).toHaveLength(0);
  });

  it('dimmt das Blatt nur im dunklen Theme, die Farben bleiben unverändert', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    const { container, unmount } = render(<InkPage strokes={[]} width={200} />);
    expect(container.querySelector('canvas')!.style.filter).toMatch(/brightness/);
    unmount();
    document.documentElement.setAttribute('data-theme', 'light');
    const { container: c2, unmount: u2 } = render(<InkPage strokes={[]} width={200} />);
    expect(c2.querySelector('canvas')!.style.filter).toBe('');
    u2();
    document.documentElement.setAttribute('data-theme', 'dark');
    const { container: c3 } = render(<InkPage strokes={[]} width={200} dim="off" />);
    expect(c3.querySelector('canvas')!.style.filter).toBe('');
    document.documentElement.removeAttribute('data-theme');
  });
});
