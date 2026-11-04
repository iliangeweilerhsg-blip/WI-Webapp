'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ApiRequestError } from './api.ts';

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Offline ist ein Normalzustand (R14): höchstens ein Wiederholungsversuch, nur bei Netzwerkfehlern und 5xx, nie bei 4xx
        retry: (count, error) =>
          count < 1 &&
          error instanceof ApiRequestError &&
          (error.kind === 'unreachable' || (error.kind === 'api' && (error.status ?? 0) >= 500)),
        refetchOnWindowFocus: false,
        staleTime: 30_000,
      },
    },
  });
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(makeQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
