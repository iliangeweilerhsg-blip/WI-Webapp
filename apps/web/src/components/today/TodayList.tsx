'use client';

import { moduleColorVar } from '../../lib/modules.ts';
import { cardState, formatClock, type CardState, type TodayEntry } from './model.ts';

/** Ruhige Kurztexte zum Stand einer Session in der Tagesliste (R11/R13: nichts Vorwurfsvolles, keine rote Farbe) */
const STATE_NOTE: Partial<Record<CardState, string>> = {
  bereit: 'bereit',
  laeuft: 'läuft',
  pausiert: 'pausiert',
  verpasst: 'nicht aufgenommen',
  beendet: 'beendet',
  verarbeitet: 'verarbeitet',
};

function timeOf(entry: TodayEntry): string {
  if (entry.allDay) return 'ganztägig';
  if (entry.start === null) return '–';
  return formatClock(entry.start);
}

/** „Heute“-Liste (07 §3.1): Zeit, Modul, Raum und Stand je Termin bzw. Session */
export function TodayList({ entries, now }: { entries: readonly TodayEntry[]; now: number }) {
  return (
    <section aria-labelledby="heute-liste">
      <h2 id="heute-liste" className="text-sm font-medium text-text-muted">
        Heute
      </h2>
      <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
        {entries.map((entry) => {
          const state = entry.session ? cardState(entry.session, now) : null;
          const note = state ? STATE_NOTE[state] : undefined;
          const over = entry.end !== null && entry.end <= now && !entry.allDay;
          return (
            <li key={entry.key} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3">
              <time
                className={`w-20 shrink-0 text-md tabular-nums ${over ? 'text-text-muted' : 'text-text'}`}
                dateTime={entry.event?.starts_at ?? entry.session?.planned_starts_at ?? undefined}
              >
                {timeOf(entry)}
              </time>
              <div className="min-w-0 flex-1 basis-48">
                <p className={`flex items-center gap-2 ${over ? 'text-text-muted' : ''}`}>
                  {entry.module ? (
                    <span
                      aria-hidden="true"
                      className="inline-block size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: moduleColorVar(entry.module.color) }}
                    />
                  ) : null}
                  <span className="min-w-0 break-words">{entry.label}</span>
                </p>
                {entry.room ? <p className="text-sm text-text-muted">{entry.room}</p> : null}
              </div>
              {note ? <span className="text-sm text-text-muted">{note}</span> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
