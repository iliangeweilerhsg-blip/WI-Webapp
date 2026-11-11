// REST-Zugriff für Notizbücher, Seiten und Striche (docs/VERTRAEGE.md §7.4). Die Web-App liest nur, sie schreibt
// keine Striche (die kommen vom iPad über den Sync).
import {
  NotebookListSchema,
  NotebookPagesSchema,
  NotebookSchema,
  PageDetailSchema,
  PageStrokesSchema,
  StrokeSchema,
  type Notebook,
  type NotebookList,
  type NotebookPages,
  type PageDetail,
  type PageStrokes,
} from '@sg/shared';
import { apiGet, type Parser } from './api.ts';

/** `GET /notebooks?module_id` – Notizbücher eines Moduls (ohne gelöschte). */
export function fetchNotebooks(moduleId?: string, signal?: AbortSignal): Promise<NotebookList> {
  const query = moduleId ? `?module_id=${encodeURIComponent(moduleId)}` : '';
  return apiGet(`/notebooks${query}`, NotebookListSchema, { signal });
}

/** `GET /notebooks/{id}` – ein Notizbuch (404, wenn es gelöscht ist oder sein Modul). */
export function fetchNotebook(notebookId: string, signal?: AbortSignal): Promise<Notebook> {
  return apiGet(`/notebooks/${encodeURIComponent(notebookId)}`, NotebookSchema, { signal });
}

/**
 * `GET /sessions/{id}/notebook` – das Notizbuch der Session (#199, VERTRAEGE §7.2). Der Core entscheidet:
 * Übung und Tutorium zeigen „Übung“, alles andere „Vorlesung“.
 */
export function fetchSessionNotebook(sessionId: string, signal?: AbortSignal): Promise<Notebook> {
  return apiGet(`/sessions/${encodeURIComponent(sessionId)}/notebook`, NotebookSchema, { signal });
}

/** `GET /notebooks/{id}/pages` – Seiten nach `index`, mit `stream_seq`/`stream_op_id` für das Abonnement. */
export function fetchNotebookPages(notebookId: string, signal?: AbortSignal): Promise<NotebookPages> {
  return apiGet(`/notebooks/${encodeURIComponent(notebookId)}/pages`, NotebookPagesSchema, { signal });
}

/** `GET /pages/{id}` – Seite mit Elementen (nach `z` sortiert). */
export function fetchPageDetail(pageId: string, signal?: AbortSignal): Promise<PageDetail> {
  return apiGet(`/pages/${encodeURIComponent(pageId)}`, PageDetailSchema, { signal });
}

/**
 * Nachsichtige Prüfung von `PageStrokes`: Der Umschlag muss stimmen, ein einzelner Strich, der nicht zum Schema passt
 * (z. B. unbekannter Enum-Wert eines neueren Cores), wird übersprungen statt die ganze Seite zu verwerfen.
 */
export const LenientPageStrokesSchema: Parser<PageStrokes> = {
  safeParse(value) {
    const raw = value as { strokes?: unknown } | null;
    if (typeof raw !== 'object' || raw === null || !Array.isArray(raw.strokes)) {
      return PageStrokesSchema.safeParse(value);
    }
    const head = PageStrokesSchema.safeParse({ ...raw, strokes: [] });
    if (!head.success) return head;
    const strokes = raw.strokes.flatMap((s) => {
      const r = StrokeSchema.safeParse(s);
      return r.success ? [r.data] : [];
    });
    return { success: true, data: { ...head.data, strokes } };
  },
};

/** `GET /pages/{id}/strokes` – alle nicht gelöschten Striche der Seite (unbrauchbare Striche werden übersprungen). */
export function fetchPageStrokes(pageId: string, signal?: AbortSignal): Promise<PageStrokes> {
  return apiGet(`/pages/${encodeURIComponent(pageId)}/strokes`, LenientPageStrokesSchema, { signal });
}

/** Strom eines Notizbuchs (08 §2.2). */
export const notebookStream = (notebookId: string): string => `notebook:${notebookId}`;
