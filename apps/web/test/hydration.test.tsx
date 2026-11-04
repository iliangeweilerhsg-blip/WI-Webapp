// Hydration (React #418): Waren Abfragen schon fertig, bevor ein Teil der Seite hydratisiert wurde, darf das
// nicht vom vorgerenderten HTML („lädt“) abweichen.
import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { act } from 'react';
import { waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('next/navigation', () => ({
  usePathname: () => '/einstellungen',
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ push: vi.fn() }),
}));

import { AppShell } from '../src/components/AppShell.tsx';
import { SettingsView } from '../src/components/SettingsView.tsx';
import { ThemeProvider } from '../src/lib/theme.tsx';
import { installFakeCore, makeModule, makeSemester } from './fake-core.ts';

const tree = (client: QueryClient) => (
  <ThemeProvider>
    <QueryClientProvider client={client}>
      <AppShell>
        <SettingsView />
      </AppShell>
    </QueryClientProvider>
  </ThemeProvider>
);

describe('Hydration', () => {
  it('Daten, die vor der Hydration schon da sind, führen nicht zu einem Mismatch', async () => {
    installFakeCore({ semesters: [makeSemester()], modules: [makeModule()] });
    const container = document.createElement('div');
    container.innerHTML = renderToString(tree(new QueryClient()));
    document.body.appendChild(container);

    const client = new QueryClient();
    client.setQueryData(['health'], { status: 'ok', db: 'ok', version: '1' });
    client.setQueryData(['semesters'], { items: [makeSemester()], next_cursor: null });
    client.setQueryData(['modules'], { items: [makeModule()], next_cursor: null });

    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args.map(String).join(' ').slice(0, 400));
    });
    await act(async () => {
      hydrateRoot(container, tree(client), {
        onRecoverableError: (e) => errors.push(String(e).slice(0, 400)),
      });
    });
    spy.mockRestore();
    expect(errors).toEqual([]);
    // Nach der Hydration zeigt die Seite die Daten
    await waitFor(() => expect(container.textContent).toContain('Core verbunden'));
  });
});
