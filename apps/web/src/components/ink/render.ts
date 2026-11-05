// Canvas-Renderer für Striche, Seitenvorlagen und Seitenelemente (08 §4, F-DSH-04).
// Alles wird in Seitenkoordinaten (pt, Ursprung oben links) gezeichnet; der Aufrufer setzt vorher die Skalierung
// (Fensterbreite × devicePixelRatio / Seitenbreite) per `ctx.setTransform`.
import { getStroke, type StrokeOptions } from 'perfect-freehand';
import type { PageElement, PageTemplate } from '@sg/shared';
import { DECODED_STRIDE, type DecodedStroke } from './stroke.ts';

/** Papierfarbe wie in den SVG-Vorschauen der Testdaten. Bleibt in Hell und Dunkel gleich (siehe InkPage). */
export const PAPER_COLOR = '#FAF9F5';
const GRID_COLOR = '#E3E5E8';
const MARGIN_COLOR = '#E8B4B4';

export interface PageGeometry {
  width_pt: number;
  height_pt: number;
  template: PageTemplate;
}

export const DEFAULT_PAGE: PageGeometry = { width_pt: 595, height_pt: 842, template: 'liniert' };

/**
 * Darstellung je Werkzeug. `perfect-freehand` rechnet den Radius als `size × easing(0,5 − thinning × (0,5 − Druck))`,
 * der Durchmesser ist bei Druck 0,5 also `size`. `size` wird als Anteil der Grundbreite (`width`) angegeben.
 */
interface ToolStyle {
  /** Faktor auf die Grundbreite */
  size: number;
  /** 0 = konstante Breite, 1 = Breite folgt dem Druck voll */
  thinning: number;
  smoothing: number;
  streamline: number;
  /** Untergrenze für den Druckanteil, damit Striche nie ganz verschwinden */
  floor: number;
  /** runde Enden (false = stumpf, Textmarker) */
  cap: boolean;
  /** Zusätzlicher Faktor auf die Deckkraft der Farbe */
  alpha: number;
  /** Konische Enden in Vielfachen der Breite (0 = keine) */
  taper: number;
}

export const TOOL_STYLES: Record<DecodedStroke['tool'], ToolStyle> = {
  // Kugelschreiber/Fineliner: gleichmäßig, leichte Druckreaktion
  pen: {
    size: 0.6,
    thinning: 0.85,
    smoothing: 0.55,
    streamline: 0.35,
    floor: 0.12,
    cap: true,
    alpha: 1,
    taper: 0,
  },
  // Füller: starke Druckvariation, auslaufende Enden
  fountain: {
    size: 0.58,
    thinning: 1,
    smoothing: 0.6,
    streamline: 0.35,
    floor: 0.1,
    cap: true,
    alpha: 1,
    taper: 1.2,
  },
  // Bleistift: weicher, etwas durchscheinend
  pencil: {
    size: 0.65,
    thinning: 0.7,
    smoothing: 0.5,
    streamline: 0.4,
    floor: 0.2,
    cap: true,
    alpha: 0.88,
    taper: 0,
  },
  // Monoline: konstante Breite, runde Enden
  monoline: {
    size: 1.0,
    thinning: 0,
    smoothing: 0.5,
    streamline: 0.45,
    floor: 0,
    cap: true,
    alpha: 1,
    taper: 0,
  },
  // Textmarker: konstante Breite, stumpfe Enden, Deckkraft kommt aus der Farbe (#RRGGBBAA)
  marker: {
    size: 1.0,
    thinning: 0,
    smoothing: 0.5,
    streamline: 0.5,
    floor: 0,
    cap: false,
    alpha: 1,
    taper: 0,
  },
};

/** Unbekanntes Werkzeug (neuerer Core) wird wie `pen` gezeichnet. */
function styleOf(d: DecodedStroke): ToolStyle {
  return TOOL_STYLES[d.tool] ?? TOOL_STYLES.pen;
}

type Outline = readonly number[][];
const outlines = new WeakMap<DecodedStroke, Outline>();

/** Umriss eines Strichs in Seitenkoordinaten. Wird je Strich einmal berechnet. */
export function strokeOutline(d: DecodedStroke): Outline {
  let o = outlines.get(d);
  if (o) return o;
  const s = styleOf(d);
  const input: number[][] = [];
  for (let i = 0; i < d.count; i++) {
    const o5 = i * DECODED_STRIDE;
    input.push([d.pts[o5]!, d.pts[o5 + 1]!, Math.min(1, Math.max(0, d.pts[o5 + 2]!))]);
  }
  const floor = s.floor;
  const taper = s.taper * d.width;
  const options: StrokeOptions = {
    size: d.width * s.size,
    thinning: s.thinning,
    smoothing: s.smoothing,
    streamline: s.streamline,
    simulatePressure: false,
    easing: floor > 0 ? (t) => Math.max(floor, t) : (t) => t,
    last: true,
    start: s.cap ? { cap: true, taper: taper > 0 ? taper : 0 } : { cap: false },
    end: s.cap ? { cap: true, taper: taper > 0 ? taper : 0 } : { cap: false },
  };
  o = getStroke(input, options);
  outlines.set(d, o);
  return o;
}

function rgba(c: { r: number; g: number; b: number }, a: number): string {
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${Math.round(a * 1000) / 1000})`;
}

/** Zeichnet einen Strich als gefüllten, geglätteten Umriss (ein Pfad, damit Transparenz nicht doppelt deckt). */
export function drawStroke(ctx: CanvasRenderingContext2D, d: DecodedStroke): void {
  const pts = strokeOutline(d);
  if (pts.length < 2) return;
  ctx.fillStyle = rgba(d.color, d.color.a * styleOf(d).alpha);
  ctx.beginPath();
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  ctx.moveTo((first[0]! + last[0]!) / 2, (first[1]! + last[1]!) / 2);
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    ctx.quadraticCurveTo(p[0]!, p[1]!, (p[0]! + q[0]!) / 2, (p[1]! + q[1]!) / 2);
  }
  ctx.closePath();
  ctx.fill();
}

/** Reihenfolge: erst die Textmarker-Ebene (unter der Schrift), dann die Tinte. */
export function strokesInPaintOrder(strokes: readonly DecodedStroke[]): DecodedStroke[] {
  return [
    ...strokes.filter((s) => s.layer === 'highlight'),
    ...strokes.filter((s) => s.layer !== 'highlight'),
  ];
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const bounds = new WeakMap<DecodedStroke, Rect>();

/** Umschließendes Rechteck eines Strichs in Seitenkoordinaten, mit Rand für die größte mögliche Strichbreite. */
export function strokeBounds(d: DecodedStroke): Rect {
  let r = bounds.get(d);
  if (r) return r;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < d.count; i++) {
    const x = d.pts[i * DECODED_STRIDE]!;
    const y = d.pts[i * DECODED_STRIDE + 1]!;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const pad = d.width * Math.max(styleOf(d).size * 2, 1) + 2;
  r = { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
  bounds.set(d, r);
  return r;
}

export function unionRect(a: Rect | null, b: Rect): Rect {
  return a
    ? {
        x0: Math.min(a.x0, b.x0),
        y0: Math.min(a.y0, b.y0),
        x1: Math.max(a.x1, b.x1),
        y1: Math.max(a.y1, b.y1),
      }
    : b;
}

const intersects = (a: Rect, b: Rect) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

let scratch: HTMLCanvasElement | null = null;

/**
 * Zeichnet nur einen Ausschnitt der Tinte-Ebene neu: Die Striche, die den Ausschnitt berühren, werden in einem kleinen
 * Zwischenspeicher gezeichnet und dann pixelgenau an die Stelle kopiert. Ein Zeichnen mit `clip()` ergäbe an den
 * Strichrändern leicht andere Kantenglättung als die Vollzeichnung (gemessen: bis 20 % Helligkeit).
 *
 * `scale` = Geräte-Pixel je pt, `size` = Pixelmaße der Ebene. Das Ergebnis ist pixelgleich zur Vollzeichnung.
 */
export function redrawRegion(
  ctx: CanvasRenderingContext2D,
  strokes: readonly DecodedStroke[],
  region: Rect,
  scale: number,
  size: { width: number; height: number },
): void {
  const x0 = Math.max(0, Math.floor(region.x0 * scale));
  const y0 = Math.max(0, Math.floor(region.y0 * scale));
  const w = Math.min(size.width, Math.ceil(region.x1 * scale)) - x0;
  const h = Math.min(size.height, Math.ceil(region.y1 * scale)) - y0;
  if (w <= 0 || h <= 0) return;
  scratch ??= document.createElement('canvas');
  if (scratch.width < w || scratch.height < h) {
    scratch.width = Math.max(scratch.width, w);
    scratch.height = Math.max(scratch.height, h);
  }
  const tctx = scratch.getContext('2d');
  if (!tctx) return;
  tctx.setTransform(1, 0, 0, 1, 0, 0);
  tctx.clearRect(0, 0, w, h);
  // Ganzzahlige Verschiebung in Geräte-Pixeln: die Geometrie bleibt dieselbe wie in der Vollzeichnung
  tctx.setTransform(scale, 0, 0, scale, -x0, -y0);
  const area: Rect = { x0: x0 / scale, y0: y0 / scale, x1: (x0 + w) / scale, y1: (y0 + h) / scale };
  for (const s of strokes) if (intersects(strokeBounds(s), area)) drawStroke(tctx, s);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(x0, y0, w, h);
  ctx.drawImage(scratch, 0, 0, w, h, x0, y0, w, h);
  ctx.restore();
}

export function drawStrokes(ctx: CanvasRenderingContext2D, strokes: readonly DecodedStroke[]): void {
  for (const s of strokes) drawStroke(ctx, s);
}

/** Papier und Vorlage (Linien, Karos, Punkte, Cornell). `folie` hat hier nur Papier (Folienbild kommt später). */
export function drawPaper(ctx: CanvasRenderingContext2D, page: PageGeometry): void {
  const { width_pt: w, height_pt: h, template } = page;
  ctx.fillStyle = PAPER_COLOR;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = GRID_COLOR;
  ctx.fillStyle = GRID_COLOR;
  ctx.lineWidth = 0.7;
  const line = (x1: number, y1: number, x2: number, y2: number) => {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };
  switch (template) {
    case 'liniert':
      for (let y = 60; y < h - 20; y += 30) line(40, y, w - 40, y);
      break;
    case 'kariert':
      for (let y = 20; y < h; y += 20) line(0, y, w, y);
      for (let x = 20; x < w; x += 20) line(x, 0, x, h);
      break;
    case 'punktraster':
      for (let y = 30; y < h; y += 20)
        for (let x = 30; x < w; x += 20) ctx.fillRect(x - 0.6, y - 0.6, 1.2, 1.2);
      break;
    case 'cornell': {
      for (let y = 80; y < h - 140; y += 28) line(30, y, w - 20, y);
      ctx.strokeStyle = MARGIN_COLOR;
      line(w * 0.3, 40, w * 0.3, h - 140);
      line(30, h - 140, w - 20, h - 140);
      break;
    }
    case 'blanko':
    case 'folie':
      break;
  }
}

const TEXT_SIZE = { s: 12, m: 16, l: 22 } as const;
const INK_TEXT = '#1F2937';

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let cur = '';
    for (const word of para.split(/\s+/)) {
      const next = cur ? `${cur} ${word}` : word;
      if (cur && ctx.measureText(next).width > maxWidth) {
        lines.push(cur);
        cur = word;
      } else cur = next;
    }
    lines.push(cur);
  }
  return lines;
}

function drawShape(ctx: CanvasRenderingContext2D, el: Extract<PageElement, { kind: 'shape' }>): void {
  const { shape, points, color, width } = el.payload;
  const hex = /^#(..)(..)(..)(..)$/.exec(color);
  ctx.strokeStyle = hex
    ? `rgba(${parseInt(hex[1]!, 16)}, ${parseInt(hex[2]!, 16)}, ${parseInt(hex[3]!, 16)}, ${parseInt(hex[4]!, 16) / 255})`
    : INK_TEXT;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const xs = points.map((p) => p[0]!);
  const ys = points.map((p) => p[1]!);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  ctx.beginPath();
  switch (shape) {
    case 'line':
    case 'arrow': {
      points.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0]!, p[1]!) : ctx.lineTo(p[0]!, p[1]!)));
      if (shape === 'arrow' && points.length >= 2) {
        const a = points[points.length - 2]!;
        const b = points[points.length - 1]!;
        const ang = Math.atan2(b[1]! - a[1]!, b[0]! - a[0]!);
        const len = Math.max(8, width * 4);
        for (const side of [-1, 1]) {
          ctx.moveTo(b[0]!, b[1]!);
          ctx.lineTo(b[0]! - len * Math.cos(ang + side * 0.45), b[1]! - len * Math.sin(ang + side * 0.45));
        }
      }
      break;
    }
    case 'rectangle':
      ctx.rect(x0, y0, x1 - x0, y1 - y0);
      break;
    case 'ellipse':
      ctx.ellipse((x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, 0, 0, Math.PI * 2);
      break;
    case 'triangle':
      ctx.moveTo((x0 + x1) / 2, y0);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x0, y1);
      ctx.closePath();
      break;
    case 'diamond':
      ctx.moveTo((x0 + x1) / 2, y0);
      ctx.lineTo(x1, (y0 + y1) / 2);
      ctx.lineTo((x0 + x1) / 2, y1);
      ctx.lineTo(x0, (y0 + y1) / 2);
      ctx.closePath();
      break;
  }
  ctx.stroke();
}

const STAMP_GLYPH = { frage: '?', klausur: '!', verknuepfung: '↔' } as const;

/** Zeichnet ein Seitenelement. Fotos erscheinen als Platzhalterrahmen (HEIC lässt sich im Browser nicht anzeigen). */
export function drawElement(ctx: CanvasRenderingContext2D, el: PageElement): void {
  const [x, y, w, h] = el.frame as [number, number, number, number];
  ctx.save();
  switch (el.kind) {
    case 'text': {
      const size = TEXT_SIZE[el.payload.size];
      ctx.fillStyle = INK_TEXT;
      ctx.font = `${size}px system-ui, sans-serif`;
      ctx.textBaseline = 'top';
      wrapText(ctx, el.payload.text, w).forEach((l, i) => ctx.fillText(l, x, y + i * size * 1.3));
      break;
    }
    case 'shape':
      drawShape(ctx, el);
      break;
    case 'tape': {
      const hex = /^#(..)(..)(..)(..)$/.exec(el.payload.color);
      const alpha = el.payload.covered ? 1 : 0.35;
      ctx.fillStyle = hex
        ? `rgba(${parseInt(hex[1]!, 16)}, ${parseInt(hex[2]!, 16)}, ${parseInt(hex[3]!, 16)}, ${alpha})`
        : '#9AA0A6';
      ctx.fillRect(x, y, w, h);
      break;
    }
    case 'stamp': {
      const r = Math.min(w, h) / 2;
      ctx.fillStyle = '#2F5DE0';
      ctx.beginPath();
      ctx.arc(x + w / 2, y + h / 2, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `bold ${Math.round(r * 1.2)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(STAMP_GLYPH[el.payload.marker_kind], x + w / 2, y + h / 2);
      break;
    }
    case 'image': {
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = '#80808A';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = '#80808A';
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Foto', x + w / 2, y + h / 2);
      break;
    }
  }
  ctx.restore();
}

/** Elemente nach `z`; Fotos liegen unter den Strichen, alles andere darüber. */
export function splitElements(elements: readonly PageElement[]): {
  below: PageElement[];
  above: PageElement[];
} {
  const sorted = [...elements].sort((a, b) => a.z - b.z);
  return {
    below: sorted.filter((e) => e.kind === 'image'),
    above: sorted.filter((e) => e.kind !== 'image'),
  };
}

/** Untere Ebene: Papier, Vorlage, Fotos und Textmarker (alles, was unter der Schrift liegt). */
export function paintUnder(
  ctx: CanvasRenderingContext2D,
  page: PageGeometry,
  images: readonly PageElement[],
  highlights: readonly DecodedStroke[],
): void {
  drawPaper(ctx, page);
  for (const e of images) drawElement(ctx, e);
  drawStrokes(ctx, highlights);
}

/** Löscht eine transparente Ebene (Tinte, Elemente). */
export function clearLayer(ctx: CanvasRenderingContext2D, page: PageGeometry): void {
  ctx.clearRect(0, 0, page.width_pt, page.height_pt);
}

/** Obere Ebene: Elemente, die über der Tinte liegen (Formen, Text, Klebeband, Stempel). */
export function paintTop(ctx: CanvasRenderingContext2D, above: readonly PageElement[]): void {
  for (const e of above) drawElement(ctx, e);
}

export interface Scene {
  page: PageGeometry;
  strokes: readonly DecodedStroke[];
  elements: readonly PageElement[];
}

/** Zeichnet die ganze Seite auf einen Canvas (Papier, Fotos, Textmarker, Tinte, übrige Elemente). Für Tests und Export. */
export function paintScene(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const { below, above } = splitElements(scene.elements);
  paintUnder(
    ctx,
    scene.page,
    below,
    scene.strokes.filter((s) => s.layer === 'highlight'),
  );
  drawStrokes(
    ctx,
    scene.strokes.filter((s) => s.layer !== 'highlight'),
  );
  paintTop(ctx, above);
}
