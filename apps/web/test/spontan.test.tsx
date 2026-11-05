import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.TZ = 'Europe/Zurich';
});

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HeuteView } from '../src/components/HeuteView.tsx';
import { ModulView } from '../src/components/ModulView.tsx';
import { QueryProvider } from '../src/lib/query.tsx';
import { sessionHref } from '../src/lib/sessions.ts';
import { SyncProvider } from '../src/lib/sync/SyncProvider.tsx';
import type { SyncClient } from '../src/lib/sync/client.ts';
import { ThemeProvider } from '../src/lib/theme.tsx';
import { ToastProvider } from '../src/lib/toast.tsx';
import { UploadProvider } from '../src/lib/uploads.tsx';
import { installCalendarCore, type CalendarCore } from './calendar-core.ts';
import { makeModule, makeSemester, makeSession } from './fake-core.ts';

const nav = vi.hoisted(() => ({ search: '', push: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ push: nav.push }),
}));

const DBS = makeModule({ id: '0190f6a2-0000-7000-8000-0000000000a3', name: 'Datenbanksysteme' });
const STAT = makeModule({ id: '0190f6a2-0000-7000-8000-0000000000a4', name: 'Statistik', color: 'mod-05' });
const RUNNING = makeSession({
  id: '0190f6a2-0000-7000-8000-0000000000e9',
  module_id: STAT.id,
  state: 'laeuft',
  started_at: '2026-11-04T07:00:00Z',
  created_at: '2026-11-04T07:00:00Z',
});

let core: CalendarCore;

/** Sync-Client mit steuerbaren Ereignissen */
function fakeSync() {
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  const client = {
    connectionState: 'online',
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(),
    onEvent: vi.fn((name: string, fn: (data: unknown) => void) => {
      const set = listeners.get(name) ?? new Set();
      set.add(fn);
      listeners.set(name, set);
      return () => void set.delete(fn);
    }),
  };
  return {
    client: client as unknown as SyncClient,
    emit: (name: string, data: unknown) =>
      act(() => {
        for (const fn of listeners.get(name) ?? []) fn(data);
      }),
  };
}

function boot(
  ui: 'heute' | 'modul',
  sessions = [] as ReturnType<typeof makeSession>[],
  sync: SyncClient | null = null,
) {
  vi.setSystemTime(new Date('2026-11-04T08:00:00Z'));
  core = installCalendarCore({ semesters: [makeSemester()], modules: [DBS, STAT], sessions });
  nav.search = ui === 'modul' ? `id=${DBS.id}` : '';
  const view = ui === 'heute' ? <HeuteView /> : <ModulView />;
  return render(
    <ThemeProvider>
      <QueryProvider>
        <ToastProvider>
          <UploadProvider>{sync ? <SyncProvider client={sync}>{view}</SyncProvider> : view}</UploadProvider>
        </ToastProvider>
      </QueryProvider>
    </ThemeProvider>,
  );
}

const posts = (re: RegExp) => core.requests.filter((r) => r.method === 'POST' && re.test(r.path));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  nav.push.mockClear();
  window.localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Session ohne Termin: Heute', () => {
  it('legt an, startet und öffnet das Dashboard', async () => {
    boot('heute');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Session starten' }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledTimes(1));
    const created = posts(/^\/sessions$/);
    expect(created).toHaveLength(1);
    expect(created[0]?.body).toMatchObject({ module_id: DBS.id });
    const id = (created[0]?.body as { id: string }).id;
    expect(posts(new RegExp(`^/sessions/${id}/start$`))).toHaveLength(1);
    expect(nav.push).toHaveBeenCalledWith(sessionHref(id));
    expect(core.sessions[0]?.state).toBe('laeuft');
  });

  it('wählt das zuletzt benutzte Modul vor und merkt sich die Wahl', async () => {
    window.localStorage.setItem('sg.session.lastModule', STAT.id);
    boot('heute');
    const select = await screen.findByRole('combobox', { name: 'Modul' });
    await waitFor(() => expect(select).toHaveValue(STAT.id));
    const user = userEvent.setup();
    await user.selectOptions(select, DBS.id);
    await user.click(screen.getByRole('button', { name: 'Session starten' }));
    await waitFor(() => expect(nav.push).toHaveBeenCalled());
    expect(posts(/^\/sessions$/)[0]?.body).toMatchObject({ module_id: DBS.id });
    expect(window.localStorage.getItem('sg.session.lastModule')).toBe(DBS.id);
  });

  it('Gegenprobe: bei laufender Session gibt es keinen Start, nur „Zur Vorlesung“', async () => {
    boot('heute', [RUNNING]);
    expect(await screen.findByRole('link', { name: 'Zur Vorlesung' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Session starten' })).not.toBeInTheDocument();
    expect(posts(/^\/sessions$/)).toHaveLength(0);
  });

  it('409 beim Start: führt zur laufenden Session', async () => {
    boot('heute');
    const user = userEvent.setup();
    const button = await screen.findByRole('button', { name: 'Session starten' });
    // Eine andere Session wurde inzwischen gestartet (z. B. vom iPad)
    core.sessions.push(RUNNING);
    core.rejectNextCreate = { status: 409, code: 'session_one_active' };
    await user.click(button);
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(sessionHref(RUNNING.id)));
  });

  it('anderer Fehler: verständliche Meldung, keine Navigation', async () => {
    boot('heute');
    const user = userEvent.setup();
    core.rejectNextCreate = { status: 404, code: 'module_not_found' };
    await user.click(await screen.findByRole('button', { name: 'Session starten' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Das gibt es nicht (mehr).');
    expect(nav.push).not.toHaveBeenCalled();
  });
});

describe('Session ohne Termin: Modulseite', () => {
  it('startet genau für dieses Modul und öffnet das Dashboard', async () => {
    boot('modul');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Session starten' }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledTimes(1));
    expect(posts(/^\/sessions$/)[0]?.body).toMatchObject({ module_id: DBS.id });
    const id = (posts(/^\/sessions$/)[0]?.body as { id: string }).id;
    expect(nav.push).toHaveBeenCalledWith(sessionHref(id));
  });

  it('Gegenprobe: bei laufender Session „Zur laufenden Session“ statt Start', async () => {
    boot('modul', [RUNNING]);
    const link = await screen.findByRole('link', { name: 'Zur laufenden Session' });
    expect(link).toHaveAttribute('href', sessionHref(RUNNING.id));
    expect(screen.queryByRole('button', { name: 'Session starten' })).not.toBeInTheDocument();
  });

  it('409 beim Start: führt zur laufenden Session', async () => {
    boot('modul');
    const user = userEvent.setup();
    const button = await screen.findByRole('button', { name: 'Session starten' });
    core.sessions.push(RUNNING);
    core.rejectNextCreate = { status: 409, code: 'session_one_active' };
    await user.click(button);
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(sessionHref(RUNNING.id)));
  });
});

describe('Session ohne Termin: Nacharbeit aus dem Review', () => {
  const failStart = (status: number, code: string) => (core.rejectNextSession = { status, code });
  const createIds = () => posts(/^\/sessions$/).map((r) => (r.body as { id: string }).id);

  it('Modulseite schaltet bei einem Start vom iPad ohne Warten auf „Zur laufenden Session“ um', async () => {
    const sync = fakeSync();
    boot('modul', [], sync.client);
    await screen.findByRole('button', { name: 'Session starten' });
    await sync.emit('session.updated', RUNNING);
    expect(await screen.findByRole('link', { name: 'Zur laufenden Session' })).toHaveAttribute(
      'href',
      sessionHref(RUNNING.id),
    );
    // Ende der Session: der Knopf kommt zurück
    await sync.emit('session.updated', {
      ...RUNNING,
      state: 'beendet',
      updated_at: '2026-11-04T09:00:00Z',
    });
    expect(await screen.findByRole('button', { name: 'Session starten' })).toBeInTheDocument();
  });

  it('Gegenprobe: ohne Abo bleibt der Knopf; ältere Fassung und fremdes Ereignis ändern nichts', async () => {
    boot('modul'); // kein Sync-Client
    await screen.findByRole('button', { name: 'Session starten' });
    expect(screen.queryByRole('link', { name: 'Zur laufenden Session' })).not.toBeInTheDocument();

    const sync = fakeSync();
    boot('modul', [], sync.client);
    const buttons = await screen.findAllByRole('button', { name: 'Session starten' });
    expect(buttons.length).toBeGreaterThan(0);
    await sync.emit('session.updated', { ...RUNNING, state: 'geplant', started_at: null });
    expect(screen.queryByRole('link', { name: 'Zur laufenden Session' })).not.toBeInTheDocument();
  });

  it('älteres Ereignis beendet die bekannte laufende Session nicht', async () => {
    const sync = fakeSync();
    boot('modul', [RUNNING], sync.client);
    await screen.findByRole('link', { name: 'Zur laufenden Session' });
    await sync.emit('session.updated', { ...RUNNING, state: 'beendet', updated_at: '2020-01-01T00:00:00Z' });
    expect(screen.getByRole('link', { name: 'Zur laufenden Session' })).toBeInTheDocument();
  });

  it('Toast, wenn der Start eine andere Session beendet hat (Heute und Modulseite)', async () => {
    for (const ui of ['heute', 'modul'] as const) {
      const view = boot(ui);
      const user = userEvent.setup();
      const button = await screen.findByRole('button', { name: 'Session starten' });
      core.sessions.push(structuredClone(RUNNING)); // inzwischen gestartet, die Ansicht weiß es noch nicht
      await user.click(button);
      expect(await screen.findByText('Die laufende Session wurde beendet.')).toBeInTheDocument();
      view.unmount();
      vi.unstubAllGlobals();
      nav.push.mockClear();
    }
  });

  it('nach gescheitertem Start gilt beim nächsten Tipp dieselbe ID, es bleibt eine Session', async () => {
    boot('heute');
    const user = userEvent.setup();
    const button = await screen.findByRole('button', { name: 'Session starten' });
    failStart(500, 'internal');
    await user.click(button);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Session starten' }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledTimes(1));
    const ids = createIds();
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
    expect(core.sessions).toHaveLength(1);
    expect(core.sessions[0]?.state).toBe('laeuft');
    expect(nav.push).toHaveBeenCalledWith(sessionHref(ids[0] as string));
  });

  it('Start mit 404: nächster Versuch legt mit neuer ID an', async () => {
    boot('heute');
    const user = userEvent.setup();
    const button = await screen.findByRole('button', { name: 'Session starten' });
    failStart(404, 'session_not_found');
    await user.click(button);
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Session starten' }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledTimes(1));
    const ids = createIds();
    expect(ids[1]).not.toBe(ids[0]);
  });

  it('Modulwechsel nach gescheitertem Start löscht die verwaiste bereit-Session', async () => {
    boot('heute');
    const user = userEvent.setup();
    const button = await screen.findByRole('button', { name: 'Session starten' });
    failStart(500, 'internal');
    await user.click(button);
    await screen.findByRole('alert');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Modul' }), STAT.id);
    await user.click(screen.getByRole('button', { name: 'Session starten' }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledTimes(1));
    const [first, second] = createIds();
    expect(core.sessions.find((x) => x.id === first)?.deleted_at).not.toBeNull();
    expect(core.sessions.find((x) => x.id === second)?.state).toBe('laeuft');
  });

  it('Aushängen nach gescheitertem Start löscht die verwaiste bereit-Session', async () => {
    const view = boot('heute');
    const user = userEvent.setup();
    const button = await screen.findByRole('button', { name: 'Session starten' });
    failStart(500, 'internal');
    await user.click(button);
    await screen.findByRole('alert');
    const [id] = createIds();
    view.unmount();
    await waitFor(() => expect(core.sessions.find((x) => x.id === id)?.deleted_at).toBeTruthy());
  });

  it('session_transition_invalid führt nicht zu einer fremden Session, sondern zeigt eine Meldung', async () => {
    boot('heute');
    const user = userEvent.setup();
    const button = await screen.findByRole('button', { name: 'Session starten' });
    core.sessions.push(structuredClone(RUNNING));
    failStart(409, 'session_transition_invalid');
    await user.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent('Das geht bei dieser Session gerade nicht');
    expect(nav.push).not.toHaveBeenCalled();
  });
});
