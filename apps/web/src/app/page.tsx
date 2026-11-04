'use client';

import { useEffect, useState } from 'react';
import { CoreHint } from '../components/CoreHint.tsx';
import { useCoreHealth } from '../components/CoreStatus.tsx';
import { EmptyState } from '../components/Placeholder.tsx';

/** Heute (07 §3.1) – Platzhalter. Das Datum kommt erst im Browser, weil der Static Export zur Build-Zeit läuft. */
export default function HeutePage() {
  const [today, setToday] = useState<string | null>(null);
  const health = useCoreHealth();

  useEffect(() => {
    setToday(
      new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()),
    );
  }, []);

  return (
    <section aria-labelledby="screen-title">
      <h1 id="screen-title" className="min-h-9 text-xxl font-semibold">
        {today ?? 'Heute'}
      </h1>
      <p className="mt-1 text-sm text-text-muted">Heute</p>
      <div className="mt-6">
        <CoreHint error={health.error} />
        <EmptyState>
          <span className="block text-text">Kommt in Phase 1</span>
          <span className="mt-1 block">
            Hier siehst du bald, was als Nächstes ansteht, und einen Vorschlag für die Zeit danach.
          </span>
        </EmptyState>
      </div>
    </section>
  );
}
