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
  /** Folie als Hintergrund (nur in `InkPage` ausgewertet, dort liegt sie als Bild unter dem Canvas) */
  background_slide_id?: string | null;
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
  /**
   * Schätzung für v1-Striche (VERTRAEGE §23.8, V2-5): Druck = `0,5 × force / Median`, auf `[min, max]` begrenzt.
   * `null` = `force` geht unverändert ein (Monoline und Textmarker, dort ist der Durchmesser schon `width`).
   */
  pressure: { min: number; max: number } | null;
}

export const TOOL_STYLES: Record<DecodedStroke['tool'], ToolStyle> = {
  // Kugelschreiber/Fineliner: gleichmäßig, leichte Druckreaktion
  pen: {
    size: 1.0,
    thinning: 0.85,
    smoothing: 0.55,
    streamline: 0.35,
    floor: 0.12,
    cap: true,
    alpha: 1,
    taper: 0,
    pressure: { min: 0.3, max: 0.7 },
  },
  // Füller: starke Druckvariation, auslaufende Enden
  fountain: {
    size: 1.0,
    thinning: 1,
    smoothing: 0.6,
    streamline: 0.35,
    floor: 0.1,
    cap: true,
    alpha: 1,
    taper: 1.2,
    pressure: { min: 0, max: 1 },
  },
  // Bleistift: weicher, etwas durchscheinend
  pencil: {
    size: 1.0,
    thinning: 0.7,
    smoothing: 0.5,
    streamline: 0.4,
    floor: 0.2,
    cap: true,
    alpha: 0.88,
    taper: 0,
    pressure: { min: 0, max: 1 },
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
    pressure: null,
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
    pressure: null,
  },
};

/** Unbekanntes Werkzeug (neuerer Core) wird wie `pen` gezeichnet. */
function styleOf(d: DecodedStroke): ToolStyle {
  return TOOL_STYLES[d.tool] ?? TOOL_STYLES.pen;
}

type Outline = readonly number[][];
const outlines = new WeakMap<DecodedStroke, Outline>();

/**
 * Druck je Punkt für `perfect-freehand` (VERTRAEGE §23.8, V2-5, eine SCHÄTZUNG für Striche ohne `sizes`).
 * Bekannt ist nur, dass `width` der Median des echten Durchmessers ist; der Maßstab von `force` ist unbekannt
 * (der Teiler am iPad ist geraten). Darum wird der Druck am Median `m` von `force` (Punkte mit `force > 0`) verankert:
 * `clamp(0,5 × force / m, min, max)`. Beim mittleren Druck ist der Strich so genau `width` breit, geschätzt bleibt nur
 * die Schwankung darum. Ohne Punkt mit `force > 0` ist der Druck überall 0,5. Werkzeuge ohne Schätzung: `force` pur.
 */
function pressureOf(d: DecodedStroke, s: ToolStyle): Float32Array {
  const out = new Float32Array(d.count);
  const range = s.pressure;
  if (!range) {
    for (let i = 0; i < d.count; i++) out[i] = Math.min(1, Math.max(0, d.pts[i * DECODED_STRIDE + 2]!));
    return out;
  }
  const pos: number[] = [];
  for (let i = 0; i < d.count; i++) {
    const f = d.pts[i * DECODED_STRIDE + 2]!;
    if (f > 0) pos.push(f);
  }
  if (pos.length === 0) return out.fill(0.5);
  pos.sort((a, b) => a - b);
  const mid = pos.length >> 1;
  const m = pos.length % 2 ? pos[mid]! : (pos[mid - 1]! + pos[mid]!) / 2;
  for (let i = 0; i < d.count; i++) {
    const p = (0.5 * d.pts[i * DECODED_STRIDE + 2]!) / m;
    out[i] = Math.min(range.max, Math.max(range.min, p));
  }
  return out;
}

/** Umriss eines Strichs in Seitenkoordinaten. Wird je Strich einmal berechnet. */
export function strokeOutline(d: DecodedStroke): Outline {
  let o = outlines.get(d);
  if (o) return o;
  const s = styleOf(d);
  const press = pressureOf(d, s);
  const input: number[][] = [];
  for (let i = 0; i < d.count; i++) {
    const o5 = i * DECODED_STRIDE;
    input.push([d.pts[o5]!, d.pts[o5 + 1]!, press[i]!]);
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

// ---------------------------------------------------------------------------------------------------------------------
// Strichformat v2 (VERTRAEGE §23.8): Form direkt aus dem Durchmesser je Punkt, für alle Werkzeuge, ohne perfect-freehand.

/** Abschnitte über dieser Länge (pt) werden verdichtet; Punkte unter 0,01 pt Abstand werden zusammengefasst */
const DENSIFY_STEP = 1.5;
const MERGE_DIST = 0.01;
/** Zwischenpunkte je Abschnitt und je Strich (sonst ergäben große Koordinatensprünge Hunderttausende Punkte) */
export const MAX_FILL_PER_SEGMENT = 64;
export const MAX_FILL_PER_STROKE = 5000;

/** Teilflächen eines v2-Strichs, alle mit positivem Umlaufsinn (Summe x_i·y_{i+1} − x_{i+1}·y_i > 0) */
export interface StrokeShape {
  /** Scheiben: x, y, r je Kreis */
  circles: Float64Array;
  /** Vierecke: 8 Werte (x0, y0 … x3, y3) je Viereck */
  quads: Float64Array;
  /** Fasen: 6 Werte (x0, y0 … x2, y2) je Dreieck. Je weggelassener Scheibe an einer Biegung zwei (je Seite eins) */
  tris: Float64Array;
  /** Punkte der Kette nach Zusammenfassen und Verdichten (ohne Rücksicht auf weggelassene Enden) */
  chainLength: number;
  /** Zwischenpunkte, die das Verdichten eingefügt hat */
  filled: number;
  /** Punkte der Kette nach dem Weglassen überflüssiger Zwischenpunkte (so viele Scheiben und Trapeze höchstens) */
  simplified: number;
  /** Umschließendes Rechteck der Mittelpunkte der Kette (inkl. verdichteter Punkte) */
  center: Rect;
  /** Größter Durchmesser der Kette */
  maxDiam: number;
}

/** `discTolerance`: größte Abweichung in pt, bei der eine Scheibe an einer fast geraden Stelle entfallen darf (0 = nie) */
export const SHAPE_TUNING = { discTolerance: 0.02 };

const shapes = new WeakMap<DecodedStroke, StrokeShape>();

/** Weiter als so viele Punkte fasst `simplifyChain` nicht zusammen (hält die Laufzeit linear) */
const SIMPLIFY_REACH = 48;

/**
 * Entfernt Zwischenpunkte (in place), die höchstens `tol` pt von der Geraden zwischen ihren Nachbarn abweichen und deren
 * Durchmesser dort höchstens `2 × tol` vom linearen Verlauf abweicht. Der erste und der letzte Punkt bleiben.
 * Eine Umkehr (Spitzkehre) fasst es nie zusammen.
 */
function simplifyChain(x: number[], y: number[], dd: number[], tol: number): void {
  const n = x.length;
  const keep: number[] = [0];
  let a = 0;
  while (a < n - 1) {
    let best = a + 1;
    for (let b = a + 2; b < n && b <= a + SIMPLIFY_REACH; b++) {
      const ex = x[b]! - x[a]!;
      const ey = y[b]! - y[a]!;
      const len2 = ex * ex + ey * ey;
      let ok = len2 > 0;
      for (let j = a + 1; ok && j < b; j++) {
        const t = ((x[j]! - x[a]!) * ex + (y[j]! - y[a]!) * ey) / len2;
        const off = Math.abs((x[j]! - x[a]!) * ey - (y[j]! - y[a]!) * ex) / Math.sqrt(len2);
        ok = t >= 0 && t <= 1 && off <= tol && Math.abs(dd[j]! - (dd[a]! + t * (dd[b]! - dd[a]!))) <= 2 * tol;
      }
      if (!ok) break;
      best = b;
    }
    keep.push(best);
    a = best;
  }
  keep.forEach((i, k) => {
    x[k] = x[i]!;
    y[k] = y[i]!;
    dd[k] = dd[i]!;
  });
  x.length = y.length = dd.length = keep.length;
}

/** Zusammenfassen, Verdichten, Scheiben und Trapeze eines v2-Strichs. Je Strich einmal berechnet. */
export function strokeShape(d: DecodedStroke): StrokeShape {
  let sh = shapes.get(d);
  if (sh) return sh;
  const diam = d.diam!;
  // 1. Punkte zusammenfassen (größerer Durchmesser gewinnt)
  const xs: number[] = [];
  const ys: number[] = [];
  const ds: number[] = [];
  for (let i = 0; i < d.count; i++) {
    const x = d.pts[i * DECODED_STRIDE]!;
    const y = d.pts[i * DECODED_STRIDE + 1]!;
    const n = xs.length;
    if (n > 0 && Math.hypot(x - xs[n - 1]!, y - ys[n - 1]!) < MERGE_DIST) {
      if (diam[i]! > ds[n - 1]!) ds[n - 1] = diam[i]!;
    } else {
      xs.push(x);
      ys.push(y);
      ds.push(diam[i]!);
    }
  }
  // 2. Verdichten: Catmull-Rom durch die Nachbarpunkte, Durchmesser linear
  const n0 = xs.length;
  const ks = new Array<number>(Math.max(0, n0 - 1)).fill(0);
  let total = 0;
  if (n0 <= MAX_FILL_PER_STROKE) {
    for (let i = 0; i + 1 < n0; i++) {
      const len = Math.hypot(xs[i + 1]! - xs[i]!, ys[i + 1]! - ys[i]!);
      if (len > DENSIFY_STEP) {
        ks[i] = Math.min(MAX_FILL_PER_SEGMENT, Math.ceil(len / DENSIFY_STEP) - 1);
        total += ks[i]!;
      }
    }
    if (total > MAX_FILL_PER_STROKE) {
      const f = MAX_FILL_PER_STROKE / total;
      total = 0;
      for (let i = 0; i < ks.length; i++) {
        ks[i] = Math.floor(ks[i]! * f);
        total += ks[i]!;
      }
    }
  }
  const cx: number[] = [];
  const cy: number[] = [];
  const cd: number[] = [];
  for (let i = 0; i < n0; i++) {
    cx.push(xs[i]!);
    cy.push(ys[i]!);
    cd.push(ds[i]!);
    const k = i + 1 < n0 ? ks[i]! : 0;
    if (k === 0) continue;
    // Am Rand der Kette gibt es keinen Nachbarn: gespiegelter Hilfspunkt, damit ein einzelner Abschnitt gerade bleibt
    // und die Zwischenpunkte gleichmäßig liegen
    const [ax, ay] = i > 0 ? [xs[i - 1]!, ys[i - 1]!] : [2 * xs[0]! - xs[1]!, 2 * ys[0]! - ys[1]!];
    const [bx, by] =
      i + 2 < n0 ? [xs[i + 2]!, ys[i + 2]!] : [2 * xs[n0 - 1]! - xs[n0 - 2]!, 2 * ys[n0 - 1]! - ys[n0 - 2]!];
    for (let j = 1; j <= k; j++) {
      const t = j / (k + 1);
      const t2 = t * t;
      const t3 = t2 * t;
      const w0 = -0.5 * t3 + t2 - 0.5 * t;
      const w1 = 1.5 * t3 - 2.5 * t2 + 1;
      const w2 = -1.5 * t3 + 2 * t2 + 0.5 * t;
      const w3 = 0.5 * t3 - 0.5 * t2;
      cx.push(w0 * ax + w1 * xs[i]! + w2 * xs[i + 1]! + w3 * bx);
      cy.push(w0 * ay + w1 * ys[i]! + w2 * ys[i + 1]! + w3 * by);
      cd.push(ds[i]! + (ds[i + 1]! - ds[i]!) * t);
    }
  }
  const dense = cx.length;
  // Fast gerade, gleichmäßig dicker werdende Stücke der verdichteten Kette tragen dieselbe Fläche wie ein einziges
  // Trapez zwischen ihren Enden (der Durchmesser ist entlang der Geraden linear, die Tangenten sind dieselben). Solche
  // Zwischenpunkte lässt der Renderer weg, solange die Abweichung unter `discTolerance` bleibt.
  if (SHAPE_TUNING.discTolerance > 0 && dense > 2) simplifyChain(cx, cy, cd, SHAPE_TUNING.discTolerance);
  const n = cx.length;
  const cap = styleOf(d).cap;
  // 4. Trapeze über die äußeren Tangenten; liegt ein Kreis im anderen, entfällt das Trapez
  const quads: number[] = [];
  const hasQuad: boolean[] = [];
  // Einheitsnormalen der beiden Tangenten je Abschnitt (zeigen von der Kette weg), für die Prüfung der Scheiben unten
  const tanA: number[][] = [];
  const tanB: number[][] = [];
  for (let i = 0; i + 1 < n; i++) {
    const dx = cx[i + 1]! - cx[i]!;
    const dy = cy[i + 1]! - cy[i]!;
    const dist = Math.hypot(dx, dy);
    const r0 = cd[i]! / 2;
    const r1 = cd[i + 1]! / 2;
    if (!(dist > Math.abs(r0 - r1))) {
      hasQuad.push(false);
      tanA.push([]);
      tanB.push([]);
      continue;
    }
    const ux = dx / dist;
    const uy = dy / dist;
    const nx = -uy;
    const ny = ux;
    const s = (r0 - r1) / dist;
    const c = Math.sqrt(Math.max(0, 1 - s * s));
    const ax = s * ux + c * nx;
    const ay = s * uy + c * ny;
    const bx = s * ux - c * nx;
    const by = s * uy - c * ny;
    const q = [
      cx[i]! + r0 * ax,
      cy[i]! + r0 * ay,
      cx[i + 1]! + r1 * ax,
      cy[i + 1]! + r1 * ay,
      cx[i + 1]! + r1 * bx,
      cy[i + 1]! + r1 * by,
      cx[i]! + r0 * bx,
      cy[i]! + r0 * by,
    ];
    // 5. Umlaufsinn positiv
    let area = 0;
    for (let j = 0; j < 4; j++) {
      const k = (j + 1) % 4;
      area += q[j * 2]! * q[k * 2 + 1]! - q[k * 2]! * q[j * 2 + 1]!;
    }
    if (area < 0) {
      for (let j = 3; j >= 0; j--) quads.push(q[j * 2]!, q[j * 2 + 1]!);
    } else quads.push(...q);
    hasQuad.push(true);
    tanA.push([ax, ay]);
    tanB.push([bx, by]);
  }
  // Textmarker (stumpfe Enden): keine Scheibe am ersten und letzten Punkt (dort schließt ein Trapez an). Dazu keine
  // Scheibe der Folgepunkte, die über die Schnittkante am Ende hinausragt, sonst wäre das Ende wieder rund.
  const skip = new Array<boolean>(n).fill(false);
  if (!cap && n >= 2) {
    const edge = (from: number, step: 1 | -1) => {
      const last = from + step;
      if (!hasQuad[Math.min(from, last)]) return;
      const ux = (cx[last]! - cx[from]!) / Math.hypot(cx[last]! - cx[from]!, cy[last]! - cy[from]!);
      const uy = (cy[last]! - cy[from]!) / Math.hypot(cx[last]! - cx[from]!, cy[last]! - cy[from]!);
      skip[from] = true;
      for (let j = from + step; j > 0 && j < n - 1; j += step) {
        const reach = (cx[j]! - cx[from]!) * ux + (cy[j]! - cy[from]!) * uy;
        if (!(reach < cd[j]! / 2) || !hasQuad[Math.min(j, j - step)] || !hasQuad[Math.min(j, j + step)])
          break;
        skip[j] = true;
      }
    };
    edge(0, 1);
    edge(n - 1, -1);
  }
  // 3. Scheiben. Eine Scheibe an einem inneren Punkt füllt nur den Keil an der Außenseite einer Biegung zwischen den
  // beiden Trapezen. Ist der Keil so schmal, dass die Sehne weniger als `discTolerance` (pt) von der Kreislinie
  // abweicht, lässt der Renderer die Scheibe weg: Das Auge sieht nichts, der Pfad hat aber viel weniger Teilpfade.
  const tol = SHAPE_TUNING.discTolerance;
  if (tol > 0) {
    for (let j = 1; j + 1 < n; j++) {
      if (skip[j] || !hasQuad[j - 1] || !hasQuad[j]) continue;
      const turn = Math.max(
        Math.acos(Math.min(1, tanA[j - 1]![0]! * tanA[j]![0]! + tanA[j - 1]![1]! * tanA[j]![1]!)),
        Math.acos(Math.min(1, tanB[j - 1]![0]! * tanB[j]![0]! + tanB[j - 1]![1]! * tanB[j]![1]!)),
      );
      if ((cd[j]! / 2) * (1 - Math.cos(turn / 2)) <= tol) skip[j] = true;
    }
  }
  // Fasen: Wo eine Scheibe an einer Biegung entfällt, bliebe zwischen den beiden Trapezen ein Keil vom Mittelpunkt bis
  // zum Rand offen (Abweichung ≈ √(2·tol·r), nicht nur r·(1 − cos(θ/2))). Je Seite ein Dreieck aus dem Mittelpunkt und
  // den beiden Berührpunkten der äußeren Tangenten schließt ihn bis auf das Kreissegment.
  const tris: number[] = [];
  for (let j = 1; j + 1 < n; j++) {
    if (!skip[j] || !hasQuad[j - 1] || !hasQuad[j]) continue;
    const r = cd[j]! / 2;
    for (const t of [tanA, tanB]) {
      const p = [
        cx[j]!,
        cy[j]!,
        cx[j]! + r * t[j - 1]![0]!,
        cy[j]! + r * t[j - 1]![1]!,
        cx[j]! + r * t[j]![0]!,
        cy[j]! + r * t[j]![1]!,
      ];
      const area =
        p[0]! * p[3]! - p[2]! * p[1]! + (p[2]! * p[5]! - p[4]! * p[3]!) + (p[4]! * p[1]! - p[0]! * p[5]!);
      if (area < 0) tris.push(p[0]!, p[1]!, p[4]!, p[5]!, p[2]!, p[3]!);
      else tris.push(...p);
    }
  }
  const circles: number[] = [];
  let maxDiam = 0;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    if (cd[i]! > maxDiam) maxDiam = cd[i]!;
    if (cx[i]! < x0) x0 = cx[i]!;
    if (cx[i]! > x1) x1 = cx[i]!;
    if (cy[i]! < y0) y0 = cy[i]!;
    if (cy[i]! > y1) y1 = cy[i]!;
    if (n === 1 && !cap) {
      // Textmarker aus einem Punkt: Quadrat mit der Kantenlänge des Durchmessers
      const h = cd[0]! / 2;
      quads.push(
        cx[0]! - h,
        cy[0]! - h,
        cx[0]! + h,
        cy[0]! - h,
        cx[0]! + h,
        cy[0]! + h,
        cx[0]! - h,
        cy[0]! + h,
      );
    } else if (!skip[i]) circles.push(cx[i]!, cy[i]!, cd[i]! / 2);
  }
  sh = {
    circles: Float64Array.from(circles),
    quads: Float64Array.from(quads),
    tris: Float64Array.from(tris),
    chainLength: dense,
    filled: dense - n0,
    simplified: n,
    center: { x0, y0, x1, y1 },
    maxDiam,
  };
  shapes.set(d, sh);
  return sh;
}

function drawShape2(ctx: CanvasRenderingContext2D, d: DecodedStroke): void {
  const sh = strokeShape(d);
  ctx.fillStyle = rgba(d.color, d.color.a * styleOf(d).alpha);
  ctx.beginPath();
  const { circles, quads, tris } = sh;
  for (let i = 0; i < circles.length; i += 3) {
    const x = circles[i]!;
    const y = circles[i + 1]!;
    const r = circles[i + 2]!;
    // Ohne moveTo zöge der Pfad eine Linie vom vorigen Teilpfad zum Kreis
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, Math.PI * 2, false);
    ctx.closePath();
  }
  for (let i = 0; i < quads.length; i += 8) {
    ctx.moveTo(quads[i]!, quads[i + 1]!);
    ctx.lineTo(quads[i + 2]!, quads[i + 3]!);
    ctx.lineTo(quads[i + 4]!, quads[i + 5]!);
    ctx.lineTo(quads[i + 6]!, quads[i + 7]!);
    ctx.closePath();
  }
  for (let i = 0; i < tris.length; i += 6) {
    ctx.moveTo(tris[i]!, tris[i + 1]!);
    ctx.lineTo(tris[i + 2]!, tris[i + 3]!);
    ctx.lineTo(tris[i + 4]!, tris[i + 5]!);
    ctx.closePath();
  }
  ctx.fill('nonzero');
}

/**
 * Mitte des Flecks, wenn alle Punkte (auch mehrere) auf einem Fleck liegen, sonst `null`. Beim Füller ist das jeder
 * Strich, dessen Ausdehnung (Diagonale des umschließenden Rechtecks) kleiner als `width` ist: Ein getipptes Pünktchen
 * zittert, und `perfect-freehand` frisst mit dem auslaufenden Ende (`taper`, 1,2 × `width`) so kurze Striche ganz auf
 * (#390, VERTRAEGE §23.8). Bei den anderen Werkzeugen gilt wie bei v2 `MERGE_DIST`.
 */
function singlePointCenter(d: DecodedStroke): { x: number; y: number } | null {
  if (d.count < 1) return null;
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
  const limit = d.tool === 'fountain' ? Math.max(MERGE_DIST, d.width) : MERGE_DIST;
  if (Math.hypot(x1 - x0, y1 - y0) >= limit) return null;
  return d.count === 1 ? { x: x0, y: y0 } : { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}

/** v1-Strich aus einem einzigen Punkt: Scheibe mit Durchmesser `width`, beim Textmarker (stumpf) ein Quadrat. */
function drawDot(ctx: CanvasRenderingContext2D, d: DecodedStroke, c: { x: number; y: number }): void {
  const r = d.width / 2;
  const { x, y } = c;
  ctx.fillStyle = rgba(d.color, d.color.a * styleOf(d).alpha);
  ctx.beginPath();
  if (styleOf(d).cap) {
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, Math.PI * 2, false);
  } else {
    ctx.moveTo(x - r, y - r);
    ctx.lineTo(x + r, y - r);
    ctx.lineTo(x + r, y + r);
    ctx.lineTo(x - r, y + r);
  }
  ctx.closePath();
  ctx.fill();
}

/** Zeichnet einen Strich als gefüllten, geglätteten Umriss (ein Pfad, damit Transparenz nicht doppelt deckt). */
export function drawStroke(ctx: CanvasRenderingContext2D, d: DecodedStroke): void {
  if (d.diam) {
    drawShape2(ctx, d);
    return;
  }
  const dot = singlePointCenter(d);
  if (dot) {
    drawDot(ctx, d, dot);
    return;
  }
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
  if (d.diam) {
    // v2: Mittelpunkte der Kette (auch die verdichteten, die Kurve kann über die Eingabepunkte hinausschwingen),
    // dazu der halbe größte Durchmesser
    const sh = strokeShape(d);
    const pad = sh.maxDiam / 2 + 2;
    r = { x0: sh.center.x0 - pad, y0: sh.center.y0 - pad, x1: sh.center.x1 + pad, y1: sh.center.y1 + pad };
    bounds.set(d, r);
    return r;
  }
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
/** Ab dieser Fläche (Pixel) wird der Zwischen-Canvas nach Gebrauch freigegeben (1 Mio. Pixel = 4 MB) */
export const SCRATCH_KEEP_PX = 1_000_000;

/**
 * Zeichnet nur einen Ausschnitt der Tinte-Ebene neu: Die Striche, die den Ausschnitt berühren, werden in einem kleinen
 * Zwischenspeicher gezeichnet und dann pixelgenau an die Stelle kopiert. Ein Zeichnen mit `clip()` ergäbe an den
 * Strichrändern leicht andere Kantenglättung als die Vollzeichnung (gemessen: bis 20 % Helligkeit).
 *
 * `scale` = Geräte-Pixel je pt, `size` = Pixelmaße der Ebene. Das Ergebnis entspricht der Vollzeichnung, ist aber nicht
 * strikt pixelgleich: An fast transparenten Randpixeln gibt es Abweichungen, an der Ausschnittsgrenze vereinzelt bis
 * etwa 80/255, ohne sichtbare Nähte.
 *
 * Der Zwischen-Canvas ist global und wächst nur bei Bedarf. Nach Gebrauch wird er auf 0×0 gesetzt, wenn er größer als
 * `SCRATCH_KEEP_PX` ist, damit ein einmaliger großer Ausschnitt keinen Speicher dauerhaft belegt.
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
  if (scratch.width * scratch.height > SCRATCH_KEEP_PX) {
    scratch.width = 0;
    scratch.height = 0;
  }
}

/** Nur für Tests: verwirft den globalen Zwischen-Canvas, damit der Zustand nicht von der Testreihenfolge abhängt. */
export function resetScratchCanvas(): void {
  scratch = null;
}

export function drawStrokes(ctx: CanvasRenderingContext2D, strokes: readonly DecodedStroke[]): void {
  for (const s of strokes) drawStroke(ctx, s);
}

/**
 * Geometrie der Vorlagen, identisch zur iPad-App (`InkTemplateGeometry.swift`, VERTRAEGE §7.4). Einheit pt,
 * Ursprung oben links, bezogen auf `width_pt` × `height_pt` der Seite.
 */
/** Rastermaß für kariert und Punktraster: 5 mm */
export const GRID_PT = 14.173;
export const LINE_WIDTH_PT = 0.7;
export const DOT_DIAMETER_PT = 1.2;
export const RULED_FIRST_PT = 60;
export const RULED_SPACING_PT = 30;
export const RULED_MARGIN_PT = 40;
export const RULED_BOTTOM_PT = 20;
/** Toleranz, damit eine Linie genau auf dem Seitenrand nicht gezeichnet wird */
const EPSILON = 0.001;

export interface TemplateLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Linien der Vorlage (`liniert`, `kariert`). `cornell` wird hier wie auf dem iPad als `liniert` gezeichnet. */
export function templateLines(template: PageTemplate, w: number, h: number): TemplateLine[] {
  if (!(w > 0) || !(h > 0)) return [];
  const result: TemplateLine[] = [];
  switch (template) {
    case 'liniert':
    case 'cornell':
      for (let step = 0; ; step++) {
        const y = RULED_FIRST_PT + step * RULED_SPACING_PT;
        if (!(y < h - RULED_BOTTOM_PT)) break;
        result.push({ x1: RULED_MARGIN_PT, y1: y, x2: w - RULED_MARGIN_PT, y2: y });
      }
      break;
    case 'kariert':
      for (let row = 1; row * GRID_PT < h - EPSILON; row++)
        result.push({ x1: 0, y1: row * GRID_PT, x2: w, y2: row * GRID_PT });
      for (let col = 1; col * GRID_PT < w - EPSILON; col++)
        result.push({ x1: col * GRID_PT, y1: 0, x2: col * GRID_PT, y2: h });
      break;
    default:
      break;
  }
  return result;
}

/** Mittelpunkte der Punkte des Punktrasters: alle Kreuzungen des Rasters, ohne Rand */
export function templateDots(template: PageTemplate, w: number, h: number): [number, number][] {
  if (template !== 'punktraster' || !(w > 0) || !(h > 0)) return [];
  const result: [number, number][] = [];
  for (let row = 1; row * GRID_PT < h - EPSILON; row++)
    for (let col = 1; col * GRID_PT < w - EPSILON; col++) result.push([col * GRID_PT, row * GRID_PT]);
  return result;
}

/**
 * Papier und Vorlage (Linien, Karos, Punkte). Hat die Seite eine Folie als Hintergrund und ist sie geladen
 * (`transparent`), bleibt das Papier aus; die Folie liegt dann als Bild unter dem Canvas.
 */
export function drawPaper(ctx: CanvasRenderingContext2D, page: PageGeometry, transparent = false): void {
  const { width_pt: w, height_pt: h, template } = page;
  if (!transparent) {
    ctx.fillStyle = PAPER_COLOR;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.strokeStyle = GRID_COLOR;
  ctx.fillStyle = GRID_COLOR;
  ctx.lineWidth = LINE_WIDTH_PT;
  if (template === 'cornell') {
    // Eigene Cornell-Vorlage des Webs (das iPad zeichnet sie wie `liniert`)
    const line = (x1: number, y1: number, x2: number, y2: number) => {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    };
    for (let y = 80; y < h - 140; y += 28) line(30, y, w - 20, y);
    ctx.strokeStyle = MARGIN_COLOR;
    line(w * 0.3, 40, w * 0.3, h - 140);
    line(30, h - 140, w - 20, h - 140);
    return;
  }
  for (const l of templateLines(template, w, h)) {
    ctx.beginPath();
    ctx.moveTo(l.x1, l.y1);
    ctx.lineTo(l.x2, l.y2);
    ctx.stroke();
  }
  const r = DOT_DIAMETER_PT / 2;
  for (const [x, y] of templateDots(template, w, h))
    ctx.fillRect(x - r, y - r, DOT_DIAMETER_PT, DOT_DIAMETER_PT);
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
  transparentPaper = false,
): void {
  drawPaper(ctx, page, transparentPaper);
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
