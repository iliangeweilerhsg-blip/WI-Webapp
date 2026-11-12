import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const nav = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('next/navigation', () => ({
  usePathname: () => '/modul',
  useSearchParams: () => new URLSearchParams('id=0190f6a2-0000-7000-8000-0000000000a1'),
  useRouter: () => ({ push: nav.push }),
}));

import { ModulView } from '../src/components/ModulView.tsx';
import { QueryProvider } from '../src/lib/query.tsx';
import { ThemeProvider } from '../src/lib/theme.tsx';
import { ToastProvider } from '../src/lib/toast.tsx';
import { UploadProvider } from '../src/lib/uploads.tsx';
import { installFakeCore, makeModule, makeNotebook, makeSemester, type FakeCore } from './fake-core.ts';

const VL = makeNotebook({
  id: '0190f6a2-0000-7000-8000-0000000000b1',
  title: 'Vorlesung',
  kind: 'vorlesung',
  page_count: 3,
});
const UE = makeNotebook({
  id: '0190f6a2-0000-7000-8000-0000000000b2',
  title: 'Übung',
  kind: 'uebung',
  page_count: 1,
});
const FREI = makeNotebook({
  id: '0190f6a2-0000-7000-8000-0000000000b3',
  title: 'Skizzen',
  kind: 'frei',
  page_count: 2,
});

function setup() {
  const core = installFakeCore({ semesters: [makeSemester()], modules: [makeModule()] });
  core.notebooks = structuredClone([VL, UE, FREI]);
  render(
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
  return core;
}

const writes = (core: FakeCore) => core.requests.filter((r) => r.method !== 'GET');
const list = () => screen.findByRole('list', { name: 'Notizbücher' });

beforeEach(() => nav.push.mockReset());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Notizbücher im Modul (UX-52)', () => {
  it('zeigt Titel und Seitenzahl; Standard-Notizbücher haben keinen Löschen-Knopf', async () => {
    setup();
    const rows = within(await list()).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Vorlesung');
    expect(rows[0]).toHaveTextContent('3 Seiten');
    expect(rows[1]).toHaveTextContent('1 Seite');
    expect(rows[1]).not.toHaveTextContent('1 Seiten');
    for (const row of rows.slice(0, 2)) {
      expect(within(row).getByRole('button', { name: /umbenennen/ })).toBeInTheDocument();
      expect(within(row).queryByRole('button', { name: /löschen/ })).not.toBeInTheDocument();
    }
    expect(within(rows[2]!).getByRole('button', { name: 'Skizzen löschen' })).toBeInTheDocument();
  });

  it('Umbenennen: Enter speichert, die Zeile zeigt den neuen Titel', async () => {
    const core = setup();
    const user = userEvent.setup();
    await list();
    await user.click(await screen.findByRole('button', { name: 'Skizzen umbenennen' }));
    const input = screen.getByRole('textbox', { name: 'Neuer Titel für Skizzen' });
    await user.clear(input);
    await user.type(input, '  Zeichnungen {Enter}');
    expect(await screen.findByText('Zeichnungen')).toBeInTheDocument();
    expect(writes(core)).toMatchObject([
      { method: 'PATCH', path: `/notebooks/${FREI.id}`, body: { title: 'Zeichnungen' } },
    ]);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('Umbenennen: Escape bricht ab, ohne etwas zu senden', async () => {
    const core = setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Skizzen umbenennen' }));
    await user.type(screen.getByRole('textbox'), 'xyz{Escape}');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByText('Skizzen')).toBeInTheDocument();
    expect(writes(core)).toEqual([]);
  });

  it('Umbenennen: leerer Titel wird nicht gesendet; Standard-Notizbuch lässt sich umbenennen', async () => {
    const core = setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Vorlesung umbenennen' }));
    const input = screen.getByRole('textbox');
    await user.clear(input);
    await user.type(input, '   {Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Der Titel darf nicht leer sein.');
    expect(writes(core)).toEqual([]);
    await user.type(input, 'Plenum{Enter}');
    expect(await screen.findByText('Plenum')).toBeInTheDocument();
    expect(writes(core)).toMatchObject([{ method: 'PATCH', body: { title: 'Plenum' } }]);
  });

  it('Umbenennen: Fehler des Core steht als Meldung an der Zeile', async () => {
    const core = setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Skizzen umbenennen' }));
    // Inzwischen anderswo gelöscht
    core.notebooks.find((n) => n.id === FREI.id)!.deleted_at = '2026-11-04T09:00:00Z';
    await user.type(screen.getByRole('textbox'), 'x{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Dieses Notizbuch gibt es nicht mehr.');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Löschen: ohne Dialog, Leiste „Rückgängig“ holt es über den Papierkorb zurück', async () => {
    const core = setup();
    const confirm = vi.spyOn(window, 'confirm');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Skizzen löschen' }));
    expect(confirm).not.toHaveBeenCalled();

    const toast = (await screen.findByText('„Skizzen“ gelöscht')).closest(
      '[data-testid="toast-live"]',
    ) as HTMLElement;
    expect(within(await list()).queryByText('Skizzen')).not.toBeInTheDocument();
    expect(writes(core)).toMatchObject([{ method: 'DELETE', path: `/notebooks/${FREI.id}` }]);

    await user.click(within(toast).getByRole('button', { name: 'Rückgängig' }));
    expect(await screen.findByText('Skizzen')).toBeInTheDocument();
    expect(writes(core).map((r) => [r.method, r.path])).toEqual([
      ['DELETE', `/notebooks/${FREI.id}`],
      ['POST', `/trash/${FREI.id}/restore`],
    ]);
    expect(core.notebooks.find((n) => n.id === FREI.id)?.deleted_at).toBeNull();
  });

  it('Anlegen: Titel eingeben, Enter, neues freies Notizbuch mit Client-ID (UUIDv7)', async () => {
    const core = setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Notizbuch anlegen' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Titel des neuen Notizbuchs' }),
      ' Repetition {Enter}',
    );
    expect(await screen.findByText('Repetition')).toBeInTheDocument();
    const [post] = writes(core);
    expect(post).toMatchObject({ method: 'POST', path: '/notebooks' });
    expect(post?.body).toMatchObject({
      module_id: '0190f6a2-0000-7000-8000-0000000000a1',
      title: 'Repetition',
    });
    expect((post?.body as { id: string }).id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(post?.body).not.toHaveProperty('kind');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('Anlegen: leerer Titel wird nicht gesendet, Escape schließt', async () => {
    const core = setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Notizbuch anlegen' }));
    await user.type(screen.getByRole('textbox'), '  {Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Der Titel darf nicht leer sein.');
    expect(writes(core)).toEqual([]);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notizbuch anlegen' })).toBeInTheDocument();
  });

  it('Anlegen: scheitert es (Modul inzwischen gelöscht), steht die Meldung am Formular', async () => {
    const core = setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Notizbuch anlegen' }));
    core.modules[0]!.deleted_at = '2026-11-04T09:00:00Z';
    await user.type(screen.getByRole('textbox'), 'Neu{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Das gibt es nicht (mehr).');
    expect(screen.getByRole('textbox')).toHaveValue('Neu');
  });
});
