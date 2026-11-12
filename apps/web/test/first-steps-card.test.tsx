import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  FIRST_STEPS_HIDDEN_KEY,
  FIRST_STEPS_MIC_KEY,
  FirstStepsCard,
} from '../src/components/today/FirstSteps.tsx';
import { QueryProvider } from '../src/lib/query.tsx';
import { makeSession } from './fake-core.ts';

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ push: vi.fn() }),
}));

const NOW = '2026-11-04T07:00:00Z';
const USER = '0190f6a2-0000-7000-8000-000000000001';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const notFound = () => json({ error: { code: 'not_found', message: 'x' } }, 404);

interface Setup {
  calendar: boolean;
  moodle: 'nicht_eingerichtet' | 'ok' | 404;
  backupTarget: boolean;
  ipad: boolean;
  activeSession: boolean;
  down: boolean;
}

let state: Setup;
let paths: string[];

function installCore() {
  paths = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    const path = url.pathname.replace(/^\/api\/v1/, '');
    paths.push(path);
    if (state.down) throw new TypeError('Failed to fetch');
    if (path === '/sessions') {
      return json({
        items: state.activeSession ? [makeSession({ state: 'laeuft' })] : [],
        next_cursor: null,
      });
    }
    if (path === '/calendar/sources') {
      const source = {
        id: '0190f6a2-0000-7000-8000-0000000000c1',
        user_id: USER,
        created_at: NOW,
        updated_at: NOW,
        deleted_at: null,
        kind: 'ics_file',
        name: 'Stundenplan.ics',
        url: null,
        last_synced_at: null,
        last_error: null,
        readonly: false,
        event_count: 3,
      };
      return json({ items: state.calendar ? [source] : [], next_cursor: null });
    }
    if (path === '/moodle/status') {
      if (state.moodle === 404) return notFound();
      return json({
        state: state.moodle,
        site_url: null,
        site_name: null,
        user_fullname: null,
        token_valid_until: null,
        checked_at: null,
      });
    }
    if (path === '/backups') {
      return json({
        status: {
          target: state.backupTarget ? '/Volumes/Backup/StudienGehirn' : null,
          last_success_at: null,
          next_run_at: null,
          stale: false,
          running: false,
          restore_test: null,
        },
        items: [],
        next_cursor: null,
      });
    }
    if (path === '/devices') {
      const ipad = {
        id: '0190f6a2-0000-7000-8000-0000000000d1',
        user_id: USER,
        created_at: NOW,
        updated_at: NOW,
        deleted_at: null,
        name: 'iPad',
        kind: 'ipad',
        last_seen_at: null,
        clock_offset_ms: null,
        app_version: null,
        connected: false,
      };
      return json({ items: state.ipad ? [ipad] : [], next_cursor: null });
    }
    return notFound();
  });
}

function show() {
  return render(
    <QueryProvider>
      <FirstStepsCard />
    </QueryProvider>,
  );
}

const card = () => screen.findByRole('region', { name: 'Erste Schritte' });

beforeEach(() => {
  state = {
    calendar: true,
    moodle: 'nicht_eingerichtet',
    backupTarget: false,
    ipad: false,
    activeSession: false,
    down: false,
  };
  installCore();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Erste Schritte: Karte (UX-14)', () => {
  it('zeigt offene und erledigte Punkte mit Stand für Screenreader und Link zur passenden Seite', async () => {
    show();
    const region = await card();
    expect(within(region).getByText('1 von 5 erledigt')).toBeInTheDocument();
    const items = within(region).getAllByRole('listitem');
    expect(items).toHaveLength(5);
    expect(items[0]).toHaveTextContent('Stundenplan eintragen (erledigt)');
    expect(items[1]).toHaveTextContent('Moodle verbinden (offen)');
    expect(within(items[0] as HTMLElement).queryByRole('link')).toBeNull();
    expect(within(items[1] as HTMLElement).getByRole('link', { name: 'Zu Moodle' })).toHaveAttribute(
      'href',
      '/einstellungen?bereich=moodle',
    );
  });

  it('Mikrofon selbst abhaken: gemerkt im Browser, Fokus bleibt in der Karte', async () => {
    show();
    const region = await card();
    await userEvent.click(within(region).getByRole('button', { name: 'Habe ich getestet' }));
    expect(within(region).getByText('2 von 5 erledigt')).toBeInTheDocument();
    expect(window.localStorage.getItem(FIRST_STEPS_MIC_KEY)).toBe('1');
    expect(within(region).getByRole('heading', { name: 'Erste Schritte' })).toHaveFocus();
  });

  it('Ausblenden: Karte weg und bleibt weg, ohne die vier Abfragen', async () => {
    const first = show();
    await userEvent.click(within(await card()).getByRole('button', { name: 'Erste Schritte ausblenden' }));
    expect(screen.queryByRole('region', { name: 'Erste Schritte' })).toBeNull();
    expect(window.localStorage.getItem(FIRST_STEPS_HIDDEN_KEY)).toBe('1');
    first.unmount();

    paths = [];
    show();
    await waitFor(() => expect(paths).toContain('/sessions'));
    expect(screen.queryByRole('region', { name: 'Erste Schritte' })).toBeNull();
    expect(paths.filter((p) => p !== '/sessions')).toEqual([]);
  });

  it('alles erledigt: keine Karte, und beim nächsten Mal wird nichts mehr abgefragt', async () => {
    state = { ...state, moodle: 'ok', backupTarget: true, ipad: true };
    window.localStorage.setItem(FIRST_STEPS_MIC_KEY, '1');
    show();
    await waitFor(() => expect(window.localStorage.getItem(FIRST_STEPS_HIDDEN_KEY)).toBe('1'));
    expect(screen.queryByRole('region', { name: 'Erste Schritte' })).toBeNull();
  });

  it('während einer Session: keine Karte und keine zusätzlichen Abfragen', async () => {
    state.activeSession = true;
    show();
    await waitFor(() => expect(paths).toContain('/sessions'));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('region', { name: 'Erste Schritte' })).toBeNull();
    expect(paths.filter((p) => p !== '/sessions')).toEqual([]);
  });

  it('eine Abfrage scheitert (404, z. B. älterer Core): keine Karte statt falscher Punkte', async () => {
    state.moodle = 404;
    show();
    await waitFor(() => expect(paths).toContain('/moodle/status'));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('region', { name: 'Erste Schritte' })).toBeNull();
  });

  it('Core nicht erreichbar: keine Karte, kein Fehler', async () => {
    state.down = true;
    show();
    await waitFor(() => expect(paths).toContain('/sessions'));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('region', { name: 'Erste Schritte' })).toBeNull();
  });
});
