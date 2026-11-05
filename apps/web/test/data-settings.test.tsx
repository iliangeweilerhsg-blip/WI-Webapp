import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataSettings, formatSize } from '../src/components/settings/DataSettings.tsx';
import { TrashSettings, daysLeft } from '../src/components/settings/TrashSettings.tsx';
import { QueryProvider } from '../src/lib/query.tsx';
import { ToastProvider } from '../src/lib/toast.tsx';

const NOW = Date.now();
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
const UUID = (n: number) => `019a4e14-0000-7000-8000-${String(n).padStart(12, '0')}`;

interface Call {
  method: string;
  path: string;
  body: unknown;
}

function backupOverview(target: string | null, extra: Record<string, unknown> = {}) {
  return {
    status: {
      target,
      last_success_at: target ? iso(-3_600_000) : null,
      next_run_at: target ? iso(3_600_000) : null,
      stale: true,
      running: false,
      restore_test: null,
      ...extra,
    },
    items: target
      ? [
          {
            id: UUID(1),
            user_id: UUID(0),
            created_at: iso(-3_600_000),
            updated_at: iso(-3_600_000),
            deleted_at: null,
            started_at: iso(-3_600_000),
            finished_at: iso(-3_000_000),
            target,
            size_bytes: 2048,
            state: 'fertig',
            error: null,
            trigger: 'zeitplan',
            stand: '20261104T030012Z',
          },
        ]
      : [],
    next_cursor: null,
  };
}

const settings = (target: string | null) => ({
  general: { data_dir: '/d', content_lang: 'de', appearance: 'system' },
  lecture: {
    microphone_id: null,
    auto_stop_after_end_min: 10,
    auto_stop_quiet_window_min: 3,
    auto_stop_hard_after_end_min: 30,
    auto_stop_silence_min: 15,
    auto_stop_max_duration_min: 240,
    auto_stop_warning_s: 60,
    auto_stop_extend_min: 15,
    default_layout: 'standard',
    default_ink_mode: 'freie_seite',
    toolbar_side: 'rechts',
  },
  pen: {
    double_tap: 'radierer',
    squeeze: 'werkzeugpalette',
    shape_recognition: false,
    favorite_colors: [
      '#1E2A44FF',
      '#C92A2AFF',
      '#1864ABFF',
      '#2B8A3EFF',
      '#E67700FF',
      '#5F3DC4FF',
      '#495057FF',
      '#000000FF',
    ],
  },
  data: { backup_target: target, backup_encryption: false, backup_time: '03:00' },
});

function trashItem(n: number, title: string) {
  return {
    id: UUID(100 + n),
    kind: 'module',
    title,
    deleted_at: iso(-86_400_000),
    purge_at: iso(29 * 86_400_000),
    parent: { id: UUID(5), kind: 'semester', title: 'HS 2026' },
    dependent_count: 3,
  };
}

function stubCore(handler: (call: Call) => unknown) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      const call: Call = {
        method: init?.method ?? 'GET',
        path: url.pathname.replace('/api/v1', '') + url.search,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(call);
      const result = handler(call);
      if (result instanceof Response) return result;
      if (result === null) return new Response(null, { status: 204 });
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  return calls;
}

function mount(ui: React.ReactElement) {
  return render(
    <QueryProvider>
      <ToastProvider>{ui}</ToastProvider>
    </QueryProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Hilfsfunktionen', () => {
  it('formatSize und daysLeft', () => {
    expect(formatSize(null)).toBe('–');
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(2048)).toBe('2.0 KB');
    expect(daysLeft(iso(29 * 86_400_000 + 1000), new Date(NOW))).toBe(30);
    expect(daysLeft(iso(-1000), new Date(NOW))).toBe(0);
  });
});

describe('Restore-Test (F-DAT-02)', () => {
  const result = (over: Record<string, unknown>) => ({
    state: 'ok',
    trigger: 'zeitplan',
    started_at: iso(-86_400_000),
    finished_at: iso(-86_400_000 + 5000),
    stand: '20261104T030012Z',
    is_latest: true,
    reason: null,
    error: null,
    ...over,
  });
  const core = (restore_test: unknown, calls?: (c: Call) => unknown) =>
    stubCore((c) => {
      const custom = calls?.(c);
      if (custom !== undefined) return custom;
      return c.path.startsWith('/backups')
        ? backupOverview('/Volumes/B', { restore_test })
        : settings('/Volumes/B');
    });

  it('noch kein Test: Erklärung, Knopf „Jetzt testen“ startet POST /restore-test', async () => {
    const calls = core(null, (c) =>
      c.method === 'POST' && c.path === '/restore-test'
        ? result({ state: 'laeuft', finished_at: null })
        : undefined,
    );
    const user = userEvent.setup();
    mount(<DataSettings />);
    expect(await screen.findByText(/Restore-Test: noch nicht gelaufen/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Jetzt testen' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path === '/restore-test')).toBe(true),
    );
  });

  it('bestanden: „Letzter Restore-Test: <Datum>, erfolgreich“', async () => {
    core(result({}));
    mount(<DataSettings />);
    const date = new Date(NOW - 86_400_000 + 5000).toLocaleString('de-DE');
    expect(await screen.findByText(`Letzter Restore-Test: ${date}, erfolgreich`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Jetzt testen' })).toBeEnabled();
  });

  it('läuft: Hinweis und gesperrter Knopf', async () => {
    core(result({ state: 'laeuft', finished_at: null }));
    mount(<DataSettings />);
    expect(await screen.findByText(/Restore-Test läuft/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Test läuft …' })).toBeDisabled();
  });

  it('Fehler: verständlicher Hinweis mit Handlungsempfehlung und technischem Text', async () => {
    core(result({ state: 'fehler', reason: 'nicht_authentisch', error: 'Manifest passt nicht' }));
    mount(<DataSettings />);
    expect(await screen.findByText(/, fehlgeschlagen$/)).toBeInTheDocument();
    expect(screen.getByText(/nicht zu deinem protokollierten Backup/)).toBeInTheDocument();
    expect(screen.getByText(/Neues Backup|neues Backup an/)).toBeInTheDocument();
    expect(screen.getByText('Technisch: Manifest passt nicht')).toBeInTheDocument();
  });

  it('zeigt den getesteten Stand und warnt, wenn es nicht der jüngste war', async () => {
    core(result({ is_latest: true }));
    const first = mount(<DataSettings />);
    expect(await screen.findByText(/Getesteter Stand:/)).toBeInTheDocument();
    expect(screen.queryByText(/nicht dein jüngstes Backup/)).not.toBeInTheDocument();
    first.unmount();
    core(result({ is_latest: false }));
    mount(<DataSettings />);
    expect(await screen.findByText(/nicht dein jüngstes Backup/)).toBeInTheDocument();
  });

  it('kein Ziel: eigener Hinweis statt „kein Backup“', async () => {
    core(
      result({
        state: 'fehler',
        reason: 'kein_ziel',
        stand: null,
        error: 'Es ist kein Backup-Ziel eingestellt.',
      }),
    );
    mount(<DataSettings />);
    expect(
      await screen.findByText(/kein Backup-Ziel eingestellt, darum gibt es nichts zu testen/),
    ).toBeInTheDocument();
  });

  it('ohne Ziel ist „Jetzt testen“ gesperrt', async () => {
    stubCore((c) => (c.path.startsWith('/backups') ? backupOverview(null) : settings(null)));
    mount(<DataSettings />);
    expect(await screen.findByRole('button', { name: 'Jetzt testen' })).toBeDisabled();
  });
});

describe('DataSettings', () => {
  it('ohne Ziel: Hinweis statt „veraltet“, „Jetzt sichern“ ist gesperrt', async () => {
    stubCore((c) => (c.path.startsWith('/backups') ? backupOverview(null) : settings(null)));
    mount(<DataSettings />);
    expect(await screen.findByText(/Kein Backup-Ziel eingerichtet/)).toBeInTheDocument();
    expect(screen.queryByText(/veraltet/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Jetzt sichern' })).toBeDisabled();
  });

  it('mit Ziel: Status, Lauf in der Tabelle, Speichern schickt PATCH /settings, Jetzt sichern POST /backup', async () => {
    const calls = stubCore((c) => {
      if (c.method === 'POST' && c.path === '/backup') return backupOverview('/Volumes/B').items[0];
      if (c.method === 'PATCH') return settings('/Volumes/B2');
      return c.path.startsWith('/backups') ? backupOverview('/Volumes/B') : settings('/Volumes/B');
    });
    const user = userEvent.setup();
    mount(<DataSettings />);
    expect(await screen.findByText(/Letztes Backup:/)).toBeInTheDocument();
    expect(screen.getByText(/veraltet/)).toBeInTheDocument();
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();

    const input = screen.getByLabelText(/Backup-Ziel/);
    await user.clear(input);
    await user.type(input, '/Volumes/B2');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      data: { backup_target: '/Volumes/B2', backup_time: '03:00' },
    });

    await user.click(screen.getByRole('button', { name: 'Jetzt sichern' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/backup')).toBe(true));
  });

  it('ohne Altbestand gibt es keinen Verschlüsselungs-Hinweis und keine Option', async () => {
    stubCore((c) => (c.path.startsWith('/backups') ? backupOverview('/x') : settings('/x')));
    mount(<DataSettings />);
    await screen.findByText(/Letztes Backup:/);
    expect(screen.queryByText(/noch nicht verfügbar/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/verschlüsseln/i)).not.toBeInTheDocument();
  });

  it('Altbestand backup_encryption=true: Hinweis, Knopf schickt backup_encryption=false', async () => {
    const legacy = settings('/x');
    legacy.data.backup_encryption = true;
    const calls = stubCore((c) => {
      if (c.method === 'PATCH') return settings('/x');
      return c.path.startsWith('/backups') ? backupOverview('/x') : legacy;
    });
    const user = userEvent.setup();
    mount(<DataSettings />);
    expect(await screen.findByText(/noch nicht verfügbar/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ohne Verschlüsselung sichern' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ data: { backup_encryption: false } });
  });

  it('zeigt den Fehler des Core als Meldung (backup_running)', async () => {
    stubCore((c) => {
      if (c.method === 'POST')
        return new Response(JSON.stringify({ error: { code: 'backup_running', message: 'läuft' } }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        });
      return c.path.startsWith('/backups') ? backupOverview('/x') : settings('/x');
    });
    const user = userEvent.setup();
    mount(<DataSettings />);
    await user.click(await screen.findByRole('button', { name: 'Jetzt sichern' }));
    await waitFor(() => expect(screen.getByTestId('toast-live')).not.toBeEmptyDOMElement());
  });
});

describe('TrashSettings', () => {
  it('leer', async () => {
    stubCore(() => ({ items: [], next_cursor: null }));
    mount(<TrashSettings />);
    expect(await screen.findByText('Der Papierkorb ist leer.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Papierkorb leeren' })).toBeDisabled();
  });

  it('listet, stellt wieder her, löscht endgültig nach Bestätigung, lädt weitere Seiten, leert', async () => {
    let page2Served = false;
    const calls = stubCore((c) => {
      if (c.method === 'GET' && c.path.includes('cursor=')) {
        page2Served = true;
        return { items: [trashItem(2, 'Zweites Modul')], next_cursor: null };
      }
      if (c.method === 'GET') return { items: [trashItem(1, 'Erstes Modul')], next_cursor: 'abc' };
      if (c.method === 'POST') return { id: UUID(101), kind: 'module', restored_count: 4 };
      if (c.method === 'DELETE' && c.path === '/trash') return { purged_count: 2 };
      return null;
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    mount(<TrashSettings />);
    expect(await screen.findByText('Erstes Modul')).toBeInTheDocument();
    expect(screen.getByText(/mit 3 abhängigen Objekten/)).toBeInTheDocument();
    expect(screen.getByText(/noch 29 Tage|noch 30 Tage/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Mehr laden' }));
    expect(await screen.findByText('Zweites Modul')).toBeInTheDocument();
    expect(page2Served).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Erstes Modul wiederherstellen' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path === `/trash/${UUID(101)}/restore`)).toBe(true),
    );
    expect(await screen.findByText('Erstes Modul wiederhergestellt')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Zweites Modul endgültig löschen' }));
    expect(confirm).toHaveBeenCalled();
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.path === `/trash/${UUID(102)}`)).toBe(true),
    );
    expect(await screen.findByText('Zweites Modul endgültig gelöscht')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Papierkorb leeren' }));
    expect(await screen.findByText('Papierkorb geleert (2)')).toBeInTheDocument();
  });

  it('ohne Bestätigung wird nichts gelöscht', async () => {
    const calls = stubCore(() => ({ items: [trashItem(1, 'Erstes Modul')], next_cursor: null }));
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    mount(<TrashSettings />);
    await user.click(await screen.findByRole('button', { name: 'Erstes Modul endgültig löschen' }));
    await user.click(screen.getByRole('button', { name: 'Papierkorb leeren' }));
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });
});
