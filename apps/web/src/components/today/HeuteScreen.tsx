'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { CoreHint } from '../CoreHint.tsx';
import { MoodleAccessHint } from '../MoodleAccessHint.tsx';
import { MoodleDeadlines } from '../MoodleDeadlines.tsx';
import { EmptyState } from '../Placeholder.tsx';
import { BackupHint } from './BackupHint.tsx';
import { FirstStepsCard } from './FirstSteps.tsx';
import { SpontaneousStartCard } from './SpontaneousStart.tsx';
import { RecentSessions } from './RecentSessions.tsx';
import { StartCard } from './StartCard.tsx';
import { StorageHint } from './StorageHint.tsx';
import { TodayList } from './TodayList.tsx';
import { buildEntries, formatClock, pickCard } from './model.ts';
import { useNow, useTodayData } from './use-today.ts';

const dateFormat = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });

/** Heute (07 §3.1): Start-Karte für die nächste bzw. laufende Vorlesung, darunter die Tagesliste. */
export function HeuteScreen() {
  // Das Datum kommt erst im Browser, weil der Static Export zur Build-Zeit läuft
  const now = useNow(15_000);
  const data = useTodayData(now);
  const { sessions, events, modules } = data;

  const entries = useMemo(() => buildEntries(events, sessions, modules), [events, sessions, modules]);
  const pick = now === null ? null : pickCard(sessions, now);
  const cardEntry = pick ? (entries.find((e) => e.session?.id === pick.session.id) ?? null) : null;

  const hasData = data.hasData;
  const offline = data.error !== null && data.error !== undefined;
  // Mit altem Stand: ruhiger Hinweis. Ohne jeden Stand: der Core-Hinweis wie auf den anderen Bildschirmen.
  const note =
    hasData && (offline || data.hint)
      ? `Keine Live-Verbindung. Du siehst den Stand von ${formatClock(data.updatedAt)} Uhr. Er aktualisiert sich, sobald die Verbindung wieder steht.`
      : null;

  return (
    <section aria-labelledby="screen-title">
      <h1 id="screen-title" className="min-h-9 text-xxl font-semibold">
        {now === null ? 'Heute' : dateFormat.format(new Date(now))}
      </h1>

      <div className="mt-6 space-y-6">
        {!hasData && offline ? <CoreHint error={data.error} /> : null}
        {note ? (
          <p
            role="status"
            className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-text-muted"
          >
            {note}
          </p>
        ) : null}

        {data.loading && !hasData ? (
          <p role="status" aria-busy="true" className="text-md text-text-muted">
            Lädt …
          </p>
        ) : null}

        {now !== null && pick && cardEntry ? (
          <StartCard
            entry={cardEntry}
            now={now}
            previousRunning={pick.previousRunning !== null}
            onSession={data.apply}
            onRefetch={data.refetch}
          />
        ) : null}

        {hasData ? (
          <SpontaneousStartCard modules={modules} sessions={sessions} onSession={data.apply} />
        ) : null}

        {now !== null && entries.length > 0 ? <TodayList entries={entries} now={now} /> : null}

        {!data.loading && hasData && entries.length === 0 ? (
          <EmptyState
            action={
              <Link
                href="/kalender"
                className="inline-flex min-h-11 items-center rounded-md border border-border-strong px-4 py-2 text-md hover:bg-surface"
              >
                Zum Kalender
              </Link>
            }
          >
            Heute steht nichts an. Im Kalender siehst du die ganze Woche.
          </EmptyState>
        ) : null}

        {/* Die letzten drei Vorlesungen mit Link auf den Rückblick (UX-307). Ohne Vorlesungen: nichts */}
        {now !== null && hasData ? <RecentSessions modules={modules} now={now} /> : null}

        {/* Fristen aus Moodle der nächsten 14 Tage, höchstens 5 (F-MDL-04). Ohne Fristen: nichts */}
        {now !== null ? (
          <MoodleDeadlines modules={modules} days={14} limit={5} headingId="heute-fristen" />
        ) : null}

        {/* Dezenter Hinweis zum Moodle-Zugang ab 7 Tagen vor Ablauf (F-MDL-01). Sonst nichts */}
        {now !== null ? <MoodleAccessHint withLink /> : null}

        {/* Ruhiger Hinweis auf ein veraltetes Backup (UX-10), nie während einer Session */}
        {now !== null ? <BackupHint sessions={sessions} /> : null}

        {/* Ruhiger Hinweis bei knappem Speicherplatz (UX-11), nie während einer Session */}
        {now !== null ? <StorageHint sessions={sessions} /> : null}

        {/* Erste Schritte (UX-14): hakt sich selbst ab, nie während einer Session, weg wenn alles erledigt ist */}
        {hasData ? <FirstStepsCard /> : null}
      </div>
    </section>
  );
}
