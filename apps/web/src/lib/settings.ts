'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SettingsSchema, type Settings, type SettingsUpdate } from '@sg/shared';
import { apiGet, apiSend } from './api.ts';
import { useHydrationSafe } from './hydrated.ts';

export const SETTINGS_KEY = ['settings'] as const;

/** Globale Einstellungen aus `GET /settings` (VERTRAEGE §14.1), fehlende Werte sind vom Core aufgefüllt. */
export function useSettings() {
  const query = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: ({ signal }) => apiGet('/settings', SettingsSchema, { signal }),
  });
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
