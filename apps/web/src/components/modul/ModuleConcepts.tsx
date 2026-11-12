'use client';

// Tab „Konzepte“ im Modul (UX-308): die aktiven Konzepte dieses Moduls aus derselben Quelle wie die Bibliothek
// (`GET /concepts?module_id`). Namen und One-Liner kommen von der KI und stehen als reiner Text da.
import Link from 'next/link';
import { CONCEPT_LIST_CAP, KIND_LABELS, conceptHref, useConcepts } from '../../lib/concepts.ts';
import { CoreHint } from '../CoreHint.tsx';
import { EmptyState } from '../Placeholder.tsx';

export function ModuleConcepts({ moduleId }: { moduleId: string }) {
  const concepts = useConcepts({ moduleId, status: 'aktiv' });

  if (concepts.isError) return <CoreHint error={concepts.error} />;
  if (!concepts.data) {
    return (
      <p role="status" aria-busy="true" className="text-md text-text-muted">
        Lädt …
      </p>
    );
  }
  if (concepts.data.length === 0) {
    return (
      <EmptyState
        action={
          <Link
            href="/inbox"
            className="inline-flex min-h-11 items-center rounded-md border border-border-strong px-4 py-2 text-md hover:bg-surface"
          >
            Zur Inbox
          </Link>
        }
      >
        Noch keine Konzepte. Sie entstehen, wenn du Vorschläge in der Inbox annimmst.
      </EmptyState>
    );
  }
  return (
    <div>
      {concepts.data.length >= CONCEPT_LIST_CAP ? (
        <p className="mb-2 text-sm text-text-muted">
          Es stehen nur die ersten {CONCEPT_LIST_CAP} Konzepte da. Weitere findest du in der Bibliothek.
        </p>
      ) : null}
      <ul
        aria-label="Konzepte des Moduls"
        className="divide-y divide-border rounded-lg border border-border px-4"
      >
        {concepts.data.map(({ concept }) => (
          <li key={concept.id} className="py-3">
            <p className="break-words">
              <Link href={conceptHref(concept.id)} className="font-medium underline-offset-2 hover:underline">
                {concept.name}
              </Link>
              {concept.kind ? (
                <span className="ml-2 text-sm text-text-muted">{KIND_LABELS[concept.kind]}</span>
              ) : null}
              {concept.exam_relevant ? (
                <span className="ml-2 rounded-sm border border-border px-1 text-xs text-text-muted">
                  Klausur
                </span>
              ) : null}
            </p>
            {concept.one_liner ? (
              <p className="mt-1 break-words text-sm text-text-muted">{concept.one_liner}</p>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm">
        <Link
          href="/bibliothek"
          className="text-text-muted underline-offset-2 hover:text-text hover:underline"
        >
          Alle Konzepte in der Bibliothek
        </Link>
      </p>
    </div>
  );
}
