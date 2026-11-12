// Suche (⌘K, VERTRAEGE §19.6/§19.7): API-Aufruf, Gruppierung und Ziele. Reine Funktionen, die Oberfläche steht unter
// `components/search`.
import {
  SearchResponseSchema,
  type SearchHit,
  type SearchHitSlide,
  type SearchHitTranscript,
  type SearchResponse,
} from '@sg/shared';
import type { ConceptListItem } from '@sg/shared';
import { apiGet } from './api.ts';
import { conceptHref, fetchConcepts, MAX_CONCEPT_QUERY } from './concepts.ts';
import { documentHref, formatDate } from './material.ts';

/** Die Web-App fragt immer mit 50, damit viele Folientreffer das Gesagte nicht verdrängen (§19.7) */
export const SEARCH_LIMIT = 50;
/** Höchstens so viele Treffer je Gruppe (§19.7) */
export const GROUP_LIMIT = 8;
/** Wartezeit nach dem letzten Tastendruck */
export const SEARCH_DEBOUNCE_MS = 120;
/** Erst danach erscheint ein Ladehinweis */
export const SLOW_HINT_MS = 300;
/** Längere Anfragen lehnt der Core ab (§19.6) */
export const MAX_QUERY_LENGTH = 200;

/** `GET /search`. `q` bleibt unverändert, ein Leerzeichen am Ende ändert die Anfrage (kein Präfix auf dem letzten Wort). */
export function fetchSearch(q: string, signal?: AbortSignal): Promise<SearchResponse> {
  const params = new URLSearchParams({ q, limit: String(SEARCH_LIMIT) });
  return apiGet(`/search?${params.toString()}`, SearchResponseSchema, { signal });
}

/** Höchstens so viele Konzepte in ⌘K (UX-309) */
export const CONCEPT_LIMIT = 5;

/** Ein Präfix wie `fach:DBS` oder `typ:folie` richtet sich an die Folien- und Transkriptsuche, nicht an Konzepte */
const FILTER_PREFIX_RE = /(^|\s)[\p{L}]+:\S/u;

/**
 * Konzepte nach Name und Alias (UX-309): kleiner zweiter Aufruf an `GET /concepts?q=`, der Such-Vertrag (§19.6) bleibt
 * unverändert, das iPad sieht nichts davon. Mit Filterpräfix oder leerer Anfrage gibt es keinen Aufruf.
 */
export async function fetchConceptHits(q: string, signal?: AbortSignal): Promise<ConceptListItem[]> {
  const text = q.trim().slice(0, MAX_CONCEPT_QUERY).trim();
  if (text === '' || FILTER_PREFIX_RE.test(text)) return [];
  return fetchConcepts({ q: text, limit: CONCEPT_LIMIT }, signal);
}

/** Ziel eines Konzepttreffers: die Konzeptseite in der Bibliothek */
export function conceptHitHref(item: ConceptListItem): string {
  return conceptHref(item.concept.id);
}

/** „DBS, MA“; ohne Modul leer */
export function conceptModulesLabel(item: ConceptListItem): string {
  return item.modules.map((m) => m.short_name ?? m.name).join(', ');
}

export type SlideHit = SearchHitSlide;
export type SpokenHit = SearchHitTranscript;

export interface HitGroups {
  slides: SlideHit[];
  spoken: SpokenHit[];
}

/** Nach `score` absteigend (stabil), je Gruppe höchstens `GROUP_LIMIT` */
export function groupHits(hits: readonly SearchHit[]): HitGroups {
  const byScore = <T extends SearchHit>(list: T[]) =>
    list
      .map((hit, i) => ({ hit, i }))
      .sort((a, b) => b.hit.score - a.hit.score || a.i - b.i)
      .slice(0, GROUP_LIMIT)
      .map((x) => x.hit);
  return {
    slides: byScore(hits.filter((h): h is SlideHit => h.kind === 'slide')),
    spoken: byScore(hits.filter((h): h is SpokenHit => h.kind === 'transcript')),
  };
}

/** Anzeigereihenfolge über alle Gruppen: erst Folien, dann Gesagtes */
export function flatHits(groups: HitGroups): SearchHit[] {
  return [...groups.slides, ...groups.spoken];
}

/** Ziel eines Treffers (§19.7) */
export function hitHref(hit: SearchHit): string {
  if (hit.kind === 'slide') return documentHref('folien', hit.deck_id, hit.slide_index);
  return `/rueckblick?id=${encodeURIComponent(hit.session_id)}&t=${Math.max(0, Math.round(hit.t_ms))}`;
}

/** Sitzungszeit als `mm:ss`; ab einer Stunde zählen die Minuten weiter (`83:20`) */
export function formatMmSs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** „VL 7 · Titel“; fehlt beides, das Datum der Session, sonst „Vorlesung“ */
export function sessionLabel(hit: SpokenHit): string {
  const parts = [
    hit.session_number !== null ? `VL ${hit.session_number}` : null,
    hit.session_title?.trim() ? hit.session_title.trim() : null,
  ].filter((p): p is string => p !== null);
  if (parts.length > 0) return parts.join(' · ');
  const date = hit.session_started_at ? formatDate(hit.session_started_at) : '';
  return date || 'Vorlesung';
}

/** „Foliensatz · Folie n · Titel“; leere Teile entfallen */
export function slideLabel(hit: SlideHit): string {
  return [hit.deck_title.trim(), `Folie ${hit.slide_index}`, hit.slide_title?.trim() ?? '']
    .filter((p) => p !== '')
    .join(' · ');
}

/** Ruhige Zeile bei reiner Wortsuche (§19.7); sonst `null` */
export function degradedLine(response: SearchResponse): string | null {
  if (response.mode !== 'text' || response.degraded === null) return null;
  return response.degraded === 'embedder_not_ready'
    ? 'Nur Wortsuche · Bedeutungssuche startet noch'
    : 'Nur Wortsuche · Bedeutungssuche nicht verfügbar';
}

/** Query-Parameter `t` des Rückblicks (Sitzungszeit in ms): nur ganze Zahlen ≥ 0, sonst `null` */
export function parseJumpMs(raw: string | null): number | null {
  if (raw === null || !/^\d{1,12}$/.test(raw)) return null;
  return Number(raw);
}

/** Ereignis auf `window`: Die Suche öffnet das Ziel, auf dem der Rückblick schon steht (`detail.t` in ms) */
export const JUMP_EVENT = 'sg:review-jump';
