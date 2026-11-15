'use client';

// Karten verwalten (VERTRAEGE §21.14, F-LRN-16): Filter im URL-Query, Seiten über `next_cursor`, Massenaktionen.
// Keine Gesamtzahl und keine Rückstandszahl (LP9): Der Core liefert beides nicht.
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  CardBulkResultSchema,
  CardPageSchema,
  type Card,
  type CardBulkAction,
  type CardBulkResult,
  type CardListSort,
  type CardListStatus,
} from '@sg/shared';
import { apiGet, apiSend } from './api.ts';
import { CARDS_KEY } from './cards.ts';
import { useHydrated, useQueryParam } from './hydrated.ts';

export const CARD_LIST_PATH = '/lernen/karten';
/** Karten je Seite (Standard des Core, §21.14) */
export const CARD_PAGE_SIZE = 50;
/** Höchstens so viele Karten je Massenaktion (§21.14) */
export const BULK_MAX = 200;
/** Länge der Suche (§21.14) */
export const MAX_CARD_QUERY = 100;

export type CardKindFilter = 'basic' | 'cloze';
export type CardOriginFilter = 'ki' | 'manuell';

export interface CardFilters {
  module_id: string | null;
  concept_id: string | null;
  kind: CardKindFilter | null;
  origin: CardOriginFilter | null;
  status: CardListStatus;
  q: string;
  sort: CardListSort;
}

export const DEFAULT_FILTERS: CardFilters = {
  module_id: null,
  concept_id: null,
  kind: null,
  origin: null,
  status: 'alle',
  q: '',
  sort: 'neu',
};

export const STATUS_OPTIONS: readonly { value: CardListStatus; label: string }[] = [
  { value: 'alle', label: 'Alle' },
  { value: 'aktiv', label: 'Aktiv' },
  { value: 'pausiert', label: 'Pausiert' },
  { value: 'neu', label: 'Neu' },
  { value: 'schwer', label: 'Schwer' },
];

export const SORT_OPTIONS: readonly { value: CardListSort; label: string }[] = [
  { value: 'neu', label: 'Neueste' },
  { value: 'faellig', label: 'Fällig zuerst' },
  { value: 'schwer', label: 'Schwerste' },
];

export const KIND_OPTIONS: readonly { value: CardKindFilter; label: string }[] = [
  { value: 'basic', label: 'Frage und Antwort' },
  { value: 'cloze', label: 'Lückentext' },
];

export const ORIGIN_OPTIONS: readonly { value: CardOriginFilter; label: string }[] = [
  { value: 'ki', label: 'KI' },
  { value: 'manuell', label: 'Von Hand' },
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function pick<T extends string>(value: string | null, options: readonly { value: T }[]): T | null {
  return options.find((o) => o.value === value)?.value ?? null;
}

/** Filter aus den Parametern der Adresse; Unbekanntes fällt auf den Standard */
export function filtersFromParams(get: (name: string) => string | null): CardFilters {
  const id = (name: string) => {
    const value = get(name);
    return value !== null && UUID.test(value) ? value : null;
  };
  return {
    module_id: id('module_id'),
    concept_id: id('concept_id'),
    kind: pick(get('kind'), KIND_OPTIONS),
    origin: pick(get('origin'), ORIGIN_OPTIONS),
    status: pick(get('status'), STATUS_OPTIONS) ?? DEFAULT_FILTERS.status,
    q: (get('q') ?? '').trim().slice(0, MAX_CARD_QUERY),
    sort: pick(get('sort'), SORT_OPTIONS) ?? DEFAULT_FILTERS.sort,
  };
}

/** Query-Text der Adresse: nur, was vom Standard abweicht (teilbar und kurz) */
export function filtersToSearch(filters: CardFilters): string {
  const params = new URLSearchParams();
  if (filters.module_id) params.set('module_id', filters.module_id);
  if (filters.concept_id) params.set('concept_id', filters.concept_id);
  if (filters.kind) params.set('kind', filters.kind);
  if (filters.origin) params.set('origin', filters.origin);
  if (filters.status !== DEFAULT_FILTERS.status) params.set('status', filters.status);
  if (filters.q !== '') params.set('q', filters.q);
  if (filters.sort !== DEFAULT_FILTERS.sort) params.set('sort', filters.sort);
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}

/** Ziel „Karten verwalten“, optional mit Filtern (etwa für ein Konzept) */
export function cardListHref(filters: Partial<CardFilters> = {}): string {
  return `${CARD_LIST_PATH}${filtersToSearch({ ...DEFAULT_FILTERS, ...filters })}`;
}

/** Ist ein Filter gesetzt (die Sortierung zählt nicht)? */
export function hasActiveFilter(filters: CardFilters): boolean {
  return (
    filters.module_id !== null ||
    filters.concept_id !== null ||
    filters.kind !== null ||
    filters.origin !== null ||
    filters.status !== 'alle' ||
    filters.q !== ''
  );
}

/** Die Filter der Adresse (`?module_id=…`), reaktiv auch bei Zurück und Vorwärts */
export function useCardFilters(): CardFilters {
  const values: Record<string, string | null> = {
    module_id: useQueryParam('module_id'),
    concept_id: useQueryParam('concept_id'),
    kind: useQueryParam('kind'),
    origin: useQueryParam('origin'),
    status: useQueryParam('status'),
    q: useQueryParam('q'),
    sort: useQueryParam('sort'),
  };
  return filtersFromParams((name) => values[name] ?? null);
}

/**
 * Ändert die Filter in der Adresse. `push` legt einen Eintrag im Verlauf an (Zurück-Taste), `replace` ersetzt ihn
 * (Tippen in der Suche). Liest den aktuellen Stand aus der Adresse, nicht aus dem letzten Render.
 */
export function updateCardFilters(patch: Partial<CardFilters>, mode: 'push' | 'replace' = 'push'): void {
  const params = new URLSearchParams(window.location.search);
  const current = filtersFromParams((name) => params.get(name));
  const search = filtersToSearch({ ...current, ...patch });
  if (search === window.location.search) return;
  const url = `${window.location.pathname}${search}`;
  if (mode === 'push') window.history.pushState(window.history.state, '', url);
  else window.history.replaceState(window.history.state, '', url);
}

export const cardListKey = (filters: CardFilters) => [...CARDS_KEY, 'list', filters] as const;

/** Anfrage-Text für `GET /cards` (§21.14); Standardwerte bleiben weg */
export function cardListQuery(filters: CardFilters, cursor?: string): string {
  const params = new URLSearchParams();
  if (filters.module_id) params.set('module_id', filters.module_id);
  if (filters.concept_id) params.set('concept_id', filters.concept_id);
  if (filters.kind) params.append('kind', filters.kind);
  if (filters.origin) params.set('origin', filters.origin);
  if (filters.status !== 'alle') params.set('status', filters.status);
  if (filters.q !== '') params.set('q', filters.q);
  if (filters.sort !== 'neu') params.set('sort', filters.sort);
  params.set('limit', String(CARD_PAGE_SIZE));
  if (cursor) params.set('cursor', cursor);
  return params.toString();
}

/** `GET /cards`: seitenweise über den opaken `next_cursor`. Lädt erst, wenn die Adresse gelesen ist. */
export function useCardList(filters: CardFilters) {
  const hydrated = useHydrated();
  return useInfiniteQuery({
    queryKey: cardListKey(filters),
    enabled: hydrated,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      apiGet(`/cards?${cardListQuery(filters, pageParam)}`, CardPageSchema, { signal }),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  });
}

/** `POST /cards/bulk` (§21.14): alle Karten in einer Transaktion */
export function bulkCards(ids: readonly string[], action: CardBulkAction): Promise<CardBulkResult> {
  return apiSend('POST', '/cards/bulk', CardBulkResultSchema, { body: { ids: [...ids], action } });
}

/** Ab dieser Schwelle gilt eine Karte als „schwer“ (wie im Core, `learning/params.ts`, §21.14) */
const HARD_LAPSES = 3;
const HARD_DIFFICULTY = 7;

/** Schwer: nicht neu und oft vergessen oder hohe Schwierigkeit */
export function isHardCard(card: Pick<Card, 'state'>): boolean {
  const s = card.state;
  return s.state !== 'new' && (s.lapses >= HARD_LAPSES || s.difficulty >= HARD_DIFFICULTY);
}

/** Meldung nach einer Massenaktion, ruhig und ohne Rot: „3 pausiert · 2 unverändert“ */
export function bulkMessage(action: CardBulkAction, result: CardBulkResult): string {
  const verb = { suspend: 'pausiert', resume: 'fortgesetzt', delete: 'gelöscht' }[action];
  const unchanged = result.skipped.filter((s) => s.code === 'unchanged').length;
  const gone = result.skipped.filter((s) => s.code === 'card_not_found').length;
  const parts: string[] = [];
  if (result.changed.length > 0 || (unchanged === 0 && gone === 0)) {
    parts.push(`${result.changed.length} ${verb}`);
  }
  if (unchanged > 0) parts.push(`${unchanged} unverändert`);
  if (gone > 0) parts.push(`${gone} nicht mehr vorhanden`);
  return parts.join(' · ');
}
