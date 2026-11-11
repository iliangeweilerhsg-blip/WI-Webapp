'use client';

// Bibliothek (VERTRAEGE §20.10): ohne Parameter die Konzeptliste je Modul mit Suche im Namen, mit `?konzept=<id>` die
// Konzeptansicht (F-BIB-02). Namen und One-Liner kommen von der KI und stehen als reiner Text da.
import Link from 'next/link';
import { useEffect, useId, useState } from 'react';
import type { ConceptListItem } from '@sg/shared';
import {
  KIND_LABELS,
  MAX_CONCEPT_QUERY,
  conceptHref,
  groupByModule,
  useConcepts,
} from '../../lib/concepts.ts';
import { useQueryParam } from '../../lib/hydrated.ts';
import { moduleHref } from '../../lib/nav.ts';
import { CoreHint } from '../CoreHint.tsx';
import { EmptyState } from '../Placeholder.tsx';
import { ConceptView } from './ConceptView.tsx';

const SEARCH_DEBOUNCE_MS = 150;

function countsLabel(item: ConceptListItem): string {
  const evidence = item.evidence_count === 1 ? '1 Beleg' : `${item.evidence_count} Belege`;
  const sessions = item.session_count === 1 ? '1 Vorlesung' : `${item.session_count} Vorlesungen`;
  return `${evidence} · ${sessions}`;
}

function ConceptRow({ item }: { item: ConceptListItem }) {
  const { concept } = item;
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
      <div className="min-w-0 flex-1 basis-72">
        <p className="break-words">
          <Link href={conceptHref(concept.id)} className="font-medium underline-offset-2 hover:underline">
            {concept.name}
          </Link>
          {concept.kind ? (
            <span className="ml-2 text-sm text-text-muted">{KIND_LABELS[concept.kind]}</span>
          ) : null}
          {concept.exam_relevant ? (
            <span className="ml-2 rounded-sm border border-border px-1 text-xs text-text-muted">Klausur</span>
          ) : null}
        </p>
        {concept.one_liner ? (
          <p className="mt-1 break-words text-sm text-text-muted">{concept.one_liner}</p>
        ) : null}
      </div>
      <p className="shrink-0 text-xs tabular-nums text-text-muted">{countsLabel(item)}</p>
    </li>
  );
}

function ConceptLibrary() {
  const searchId = useId();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);
  const concepts = useConcepts({ status: 'aktiv', q }, { keepPrevious: true });
  const groups = groupByModule(concepts.data ?? []);

  return (
    <section aria-labelledby="screen-title">
      <h1 id="screen-title" tabIndex={-1} className="text-xxl font-semibold focus:outline-none">
        Bibliothek
      </h1>
      <div className="mt-4 max-w-md">
        <label htmlFor={searchId} className="block text-sm font-medium">
          Konzepte suchen
        </label>
        <input
          id={searchId}
          type="search"
          autoComplete="off"
          maxLength={MAX_CONCEPT_QUERY}
          placeholder="Name oder Alias"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="mt-1 w-full rounded-md border border-border-strong bg-bg px-3 py-2 text-md"
        />
      </div>
      <div className="mt-6" aria-live="polite">
        {concepts.isError ? (
          <CoreHint error={concepts.error} />
        ) : !concepts.data ? (
          <p role="status" aria-busy="true" className="text-md text-text-muted">
            Lädt …
          </p>
        ) : groups.length === 0 ? (
          q !== '' ? (
            <p className="text-md text-text-muted">Kein Konzept gefunden.</p>
          ) : (
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
          )
        ) : (
          <div className="space-y-8">
            {groups.map((group) => (
              <section key={group.id || 'ohne'} aria-labelledby={`concepts-${group.id || 'ohne'}`}>
                <h2
                  id={`concepts-${group.id || 'ohne'}`}
                  className="flex items-baseline gap-2 text-sm font-medium text-text-muted"
                >
                  {group.id ? (
                    <Link href={moduleHref(group.id)} className="hover:text-text hover:underline">
                      {group.name}
                    </Link>
                  ) : (
                    <span>{group.name}</span>
                  )}
                  <span className="tabular-nums">{group.items.length}</span>
                </h2>
                <ul className="mt-2 divide-y divide-border rounded-lg border border-border px-4">
                  {group.items.map((item) => (
                    <ConceptRow key={item.concept.id} item={item} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function LibraryView() {
  const conceptId = useQueryParam('konzept');
  return conceptId ? <ConceptView key={conceptId} id={conceptId} /> : <ConceptLibrary />;
}
