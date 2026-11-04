'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { openPdf, type PdfDoc, type PdfTextItem } from '../lib/pdf.ts';
import { classifyPdfError, type PdfFailure } from '../lib/pdf-errors.ts';
import { useCoreHealth } from './CoreStatus.tsx';
import { findHits, hitRect, makeMeasurer, type SearchHit } from '../lib/pdf-search.ts';
import {
  isMaterialKind,
  pageImageUrl,
  pageThumbUrl,
  pdfUrl,
  useDeckDetail,
  useSheetDetail,
  type MaterialKind,
} from '../lib/material.ts';
import { moduleHref } from '../lib/nav.ts';
import { isMacPlatform } from '../lib/shortcuts.ts';
import { CoreHint } from './CoreHint.tsx';
import { EmptyState } from './Placeholder.tsx';

/** 100 % entspricht 4/3 CSS-Pixel pro PDF-Punkt (96 dpi gegenüber 72 pt) */
const PX_PER_PT = 4 / 3;
const MIN_SCALE = 0.2;
const MAX_SCALE = 6;
const ZOOM_STEP = 1.25;
const PAGE_MARGIN = 32;
const DEFAULT_PAGE = { w: 595, h: 842 };
const SEARCH_DEBOUNCE_MS = 150;
/** So viele Seitenköpfe liest pdf.js gleichzeitig vorab */
const SIZE_BATCH = 8;

type Zoom = { mode: 'fit' } | { mode: 'width' } | { mode: 'custom'; scale: number };

interface DocumentMeta {
  title: string;
  moduleId: string;
  state: 'neu' | 'verarbeitet' | 'fehler';
  pageCount: number | null;
  /** Folien-IDs je Seite (nur Foliensätze) */
  slideIds: (string | null)[];
  /** Seitengrößen in pt, falls der Core sie kennt (nur Foliensätze) */
  sizes: ({ w: number; h: number } | null)[];
}

function parsePage(value: string | null): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const iconButton =
  'grid h-8 min-w-8 place-items-center rounded-md px-2 text-sm hover:bg-surface disabled:opacity-40 aria-expanded:bg-accent-soft aria-pressed:bg-accent-soft';

/** Größe des Anzeigebereichs; ohne ResizeObserver (Tests) gilt ein fester Standard. */
function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  // Vor dem ersten Zeichnen messen, damit die Seite nicht erst im Standardmaß erscheint und dann springt
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) setSize({ w: width, h: height });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, size };
}

function Viewer({ kind, id, meta }: { kind: MaterialKind; id: string; meta: DocumentMeta }) {
  const params = useSearchParams();
  const [pdf, setPdf] = useState<PdfDoc | null>(null);
  const [pdfFailed, setPdfFailed] = useState(false);
  /** Das PDF selbst ist unlesbar (nicht bloß nicht geladen): Dann hilft kein zweiter Versuch */
  const [pdfKind, setPdfKind] = useState<PdfFailure>('load');
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState(() => parsePage(params.get('seite')));
  const [zoom, setZoom] = useState<Zoom>({ mode: 'fit' });
  const [measured, setMeasured] = useState<Record<number, { w: number; h: number }>>({});
  const [renderedPage, setRenderedPage] = useState<number | null>(null);
  const [pageInput, setPageInput] = useState<string | null>(null);

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [searching, setSearching] = useState(false);
  const [pageItems, setPageItems] = useState<{ page: number; items: PdfTextItem[] } | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textCache = useRef(new Map<number, PdfTextItem[]>());
  const measurer = useMemo(() => makeMeasurer(), []);
  const { ref: areaRef, size: area } = useElementSize<HTMLDivElement>();
  const ready = meta.state === 'verarbeitet';
  /** Ladefehler (nicht das PDF selbst): ein neuer Versuch kann helfen */
  const retryable = pdfFailed && pdfKind === 'load' && meta.state !== 'fehler';

  // pdf.js sofort anstoßen, parallel zu den Vorschaubildern aus dem Core
  useEffect(() => {
    let cancelled = false;
    let opened: PdfDoc | null = null;
    textCache.current = new Map();
    setPdf(null);
    setPdfFailed(false);
    setPdfKind('load');
    openPdf(pdfUrl(kind, id)).then(
      (doc) => {
        if (cancelled) doc.destroy();
        else {
          opened = doc;
          setPdf(doc);
        }
      },
      (failure: unknown) => {
        if (cancelled) return;
        setPdfKind(classifyPdfError(failure));
        setPdfFailed(true);
      },
    );
    return () => {
      cancelled = true;
      opened?.destroy();
    };
  }, [kind, id, attempt]);

  // Der Satz war noch in Arbeit, als das PDF nicht ladbar war: Sobald sich sein Zustand ändert, noch einmal versuchen
  useEffect(() => {
    if (retryable) setAttempt((n) => n + 1);
    // Nur der Wechsel des Einlese-Zustands zählt, nicht der Fehler selbst
  }, [meta.state]);

  // Core war weg und ist wieder da (Health wechselt auf ok): ebenfalls von selbst noch einmal versuchen. Solange der Fehler
  // steht, fragen wir den Status alle 5 s ab, sonst bemerkt man den Neustart erst nach bis zu 30 s.
  const health = useCoreHealth();
  const coreOk = health.isSuccess;
  const sawCoreDown = useRef(false);
  useEffect(() => {
    if (health.isError) sawCoreDown.current = true;
    else if (coreOk && sawCoreDown.current) {
      sawCoreDown.current = false;
      if (retryable) setAttempt((n) => n + 1);
    }
  }, [health.isError, coreOk, retryable]);
  const refetchHealth = health.refetch;
  useEffect(() => {
    if (!retryable) return;
    const timer = setInterval(() => void refetchHealth(), 5_000);
    return () => clearInterval(timer);
  }, [retryable, refetchHealth]);

  const pageCount = meta.pageCount ?? pdf?.numPages ?? 0;
  const current = pageCount > 0 ? clamp(page, 1, pageCount) : page;

  // Deep-Link: `seite` in der Adresse mitführen (ohne neuen Verlaufseintrag). Die zuletzt selbst geschriebenen
  // Werte merken wir uns: Die Adresse kommt über Next mit Verzögerung zurück und ist dann kein Sprung von außen.
  const written = useRef<string[]>([String(parsePage(params.get('seite')))]);
  const seiteParam = params.get('seite');
  useEffect(() => {
    const value = String(parsePage(seiteParam));
    if (written.current.includes(value)) return;
    // Von außen geändert (z. B. „Anzeigen“ auf ein schon offenes Dokument)
    written.current = [value];
    setPage(parsePage(seiteParam));
  }, [seiteParam]);

  useEffect(() => {
    written.current = [...written.current, String(current)].slice(-8);
    const url = new URL(window.location.href);
    if (current > 1) url.searchParams.set('seite', String(current));
    else url.searchParams.delete('seite');
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url);
  }, [current]);

  // Der Viewer nimmt den Fokus, damit Pfeiltasten und ⌘F sofort gelten
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  const goTo = useCallback(
    (target: number) => {
      // Solange die Seitenzahl unbekannt ist, gibt es nichts zu blättern
      if (pageCount <= 0) return;
      setPage(clamp(Math.round(target), 1, pageCount));
      setPageInput(null);
      areaRef.current?.scrollTo?.({ top: 0 });
    },
    [areaRef, pageCount],
  );

  // Seitengrößen: vom Core (Folien), von pdf.js oder aus dem Vorschaubild. Sobald pdf.js offen ist, lesen wir alle
  // Größen einmal vorab (schnell, nur die Seitenköpfe). So gibt es beim Blättern keinen Sprung und die Seitenleiste
  // kennt die Formate ihrer Platzhalter. Die Reihenfolge richtet sich nach der Seite, auf der man gerade ist: Jede
  // Runde nimmt die acht noch unbekannten Seiten, die ihr am nächsten liegen. Springt man früh weit weg und kennt
  // die Größe der neuen Seite noch nicht, wird sie sofort einzeln gelesen, statt auf die Runden zu warten.
  const knownSize = (n: number) => meta.sizes[n - 1] ?? measured[n] ?? null;
  const sizeState = useRef({ current, known: (n: number) => knownSize(n) !== null });
  sizeState.current = { current, known: (n) => knownSize(n) !== null };
  const sizeReads = useRef(new Set<number>());
  const livePdf = useRef<PdfDoc | null>(null);
  livePdf.current = pdf;

  const readSizes = useCallback(async (doc: PdfDoc, numbers: number[]) => {
    for (const n of numbers) sizeReads.current.add(n);
    const sizes = await Promise.all(
      numbers.map((n) =>
        doc.pageSize(n).then(
          (size) => [n, { w: size.width, h: size.height }] as const,
          // Größe nicht lesbar: mit dem Standardformat weiterzeichnen statt gar nichts zu zeigen
          () => [n, { w: DEFAULT_PAGE.w, h: DEFAULT_PAGE.h }] as const,
        ),
      ),
    );
    if (livePdf.current !== doc) return false;
    setMeasured((m) => {
      const next = { ...m };
      for (const [n, size] of sizes) next[n] ??= size;
      return next;
    });
    return true;
  }, []);

  useEffect(() => {
    if (!pdf) return;
    sizeReads.current = new Set();
    let cancelled = false;
    (async () => {
      while (!cancelled) {
        const here = sizeState.current;
        const batch = Array.from({ length: pdf.numPages }, (_, i) => i + 1)
          .filter((n) => !sizeReads.current.has(n) && !here.known(n))
          .sort((a, b) => Math.abs(a - here.current) - Math.abs(b - here.current))
          .slice(0, SIZE_BATCH);
        if (batch.length === 0 || !(await readSizes(pdf, batch))) return;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdf, readSizes]);

  const sizeKnown = knownSize(current) !== null;
  useEffect(() => {
    if (!pdf || sizeKnown || current < 1 || current > pdf.numPages || sizeReads.current.has(current)) return;
    void readSizes(pdf, [current]);
  }, [pdf, current, sizeKnown, readSizes]);

  // Erst zeichnen, wenn die Seitengröße bekannt ist (vom Core, von pdf.js oder aus dem Vorschaubild). Sonst wird
  // zuerst im Standardformat gezeichnet und gleich danach noch einmal: Die Seite blitzt auf und springt.
  // Unbekannte Seiten übernehmen das Format einer bekannten statt A4: Der Rahmen springt nicht
  const fallbackSize = meta.sizes.find(Boolean) ?? Object.values(measured)[0] ?? null;
  const sizeOf = (n: number) => knownSize(n) ?? fallbackSize ?? DEFAULT_PAGE;
  const base = sizeOf(current);
  const availW = Math.max(area.w - PAGE_MARGIN, 100);
  const availH = Math.max(area.h - PAGE_MARGIN, 100);
  const fitScale = Math.min(availW / base.w, availH / base.h);
  const scale = clamp(
    zoom.mode === 'fit' ? fitScale : zoom.mode === 'width' ? availW / base.w : zoom.scale,
    MIN_SCALE,
    MAX_SCALE,
  );
  const cssWidth = Math.round(base.w * scale);
  const cssHeight = Math.round(base.h * scale);

  const zoomBy = (factor: number) =>
    setZoom({ mode: 'custom', scale: clamp(scale * factor, MIN_SCALE, MAX_SCALE) });

  // Scharfe Seite von pdf.js über dem schnellen Vorschaubild
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!pdf || !canvas || !sizeKnown || current < 1 || (pageCount > 0 && current > pageCount)) return;
    const controller = new AbortController();
    // Das Zeichnen leert die Fläche: Bis die Seite fertig ist, zeigt das Vorschaubild des Core
    setRenderedPage(null);
    pdf.render(current, canvas, cssWidth, controller.signal).then(
      (done) => {
        if (done && !controller.signal.aborted) setRenderedPage(current);
      },
      () => {
        // Kein Abbruch, sondern ein echter Fehler: beim Vorschaubild bleiben
      },
    );
    return () => controller.abort();
  }, [pdf, current, cssWidth, pageCount, sizeKnown]);

  // ---------- Suche ----------

  const itemsOf = useCallback(
    async (number: number): Promise<PdfTextItem[]> => {
      const cached = textCache.current.get(number);
      if (cached) return cached;
      const items = (await pdf?.textItems(number)) ?? [];
      textCache.current.set(number, items);
      return items;
    },
    [pdf],
  );

  const currentRef = useRef(current);
  currentRef.current = current;

  useEffect(() => {
    if (!pdf || !searchOpen || query.trim() === '') {
      setHits([]);
      setActive(0);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      const all: SearchHit[] = [];
      try {
        for (let n = 1; n <= pdf.numPages; n += 1) {
          const items = await itemsOf(n);
          if (cancelled) return;
          all.push(...findHits(n, items, query));
        }
      } catch {
        // Text nicht lesbar: wie „kein Treffer“
      }
      if (cancelled) return;
      setHits(all);
      setSearching(false);
      // Der erste Treffer ab der aktuellen Seite
      const first = all.findIndex((h) => h.page >= currentRef.current);
      const index = all.length === 0 ? 0 : first === -1 ? 0 : first;
      setActive(index);
      const target = all[index];
      if (target) setPage(target.page);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pdf, searchOpen, query, itemsOf]);

  const pageHits = useMemo(() => hits.filter((h) => h.page === current), [hits, current]);
  useEffect(() => {
    if (pageHits.length === 0) {
      setPageItems(null);
      return;
    }
    let cancelled = false;
    itemsOf(current).then(
      (items) => {
        if (!cancelled) setPageItems({ page: current, items });
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [pageHits, current, itemsOf]);

  function stepHit(direction: 1 | -1) {
    if (hits.length === 0) return;
    const next = (active + direction + hits.length) % hits.length;
    setActive(next);
    const target = hits[next];
    if (target) goTo(target.page);
  }

  function openSearch() {
    setSearchOpen(true);
    requestAnimationFrame(() => {
      searchInput.current?.focus();
      searchInput.current?.select();
    });
  }

  function closeSearch() {
    setSearchOpen(false);
    setQuery('');
    rootRef.current?.focus({ preventScroll: true });
  }

  // ---------- Tastatur ----------

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    const mod = isMacPlatform() ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
    if (mod && (e.key === 'f' || e.key === 'F') && !e.altKey) {
      // Nur solange der Viewer den Fokus hat; sonst bleibt die Suche des Browsers
      e.preventDefault();
      openSearch();
      return;
    }
    if (e.key === 'Escape' && searchOpen) {
      e.preventDefault();
      closeSearch();
      return;
    }
    if (typing || e.altKey || e.ctrlKey || e.metaKey) return;
    switch (e.key) {
      case 'ArrowRight':
      case 'PageDown':
        e.preventDefault();
        goTo(current + 1);
        break;
      case 'ArrowLeft':
      case 'PageUp':
        e.preventDefault();
        goTo(current - 1);
        break;
      case 'Home':
        e.preventDefault();
        goTo(1);
        break;
      case 'End':
        e.preventDefault();
        goTo(pageCount || current);
        break;
      case '+':
      case '=':
        e.preventDefault();
        zoomBy(ZOOM_STEP);
        break;
      case '-':
        e.preventDefault();
        zoomBy(1 / ZOOM_STEP);
        break;
      case '0':
        e.preventDefault();
        setZoom({ mode: 'fit' });
        break;
      default:
    }
  }

  function commitPageInput() {
    const n = Number(pageInput);
    if (Number.isFinite(n) && pageInput !== null && pageInput.trim() !== '') goTo(n);
    else setPageInput(null);
  }

  function onPageSubmit(e: FormEvent) {
    e.preventDefault();
    commitPageInput();
  }

  // Aktive Seite in der Seitenleiste sichtbar halten
  useEffect(() => {
    document.getElementById(`thumb-${current}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [current]);

  const slideId = meta.slideIds[current - 1] ?? null;
  const pageHitsRects =
    pageItems && pageItems.page === current
      ? pageHits.flatMap((hit, i) => {
          const item = pageItems.items[hit.item];
          return item
            ? [{ key: `${hit.item}-${hit.start}-${i}`, hit, rect: hitRect(item, hit, measurer) }]
            : [];
        })
      : [];
  const activeHit = hits[active];
  const searchSummary =
    searching || (query.trim() !== '' && !pdf && !pdfFailed)
      ? 'Sucht …'
      : query.trim() === ''
        ? ''
        : hits.length === 0
          ? 'Kein Treffer'
          : `${active + 1} von ${hits.length}`;

  // pdf.js kann das Dokument nicht lesen und der Core kennt keine Seiten: nichts zu zeigen. „Beschädigt“ gilt nur,
  // wenn das Einlesen gescheitert ist oder pdf.js die Datei als unlesbar meldet; ein Ladefehler (Netz, Core, Satz
  // noch in Arbeit) ist behebbar: ruhiger Text, genau eine Aktion.
  if (pdfFailed && pageCount === 0) {
    const corrupt = !retryable;
    return (
      <div className="p-8">
        <h1 id="screen-title" className="text-xxl font-semibold">
          {meta.title}
        </h1>
        <div className="mt-6">
          {corrupt ? (
            <EmptyState
              action={
                <Link
                  href={moduleHref(meta.moduleId)}
                  className="text-sm font-medium text-accent hover:underline"
                >
                  Zurück zum Modul
                </Link>
              }
            >
              {pdfKind === 'password'
                ? 'Dieses PDF ist passwortgeschützt. Speichere es ohne Passwort und zieh es noch einmal herein.'
                : 'Dieses PDF lässt sich nicht anzeigen. Vielleicht ist die Datei beschädigt.'}
            </EmptyState>
          ) : (
            <EmptyState
              action={
                <button
                  type="button"
                  onClick={() => setAttempt((n) => n + 1)}
                  className="text-sm font-medium text-accent hover:underline"
                >
                  Erneut versuchen
                </button>
              }
            >
              Konnte nicht geladen werden.
            </EmptyState>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      aria-label="Dokumentanzeige"
      role="group"
      className="flex h-full flex-col outline-none"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-4 py-2">
        <Link
          href={moduleHref(meta.moduleId)}
          className="rounded-md px-2 py-1 text-sm text-text-muted hover:bg-surface"
        >
          ← Modul
        </Link>
        <h1 id="screen-title" className="min-w-0 flex-1 truncate text-lg font-semibold" title={meta.title}>
          {meta.title}
        </h1>
        <form onSubmit={onPageSubmit} className="flex items-center gap-1 text-sm">
          <button
            type="button"
            className={iconButton}
            onClick={() => goTo(current - 1)}
            disabled={pageCount === 0 || current <= 1}
            aria-label="Vorherige Seite"
          >
            ‹
          </button>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={pageCount || undefined}
            aria-label="Seite"
            value={pageInput ?? String(current)}
            onChange={(e) => setPageInput(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={() => setPageInput(null)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              commitPageInput();
            }}
            className="h-8 w-14 rounded-md border border-border-strong bg-bg px-2 text-center"
          />
          <span className="text-text-muted">/ {pageCount || '…'}</span>
          <button
            type="button"
            className={iconButton}
            onClick={() => goTo(current + 1)}
            disabled={pageCount === 0 || current >= pageCount}
            aria-label="Nächste Seite"
          >
            ›
          </button>
        </form>
        <div className="flex items-center gap-1 text-sm">
          <button
            type="button"
            className={iconButton}
            onClick={() => zoomBy(1 / ZOOM_STEP)}
            aria-label="Verkleinern"
          >
            −
          </button>
          <span className="w-12 text-center text-text-muted">
            <span className="sr-only">Zoom </span>
            {Math.round((scale / PX_PER_PT) * 100)} %
          </span>
          <button
            type="button"
            className={iconButton}
            onClick={() => zoomBy(ZOOM_STEP)}
            aria-label="Vergrößern"
          >
            +
          </button>
          <button
            type="button"
            className={iconButton}
            aria-pressed={zoom.mode === 'fit'}
            onClick={() => setZoom({ mode: 'fit' })}
          >
            Einpassen
          </button>
          <button
            type="button"
            className={iconButton}
            aria-pressed={zoom.mode === 'width'}
            onClick={() => setZoom({ mode: 'width' })}
          >
            Breite
          </button>
        </div>
        <button
          type="button"
          className={iconButton}
          aria-expanded={searchOpen}
          onClick={() => (searchOpen ? closeSearch() : openSearch())}
        >
          Suchen
        </button>
      </div>

      {searchOpen ? (
        <form
          role="search"
          aria-label="Im Dokument"
          onSubmit={(e) => {
            e.preventDefault();
            stepHit(1);
          }}
          className="flex items-center gap-2 border-b border-border px-4 py-2"
        >
          <input
            ref={searchInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.shiftKey) {
                e.preventDefault();
                stepHit(-1);
              }
            }}
            aria-label="Suchbegriff"
            placeholder="Im Dokument suchen"
            autoComplete="off"
            disabled={pdfFailed}
            className="h-8 w-64 rounded-md border border-border-strong bg-bg px-2 text-sm"
          />
          <span role="status" className="min-w-20 text-sm text-text-muted">
            {pdfFailed ? 'Suche gerade nicht möglich' : searchSummary}
          </span>
          <button
            type="button"
            className={iconButton}
            onClick={() => stepHit(-1)}
            disabled={hits.length === 0}
            aria-label="Vorheriger Treffer"
          >
            ↑
          </button>
          <button
            type="button"
            className={iconButton}
            onClick={() => stepHit(1)}
            disabled={hits.length === 0}
            aria-label="Nächster Treffer"
          >
            ↓
          </button>
          <button type="button" className={iconButton} onClick={closeSearch} aria-label="Suche schließen">
            ×
          </button>
        </form>
      ) : null}

      {meta.state === 'fehler' ? (
        <p className="border-b border-border px-4 py-2 text-sm text-text-muted">
          Dieses PDF konnte nicht vollständig verarbeitet werden. Lesen kannst du es trotzdem.
        </p>
      ) : null}
      {pdfFailed ? (
        <p role="status" className="border-b border-border px-4 py-2 text-sm text-text-muted">
          Das PDF lässt sich gerade nicht scharf anzeigen. Die Vorschaubilder bleiben nutzbar.
          {retryable ? (
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="ml-3 font-medium text-accent hover:underline"
            >
              Erneut versuchen
            </button>
          ) : null}
        </p>
      ) : null}

      <div className="relative flex min-h-0 flex-1">
        {meta.state === 'neu' ? (
          // Schwebt über der Seite statt eine Zeile einzunehmen: Beim Wechsel auf „verarbeitet“ verschiebt sich nichts
          <p
            role="status"
            className="pointer-events-none absolute bottom-3 right-6 z-10 rounded-full border border-border bg-surface-raised px-3 py-1 text-xs text-text-muted shadow-sm"
          >
            Wird verarbeitet … Die Vorschaubilder erscheinen gleich.
          </p>
        ) : null}
        <nav aria-label="Seiten" className="w-36 shrink-0 overflow-y-auto border-r border-border p-2">
          <ol className="flex flex-col gap-2">
            {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
              <li key={n}>
                <button
                  type="button"
                  id={`thumb-${n}`}
                  aria-current={n === current ? 'page' : undefined}
                  onClick={() => goTo(n)}
                  className={`block w-full rounded-md border p-1 text-center text-xs sg-transition ${
                    n === current ? 'border-accent bg-accent-soft' : 'border-border hover:bg-surface'
                  }`}
                >
                  {ready ? (
                    <img
                      src={pageThumbUrl(kind, id, meta.slideIds[n - 1] ?? null, n)}
                      alt={`Seite ${n}`}
                      loading="lazy"
                      // Gleiches Format wie der Platzhalter: Die Leiste springt nicht, wenn die Bilder nachladen
                      style={{ aspectRatio: `${sizeOf(n).w} / ${sizeOf(n).h}` }}
                      className="block w-full rounded-sm bg-white"
                    />
                  ) : (
                    // Platzhalter, bis die Vorschaubilder da sind (Seitennummer steht darunter)
                    <span
                      aria-hidden="true"
                      data-testid="thumb-placeholder"
                      className="block w-full rounded-sm bg-white/70 ring-1 ring-border"
                      style={{
                        aspectRatio: `${sizeOf(n).w} / ${sizeOf(n).h}`,
                      }}
                    />
                  )}
                  {ready ? null : <span className="sr-only">Seite {n}</span>}
                  <span aria-hidden="true" className="mt-1 block text-text-muted">
                    {n}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <div
          ref={areaRef}
          role="region"
          aria-label={`Seite ${current}${pageCount ? ` von ${pageCount}` : ''}`}
          className="min-w-0 flex-1 overflow-auto bg-surface"
        >
          <div className="grid min-h-full min-w-full place-items-center p-4">
            <div
              className="relative bg-white shadow-md"
              // Solange noch gar keine Seitengröße bekannt ist, wäre das nur ein Kasten im Standardmaß, der gleich springt.
              // Danach bleibt der Rahmen immer sichtbar.
              style={{
                width: cssWidth,
                height: cssHeight,
                ...(!sizeKnown && !fallbackSize && !ready && !pdfFailed ? { opacity: 0 } : {}),
              }}
              data-testid="page-frame"
            >
              {ready ? (
                <img
                  key={current}
                  src={pageImageUrl(kind, id, slideId, current)}
                  alt={`Seite ${current}`}
                  draggable={false}
                  onLoad={(e) => {
                    const { naturalWidth, naturalHeight } = e.currentTarget;
                    if (naturalWidth > 0 && !meta.sizes[current - 1]) {
                      // Die PNGs sind 2× gerendert
                      setMeasured((m) =>
                        m[current] ? m : { ...m, [current]: { w: naturalWidth / 2, h: naturalHeight / 2 } },
                      );
                    }
                  }}
                  className="absolute inset-0 size-full select-none"
                />
              ) : null}
              <canvas
                ref={canvasRef}
                aria-hidden="true"
                className="absolute inset-0 size-full"
                style={{ visibility: renderedPage === current ? 'visible' : 'hidden' }}
              />
              {pageHitsRects.map(({ key, hit, rect }) => {
                const isActive = activeHit === hit;
                return (
                  <span
                    key={key}
                    aria-hidden="true"
                    data-hit={isActive ? 'active' : 'other'}
                    className="pointer-events-none absolute rounded-sm"
                    style={{
                      left: rect.left * scale,
                      top: rect.top * scale,
                      width: rect.width * scale,
                      height: rect.height * scale,
                      // Eigene Treffer-Tokens (hell und dunkel). Die Seite ist immer weiß, `multiply` lässt den Text
                      // darunter lesbar, wie ein Textmarker.
                      backgroundColor: isActive ? 'var(--sg-color-hit-active)' : 'var(--sg-color-hit)',
                      mixBlendMode: 'multiply',
                      outline: isActive ? '2px solid var(--sg-color-hit-outline)' : undefined,
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DocumentScreen() {
  const params = useSearchParams();
  const rawKind = params.get('typ');
  const id = params.get('id');
  const kind = isMaterialKind(rawKind) ? rawKind : null;

  const deck = useDeckDetail(id ?? '', { enabled: kind === 'folien' && Boolean(id) });
  const sheet = useSheetDetail(id ?? '', { enabled: kind === 'blatt' && Boolean(id) });
  const query = kind === 'folien' ? deck : sheet;

  const meta = useMemo<DocumentMeta | null>(() => {
    if (kind === 'folien' && deck.data) {
      const { deck: d, slides } = deck.data;
      const sorted = [...slides].sort((a, b) => a.index - b.index);
      return {
        title: d.title,
        moduleId: d.module_id,
        state: d.ingest_state,
        pageCount: d.ingest_state === 'verarbeitet' ? d.page_count : null,
        slideIds: sorted.map((s) => s.id),
        sizes: sorted.map((s) => ({ w: s.width_pt, h: s.height_pt })),
      };
    }
    if (kind === 'blatt' && sheet.data) {
      const s = sheet.data;
      return {
        title: s.title,
        moduleId: s.module_id,
        state: s.ingest_state,
        pageCount: s.ingest_state === 'verarbeitet' ? s.page_count : null,
        slideIds: [],
        sizes: [],
      };
    }
    return null;
  }, [kind, deck.data, sheet.data]);

  if (!kind || !id) {
    return (
      <div className="p-8">
        <h1 id="screen-title" className="text-xxl font-semibold">
          Dokument
        </h1>
        <div className="mt-6">
          <EmptyState
            action={
              <Link href="/" className="text-sm font-medium text-accent hover:underline">
                Zur Startseite
              </Link>
            }
          >
            Dieses Dokument gibt es nicht. Öffne es aus einem Modul.
          </EmptyState>
        </div>
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="p-8">
        <h1 id="screen-title" className="text-xxl font-semibold">
          Dokument
        </h1>
        <div className="mt-6">
          <CoreHint error={query.error} />
        </div>
      </div>
    );
  }
  if (!meta) {
    return (
      <div className="p-8">
        <h1 id="screen-title" className="text-xxl font-semibold">
          Dokument
        </h1>
        <p className="mt-4 text-sm text-text-muted">Lädt …</p>
      </div>
    );
  }
  return <Viewer key={`${kind}:${id}`} kind={kind} id={id} meta={meta} />;
}

/** PDF-Anzeige (F-ORG-04) – Route mit Query-Parametern `?typ=folien|blatt&id=…&seite=…` (VERTRAEGE §5). */
export function DocumentView() {
  return (
    <section aria-labelledby="screen-title" className="h-full">
      <Suspense fallback={null}>
        <DocumentScreen />
      </Suspense>
    </section>
  );
}
