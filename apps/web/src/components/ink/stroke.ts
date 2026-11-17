// Strich-Format dekodieren (docs/spezifikation/08 §4.1/§4.2).
// `points` sind Rohkoordinaten VOR `transform`; Base64 von 6×Float32 little-endian je Punkt.
import type { Stroke } from '@sg/shared';

export const FLOATS_PER_POINT = 6;
export const BYTES_PER_POINT = FLOATS_PER_POINT * 4;

/** Affine Transformation [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f */
export type Matrix = readonly [number, number, number, number, number, number];

export interface InkPoint {
  x: number;
  y: number;
  /** ms seit `created_at` */
  dt: number;
  force: number;
  azimuth: number;
  altitude: number;
}

export interface Rgba {
  r: number;
  g: number;
  b: number;
  /** 0–1 */
  a: number;
}

/** Dekodiert `points` in `n × 6` Werte (x, y, dt, force, azimuth, altitude). Wirft bei kaputten Daten. */
export function decodePoints(base64: string): Float32Array {
  const bin = atob(base64);
  if (bin.length === 0 || bin.length % BYTES_PER_POINT !== 0) {
    throw new RangeError(`points: ${bin.length} Byte sind kein Vielfaches von ${BYTES_PER_POINT}`);
  }
  const view = new DataView(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) view.setUint8(i, bin.charCodeAt(i));
  const out = new Float32Array(bin.length / 4);
  // Bewusst per DataView: unabhängig von der Byte-Reihenfolge des Rechners
  for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(i * 4, true);
  return out;
}

/** Punkte als Objekte (für Tests und Auswertungen; der Renderer arbeitet direkt auf dem Float32Array). */
export function toPoints(raw: Float32Array): InkPoint[] {
  const pts: InkPoint[] = [];
  for (let i = 0; i + 5 < raw.length; i += FLOATS_PER_POINT) {
    pts.push({
      x: raw[i]!,
      y: raw[i + 1]!,
      dt: raw[i + 2]!,
      force: raw[i + 3]!,
      azimuth: raw[i + 4]!,
      altitude: raw[i + 5]!,
    });
  }
  return pts;
}

/** `#RRGGBBAA` → Kanäle. */
export function parseColor(hex: string): Rgba {
  const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})?$/.exec(hex);
  if (!m) return { r: 0, g: 0, b: 0, a: 1 };
  return {
    r: parseInt(m[1]!, 16),
    g: parseInt(m[2]!, 16),
    b: parseInt(m[3]!, 16),
    a: m[4] === undefined ? 1 : parseInt(m[4], 16) / 255,
  };
}

export function applyMatrix(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Längenmaßstab einer Transformation (Wurzel der Flächenänderung), damit skalierte Striche dicker/dünner werden. */
export function matrixScale(m: Matrix): number {
  const s = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  return Number.isFinite(s) && s > 0 ? s : 1;
}

/** Anzahl Werte je Punkt in `DecodedStroke.pts` */
export const DECODED_STRIDE = 5;

export interface DecodedStroke {
  id: string;
  tool: Stroke['tool'];
  layer: Stroke['layer'];
  color: Rgba;
  /** Grundbreite in pt, bereits mit dem Maßstab der Transformation multipliziert */
  width: number;
  /** Anzahl Punkte */
  count: number;
  /** Punkte NACH `transform`: x, y, force, azimuth, altitude je Punkt (5 Werte) */
  pts: Float32Array;
  /**
   * Durchmesser je Punkt in pt NACH `transform` (`max(width, height) × Maßstab`, 0,1 pt bis `MAX_STROKE_WIDTH`) aus
   * `sizes` (Strichformat v2, VERTRAEGE §23.8). `null` bei v1 und bei unbrauchbaren `sizes`: Der Strich wird dann
   * wie v1 gezeichnet.
   */
  diam: Float32Array | null;
  bbox: readonly [number, number, number, number];
}

/** Obergrenzen gegen kaputte oder böswillige Daten (der Core erlaubt höchstens 750 000 Byte = 31 250 Punkte). */
export const MAX_POINTS = 50_000;
/** Größte sinnvolle Grundbreite in pt (eine Seite ist 595 pt breit) */
export const MAX_STROKE_WIDTH = 200;
const MAX_COORD = 1e6;

/** Kleinster Durchmesser eines v2-Punkts in pt (Größe 0 am auslaufenden Ende wird darauf angehoben) */
export const MIN_DIAMETER = 0.1;

/**
 * Dekodiert `sizes` (je Punkt `width`, `height` als Float32 little-endian) zu `max(width, height)` je Punkt, vor
 * `transform`. `null` bei allem Unbrauchbaren: kein Base64, Länge ≠ Punktzahl × 8 Byte, NaN, unendlich, negativ oder
 * lauter Nullen (VERTRAEGE §23.2, §23.8). Wirft nie.
 */
export function decodeSizes(sizes: unknown, count: number): Float32Array | null {
  if (typeof sizes !== 'string' || count <= 0) return null;
  let bin: string;
  try {
    bin = atob(sizes);
  } catch {
    return null;
  }
  if (bin.length !== count * 8) return null;
  const view = new DataView(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) view.setUint8(i, bin.charCodeAt(i));
  const out = new Float32Array(count);
  let any = false;
  for (let i = 0; i < count; i++) {
    const w = view.getFloat32(i * 8, true);
    const h = view.getFloat32(i * 8 + 4, true);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 0 || h < 0) return null;
    const m = Math.max(w, h);
    if (m > 0) any = true;
    out[i] = m;
  }
  return any ? out : null;
}

/**
 * Dekodiert einen Strich und wendet `transform` an. Wirft bei unbrauchbaren Daten (Länge, NaN/Unendlich,
 * absurde Koordinaten, Breite ≤ 0); die Breite wird auf `MAX_STROKE_WIDTH` begrenzt.
 */
export function decodeStroke(stroke: Stroke): DecodedStroke {
  const raw = decodePoints(stroke.points);
  const m = stroke.transform as unknown as Matrix;
  const count = raw.length / FLOATS_PER_POINT;
  if (count > MAX_POINTS) throw new RangeError(`points: ${count} Punkte sind zu viel`);
  if (!m.every(Number.isFinite)) throw new RangeError('transform ist nicht endlich');
  if (!Number.isFinite(stroke.width) || stroke.width <= 0) throw new RangeError('width ist unbrauchbar');
  const pts = new Float32Array(count * DECODED_STRIDE);
  for (let i = 0; i < count; i++) {
    const [x, y] = applyMatrix(m, raw[i * 6]!, raw[i * 6 + 1]!);
    pts[i * 5] = x;
    pts[i * 5 + 1] = y;
    pts[i * 5 + 2] = raw[i * 6 + 3]!;
    pts[i * 5 + 3] = raw[i * 6 + 4]!;
    pts[i * 5 + 4] = raw[i * 6 + 5]!;
    for (let j = 0; j < 5; j++) {
      const v = pts[i * 5 + j]!;
      if (!Number.isFinite(v) || Math.abs(v) > MAX_COORD)
        throw new RangeError('Punktwert ist nicht brauchbar');
    }
  }
  // v2: `sizes` passen oder der Strich wird als v1 gezeichnet (nicht verworfen)
  const diam = decodeSizes(stroke.sizes, count);
  if (diam) {
    const scale = matrixScale(m);
    for (let i = 0; i < count; i++)
      diam[i] = Math.min(MAX_STROKE_WIDTH, Math.max(MIN_DIAMETER, diam[i]! * scale));
  }
  return {
    id: stroke.client_id,
    tool: stroke.tool,
    layer: stroke.layer,
    color: parseColor(stroke.color),
    width: Math.min(MAX_STROKE_WIDTH, stroke.width * matrixScale(m)),
    count,
    pts,
    diam,
    bbox: stroke.bbox as unknown as readonly [number, number, number, number],
  };
}

const cache = new WeakMap<Stroke, DecodedStroke | null>();

/** Wie `decodeStroke`, aber je Strich-Objekt nur einmal; kaputte Striche ergeben `null` (werden übersprungen). */
export function decodeStrokeCached(stroke: Stroke): DecodedStroke | null {
  let d = cache.get(stroke);
  if (d === undefined) {
    try {
      d = decodeStroke(stroke);
    } catch {
      d = null;
    }
    cache.set(stroke, d);
  }
  return d;
}
