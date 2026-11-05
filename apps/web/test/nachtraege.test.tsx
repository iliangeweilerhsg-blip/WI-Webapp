// Nachträge aus dem Review von T0-07: Fokus, Wiederherstellen eines Semesters, mehrere gescheiterte Module
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

const nav = vi.hoisted(() => ({ pathname: '/', search: '', push: vi.fn() }));

vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ push: nav.push }),
}));

import { AppShell } from '../src/components/AppShell.tsx';
import { ModulView } from '../src/components/ModulView.tsx';
import { SettingsView } from '../src/components/SettingsView.tsx';
import { UNDO_WINDOW_MS, resetPendingModuleDeletes } from '../src/lib/modules.ts';
import { QueryProvider } from '../src/lib/query.tsx';
import { resetFailedModules } from '../src/lib/quick-modules.ts';
import { ThemeProvider } from '../src/lib/theme.tsx';
import { installFakeCore, makeModule, makeSemester } from './fake-core.ts';

const MOD = makeModule();

function shell(children: ReactNode) {
  return render(
    <ThemeProvider>
      <QueryProvider>
        <AppShell>{children}</AppShell>
      </QueryProvider>
    </ThemeProvider>,
  );
}

const main = () => document.getElementById('main');

beforeEach(() => {
  nav.pathname = '/modul';
  nav.search = `id=${MOD.id}`;
  nav.push.mockReset();
  document.documentElement.removeAttribute('data-sidebar');
});

afterEach(() => {
  resetPendingModuleDeletes();
  resetFailedModules();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Fokus (Nachtrag 1)', () => {
  it('nach „Rückgängig“ liegt der Fokus im Hauptbereich, nicht auf <body>', async () => {
    installFakeCore({ semesters: [makeSemester()], modules: [MOD] });
    const user = userEvent.setup();
    shell(<ModulView />);
    await screen.findByRole('heading', { level: 1, name: /Datenbanksysteme/ });
    await user.click(screen.getByRole('button', { name: 'Löschen' }));
    const undo = screen.getByRole('button', { name: 'Rückgängig' });
    expect(undo).toHaveFocus();
    await user.click(undo);
    expect(screen.queryByRole('button', { name: 'Rückgängig' })).not.toBeInTheDocument();
    expect(main()).toHaveFocus();
  });

  it('nach Ablauf des Toasts liegt der Fokus im Hauptbereich', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installFakeCore({ semesters: [makeSemester()], modules: [MOD] });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    shell(<ModulView />);
    await screen.findByRole('heading', { level: 1, name: /Datenbanksysteme/ });
    await user.click(screen.getByRole('button', { name: 'Löschen' }));
    expect(screen.getByRole('button', { name: 'Rückgängig' })).toHaveFocus();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS + 200);
    });
    expect(screen.queryByRole('button', { name: 'Rückgängig' })).not.toBeInTheDocument();
    expect(main()).toHaveFocus();
  });

  it('ein Toast, der den Fokus nicht hatte, nimmt ihn auch nicht mit', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installFakeCore({ semesters: [makeSemester()], modules: [MOD] });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    shell(<ModulView />);
    await screen.findByRole('heading', { level: 1, name: /Datenbanksysteme/ });
    await user.click(screen.getByRole('button', { name: 'Löschen' }));
    const tab = screen.queryByRole('tab', { name: 'Vorlesungen' });
    tab?.focus();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS + 200);
    });
    if (tab && document.contains(tab)) expect(tab).toHaveFocus();
  });

  it('Esc im Inline-Modulfeld bringt den Fokus zurück auf das „+“', async () => {
    installFakeCore({ semesters: [makeSemester()], modules: [] });
    const user = userEvent.setup();
    nav.pathname = '/';
    nav.search = '';
    shell(<p>Heute</p>);
    const plus = await screen.findByRole('button', { name: 'Modul anlegen', expanded: false });
    await user.click(plus);
    expect(screen.getByRole('textbox', { name: 'Modulname' })).toHaveFocus();
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Modul anlegen', expanded: false })).toHaveFocus(),
    );
  });
});

describe('Semester wiederherstellen (Nachtrag 2)', () => {
  const A = makeSemester({
    id: '0190f6a2-0000-7000-8000-0000000000b1',
    name: 'HS 2026',
    is_current: false,
    archived_at: '2026-11-01T00:00:00Z',
  });

  it('ist sonst keins aktuell, wird das wiederhergestellte aktuell – mit Toast', async () => {
    const core = installFakeCore({ semesters: [A] });
    const user = userEvent.setup();
    shell(<SettingsView />);
    await user.click(await screen.findByRole('button', { name: 'HS 2026 wiederherstellen' }));
    expect(
      await screen.findByText('HS 2026 wiederhergestellt · HS 2026 ist jetzt aktuell'),
    ).toBeInTheDocument();
    expect(core.semesters[0]).toMatchObject({ archived_at: null, is_current: true });
    expect(core.requests.filter((r) => r.method === 'PATCH').map((r) => r.body)).toEqual([
      { archived: false },
      { is_current: true },
    ]);
  });

  it('ist ein anderes Semester aktuell, bleibt es dabei', async () => {
    const current = makeSemester({
      id: '0190f6a2-0000-7000-8000-0000000000b2',
      name: 'FS 2027',
      is_current: true,
    });
    const core = installFakeCore({ semesters: [current, A] });
    const user = userEvent.setup();
    shell(<SettingsView />);
    await user.click(await screen.findByRole('button', { name: 'HS 2026 wiederherstellen' }));
    await waitFor(() => expect(core.semesters.find((s) => s.id === A.id)?.archived_at).toBeNull());
    expect(core.requests.filter((r) => r.method === 'PATCH')).toHaveLength(1);
    expect(core.semesters.find((s) => s.id === current.id)?.is_current).toBe(true);
  });
});

describe('Mehrere gescheiterte Module (Nachtrag 3)', () => {
  it('alle Namen bleiben erhalten, auch wenn das Feld während der Warteschlange geschlossen wird', async () => {
    const core = installFakeCore({ semesters: [makeSemester()], modules: [] });
    // POSTs hängen, bis wir sie freigeben – kein Zeitfenster, das unter Last verrutscht
    let release: () => void = () => {};
    core.postGate = new Promise<void>((r) => (release = r));
    const user = userEvent.setup();
    nav.pathname = '/';
    nav.search = '';
    shell(<p>Heute</p>);
    await user.click(await screen.findByRole('button', { name: 'Modul anlegen', expanded: false }));
    const input = screen.getByRole('textbox', { name: 'Modulname' });
    await user.type(input, 'Alpha{Enter}Beta{Enter}Gamma{Enter}');
    // Feld zu, solange die Anfragen noch laufen; der Core fällt aus
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Modulname' })).not.toBeInTheDocument();
    core.down = true;
    release();

    const failed = await screen.findByRole('list', { name: 'Nicht angelegt' });
    await waitFor(() => expect(within(failed).getAllByRole('listitem')).toHaveLength(3));
    expect(
      within(failed)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(screen.getByText('Core nicht erreichbar', { selector: 'p' })).toBeInTheDocument();

    // Erneut versuchen: alle drei, in Reihenfolge, die Liste verschwindet
    core.postGate = null;
    core.down = false;
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    const sidebar = screen.getByRole('navigation', { name: 'Hauptnavigation' });
    await within(sidebar).findByRole('link', { name: 'Gamma' }, { timeout: 4000 });
    expect(core.modules.map((m) => m.name)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(screen.queryByRole('list', { name: 'Nicht angelegt' })).not.toBeInTheDocument();
  });

  it('„Verwerfen“ räumt die Liste auf', async () => {
    const core = installFakeCore({ semesters: [makeSemester()], modules: [], down: false });
    const user = userEvent.setup();
    nav.pathname = '/';
    nav.search = '';
    shell(<p>Heute</p>);
    await user.click(await screen.findByRole('button', { name: 'Modul anlegen', expanded: false }));
    core.down = true;
    await user.type(screen.getByRole('textbox', { name: 'Modulname' }), 'Alpha{Enter}');
    await screen.findByRole('list', { name: 'Nicht angelegt' });
    await user.click(screen.getByRole('button', { name: 'Verwerfen' }));
    expect(screen.queryByRole('list', { name: 'Nicht angelegt' })).not.toBeInTheDocument();
    expect(core.modules).toHaveLength(0);
  });
});
