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
import { SETUP_SKIPPED_KEY } from '../src/components/SetupDialog.tsx';
import { UNDO_WINDOW_MS, resetPendingModuleDeletes } from '../src/lib/modules.ts';
import { QueryProvider } from '../src/lib/query.tsx';
import { suggestSemesterName } from '../src/lib/semesters.ts';
import { ThemeProvider } from '../src/lib/theme.tsx';
import { ToastProvider } from '../src/lib/toast.tsx';
import { UploadProvider } from '../src/lib/uploads.tsx';
import { installFakeCore, makeModule, makeSemester, type FakeCore } from './fake-core.ts';

function shell(children: ReactNode = <p>Inhalt</p>) {
  return render(
    <ThemeProvider>
      <QueryProvider>
        <AppShell>{children}</AppShell>
      </QueryProvider>
    </ThemeProvider>,
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

describe('suggestSemesterName', () => {
  it('schlägt Herbst- und Frühjahrssemester aus dem Datum vor', () => {
    expect(suggestSemesterName(new Date(2026, 10, 4))).toBe('HS 2026'); // November
    expect(suggestSemesterName(new Date(2027, 0, 12))).toBe('HS 2026'); // Januar gehört noch dazu
    expect(suggestSemesterName(new Date(2027, 2, 1))).toBe('FS 2027');
    expect(suggestSemesterName(new Date(2027, 8, 1))).toBe('HS 2027');
  });
});

describe('Einrichtungsdialog', () => {
  it('führt durch Semester und Module: Enter legt an, die Liste wächst, die Seitenleiste folgt', async () => {
    const core = installFakeCore();
    const user = userEvent.setup();
    shell();

    const dialog = await screen.findByRole('dialog', { name: /Semester/ });
    const semester = within(dialog).getByLabelText('Semester');
    expect(semester).toHaveValue(suggestSemesterName());
    expect(semester).toHaveFocus();

    await user.clear(semester);
    await user.type(semester, 'HS 2026{Enter}');

    // Schritt 2
    const moduleInput = await within(dialog).findByLabelText('Modulname');
    expect(moduleInput).toHaveFocus();
    await user.type(moduleInput, 'Datenbanksysteme{Enter}');
    await within(dialog).findByText('Datenbanksysteme');
    expect(moduleInput).toHaveValue('');
    expect(moduleInput).toHaveFocus();
    await user.type(moduleInput, 'Statistik{Enter}');
    const list = await within(dialog).findByRole('list', { name: 'Angelegte Module' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Datenbanksysteme', 'Statistik']);

    // Anfragen: erst Semester, dann beide Module im neuen Semester, jede POST mit Idempotency-Key
    const sent = writes(core);
    expect(sent.map((r) => [r.method, r.path])).toEqual([
      ['POST', '/semesters'],
      ['POST', '/modules'],
      ['POST', '/modules'],
    ]);
    expect(sent[0]?.body).toEqual({ name: 'HS 2026' });
    const semesterId = core.semesters[0]?.id;
    const clientId = expect.stringMatching(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(sent[1]?.body).toEqual({ id: clientId, semester_id: semesterId, name: 'Datenbanksysteme' });
    expect(sent[2]?.body).toEqual({ id: clientId, semester_id: semesterId, name: 'Statistik' });
    for (const r of sent) expect(r.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Set(sent.map((r) => r.headers['Idempotency-Key'])).size).toBe(3);

    // Die Seitenleiste zeigt die neuen Module mit automatischer Farbe
    const sidebar = screen.getByRole('navigation', { name: 'Hauptnavigation' });
    const first = await within(sidebar).findByRole('link', { name: 'Datenbanksysteme' });
    const second = await within(sidebar).findByRole('link', { name: 'Statistik' });
    const dot = (a: HTMLElement) =>
      (a.querySelector('span[aria-hidden]') as HTMLElement).style.backgroundColor;
    expect(dot(first)).toBe('var(--sg-mod-01)');
    expect(dot(second)).toBe('var(--sg-mod-02)');

    await user.click(within(dialog).getByRole('button', { name: 'Fertig' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('bleibt offen, auch wenn das Semester schon angelegt ist (Liste ist nicht mehr leer)', async () => {
    installFakeCore();
    const user = userEvent.setup();
    shell();
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Semester'), '{Enter}');
    await within(dialog).findByLabelText('Modulname');
    // Nach dem Neuladen der Semester darf der Dialog nicht verschwinden
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('„Später“ blendet ihn aus und merkt sich das; die Seitenleiste bietet „Einrichten“ an', async () => {
    installFakeCore();
    const user = userEvent.setup();
    const view = shell();
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Später' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(window.localStorage.getItem(SETUP_SKIPPED_KEY)).toBe('1');

    // Nach einem Neuladen kommt er nicht von selbst wieder …
    view.unmount();
    shell();
    await screen.findByText('Noch keine Module');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // … aber über „Einrichten“
    await user.click(screen.getByRole('button', { name: 'Einrichten' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('Esc überspringt ebenfalls', async () => {
    installFakeCore();
    const user = userEvent.setup();
    shell();
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('erscheint nicht, wenn es schon ein Semester gibt oder der Core fehlt', async () => {
    installFakeCore({ semesters: [makeSemester()] });
    shell();
    await screen.findByText('Noch keine Module');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    resetPendingModuleDeletes();
    vi.unstubAllGlobals();

    installFakeCore({ down: true });
    shell();
    await screen.findAllByText('Core nicht erreichbar', {}, { timeout: 4000 });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('meldet einen Fehler ruhig im Dialog und lässt die Eingabe stehen', async () => {
    const core = installFakeCore();
    const user = userEvent.setup();
    shell();
    const dialog = await screen.findByRole('dialog');
    await user.clear(within(dialog).getByLabelText('Semester'));
    await user.type(within(dialog).getByLabelText('Semester'), 'HS 2026');
    core.down = true; // Core fällt vor dem Absenden aus
    await user.click(within(dialog).getByRole('button', { name: 'Weiter' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Core nicht erreichbar');
    expect(within(dialog).getByLabelText('Semester')).toHaveValue('HS 2026');
  });
});

describe('Seitenleiste', () => {
  it('zeigt nur die Module des aktuellen Semesters', async () => {
    const hs = makeSemester({
      id: '0190f6a2-0000-7000-8000-0000000000b1',
      name: 'HS 2026',
      is_current: true,
    });
    const fs = makeSemester({
      id: '0190f6a2-0000-7000-8000-0000000000b2',
      name: 'FS 2026',
      is_current: false,
    });
    installFakeCore({
      semesters: [hs, fs],
      modules: [
        makeModule({ id: '0190f6a2-0000-7000-8000-0000000000a1', name: 'Aktuell', semester_id: hs.id }),
        makeModule({ id: '0190f6a2-0000-7000-8000-0000000000a2', name: 'Alt', semester_id: fs.id }),
      ],
    });
    shell();
    expect(await screen.findByRole('link', { name: 'Aktuell' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Alt' })).not.toBeInTheDocument();
  });
});

describe('Modulseite', () => {
  const MOD = makeModule();

  beforeEach(() => {
    nav.pathname = '/modul';
    nav.search = `id=${MOD.id}`;
  });

  it('zeigt Kopf mit Name, Kürzel, Farbe und die vier Tabs mit ruhigen leeren Zuständen', async () => {
    installFakeCore({ semesters: [makeSemester()], modules: [makeModule()] });
    const user = userEvent.setup();
    modulePage();
    const heading = await screen.findByRole('heading', { level: 1, name: /Datenbanksysteme/ });
    expect(heading).toHaveTextContent('DBS');
    expect((heading.querySelector('span[aria-hidden]') as HTMLElement).style.backgroundColor).toBe(
      'var(--sg-mod-03)',
    );
    expect(screen.getByText('Klausur · 6 ECTS')).toBeInTheDocument();

    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual(['Vorlesungen', 'Übungen', 'Konzepte', 'Altklausuren']);
    expect(screen.getByRole('tab', { name: 'Vorlesungen' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('Noch keine Folien.')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Altklausuren' }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Noch keine Altklausuren');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Vorlesungen' })).toHaveAttribute('aria-selected', 'true');
  });

  it('bearbeitet Name, Kürzel, Farbe, ECTS, Prüfungsform und Dozent und sendet ein PATCH', async () => {
    const core = installFakeCore({ semesters: [makeSemester()], modules: [makeModule()] });
    const user = userEvent.setup();
    modulePage();
    await screen.findByRole('heading', { level: 1, name: /Datenbanksysteme/ });
    await user.click(screen.getByRole('button', { name: 'Bearbeiten' }));

    const form = screen.getByRole('form', { name: 'Modul bearbeiten' });
    const name = within(form).getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Datenbanken');
    const short = within(form).getByLabelText('Kürzel');
    await user.clear(short);
    await user.type(short, 'DB');
    const ects = within(form).getByLabelText('ECTS');
    await user.clear(ects);
    await user.type(ects, '4,5');
    const exam = within(form).getByLabelText('Prüfungsform');
    await user.clear(exam);
    await user.type(within(form).getByLabelText('Dozent oder Dozentin'), 'Prof. Muster');
    await user.click(within(form).getByRole('radio', { name: 'Farbe 9' }));
    await user.click(within(form).getByRole('button', { name: 'Speichern' }));

    await waitFor(() =>
      expect(screen.queryByRole('form', { name: 'Modul bearbeiten' })).not.toBeInTheDocument(),
    );
    expect(writes(core)).toEqual([
      {
        method: 'PATCH',
        path: `/modules/${MOD.id}`,
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: {
          name: 'Datenbanken',
          short_name: 'DB',
          color: 'mod-09',
          ects: 4.5,
          exam_type: null,
          lecturer: 'Prof. Muster',
        },
      },
    ]);
    const heading = await screen.findByRole('heading', { level: 1, name: /Datenbanken/ });
    expect(heading).toHaveTextContent('DB');
    expect(screen.getByText('4.5 ECTS · Prof. Muster')).toBeInTheDocument();
  });

  it('prüft ECTS vor dem Senden', async () => {
    const core = installFakeCore({ semesters: [makeSemester()], modules: [makeModule()] });
    const user = userEvent.setup();
    modulePage();
    await screen.findByRole('heading', { level: 1, name: /Datenbanksysteme/ });
    await user.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    const ects = screen.getByLabelText('ECTS');
    await user.clear(ects);
    await user.type(ects, 'viel');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ECTS');
    expect(writes(core)).toEqual([]);
  });

  it('Löschen blendet sofort aus, zeigt den Toast und sendet DELETE erst nach 10 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const core = installFakeCore({ semesters: [makeSemester()], modules: [makeModule()] });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    shell(<ModulView />);
    await screen.findByRole('heading', { level: 1, name: /Datenbanksysteme/ });
    const sidebar = screen.getByRole('navigation', { name: 'Hauptnavigation' });
    expect(within(sidebar).getByRole('link', { name: 'Datenbanksysteme' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Löschen' }));

    // sofort weg aus Seitenleiste und Modulseite, Toast mit Rückgängig, Weiterleitung nach Heute
    expect(within(sidebar).queryByRole('link', { name: 'Datenbanksysteme' })).not.toBeInTheDocument();
    const toast = screen.getByText('Modul gelöscht').closest('[data-testid="toast-live"]') as HTMLElement;
    expect(within(toast).getByRole('button', { name: 'Rückgängig' })).toBeInTheDocument();
    expect(nav.push).toHaveBeenCalledWith('/');
    expect(writes(core)).toEqual([]);
    // Fokus liegt auf „Rückgängig“ und pausiert den Timer nicht
    expect(within(toast).getByRole('button', { name: 'Rückgängig' })).toHaveFocus();

    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS - 500);
    expect(writes(core)).toEqual([]);
    expect(screen.getByText('Modul gelöscht')).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(600);
    await waitFor(() =>
      expect(writes(core).map((r) => [r.method, r.path])).toEqual([['DELETE', `/modules/${MOD.id}`]]),
    );
    await waitFor(() => expect(screen.queryByText('Modul gelöscht')).not.toBeInTheDocument());
    expect(core.modules[0]?.deleted_at).not.toBeNull();
    expect(within(sidebar).queryByRole('link', { name: 'Datenbanksysteme' })).not.toBeInTheDocument();
  });

  it('Rückgängig bringt das Modul zurück und sendet nie ein DELETE', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const core = installFakeCore({ semesters: [makeSemester()], modules: [makeModule()] });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    shell(<ModulView />);
    await screen.findByRole('heading', { level: 1, name: /Datenbanksysteme/ });
    await user.click(screen.getByRole('button', { name: 'Löschen' }));
    const sidebar = screen.getByRole('navigation', { name: 'Hauptnavigation' });
    expect(within(sidebar).queryByRole('link', { name: 'Datenbanksysteme' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Rückgängig' }));
    expect(await within(sidebar).findByRole('link', { name: 'Datenbanksysteme' })).toBeInTheDocument();
    expect(screen.queryByText('Modul gelöscht')).not.toBeInTheDocument();
    // Modulseite ist wieder da
    expect(await screen.findByRole('heading', { level: 1, name: /Datenbanksysteme/ })).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS + 1000);
    expect(writes(core)).toEqual([]);
    expect(core.modules[0]?.deleted_at).toBeNull();
  });

  it('scheitert das Löschen, ist das Modul wieder da und eine ruhige Meldung erscheint', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const core = installFakeCore({ semesters: [makeSemester()], modules: [makeModule()] });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    shell(<ModulView />);
    await screen.findByRole('heading', { level: 1, name: /Datenbanksysteme/ });
    await user.click(screen.getByRole('button', { name: 'Löschen' }));
    act(() => (document.activeElement as HTMLElement).blur());
    core.down = true;
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS + 100);
    expect(await screen.findByText(/konnte nicht gelöscht werden/)).toBeInTheDocument();
    core.down = false;
    const sidebar = screen.getByRole('navigation', { name: 'Hauptnavigation' });
    expect(await within(sidebar).findByRole('link', { name: 'Datenbanksysteme' })).toBeInTheDocument();
  });

  it('unbekannte Modul-ID: ruhiger Hinweis statt Fehler', async () => {
    nav.search = 'id=0190f6a2-0000-7000-8000-0000000000ff';
    installFakeCore({ semesters: [makeSemester()], modules: [makeModule()] });
    modulePage();
    expect(await screen.findByText(/Dieses Modul gibt es nicht \(mehr\)/)).toBeInTheDocument();
  });
});

describe('Einstellungen → Semester', () => {
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

  it('listet Semester und markiert das aktuelle mit Text', async () => {
    installFakeCore({ semesters: [B, A] });
    settings();
    const list = await screen.findByRole('list', { name: 'Semester' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    const current = items.find((li) => li.textContent?.includes('HS 2026')) as HTMLElement;
    expect(within(current).getByText('aktuell')).toBeInTheDocument();
    expect(within(current).queryByRole('button', { name: /als aktuell setzen/ })).not.toBeInTheDocument();
  });

  it('setzt ein Semester als aktuell (PATCH) und die Anzeige folgt', async () => {
    const core = installFakeCore({ semesters: [B, A] });
    const user = userEvent.setup();
    settings();
    await user.click(await screen.findByRole('button', { name: 'FS 2027 als aktuell setzen' }));

    await waitFor(() => {
      const list = screen.getByRole('list', { name: 'Semester' });
      const fs = within(list)
        .getAllByRole('listitem')
        .find((li) => li.textContent?.includes('FS 2027')) as HTMLElement;
      expect(within(fs).getByText('aktuell')).toBeInTheDocument();
    });
    expect(writes(core)).toEqual([
      expect.objectContaining({ method: 'PATCH', path: `/semesters/${B.id}`, body: { is_current: true } }),
    ]);
    const list = screen.getByRole('list', { name: 'Semester' });
    const hs = within(list)
      .getAllByRole('listitem')
      .find((li) => li.textContent?.includes('HS 2026')) as HTMLElement;
    expect(within(hs).queryByText('aktuell')).not.toBeInTheDocument();
    expect(within(hs).getByRole('button', { name: 'HS 2026 als aktuell setzen' })).toBeInTheDocument();
  });

  it('archiviert und stellt wieder her', async () => {
    const core = installFakeCore({ semesters: [B, A] });
    const user = userEvent.setup();
    settings();
    await user.click(await screen.findByRole('button', { name: 'FS 2027 archivieren' }));
    const archivedList = await screen.findByRole('list', { name: 'Archivierte Semester' });
    expect(within(archivedList).getByText('FS 2027')).toBeInTheDocument();
    expect(writes(core)[0]).toMatchObject({ path: `/semesters/${B.id}`, body: { archived: true } });

    await user.click(within(archivedList).getByRole('button', { name: 'FS 2027 wiederherstellen' }));
    await waitFor(() =>
      expect(screen.queryByRole('list', { name: 'Archivierte Semester' })).not.toBeInTheDocument(),
    );
    expect(writes(core)[1]).toMatchObject({ path: `/semesters/${B.id}`, body: { archived: false } });
  });

  it('legt ein Semester an', async () => {
    const core = installFakeCore({ semesters: [A] });
    const user = userEvent.setup();
    settings();
    await screen.findByRole('list', { name: 'Semester' });
    await user.type(screen.getByLabelText('Neues Semester'), 'FS 2027');
    await user.click(screen.getByRole('button', { name: 'Anlegen' }));
    expect(await screen.findByText('FS 2027')).toBeInTheDocument();
    expect(writes(core)[0]).toMatchObject({ method: 'POST', path: '/semesters', body: { name: 'FS 2027' } });
    expect(screen.getByLabelText('Neues Semester')).toHaveValue('');
  });
});
