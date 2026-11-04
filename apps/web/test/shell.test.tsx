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
import { QueryProvider } from '../src/lib/query.tsx';
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
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Navigation', () => {
  it('zeigt alle Einträge der Seitenleiste in der Reihenfolge von 07 §2', async () => {
    coreOffline();
    mount();
    const sidebar = screen.getByRole('navigation', { name: 'Hauptnavigation' });
    const labels = within(sidebar)
      .getAllByRole('link')
      .map((a) => a.textContent?.replace(/^[^\p{L}]+/u, '').trim());
    expect(labels).toEqual(['Heute', 'Bibliothek', 'Lernen', 'Planer', 'Videos', 'Inbox']);
    expect(screen.getByRole('link', { name: /Einstellungen/ })).toHaveAttribute('href', '/einstellungen');
    expect(screen.getByRole('link', { name: /Inbox/ })).toHaveAttribute('href', '/inbox');
    expect(screen.getByRole('link', { name: /Heute/ })).toHaveAttribute('aria-current', 'page');
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
    const link = await screen.findByRole('link', { name: /DBS/ });
    expect(link).toHaveAttribute('href', `/modul?id=${MODULE.id}`);
    expect(link).toHaveAttribute('aria-current', 'page');
    const dot = link.querySelector('span[aria-hidden]') as HTMLElement;
    expect(dot.style.backgroundColor).toBe('var(--sg-mod-03)');
  });

  it('stürzt ohne Core nicht ab, sondern zeigt „Core nicht erreichbar"', async () => {
    coreOffline();
    mount();
    expect(await screen.findAllByText('Core nicht erreichbar')).not.toHaveLength(0);
    expect(screen.getByText('Inhalt')).toBeInTheDocument();
  });
});

describe('Tastenkürzel', () => {
  it('⌘K öffnet den Suchdialog, Esc schließt ihn', async () => {
    coreOffline();
    const user = userEvent.setup();
    mount();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.keyboard('{Meta>}k{/Meta}');
    const dialog = screen.getByRole('dialog', { name: 'Suche' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('⌘\\ klappt die Seitenleiste ein und aus', async () => {
    coreOffline();
    const user = userEvent.setup();
    mount();
    const toggle = screen.getByRole('button', { name: /Seitenleiste/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Meta>}\\{/Meta}');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard('{Meta>}\\{/Meta}');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('⌘[ und ⌘] gehen im Verlauf zurück und vor', async () => {
    coreOffline();
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const forward = vi.spyOn(window.history, 'forward').mockImplementation(() => {});
    const user = userEvent.setup();
    mount();
    await user.keyboard('{Meta>}[[{/Meta}');
    await user.keyboard('{Meta>}]{/Meta}');
    expect(back).toHaveBeenCalledTimes(1);
    expect(forward).toHaveBeenCalledTimes(1);
  });
});

describe('Darstellung', () => {
  it('Umschalter setzt data-theme und merkt sich die Wahl', async () => {
    coreOffline();
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('radio', { name: 'Dunkel' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(window.localStorage.getItem('sg-theme')).toBe('dark');
    await user.click(screen.getByRole('radio', { name: 'System' }));
    expect(document.documentElement).not.toHaveAttribute('data-theme');
  });
});
