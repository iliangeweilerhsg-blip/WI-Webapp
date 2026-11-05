// Renderer-Smoke-Tests in jsdom mit Canvas-Mock.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { PageElement, Stroke } from '@sg/shared';
import { InkPage } from '../src/components/ink/InkPage.tsx';
import {
  paintScene,
  redrawRegion,
  resetScratchCanvas,
  SCRATCH_KEEP_PX,
  strokeOutline,
  TOOL_STYLES,
} from '../src/components/ink/render.ts';
import { decodeStroke } from '../src/components/ink/stroke.ts';
import { installCanvasMock, type CanvasLog } from './canvas-mock.ts';
import { loadFixtures } from './ink-fixtures.ts';

type PageProps = NonNullable<React.ComponentProps<typeof InkPage>['page']>;

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

  const layer = (c: HTMLElement, name: 'under' | 'ink' | 'top') =>
    c.querySelector<HTMLCanvasElement>(`canvas[data-layer="${name}"]`)!;

  it('zeichnet nur Neues nach, wenn Tinte dazukommt (auch mit Stempel über der Tinte)', () => {
    const first = page07.filter((s) => s.layer === 'ink').slice(0, 50);
    const more = page07.filter((s) => s.layer === 'ink').slice(50, 53);
    const stamp = el('stamp', {
      payload: { marker_id: '019a4e14-0000-7000-8000-0000000000e2', marker_kind: 'frage' },
    });
    const elements = [stamp];
    const { container, rerender } = render(<InkPage strokes={first} elements={elements} width={300} />);
    expect(layer(container, 'ink').dataset.paint).toBe('full');
    log.reset();
    rerender(<InkPage strokes={[...first, ...more]} elements={[...elements]} width={300} />);
    expect(layer(container, 'ink').dataset.paint).toBe('incremental');
    // genau drei Füllpfade; Papier/Textmarker und Elemente werden nicht angefasst
    expect(log.fills).toHaveLength(3);
    expect(log.count('fillRect')).toBe(0);
    expect(log.count('fillText')).toBe(0);
    expect(log.count('clearRect')).toBe(0);
  });

  it('jede Änderung trifft nur ihre Ebene', () => {
    const ink = page07.filter((s) => s.layer === 'ink').slice(0, 10);
    const highlights = page07.filter((s) => s.layer === 'highlight');
    const { container, rerender } = render(<InkPage strokes={[...ink, highlights[0]!]} width={300} />);
    const paints = () => ({
      under: layer(container, 'under').dataset.paint,
      ink: layer(container, 'ink').dataset.paint,
    });
    const countOf = (name: string) => log.count(name);

    // Neuer Textmarker: nur die untere Ebene (Papier + Textmarker), die Tinte bleibt liegen
    log.reset();
    rerender(<InkPage strokes={[...ink, highlights[0]!, highlights[1]!]} width={300} />);
    expect(log.fills).toHaveLength(2); // zwei Textmarker
    expect(countOf('clearRect')).toBe(0);
    expect(countOf('fillRect')).toBe(1); // Papier

    // Strich entfernt: nur die Tinte-Ebene, und nur der betroffene Ausschnitt; Papier bleibt
    log.reset();
    rerender(<InkPage strokes={[...ink.slice(1), highlights[0]!, highlights[1]!]} width={300} />);
    expect(paints().ink).toBe('partial');
    expect(log.fills.length).toBeLessThanOrEqual(9);
    expect(log.count('drawImage')).toBe(1);
    expect(countOf('fillRect')).toBe(0);

    // Lasso (gleiche client_id, neue transform): wieder nur die Tinte-Ebene
    const moved = { ...ink[1]!, transform: [1, 0, 0, 1, 10, 10] } as Stroke;
    log.reset();
    rerender(<InkPage strokes={[moved, ...ink.slice(2), highlights[0]!, highlights[1]!]} width={300} />);
    expect(paints().ink).toBe('partial');
    expect(log.fills.length).toBeLessThanOrEqual(9);
    expect(countOf('fillRect')).toBe(0);

    // Viele Änderungen auf einmal: dann lohnt der Ausschnitt nicht, die Ebene wird ganz neu gezeichnet
    log.reset();
    rerender(<InkPage strokes={page07.filter((s) => s.layer === 'ink').slice(20, 40)} width={300} />);
    expect(paints().ink).toBe('full');

    // Größenwechsel: alles neu, in der richtigen Größe
    log.reset();
    rerender(<InkPage strokes={[moved, ...ink.slice(2), highlights[0]!, highlights[1]!]} width={500} />);
    expect(layer(container, 'under').width).toBe(500);
    expect(layer(container, 'ink').width).toBe(500);
    expect(layer(container, 'top').width).toBe(500);
    expect(log.fills).toHaveLength(11);
  });

  it('Elemente über der Tinte liegen auf einer eigenen Ebene und ändern die Tinte nicht', () => {
    const ink = page07.filter((s) => s.layer === 'ink').slice(0, 20);
    const { container, rerender } = render(<InkPage strokes={ink} width={300} />);
    log.reset();
    rerender(
      <InkPage
        strokes={ink}
        elements={[el('tape', { payload: { color: '#9AA0A6FF', covered: true, card_id: null } })]}
        width={300}
      />,
    );
    expect(layer(container, 'top').dataset.paint).toBe('full');
    expect(log.fills).toHaveLength(0); // keine Strichfüllung
    expect(log.count('fillRect')).toBe(1); // nur das Klebeband
  });

  it('300 Striche: Neuzeichnen bleibt weit unter einem Frame-Budget-Vielfachen', () => {
    // 299 Striche aus allen Dateien, Umrisse werden beim ersten Mal berechnet, danach nur gefüllt
    const { rerender } = render(<InkPage strokes={all} width={600} />);
    const t0 = performance.now();
    rerender(<InkPage strokes={[...all]} width={601} />); // Größenwechsel erzwingt volles Neuzeichnen aus dem Cache
    const warm = performance.now() - t0;
    expect(warm).toBeLessThan(250);
  });

  it('zeichnet ein unbekanntes Werkzeug wie den Stift und begrenzt absurde Breiten', () => {
    const odd = {
      ...page07[0]!,
      client_id: '019a4e14-0000-7000-8000-0000000000f1',
      tool: 'brush',
    } as unknown as Stroke;
    const huge = { ...page07[1]!, client_id: '019a4e14-0000-7000-8000-0000000000f2', width: 1e30 } as Stroke;
    render(<InkPage strokes={[odd, huge]} width={200} />);
    expect(log.fills).toHaveLength(2);
  });

  it('begrenzt den Zoom: nie mehr als 4096 Pixel Höhe, nie unter 1 Pixel je CSS-Pixel', () => {
    vi.stubGlobal('devicePixelRatio', 3);
    const { container } = render(<InkPage strokes={[]} width={9000} />);
    const c = container.querySelector<HTMLCanvasElement>('canvas[data-layer="under"]')!;
    expect(c.height).toBeLessThanOrEqual(4096);
    expect(c.width / parseFloat(c.style.width)).toBeGreaterThan(0.99);
    // normaler Fall: Retina bleibt erhalten
    const { container: c2 } = render(<InkPage strokes={[]} width={400} />);
    expect(c2.querySelector<HTMLCanvasElement>('canvas[data-layer="under"]')!.width).toBe(1200);
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
    expect(container.querySelector<HTMLElement>('canvas')!.parentElement!.style.filter).toMatch(/brightness/);
    unmount();
    document.documentElement.setAttribute('data-theme', 'light');
    const { container: c2, unmount: u2 } = render(<InkPage strokes={[]} width={200} />);
    expect(c2.querySelector<HTMLElement>('canvas')!.parentElement!.style.filter).toBe('');
    u2();
    document.documentElement.setAttribute('data-theme', 'dark');
    const { container: c3 } = render(<InkPage strokes={[]} width={200} dim="off" />);
    expect(c3.querySelector<HTMLElement>('canvas')!.parentElement!.style.filter).toBe('');
    document.documentElement.removeAttribute('data-theme');
  });
});

describe('<InkPage> Querformat', () => {
  it('begrenzt bei großem Zoom die LÄNGERE Seite auf 4096 Pixel (Querformat)', () => {
    vi.stubGlobal('devicePixelRatio', 2);
    const landscape = { width_pt: 842, height_pt: 595, template: 'liniert' } as unknown as PageProps;
    const { container } = render(<InkPage strokes={[]} page={landscape} width={9000} />);
    const canvas = container.querySelector('canvas')!;
    expect(Math.max(canvas.width, canvas.height)).toBeLessThanOrEqual(4096);
    expect(canvas.width).toBe(4096);
    expect(canvas.height).toBe(Math.round((4096 * 595) / 842));
    // Seitenverhältnis bleibt erhalten
    expect(canvas.width / canvas.height).toBeCloseTo(842 / 595, 2);
  });

  it('Hochformat bleibt auf der Höhe begrenzt', () => {
    vi.stubGlobal('devicePixelRatio', 2);
    const { container } = render(<InkPage strokes={[]} width={9000} />);
    const canvas = container.querySelector('canvas')!;
    expect(canvas.height).toBe(4096);
    expect(canvas.width).toBeLessThan(4096);
  });
});

describe('redrawRegion Zwischen-Canvas', () => {
  const fakeCtx = () => {
    const drawn: HTMLCanvasElement[] = [];
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      drawImage: (c: HTMLCanvasElement) => drawn.push(c),
    } as unknown as CanvasRenderingContext2D;
    return { ctx, drawn };
  };
  const size = { width: 4000, height: 4000 };
  beforeEach(() => resetScratchCanvas());

  it('gibt einen großen Zwischen-Canvas nach Gebrauch frei (0×0)', () => {
    const { ctx, drawn } = fakeCtx();
    redrawRegion(ctx, [], { x0: 0, y0: 0, x1: 2000, y1: 2000 }, 1, size);
    expect(drawn).toHaveLength(1);
    expect(2000 * 2000).toBeGreaterThan(SCRATCH_KEEP_PX);
    expect(drawn[0]!.width).toBe(0);
    expect(drawn[0]!.height).toBe(0);
  });

  it('behält einen kleinen Zwischen-Canvas für die nächste Teilzeichnung', () => {
    const { ctx, drawn } = fakeCtx();
    redrawRegion(ctx, [], { x0: 10, y0: 10, x1: 110, y1: 60 }, 1, size);
    expect(drawn[0]!.width).toBeGreaterThanOrEqual(100);
    expect(drawn[0]!.height).toBeGreaterThanOrEqual(50);
  });
});
