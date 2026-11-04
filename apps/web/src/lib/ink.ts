// REST-Zugriff für Notizbücher, Seiten und Striche (docs/VERTRAEGE.md §7.4). Die Web-App liest nur, sie schreibt
// keine Striche (die kommen vom iPad über den Sync).
import {
  NotebookListSchema,
  NotebookPagesSchema,
  PageDetailSchema,
  PageStrokesSchema,
  type NotebookList,
  type NotebookPages,
  type PageDetail,
  type PageStrokes,
} from '@sg/shared';
import { apiGet } from './api.ts';

/** `GET /notebooks?module_id` – Notizbücher eines Moduls (ohne gelöschte). */
export function fetchNotebooks(moduleId?: string, signal?: AbortSignal): Promise<NotebookList> {
  const query = moduleId ? `?module_id=${encodeURIComponent(moduleId)}` : '';
  return apiGet(`/notebooks${query}`, NotebookListSchema, { signal });
}

/** `GET /notebooks/{id}/pages` – Seiten nach `index`, mit `stream_seq`/`stream_op_id` für das Abonnement. */
export function fetchNotebookPages(notebookId: string, signal?: AbortSignal): Promise<NotebookPages> {
  return apiGet(`/notebooks/${encodeURIComponent(notebookId)}/pages`, NotebookPagesSchema, { signal });
}

/** `GET /pages/{id}` – Seite mit Elementen (nach `z` sortiert). */
export function fetchPageDetail(pageId: string, signal?: AbortSignal): Promise<PageDetail> {
  return apiGet(`/pages/${encodeURIComponent(pageId)}`, PageDetailSchema, { signal });
}

/** `GET /pages/{id}/strokes` – alle nicht gelöschten Striche der Seite. */
export function fetchPageStrokes(pageId: string, signal?: AbortSignal): Promise<PageStrokes> {
  return apiGet(`/pages/${encodeURIComponent(pageId)}/strokes`, PageStrokesSchema, { signal });
}

/** Strom eines Notizbuchs (08 §2.2). */
export const notebookStream = (notebookId: string): string => `notebook:${notebookId}`;
