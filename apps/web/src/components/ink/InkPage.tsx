'use client';

// Reiner Renderer einer Notizseite: Striche + Elemente rein, Canvas raus. Kennt weder REST noch Sync.
//
// Drei übereinanderliegende Canvas-Ebenen, damit nur neu gezeichnet wird, was sich ändert:
//   unten  – Papier, Vorlage, Fotos und Textmarker (Textmarker liegt unter der Schrift)
//   Tinte  – alle Striche der Ebene `ink`; ein neuer Strich wird nur aufgesetzt
//   oben   – Elemente über der Tinte (Formen, Text, Klebeband, Stempel)
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { PageElement, Stroke } from '@sg/shared';
import {
  DEFAULT_PAGE,
  clearLayer,
  drawStrokes,
  paintTop,
  paintUnder,
  redrawRegion,
  splitElements,
  strokeBounds,
  unionRect,
  type Rect,
  type PageGeometry,
} from './render.ts';
import { decodeStrokeCached, type DecodedStroke } from './stroke.ts';

export interface InkPageProps {
  strokes: readonly Stroke[];
  elements?: readonly PageElement[];
  /** Seitenmaße und Vorlage; ohne Angabe A4 hoch (595 × 842 pt) */
  page?: Partial<PageGeometry>;
  /**
   * Maßstab relativ zur Breite des Containers: 1 = auf die Breite eingepasst, 2 = doppelt (Container scrollt).
   * Die Seite wird auf höchstens 4096 CSS-Pixel Höhe begrenzt (Speicher), die Auflösung fällt nie unter 1 Pixel
   * je CSS-Pixel. Gilt nicht zusammen mit `width`.
   */
  zoom?: number;
  /** Feste Breite in CSS-Pixeln statt Einpassen */
  width?: number;
  /**
   * Dunkelmodus: Das Papier bleibt hell, damit Tintenfarben so aussehen wie auf dem iPad. `auto` (Standard) dimmt
   * das Blatt im dunklen Theme per CSS-Filter (kein Neuzeichnen), `off` lässt es unverändert.
   */
  dim?: 'auto' | 'off';
  className?: string;
  'aria-label'?: string;
}

const NO_ELEMENTS: readonly PageElement[] = [];

function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  return a === b || (a.length === b.length && a.every((x, i) => x === b[i]));
}

/** Ist `prev` ein Anfangsstück von `next` (gleiche Objekte)? Dann muss nur der Rest gezeichnet werden. */
function isPrefix<T>(prev: readonly T[], next: readonly T[]): boolean {
  return prev.length <= next.length && prev.every((x, i) => x === next[i]);
}

/** Höchstens so viele Striche dürfen sich ändern, damit nur ein Ausschnitt neu gezeichnet wird. */
const MAX_PARTIAL_CHANGES = 12;

/**
 * Ausschnitt, der sich zwischen zwei Strichlisten ändert, oder `null`, wenn zu viel anders ist (dann komplett neu).
 * Ein Strich zählt als geändert, wenn sein Objekt nur in einer der Listen vorkommt.
 */
function changedRegion(prev: readonly DecodedStroke[], next: readonly DecodedStroke[]): Rect | null {
  const before = new Set(prev);
  const after = new Set(next);
  let region: Rect | null = null;
  let changes = 0;
  for (const d of prev) {
    if (after.has(d)) continue;
    if (++changes > MAX_PARTIAL_CHANGES) return null;
    region = unionRect(region, strokeBounds(d));
  }
  for (const d of next) {
    if (before.has(d)) continue;
    if (++changes > MAX_PARTIAL_CHANGES) return null;
    region = unionRect(region, strokeBounds(d));
  }
  return region;
}

/** Obergrenze für die Canvas-Seitenlänge in Pixeln (Speicher). */
const MAX_CANVAS_SIDE = 4096;

/**
 * Helligkeit des Blatts im dunklen Theme (Hörsaal). Vorläufiger Wert: Der Owner beurteilt später, ob das Blatt
 * dunkler oder heller sein soll. Nur ein CSS-Filter, die Tintenfarben werden nicht verändert.
 */
export const DARK_PAGE_BRIGHTNESS = 0.8;
const DIM_FILTER = `brightness(${DARK_PAGE_BRIGHTNESS})`;

/** Was auf einer Ebene schon liegt. `key` fasst Größe, Maßstab und Seitenart zusammen. */
interface UnderState {
  key: string;
  images: readonly PageElement[];
  highlights: readonly DecodedStroke[];
}
interface InkState {
  key: string;
  strokes: readonly DecodedStroke[];
}
interface TopState {
  key: string;
  above: readonly PageElement[];
}

/** Ist gerade das dunkle Theme aktiv? (`data-theme` am Wurzelelement, sonst Systemeinstellung) */
function useDarkTheme(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const mq =
      typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    const read = () => {
      const t = document.documentElement.getAttribute('data-theme');
      setDark(t === 'dark' || (t !== 'light' && !!mq?.matches));
    };
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    mq?.addEventListener?.('change', read);
    return () => {
      mo.disconnect();
      mq?.removeEventListener?.('change', read);
    };
  }, []);
  return dark;
}

const layerStyle = (w: number, h: number, top: boolean): CSSProperties => ({
  width: w,
  height: h,
  display: 'block',
  maxWidth: 'none',
  ...(top ? { position: 'absolute', left: 0, top: 0, pointerEvents: 'none' } : {}),
});

export function InkPage({
  strokes,
  elements = NO_ELEMENTS,
  page,
  zoom = 1,
  width,
  dim = 'auto',
  className,
  'aria-label': ariaLabel = 'Notizseite',
}: InkPageProps) {
  const widthPt = page?.width_pt ?? DEFAULT_PAGE.width_pt;
  const heightPt = page?.height_pt ?? DEFAULT_PAGE.height_pt;
  const template = page?.template ?? DEFAULT_PAGE.template;
  const geometry = useMemo<PageGeometry>(
    () => ({ width_pt: widthPt, height_pt: heightPt, template }),
    [widthPt, heightPt, template],
  );
  const dark = useDarkTheme();
  const wrapRef = useRef<HTMLDivElement>(null);
  const underRef = useRef<HTMLCanvasElement>(null);
  const inkRef = useRef<HTMLCanvasElement>(null);
  const topRef = useRef<HTMLCanvasElement>(null);
  const underState = useRef<UnderState | null>(null);
  const inkState = useRef<InkState | null>(null);
  const topState = useRef<TopState | null>(null);
  // `null` = Containerbreite noch nicht gemessen (dann wird nicht gezeichnet, um kein falsch großes Blatt zu malen)
  const [fitWidth, setFitWidth] = useState<number | null>(null);
  const [dpr, setDpr] = useState(() => (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1));

  // Breite des Containers beobachten
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el || width !== undefined) return;
    const measure = () => {
      const w = el.clientWidth;
      // Unsichtbar oder ohne Layout (Breite 0): Seitenbreite annehmen, bis eine echte Breite da ist
      setFitWidth((prev) => (w > 0 ? w : (prev ?? widthPt)));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, widthPt]);

  // devicePixelRatio kann sich ändern (Fenster auf anderen Bildschirm ziehen, Browser-Zoom). Die Abfrage gilt nur für
  // den aktuellen Wert, darum wird sie bei jeder Änderung neu angelegt.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(`(resolution: ${dpr}dppx)`);
    const read = () => setDpr(window.devicePixelRatio || 1);
    mq.addEventListener?.('change', read);
    return () => mq.removeEventListener?.('change', read);
  }, [dpr]);

  const waiting = width === undefined && fitWidth === null;
  const wanted = Math.max(1, width ?? (fitWidth ?? widthPt) * zoom);
  // Höchstens MAX_CANVAS_SIDE Pixel auf der LÄNGEREN Seite (Hoch- wie Querformat); darunter bleibt es bei mindestens
  // 1 Pixel je CSS-Pixel
  const cssWidth = Math.min(wanted, (MAX_CANVAS_SIDE * widthPt) / Math.max(widthPt, heightPt));
  const cssHeight = (cssWidth * heightPt) / widthPt;
  const k = cssWidth / widthPt;
  const pixelRatio = Math.max(1, Math.min(dpr, MAX_CANVAS_SIDE / Math.max(cssWidth, cssHeight)));
  const pw = Math.round(cssWidth * pixelRatio);
  const ph = Math.round(cssHeight * pixelRatio);
  const sizeKey = `${pw}x${ph}@${k.toFixed(5)}:${geometry.width_pt}x${geometry.height_pt}:${geometry.template}`;

  // Striche dekodieren (je Strich-Objekt nur einmal) und auf die Ebenen verteilen
  const { highlights, ink } = useMemo(() => {
    const hl: DecodedStroke[] = [];
    const inkList: DecodedStroke[] = [];
    const seen = new Set<string>();
    for (const s of strokes) {
      const d = decodeStrokeCached(s);
      if (!d || seen.has(d.id)) continue;
      seen.add(d.id);
      (d.layer === 'highlight' ? hl : inkList).push(d);
    }
    return { highlights: hl, ink: inkList };
  }, [strokes]);
  const { below, above } = useMemo(() => splitElements(elements), [elements]);

  /** Ebene vorbereiten: Größe setzen (löscht den Inhalt), Kontext und Maßstab liefern. */
  const prepare = (canvas: HTMLCanvasElement | null): CanvasRenderingContext2D | null => {
    if (!canvas || waiting) return null;
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return null; // z. B. jsdom ohne Canvas
    ctx.setTransform(pixelRatio * k, 0, 0, pixelRatio * k, 0, 0);
    return ctx;
  };

  // Untere Ebene: nur bei geänderten Textmarkern, Fotos, Größe oder Vorlage
  useLayoutEffect(() => {
    const prev = underState.current;
    if (
      prev &&
      prev.key === sizeKey &&
      sameItems(prev.images, below) &&
      sameItems(prev.highlights, highlights)
    )
      return;
    const ctx = prepare(underRef.current);
    if (!ctx) return;
    paintUnder(ctx, geometry, below, highlights);
    underState.current = { key: sizeKey, images: below, highlights };
    if (underRef.current) underRef.current.dataset.paint = 'full';
  }, [sizeKey, below, highlights, geometry, waiting]);

  // Tinte: kommt nur Neues dazu, wird nur das aufgesetzt, sonst die Ebene neu gezeichnet
  useLayoutEffect(() => {
    const prev = inkState.current;
    if (prev && prev.key === sizeKey && sameItems(prev.strokes, ink)) return;
    const canvas = inkRef.current;
    const sizeChanged = !!canvas && (canvas.width !== pw || canvas.height !== ph);
    const ctx = prepare(canvas);
    if (!ctx || !canvas) return;
    const append = prev !== null && prev.key === sizeKey && !sizeChanged && isPrefix(prev.strokes, ink);
    // Wenige geänderte, entfernte oder neue Striche mitten im Bestand (Lasso, Radierer): nur deren Ausschnitt neu
    const region =
      !append && prev !== null && prev.key === sizeKey && !sizeChanged
        ? changedRegion(prev.strokes, ink)
        : null;
    if (append) {
      drawStrokes(ctx, ink.slice(prev.strokes.length));
    } else if (region) {
      redrawRegion(ctx, ink, region, pixelRatio * k, { width: pw, height: ph });
    } else {
      clearLayer(ctx, geometry);
      drawStrokes(ctx, ink);
    }
    inkState.current = { key: sizeKey, strokes: ink };
    canvas.dataset.paint = append ? 'incremental' : region ? 'partial' : 'full';
  }, [sizeKey, ink, geometry, waiting]);

  // Obere Ebene: nur bei geänderten Elementen
  useLayoutEffect(() => {
    const prev = topState.current;
    if (prev && prev.key === sizeKey && sameItems(prev.above, above)) return;
    const ctx = prepare(topRef.current);
    if (!ctx) return;
    clearLayer(ctx, geometry);
    paintTop(ctx, above);
    topState.current = { key: sizeKey, above };
    if (topRef.current) topRef.current.dataset.paint = 'full';
  }, [sizeKey, above, geometry, waiting]);

  return (
    <div
      ref={wrapRef}
      className={`sg-ink-page ${className ?? ''}`}
      style={{ width: width === undefined ? '100%' : undefined, overflow: zoom > 1 ? 'auto' : undefined }}
    >
      <div
        style={{
          position: 'relative',
          width: cssWidth,
          height: cssHeight,
          borderRadius: 4,
          overflow: 'hidden',
          boxShadow: '0 0 0 1px rgba(128,128,138,0.35)',
          filter: dark && dim === 'auto' ? DIM_FILTER : undefined,
        }}
      >
        <canvas
          ref={underRef}
          role="img"
          aria-label={ariaLabel}
          data-stroke-count={strokes.length}
          data-layer="under"
          style={layerStyle(cssWidth, cssHeight, false)}
        />
        <canvas
          ref={inkRef}
          aria-hidden="true"
          data-layer="ink"
          style={layerStyle(cssWidth, cssHeight, true)}
        />
        <canvas
          ref={topRef}
          aria-hidden="true"
          data-layer="top"
          style={layerStyle(cssWidth, cssHeight, true)}
        />
      </div>
    </div>
  );
}
