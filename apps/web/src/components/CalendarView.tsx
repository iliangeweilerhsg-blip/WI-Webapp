'use client';

import { useEffect, useState } from 'react';
import type { IcsImportResult } from '@sg/shared';
import {
  addDays,
  formatCount,
  formatWeek,
  startOfWeek,
  useCalendarSources,
  useUnassignedCount,
  useWeekEvents,
} from '../lib/calendar.ts';
import { useModules } from '../lib/modules.ts';
import { CalendarImport, CalendarImportResult } from './CalendarImport.tsx';
import { CalendarSources } from './CalendarSources.tsx';
import { CalendarWeek } from './CalendarWeek.tsx';
import { CoreHint } from './CoreHint.tsx';
import { EmptyState } from './Placeholder.tsx';

const navButton = 'rounded-md border border-border px-3 py-1 text-sm hover:bg-surface disabled:opacity-50';

/** Kalender (F-KAL-01/02): Termine der Woche, Zuordnung zu Modulen, Import per Datei oder URL. */
export function CalendarView() {
  // Das Datum gibt es erst im Browser (Static Export): Beim Hydratisieren bleibt die Woche leer, wie im vorgerenderten HTML
  const [today, setToday] = useState<Date | null>(null);
  const [weekStart, setWeekStart] = useState<Date | null>(null);
  const [result, setResult] = useState<IcsImportResult | null>(null);

  useEffect(() => {
    const now = new Date();
    setToday(now);
    setWeekStart(startOfWeek(now));
  }, []);

  const events = useWeekEvents(weekStart);
  const modules = useModules();
  const sources = useCalendarSources();
  const unassigned = useUnassignedCount();

  const noSources = sources.isSuccess && sources.data.length === 0;
  const failure = events.error ?? sources.error ?? modules.error;

  return (
    <section aria-labelledby="screen-title">
      <h1 id="screen-title" className="text-xxl font-semibold">
        Kalender
      </h1>
      <p className="mt-1 text-sm text-text-muted">
        Deine Vorlesungen, Übungen und Prüfungen aus dem Stundenplan.
      </p>

      <div className="mt-6 space-y-6">
        <CoreHint error={failure} />

        {result ? (
          <CalendarImportResult
            key={result.source.id + result.source.updated_at}
            result={result}
            onDismiss={() => setResult(null)}
          />
        ) : null}

        {noSources ? <CalendarImport onResult={setResult} /> : null}

        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="min-h-7 text-lg font-medium" aria-live="polite">
              {weekStart ? formatWeek(weekStart) : ''}
            </h2>
            <div role="group" aria-label="Woche wählen" className="flex gap-2">
              <button
                type="button"
                disabled={!weekStart}
                onClick={() => weekStart && setWeekStart(addDays(weekStart, -7))}
                aria-label="Vorherige Woche"
                className={navButton}
              >
                ‹
              </button>
              <button
                type="button"
                disabled={!today}
                onClick={() => today && setWeekStart(startOfWeek(new Date()))}
                className={navButton}
              >
                Heute
              </button>
              <button
                type="button"
                disabled={!weekStart}
                onClick={() => weekStart && setWeekStart(addDays(weekStart, 7))}
                aria-label="Nächste Woche"
                className={navButton}
              >
                ›
              </button>
            </div>
          </div>

          {weekStart && events.isSuccess ? (
            events.data.length === 0 && noSources ? (
              <EmptyState>Noch keine Termine. Importiere oben deinen Stundenplan.</EmptyState>
            ) : (
              <CalendarWeek
                weekStart={weekStart}
                events={events.data}
                modules={modules.data ?? []}
                today={today}
              />
            )
          ) : (
            <p className="text-sm text-text-muted">{events.isError ? '' : 'Lädt …'}</p>
          )}

          {unassigned.isSuccess && unassigned.data > 0 ? (
            <p className="mt-3 text-sm text-text-muted">
              {unassigned.data === 1
                ? '1 kommender Termin hat noch kein Modul.'
                : `${formatCount(unassigned.data)} kommende Termine haben noch kein Modul.`}{' '}
              Öffne „Zuordnen“ am Termin oder lege Module aus dem Stundenplan an.
            </p>
          ) : null}
        </div>

        <CalendarSources onResult={setResult} />

        {!noSources && sources.isSuccess ? <CalendarImport onResult={setResult} /> : null}
      </div>
    </section>
  );
}
