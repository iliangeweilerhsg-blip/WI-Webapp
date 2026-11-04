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

const DASHES = /[‐-―−﹘﹣－]/gu;
const DOUBLE_QUOTES = /[“-‟″«»]/gu;
const SINGLE_QUOTES = /[‘-‛′´`]/gu;
const INVISIBLE = new RegExp('^[\\u200B-\\u200D\\uFEFF]+$', 'u');
const IS_SPACE = /^\s+$/u;
const MARK = /\p{M}/u;
const NON_ASCII = /[^ -~\t\n\r]/u;
const ALNUM = /^[\p{L}\p{N}]/u;
const LETTER = /^\p{L}/u;
const LOWER = /^\p{Ll}/u;

function unify(text: string): string {
  return text
    .replace(DASHES, '-')
    .replace(DOUBLE_QUOTES, '"')
    .replace(SINGLE_QUOTES, "'")
    .replaceAll('\u2044', '/')
    .replaceAll('\u00AD', '');
}

/**
 * Normalform eines Zeichenclusters (Grundzeichen mit Akzenten): NFKC (löst Ligaturen, geschützte Leerzeichen und
 * zerlegte Umlaute auf), Kleinschreibung, einheitliche Striche und Anführungszeichen. Kann mehrere Zeichen ergeben
 * („ﬁ“ → „fi“); weiche Trennzeichen und unsichtbare Zeichen (Breite null) ergeben nichts. „İ“ gilt wie „i“.
 */
function normalizeCluster(cluster: string): string {
  if (cluster === '\u00AD' || INVISIBLE.test(cluster)) return '';
  // Vor NFKC vereinheitlichen (U+00B4 würde dort zu „Leerzeichen + Akzent“), danach noch einmal für NFKC-Ergebnisse
  let text = unify(cluster);
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) > 127) {
      text = text.normalize('NFKC');
      break;
    }
  }
  text = unify(text.toLocaleLowerCase('de').normalize('NFKC')).replaceAll('i\u0307', 'i');
  return IS_SPACE.test(text) ? ' ' : text;
}

/** Zerlegt in Cluster (Zeichen samt folgenden Akzenten) mit Anfang und Ende im Original (UTF-16-Einheiten). */
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
 * Normalisierter Suchtext einer Seite. Zu jeder UTF-16-Einheit im Text steht, aus welchem Textstück sie stammt
 * (`item`, -1 bei eingefügten Leerzeichen) und welchen Bereich ihr Zeichen dort im Originaltext einnimmt.
 * Zeichen über 65535 Einheiten Stücklänge werden begrenzt (praktisch nie).
 */
export interface PageText {
  text: string;
  item: Int32Array;
  from: Uint16Array;
  to: Uint16Array;
}

/**
 * Wie ein Zeilenende behandelt wird:
 * - `join`: Silbentrennung (Strich oder weiches Trennzeichen vor Kleinbuchstaben) wird verbunden, sonst Leerzeichen.
 * - `keep`: Trennstrich bleibt stehen, ohne Leerzeichen („markt-gleich“).
 * - `space`: Trennstrich bleibt stehen, mit Leerzeichen („markt- gleich“).
 * - `glue`: wie `join`, zusätzlich Zeilenwechsel zwischen zwei Kleinbuchstaben ohne Strich verbunden
 *   („möglichkei“ ↵ „ten“: Strich fehlt in der Textebene).
 */
type Mode = 'join' | 'keep' | 'space' | 'glue';

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

interface Built {
  page: PageText;
  /** Zeilenenden mit Trennstrich bzw. weichem Trennzeichen */
  hyphens: number;
  /** Zeilenwechsel zwischen zwei Kleinbuchstaben ohne Strich */
  glues: number;
}

function build(items: readonly PdfTextItem[], mode: Mode): Built {
  const chars: string[] = [];
  const itemOf: number[] = [];
  const fromOf: number[] = [];
  const toOf: number[] = [];
  let prev: PdfTextItem | null = null;
  let pendingSpace = false;
  let pendingBreak = false;
  let prevSoft = false;
  let hyphens = 0;
  let glues = 0;

  const push = (unit: string, item: number, from: number, to: number) => {
    chars.push(unit);
    itemOf.push(item);
    fromOf.push(Math.min(from, 0xffff));
    toOf.push(Math.min(to, 0xffff));
  };
  const pop = () => {
    chars.pop();
    itemOf.pop();
    fromOf.pop();
    toOf.pop();
  };

  items.forEach((item, index) => {
    const pieces: { text: string; orig: string; from: number; to: number }[] = [];
    if (!NON_ASCII.test(item.str)) {
      // Schneller Weg (die meisten Stücke): ein Zeichen = ein Cluster, keine Unicode-Normalisierung nötig
      for (let i = 0; i < item.str.length; i += 1) {
        const orig = item.str.charAt(i);
        const text = /\s/.test(orig) ? ' ' : orig === '`' ? "'" : orig.toLowerCase();
        pieces.push({ text, orig, from: i, to: i + 1 });
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
    const leading = firstReal > 0;
    const startPieces = pieces.slice(firstReal);
    if (prev) {
      const lineBreak = isLineBreak(prev, item, pendingBreak);
      const last = chars[chars.length - 1] ?? '';
      const beforeLast = chars[chars.length - 2] ?? '';
      const nextText = startPieces[0]?.text ?? '';
      const nextOrig = startPieces[0]?.orig ?? '';
      // Trennstrich am Zeilenende: Buchstabe oder Ziffer davor, Buchstabe oder Ziffer danach
      const visible = lineBreak && last === '-' && ALNUM.test(beforeLast) && ALNUM.test(nextText);
      // Weiches Trennzeichen am Ende des vorigen Stücks
      const soft = lineBreak && prevSoft && last !== '-' && ALNUM.test(last) && LETTER.test(nextText);
      if (visible || soft) {
        hyphens += 1;
        // Verbunden wird nur Buchstabe-Strich-Kleinbuchstabe: „Input-“ ↵ „Output“ und „1990-“ ↵ „2000“ bleiben stehen
        const joinable = (soft || LETTER.test(beforeLast)) && LOWER.test(nextOrig);
        if (soft) {
          if (mode === 'space') push(' ', -1, 0, 0);
        } else if ((mode === 'join' || mode === 'glue') && joinable) {
          pop();
        } else if (mode === 'space') {
          push(' ', -1, 0, 0);
        }
        // Sonst: Strich bleibt, ohne Leerzeichen („markt-gleich“)
      } else {
        const glue = lineBreak && !leading && !pendingSpace && LOWER.test(last) && LOWER.test(nextOrig);
        if (glue) glues += 1;
        if (glue && mode === 'glue') {
          // verbunden, kein Leerzeichen
        } else if (
          (pendingSpace || lineBreak || leading || isWordGap(prev, item)) &&
          chars.length > 0 &&
          last !== ' '
        ) {
          push(' ', -1, 0, 0);
        }
      }
    }
    pendingSpace = false;
    pendingBreak = false;
    // Innere Whitespace-Folgen zu einem Leerzeichen; jede UTF-16-Einheit einzeln (Emoji sind zwei)
    for (const piece of startPieces) {
      if (piece.text === ' ' && chars[chars.length - 1] === ' ') continue;
      for (let k = 0; k < piece.text.length; k += 1) push(piece.text.charAt(k), index, piece.from, piece.to);
    }
    // Leerzeichen am Ende des Stücks wirken als Wortgrenze zum nächsten
    if (chars[chars.length - 1] === ' ' && itemOf[itemOf.length - 1] === index) {
      pendingSpace = true;
    }
    prevSoft = /­\s*$/u.test(item.str);
    if (item.eol) pendingBreak = true;
    prev = item;
  });

  return {
    page: {
      text: chars.join(''),
      item: Int32Array.from(itemOf),
      from: Uint16Array.from(fromOf),
      to: Uint16Array.from(toOf),
    },
    hyphens,
    glues,
  };
}

interface PageIndex {
  modes: Map<Mode, PageText>;
  hyphens: number;
  glues: number;
}

const cache = new WeakMap<readonly PdfTextItem[], PageIndex>();

function indexOf(items: readonly PdfTextItem[]): PageIndex {
  let index = cache.get(items);
  if (!index) {
    const first = build(items, 'join');
    index = { modes: new Map([['join', first.page]]), hyphens: first.hyphens, glues: first.glues };
    cache.set(items, index);
  }
  return index;
}

function textOf(items: readonly PdfTextItem[], index: PageIndex, mode: Mode): PageText {
  let text = index.modes.get(mode);
  if (!text) {
    text = build(items, mode).page;
    index.modes.set(mode, text);
  }
  return text;
}

/**
 * Suchtexte einer Seite für diese Anfrage (je Seite und Modus zwischengespeichert, Modi nur bei Bedarf gebaut):
 * - `join` immer.
 * - `glue` nur, wenn die Seite Zeilenwechsel zwischen Kleinbuchstaben hat (sonst identisch mit `join`).
 * - `keep` und `space` nur für Anfragen mit „-“ und Seiten mit Trennstrichen: Ohne „-“ in der Anfrage kann ein Treffer
 *   nie über einen stehenden Strich reichen, alles andere trifft `join` schon.
 */
export function pageTexts(items: readonly PdfTextItem[], needle = '-'): PageText[] {
  const index = indexOf(items);
  const modes: Mode[] = ['join'];
  if (index.glues > 0) modes.push('glue');
  if (index.hyphens > 0 && needle.includes('-')) modes.push('keep', 'space');
  return modes.map((mode) => textOf(items, index, mode));
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

/** Lage eines Treffers im Originaltext der Seite als Zahlenbereich (Stücke liegen in Lesereihenfolge). */
const SLOT = 0x10000;
function span(parts: readonly HitPart[]): [number, number] {
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (!first || !last) return [0, 0];
  return [first.item * SLOT + first.start, last.item * SLOT + last.start + last.length];
}

/**
 * Sucht `query` (ohne Beachtung von Groß-/Kleinschreibung, Ligaturen, Zeichenzerlegung, Strichen und
 * Anführungszeichen) im Text einer Seite. Treffer dürfen über mehrere Textstücke und über Zeilenumbrüche reichen.
 * Anzahl und Hervorhebung stimmen überein, weil beide aus denselben `HitPart`s kommen.
 */
export function findHits(page: number, items: readonly PdfTextItem[], query: string): SearchHit[] {
  const needle = normalizeQuery(query);
  if (needle === '') return [];
  let accepted: { hit: SearchHit; begin: number; end: number }[] = [];
  pageTexts(items, needle).forEach((variant, v) => {
    const fresh: typeof accepted = [];
    let from = 0;
    for (;;) {
      const at = variant.text.indexOf(needle, from);
      if (at === -1) break;
      from = at + needle.length;
      const parts = partsOf(variant, at, at + needle.length);
      if (parts.length === 0) continue;
      const [begin, end] = span(parts);
      if (v > 0 && overlapsAny(accepted, begin, end)) continue;
      fresh.push({ hit: { page, parts }, begin, end });
    }
    if (v === 0) accepted = fresh;
    else if (fresh.length > 0) accepted = accepted.concat(fresh).sort((a, b) => a.begin - b.begin);
  });
  return accepted.map((a) => a.hit);
}

/** Binäre Suche in nach Anfang sortierten, in sich überlappungsfreien Bereichen. */
function overlapsAny(sorted: readonly { begin: number; end: number }[], begin: number, end: number): boolean {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sorted[mid]?.end ?? 0) <= begin) lo = mid + 1;
    else hi = mid;
  }
  const candidate = sorted[lo];
  return candidate !== undefined && candidate.begin < end;
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

/**
 * Rechtecke eines Treffers, zusammengefasst je Zeile: Teile auf derselben Zeile (überlappende Höhe), die aneinander
 * grenzen oder nur eine kleine Lücke haben, werden ein Rechteck. So bleibt ein Wort aus vielen Textstücken (jeder
 * Buchstabe in eigener Schrift) ein einziger Rahmen.
 */
export function lineRects(
  items: readonly PdfTextItem[],
  parts: readonly HitPart[],
  measure: Measure | null = null,
): HitRect[] {
  const out: HitRect[] = [];
  for (const part of parts) {
    const item = items[part.item];
    if (!item) continue;
    const rect = hitRect(item, part, measure);
    const last = out[out.length - 1];
    if (last) {
      const overlap = Math.min(last.top + last.height, rect.top + rect.height) - Math.max(last.top, rect.top);
      const gap = rect.left - (last.left + last.width);
      const tall = Math.max(last.height, rect.height, 1);
      if (overlap > 0.5 * Math.min(last.height, rect.height) && gap <= 0.5 * tall && gap >= -tall) {
        const right = Math.max(last.left + last.width, rect.left + rect.width);
        const bottom = Math.max(last.top + last.height, rect.top + rect.height);
        last.left = Math.min(last.left, rect.left);
        last.top = Math.min(last.top, rect.top);
        last.width = right - last.left;
        last.height = bottom - last.top;
        continue;
      }
    }
    out.push(rect);
  }
  return out;
}
