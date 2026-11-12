import { StrictMode, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('../src/components/ink', () => ({
  InkColumn: ({ notebookId }: { notebookId: string }) => <div data-testid="ink-column">{notebookId}</div>,
}));

import { AppShell } from '../src/components/AppShell.tsx';
import { SyncClient } from '../src/lib/sync/client.ts';
import { useSyncClient } from '../src/lib/sync/SyncProvider.tsx';
import { QueryProvider } from '../src/lib/query.tsx';
import { ThemeProvider } from '../src/lib/theme.tsx';
import { fakeRecording } from './recording-fakes.ts';
import { installFakeCore, makeModule, makeSemester, makeSession } from './fake-core.ts';

type Listener = (e: { matches: boolean }) => void;

function stubNarrow(narrow: boolean) {
  const listeners = new Set<Listener>();
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      // schmal: nur die max-width-Abfrage trifft; breit: die min-width-Abfragen
      matches: query.includes('max-width') ? narrow : !narrow,
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
    // Nach Navigation geht der Fokus in den Inhalt
    expect(document.getElementById('main')).toHaveFocus();
  });

  it('schirmt den Hintergrund ab: Dialog, aria-modal, Rest inert', async () => {
    stubNarrow(true);
    const user = userEvent.setup();
    mount(fakeClient().client);
    const aside = document.getElementById('sidebar')!;
    expect(aside).not.toHaveAttribute('role');
    const menu = screen.getByRole('button', { name: 'Menü öffnen' });
    await user.click(menu);
    expect(aside).toHaveAttribute('role', 'dialog');
    expect(aside).toHaveAttribute('aria-modal', 'true');
    expect(aside).toHaveAttribute('aria-label', 'Hauptmenü');
    expect(screen.getByText('Inhalt').closest('[inert]')).not.toBeNull();
    expect(menu.closest('[inert]')).not.toBeNull();
    expect(aside.closest('[inert]')).toBeNull();
    expect(menu).toHaveAccessibleName('Menü schließen');
    await user.keyboard('{Escape}');
    expect(document.querySelector('[inert]')).toBeNull();
    expect(menu).toHaveAccessibleName('Menü öffnen');
    expect(menu).toHaveFocus();
  });

  it('Esc, das ein Element im Drawer selbst behandelt, schließt ihn nicht', async () => {
    stubNarrow(true);
    const user = userEvent.setup();
    mount(fakeClient().client);
    await user.click(screen.getByRole('button', { name: 'Menü öffnen' }));
    const aside = document.getElementById('sidebar')!;
    const own = (e: KeyboardEvent) => e.preventDefault();
    aside.addEventListener('keydown', own);
    await user.keyboard('{Escape}');
    expect(aside).toHaveAttribute('data-drawer', 'open');
    aside.removeEventListener('keydown', own);
  });

  it('Strg+K schließt den Drawer und öffnet die Suche ohne Fokusfalle', async () => {
    stubNarrow(true);
    const user = userEvent.setup();
    mount(fakeClient().client);
    await user.click(screen.getByRole('button', { name: 'Menü öffnen' }));
    await user.keyboard('{Control>}k{/Control}');
    expect(document.getElementById('sidebar')).toHaveAttribute('data-drawer', 'closed');
    expect(document.querySelector('[inert]')).toBeNull();
    const dialog = await screen.findByRole('dialog', { name: /such/i });
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
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

  it('hängt keine Notizen-Spalte mehr an die Shell, auch nicht mit ?notebook=<id> (liegt im Dashboard)', async () => {
    stubNarrow(false);
    window.history.replaceState(null, '', '/?notebook=nb-1');
    mount(fakeClient().client);
    expect(await screen.findByText('Inhalt')).toBeVisible();
    expect(screen.queryByTestId('ink-column')).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Notizen' })).toBeNull();
  });
});

describe('AppShell: Aufnahme (Issue #210)', () => {
  /** Eine laufende Session im Fake-Core; ohne Mikrofon-Erlaubnis, damit nichts aufgenommen wird */
  function mountWithSession() {
    const module = makeModule({ id: '0190f6a2-0000-7000-8000-0000000000a3' });
    installFakeCore({
      semesters: [makeSemester()],
      modules: [module],
      sessions: [
        makeSession({
          id: '0190f6a2-0000-7000-8000-0000000000e1',
          module_id: module.id,
          state: 'laeuft',
          started_at: new Date().toISOString(),
        }),
      ],
    });
    const { client } = fakeClient();
    return render(
      <ThemeProvider>
        <QueryProvider>
          <AppShell syncClient={client} recordingEnv={fakeRecording({ permission: 'prompt' }).env}>
            <p>Inhalt</p>
          </AppShell>
        </QueryProvider>
      </ThemeProvider>,
    );
  }

  it('die Aufnahme-Leiste liegt in der Inhaltsspalte nach `main`', async () => {
    stubNarrow(false);
    mountWithSession();
    const bar = await screen.findByRole('complementary', { name: 'Aufnahme' });
    const main = document.getElementById('main')!;
    const column = main.closest('.flex-col')!;
    expect(column.contains(bar)).toBe(true);
    expect(main.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Sie scrollt nicht mit dem Inhalt und schrumpft nicht
    expect(main.contains(bar)).toBe(false);
    expect(bar).toHaveClass('shrink-0');
  });

  it('bei offenem Drawer ist die Leiste `inert` (die ganze Spalte)', async () => {
    stubNarrow(true);
    const user = userEvent.setup();
    mountWithSession();
    const bar = await screen.findByRole('complementary', { name: 'Aufnahme' });
    expect(bar.closest('[inert]')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Menü öffnen' }));
    expect(bar.closest('[inert]')).not.toBeNull();
  });

  it('ohne aktive Session gibt es keine Leiste', async () => {
    stubNarrow(false);
    mount(fakeClient().client);
    expect(await screen.findByText('Inhalt')).toBeVisible();
    expect(screen.queryByRole('complementary', { name: 'Aufnahme' })).toBeNull();
  });

  describe('bfcache (`pageshow`)', () => {
    function stubReload() {
      const reload = vi.fn();
      const original = window.location;
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: { ...original, reload },
      });
      return {
        reload,
        restore: () => Object.defineProperty(window, 'location', { configurable: true, value: original }),
      };
    }
    const pageshow = (persisted: boolean) => {
      const event = new Event('pageshow') as PageTransitionEvent;
      Object.defineProperty(event, 'persisted', { value: persisted });
      act(() => void window.dispatchEvent(event));
    };

    it('aus dem bfcache zurück (`persisted`): lädt neu', () => {
      stubNarrow(false);
      const { reload, restore } = stubReload();
      try {
        mount(fakeClient().client);
        pageshow(true);
        expect(reload).toHaveBeenCalledTimes(1);
      } finally {
        restore();
      }
    });

    it('normales Laden (`persisted` falsch): kein Neuladen', () => {
      stubNarrow(false);
      const { reload, restore } = stubReload();
      try {
        mount(fakeClient().client);
        pageshow(false);
        expect(reload).not.toHaveBeenCalled();
      } finally {
        restore();
      }
    });

    it('nach dem Unmount hört die Shell nicht mehr auf `pageshow`', () => {
      stubNarrow(false);
      const { reload, restore } = stubReload();
      try {
        const view = mount(fakeClient().client);
        view.unmount();
        pageshow(true);
        expect(reload).not.toHaveBeenCalled();
      } finally {
        restore();
      }
    });
  });
});
