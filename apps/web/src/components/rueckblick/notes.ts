// Zuordnung von Notizseiten, Markern und Fotos zu Folien (VERTRAEGE §18.9) und der Einstieg beim Tipp auf einen Strich.
import type { Marker, Page, Photo, SlideSegment } from '@sg/shared';
import { NO_SLIDE, slideAt } from '../../lib/transcript.ts';

/** Wiedergabe beginnt so viel vor dem Strich (F-NAC-04), damit das Gesagte zum Strich noch zu hören ist */
export const PRE_ROLL_MS = 3_000;

/** Startposition (Sitzungszeit in ms) für einen Strich, einen Marker oder ein Foto bei `t`; nie unter 0 */
export const playbackStart = (tMs: number): number => Math.max(0, tMs - PRE_ROLL_MS);

/**
 * Sitzungszeit eines Markers oder Fotos nach Serveruhr (§9.3, #332): `t_session_ms` rechnet der Core mit dem
 * Geräteversatz aus `session.start_offsets` um. Fehlt es (älterer Core), gilt der Rohwert `t_ms`.
 */
export const sessionTimeOf = (item: { t_ms: number; t_session_ms?: number | undefined }): number =>
  item.t_session_ms ?? item.t_ms;

/**
 * Folie einer Notizseite: `attached_slide_id` (§18.9). Fehlt sie, gilt die Folie, die als Hintergrund liegt;
 * sonst „ohne Folie“.
 */
export function pageSlideKey(page: Pick<Page, 'attached_slide_id' | 'background_slide_id'>): string {
  return page.attached_slide_id ?? page.background_slide_id ?? NO_SLIDE;
}

export interface ReviewNotes {
  pages: Page[];
  markers: Marker[];
  photos: Photo[];
}

/**
 * Notizen, die zur Folie `selected` gehören. Marker und Fotos folgen ihrer Seite (`page_id`), sonst der Folie, die zu
 * ihrer Zeit lief (Sitzungszeit nach Serveruhr, `sessionTimeOf`). `selected = null` (Transkript ohne Folienzuordnung)
 * zeigt alles.
 */
export function notesForSlide(
  selected: string | null,
  all: { pages: readonly Page[]; markers: readonly Marker[]; photos: readonly Photo[] },
  segments: readonly SlideSegment[],
): ReviewNotes {
  const pageKey = new Map(all.pages.map((p) => [p.id, pageSlideKey(p)] as const));
  type Timed = { page_id: string | null; t_ms: number; t_session_ms?: number | undefined };
  const keyOf = (item: Timed): string =>
    (item.page_id !== null ? pageKey.get(item.page_id) : undefined) ??
    slideAt(segments, sessionTimeOf(item))?.slide_id ??
    NO_SLIDE;
  const pick = <T extends Timed & { deleted_at: unknown }>(items: readonly T[]): T[] =>
    items
      .filter((i) => i.deleted_at === null && (selected === null || keyOf(i) === selected))
      .sort((a, b) => sessionTimeOf(a) - sessionTimeOf(b));
  return {
    pages: all.pages.filter((p) => selected === null || pageSlideKey(p) === selected),
    markers: pick(all.markers),
    photos: pick(all.photos),
  };
}
