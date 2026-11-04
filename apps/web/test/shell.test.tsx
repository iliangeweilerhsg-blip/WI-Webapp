import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

const nav = vi.hoisted(() => ({ pathname: '/' }));

vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams('id=0190f6a2-0000-7000-8000-0000000000a1'),
}));

import { AppShell } from '../src/components/AppShell.tsx';
import { SettingsView } from '../src/components/SettingsView.tsx';
import { QueryProvider } from '../src/lib/query.tsx';
import { ThemeProvider } from '../src/lib/theme.tsx';

export const MODULE = {
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

function mount(children: ReactNode = <p>Inhalt</p>) {
  return render(
    <ThemeProvider>
      <QueryProvider>
        <AppShell>{children}</AppShell>
      </QueryProvider>
    </ThemeProvider>,
  );
}

function coreOffline() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }),
  );
}

beforeEach(() => {
  nav.pathname = '/';
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-sidebar');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Navigation', () => {
  it('zeigt alle Einträge der Seitenleiste in der Reihenfolge von 07 §2, jeder mit Beschriftung', async () => {
    coreOffline();
    mount();
    const sidebar = screen.getByRole('navigation', { name: 'Hauptnavigation' });
    const links = within(sidebar).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('aria-label'))).toEqual([
      'Heute',
      'Bibliothek',
      'Lernen',
      'Planer',
      'Videos',
      'Inbox',
    ]);
    // eingeklappt braucht jedes Ziel einen Tooltip
    expect(links.map((a) => a.getAttribute('title'))).toEqual(links.map((a) => a.getAttribute('aria-label')));
    // jedes Ziel hat ein eigenes Symbol
    const icons = links.map((a) => a.querySelector('svg')?.innerHTML);
    expect(icons.every(Boolean)).toBe(true);
    expect(new Set(icons).size).toBe(icons.length);
    expect(screen.getByRole('link', { name: 'Einstellungen' })).toHaveAttribute('href', '/einstellungen');
    expect(screen.getByRole('link', { name: 'Inbox' })).toHaveAttribute('href', '/inbox');
    expect(screen.getByRole('link', { name: 'Heute' })).toHaveAttribute('aria-current', 'page');
  });

  it('zeigt Module aus der API mit Modulfarbe und Query-Parameter-Link', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).includes('/modules')
          ? new Response(JSON.stringify({ items: [MODULE], next_cursor: null }), { status: 200 })
          : new Response('{}', { status: 404 }),
      ),
    );
    nav.pathname = '/modul';
    mount();
    const link = await screen.findByRole('link', { name: 'Datenbanksysteme' });
    expect(link).toHaveAttribute('href', `/modul?id=${MODULE.id}`);
    expect(link).toHaveAttribute('aria-current', 'page');
    const dot = link.querySelector('span[aria-hidden]') as HTMLElement;
    expect(dot.style.backgroundColor).toBe('var(--sg-mod-03)');
  });

  it('stürzt ohne Core nicht ab, sondern zeigt „Core nicht erreichbar"', async () => {
    coreOffline();
    mount();
    expect(await screen.findAllByText('Core nicht erreichbar', {}, { timeout: 4000 })).not.toHaveLength(0);
    expect(screen.getByText('Inhalt')).toBeInTheDocument();
  });

  it('hat keinen Theme-Umschalter in der Seitenleiste', () => {
    coreOffline();
    mount();
    expect(screen.queryByRole('group', { name: 'Darstellung' })).not.toBeInTheDocument();
  });
});

describe('Tastenkürzel (jsdom ist kein Mac: Strg)', () => {
  it('Strg+K öffnet den Suchdialog, Esc schließt ihn', async () => {
    coreOffline();
    const user = userEvent.setup();
    mount();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.keyboard('{Control>}k{/Control}');
    expect(screen.getByRole('dialog', { name: 'Suche' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Seitenleiste klappt ein und aus und setzt data-sidebar auf <html>', async () => {
    coreOffline();
    const user = userEvent.setup();
    mount();
    const toggle = screen.getByRole('button', { name: /Seitenleiste/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Control>}\\{/Control}');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(document.documentElement).toHaveAttribute('data-sidebar', 'collapsed');
    expect(window.localStorage.getItem('sg-sidebar-collapsed')).toBe('1');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.documentElement).not.toHaveAttribute('data-sidebar');
  });

  it('übernimmt eine beim Laden gesetzte eingeklappte Leiste', () => {
    coreOffline();
    document.documentElement.setAttribute('data-sidebar', 'collapsed');
    mount();
    expect(screen.getByRole('button', { name: /Seitenleiste/ })).toHaveAttribute('aria-expanded', 'false');
  });

  it('Strg+[ und Strg+] gehen im Verlauf zurück und vor, nicht aber im Suchfeld', async () => {
    coreOffline();
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const forward = vi.spyOn(window.history, 'forward').mockImplementation(() => {});
    const user = userEvent.setup();
    mount();
    await user.keyboard('{Control>}[[{/Control}');
    await user.keyboard('{Control>}]{/Control}');
    expect(back).toHaveBeenCalledTimes(1);
    expect(forward).toHaveBeenCalledTimes(1);

    await user.keyboard('{Control>}k{/Control}');
    await user.keyboard('{Control>}[[{/Control}');
    expect(back).toHaveBeenCalledTimes(1);
  });
});

describe('Darstellung (nur in den Einstellungen)', () => {
  it('Segment-Buttons mit aria-pressed setzen data-theme und merken sich die Wahl', async () => {
    coreOffline();
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <SettingsView />
      </ThemeProvider>,
    );
    expect(screen.getByRole('button', { name: 'System' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Dunkel' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(window.localStorage.getItem('sg-theme')).toBe('dark');
    expect(screen.getByRole('button', { name: 'Dunkel' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'System' }));
    expect(document.documentElement).not.toHaveAttribute('data-theme');
  });
});
