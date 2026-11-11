'use client';

// Konzepte (VERTRAEGE §20.6, §20.10): Abfragen, Ziele und Texte. Alle Texte der KI (Namen, One-Liner, Sätze) werden
// als reiner Text dargestellt, nie als Markdown oder HTML.
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import {
  ConceptDetailSchema,
  ConceptListSchema,
  SessionConceptsSchema,
  SessionSummaryViewSchema,
  type ConceptDetail,
  type ConceptKind,
  type ConceptListItem,
  type ConceptRelationKind,
  type ConceptRelationView,
  type EvidenceRef,
  type PipelineStep,
  type Session,
  type SessionConceptItem,
  type SessionConcepts,
  type SessionRef,
  type SessionSummaryView,
} from '@sg/shared';
import { apiGet } from './api.ts';
import { useHydrationSafe } from './hydrated.ts';
import { documentHref, formatDate } from './material.ts';
import { formatMmSs } from './search.ts';

/** Schritte der Kette, die Konzepte und Kurzfassung erzeugen (§20.2) */
export const CONCEPT_STEPS: readonly PipelineStep[] = [
  'concepts.extract',
  'concepts.resolve',
  'summary.write',
];

export const KIND_LABELS: Record<ConceptKind, string> = {
  definition: 'Definition',
  verfahren: 'Verfahren',
  modell: 'Modell',
  satz: 'Satz',
  beispiel: 'Beispiel',
};

export const RELATION_LABELS: Record<ConceptRelationKind, string> = {
  baut_auf: 'baut auf',
  beispiel_fuer: 'Beispiel für',
  gegensatz: 'Gegensatz',
  angewendet_in: 'angewendet in',
  verwandt: 'verwandt',
};

export const RELATION_KINDS = Object.keys(RELATION_LABELS) as ConceptRelationKind[];
export const CONCEPT_KINDS = Object.keys(KIND_LABELS) as ConceptKind[];

/** „A baut auf B auf“ (§20.10) */
export function relationSentence(kind: ConceptRelationKind, from: string, to: string): string {
  switch (kind) {
    case 'baut_auf':
      return `${from} baut auf ${to} auf`;
    case 'beispiel_fuer':
      return `${from} ist ein Beispiel für ${to}`;
    case 'gegensatz':
      return `${from} ist ein Gegensatz zu ${to}`;
    case 'angewendet_in':
      return `${from} wird angewendet in ${to}`;
    case 'verwandt':
      return `${from} ist verwandt mit ${to}`;
  }
}

/** Überschrift einer Gruppe von Beziehungen in der Konzeptansicht, nach Art und Richtung */
export function relationGroupLabel(
  kind: ConceptRelationKind,
  direction: ConceptRelationView['direction'],
): string {
  const out = direction === 'ausgehend';
  switch (kind) {
    case 'baut_auf':
      return out ? 'Baut auf' : 'Grundlage für';
    case 'beispiel_fuer':
      return out ? 'Beispiel für' : 'Beispiele';
    case 'angewendet_in':
      return out ? 'Angewendet in' : 'Anwendungen';
    case 'gegensatz':
      return 'Gegensatz zu';
    case 'verwandt':
      return 'Verwandt mit';
  }
}

export interface RelationGroup {
  key: string;
  label: string;
  relations: ConceptRelationView[];
}

/** Beziehungen nach Art und Richtung; symmetrische Arten bilden eine Gruppe */
export function groupRelations(relations: readonly ConceptRelationView[]): RelationGroup[] {
  const groups = new Map<string, RelationGroup>();
  for (const kind of RELATION_KINDS) {
    for (const direction of ['ausgehend', 'eingehend'] as const) {
      const label = relationGroupLabel(kind, direction);
      const list = relations.filter((r) => r.kind === kind && r.direction === direction);
      if (list.length === 0) continue;
      const group = groups.get(label) ?? { key: `${kind}-${direction}`, label, relations: [] };
      group.relations.push(...list);
      groups.set(label, group);
    }
  }
  return [...groups.values()];
}

export function conceptHref(id: string): string {
  return `/bibliothek?konzept=${encodeURIComponent(id)}`;
}

/** Ziel eines Belegs: Folie in der PDF-Anzeige, Zeit im Rückblick (`t` wie in der Suche, §19.7) */
export function evidenceHref(ref: EvidenceRef): string {
  if (ref.kind === 'slide') return documentHref('folien', ref.deck_id, ref.slide_index);
  return `/rueckblick?id=${encodeURIComponent(ref.session_id)}&t=${Math.max(0, Math.round(ref.t_start_ms))}`;
}

/** Quellen-Chip: „F 14“ bzw. „42:12“ */
export function evidenceChip(ref: EvidenceRef): string {
  return ref.kind === 'slide' ? `F ${ref.slide_index}` : formatMmSs(ref.t_start_ms);
}

/** Ausgeschrieben für Screenreader */
export function evidenceSpoken(ref: EvidenceRef): string {
  return ref.kind === 'slide' ? `Folie ${ref.slide_index}` : `Aufnahme ab ${formatMmSs(ref.t_start_ms)}`;
}

/** „VL 7 · Titel · Modul“; fehlt alles, das Datum */
export function sessionRefLabel(session: SessionRef | null, withModule = true): string {
  if (!session) return 'Ohne Vorlesung';
  const parts = [
    session.number !== null ? `VL ${session.number}` : null,
    session.title?.trim() || null,
    withModule ? session.module.short_name?.trim() || session.module.name : null,
  ].filter((p): p is string => p !== null);
  if (session.number === null && !session.title?.trim() && session.started_at) {
    parts.unshift(formatDate(session.started_at));
  }
  return parts.join(' · ') || 'Vorlesung';
}

// ---------------------------------------------------------------------------------------------
// Abfragen
// ---------------------------------------------------------------------------------------------

/** Höchstens so viele Seiten je Liste (200 je Seite) */
const MAX_PAGES = 10;

export interface ConceptQuery {
  moduleId?: string;
  status?: 'aktiv' | 'vorschlag' | 'alle';
  q?: string;
  limit?: number;
}

/** `GET /concepts`: alle Seiten (bis `limit` gesetzt ist, dann nur die erste) */
export async function fetchConcepts(
  query: ConceptQuery = {},
  signal?: AbortSignal,
): Promise<ConceptListItem[]> {
  const items: ConceptListItem[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = new URLSearchParams({ limit: String(query.limit ?? 200) });
    if (query.moduleId) params.set('module_id', query.moduleId);
    if (query.status) params.set('status', query.status);
    if (query.q) params.set('q', query.q);
    if (cursor) params.set('cursor', cursor);
    const list = await apiGet(`/concepts?${params.toString()}`, ConceptListSchema, { signal });
    items.push(...list.items);
    cursor = list.next_cursor;
    if (!cursor || query.limit !== undefined) break;
  }
  return items;
}

export const CONCEPTS_KEY = ['concepts'] as const;
export const conceptKey = (id: string) => ['concepts', 'detail', id] as const;
export const sessionConceptsKey = (sessionId: string) => ['concepts', 'session', sessionId] as const;
export const summaryKey = (sessionId: string) => ['session-summary', sessionId] as const;

/** Höchstlänge von `q` (§20.6) */
export const MAX_CONCEPT_QUERY = 100;

/** `keepPrevious`: beim Tippen bleibt die alte Liste stehen, bis die neue da ist (kein Flackern) */
export function useConcepts(
  query: ConceptQuery,
  options: { enabled?: boolean; keepPrevious?: boolean } = {},
) {
  const q = query.q?.trim().slice(0, MAX_CONCEPT_QUERY) ?? '';
  const result = useQuery({
    queryKey: [...CONCEPTS_KEY, 'list', query.moduleId ?? '', query.status ?? 'aktiv', q, query.limit ?? 0],
    enabled: options.enabled ?? true,
    ...(options.keepPrevious ? { placeholderData: keepPreviousData } : {}),
    queryFn: ({ signal }) =>
      fetchConcepts({ ...query, ...(q ? { q } : { q: undefined }) } as ConceptQuery, signal),
  });
  return useHydrationSafe(result);
}

export function fetchConcept(id: string, signal?: AbortSignal): Promise<ConceptDetail> {
  return apiGet(`/concepts/${encodeURIComponent(id)}`, ConceptDetailSchema, { signal });
}

export function useConceptDetail(id: string | null) {
  const query = useQuery({
    queryKey: conceptKey(id ?? ''),
    enabled: id !== null,
    queryFn: ({ signal }) => fetchConcept(id ?? '', signal),
  });
  return useHydrationSafe(query);
}

/** Lädt neu, sobald einer der Schritte auf `fertig` wechselt (wie `useTranscript`, §18.7) */
function useRefetchOnStep(
  processing: Session['processing'] | undefined,
  steps: readonly PipelineStep[],
  queryKey: readonly unknown[],
  enabled: boolean,
) {
  const client = useQueryClient();
  const previous = useRef(processing);
  const keyText = JSON.stringify(queryKey);
  useEffect(() => {
    const before = previous.current;
    previous.current = processing;
    if (!enabled || !before || !processing) return;
    const finished = steps.some((step) => before[step] !== 'fertig' && processing[step] === 'fertig');
    if (finished) void client.invalidateQueries({ queryKey: JSON.parse(keyText) as unknown[] });
  }, [processing, steps, keyText, enabled, client]);
}

const RESOLVE_STEP: readonly PipelineStep[] = ['concepts.resolve'];
const SUMMARY_STEP: readonly PipelineStep[] = ['summary.write'];

/** `GET /sessions/{id}/concepts` */
export function useSessionConcepts(
  sessionId: string,
  processing: Session['processing'] | undefined,
  enabled: boolean,
) {
  const query = useQuery({
    queryKey: sessionConceptsKey(sessionId),
    enabled,
    queryFn: ({ signal }): Promise<SessionConcepts> =>
      apiGet(`/sessions/${encodeURIComponent(sessionId)}/concepts`, SessionConceptsSchema, { signal }),
  });
  useRefetchOnStep(processing, RESOLVE_STEP, sessionConceptsKey(sessionId), enabled);
  return useHydrationSafe(query);
}

/** `GET /sessions/{id}/summary` (`summary: null`, wenn es keine gibt) */
export function useSessionSummary(
  sessionId: string,
  processing: Session['processing'] | undefined,
  enabled: boolean,
) {
  const query = useQuery({
    queryKey: summaryKey(sessionId),
    enabled,
    queryFn: ({ signal }): Promise<SessionSummaryView> =>
      apiGet(`/sessions/${encodeURIComponent(sessionId)}/summary`, SessionSummaryViewSchema, { signal }),
  });
  useRefetchOnStep(processing, SUMMARY_STEP, summaryKey(sessionId), enabled);
  return useHydrationSafe(query);
}

/** Konzepte der gewählten Folie zuerst, sonst die Reihenfolge des Core (§20.10) */
export function orderForSlide(
  items: readonly SessionConceptItem[],
  slideId: string | null,
): SessionConceptItem[] {
  if (slideId === null) return [...items];
  const onSlide = (item: SessionConceptItem) =>
    item.evidence.some((e) => e.ref.kind === 'slide' && e.ref.slide_id === slideId);
  return [...items.filter(onSlide), ...items.filter((item) => !onSlide(item))];
}

// ---------------------------------------------------------------------------------------------
// Bibliothek: Gruppen je Modul
// ---------------------------------------------------------------------------------------------

export interface ConceptGroup {
  /** Modul-ID oder `''` für „Ohne Fach“ */
  id: string;
  name: string;
  items: ConceptListItem[];
}

/** Je Modul eine Gruppe (ein Konzept mit zwei Fächern steht in beiden), am Ende „Ohne Fach“ */
export function groupByModule(items: readonly ConceptListItem[]): ConceptGroup[] {
  const groups = new Map<string, ConceptGroup>();
  const without: ConceptListItem[] = [];
  for (const item of items) {
    if (item.modules.length === 0) without.push(item);
    for (const module of item.modules) {
      const group = groups.get(module.id) ?? { id: module.id, name: module.name, items: [] };
      group.items.push(item);
      groups.set(module.id, group);
    }
  }
  const sorted = [...groups.values()].sort(
    (a, b) => a.name.localeCompare(b.name, 'de') || a.id.localeCompare(b.id),
  );
  return without.length > 0 ? [...sorted, { id: '', name: 'Ohne Fach', items: without }] : sorted;
}
