'use client';

// Vorlesungen eines Moduls (UX-307): vergangene Sessions, neueste zuerst, jede mit Link auf den Rückblick.
// Ohne Vorlesung bleibt der Bereich leer, damit der Tab weiter nur die Foliensätze zeigt.
import Link from 'next/link';
import { useHydrationSafe } from '../../lib/hydrated.ts';
import { formatDate, useDecks } from '../../lib/material.ts';
import { formatDuration, sessionDurationMs, sessionLabel, useModuleSessions } from '../../lib/sessions.ts';
import { rueckblickHref } from '../../lib/transcript.ts';

export function ModuleSessions({ moduleId }: { moduleId: string }) {
  const sessions = useHydrationSafe(useModuleSessions(moduleId));
  const decks = useDecks(moduleId);
  const deckTitles = new Map((decks.data ?? []).map((d) => [d.id, d.title]));

  if (sessions.isError) {
    return (
      <p role="status" className="mb-6 text-sm text-text-muted">
        Die Vorlesungen konnten nicht geladen werden. Sobald der Core antwortet, erscheinen sie hier.
      </p>
    );
  }
  if (sessions.isPending) {
    return (
      <p role="status" aria-busy="true" className="mb-6 text-sm text-text-muted">
        Vorlesungen laden …
      </p>
    );
  }
  const items = sessions.data ?? [];
  if (items.length === 0) return null;

  return (
    <section aria-labelledby="modul-vorlesungen" className="mb-8">
      <h2 id="modul-vorlesungen" className="text-sm font-medium text-text-muted">
        Aufgenommene Vorlesungen <span className="tabular-nums">{items.length}</span>
      </h2>
      <ul
        aria-labelledby="modul-vorlesungen"
        className="mt-2 divide-y divide-border rounded-lg border border-border px-4"
      >
        {items.map((s) => {
          const duration = sessionDurationMs(s);
          return (
            <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
              <Link
                href={rueckblickHref(s.id)}
                className="min-w-0 break-words font-medium underline-offset-2 hover:underline"
              >
                {sessionLabel(s, s.slide_deck_id ? deckTitles.get(s.slide_deck_id) : null)}
              </Link>
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
