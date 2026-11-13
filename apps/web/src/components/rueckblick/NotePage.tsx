'use client';

// Eine Notizseite im Rückblick (F-NAC-02, F-NAC-04): Striche mit der Ink-Darstellung des Dashboards. Ein Tipp auf einen
// Strich spielt die Aufnahme ab `t_start_ms − 3 s` ab. Mit der Tastatur wählen die Pfeiltasten den nächsten oder
// vorigen Strich (nach Schreibzeit), Enter spielt ab. Die Seite lädt und zeichnet nur, solange sie (fast) im Bild ist.
import { useMemo, useRef, useState } from 'react';
import type { Page, Stroke } from '@sg/shared';
import { friendlyMessage } from '../../lib/api.ts';
import { usePageStrokes } from '../../lib/review-notes.ts';
import { clockAt } from '../../lib/transcript.ts';
import { InkPage } from '../ink/index.ts';
import { buildHitIndex, hitTest, type HitEntry } from './stroke-hit.ts';
import { playbackStart } from './notes.ts';
import { useInView } from './use-in-view.ts';

/** Trefferfläche um den Strich in Bildschirmpixeln (Finger und Stift sind ungenau) */
const TAP_RADIUS_PX = 12;
const NO_STROKES: readonly Stroke[] = [];

export interface NotePageProps {
  page: Page;
  /** `session.started_at` für die Uhrzeit */
  startedAt: string | null;
  /** Es gibt Audio; ohne bleibt die Seite reine Ansicht */
  canPlay: boolean;
  /** Spielt ab Sitzungszeit `t` (ms) */
  onPlay: (tMs: number) => void;
}

export function NotePage({ page, startedAt, canPlay, onPlay }: NotePageProps) {
  const [observe, inView] = useInView();
  const strokes = usePageStrokes(page.id, inView);
  const boxRef = useRef<HTMLDivElement>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);

  const list = inView ? (strokes.data?.strokes ?? NO_STROKES) : NO_STROKES;
  const index = useMemo(() => buildHitIndex(list), [list]);
  const picked = index.timed.find((e) => e.id === pickedId) ?? null;
  const pickedAt = picked ? index.timed.indexOf(picked) : -1;

  const pick = (entry: HitEntry | null, play: boolean) => {
    setPickedId(entry ? entry.id : null);
    if (entry && play) onPlay(playbackStart(entry.t));
  };

  const onClick = (e: React.MouseEvent) => {
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const scale = page.width_pt / rect.width;
    const x = (e.clientX - rect.left) * scale;
    const y = (e.clientY - rect.top) * scale;
    pick(hitTest(index, x, y, TAP_RADIUS_PX * scale), true);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || index.timed.length === 0) return;
    const last = index.timed.length - 1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      pick(index.timed[Math.min(last, pickedAt + 1)] ?? null, false);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      pick(index.timed[pickedAt < 0 ? last : Math.max(0, pickedAt - 1)] ?? null, false);
    } else if (e.key === 'Enter' && !e.repeat) {
      e.preventDefault();
      pick(picked ?? index.timed[0] ?? null, true);
    } else if (e.key === 'Escape' && picked) {
      setPickedId(null);
    }
  };

  const loaded = inView && strokes.data !== undefined;
  const untimed = loaded && list.length > 0 && index.timed.length === 0;
  const label = `Notizseite ${page.index}`;
  const rect = picked?.rect;

  return (
    <figure data-testid="note-page" data-in-view={inView ? 'true' : 'false'} className="min-w-0">
      <figcaption className="mb-1 flex items-baseline justify-between gap-2 text-sm text-text-muted">
        <span>{`Seite ${page.index}`}</span>
        {picked ? (
          <span className="tabular-nums" data-testid="note-picked">
            {clockAt(startedAt, picked.t, true)}
          </span>
        ) : null}
      </figcaption>
      <div
        ref={(el) => {
          boxRef.current = el;
          observe(el);
        }}
        className="relative w-full"
        style={{ aspectRatio: `${page.width_pt} / ${page.height_pt}` }}
      >
        {inView ? (
          <InkPage
            strokes={list}
            page={{
              width_pt: page.width_pt,
              height_pt: page.height_pt,
              template: page.template,
              background_slide_id: page.background_slide_id,
            }}
            aria-label={label}
          />
        ) : null}
        {inView && canPlay && index.timed.length > 0 ? (
          <div
            role="group"
            tabIndex={0}
            data-testid="note-hit"
            aria-label={`${label}. Pfeiltasten wählen einen Strich, Eingabe spielt ab dort ab.`}
            onClick={onClick}
            onKeyDown={onKeyDown}
            className="absolute inset-0 cursor-pointer rounded-sm outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            {rect ? (
              <span
                aria-hidden="true"
                data-testid="note-picked-box"
                className="pointer-events-none absolute rounded-sm border-2 border-accent bg-accent-soft/40"
                style={{
                  left: `${(Math.max(0, rect.x0) / page.width_pt) * 100}%`,
                  top: `${(Math.max(0, rect.y0) / page.height_pt) * 100}%`,
                  width: `${((Math.min(page.width_pt, rect.x1) - Math.max(0, rect.x0)) / page.width_pt) * 100}%`,
                  height: `${((Math.min(page.height_pt, rect.y1) - Math.max(0, rect.y0)) / page.height_pt) * 100}%`,
                }}
              />
            ) : null}
          </div>
        ) : null}
        {inView && strokes.isPending ? (
          <p role="status" className="absolute inset-x-0 top-2 text-center text-sm text-text-muted">
            Wird geladen …
          </p>
        ) : null}
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {picked
          ? `Strich ${pickedAt + 1} von ${index.timed.length}, ${clockAt(startedAt, picked.t, true)}`
          : ''}
      </p>
      {inView && strokes.isError ? (
        <p role="alert" className="mt-1 text-sm text-text-muted">
          {`Die Seite ist gerade nicht erreichbar: ${friendlyMessage(strokes.error)} `}
          <button
            type="button"
            onClick={() => void strokes.refetch()}
            className="underline underline-offset-2 hover:text-text"
          >
            Erneut versuchen
          </button>
        </p>
      ) : null}
      {untimed ? (
        <p className="mt-1 text-sm text-text-muted">Diese Striche haben keine Zeit, daher kein Abspielen.</p>
      ) : null}
    </figure>
  );
}
