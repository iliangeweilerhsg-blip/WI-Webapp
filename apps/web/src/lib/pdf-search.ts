import type { PdfTextItem } from './pdf.ts';

/** Ein Treffer der Volltextsuche: Textstück `item` auf Seite `page`, ab Zeichen `start`. */
export interface SearchHit {
  page: number;
  item: number;
  start: number;
  length: number;
}

/**
 * Sucht `query` (ohne Beachtung der Groß-/Kleinschreibung) in den Textstücken einer Seite. Treffer über zwei
 * Textstücke hinweg werden nicht erkannt; dafür stimmen Anzahl und Hervorhebung immer überein.
 */
export function findHits(page: number, items: readonly PdfTextItem[], query: string): SearchHit[] {
  const needle = query.trim().toLocaleLowerCase('de');
  if (needle === '') return [];
  const hits: SearchHit[] = [];
  items.forEach((item, index) => {
    const haystack = item.str.toLocaleLowerCase('de');
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

/** Rechteck eines Treffers in pt. Das Textstück wird gleichmäßig auf seine Zeichen verteilt (Näherung). */
export function hitRect(item: PdfTextItem, hit: Pick<SearchHit, 'start' | 'length'>): HitRect {
  const total = Math.max(item.str.length, 1);
  return {
    left: item.x + (item.w * hit.start) / total,
    top: item.y,
    width: (item.w * hit.length) / total,
    height: item.h,
  };
}
