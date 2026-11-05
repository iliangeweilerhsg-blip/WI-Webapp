import { StrictMode, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
}));

vi.mock('../src/components/ink', () => ({
  InkColumn: ({ notebookId }: { notebookId: string }) => <div data-testid="ink-column">{notebookId}</div>,
}));

import { AppShell } from '../src/components/AppShell.tsx';
import { SyncClient } from '../src/lib/sync/client.ts';
import { useSyncClient } from '../src/lib/sync/SyncProvider.tsx';
import { QueryProvider } from '../src/lib/query.tsx';
import { ThemeProvider } from '../src/lib/theme.tsx';

type Listener = (e: { matches: boolean }) => void;

function stubNarrow(narrow: boolean) {
  const listeners = new Set<Listener>();
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: narrow,
      addEventListener: (_: string, l: Listener) => listeners.add(l),
      removeEventListener: (_: string, l: Listener) => listeners.delete(l),
    })),
  );
  return listeners;
}

interface FakeOpts {
  state?: string;
  shelf?: unknown[];
}

function fakeClient(opts: FakeOpts = {}) {
  const calls = { connect: 0, disconnect: 0 };
  const client = {
    connectionState: opts.state ?? 'online',
    connect: vi.fn(async () => void calls.connect++),
    disconnect: vi.fn(() => void calls.disconnect++),
    onEvent: vi.fn(() => () => undefined),
    takeOver: vi.fn(),
    listShelf: vi.fn(async () => opts.shelf ?? []),
    subscribe: vi.fn(),
  };
  return { client: client as unknown as SyncClient, calls };
}

function mount(client: SyncClient | undefined, children: ReactNode = <p>Inhalt</p>, strict = false) {
  const tree = (
    <ThemeProvider>
      <QueryProvider>
        <AppShell {...(client ? { syncClient: client } : {})}>{children}</AppShell>
      </QueryProvider>
    </ThemeProvider>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

beforeEach(() => {
  document.documentElement.removeAttribute('data-sidebar');
  window.history.replaceState(null, '', '/');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AppShell: Drawer unter 768 px', () => {
  it('öffnet per Menü-Knopf, schließt per Esc und gibt den Fokus zurück', async () => {
    stubNarrow(true);
    const user = userEvent.setup();
    mount(fakeClient().client);
    const menu = screen.getByRole('button', { name: 'Menü öffnen' });
    const aside = document.getElementById('sidebar')!;
    expect(aside).toHaveAttribute('data-drawer', 'closed');
    expect(menu).toHaveAttribute('aria-expanded', 'false');

    await user.click(menu);
    expect(aside).toHaveAttribute('data-drawer', 'open');
    expect(menu).toHaveAttribute('aria-expanded', 'true');
    expect(aside.contains(document.activeElement)).toBe(true);

    await user.keyboard('{Escape}');
    expect(aside).toHaveAttribute('data-drawer', 'closed');
    expect(menu).toHaveFocus();
  });

  it('hält den Fokus per Tab und Shift+Tab im offenen Drawer', async () => {
    stubNarrow(true);
    const user = userEvent.setup();
    mount(fakeClient().client);
    await user.click(screen.getByRole('button', { name: 'Menü öffnen' }));
    const aside = document.getElementById('sidebar')!;
    for (let i = 0; i < 40; i++) {
      await user.tab();
      expect(aside.contains(document.activeElement)).toBe(true);
    }
    for (let i = 0; i < 40; i++) {
      await user.tab({ shift: true });
      expect(aside.contains(document.activeElement)).toBe(true);
    }
  });

  it('schließt per Klick auf den Hintergrund und bei Navigation', async () => {
    stubNarrow(true);
    const user = userEvent.setup();
    mount(fakeClient().client);
    const aside = document.getElementById('sidebar')!;
    const menu = screen.getByRole('button', { name: 'Menü öffnen' });

    await user.click(menu);
    await user.click(document.querySelector('.sg-drawer-backdrop') as HTMLElement);
    expect(aside).toHaveAttribute('data-drawer', 'closed');
    expect(document.querySelector('.sg-drawer-backdrop')).toBeNull();

    await user.click(menu);
    const link = aside.querySelector('a[href]') as HTMLAnchorElement;
    link.addEventListener('click', (e) => e.preventDefault());
    await user.click(link);
    expect(aside).toHaveAttribute('data-drawer', 'closed');
  });

  it('schließt, wenn der Bildschirm breit wird', async () => {
    const listeners = stubNarrow(true);
    const user = userEvent.setup();
    mount(fakeClient().client);
    await user.click(screen.getByRole('button', { name: 'Menü öffnen' }));
    const aside = document.getElementById('sidebar')!;
    expect(aside).toHaveAttribute('data-drawer', 'open');
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    act(() => listeners.forEach((l) => l({ matches: false })));
    expect(aside).toHaveAttribute('data-drawer', 'closed');
  });

  it('breit: Umschalter setzt data-sidebar statt den Drawer zu öffnen', async () => {
    stubNarrow(false);
    const user = userEvent.setup();
    mount(fakeClient().client);
    await user.click(screen.getByRole('button', { name: 'Seitenleiste ein- oder ausklappen' }));
    expect(document.documentElement.getAttribute('data-sidebar')).toBe('collapsed');
    expect(document.getElementById('sidebar')).toHaveAttribute('data-drawer', 'closed');
  });
});

describe('AppShell: SyncClient', () => {
  it('verbindet beim Mount, trennt beim Unmount', () => {
    stubNarrow(false);
    const { client, calls } = fakeClient();
    const view = mount(client);
    expect(calls).toEqual({ connect: 1, disconnect: 0 });
    view.unmount();
    expect(calls).toEqual({ connect: 1, disconnect: 1 });
  });

  it('legt unter StrictMode genau einen Client an und lässt ihn verbunden', async () => {
    stubNarrow(false);
    const instances = new Set<unknown>();
    let connected = 0;
    vi.spyOn(SyncClient.prototype, 'connect').mockImplementation(async function (this: SyncClient) {
      instances.add(this);
      connected++;
    });
    vi.spyOn(SyncClient.prototype, 'disconnect').mockImplementation(() => {
      connected--;
    });
    const seen: unknown[] = [];
    function Probe() {
      seen.push(useSyncClient());
      return null;
    }
    const view = mount(undefined, <Probe />, true);
    await act(async () => undefined);
    expect(instances.size).toBe(1);
    expect(connected).toBe(1);
    expect(seen.at(-1)).toBe([...instances][0]);
    view.unmount();
    expect(connected).toBe(0);
  });

  it('zeigt Hinweis „anderer Tab“ und Fehlerablage', async () => {
    stubNarrow(false);
    const { client } = fakeClient({ state: 'other_tab', shelf: [{ id: 1, op_id: 'x' }] });
    mount(client);
    expect(await screen.findByText('Studien-Gehirn ist in einem anderen Tab aktiv.')).toBeVisible();
    expect(await screen.findByRole('button', { name: /Sync-Fehlerablage \(1\)/ })).toBeVisible();
  });

  it('blendet die Notizen-Spalte nur mit ?notebook=<id> ein', async () => {
    stubNarrow(false);
    const { client } = fakeClient();
    const first = mount(client);
    expect(screen.queryByTestId('ink-column')).toBeNull();
    first.unmount();
    window.history.replaceState(null, '', '/?notebook=nb-1');
    mount(client);
    expect(await screen.findByTestId('ink-column')).toHaveTextContent('nb-1');
  });
});
