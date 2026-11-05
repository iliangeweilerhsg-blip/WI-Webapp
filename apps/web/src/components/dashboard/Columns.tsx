'use client';

// Die drei Spalten des Live-Dashboards (07 §3.3): Folie | Übung | Notizen. Ab `lg` nebeneinander mit ziehbaren
// Trennlinien (F-DSH-01), darunter als Reiter, jeweils eine Spalte. Keine Animationen (07 §3.3).
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { dragWidths, MIN_FOLIE_WIDTH, MIN_WIDTH, type HandleIndex, type Widths } from './layout.ts';

export type ColumnId = 'folie' | 'uebung' | 'notizen';
const COLUMNS: readonly { id: ColumnId; label: string }[] = [
  { id: 'folie', label: 'Folie' },
  { id: 'uebung', label: 'Übung' },
  { id: 'notizen', label: 'Notizen' },
];

/** Breite der Trennlinie in px (Griff gut greifbar, die sichtbare Linie ist 1 px) */
const SPLITTER_PX = 12;
const KEY_STEP = 2;
const KEY_STEP_BIG = 10;
/** Ruhezeit nach der letzten Taste bis zum Speichern */
const KEY_COMMIT_MS = 400;

/** Ab `lg` (Tailwind, 1024 px) passen drei Spalten nebeneinander */
const WIDE_QUERY = '(min-width: 1024px)';

export function useIsWide(): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(WIDE_QUERY);
    const update = (e: { matches: boolean }) => setWide(e.matches);
    update(mq);
    mq.addEventListener?.('change', update);
    return () => mq.removeEventListener?.('change', update);
  }, []);
  return wide;
}

export interface ColumnsProps {
  /** Nebeneinander (ab `lg`) oder als Reiter */
  wide: boolean;
  /** `fokus`: nur die Folie, keine Trennlinien */
  focus: boolean;
  widths: Widths;
  onPreview: (widths: Widths) => void;
  onCommit: (widths: Widths) => void;
  panels: Record<ColumnId, ReactNode>;
}

export function Columns({ wide, focus, widths, onPreview, onCommit, panels }: ColumnsProps) {
  return wide ? (
    <SideBySide focus={focus} widths={widths} onPreview={onPreview} onCommit={onCommit} panels={panels} />
  ) : (
    <Tabbed panels={panels} />
  );
}

function Panel({ id, label, children }: { id: ColumnId; label: string; children: ReactNode }) {
  return (
    <div
      role="group"
      aria-label={label}
      data-column={id}
      className="min-h-0 min-w-0 overflow-hidden rounded-lg border border-border bg-surface"
    >
      {children}
    </div>
  );
}

function SideBySide({ focus, widths, onPreview, onCommit, panels }: Omit<ColumnsProps, 'wide'>) {
  const gridRef = useRef<HTMLDivElement>(null);
  const first = COLUMNS[0]!;
  if (focus) {
    return (
      <div className="grid h-full min-h-0 grid-cols-1">
        <Panel id={first.id} label={first.label}>
          {panels[first.id]}
        </Panel>
      </div>
    );
  }
  const [a, b, c] = widths;
  return (
    <div
      ref={gridRef}
      data-testid="dashboard-grid"
      className="grid h-full min-h-0"
      style={{
        gridTemplateColumns: `minmax(0, ${a}fr) ${SPLITTER_PX}px minmax(0, ${b}fr) ${SPLITTER_PX}px minmax(0, ${c}fr)`,
      }}
    >
      <Panel id="folie" label="Folie">
        {panels.folie}
      </Panel>
      <Splitter index={0} grid={gridRef} widths={widths} onPreview={onPreview} onCommit={onCommit} />
      <Panel id="uebung" label="Übung">
        {panels.uebung}
      </Panel>
      <Splitter index={1} grid={gridRef} widths={widths} onPreview={onPreview} onCommit={onCommit} />
      <Panel id="notizen" label="Notizen">
        {panels.notizen}
      </Panel>
    </div>
  );
}

interface SplitterProps {
  index: HandleIndex;
  grid: React.RefObject<HTMLDivElement | null>;
  widths: Widths;
  onPreview: (widths: Widths) => void;
  onCommit: (widths: Widths) => void;
}

const SPLITTER_LABEL: Record<HandleIndex, string> = {
  0: 'Breite von Folie und Übung',
  1: 'Breite von Übung und Notizen',
};

/** Ziehbare Trennlinie: Maus/Stift/Finger (Pointer Events) und Pfeiltasten (±2 %, mit Umschalt ±10 %) */
function Splitter({ index, grid, widths, onPreview, onCommit }: SplitterProps) {
  const drag = useRef<{ x: number; start: Widths; latest: Widths; pct: number } | null>(null);
  const widthsRef = useRef(widths);
  widthsRef.current = widths;
  // Wert für Hilfstechnik: Breite der linken Spalte der Trennlinie in %
  const now = index === 0 ? widths[0] : widths[1];
  const max = index === 0 ? widths[0] + widths[1] - MIN_WIDTH : widths[1] + widths[2] - MIN_WIDTH;

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const box = grid.current?.getBoundingClientRect();
    if (!box) return;
    const usable = box.width - 2 * SPLITTER_PX;
    if (usable <= 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = {
      x: e.clientX,
      start: [...widthsRef.current],
      latest: [...widthsRef.current],
      pct: usable / 100,
    };
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    d.latest = dragWidths(d.start, index, (e.clientX - d.x) / d.pct);
    onPreview(d.latest);
  }
  function end(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (d.latest.some((n, i) => n !== d.start[i])) onCommit(d.latest);
  }

  // Pfeiltasten, Home und End: Anzeige sofort, Speichern erst nach einer kurzen Ruhe (mehrere Tasten = ein PATCH)
  const timer = useRef<number | null>(null);
  const pending = useRef(false);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const flush = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    if (!pending.current) return;
    pending.current = false;
    onCommitRef.current(widthsRef.current);
  };
  // Beim Entfernen (z. B. Layoutwechsel) noch nicht gespeicherte Breiten sichern
  useEffect(() => () => flush(), []);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    let delta: number;
    if (e.key === 'ArrowLeft') delta = -(e.shiftKey ? KEY_STEP_BIG : KEY_STEP);
    else if (e.key === 'ArrowRight') delta = e.shiftKey ? KEY_STEP_BIG : KEY_STEP;
    else if (e.key === 'Home') delta = -1000;
    else if (e.key === 'End') delta = 1000;
    else return;
    e.preventDefault();
    const next = dragWidths(widthsRef.current, index, delta);
    onPreview(next);
    widthsRef.current = next;
    pending.current = true;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, KEY_COMMIT_MS);
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={SPLITTER_LABEL[index]}
      aria-valuenow={Math.round(now)}
      aria-valuetext={`${index === 0 ? 'Folie' : 'Übung'} ${Math.round(now)} %`}
      aria-valuemin={index === 0 ? MIN_FOLIE_WIDTH : MIN_WIDTH}
      aria-valuemax={Math.round(max)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKeyDown}
      className="group flex cursor-col-resize touch-none items-stretch justify-center outline-offset-[-2px]"
    >
      <span
        aria-hidden="true"
        className="w-px bg-border group-hover:bg-border-strong group-focus-visible:bg-accent"
      />
    </div>
  );
}

/** Schmal: Reiter Folie | Übung | Notizen, nur die gewählte Spalte ist eingehängt (die Notizen laden erst dann) */
function Tabbed({ panels }: { panels: Record<ColumnId, ReactNode> }) {
  const [active, setActive] = useState<ColumnId>('folie');

  function onKeyDown(e: KeyboardEvent, i: number) {
    let target: number;
    if (e.key === 'ArrowRight') target = (i + 1) % COLUMNS.length;
    else if (e.key === 'ArrowLeft') target = (i - 1 + COLUMNS.length) % COLUMNS.length;
    else if (e.key === 'Home') target = 0;
    else if (e.key === 'End') target = COLUMNS.length - 1;
    else return;
    e.preventDefault();
    const next = COLUMNS[target]!;
    setActive(next.id);
    document.getElementById(`dash-tab-${next.id}`)?.focus();
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div role="tablist" aria-label="Spalten" className="flex shrink-0 gap-1">
        {COLUMNS.map((col, i) => (
          <button
            key={col.id}
            id={`dash-tab-${col.id}`}
            type="button"
            role="tab"
            aria-selected={active === col.id}
            aria-controls={`dash-panel-${col.id}`}
            tabIndex={active === col.id ? 0 : -1}
            onClick={() => setActive(col.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`min-h-11 flex-1 rounded-md px-3 text-md ${
              active === col.id
                ? 'bg-surface-raised font-medium text-text'
                : 'text-text-muted hover:bg-surface-raised'
            }`}
          >
            {col.label}
          </button>
        ))}
      </div>
      <div
        id={`dash-panel-${active}`}
        role="tabpanel"
        aria-labelledby={`dash-tab-${active}`}
        data-column={active}
        className="min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg border border-border bg-surface"
      >
        {panels[active]}
      </div>
    </div>
  );
}
