// Renderer-Smoke-Tests in jsdom mit Canvas-Mock.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { getStroke } from 'perfect-freehand';
import { createHash } from 'node:crypto';
import type { PageElement, Stroke } from '@sg/shared';
import { InkPage } from '../src/components/ink/InkPage.tsx';
import {
  drawStroke,
  MAX_FILL_PER_SEGMENT,
  MAX_FILL_PER_STROKE,
  paintScene,
  redrawRegion,
  resetScratchCanvas,
  SCRATCH_KEEP_PX,
  SHAPE_TUNING,
  strokeBounds,
  strokeOutline,
  strokeShape,
  TOOL_STYLES,
  type StrokeShape,
} from '../src/components/ink/render.ts';
import { decodeStroke, parseColor } from '../src/components/ink/stroke.ts';
import { installCanvasMock, type CanvasLog } from './canvas-mock.ts';
import { loadV1Fixtures, loadV2Fixtures } from './ink-fixtures.ts';

// getStroke zählt mit (läuft sonst unverändert), damit sich prüfen lässt, dass v2 ohne perfect-freehand zeichnet
vi.mock('perfect-freehand', async (importOriginal) => {
  const m = await importOriginal<typeof import('perfect-freehand')>();
  return { ...m, getStroke: vi.fn(m.getStroke) };
});

type PageProps = NonNullable<React.ComponentProps<typeof InkPage>['page']>;

// „v1 unverändert“ gilt für die Dateien 01 bis 07 (299 Striche); Datei 08 ist Format v2 und hat eigene Tests unten
const files = loadV1Fixtures();
const all = files.flatMap((f) => f.strokes);
const v2files = loadV2Fixtures().flatMap((f) => f.strokes);
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

  it('begrenzt den Zoom: die längere Seite nie über 4096 Pixel, nie unter 1 Pixel je CSS-Pixel', () => {
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

// ---------------------------------------------------------------------------------------------------------------------
// Strichformat v2 (VERTRAEGE §23.8)

describe('v1 bleibt unverändert (Dateien 01 bis 07)', () => {
  it('Umrisse und Ränder der 299 Striche sind Zeichen für Zeichen die von vor V2-2', () => {
    // Prüfsumme aus dem Stand VOR V2-2 (gleiche Rundung). Ändert sich der v1-Pfad absichtlich (V2-5), neu bestimmen.
    const round = (_: string, v: unknown) => (typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v);
    const sum = (fn: (d: ReturnType<typeof decodeStroke>) => unknown) => {
      const h = createHash('sha256');
      for (const s of all) h.update(JSON.stringify(fn(decodeStroke(s)), round));
      return h.digest('hex').slice(0, 16);
    };
    expect(all).toHaveLength(299);
    expect(sum(strokeOutline)).toBe('df9560373e8bfa64');
    expect(sum(strokeBounds)).toBe('9f359413cbf22a04');
  });

  it('v1-Striche zeichnen über perfect-freehand und quadraticCurveTo, ohne Kreise', () => {
    const ctx = document.createElement('canvas').getContext('2d')!;
    const before = vi.mocked(getStroke).mock.calls.length;
    const fresh = all.slice(0, 20).map((s) => ({ ...s }));
    for (const s of fresh) drawStroke(ctx, decodeStroke(s));
    expect(vi.mocked(getStroke).mock.calls.length).toBe(before + 20);
    expect(log.count('arc')).toBe(0);
    expect(log.count('quadraticCurveTo')).toBeGreaterThan(20);
    expect(log.fills).toHaveLength(20);
  });
});

describe('Strichformat v2: Form aus dem Durchmesser je Punkt', () => {
  // Die Form wird hier ohne die Vereinfachung geprüft (eine Scheibe und ein Trapez je Punkt wie in 23.8); die
  // Vereinfachung hat unten ihre eigenen Tests.
  const tolerance = SHAPE_TUNING.discTolerance;
  beforeEach(() => {
    SHAPE_TUNING.discTolerance = 0;
  });
  afterEach(() => {
    SHAPE_TUNING.discTolerance = tolerance;
  });
  const base = files[0]!.strokes[0]!;
  const id = (n: number) => `019a4e14-0000-7000-8000-${String(n).padStart(12, '0')}`;
  let nextId = 1000;
  type P = readonly [number, number, number];

  /** v2-Strich aus (x, y, Durchmesser); width = height = Durchmesser. `sizesOverride` ersetzt die sizes (Rohwerte). */
  function make(pts: readonly P[], extra: Partial<Stroke> = {}, sizesOverride?: number[]): Stroke {
    const pb = Buffer.alloc(pts.length * 24);
    pts.forEach(([x, y], i) => {
      pb.writeFloatLE(x, i * 24);
      pb.writeFloatLE(y, i * 24 + 4);
      pb.writeFloatLE(i, i * 24 + 8);
      pb.writeFloatLE(0.5, i * 24 + 12);
    });
    const raw = sizesOverride ?? pts.flatMap(([, , dd]) => [dd, dd]);
    const sb = Buffer.alloc(raw.length * 4);
    raw.forEach((v, i) => sb.writeFloatLE(v, i * 4));
    return {
      ...base,
      client_id: id(nextId++),
      tool: 'fountain',
      layer: 'ink',
      color: '#1E2A44FF',
      width: 4,
      transform: [1, 0, 0, 1, 0, 0],
      points: pb.toString('base64'),
      sizes: sb.toString('base64'),
      ...extra,
    } as Stroke;
  }
  const dec = (s: Stroke) => decodeStroke(s);
  const marker = { tool: 'marker', layer: 'highlight', color: '#FFE06666' } as Partial<Stroke>;

  /** Lotrechter Schnitt durch die Teilflächen bei x: kleinstes und größtes y, das eine Teilfläche deckt */
  function span(sh: StrokeShape, x: number): [number, number] | null {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < sh.circles.length; i += 3) {
      const dx = x - sh.circles[i]!;
      const r = sh.circles[i + 2]!;
      if (Math.abs(dx) > r) continue;
      const h = Math.sqrt(r * r - dx * dx);
      lo = Math.min(lo, sh.circles[i + 1]! - h);
      hi = Math.max(hi, sh.circles[i + 1]! + h);
    }
    for (let i = 0; i < sh.quads.length; i += 8) {
      for (let j = 0; j < 4; j++) {
        const ax = sh.quads[i + j * 2]!;
        const ay = sh.quads[i + j * 2 + 1]!;
        const bx = sh.quads[i + ((j + 1) % 4) * 2]!;
        const by = sh.quads[i + ((j + 1) % 4) * 2 + 1]!;
        if ((ax - x) * (bx - x) > 0 || ax === bx) continue;
        const y = ay + ((by - ay) * (x - ax)) / (bx - ax);
        lo = Math.min(lo, y);
        hi = Math.max(hi, y);
      }
    }
    return lo <= hi ? [lo, hi] : null;
  }
  const widthAt = (sh: StrokeShape, x: number) => {
    const s = span(sh, x);
    return s ? s[1] - s[0] : 0;
  };
  const area = (q: ArrayLike<number>, o: number) => {
    let a = 0;
    for (let j = 0; j < 4; j++) {
      const k = (j + 1) % 4;
      a += q[o + j * 2]! * q[o + k * 2 + 1]! - q[o + k * 2]! * q[o + j * 2 + 1]!;
    }
    return a;
  };
  const triArea = (t: ArrayLike<number>, o: number) =>
    (t[o + 2]! - t[o]!) * (t[o + 5]! - t[o + 1]!) - (t[o + 4]! - t[o]!) * (t[o + 3]! - t[o + 1]!);

  it('1. alle Teilflächen haben positiven Umlaufsinn, Kreise entstehen mit arc(…, false)', () => {
    const ctx = document.createElement('canvas').getContext('2d')!;
    let trisSeen = 0;
    let maxTriArea = 0;
    // Datei 08, dazu Kurven in beide Drehrichtungen (die Eckenfolge der Trapeze hängt von der Richtung ab)
    const curves = [
      make([
        [0, 0, 2],
        [10, 5, 6],
        [20, 0, 3],
        [10, -5, 5],
        [0, 0, 2],
      ]),
      make([
        [0, 0, 2],
        [0, 10, 6],
        [-10, 10, 3],
        [-10, 0, 5],
      ]),
      make([
        [0, 0, 6],
        [-5, 0, 2],
      ]),
      make(
        [
          [0, 0, 6],
          [5, 0, 2],
        ],
        marker,
      ),
      make([[5, 5, 8]], marker),
      // Sanfter Zickzack (Knicke um 6°): Hier entfallen Scheiben und es entstehen Fasen mit echter Fläche, auf beiden Seiten
      // und in beide Drehrichtungen
      make(Array.from({ length: 12 }, (_, i): [number, number, number] => [i * 6, i % 2 ? 0.3 : 0, 9])),
      make(
        Array.from({ length: 12 }, (_, i): [number, number, number] => [i * 6, i % 2 ? -0.3 : 0, 9]),
        marker,
      ),
    ];
    for (const s of [...v2files, ...curves]) {
      const d = dec(s);
      expect(d.diam, s.client_id).not.toBeNull();
      const sh = strokeShape(d);
      expect(sh.circles.length + sh.quads.length).toBeGreaterThan(0);
      for (let i = 0; i < sh.quads.length; i += 8) expect(area(sh.quads, i), s.client_id).toBeGreaterThan(0);
      // Fasen-Dreiecke: ebenfalls positiver Umlaufsinn (entartete mit Fläche 0 bis auf Rundung), sonst löschen sie unter
      // `nonzero` Fläche aus
      for (let i = 0; i < sh.tris.length; i += 6)
        expect(triArea(sh.tris, i), s.client_id).toBeGreaterThan(-1e-9); // entartete Fasen: Fläche 0 bis auf Rundung
      trisSeen += sh.tris.length / 6;
      for (let i = 0; i < sh.tris.length; i += 6) maxTriArea = Math.max(maxTriArea, triArea(sh.tris, i));
      log.reset();
      drawStroke(ctx, d);
      for (const c of log.calls.filter((c) => c.name === 'arc')) expect(c.args[5]).toBe(false);
      // Jede Teilfläche (Kreis, Trapez, Dreieck) beginnt mit genau einem moveTo, also wird auch jedes Dreieck gezeichnet
      const moves = log.calls.filter((c) => c.name === 'moveTo').length;
      expect(moves, s.client_id).toBe(sh.circles.length / 3 + sh.quads.length / 8 + sh.tris.length / 6);
    }
    // Die Testdaten müssen Fasen mit echter Fläche enthalten, sonst prüfen die Zeilen oben nichts
    expect(trisSeen).toBeGreaterThan(0);
    expect(maxTriArea).toBeGreaterThan(1e-3);
  });

  it('2. gerader Strich 100 pt, Durchmesser 2 auf 6: Breite 2, 4, 6 (±0,1) an Anfang, Mitte, Ende', () => {
    const d = dec(
      make([
        [0, 0, 2],
        [100, 0, 6],
      ]),
    );
    const sh = strokeShape(d);
    expect(widthAt(sh, 0)).toBeCloseTo(2, 1);
    expect(widthAt(sh, 50)).toBeCloseTo(4, 1);
    expect(widthAt(sh, 100)).toBeCloseTo(6, 1);
    // linear dazwischen, auch weit weg von den Stützpunkten
    for (const x of [7, 23, 61, 88]) expect(Math.abs(widthAt(sh, x) - (2 + (4 * x) / 100))).toBeLessThan(0.1);
  });

  it('2. Ecken der Trapeze liegen auf den Kreisen und sind äußere Tangenten (keine Einbuchtung)', () => {
    // Abstand rund 1 pt, kein Verdichten: Kette = Eingabepunkte; der Durchmesser wächst von 2 auf 8
    const pts = Array.from({ length: 8 }, (_, i): P => [i, 0.05 * i * i, 2 + (6 * i) / 7]);
    const sh = strokeShape(dec(make(pts)));
    expect(sh.filled).toBe(0);
    expect(sh.circles).toHaveLength(24);
    expect(sh.quads).toHaveLength(56);
    for (let q = 0; q < 7; q++) {
      const [x0, y0, r0] = Array.from(sh.circles.slice(q * 3, q * 3 + 3)) as [number, number, number];
      const [x1, y1, r1] = Array.from(sh.circles.slice(q * 3 + 3, q * 3 + 6)) as [number, number, number];
      const c = Array.from(
        { length: 4 },
        (_, k) => [sh.quads[q * 8 + k * 2]!, sh.quads[q * 8 + k * 2 + 1]!] as const,
      );
      const dist = (p: readonly [number, number], x: number, y: number) => Math.hypot(p[0] - x, p[1] - y);
      const on0 = [0, 1, 2, 3].filter((k) => Math.abs(dist(c[k]!, x0, y0) - r0) < 1e-9);
      const on1 = [0, 1, 2, 3].filter((k) => Math.abs(dist(c[k]!, x1, y1) - r1) < 1e-9);
      expect(on0, `Trapez ${q}`).toHaveLength(2);
      expect(on1, `Trapez ${q}`).toHaveLength(2);
      // Tangente: Die Seite von einer Ecke auf Kreis 0 zur Ecke auf Kreis 1 steht senkrecht auf dem Radius zur Ecke.
      // Bei einem Versatz entlang der Normalen des Abschnitts wäre das bei wechselndem Radius nicht der Fall.
      for (const a of on0) {
        const b = on1.find((k) => (k - a + 4) % 4 === 1 || (a - k + 4) % 4 === 1)!;
        const side = [c[b]![0] - c[a]![0], c[b]![1] - c[a]![1]] as const;
        const radius = [c[a]![0] - x0, c[a]![1] - y0] as const;
        expect(Math.abs(side[0] * radius[0] + side[1] * radius[1])).toBeLessThan(1e-9);
        const radius1 = [c[b]![0] - x1, c[b]![1] - y1] as const;
        expect(Math.abs(side[0] * radius1[0] + side[1] * radius1[1])).toBeLessThan(1e-9);
      }
    }
  });

  it('3. Spitzkehre (180°): kein Fehler, die Form deckt den Wendepunkt', () => {
    const d = dec(
      make([
        [0, 0, 4],
        [50, 0, 8],
        [10, 0, 3],
      ]),
    );
    const ctx = document.createElement('canvas').getContext('2d')!;
    expect(() => drawStroke(ctx, d)).not.toThrow();
    const sh = strokeShape(d);
    for (const v of [...sh.circles, ...sh.quads]) expect(Number.isFinite(v)).toBe(true);
    const turn = span(sh, 50)!;
    expect(turn[1] - turn[0]).toBeGreaterThanOrEqual(8 - 1e-6);
    expect(span(sh, 53.9)).not.toBeNull(); // Kappe über den Wendepunkt hinaus (Radius 4)
    expect(span(sh, 54.1)).toBeNull();
  });

  it('4. ein Punkt ergibt einen Kreis, beim Textmarker ein Quadrat mit der Kantenlänge des Durchmessers', () => {
    const ctx = document.createElement('canvas').getContext('2d')!;
    log.reset();
    drawStroke(ctx, dec(make([[20, 30, 6]])));
    expect(log.count('arc')).toBe(1);
    expect(log.calls.find((c) => c.name === 'arc')!.args.slice(0, 3)).toEqual([20, 30, 3]);
    expect(log.fills).toHaveLength(1);

    const mk = dec(make([[20, 30, 6]], marker));
    log.reset();
    drawStroke(ctx, mk);
    expect(log.count('arc')).toBe(0);
    expect(log.count('lineTo')).toBe(3);
    const sh = strokeShape(mk);
    expect(sh.quads).toHaveLength(8);
    const xs = [0, 2, 4, 6].map((i) => sh.quads[i]!);
    const ys = [1, 3, 5, 7].map((i) => sh.quads[i]!);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(6, 9);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(6, 9);
    expect(area(sh.quads, 0)).toBeGreaterThan(0);
    // Punkte unter 0,01 pt Abstand werden zu einem; der größere Durchmesser gewinnt
    const merged = strokeShape(
      dec(
        make([
          [1, 1, 2],
          [1.001, 1, 5],
          [1, 1.002, 3],
        ]),
      ),
    );
    expect(merged.chainLength).toBe(1);
    expect(merged.circles[2]).toBe(2.5);
  });

  it('5. Textmarker: stumpfe Enden, also keine Scheibe am ersten und letzten Punkt', () => {
    const sh = strokeShape(
      dec(
        make(
          [
            [0, 0, 10],
            [100, 0, 10],
          ],
          marker,
        ),
      ),
    );
    expect(span(sh, -0.5)).toBeNull();
    expect(span(sh, 100.5)).toBeNull();
    expect(widthAt(sh, 0.01)).toBeCloseTo(10, 1);
    expect(widthAt(sh, 99.99)).toBeCloseTo(10, 1);
    // Innen tragen die Zwischenpunkte Scheiben, aber keine ragt über die Schnittkante an den Enden hinaus
    expect(sh.circles.length / 3).toBeGreaterThan(40);
    expect(sh.circles.length / 3).toBeLessThan(sh.chainLength - 2);
    for (let i = 0; i < sh.circles.length; i += 3) {
      expect(sh.circles[i]! - sh.circles[i + 2]!).toBeGreaterThanOrEqual(-1e-9);
      expect(sh.circles[i]! + sh.circles[i + 2]!).toBeLessThanOrEqual(100 + 1e-9);
    }
    // derselbe Strich als Füller bekommt runde Enden
    const pen = strokeShape(
      dec(
        make([
          [0, 0, 10],
          [100, 0, 10],
        ]),
      ),
    );
    expect(span(pen, -4.9)).not.toBeNull();
    expect(pen.circles.length / 3).toBe(pen.chainLength);
  });

  it('6. Größe 0 am Ende: kein Fehler, endliche Form, die Spitze läuft aus', () => {
    const d = dec(
      make([
        [0, 0, 6],
        [10, 0, 3],
        [20, 0, 0],
      ]),
    );
    expect(d.diam![2]).toBeCloseTo(0.1, 6);
    const ctx = document.createElement('canvas').getContext('2d')!;
    expect(() => drawStroke(ctx, d)).not.toThrow();
    const sh = strokeShape(d);
    expect(widthAt(sh, 19.9)).toBeLessThan(0.5);
    for (const v of [...sh.circles, ...sh.quads]) expect(Number.isFinite(v)).toBe(true);
    // Kreis liegt im Kreis: kein Trapez, kein Fehler
    const inner = strokeShape(
      dec(
        make([
          [0, 0, 20],
          [1, 0, 2],
        ]),
      ),
    );
    expect(inner.quads).toHaveLength(0);
    expect(inner.circles).toHaveLength(6);
  });

  it('7. vor jedem arc steht ein moveTo auf den Startpunkt des Kreises, danach closePath', () => {
    const ctx = document.createElement('canvas').getContext('2d')!;
    for (const s of v2files) {
      log.reset();
      drawStroke(ctx, dec(s));
      const calls = log.calls;
      const arcs = calls.map((c, i) => [c, i] as const).filter(([c]) => c.name === 'arc');
      expect(arcs.length, s.client_id).toBeGreaterThan(0);
      for (const [c, i] of arcs) {
        const [x, y, r] = c.args as [number, number, number];
        expect(calls[i - 1]!.name).toBe('moveTo');
        expect(calls[i - 1]!.args).toEqual([x + r, y]);
        expect(calls[i + 1]!.name).toBe('closePath');
      }
    }
  });

  it('8. Verdichten ist begrenzt: höchstens 64 Zwischenpunkte je Abschnitt und 5 000 je Strich', () => {
    const far = strokeShape(
      dec(
        make([
          [0, 0, 4],
          [100_000, 0, 4],
        ]),
      ),
    );
    expect(far.filled).toBe(MAX_FILL_PER_SEGMENT);
    expect(far.chainLength).toBe(2 + MAX_FILL_PER_SEGMENT);
    // 1 000 lange Abschnitte: je 64 wären 64 000; die Summe wird auf höchstens 5 000 verkleinert
    const long = strokeShape(
      dec(make(Array.from({ length: 1001 }, (_, i): P => [i * 100, (i % 2) * 50, 3]))),
    );
    expect(long.filled).toBeGreaterThan(0);
    expect(long.filled).toBeLessThanOrEqual(MAX_FILL_PER_STROKE);
    expect(long.chainLength).toBe(1001 + long.filled);
    // kurze Abschnitte: k = ceil(Länge / 1,5) − 1
    expect(
      strokeShape(
        dec(
          make([
            [0, 0, 2],
            [10, 0, 2],
          ]),
        ),
      ).filled,
    ).toBe(Math.ceil(10 / 1.5) - 1);
    // bei mehr als 5 000 Punkten entfällt das Verdichten ganz
    const many = strokeShape(dec(make(Array.from({ length: 5001 }, (_, i): P => [i * 10, 0, 2]))));
    expect(many.filled).toBe(0);
    expect(many.chainLength).toBe(5001);
  });

  it('ein fill() je Strich mit nonzero, perfect-freehand läuft für v2 nicht', () => {
    const ctx = document.createElement('canvas').getContext('2d')!;
    const before = vi.mocked(getStroke).mock.calls.length;
    for (const s of v2files) drawStroke(ctx, dec(s));
    expect(vi.mocked(getStroke).mock.calls.length).toBe(before);
    expect(log.fills).toHaveLength(v2files.length);
    expect(log.count('beginPath')).toBe(v2files.length);
    expect(log.calls.filter((c) => c.name === 'fill').every((c) => c.args[0] === 'nonzero')).toBe(true);
    // alle Werkzeuge zeichnen v2, auch Bleistift mit seiner Deckkraft (ToolStyle.alpha)
    expect(new Set(v2files.map((s) => s.tool))).toEqual(new Set(['fountain', 'pen', 'pencil', 'marker']));
    const pencil = v2files.find((s) => s.tool === 'pencil')!;
    const alpha = Number(/, ([\d.]+)\)$/.exec(log.fills[v2files.indexOf(pencil)]!)![1]);
    expect(alpha).toBeCloseTo(parseColor(pencil.color).a * TOOL_STYLES.pencil.alpha, 3);
  });

  it('kaputte sizes: der Strich wird als v1 gezeichnet (perfect-freehand, keine Kreise)', () => {
    const ctx = document.createElement('canvas').getContext('2d')!;
    const pts: P[] = [
      [0, 0, 4],
      [10, 5, 4],
      [20, 0, 4],
    ];
    const broken = [
      make(pts, {}, [1, 1, 2, 2]), // zu kurz
      make(pts, {}, [0, 0, 0, 0, 0, 0]), // lauter Nullen
      make(pts, {}, [1, 1, NaN, 1, 1, 1]),
      make(pts, {}, [1, 1, -1, 1, 1, 1]),
      make(pts, { sizes: '!!!!' }),
    ];
    const before = vi.mocked(getStroke).mock.calls.length;
    for (const s of broken) {
      const d = dec(s);
      expect(d.diam).toBeNull();
      log.reset();
      drawStroke(ctx, d);
      expect(log.count('arc')).toBe(0);
      expect(log.count('quadraticCurveTo')).toBeGreaterThan(2);
      expect(log.fills).toHaveLength(1);
    }
    expect(vi.mocked(getStroke).mock.calls.length).toBe(before + broken.length);
  });

  it('strokeBounds schließt die dickste Stelle ein, auch wenn die Kurve über die Eingabepunkte hinausschwingt', () => {
    // width im Strich bewusst klein: ein v1-Rand (width-abhängig) würde die dicke Stelle abschneiden
    const d = dec(
      make(
        [
          [100, 100, 2],
          [100, 101, 60],
          [100, 102, 2],
        ],
        { width: 1 },
      ),
    );
    const r = strokeBounds(d);
    expect(r.x0).toBeLessThanOrEqual(100 - 30);
    expect(r.x1).toBeGreaterThanOrEqual(100 + 30);
    expect(r.y0).toBeLessThanOrEqual(101 - 30);
    expect(r.y1).toBeGreaterThanOrEqual(101 + 30);
    const inside = (dd: ReturnType<typeof decodeStroke>) => {
      const b = strokeBounds(dd);
      const sh = strokeShape(dd);
      for (let i = 0; i < sh.circles.length; i += 3) {
        const [x, y, rr] = [sh.circles[i]!, sh.circles[i + 1]!, sh.circles[i + 2]!];
        expect(x - rr).toBeGreaterThanOrEqual(b.x0);
        expect(x + rr).toBeLessThanOrEqual(b.x1);
        expect(y - rr).toBeGreaterThanOrEqual(b.y0);
        expect(y + rr).toBeLessThanOrEqual(b.y1);
      }
      for (let i = 0; i < sh.quads.length; i += 2) {
        expect(sh.quads[i]!).toBeGreaterThanOrEqual(b.x0);
        expect(sh.quads[i]!).toBeLessThanOrEqual(b.x1);
        expect(sh.quads[i + 1]!).toBeGreaterThanOrEqual(b.y0);
        expect(sh.quads[i + 1]!).toBeLessThanOrEqual(b.y1);
      }
    };
    for (const s of v2files) inside(dec(s));
    inside(
      dec(
        make([
          [0, 0, 4],
          [1000, 0, 4],
          [1000, 10, 4],
          [0, 10, 4],
          [0, 0, 4],
        ]),
      ),
    );
  });

  it('redrawRegion lässt keine Reste eines v2-Strichs stehen: ein Ausschnitt an der dicken Stelle zeichnet ihn neu', () => {
    resetScratchCanvas();
    const thick = dec(
      make(
        [
          [100, 100, 2],
          [100, 101, 60],
          [100, 102, 2],
        ],
        { width: 1 },
      ),
    );
    const ctx = document.createElement('canvas').getContext('2d')!;
    // Ausschnitt nur im äußeren Rand der dicken Stelle (x 72 bis 80), weit weg von den Punkten bei x = 100
    log.reset();
    redrawRegion(ctx, [thick], { x0: 72, y0: 90, x1: 80, y1: 110 }, 1, { width: 400, height: 400 });
    expect(log.fills).toHaveLength(1);
    // ein Strich ganz außerhalb wird nicht gezeichnet
    log.reset();
    redrawRegion(ctx, [thick], { x0: 200, y0: 200, x1: 220, y1: 220 }, 1, { width: 400, height: 400 });
    expect(log.fills).toHaveLength(0);
  });

  it('Zeit, Stufe 1: 300 v2-Striche bauen ihre Pfade und zeichnen aus dem Cache im Zeitrahmen', () => {
    // Misst NUR das Bauen der Pfade (Dekodieren, Formen, Befehle an den Canvas-Mock), nicht das Füllen im Browser.
    // Die echte Messung steht in apps/web/scripts/ink-perf (measure.cjs --sizes on, VERTRAEGE §23.9, Stufe 2).
    const strokes: Stroke[] = Array.from(
      { length: 300 },
      (_, i) =>
        ({
          ...v2files[i % v2files.length]!,
          client_id: id(5000 + i),
          transform: [1, 0, 0, 1, (i * 37) % 300, (i * 53) % 500],
        }) as Stroke,
    );
    const { rerender } = render(<InkPage strokes={[]} width={600} />);
    const t0 = performance.now();
    rerender(<InkPage strokes={strokes} width={600} />); // dekodiert, baut die Formen, zeichnet
    const cold = performance.now() - t0;
    expect(log.fills.length).toBeGreaterThanOrEqual(300);
    log.reset();
    const t1 = performance.now();
    rerender(<InkPage strokes={[...strokes]} width={601} />); // Größenwechsel: alles neu, Formen aus dem Cache
    const warm = performance.now() - t1;
    expect(log.fills).toHaveLength(300);
    expect(log.count('arc')).toBeGreaterThan(300);
    expect(warm).toBeLessThan(250);
    expect(cold).toBeLessThan(1500);
  });
});

// Der Standard der Toleranz, wie ihn 23.8 festlegt; die Tests prüfen ihn mit, damit eine Änderung auffällt
const DEFAULT_TOL = 0.02;

describe('Strichformat v2: überflüssige Scheiben und Zwischenpunkte entfallen (Toleranz 0,02 pt)', () => {
  it('der Standard der Toleranz ist 0,02 pt', () => {
    expect(SHAPE_TUNING.discTolerance).toBe(DEFAULT_TOL);
  });

  const id = (n: number) => `019a4e14-0000-7000-8000-${String(n).padStart(12, '0')}`;
  const base = files[0]!.strokes[0]!;
  const make = (pts: readonly (readonly [number, number, number])[], extra: Partial<Stroke> = {}): Stroke => {
    const pb = Buffer.alloc(pts.length * 24);
    const sb = Buffer.alloc(pts.length * 8);
    pts.forEach(([x, y, dd], i) => {
      pb.writeFloatLE(x, i * 24);
      pb.writeFloatLE(y, i * 24 + 4);
      pb.writeFloatLE(i, i * 24 + 8);
      pb.writeFloatLE(0.5, i * 24 + 12);
      sb.writeFloatLE(dd, i * 8);
      sb.writeFloatLE(dd, i * 8 + 4);
    });
    return {
      ...base,
      client_id: id(9000 + Math.floor(Math.random() * 1e6)),
      tool: 'fountain',
      width: 4,
      transform: [1, 0, 0, 1, 0, 0],
      points: pb.toString('base64'),
      sizes: sb.toString('base64'),
      ...extra,
    } as Stroke;
  };
  const withTolerance = (tol: number, s: Stroke) => {
    const old = SHAPE_TUNING.discTolerance;
    SHAPE_TUNING.discTolerance = tol;
    try {
      return strokeShape(decodeStroke({ ...s }));
    } finally {
      SHAPE_TUNING.discTolerance = old;
    }
  };
  /** Liegt (x, y) in der Form, wenn man sie ringsum um `margin` pt aufdickt (negativ: verkleinert)? */
  const inside = (sh: StrokeShape, x: number, y: number, margin = 0) => {
    for (let i = 0; i < sh.circles.length; i += 3)
      if (Math.hypot(x - sh.circles[i]!, y - sh.circles[i + 1]!) <= sh.circles[i + 2]! + margin) return true;
    const polys: [ArrayLike<number>, number][] = [
      [sh.quads, 4],
      [sh.tris, 3],
    ];
    for (const [arr, m] of polys)
      for (let i = 0; i < arr.length; i += m * 2) {
        let all = true;
        for (let j = 0; j < m && all; j++) {
          const k = (j + 1) % m;
          const ax = arr[i + j * 2]!;
          const ay = arr[i + j * 2 + 1]!;
          const ex = arr[i + k * 2]! - ax;
          const ey = arr[i + k * 2 + 1]! - ay;
          // alle Teilflächen laufen positiv, also liegt der Punkt links jeder Kante; cross / Kantenlänge = Abstand
          all = ex * (y - ay) - ey * (x - ax) >= -margin * Math.hypot(ex, ey);
        }
        if (all) return true;
      }
    return false;
  };

  it('eine gerade Kette wird zu einem Trapez mit zwei Kappen, dieselbe Fläche (±0,06 pt) wie ohne Vereinfachung', () => {
    const s = make([
      [0, 0, 2],
      [100, 0, 6],
    ]);
    const lit = withTolerance(0, s);
    const sim = withTolerance(0.02, s);
    expect(lit.chainLength).toBe(66);
    // Nach 48 Punkten (Reichweite des Zusammenfassens) beginnt ein neues Stück: 66 Punkte werden zu 3
    expect(sim.simplified).toBe(3);
    expect(sim.quads).toHaveLength(16);
    for (let x = -1; x <= 103; x += 0.7)
      for (let y = -4; y <= 4; y += 0.31) {
        if (inside(lit, x, y)) expect(inside(sim, x, y, 0.06), `${x}/${y}`).toBe(true);
        if (inside(sim, x, y)) expect(inside(lit, x, y, 0.06), `${x}/${y}`).toBe(true);
      }
  });

  it('Umkehr und Knicke bleiben erhalten (Spitzkehre, rechter Winkel)', () => {
    expect(
      withTolerance(
        0.02,
        make([
          [0, 0, 4],
          [50, 0, 4],
          [10, 0, 4],
        ]),
      ).simplified,
    ).toBe(3);
    // Die Kurve durch den Knick wird gerundet, bleibt aber eine Kurve: ihre Punkte entfallen nicht alle
    const corner = withTolerance(
      0.02,
      make([
        [0, 0, 4],
        [30, 0, 4],
        [30, 30, 4],
      ]),
    );
    expect(corner.simplified).toBeGreaterThan(5);
    expect(corner.simplified).toBeLessThan(corner.chainLength);
  });

  it('Datei 08: die vereinfachte Form deckt (fast) dieselben Punkte wie die ausführliche', () => {
    for (const s of v2files) {
      const lit = withTolerance(0, s);
      const sim = withTolerance(0.02, s);
      expect(sim.simplified, s.client_id).toBeLessThanOrEqual(lit.chainLength);
      const b = {
        x0: lit.center.x0 - 8,
        x1: lit.center.x1 + 8,
        y0: lit.center.y0 - 8,
        y1: lit.center.y1 + 8,
      };
      let covered = 0;
      let outside = 0;
      for (let x = b.x0; x <= b.x1; x += 0.7)
        for (let y = b.y0; y <= b.y1; y += 0.7) {
          const a = inside(lit, x, y);
          const c = inside(sim, x, y);
          if (a) covered++;
          // Jede Abweichung liegt in einem Rand von höchstens 0,06 pt (Toleranz 0,02 für Lage, 0,04 für den Radius)
          if (a && !inside(sim, x, y, 0.06)) outside++;
          if (c && !inside(lit, x, y, 0.06)) outside++;
        }
      expect(covered).toBeGreaterThan(0);
      expect(outside, s.client_id).toBe(0);
    }
  });

  it('weniger Teilpfade als Punkte (das senkt die Füllzeit im Browser)', () => {
    const total = v2files.reduce((sum, s) => {
      const lit = withTolerance(0, s);
      const sim = withTolerance(0.02, s);
      return (
        sum +
        (lit.circles.length / 3 + lit.quads.length / 8) -
        (sim.circles.length / 3 + sim.quads.length / 8)
      );
    }, 0);
    expect(total).toBeGreaterThan(100);
  });

  // Geometrie der Kerben: Ein Knick bei P, Streckenpunkte im Abstand 1 pt. Außen liegt P + 0,9·r·Winkelhalbierende
  // (Normale der mittleren Richtung); dort muss die Form decken, denn der Strich überstreicht jeden Punkt im Abstand r
  // von der Kurve, die durch P geht.
  const marker = { tool: 'marker', layer: 'highlight', color: '#FFE06666' } as Partial<Stroke>;
  const kinkStroke = (deg: number, diam: number, extra: Partial<Stroke> = {}, jitter = 0) => {
    let seed = 11;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5;
    const a = (deg * Math.PI) / 180;
    const pts: [number, number, number][] = [];
    for (let i = -40; i <= 0; i++) pts.push([i, i === -40 || i === 0 ? 0 : jitter * rnd(), diam]);
    for (let i = 1; i <= 40; i++)
      pts.push([Math.cos(a) * i, Math.sin(a) * i + (i === 40 ? 0 : jitter * rnd()), diam]);
    return make(pts, extra);
  };
  /** Punkte P + 0,9·r·n, dazu entlang der Kurve verschoben (|s| ≤ 0,3·r), n = Winkelhalbierende außen */
  const outerProbes = (deg: number, r: number, at = 0): [number, number][] => {
    const a = (deg * Math.PI) / 180;
    // Kurve dreht nach unten (y wächst): außen ist oben (−y) um die mittlere Richtung
    const mid = a / 2;
    const [tx, ty] = [Math.cos(mid), Math.sin(mid)];
    const [nx, ny] = [ty, -tx];
    const out: [number, number][] = [];
    for (let s = -0.3 * r; s <= 0.3 * r + 1e-9; s += 0.01)
      out.push([at + tx * s + nx * 0.9 * r, ty * s + ny * 0.9 * r]);
    return out;
  };

  it('Knick von 10° bis 20°: der Punkt P + 0,9·r·Winkelhalbierende (außen) ist gedeckt, bei r = 1 und r = 9', () => {
    for (const deg of [10, 12, 15, 20])
      for (const r of [1, 9]) {
        // 0,05 pt: auch r = 9 lässt bei 10° die Scheibe weg; 0,02 pt: der Standard
        for (const tol of [DEFAULT_TOL, 0.05]) {
          const sh = withTolerance(tol, kinkStroke(deg, r * 2));
          for (const [x, y] of outerProbes(deg, r))
            expect(inside(sh, x, y), `${deg}° r=${r} tol=${tol} ${x}/${y}`).toBe(true);
        }
      }
  });

  it('Textmarker mit Zittern und Knick nahe dem Ende: die Teilflächen decken P + 0,9·r·Winkelhalbierende, auch bei Toleranz 0', () => {
    const r = 9;
    for (const tol of [0, DEFAULT_TOL])
      for (const deg of [10, 20]) {
        // Knick bei P = (0, 0), Zittern ±0,15 pt auf beiden Armen
        const sh = withTolerance(tol, kinkStroke(deg, 2 * r, marker, 0.3));
        for (const [x, y] of outerProbes(deg, r))
          expect(inside(sh, x, y), `${deg}° tol=${tol} ${x}/${y}`).toBe(true);
      }
    // Knick 5 pt vor dem Ende: die Scheibe ragt über die Endkante und entfällt, die Fase schließt den Keil
    for (const tol of [0, DEFAULT_TOL])
      for (const deg of [10, 20]) {
        const a = (deg * Math.PI) / 180;
        const pts: [number, number, number][] = [];
        for (let i = -40; i <= 0; i++) pts.push([i, 0, 2 * r]);
        for (let i = 1; i <= 5; i++) pts.push([Math.cos(a) * i, Math.sin(a) * i, 2 * r]);
        const sh = withTolerance(tol, make(pts, marker));
        expect(sh.tris.length, `tol=${tol}`).toBeGreaterThan(0);
        for (const [x, y] of outerProbes(deg, r))
          expect(inside(sh, x, y), `Ende ${deg}° tol=${tol} ${x}/${y}`).toBe(true);
      }
  });

  it('scharfe Biegungen behalten ihre Rundung: Spitzkehre und rechter Winkel decken P + 0,9·r rundum außen', () => {
    const r = 4;
    // Spitzkehre bei P = (50, 0): die Kappe ragt nach +x; rechter Winkel bei P = (30, 0): die Ecke ragt nach (+x, −y)
    const cases: [[number, number, number][], [number, number], number, number][] = [
      [
        [
          [0, 0, 2 * r],
          [50, 0, 2 * r],
          [10, 0, 2 * r],
        ],
        [50, 0],
        -60,
        60,
      ],
      [
        [
          [0, 0, 2 * r],
          [30, 0, 2 * r],
          [30, 30, 2 * r],
        ],
        [30, 0],
        -80,
        0,
      ],
    ];
    for (const [pts, [px, py], from, to] of cases) {
      const sh = withTolerance(DEFAULT_TOL, make(pts));
      for (let deg = from; deg <= to; deg += 0.5) {
        const t = (deg * Math.PI) / 180;
        const [x, y] = [px + Math.cos(t) * 0.9 * r, py + Math.sin(t) * 0.9 * r];
        expect(inside(sh, x, y), `${px}/${py} ${deg}°`).toBe(true);
      }
    }
  });

  it('Datei 08, Raster 0,05 pt: die Form mit Toleranz deckt die Form ohne bis auf höchstens 0,125 pt Rand', () => {
    let tris = 0;
    let probes = 0;
    for (const s of v2files) {
      const lit = withTolerance(0, s);
      const sim = strokeShape(decodeStroke({ ...s })); // mit dem Standard der Toleranz
      tris += sim.tris.length;
      // Die Form ohne Toleranz ist eine Vereinigung; ihr Rand besteht aus Kreisbögen und Tangenten, und die Abweichung
      // nimmt zum Rand hin zu. Darum genügt es, Kreise (Rand, 0,9·r, 0,5·r) und Trapezkanten dicht abzutasten.
      for (let i = 0; i < lit.circles.length; i += 3) {
        const [cx, cy, r] = [lit.circles[i]!, lit.circles[i + 1]!, lit.circles[i + 2]!];
        for (const f of [1, 0.9, 0.5]) {
          const steps = Math.max(8, Math.ceil((2 * Math.PI * r * f) / 0.05));
          for (let k = 0; k < steps; k++) {
            const t = (k / steps) * 2 * Math.PI;
            probes++;
            if (!inside(sim, cx + Math.cos(t) * r * f, cy + Math.sin(t) * r * f, 0.125))
              expect.fail(`${s.client_id}: Kreis ${i / 3} f=${f} t=${t}`);
          }
        }
      }
      for (let i = 0; i < lit.quads.length; i += 8)
        for (let j = 0; j < 4; j++) {
          const k = (j + 1) % 4;
          const [ax, ay, bx, by] = [
            lit.quads[i + j * 2]!,
            lit.quads[i + j * 2 + 1]!,
            lit.quads[i + k * 2]!,
            lit.quads[i + k * 2 + 1]!,
          ];
          const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.05));
          for (let q = 0; q <= steps; q++) {
            probes++;
            if (!inside(sim, ax + ((bx - ax) * q) / steps, ay + ((by - ay) * q) / steps, 0.125))
              expect.fail(`${s.client_id}: Trapez ${i / 8} Kante ${j}`);
          }
        }
    }
    expect(probes).toBeGreaterThan(100000);
    // Die Fasen sind im Spiel: ohne sie gäbe es hier nichts zu prüfen
    expect(tris).toBeGreaterThan(0);
  });
});
