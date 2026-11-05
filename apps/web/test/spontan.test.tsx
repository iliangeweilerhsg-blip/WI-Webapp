import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.TZ = 'Europe/Zurich';
});

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HeuteView } from '../src/components/HeuteView.tsx';
import { ModulView } from '../src/components/ModulView.tsx';
import { QueryProvider } from '../src/lib/query.tsx';
import { sessionHref } from '../src/lib/sessions.ts';
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

function boot(ui: 'heute' | 'modul', sessions = [] as ReturnType<typeof makeSession>[]) {
  vi.setSystemTime(new Date('2026-11-04T08:00:00Z'));
  core = installCalendarCore({ semesters: [makeSemester()], modules: [DBS, STAT], sessions });
  nav.search = ui === 'modul' ? `id=${DBS.id}` : '';
  return render(
    <ThemeProvider>
      <QueryProvider>
        <ToastProvider>
          <UploadProvider>{ui === 'heute' ? <HeuteView /> : <ModulView />}</UploadProvider>
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
