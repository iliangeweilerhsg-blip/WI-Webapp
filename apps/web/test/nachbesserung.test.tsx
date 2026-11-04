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
import { suggestSemesterName } from '../src/lib/semesters.ts';
import { ThemeProvider } from '../src/lib/theme.tsx';
import { ToastProvider } from '../src/lib/toast.tsx';
import { UploadProvider } from '../src/lib/uploads.tsx';
import { uuidv7 } from '../src/lib/uuid.ts';
import { installFakeCore, makeModule, makeSemester, type FakeCore } from './fake-core.ts';

function app(children: ReactNode = <p>Inhalt</p>) {
  return (
    <ThemeProvider>
      <QueryProvider>
        <AppShell>{children}</AppShell>
      </QueryProvider>
    </ThemeProvider>
  );
}

function modulePage() {
  return render(
    <ThemeProvider>
      <QueryProvider>
        <ToastProvider>
          <UploadProvider>
            <ModulView />
          </UploadProvider>
        </ToastProvider>
      </QueryProvider>
    </ThemeProvider>,
  );
}

const writes = (core: FakeCore) => core.requests.filter((r) => r.method !== 'GET');
const blurActive = () => act(() => (document.activeElement as HTMLElement).blur());

beforeEach(() => {
  nav.pathname = '/';
  nav.search = '';
  nav.push.mockReset();
  document.documentElement.removeAttribute('data-sidebar');
});

afterEach(() => {
  resetPendingModuleDeletes();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Hilfsfunktionen', () => {
  it('Namensvorschlag überspringt vorhandene Semester', () => {
    const nov = new Date(2026, 10, 4);
    expect(suggestSemesterName(nov, ['HS 2026'])).toBe('FS 2027');
    expect(suggestSemesterName(nov, ['hs 2026', 'FS 2027'])).toBe('HS 2027');
    expect(suggestSemesterName(new Date(2027, 2, 1), ['FS 2027'])).toBe('HS 2027');
  });

  it('uuidv7 liefert gültige, zeitlich sortierbare IDs', () => {
    const a = uuidv7(1_000_000_000_000);
    const b = uuidv7(1_000_000_000_001);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
  });
});

describe('Einrichtungsdialog (Nachbesserung)', () => {
  it('schnelles Anlegen: Feld leert sich sofort, nichts geht verloren oder verklebt, Reihenfolge bleibt', async () => {
    const core = installFakeCore({ latencyMs: 150 });
    const user = userEvent.setup();
    render(app());
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Semester'), '{Enter}');
    const input = await within(dialog).findByLabelText('Modulname');

    // weitere Namen tippen, bevor der erste POST fertig ist
    await user.type(input, 'Alpha{Enter}');
    expect(input).toHaveValue('');
    expect(within(dialog).getByText('Alpha')).toBeInTheDocument();
    expect(within(dialog).getByText('wird angelegt …')).toBeInTheDocument();
    await user.type(input, 'Beta{Enter}');
    await user.type(input, 'Gamma{Enter}');
    expect(input).toHaveValue('');

    const list = within(dialog).getByRole('list', { name: 'Angelegte Module' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    await waitFor(() => expect(within(list).queryByText('wird angelegt …')).not.toBeInTheDocument(), {
      timeout: 3000,
    });
    const posts = writes(core).filter((r) => r.path === '/modules');
    expect(posts.map((r) => (r.body as { name: string }).name)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(new Set(posts.map((r) => (r.body as { id: string }).id)).size).toBe(3);
    expect(new Set(posts.map((r) => r.headers['Idempotency-Key'])).size).toBe(3);
    expect(core.modules.map((m) => [m.name, m.color])).toEqual([
      ['Alpha', 'mod-01'],
      ['Beta', 'mod-02'],
      ['Gamma', 'mod-03'],
    ]);
  });

  it('bei einem Fehler bleibt der Name in der Liste „Nicht angelegt“', async () => {
    const core = installFakeCore();
    const user = userEvent.setup();
    render(app());
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Semester'), '{Enter}');
    const input = await within(dialog).findByLabelText('Modulname');
    core.down = true;
    await user.type(input, 'Alpha{Enter}');
    // Der Name geht nicht verloren: er steht in der Liste „Nicht angelegt“ mit „Erneut versuchen“
    const failed = await within(dialog).findByRole('list', { name: 'Nicht angelegt' });
    expect(within(failed).getByText('Alpha')).toBeInTheDocument();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Core nicht erreichbar');
    expect(within(dialog).queryByRole('list', { name: 'Angelegte Module' })).not.toBeInTheDocument();
  });

  it('hält den Fokus im Dialog (Tab, Shift+Tab) und gibt ihn beim Schließen an den Hauptbereich', async () => {
    installFakeCore();
    const user = userEvent.setup();
    render(app());
    const dialog = await screen.findByRole('dialog');
    const input = within(dialog).getByLabelText('Semester');
    const later = within(dialog).getByRole('button', { name: 'Später' });
    const next = within(dialog).getByRole('button', { name: 'Weiter' });
    expect(input).toHaveFocus();
    await user.tab();
    expect(later).toHaveFocus();
    await user.tab();
    expect(next).toHaveFocus();
    await user.tab();
    expect(input).toHaveFocus();
    await user.tab({ shift: true });
    expect(next).toHaveFocus();

    await user.click(later);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.getElementById('main')).toHaveFocus();
  });
});

describe('Seitenleiste (Nachbesserung)', () => {
  it('nennt das Semester und legt Module inline an (Enter, Feld leert sich sofort)', async () => {
    const core = installFakeCore({ semesters: [makeSemester()], latencyMs: 120 });
    const user = userEvent.setup();
    render(app());
    const list = await screen.findByRole('list', { name: /Module\s*·\s*HS 2026/ });

    // leerer Zustand: genau eine Aktion
    expect(within(list).getAllByRole('button', { name: 'Modul anlegen' })).toHaveLength(1);
    await user.click(within(list).getByRole('button', { name: 'Modul anlegen' }));
    const input = screen.getByRole('textbox', { name: 'Modulname' });
    expect(input).toHaveFocus();
    await user.type(input, 'Alpha{Enter}');
    expect(input).toHaveValue('');
    await user.type(input, 'Beta{Enter}');
    expect(input).toHaveValue('');
    expect(within(list).getByText('Alpha …')).toBeInTheDocument();

    const sidebar = screen.getByRole('navigation', { name: 'Hauptnavigation' });
    await within(sidebar).findByRole('link', { name: 'Alpha' });
    await within(sidebar).findByRole('link', { name: 'Beta' });
    const posts = writes(core).filter((r) => r.path === '/modules');
    expect(posts.map((r) => r.body)).toEqual([
      expect.objectContaining({ semester_id: core.semesters[0]?.id, name: 'Alpha' }),
      expect.objectContaining({ semester_id: core.semesters[0]?.id, name: 'Beta' }),
    ]);

    // Esc schließt das Feld, das „+“ neben der Überschrift öffnet es wieder
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Modulname' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Modul anlegen' }));
    expect(screen.getByRole('textbox', { name: 'Modulname' })).toBeInTheDocument();
  });

  it('ohne aktuelles Semester: Hinweis mit Link zu den Einstellungen', async () => {
    installFakeCore({
      semesters: [makeSemester({ archived_at: '2026-11-01T00:00:00Z', is_current: false })],
    });
    render(app());
    expect(await screen.findByText('Kein aktuelles Semester')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'In den Einstellungen wählen' })).toHaveAttribute(
      'href',
      '/einstellungen',
    );
    expect(screen.queryByRole('button', { name: 'Modul anlegen' })).not.toBeInTheDocument();
  });
});

describe('Modulseite (Nachbesserung)', () => {
  const A = makeModule();
  const B = makeModule({ id: '0190f6a2-0000-7000-8000-0000000000a2', name: 'Statistik', short_name: null });

  beforeEach(() => {
    nav.pathname = '/modul';
    nav.search = `id=${A.id}`;
  });

  it('Tabs: Pos1 und Ende; neuer Text bei Vorlesungen', async () => {
    installFakeCore({ semesters: [makeSemester()], modules: [makeModule()] });
    const user = userEvent.setup();
    modulePage();
    await screen.findByRole('heading', { level: 1, name: /Datenbanksysteme/ });
    screen.getByRole('tab', { name: 'Vorlesungen' }).focus();
    expect(await within(screen.getByRole('tabpanel')).findByText('Noch keine Folien.')).toBeInTheDocument();
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Altklausuren' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Altklausuren' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Vorlesungen' })).toHaveAttribute('aria-selected', 'true');
  });

  it('ECTS ist auf 0 bis 60 begrenzt', async () => {
    const core = installFakeCore({ semesters: [makeSemester()], modules: [makeModule()] });
    const user = userEvent.setup();
    modulePage();
    await screen.findByRole('heading', { level: 1, name: /Datenbanksysteme/ });
    await user.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    const ects = screen.getByLabelText('ECTS');
    await user.clear(ects);
    await user.type(ects, '61');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('zwischen 0 und 60');
    expect(writes(core)).toEqual([]);
  });

  it('mehrere Löschungen teilen sich einen Toast; jede neue startet die 10 s neu', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const core = installFakeCore({ semesters: [makeSemester()], modules: [makeModule(), { ...B }] });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const view = render(app(<ModulView />));
    await screen.findByRole('heading', { level: 1, name: /Datenbanksysteme/ });
    await user.click(screen.getByRole('button', { name: 'Löschen' }));
    expect(screen.getByText('Modul gelöscht')).toBeInTheDocument();
    blurActive();
    await vi.advanceTimersByTimeAsync(6000);

    nav.search = `id=${B.id}`;
    view.rerender(app(<ModulView />));
    await screen.findByRole('heading', { level: 1, name: /Statistik/ });
    await user.click(screen.getByRole('button', { name: 'Löschen' }));
    expect(screen.getByText('2 Module gelöscht')).toBeInTheDocument();
    expect(screen.queryByText('Modul gelöscht')).not.toBeInTheDocument();
    blurActive();

    await vi.advanceTimersByTimeAsync(6000); // 12 s seit der ersten, aber erst 6 s seit der zweiten
    expect(writes(core)).toEqual([]);
    await vi.advanceTimersByTimeAsync(4100);
    await waitFor(() => expect(writes(core).map((r) => r.method)).toEqual(['DELETE', 'DELETE']));
  });

  it('Rückgängig bei zwei Löschungen bringt beide Module zurück', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const core = installFakeCore({ semesters: [makeSemester()], modules: [makeModule(), { ...B }] });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const view = render(app(<ModulView />));
    await screen.findByRole('heading', { level: 1, name: /Datenbanksysteme/ });
    await user.click(screen.getByRole('button', { name: 'Löschen' }));
    nav.search = `id=${B.id}`;
    view.rerender(app(<ModulView />));
    await screen.findByRole('heading', { level: 1, name: /Statistik/ });
    await user.click(screen.getByRole('button', { name: 'Löschen' }));
    const sidebar = screen.getByRole('navigation', { name: 'Hauptnavigation' });
    expect(within(sidebar).queryByRole('link', { name: 'Statistik' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Rückgängig' }));
    expect(await within(sidebar).findByRole('link', { name: 'Statistik' })).toBeInTheDocument();
    expect(await within(sidebar).findByRole('link', { name: 'Datenbanksysteme' })).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS + 1000);
    expect(writes(core)).toEqual([]);
  });

  it('der Toast-Timer pausiert bei Hover', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const core = installFakeCore({ semesters: [makeSemester()], modules: [makeModule()] });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(app(<ModulView />));
    await screen.findByRole('heading', { level: 1, name: /Datenbanksysteme/ });
    await user.click(screen.getByRole('button', { name: 'Löschen' }));
    blurActive();
    const toast = screen.getByText('Modul gelöscht').closest('[role="status"]') as HTMLElement;
    await user.hover(toast);
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS + 5000);
    expect(writes(core)).toEqual([]);
    expect(screen.getByText('Modul gelöscht')).toBeInTheDocument();
    await user.unhover(toast);
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS + 100);
    await waitFor(() => expect(writes(core).map((r) => r.method)).toEqual(['DELETE']));
  });

  it('404 beim Löschen gilt als Erfolg, es kommt keine Fehlermeldung', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const core = installFakeCore({ semesters: [makeSemester()], modules: [makeModule()] });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(app(<ModulView />));
    await screen.findByRole('heading', { level: 1, name: /Datenbanksysteme/ });
    await user.click(screen.getByRole('button', { name: 'Löschen' }));
    blurActive();
    (core.modules[0] as { deleted_at: string | null }).deleted_at = '2026-11-04T09:00:00Z';
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS + 100);
    await waitFor(() => expect(writes(core).map((r) => r.method)).toEqual(['DELETE']));
    await vi.advanceTimersByTimeAsync(500);
    expect(screen.queryByText(/konnte nicht gelöscht werden/)).not.toBeInTheDocument();
  });
});

describe('Semester archivieren (Nachbesserung)', () => {
  const A = makeSemester({ id: '0190f6a2-0000-7000-8000-0000000000b1', name: 'HS 2026', is_current: true });
  const B = makeSemester({ id: '0190f6a2-0000-7000-8000-0000000000b2', name: 'FS 2027', is_current: false });

  function settings() {
    return render(
      <ThemeProvider>
        <QueryProvider>
          <ToastProvider>
            <UploadProvider>
              <SettingsView />
            </UploadProvider>
          </ToastProvider>
        </QueryProvider>
      </ThemeProvider>,
    );
  }

  it('archiviert man das aktuelle Semester, rückt das neueste nicht archivierte nach (mit Hinweis)', async () => {
    const core = installFakeCore({ semesters: [B, A] });
    const user = userEvent.setup();
    settings();
    await user.click(await screen.findByRole('button', { name: 'HS 2026 archivieren' }));
    expect(await screen.findByText('HS 2026 archiviert · FS 2027 ist jetzt aktuell')).toBeInTheDocument();
    expect(writes(core).map((r) => [r.path, r.body])).toEqual([
      [`/semesters/${A.id}`, { archived: true }],
      [`/semesters/${B.id}`, { is_current: true }],
    ]);
    expect(core.semesters.filter((s) => s.is_current).map((s) => s.name)).toEqual(['FS 2027']);
  });

  it('gibt es kein weiteres Semester, sagt der Hinweis das', async () => {
    installFakeCore({ semesters: [A] });
    const user = userEvent.setup();
    settings();
    await user.click(await screen.findByRole('button', { name: 'HS 2026 archivieren' }));
    expect(await screen.findByText(/Es gibt kein aktuelles Semester mehr/)).toBeInTheDocument();
  });
});
