// Treffer auf Striche einer Notizseite (F-NAC-04): Welcher Strich liegt unter dem Tipp, und in welcher Reihenfolge
// geschrieben wurde. Nur Striche mit Zeit (`t_start_ms`) lassen sich abspielen. Die Dekodierung ist die der
// Ink-Darstellung (je Strich einmal, gemerkt), hier kommt nur die Geometrie dazu.
import type { Stroke } from '@sg/shared';
import { strokeBounds, type Rect } from '../ink/render.ts';
import { DECODED_STRIDE, decodeStrokeCached, type DecodedStroke } from '../ink/stroke.ts';

export interface HitEntry {
  id: string;
  /** Beginn des Strichs in Sitzungszeit nach Serveruhr (ms) */
  t: number;
  d: DecodedStroke;
  rect: Rect;
}

export interface HitIndex {
  /** Alle abspielbaren Striche, nach Zeit sortiert (bei gleicher Zeit nach Reihenfolge der Liste) */
  timed: HitEntry[];
}

/**
 * `offsets`: Geräteversatz je Strich (`PageStrokes.stroke_offsets_ms`, §9.3, #332). Die Zeit eines Strichs ist dann
 * `max(0, t_start_ms + Versatz)`. Fehlt der Versatz (älterer Core, Strich ohne Eintrag), gilt `t_start_ms`.
 */
export function buildHitIndex(
  strokes: readonly Stroke[],
  offsets: Readonly<Record<string, number>> = {},
): HitIndex {
  const timed: HitEntry[] = [];
  for (const s of strokes) {
    if (s.t_start_ms === null) continue;
    const d = decodeStrokeCached(s);
    if (!d || d.count === 0) continue;
    timed.push({
      id: d.id,
      t: Math.max(0, s.t_start_ms + (offsets[s.client_id] ?? 0)),
      d,
      rect: strokeBounds(d),
    });
  }
  // Array.sort ist stabil: gleiche Zeiten behalten ihre Reihenfolge
  timed.sort((a, b) => a.t - b.t);
  return { timed };
}

/** Abstand eines Punkts zum Linienzug des Strichs (pt) */
function distanceToStroke(d: DecodedStroke, x: number, y: number): number {
  const p = d.pts;
  let best = Infinity;
  let px = p[0]!;
  let py = p[1]!;
  if (d.count === 1) return Math.hypot(x - px, y - py);
  for (let i = 1; i < d.count; i++) {
    const qx = p[i * DECODED_STRIDE]!;
    const qy = p[i * DECODED_STRIDE + 1]!;
    const vx = qx - px;
    const vy = qy - py;
    const len2 = vx * vx + vy * vy;
    const u = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - px) * vx + (y - py) * vy) / len2));
    const dist = Math.hypot(x - (px + u * vx), y - (py + u * vy));
    if (dist < best) best = dist;
    px = qx;
    py = qy;
  }
  return best;
}

/**
 * Der Strich, der dem Punkt (`x`, `y` in pt) am nächsten liegt, höchstens `tolerance` pt (plus halbe Strichbreite)
 * entfernt. Tinte hat Vorrang vor Textmarker: Ein Textmarker liegt oft über Schrift und würde sie sonst verdecken.
 * Vor dem Abstand sortiert das umschließende Rechteck aus, damit auch tausende Striche schnell geprüft sind.
 */
export function hitTest(index: HitIndex, x: number, y: number, tolerance: number): HitEntry | null {
  let bestInk: HitEntry | null = null;
  let bestInkDist = Infinity;
  let bestHl: HitEntry | null = null;
  let bestHlDist = Infinity;
  for (const e of index.timed) {
    const r = e.rect;
    if (x < r.x0 - tolerance || x > r.x1 + tolerance || y < r.y0 - tolerance || y > r.y1 + tolerance)
      continue;
    const reach = tolerance + e.d.width / 2;
    const dist = distanceToStroke(e.d, x, y);
    if (dist > reach) continue;
    // Bei gleichem Abstand gewinnt der später geschriebene (liegt oben)
    if (e.d.layer === 'highlight') {
      if (dist <= bestHlDist) {
        bestHl = e;
        bestHlDist = dist;
      }
    } else if (dist <= bestInkDist) {
      bestInk = e;
      bestInkDist = dist;
    }
  }
  return bestInk ?? bestHl;
}
