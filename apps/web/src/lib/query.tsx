'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ApiRequestError } from './api.ts';

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      // Die Web-App spricht nur mit dem lokalen Core. Meldet der Browser „offline“ (Hörsaal ohne WLAN), ist der Core
      // trotzdem erreichbar. Darum nie pausieren: Ist er wirklich weg, scheitert die Anfrage als `unreachable`.
      mutations: { networkMode: 'always' },
      queries: {
        networkMode: 'always',
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
