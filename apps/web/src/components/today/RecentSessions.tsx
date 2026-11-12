'use client';

// „Zuletzt“ auf Heute (UX-307): die letzten drei Vorlesungen, egal aus welchem Modul. Der Core sortiert Sessions nur
// aufsteigend und kennt kein „neueste n“; darum lädt die Ansicht die letzten 60 Tage und nimmt davon die drei neuesten.
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo } from 'react';
import type { Module } from '@sg/shared';
import { addDays, dayKey, startOfDay } from '../../lib/calendar.ts';
import { useHydrationSafe } from '../../lib/hydrated.ts';
import { formatDate } from '../../lib/material.ts';
import {
  formatDuration,
  isFinished,
  listSessionsAll,
  newestFirst,
  sessionDurationMs,
  sessionLabel,
} from '../../lib/sessions.ts';
import { rueckblickHref } from '../../lib/transcript.ts';

export const RECENT_COUNT = 3;
export const RECENT_WINDOW_DAYS = 60;

export function RecentSessions({ modules, now }: { modules: readonly Module[]; now: number }) {
  const today = startOfDay(new Date(now));
  const from = addDays(today, -RECENT_WINDOW_DAYS);
  const key = dayKey(today);
  const query = useHydrationSafe(
    useQuery({
      // Unter ['sessions','heute'], damit Ereignisse und Neuladen der Ansicht auch diese Liste auffrischen
      queryKey: ['sessions', 'heute', 'zuletzt', key],
      queryFn: ({ signal }) => listSessionsAll({ from }, signal),
      select: (items) => newestFirst(items.filter(isFinished)).slice(0, RECENT_COUNT),
    }),
  );
  const names = useMemo(() => new Map(modules.map((m) => [m.id, m.short_name?.trim() || m.name])), [modules]);
  // Ruhig: ohne Vorlesungen oder bei Fehler (den meldet die Ansicht schon) steht hier nichts
  const items = query.data ?? [];
  if (items.length === 0) return null;

  return (
    <section aria-labelledby="heute-zuletzt">
      <h2 id="heute-zuletzt" className="text-sm font-medium text-text-muted">
        Zuletzt
      </h2>
      <ul
        aria-labelledby="heute-zuletzt"
        className="mt-2 divide-y divide-border rounded-lg border border-border px-4"
      >
        {items.map((s) => {
          const duration = sessionDurationMs(s);
          const module = names.get(s.module_id);
          return (
            <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
              <p className="min-w-0 break-words">
                <Link href={rueckblickHref(s.id)} className="font-medium underline-offset-2 hover:underline">
                  {sessionLabel(s)}
                </Link>
                {module ? <span className="ml-2 text-sm text-text-muted">{module}</span> : null}
              </p>
              <p className="shrink-0 text-sm tabular-nums text-text-muted">
                {s.started_at ? formatDate(s.started_at) : ''}
                {duration !== null ? ` · ${formatDuration(duration)}` : ''}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
