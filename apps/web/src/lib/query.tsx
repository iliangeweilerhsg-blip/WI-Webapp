'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ApiRequestError } from './api.ts';

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Offline ist ein Normalzustand (R14): nicht hämmern, nur bei Serverfehlern einmal wiederholen
        retry: (count, error) => !(error instanceof ApiRequestError && error.kind !== 'api') && count < 1,
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
