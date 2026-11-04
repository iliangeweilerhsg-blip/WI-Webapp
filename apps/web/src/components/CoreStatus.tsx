'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { HealthSchema } from '@sg/shared';
import { apiGet } from '../lib/api.ts';
import { useHydrationSafe } from '../lib/hydrated.ts';

/** Verbindungsstatus zum Core. Fällt bei Fehler auf Wiederholen alle 30 s, Erholung lädt fehlgeschlagene Abfragen neu. */
export function useCoreHealth() {
  const client = useQueryClient();
  const health = useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => apiGet('/health', HealthSchema, { signal }),
    refetchInterval: 30_000,
  });

  // Erholung: Wechsel von Fehler zu Erfolg -> alle fehlgeschlagenen Abfragen neu laden (Modulliste, Seiten)
  const previous = useRef(health.status);
  useEffect(() => {
    if (previous.current === 'error' && health.status === 'success') {
      void client.invalidateQueries({ predicate: (q) => q.state.status === 'error' });
    }
    previous.current = health.status;
  }, [health.status, client]);

  return useHydrationSafe(health);
}

/** Nur wenn die letzte Abfrage gelungen ist. TanStack behält `data` auch nach einem Fehler, deshalb zuerst `isError`. */
export function statusText(health: ReturnType<typeof useCoreHealth>): { ok: boolean; text: string } {
  if (health.isError) return { ok: false, text: 'Core nicht erreichbar' };
  if (health.isPending) return { ok: false, text: 'Verbinde …' };
  if (health.data.status === 'ok' && health.data.db === 'ok') return { ok: true, text: 'Core verbunden' };
  return { ok: false, text: 'Datenbank nicht bereit' };
}

/** Grauer Punkt + Kurztext, nie blockierend (07 §6, R3, R14). */
export function CoreStatus() {
  const { ok, text } = statusText(useCoreHealth());

  return (
    <div
      role="status"
      aria-label={text}
      className="flex items-center gap-2 px-3 py-2 text-xs text-text-muted"
      title={text}
    >
      <span
        aria-hidden="true"
        className={`size-2 shrink-0 rounded-full ${ok ? 'bg-text-muted' : 'border border-border-strong'}`}
      />
      <span className="sg-collapsible">{text}</span>
    </div>
  );
}
