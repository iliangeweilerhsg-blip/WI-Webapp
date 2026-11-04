'use client';

import { useQuery } from '@tanstack/react-query';
import { ModuleListSchema } from '@sg/shared';
import { apiGet } from './api.ts';

/** Module aus `GET /modules` (erste Seite; für die Navigation reichen 100). */
export function useModules() {
  return useQuery({
    queryKey: ['modules'],
    queryFn: ({ signal }) => apiGet('/modules?limit=100', ModuleListSchema, { signal }),
    select: (page) => page.items.filter((m) => m.deleted_at === null),
  });
}

/** CSS-Wert der Modulfarbe (`mod-03` → `var(--sg-mod-03)`). */
export function moduleColorVar(token: string): string {
  return `var(--sg-${token})`;
}
