// Seitenleiste im Live-Dashboard (T1-04): klappt auf /session automatisch ein, ohne etwas zu speichern, und
// stellt beim Verlassen den alten Zustand wieder her (außer der Nutzer hat selbst umgeschaltet).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

const nav = vi.hoisted(() => ({ path: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.path }));

import { AppShell } from '../src/components/AppShell.tsx';
import { QueryProvider } from '../src/lib/query.tsx';
import type { SyncClient } from '../src/lib/sync/client.ts';
import { SIDEBAR_AUTO_ATTR, SIDEBAR_KEY, THEME_INIT_SCRIPT } from '../src/lib/theme-init.ts';
import { ThemeProvider } from '../src/lib/theme.tsx';

const root = document.documentElement;

function stubNarrow(narrow: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('max-width') ? narrow : !narrow,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })),
  );
}

const client = {
  connectionState: 'online',
  connect: vi.fn(async () => undefined),
  disconnect: vi.fn(),
  onEvent: vi.fn(() => () => undefined),
  takeOver: vi.fn(),
  listShelf: vi.fn(async () => []),
  subscribe: vi.fn(),
} as unknown as SyncClient;

function tree(children: ReactNode = <p>Inhalt</p>) {
  return (
    <ThemeProvider>
      <QueryProvider>
        <AppShell syncClient={client}>{children}</AppShell>
      </QueryProvider>
    </ThemeProvider>
  );
}

/** Seitenwechsel: neuer Pfad, gleiche Shell */
async function navigate(view: ReturnType<typeof render>, path: string) {
  nav.path = path;
  await act(async () => view.rerender(tree()));
}

const collapsed = () => root.getAttribute('data-sidebar') === 'collapsed';

beforeEach(() => {
  root.removeAttribute('data-sidebar');
  root.removeAttribute(SIDEBAR_AUTO_ATTR);
  window.localStorage.clear();
  nav.path = '/';
  stubNarrow(false);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Seitenleiste auf /session', () => {
  it('klappt auf /session ein, speichert nichts und klappt beim Verlassen wieder aus', async () => {
    const view = render(tree());
    await act(async () => undefined);
    expect(collapsed()).toBe(false);
    await navigate(view, '/session');
    expect(collapsed()).toBe(true);
    expect(window.localStorage.getItem(SIDEBAR_KEY)).toBeNull();
    await navigate(view, '/');
    expect(collapsed()).toBe(false);
    expect(window.localStorage.getItem(SIDEBAR_KEY)).toBeNull();
  });

  it('war sie schon vom Nutzer eingeklappt, bleibt sie es nach dem Verlassen', async () => {
    window.localStorage.setItem(SIDEBAR_KEY, '1');
    root.setAttribute('data-sidebar', 'collapsed');
    const view = render(tree());
    await navigate(view, '/session');
    expect(collapsed()).toBe(true);
    await navigate(view, '/');
    expect(collapsed()).toBe(true);
  });

  it('hat der Nutzer auf /session selbst umgeschaltet, wird beim Verlassen nichts zurückgesetzt', async () => {
    const user = userEvent.setup();
    const view = render(tree());
    await navigate(view, '/session');
    expect(collapsed()).toBe(true);
    // Kürzel „Seitenleiste umschalten“ (Strg bzw. Cmd plus Backslash): klappt aus
    const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? 'Meta' : 'Control';
    await user.keyboard(`{${mod}>}\\{/${mod}}`);
    expect(collapsed()).toBe(false);
    expect(window.localStorage.getItem(SIDEBAR_KEY)).toBe('0');
    await navigate(view, '/');
    expect(collapsed()).toBe(false);
  });

  it('hat der Nutzer auf /session ein- und wieder ausgeklappt, gilt seine letzte Wahl auch danach', async () => {
    const user = userEvent.setup();
    const view = render(tree());
    await navigate(view, '/session');
    const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? 'Meta' : 'Control';
    await user.keyboard(`{${mod}>}\\{/${mod}}`); // aus
    await user.keyboard(`{${mod}>}\\{/${mod}}`); // wieder ein (jetzt Wahl des Nutzers)
    expect(collapsed()).toBe(true);
    await navigate(view, '/');
    expect(collapsed()).toBe(true);
  });

  it('klappt nur breit ein: schmal bleibt die Seitenleiste ein Drawer', async () => {
    stubNarrow(true);
    const view = render(tree());
    await navigate(view, '/session');
    expect(collapsed()).toBe(false);
  });

  it('direktes Laden: das Init-Skript hat schon eingeklappt, die Shell stellt beim Verlassen wieder her', async () => {
    window.history.replaceState(null, '', '/session');
    new Function(THEME_INIT_SCRIPT)();
    expect(collapsed()).toBe(true);
    expect(root).toHaveAttribute(SIDEBAR_AUTO_ATTR);
    nav.path = '/session';
    const view = render(tree());
    await act(async () => undefined);
    expect(collapsed()).toBe(true);
    await navigate(view, '/');
    expect(collapsed()).toBe(false);
    window.history.replaceState(null, '', '/');
  });
});

describe('THEME_INIT_SCRIPT auf /session', () => {
  const run = () => new Function(THEME_INIT_SCRIPT)();
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('klappt die Seitenleiste auf /session und /session/ ein, merkt es sich und speichert nichts', () => {
    for (const path of ['/session', '/session/']) {
      root.removeAttribute('data-sidebar');
      root.removeAttribute(SIDEBAR_AUTO_ATTR);
      window.history.replaceState(null, '', `${path}?id=x`);
      run();
      expect(root).toHaveAttribute('data-sidebar', 'collapsed');
      expect(root).toHaveAttribute(SIDEBAR_AUTO_ATTR);
    }
    expect(window.localStorage.getItem(SIDEBAR_KEY)).toBeNull();
  });

  it('auf anderen Seiten passiert nichts; bei gespeichertem Einklappen ist es nicht „automatisch“', () => {
    window.history.replaceState(null, '', '/sessionen');
    run();
    expect(root).not.toHaveAttribute('data-sidebar');
    window.localStorage.setItem(SIDEBAR_KEY, '1');
    window.history.replaceState(null, '', '/session');
    run();
    expect(root).toHaveAttribute('data-sidebar', 'collapsed');
    expect(root).not.toHaveAttribute(SIDEBAR_AUTO_ATTR);
  });
});
