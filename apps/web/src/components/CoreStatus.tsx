'use client';

import { useQuery } from '@tanstack/react-query';
import { HealthSchema } from '@sg/shared';
import { apiGet } from '../lib/api.ts';

/** Verbindungsstatus zum Core: grauer Punkt + Kurztext, nie blockierend (07 §6, R3, R14). */
export function useCoreHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => apiGet('/health', HealthSchema, { signal }),
    refetchInterval: 30_000,
  });
}

export function CoreStatus({ collapsed }: { collapsed: boolean }) {
  const health = useCoreHealth();
  const ok = health.data?.status === 'ok' && health.data.db === 'ok';
  const text = health.isPending
    ? 'Verbinde …'
    : ok
      ? 'Core verbunden'
      : health.isError
        ? 'Core nicht erreichbar'
        : 'Datenbank nicht bereit';

  return (
    <div role="status" className="flex items-center gap-2 px-3 py-1.5 text-xs text-text-muted" title={text}>
      <span
        aria-hidden="true"
        className={`size-2 shrink-0 rounded-full ${ok ? 'bg-text-muted' : 'border border-border-strong'}`}
      />
      {collapsed ? <span className="sr-only">{text}</span> : <span>{text}</span>}
    </div>
  );
}
