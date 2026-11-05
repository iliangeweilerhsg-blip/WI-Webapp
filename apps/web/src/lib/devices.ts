'use client';

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  ApiErrorSchema,
  DeviceListSchema,
  PairingCodeSchema,
  PairingRequestListSchema,
  type Device,
  type PairingCode,
  type PairingRequest,
} from '@sg/shared';
import { ApiRequestError, apiBase, apiGet, apiSend, friendlyMessage } from './api.ts';

export const DEVICES_KEY = ['devices'] as const;
export const PAIRING_REQUESTS_KEY = ['devices', 'pairing-requests'] as const;

/**
 * Zustand des Kopplungsfensters laut Core (Header `SG-Pairing-State` an `GET /devices/pairings/requests`,
 * VERTRAEGE §7.5/§12). `confirming`: ein richtiger Code wird gerade eingelöst, die Anzeige bleibt wie bei `open`
 * (#100). `unknown`: Header fehlt oder unbekannt (älterer bzw. neuerer Core).
 */
export type PairingState =
  | 'none'
  | 'open'
  | 'qr_only'
  | 'confirming'
  | 'expired'
  | 'paired'
  | 'closed_failures'
  | 'closed'
  | 'locked'
  | 'unknown';

const STATES: readonly PairingState[] = [
  'none',
  'open',
  'qr_only',
  'confirming',
  'expired',
  'paired',
  'closed_failures',
  'closed',
  'locked',
];

/** Geräte, die jünger sind, gelten in der Liste als „neu gekoppelt“ (Hinweis auf eine unbemerkte Übernahme) */
export const NEW_DEVICE_MS = 24 * 60 * 60 * 1000;

export function isNewDevice(device: Pick<Device, 'created_at'>, now: number = Date.now()): boolean {
  return now - Date.parse(device.created_at) < NEW_DEVICE_MS;
}

export interface PairingSnapshot {
  state: PairingState;
  /** `pairing_id` des Fensters, das der Core gerade kennt (zum Erkennen eines ersetzten Fensters) */
  pairingId: string | null;
  requests: PairingRequest[];
}

/** Freundliche Texte für die Fehler der Geräteverwaltung (VERTRAEGE §15) */
const MESSAGES: Record<string, string> = {
  device_not_found: 'Dieses Gerät ist schon entfernt.',
  pairing_request_not_found: 'Diese Anfrage gibt es nicht mehr.',
  local_only: 'Das geht nur am Mac selbst.',
};

export function devicesErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError && error.code && MESSAGES[error.code])
    return MESSAGES[error.code] ?? '';
  return friendlyMessage(error);
}

/** Gekoppelte Geräte (`GET /devices`, höchstens 200 – mehr hat niemand) */
export function useDevices(options: { refetchIntervalMs?: number | false } = {}) {
  return useQuery({
    queryKey: DEVICES_KEY,
    queryFn: async ({ signal }): Promise<Device[]> =>
      (await apiGet('/devices?limit=200', DeviceListSchema, { signal })).items,
    refetchInterval: options.refetchIntervalMs ?? false,
  });
}

/** `DELETE /devices/{id}`: Token sofort ungültig, das Gerät muss neu gekoppelt werden */
export function useRemoveDevice() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiSend('DELETE', `/devices/${encodeURIComponent(id)}`, null),
    onSuccess: (_result, id) => {
      client.setQueryData<Device[]>(DEVICES_KEY, (list) => list?.filter((d) => d.id !== id));
      void client.invalidateQueries({ queryKey: DEVICES_KEY, exact: true });
    },
  });
}

/** `POST /devices/pairings`: öffnet ein neues Kopplungsfenster (ersetzt ein altes) */
export function useOpenPairing() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (): Promise<PairingCode> => apiSend('POST', '/devices/pairings', PairingCodeSchema),
    onSuccess: () => void client.invalidateQueries({ queryKey: PAIRING_REQUESTS_KEY }),
  });
}

/**
 * `DELETE /devices/pairings?pairing_id=…`: schließt genau dieses Kopplungsfenster sofort (idempotent; ein
 * anderswo neu geöffnetes Fenster bleibt offen). `keepalive`, damit es auch beim Verlassen der Seite ankommt.
 */
export function closePairingWindow(pairingId: string): Promise<void> {
  return apiSend('DELETE', `/devices/pairings?pairing_id=${encodeURIComponent(pairingId)}`, null, {
    keepalive: true,
  });
}

/** Gerät entfernen ohne Hook (z. B. aus einem Toast, dessen Ansicht schon geschlossen ist) */
export async function removeDeviceNow(client: QueryClient, id: string): Promise<void> {
  await apiSend('DELETE', `/devices/${encodeURIComponent(id)}`, null);
  client.setQueryData<Device[]>(DEVICES_KEY, (list) => list?.filter((d) => d.id !== id));
  void client.invalidateQueries({ queryKey: DEVICES_KEY, exact: true });
}

/** `DELETE /devices/pairings/requests/{id}`: eine fremde Anfrage ablehnen */
export function useRejectRequest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (requestId: string) =>
      apiSend('DELETE', `/devices/pairings/requests/${encodeURIComponent(requestId)}`, null),
    onSuccess: (_result, requestId) => {
      client.setQueryData<PairingSnapshot>(PAIRING_REQUESTS_KEY, (snap) =>
        snap ? { ...snap, requests: snap.requests.filter((r) => r.request_id !== requestId) } : snap,
      );
    },
  });
}

/**
 * Offene Anfragen und Zustand des Fensters (`GET /devices/pairings/requests` mit den Headern
 * `SG-Pairing-State` und `SG-Pairing-Id`). Eigener `fetch`, weil `apiGet` keine Header liefert.
 */
export async function fetchPairingSnapshot(signal?: AbortSignal): Promise<PairingSnapshot> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/devices/pairings/requests`, {
      headers: { Accept: 'application/json' },
      signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiRequestError({
      kind: 'unreachable',
      message: `Core nicht erreichbar: ${String(cause)}`,
      userMessage: 'Core nicht erreichbar',
    });
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // unten als ungültig gemeldet
  }
  if (!res.ok) {
    const parsed = ApiErrorSchema.safeParse(body);
    const code = parsed.success ? parsed.data.error.code : null;
    throw new ApiRequestError({
      kind: 'api',
      status: res.status,
      code,
      message: code ?? `HTTP ${res.status}`,
      userMessage: code && MESSAGES[code] ? (MESSAGES[code] ?? '') : 'Die Anfragen ließen sich nicht laden.',
    });
  }
  const parsed = PairingRequestListSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiRequestError({
      kind: 'invalid',
      status: res.status,
      message: `Antwort passt nicht zum Schema: ${parsed.error.message}`,
      userMessage: 'Der Core hat unerwartet geantwortet.',
    });
  }
  const rawState = res.headers.get('sg-pairing-state') ?? '';
  const state = (STATES as readonly string[]).includes(rawState) ? (rawState as PairingState) : 'unknown';
  return { state, pairingId: res.headers.get('sg-pairing-id'), requests: parsed.data.items };
}

/** Fragt den Zustand ab, solange `enabled` (Kopplungsfenster sichtbar), alle `intervalMs` */
export function usePairingSnapshot(enabled: boolean, intervalMs = 2_000) {
  return useQuery({
    queryKey: PAIRING_REQUESTS_KEY,
    queryFn: ({ signal }) => fetchPairingSnapshot(signal),
    enabled,
    refetchInterval: enabled ? intervalMs : false,
    staleTime: 0,
  });
}

/** Code für die Anzeige: „482 913“ */
export function groupCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

/** Restzeit „4:05“ */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Ansage für Screenreader, sparsam (07 §9): nur bei vollen Minuten, bei 30 s und beim Ablauf. Sonst `null`
 * (die Ansage bleibt dann unverändert und wird nicht wiederholt).
 */
export function remainingAnnouncement(ms: number): string | null {
  const total = Math.max(0, Math.ceil(ms / 1000));
  if (total === 0) return 'Der Code ist abgelaufen.';
  if (total === 30) return 'Der Code gilt noch 30 Sekunden.';
  if (total % 60 === 0) {
    const minutes = total / 60;
    return minutes === 1 ? 'Der Code gilt noch 1 Minute.' : `Der Code gilt noch ${minutes} Minuten.`;
  }
  return null;
}

const relative = new Intl.RelativeTimeFormat('de', { numeric: 'auto' });
const absolute = new Intl.DateTimeFormat('de-CH', { dateStyle: 'medium', timeStyle: 'short' });

/** „vor 3 Minuten“, „gerade eben“, „gestern“ … */
export function formatLastSeen(iso: string | null, now: number = Date.now()): string {
  if (!iso) return 'noch nie';
  const diff = Date.parse(iso) - now;
  const abs = Math.abs(diff);
  if (abs < 60_000) return 'gerade eben';
  if (abs < 3_600_000) return relative.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86_400_000) return relative.format(Math.round(diff / 3_600_000), 'hour');
  if (abs < 30 * 86_400_000) return relative.format(Math.round(diff / 86_400_000), 'day');
  return absolute.format(new Date(iso));
}

export function formatAbsolute(iso: string): string {
  return absolute.format(new Date(iso));
}
