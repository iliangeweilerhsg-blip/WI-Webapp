'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { Module } from '@sg/shared';
import { documentHref } from '../lib/material.ts';
import { moduleColorVar } from '../lib/modules.ts';
import { formatDue, isWebUrl, useSyncedDeadlines } from '../lib/moodle.ts';

/**
 * Fristen aus Moodle (F-MDL-04 Schritt 3): ruhige Liste nach Datum, ohne Countdown und ohne rote Farbe (R11).
 * Ohne Fristen, ohne Moodle oder ohne Core zeigt sie nichts: Fristen sind eine Ergänzung, kein Pflichtteil.
 */
export function MoodleDeadlines({
  moduleId,
  modules,
  days,
  limit,
  visible,
  onShowAll,
  headingId,
}: {
  /** Nur Fristen dieses Moduls (Modulseite). Ohne: alle (Heute) */
  moduleId?: string;
  /** Für die Modulfarbe (Heute) */
  modules?: readonly Module[] | undefined;
  /** Nur Fristen der nächsten Tage */
  days?: number;
  limit?: number;
  /** Nur so viele zeigen; liefert der Core mehr, erscheint „Alle anzeigen“ (Modulseite) */
  visible?: number;
  onShowAll?: () => void;
  headingId: string;
}) {
  const { data } = useSyncedDeadlines({
    ...(moduleId ? { moduleId } : {}),
    ...(days ? { days } : {}),
    ...(limit ? { limit } : {}),
  });
  const sectionRef = useRef<HTMLElement>(null);
  // „Alle anzeigen“ verschwindet nach dem Klick: Fokus auf die erste neu angezeigte Frist (#135)
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const more = data !== undefined && visible !== undefined && data.length > visible;
  const shownCount = data ? (more ? (visible ?? 0) : data.length) : 0;
  useEffect(() => {
    if (focusIndex === null || shownCount <= focusIndex) return;
    sectionRef.current?.querySelectorAll<HTMLElement>('ul > li')[focusIndex]?.focus();
    setFocusIndex(null);
  }, [focusIndex, shownCount]);
  if (!data || data.length === 0) return null;
  const shown = more ? data.slice(0, visible) : data;
  const moduleOf = new Map((modules ?? []).map((m) => [m.id, m]));

  return (
    <section ref={sectionRef} aria-labelledby={headingId}>
      <h2 id={headingId} className="text-sm font-medium text-text-muted">
        Fristen
      </h2>
      <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
        {shown.map((deadline) => {
          const module = moduleOf.get(deadline.module_id);
          return (
            <li
              key={deadline.id}
              tabIndex={-1}
              className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3 outline-offset-[-2px]"
            >
              <time className="w-36 shrink-0 text-md tabular-nums" dateTime={deadline.due_at}>
                {formatDue(deadline.due_at)}
              </time>
              <div className="min-w-0 flex-1 basis-48">
                <p className="flex items-center gap-2">
                  {module && !moduleId ? (
                    <span
                      aria-hidden="true"
                      className="inline-block size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: moduleColorVar(module.color) }}
                    />
                  ) : null}
                  <span className="min-w-0 break-words">{deadline.name}</span>
                </p>
                <p className="text-sm text-text-muted">
                  {[
                    module && !moduleId ? module.name : null,
                    deadline.source === 'aufgabe' ? 'Abgabe' : 'Termin',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <span className="flex gap-3 text-sm">
                {deadline.exercise_sheet_id ? (
                  <Link
                    href={documentHref('blatt', deadline.exercise_sheet_id)}
                    className="text-text-muted underline-offset-2 hover:text-text hover:underline"
                  >
                    Blatt
                  </Link>
                ) : null}
                {isWebUrl(deadline.url) ? (
                  <a
                    href={deadline.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-text-muted underline-offset-2 hover:text-text hover:underline"
                  >
                    In Moodle
                  </a>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      {more && onShowAll ? (
        <button
          type="button"
          onClick={() => {
            setFocusIndex(shown.length);
            onShowAll();
          }}
          className="mt-2 min-h-9 rounded-md px-2 text-sm text-text-muted hover:bg-surface hover:text-text"
        >
          Alle anzeigen
        </button>
      ) : null}
    </section>
  );
}
