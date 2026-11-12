'use client';

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { SettingsSchema, type Settings, type SettingsUpdate } from '@sg/shared';
import { apiGet, apiSend } from './api.ts';
import { useHydrationSafe } from './hydrated.ts';

export const SETTINGS_KEY = ['settings'] as const;

const settingsQuery = {
  queryKey: SETTINGS_KEY,
  queryFn: ({ signal }: { signal: AbortSignal }) => apiGet('/settings', SettingsSchema, { signal }),
};

/** Globale Einstellungen aus `GET /settings` (VERTRAEGE §14.1), fehlende Werte sind vom Core aufgefüllt. */
export function useSettings() {
  const query = useQuery(settingsQuery);
  // Bis zur Hydration wie im vorgerenderten HTML „lädt“ (siehe hydrated.ts)
  return useHydrationSafe(query);
}

/** `PATCH /settings`: Der Core führt Feld für Feld zusammen und liefert den ganzen neuen Stand. */
export function useUpdateSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: SettingsUpdate) => apiSend('PATCH', '/settings', SettingsSchema, { body: patch }),
    onSuccess: (settings: Settings) => client.setQueryData(SETTINGS_KEY, settings),
  });
}

/** So lange wartet die Aufnahme höchstens auf `GET /settings`, danach nimmt sie das Standardmikrofon */
export const MICROPHONE_SETTINGS_WAIT_MS = 1000;

/**
 * Gewähltes Mikrofon (`lecture.microphone_id`) für den Recorder: aus dem Cache, sonst `GET /settings`. Die Aufnahme
 * wartet nie lange darauf: Ist der Core nicht erreichbar oder antwortet er nicht binnen `waitMs`, `null`
 * (Standardmikrofon).
 */
export async function readMicrophoneId(
  client: QueryClient,
  waitMs: number = MICROPHONE_SETTINGS_WAIT_MS,
): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const giveUp = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), waitMs);
  });
  const read = client
    .ensureQueryData({ ...settingsQuery, revalidateIfStale: true })
    .then((settings) => settings.lecture.microphone_id)
    .catch(() => null);
  try {
    return await Promise.race([read, giveUp]);
  } finally {
    clearTimeout(timer);
  }
}
