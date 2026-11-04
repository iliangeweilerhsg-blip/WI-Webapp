// Strich-Dekodierung gegen die Testdaten (08 §4.2): Punktzahl, Werte, bbox.
import { describe, expect, it } from 'vitest';
import { PageStrokesSchema } from '@sg/shared';
import {
  decodePoints,
  decodeStroke,
  matrixScale,
  parseColor,
  toPoints,
} from '../src/components/ink/stroke.ts';
import { loadFixtures } from './ink-fixtures.ts';

const files = loadFixtures();
const all = files.flatMap((f) => f.strokes);

/** Unabhängige Referenz: Node-Buffer statt DataView */
function referenceFloats(base64: string): number[] {
  const buf = Buffer.from(base64, 'base64');
  const out: number[] = [];
  for (let i = 0; i < buf.length; i += 4) out.push(buf.readFloatLE(i));
  return out;
}

describe('Testdaten', () => {
  it('7 Dateien mit 299 Strichen, alle passen zum Schema', () => {
    expect(files).toHaveLength(7);
    expect(all).toHaveLength(299);
    const res = PageStrokesSchema.safeParse({
      page_id: '019a4e14-0000-7000-8000-000000000001',
      stream_seq: 0,
      stream_op_id: null,
      strokes: all,
    });
    expect(res.success).toBe(true);
  });
});

describe('decodePoints', () => {
  it('liefert bei allen 299 Strichen Punktzahl und Werte wie die Referenz-Dekodierung', () => {
    for (const s of all) {
      const raw = decodePoints(s.points);
      const ref = referenceFloats(s.points);
      expect(raw.length, s.client_id).toBe(ref.length);
      expect(raw.length % 6).toBe(0);
      // 32 Base64-Zeichen = 24 Byte = 1 Punkt
      expect(raw.length / 6).toBe(s.points.length / 32);
      expect(Array.from(raw)).toEqual(ref);
    }
  });

  it('Punkte: dt beginnt bei 0 und steigt, force/altitude/azimuth im erlaubten Bereich', () => {
    for (const s of all) {
      const pts = toPoints(decodePoints(s.points));
      expect(pts[0]!.dt, s.client_id).toBe(0);
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i]!;
        if (i > 0) expect(p.dt).toBeGreaterThanOrEqual(pts[i - 1]!.dt);
        expect(p.force).toBeGreaterThanOrEqual(0);
        expect(p.force).toBeLessThanOrEqual(1);
        expect(p.altitude).toBeGreaterThanOrEqual(0);
        expect(p.altitude).toBeLessThanOrEqual(Math.PI / 2 + 1e-6);
        expect(Math.abs(p.azimuth)).toBeLessThanOrEqual(Math.PI + 1e-6);
      }
      if (s.t_start_ms !== null && s.t_end_ms !== null) {
        expect(Math.abs(s.t_end_ms - s.t_start_ms - pts[pts.length - 1]!.dt)).toBeLessThanOrEqual(5);
      }
    }
  });

  it('kennt Referenzwerte aus dem Python-Packer (erster Strich der Handschrift, 138 Punkte)', () => {
    const s = files[0]!.strokes[0]!;
    const pts = toPoints(decodePoints(s.points));
    expect(pts).toHaveLength(138);
    expect(pts[0]).toEqual({
      x: 58,
      y: 160,
      dt: 0,
      force: 0.18000000715255737,
      azimuth: 0.5478000044822693,
      altitude: 1.132200002670288,
    });
    expect(pts[69]!.x).toBeCloseTo(80.5191421508789, 6);
    expect(pts[69]!.y).toBeCloseTo(150.53065490722656, 6);
    expect(pts[69]!.dt).toBeCloseTo(285.54998779296875, 6);
    expect(pts[69]!.force).toBeCloseTo(0.7084838151931763, 6);
    expect(pts[137]).toMatchObject({ x: 101.41999816894531, y: 160, force: 0.11999999731779099 });
  });

  it('lehnt kaputte Längen ab', () => {
    expect(() => decodePoints('')).toThrow(RangeError);
    expect(() => decodePoints(btoa('x'.repeat(23)))).toThrow(RangeError);
  });
});

describe('decodeStroke', () => {
  it('bbox umschließt alle transformierten Punkte plus halbe Breite (Toleranz 0,5 pt)', () => {
    for (const s of all) {
      const d = decodeStroke(s);
      const [bx, by, bw, bh] = s.bbox as [number, number, number, number];
      const half = s.width / 2;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < d.count; i++) {
        const x = d.pts[i * 5]!;
        const y = d.pts[i * 5 + 1]!;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      expect(minX - half, s.client_id).toBeGreaterThanOrEqual(bx - 0.5);
      expect(minY - half).toBeGreaterThanOrEqual(by - 0.5);
      expect(maxX + half).toBeLessThanOrEqual(bx + bw + 0.5);
      expect(maxY + half).toBeLessThanOrEqual(by + bh + 0.5);
      // und die bbox ist nicht viel größer als nötig
      expect(bw).toBeLessThanOrEqual(maxX - minX + s.width + 1);
      expect(bh).toBeLessThanOrEqual(maxY - minY + s.width + 1);
    }
  });

  it('wendet transform an (Lasso-Verschiebung +50/+20), points bleiben gleich', () => {
    const lasso = files.find((f) => f.name.startsWith('05'))!.strokes;
    const [orig, moved] = lasso.map((s) => ({ s, d: decodeStroke(s) })) as [
      { s: (typeof lasso)[number]; d: ReturnType<typeof decodeStroke> },
      { s: (typeof lasso)[number]; d: ReturnType<typeof decodeStroke> },
    ];
    expect(orig.s.points).toBe(moved.s.points);
    expect(moved.s.transform).toEqual([1, 0, 0, 1, 50, 20]);
    expect(moved.d.count).toBe(orig.d.count);
    for (let i = 0; i < orig.d.count; i++) {
      expect(moved.d.pts[i * 5]! - orig.d.pts[i * 5]!).toBeCloseTo(50, 4);
      expect(moved.d.pts[i * 5 + 1]! - orig.d.pts[i * 5 + 1]!).toBeCloseTo(20, 4);
    }
    expect(moved.d.width).toBe(moved.s.width);
  });

  it('Maßstab der Transformation skaliert die Breite', () => {
    expect(matrixScale([2, 0, 0, 2, 0, 0])).toBe(2);
    expect(matrixScale([1, 0, 0, 1, 5, 5])).toBe(1);
    expect(matrixScale([0, 0, 0, 0, 0, 0])).toBe(1);
  });

  it('Randfälle: Einpunkt-Strich, 1000 Punkte, Druck 0 und 1', () => {
    const edge = files.find((f) => f.name.startsWith('06'))!.strokes.map(decodeStroke);
    expect(edge.map((d) => d.count)).toEqual([1, 2, 1000, edge[3]!.count, edge[4]!.count]);
    const forces = Array.from({ length: edge[3]!.count }, (_, i) => edge[3]!.pts[i * 5 + 2]!);
    expect(Math.min(...forces)).toBe(0);
    expect(Math.max(...forces)).toBe(1);
  });
});

describe('parseColor', () => {
  it('liest #RRGGBBAA', () => {
    expect(parseColor('#1E2A44FF')).toEqual({ r: 30, g: 42, b: 68, a: 1 });
    const hl = parseColor('#FFE06666');
    expect(hl).toMatchObject({ r: 255, g: 224, b: 102 });
    expect(hl.a).toBeCloseTo(0.4, 5);
  });
});
