import type { PdfTextItem } from './pdf.ts';

/** Ein Stück eines Treffers: Zeichen `start` bis `start + length` im Textstück `item` (Originaltext von pdf.js). */
export interface HitPart {
  item: number;
  start: number;
  length: number;
}

/** Ein Treffer der Volltextsuche auf Seite `page`. Er kann über mehrere Textstücke reichen (ein Rechteck je Stück). */
export interface SearchHit {
  page: number;
  parts: HitPart[];
}

// ---------- Normalisierung ----------

const DASHES = /[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/gu;
const DOUBLE_QUOTES = /[\u201C-\u201F\u2033\u00AB\u00BB]/gu;
const SINGLE_QUOTES = /[\u2018-\u201B\u2032]/gu;
const IS_SPACE = /^\s+$/u;
const MARK = /\p{M}/u;
const NON_ASCII = /[^\u0020-\u007e\t\n\r]/u;

/**
 * Normalform eines Zeichenclusters (Grundzeichen mit Akzenten): NFKC (löst Ligaturen, geschützte Leerzeichen und
 * zerlegte Umlaute auf), Kleinschreibung, einheitliche Striche und Anführungszeichen. Kann mehrere Zeichen ergeben
 * („ﬁ“ → „fi“, „İ“ → „i̇“); Weiche Trennzeichen ergeben nichts.
 */
function normalizeCluster(cluster: string): string {
  if (cluster === '\u00AD') return '';
  let text = cluster;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) > 127) {
      text = text.normalize('NFKC');
      break;
    }
  }
  text = text.toLocaleLowerCase('de').normalize('NFKC');
  text = text
    .replace(DASHES, '-')
    .replace(DOUBLE_QUOTES, '"')
    .replace(SINGLE_QUOTES, "'")
    .replaceAll('\u00AD', '');
  return IS_SPACE.test(text) ? ' ' : text;
}

/** Zerlegt in Cluster (Zeichen samt folgenden Akzenten) mit Anfang und Ende im Original. */
function* clusters(text: string): Generator<{ text: string; from: number; to: number }> {
  let from = 0;
  let i = 0;
  while (i < text.length) {
    const cp = text.codePointAt(i) ?? 0;
    i += cp > 0xffff ? 2 : 1;
    // Folgende Akzente (U+0300…) gehören zum Grundzeichen; ein Akzent am Anfang bildet einen eigenen Cluster
    while (i < text.length) {
      const next = text.codePointAt(i) ?? 0;
      if (next < 0x300 || !MARK.test(String.fromCodePoint(next))) break;
      i += next > 0xffff ? 2 : 1;
    }
    yield { text: text.slice(from, i), from, to: i };
    from = i;
  }
}

/** Anfrage und Seitentext werden gleich normalisiert: Whitespace-Folgen werden ein Leerzeichen, Ränder entfallen. */
export function normalizeQuery(query: string): string {
  let out = '';
  for (const cluster of clusters(query)) {
    const text = normalizeCluster(cluster.text);
    if (text === ' ' && (out === '' || out.endsWith(' '))) continue;
    out += text;
  }
  return out.endsWith(' ') ? out.slice(0, -1) : out;
}

// ---------- Seitentext mit Zuordnung ----------

/**
 * Normalisierter Suchtext einer Seite. Zu jedem Zeichen im Text steht, aus welchem Textstück es stammt
 * (`item`, -1 bei eingefügten Leerzeichen) und welchen Bereich es dort im Originaltext einnimmt.
 */
export interface PageText {
  text: string;
  item: Int32Array;
  from: Int32Array;
  to: Int32Array;
}

/** Wie ein Zeilenende, das mit Trennstrich endet, behandelt wird. */
type HyphenMode = 'join' | 'keep' | 'space';

/** Anteil der Schrifthöhe: Lücken darüber gelten als Wortzwischenraum (Kerning bleibt darunter). */
const GAP_FACTOR = 0.18;
/** Anteil der Schrifthöhe: Versatz nach oben/unten, ab dem eine neue Zeile beginnt (Hoch-/Tiefstellung bleibt darunter). */
const LINE_FACTOR = 0.6;

function isLineBreak(prev: PdfTextItem, item: PdfTextItem, flagged: boolean): boolean {
  if (flagged || prev.eol) return true;
  return Math.abs(item.y - prev.y) > LINE_FACTOR * Math.max(prev.h, item.h, 1);
}

function isWordGap(prev: PdfTextItem, item: PdfTextItem): boolean {
  const gap = item.x - (prev.x + prev.w);
  // Rückwärts (andere Spalte, Tabulator) zählt wie Abstand
  return gap > GAP_FACTOR * Math.max(prev.h, item.h, 1) || item.x < prev.x;
}

function build(items: readonly PdfTextItem[], mode: HyphenMode): { page: PageText; hyphens: number } {
  const chars: string[] = [];
  const itemOf: number[] = [];
  const fromOf: number[] = [];
  const toOf: number[] = [];
  let prev: PdfTextItem | null = null;
  let pendingSpace = false;
  let pendingBreak = false;
  let hyphens = 0;

  const push = (char: string, item: number, from: number, to: number) => {
    chars.push(char);
    itemOf.push(item);
    fromOf.push(from);
    toOf.push(to);
  };

  items.forEach((item, index) => {
    const pieces: { text: string; orig: string; from: number; to: number }[] = [];
    if (!NON_ASCII.test(item.str)) {
      // Schneller Weg (die meisten Stücke): ein Zeichen = ein Cluster, keine Unicode-Normalisierung nötig
      for (let i = 0; i < item.str.length; i += 1) {
        const orig = item.str.charAt(i);
        pieces.push({ text: /\s/.test(orig) ? ' ' : orig.toLowerCase(), orig, from: i, to: i + 1 });
      }
    } else {
      for (const cluster of clusters(item.str)) {
        const text = normalizeCluster(cluster.text);
        if (text !== '') pieces.push({ text, orig: cluster.text, from: cluster.from, to: cluster.to });
      }
    }
    const firstReal = pieces.findIndex((p) => p.text !== ' ');
    if (firstReal === -1) {
      // Nur Leerraum (oder leer): ein Leerzeichen bzw. Zeilenende, das beim nächsten Stück wirkt
      if (pieces.length > 0) pendingSpace = true;
      if (item.eol) pendingBreak = true;
      return;
    }
    const leading = pieces.slice(0, firstReal).length > 0;
    const startPieces = pieces.slice(firstReal);
    if (prev) {
      const lineBreak = isLineBreak(prev, item, pendingBreak);
      const last = chars[chars.length - 1];
      const beforeHyphen = chars[chars.length - 2];
      const nextChar = startPieces[0]?.text ?? '';
      const hyphenated =
        lineBreak &&
        last === '-' &&
        beforeHyphen !== undefined &&
        /^\p{L}$/u.test(beforeHyphen) &&
        /^\p{L}/u.test(nextChar);
      if (hyphenated) {
        hyphens += 1;
        // Nur vor Kleinbuchstaben (im Original) ist es Silbentrennung; „Input-“ ↵ „Output“ bleibt ein Bindestrich-Wort
        const lower = /^\p{Ll}/u.test(startPieces[0]?.orig ?? '');
        if (mode === 'join' && lower) {
          // Silbentrennung am Zeilenende: Trennstrich und Umbruch entfallen („markt-“ ↵ „gleich“ → „marktgleich“)
          chars.pop();
          itemOf.pop();
          fromOf.pop();
          toOf.pop();
        } else if (mode === 'space') {
          push(' ', -1, 0, 0);
        }
        // Sonst: echter Bindestrich, ohne Leerzeichen („markt-gleich“)
      } else if (
        (pendingSpace || lineBreak || leading || isWordGap(prev, item)) &&
        chars.length > 0 &&
        last !== ' '
      ) {
        push(' ', -1, 0, 0);
      }
    }
    pendingSpace = false;
    pendingBreak = false;
    // Innere Whitespace-Folgen zu einem Leerzeichen
    for (const piece of startPieces) {
      if (piece.text === ' ' && chars[chars.length - 1] === ' ') continue;
      for (const char of piece.text) push(char, index, piece.from, piece.to);
    }
    // Leerzeichen am Ende des Stücks wirken als Wortgrenze zum nächsten
    if (chars[chars.length - 1] === ' ' && itemOf[itemOf.length - 1] === index) {
      pendingSpace = true;
    }
    if (item.eol) pendingBreak = true;
    prev = item;
  });

  return {
    page: {
      text: chars.join(''),
      item: Int32Array.from(itemOf),
      from: Int32Array.from(fromOf),
      to: Int32Array.from(toOf),
    },
    hyphens,
  };
}

const cache = new WeakMap<readonly PdfTextItem[], PageText[]>();

/**
 * Suchtexte einer Seite (zwischengespeichert pro Textstück-Liste). Gibt es Silbentrennung am Zeilenende,
 * kommen Varianten dazu, damit sowohl „marktgleich…“ als auch „markt-gleich…“ und „markt- gleich…“ gefunden werden.
 */
export function pageTexts(items: readonly PdfTextItem[]): PageText[] {
  const cached = cache.get(items);
  if (cached) return cached;
  const first = build(items, 'join');
  const texts = [first.page];
  if (first.hyphens > 0) {
    texts.push(build(items, 'keep').page, build(items, 'space').page);
  }
  cache.set(items, texts);
  return texts;
}

/** Rechnet einen Treffer im Suchtext in Bereiche der Originalstücke um (ein Teil je Textstück). */
function partsOf(page: PageText, begin: number, end: number): HitPart[] {
  const parts: HitPart[] = [];
  for (let i = begin; i < end; i += 1) {
    const item = page.item[i] ?? -1;
    if (item === -1) continue;
    const from = page.from[i] ?? 0;
    const to = page.to[i] ?? 0;
    const last = parts[parts.length - 1];
    if (last && last.item === item) {
      const start = Math.min(last.start, from);
      last.length = Math.max(last.start + last.length, to) - start;
      last.start = start;
    } else {
      parts.push({ item, start: from, length: to - from });
    }
  }
  return parts;
}

function overlaps(a: HitPart[], b: HitPart[]): boolean {
  return a.some((p) =>
    b.some((q) => p.item === q.item && p.start < q.start + q.length && q.start < p.start + p.length),
  );
}

/**
 * Sucht `query` (ohne Beachtung von Groß-/Kleinschreibung, Ligaturen, Zeichenzerlegung, Strichen und
 * Anführungszeichen) im Text einer Seite. Treffer dürfen über mehrere Textstücke und über Zeilenumbrüche reichen.
 * Anzahl und Hervorhebung stimmen überein, weil beide aus denselben `HitPart`s kommen.
 */
export function findHits(page: number, items: readonly PdfTextItem[], query: string): SearchHit[] {
  const needle = normalizeQuery(query);
  if (needle === '') return [];
  const hits: SearchHit[] = [];
  pageTexts(items).forEach((variant, v) => {
    let from = 0;
    for (;;) {
      const at = variant.text.indexOf(needle, from);
      if (at === -1) break;
      from = at + needle.length;
      const parts = partsOf(variant, at, at + needle.length);
      if (parts.length === 0) continue;
      // Varianten mit Trennstrich liefern nur, was die erste nicht schon trifft
      if (v > 0 && hits.some((h) => overlaps(h.parts, parts))) continue;
      hits.push({ page, parts });
    }
  });
  return hits.sort(
    (a, b) =>
      (a.parts[0]?.item ?? 0) - (b.parts[0]?.item ?? 0) ||
      (a.parts[0]?.start ?? 0) - (b.parts[0]?.start ?? 0),
  );
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
  hit: Pick<HitPart, 'start' | 'length'>,
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
