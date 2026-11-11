'use client';

// KI-Status und Kosten (VERTRAEGE §20.5–§20.7): `GET /ai/status`, `GET /costs/summary`, Texte dazu.
import { useQuery } from '@tanstack/react-query';
import {
  AiStatusSchema,
  CostSummarySchema,
  type AiStatus,
  type AutoAcceptMode,
  type CostSummary,
} from '@sg/shared';
import { apiGet } from './api.ts';
import { useHydrationSafe } from './hydrated.ts';
import { STEP_LABELS } from './transcript.ts';

export const AI_STATUS_KEY = ['ai', 'status'] as const;
export const COSTS_KEY = ['ai', 'costs'] as const;

/** Bereich der Einstellungen (`/einstellungen?bereich=ki`) */
export const AI_SETTINGS_HREF = '/einstellungen?bereich=ki';

export function useAiStatus(options: { enabled?: boolean } = {}) {
  const query = useQuery({
    queryKey: AI_STATUS_KEY,
    enabled: options.enabled ?? true,
    queryFn: ({ signal }): Promise<AiStatus> => apiGet('/ai/status', AiStatusSchema, { signal }),
  });
  return useHydrationSafe(query);
}

/** Kosten des laufenden Monats (Ortszeit, bestimmt der Core) */
export function useCostSummary() {
  const query = useQuery({
    queryKey: COSTS_KEY,
    queryFn: ({ signal }): Promise<CostSummary> => apiGet('/costs/summary', CostSummarySchema, { signal }),
  });
  return useHydrationSafe(query);
}

/** Die KI ist erreichbar, aber nicht eingerichtet (Schlüssel fehlt o. Ä.). Unbekannt zählt nicht. */
export function aiNotConfigured(status: AiStatus | undefined | null): boolean {
  return status?.llm?.configured === false;
}

export type AiState = 'eingerichtet' | 'nicht_eingerichtet' | 'worker_aus' | 'unbekannt';

export function aiState(status: AiStatus): AiState {
  if (!status.worker_reachable) return 'worker_aus';
  if (status.llm === null) return 'unbekannt';
  return status.llm.configured ? 'eingerichtet' : 'nicht_eingerichtet';
}

/** Ein Satz, wie es geht (§20.10). Nie ein Eingabefeld für den Schlüssel. */
export function aiStateSentence(status: AiStatus): string {
  const state = aiState(status);
  if (state === 'eingerichtet') return 'Konzepte und Kurzfassungen entstehen nach jeder Vorlesung.';
  if (state === 'worker_aus') return 'Der Worker läuft gerade nicht. Der Stand der KI ist deshalb unbekannt.';
  if (state === 'unbekannt') return 'Der Worker meldet keinen Stand der KI. Aktualisiere ihn.';
  const issue = status.llm?.issue;
  if (issue === 'env_offen') {
    return 'Die Datei ~/StudienGehirn/config/.env ist für andere lesbar. Führe chmod 600 darauf aus und starte den Worker neu.';
  }
  if (issue === 'unbekannter_anbieter') {
    return 'Der eingestellte KI-Anbieter ist unbekannt. Prüfe ~/StudienGehirn/config/.env und starte den Worker neu.';
  }
  return 'Trage den Schlüssel in ~/StudienGehirn/config/.env ein, führe chmod 600 darauf aus und starte den Worker neu.';
}

export const AI_STATE_LABELS: Record<AiState, string> = {
  eingerichtet: 'Eingerichtet',
  nicht_eingerichtet: 'Nicht eingerichtet',
  worker_aus: 'Worker nicht erreichbar',
  unbekannt: 'Unbekannt',
};

export const AUTO_ACCEPT_OPTIONS: readonly { value: AutoAcceptMode; label: string }[] = [
  { value: 'aus', label: 'Aus: alles in die Inbox' },
  { value: 'nur_beziehungen', label: 'Nur Beziehungen' },
  { value: 'alles_ab_0_9', label: 'Alles ab 90 % Sicherheit' },
];

/** Hinweis bei `alles_ab_0_9` (§20.7) */
export const AUTO_ACCEPT_WARNING =
  'Die Sicherheit ist eine Selbstauskunft der KI und lässt sich durch das Material beeinflussen. Auch die Automatik legt nur an, was die Prüfungen besteht.';

const EUR = new Intl.NumberFormat('de-CH', { style: 'currency', currency: 'EUR' });

export function formatEur(value: number): string {
  return EUR.format(value);
}

const MONTH = new Intl.DateTimeFormat('de-CH', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** „November 2026“ aus `YYYY-MM` */
export function monthLabel(month: string): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? month : MONTH.format(date);
}

/** Anteil des Budgets, 0–100; ohne Budget 100, sobald etwas ausgegeben ist */
export function budgetPercent(spent: number, budget: number): number {
  if (budget <= 0) return spent > 0 ? 100 : 0;
  return Math.min(100, Math.max(0, Math.round((spent / budget) * 100)));
}

/** Name einer Aufgabe in der Kostenliste (Schritt der Kette, sonst der rohe Name) */
export function taskLabel(task: string): string {
  return (STEP_LABELS as Record<string, string>)[task] ?? task;
}

/** Monatsbudget aus dem Eingabefeld: 0–1 000 €, Komma oder Punkt, höchstens zwei Nachkommastellen */
export function parseBudget(text: string): number | null {
  const normalized = text.trim().replace(',', '.');
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(normalized)) return null;
  const value = Number(normalized);
  return value >= 0 && value <= 1000 ? value : null;
}
