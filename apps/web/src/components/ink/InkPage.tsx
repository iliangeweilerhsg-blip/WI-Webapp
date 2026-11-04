'use client';

// Reiner Renderer einer Notizseite: Striche + Elemente rein, Canvas raus. Kennt weder REST noch Sync.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PageElement, Stroke } from '@sg/shared';
import { DEFAULT_PAGE, drawStrokes, paintScene, splitElements, type PageGeometry } from './render.ts';
import { decodeStrokeCached, type DecodedStroke } from './stroke.ts';

export interface InkPageProps {
  strokes: readonly Stroke[];
  elements?: readonly PageElement[];
  /** Seitenmaße und Vorlage; ohne Angabe A4 hoch (595 × 842 pt) */
  page?: Partial<PageGeometry>;
  /**
   * Maßstab relativ zur Breite des Containers: 1 = auf die Breite eingepasst, 2 = doppelt (Container scrollt).
   * Gilt nicht zusammen mit `width`.
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

/** Obergrenze für die Canvas-Seitenlänge in Geräte-Pixeln (Speicher). */
const MAX_CANVAS_SIDE = 4096;

/** Im dunklen Theme wird das helle Blatt leicht gedimmt (Hörsaal), Farben bleiben unverändert. */
const DIM_FILTER = 'brightness(0.86)';

/** Merkt sich, was schon auf dem Canvas liegt, damit nur Neues gezeichnet wird. */
interface Painted {
  key: string;
  strokes: ReadonlyMap<string, DecodedStroke>;
  elements: readonly PageElement[];
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const painted = useRef<Painted | null>(null);
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

  // devicePixelRatio kann sich ändern (Fenster auf anderen Bildschirm ziehen, Browser-Zoom)
  useEffect(() => {
    const read = () => setDpr(window.devicePixelRatio || 1);
    read();
    const mq =
      typeof window.matchMedia === 'function'
        ? window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
        : null;
    mq?.addEventListener?.('change', read);
    return () => mq?.removeEventListener?.('change', read);
  }, []);

  const waiting = width === undefined && fitWidth === null;
  const cssWidth = Math.max(1, width ?? (fitWidth ?? widthPt) * zoom);
  const cssHeight = (cssWidth * geometry.height_pt) / geometry.width_pt;
  const k = cssWidth / geometry.width_pt;
  const pixelRatio = Math.min(dpr, MAX_CANVAS_SIDE / Math.max(cssWidth, cssHeight));

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || waiting) return;
    const pw = Math.round(cssWidth * pixelRatio);
    const ph = Math.round(cssHeight * pixelRatio);
    const key = `${pw}x${ph}@${k.toFixed(5)}:${geometry.width_pt}x${geometry.height_pt}:${geometry.template}`;
    const prev = painted.current;
    const resized = canvas.width !== pw || canvas.height !== ph;
    if (resized) {
      canvas.width = pw;
      canvas.height = ph;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return; // z. B. jsdom ohne Canvas
    const scale = pixelRatio * k;

    const decoded = new Map<string, DecodedStroke>();
    for (const s of strokes) {
      const d = decodeStrokeCached(s);
      if (d) decoded.set(d.id, d);
    }

    // Nur Neues zeichnen: gleiche Größe/Seite, alle alten Striche unverändert vorhanden, neue nur auf der Tintenebene,
    // und keine Elemente, die über der Tinte liegen müssten.
    const sameElements = prev !== null && sameItems(prev.elements, elements);
    let incremental: DecodedStroke[] | null = null;
    if (prev && !resized && prev.key === key && sameElements && splitElements(elements).above.length === 0) {
      const fresh: DecodedStroke[] = [];
      let ok = prev.strokes.size <= decoded.size;
      if (ok) {
        for (const [id, old] of prev.strokes) if (decoded.get(id) !== old) ok = false;
      }
      if (ok) {
        for (const [id, d] of decoded) if (!prev.strokes.has(id)) fresh.push(d);
        if (fresh.every((d) => d.layer !== 'highlight')) incremental = fresh;
      }
    }

    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    if (incremental) {
      drawStrokes(ctx, incremental);
    } else {
      paintScene(ctx, { page: geometry, strokes: [...decoded.values()], elements });
    }
    painted.current = { key, strokes: decoded, elements };
    canvas.dataset.paint = incremental ? 'incremental' : 'full';
  }, [strokes, elements, geometry, cssWidth, cssHeight, k, pixelRatio, waiting]);

  return (
    <div
      ref={wrapRef}
      className={`sg-ink-page ${className ?? ''}`}
      style={{ width: width === undefined ? '100%' : undefined, overflow: zoom > 1 ? 'auto' : undefined }}
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={ariaLabel}
        data-stroke-count={strokes.length}
        data-dim={dim}
        style={{
          width: cssWidth,
          height: cssHeight,
          display: 'block',
          maxWidth: 'none',
          borderRadius: 4,
          filter: dark && dim === 'auto' ? DIM_FILTER : undefined,
          boxShadow: '0 0 0 1px rgba(128,128,138,0.35)',
        }}
      />
    </div>
  );
}
