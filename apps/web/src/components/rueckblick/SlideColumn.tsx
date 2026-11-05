'use client';

// Folie des Rückblicks: die gewählte Folie groß, darunter eine Leiste mit Vorschaubildern. Die Anzeige nutzt dieselben
// Bilder wie das Live-Dashboard (`pageImageUrl`/`pageThumbUrl`). Die Leiste scrollt in sich, nie die Seite.
import { useEffect, useRef } from 'react';
import { pageImageUrl, pageThumbUrl } from '../../lib/material.ts';
import { NO_SLIDE } from '../../lib/transcript.ts';

export interface SlideItem {
  id: string;
  /** 1-basiert */
  index: number;
  width: number;
  height: number;
}

export interface SlideColumnProps {
  deckId: string | null;
  slides: readonly SlideItem[];
  /** Folien-ID oder `NO_SLIDE` */
  selected: string;
  onSelect: (key: string) => void;
  /** Es gibt Zeilen vor der ersten Folie bzw. ohne Folie */
  hasNone: boolean;
  /** Folien-IDs, zu denen gesprochen wurde (die anderen sind in der Leiste gedämpft) */
  spoken: ReadonlySet<string>;
}

const nav =
  'inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-3 text-md hover:bg-surface-raised';

export function SlideColumn({ deckId, slides, selected, onSelect, hasNone, spoken }: SlideColumnProps) {
  const keys = [...(hasNone ? [NO_SLIDE] : []), ...slides.map((s) => s.id)];
  const at = keys.indexOf(selected);
  const slide = slides.find((s) => s.id === selected);
  const strip = useRef<HTMLDivElement>(null);

  // Die Leiste folgt der gewählten Folie (auch beim Abspielen), ohne die Seite zu bewegen
  useEffect(() => {
    const el = strip.current?.querySelector<HTMLElement>('[aria-current="true"]');
    const box = strip.current;
    if (!el || !box) return;
    const left = el.offsetLeft - box.offsetLeft;
    if (left < box.scrollLeft || left + el.offsetWidth > box.scrollLeft + box.clientWidth) {
      box.scrollLeft = Math.max(0, left - (box.clientWidth - el.offsetWidth) / 2);
    }
  }, [selected]);

  function step(delta: -1 | 1) {
    const next = keys[at + delta];
    if (next !== undefined) onSelect(next);
  }

  return (
    <div data-testid="review-slides" className="flex min-w-0 flex-col gap-3">
      <div className="grid place-items-center rounded-lg border border-border bg-surface-raised p-2">
        {slide ? (
          deckId ? (
            <img
              key={slide.id}
              src={pageImageUrl('folien', deckId, slide.id, slide.index)}
              alt={`Folie ${slide.index}`}
              draggable={false}
              style={{ aspectRatio: `${slide.width} / ${slide.height}` }}
              className="max-h-[50vh] w-full select-none bg-white object-contain shadow-sm lg:max-h-[60vh]"
            />
          ) : (
            <p className="py-12 text-md text-text-muted">Folie {slide.index}</p>
          )
        ) : (
          <p className="px-4 py-12 text-center text-md text-text-muted">
            Vor der ersten Folie und zwischen den Folien
          </p>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 text-sm text-text-muted">
        <button
          type="button"
          className={nav}
          aria-label="Vorherige Folie"
          disabled={at <= 0}
          onClick={() => step(-1)}
        >
          ‹
        </button>
        <span data-testid="review-slide-counter" aria-live="off">
          {slide ? `Folie ${slide.index} von ${slides.length}` : 'Ohne Folie'}
        </span>
        <button
          type="button"
          className={nav}
          aria-label="Nächste Folie"
          disabled={at < 0 || at >= keys.length - 1}
          onClick={() => step(1)}
        >
          ›
        </button>
      </div>

      <nav aria-label="Folien">
        <div ref={strip} className="relative flex gap-2 overflow-x-auto pb-2">
          {keys.map((key, i) => {
            const item = slides.find((s) => s.id === key);
            const current = key === selected;
            const label = item ? `Folie ${item.index}` : 'Ohne Folie';
            return (
              <button
                key={key}
                type="button"
                aria-label={label}
                aria-current={current ? 'true' : undefined}
                // Eine Tabstelle für die ganze Leiste; innerhalb wählen die Pfeiltasten
                tabIndex={current || (at < 0 && i === 0) ? 0 : -1}
                onClick={() => onSelect(key)}
                onKeyDown={(e) => {
                  const move = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
                  if (!move || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
                  const next = keys[i + move];
                  if (next === undefined) return;
                  e.preventDefault();
                  onSelect(next);
                  const buttons = e.currentTarget.parentElement?.querySelectorAll('button');
                  (buttons?.[i + move] as HTMLElement | undefined)?.focus();
                }}
                className={`w-20 shrink-0 rounded-md border p-0.5 text-center text-xs ${
                  current ? 'border-accent bg-accent-soft' : 'border-border hover:bg-surface-raised'
                } ${item && !spoken.has(item.id) ? 'opacity-60' : ''}`}
              >
                {item ? (
                  <>
                    {deckId ? (
                      <img
                        src={pageThumbUrl('folien', deckId, item.id, item.index)}
                        alt=""
                        loading="lazy"
                        draggable={false}
                        style={{ aspectRatio: `${item.width} / ${item.height}` }}
                        className="block w-full rounded-sm bg-white"
                      />
                    ) : (
                      <span className="grid aspect-video place-items-center text-text-muted">–</span>
                    )}
                    <span aria-hidden="true" className="block text-text-muted">
                      {item.index}
                    </span>
                  </>
                ) : (
                  <span
                    aria-hidden="true"
                    className="grid aspect-video place-items-center px-1 text-text-muted"
                  >
                    Ohne Folie
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
