import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

import { AppShell } from '../src/components/AppShell.tsx';
import { ModulView } from '../src/components/ModulView.tsx';
import { makeQueryClient } from '../src/lib/query.tsx';
import { ThemeProvider } from '../src/lib/theme.tsx';

const MODULE = {
  id: '0190f6a2-0000-7000-8000-0000000000a1',
  user_id: '0190f6a2-0000-7000-8000-000000000000',
  created_at: '2026-11-04T08:00:00Z',
  updated_at: '2026-11-04T08:00:00Z',
  deleted_at: null,
  semester_id: '0190f6a2-0000-7000-8000-0000000000b1',
  name: 'Datenbanksysteme',
  short_name: 'DBS',
  color: 'mod-03',
  ects: 6,
  exam_type: 'Klausur',
  lecturer: null,
  lang: 'de',
  description_md: null,
};

/** Schaltbarer Fake-Core */
function fakeCore(initiallyUp: boolean) {
  const state = { up: initiallyUp };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (!state.up) throw new TypeError('Failed to fetch');
      const body = String(url).includes('/health')
        ? { status: 'ok', db: 'ok', version: '0.0.0' }
        : { items: [MODULE], next_cursor: null };
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
  return state;
}

function mount() {
  const client = makeQueryClient();
  client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retryDelay: 0 } });
  render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <AppShell>
          <p>Inhalt</p>
        </AppShell>
      </QueryClientProvider>
    </ThemeProvider>,
  );
  return client;
}

const status = () => screen.getByRole('status', { name: /Core|Verbinde|Datenbank/ });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Core-Status', () => {
  it('Ausfall nach Erfolg zeigt „Core nicht erreichbar", nie „Core verbunden" (TanStack behält data)', async () => {
    const core = fakeCore(true);
    const client = mount();
    await waitFor(() => expect(status()).toHaveAttribute('aria-label', 'Core verbunden'));

    core.up = false;
    await act(async () => {
      await client.refetchQueries({ queryKey: ['health'] });
    });
    await waitFor(() => expect(status()).toHaveAttribute('aria-label', 'Core nicht erreichbar'));
    expect(screen.queryByText('Core verbunden')).not.toBeInTheDocument();
  });

  it('Erholung (Fehler -> Erfolg) lädt fehlgeschlagene Abfragen neu', async () => {
    const core = fakeCore(false);
    const client = mount();
    await waitFor(() => expect(status()).toHaveAttribute('aria-label', 'Core nicht erreichbar'));
    expect(screen.queryByRole('link', { name: 'Datenbanksysteme' })).not.toBeInTheDocument();

    core.up = true;
    await act(async () => {
      await client.refetchQueries({ queryKey: ['health'] });
    });
    await waitFor(() => expect(status()).toHaveAttribute('aria-label', 'Core verbunden'));
    expect(await screen.findByRole('link', { name: 'Datenbanksysteme' })).toBeInTheDocument();
  });
});

describe('Retry-Regel', () => {
  it('wiederholt nur bei Netzwerkfehlern und 5xx, einmal, nie bei 4xx', async () => {
    const { ApiRequestError } = await import('../src/lib/api.ts');
    const retry = makeQueryClient().getDefaultOptions().queries!.retry as (n: number, e: unknown) => boolean;
    const err = (kind: 'unreachable' | 'api' | 'invalid', status?: number) =>
      new ApiRequestError({ kind, status, message: 'x', userMessage: 'x' });
    expect(retry(0, err('unreachable'))).toBe(true);
    expect(retry(1, err('unreachable'))).toBe(false);
    expect(retry(0, err('api', 503))).toBe(true);
    expect(retry(0, err('api', 404))).toBe(false);
    expect(retry(0, err('api', 401))).toBe(false);
    expect(retry(0, err('invalid', 200))).toBe(false);
  });
});

describe('Modulseite', () => {
  it('ohne id: Überschrift und leerer Zustand', () => {
    fakeCore(false);
    const client = makeQueryClient();
    render(
      <QueryClientProvider client={client}>
        <ModulView />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Modul' })).toBeInTheDocument();
    expect(screen.getByText('Wähle links ein Modul aus.')).toBeInTheDocument();
  });
});
