'use client';

// Anfrage der Suche (VERTRAEGE §19.7): 120 ms nach dem letzten Tastendruck, die vorige Anfrage wird abgebrochen, die
// letzte Antwort bleibt sichtbar, bis die neue da ist. Ein Ladehinweis erscheint erst nach 300 ms.
import { useEffect, useState } from 'react';
import type { ConceptListItem, SearchResponse } from '@sg/shared';
import { SEARCH_DEBOUNCE_MS, SLOW_HINT_MS, fetchConceptHits, fetchSearch } from '../../lib/search.ts';

export interface SearchState {
  /** Letzte erfolgreiche Antwort (bleibt stehen, bis die nächste da ist) */
  response: SearchResponse | null;
  /** Konzepte zur letzten Anfrage (UX-309). Scheitert dieser Aufruf, bleibt die Liste leer, ohne Fehlerzeile. */
  concepts: ConceptListItem[];
  /** Die letzte Anfrage ist gescheitert (Core nicht erreichbar o. Ä.) */
  failed: boolean;
  /** Eine Anfrage läuft seit mehr als 300 ms */
  slow: boolean;
}

export function useSearch(query: string): SearchState {
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [concepts, setConcepts] = useState<ConceptListItem[]>([]);
  const [failed, setFailed] = useState(false);
  const [slow, setSlow] = useState(false);
  const empty = query.trim() === '';

  useEffect(() => {
    if (empty) {
      setResponse(null);
      setConcepts([]);
      setFailed(false);
      setSlow(false);
      return;
    }
    const controller = new AbortController();
    let slowTimer: ReturnType<typeof setTimeout> | undefined;
    const debounce = setTimeout(() => {
      slowTimer = setTimeout(() => setSlow(true), SLOW_HINT_MS);
      fetchConceptHits(query, controller.signal).then(
        (items) => {
          if (!controller.signal.aborted) setConcepts(items);
        },
        () => {
          if (!controller.signal.aborted) setConcepts([]);
        },
      );
      fetchSearch(query, controller.signal).then(
        (result) => {
          if (controller.signal.aborted) return;
          clearTimeout(slowTimer);
          setResponse(result);
          setFailed(false);
          setSlow(false);
        },
        () => {
          if (controller.signal.aborted) return;
          clearTimeout(slowTimer);
          setFailed(true);
          setSlow(false);
        },
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(debounce);
      clearTimeout(slowTimer);
      controller.abort();
    };
  }, [query, empty]);

  return { response, concepts, failed, slow };
}
