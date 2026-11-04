'use client';

import { useId } from 'react';

/** Platzhalter für Bereiche, die ein anderes Ticket liefert (Geräte T1-10, Daten und Papierkorb T1-18). */
export function ComingSoon({ title, ticket }: { title: string; ticket: string }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="mt-6 rounded-lg border border-border p-4">
      <h2 id={id} className="text-lg font-medium">
        {title}
      </h2>
      <p className="mt-1 text-sm text-text-muted">Kommt bald ({ticket}).</p>
    </section>
  );
}
