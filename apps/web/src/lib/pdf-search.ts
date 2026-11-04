import type { PdfTextItem } from './pdf.ts';

/** Ein Treffer der Volltextsuche: Textstück `item` auf Seite `page`, ab Zeichen `start`. */
export interface SearchHit {
  page: number;
  item: number;
  start: number;
  length: number;
}

/**
 * Kleinschreibung ohne die Länge zu ändern (`İ` würde sonst zwei Zeichen): Wo das Ergebnis eine andere Länge
 * hätte, bleibt das Originalzeichen. So stimmen die Offsets im Originaltext.
 */
export function fold(text: string): string {
  let out = '';
  for (const char of text) {
    const lower = char.toLocaleLowerCase('de');
    out += lower.length === char.length ? lower : char;
  }
  return out;
}

/**
 * Sucht `query` (ohne Beachtung der Groß-/Kleinschreibung) in den Textstücken einer Seite. Treffer über zwei
 * Textstücke hinweg werden nicht erkannt; dafür stimmen Anzahl und Hervorhebung immer überein.
 */
export function findHits(page: number, items: readonly PdfTextItem[], query: string): SearchHit[] {
  const needle = fold(query.trim());
  if (needle === '') return [];
  const hits: SearchHit[] = [];
  items.forEach((item, index) => {
    const haystack = fold(item.str);
    let from = 0;
    for (;;) {
      const at = haystack.indexOf(needle, from);
      if (at === -1) break;
      hits.push({ page, item: index, start: at, length: needle.length });
      from = at + needle.length;
    }
  });
  return hits;
}

export interface HitRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Breite eines Textes in beliebiger Einheit (nur das Verhältnis zählt), z. B. aus einem Canvas. */
export type Measure = (text: string, fontSize: number) => number;

/** Misst mit einem Canvas in der Systemschrift; ohne Canvas (Tests) `null`. */
export function makeMeasurer(): Measure | null {
  if (typeof document === 'undefined' || /jsdom/i.test(navigator.userAgent)) return null;
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return null;
  return (text, fontSize) => {
    context.font = `${Math.max(fontSize, 1)}px sans-serif`;
    return context.measureText(text).width;
  };
}

/**
 * Rechteck eines Treffers in pt. Das Textstück ist so breit wie pdf.js meldet; der Treffer sitzt dort, wo er
 * nach der Zeichenbreite in einer Systemschrift liegt (Proportionalschrift). Ohne Messung wird nach Zeichen
 * verteilt (Näherung).
 */
export function hitRect(
  item: PdfTextItem,
  hit: Pick<SearchHit, 'start' | 'length'>,
  measure: Measure | null = null,
): HitRect {
  const total = Math.max(item.str.length, 1);
  const before = item.str.slice(0, hit.start);
  const inside = item.str.slice(hit.start, hit.start + hit.length);
  const whole = measure ? measure(item.str, item.h) : 0;
  if (measure && whole > 0) {
    return {
      left: item.x + (item.w * measure(before, item.h)) / whole,
      top: item.y,
      width: (item.w * measure(inside, item.h)) / whole,
      height: item.h,
    };
  }
  return {
    left: item.x + (item.w * hit.start) / total,
    top: item.y,
    width: (item.w * hit.length) / total,
    height: item.h,
  };
}
