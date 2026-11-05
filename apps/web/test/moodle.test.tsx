// T1-23: Moodle in der Web-App: Kurszuordnung, Abgleich, Inbox, Fristen. Alle Kurse und Namen sind erfunden.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.TZ = 'Europe/Zurich';
});

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import type {
  MoodleCourse,
  MoodleCourseLink,
  MoodleItem,
  MoodleStatus,
  MoodleSyncedDeadline,
  MoodleSyncStatus,
} from '@sg/shared';

const search = vi.hoisted(() => ({ value: '' }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(search.value),
  useRouter: () => ({ push: vi.fn() }),
}));

import { HeuteView } from '../src/components/HeuteView.tsx';
import { MoodleDeadlines } from '../src/components/MoodleDeadlines.tsx';
import { MoodleInbox } from '../src/components/MoodleInbox.tsx';
import { ModulView } from '../src/components/ModulView.tsx';
import { SettingsView } from '../src/components/SettingsView.tsx';
import { formatDue } from '../src/lib/moodle.ts';
import { QueryProvider } from '../src/lib/query.tsx';
import { ThemeProvider } from '../src/lib/theme.tsx';
import { ToastProvider } from '../src/lib/toast.tsx';
import { UploadProvider } from '../src/lib/uploads.tsx';
import { installFakeCore, makeModule, makeSemester, type FakeCore } from './fake-core.ts';

const DBS = makeModule({
  id: '0190f6a2-0000-7000-8000-0000000000a1',
  name: 'Datenbanksysteme',
  short_name: 'DBS',
});
const STAT = makeModule({ id: '0190f6a2-0000-7000-8000-0000000000a2', name: 'Statistik', color: 'mod-05' });
const NOW = '2026-11-05T12:00:00Z';

function course(overrides: Partial<MoodleCourse>): MoodleCourse {
  return {
    moodle_id: 901,
    short_name: 'DBS-DEMO',
    full_name: 'Datenbanksysteme (Beispielkurs)',
    start_date: '2026-10-01',
    end_date: null,
    url: 'https://moodle.example.org/course/view.php?id=901',
    last_access_at: null,
    module_id: null,
    suggested_module_id: null,
    category: 'aktuell',
    ...overrides,
  };
}

function item(overrides: Partial<MoodleItem>): MoodleItem {
  return {
    id: '0190f6a2-0000-7000-8000-000000000301',
    moodle_course_id: 901,
    module_id: DBS.id,
    cmid: 5003,
    activity_name: 'Material',
    filename: 'Skript.pdf',
    file_ref: '/5003/mod_folder/content/1/Skript.pdf',
    mime_type: 'application/pdf',
    is_pdf: true,
    size_bytes: 182_344,
    modified_at: NOW,
    kind: 'offen',
    kind_source: 'auto',
    slide_deck_id: null,
    exercise_sheet_id: null,
    removed_in_moodle_at: null,
    last_error: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

interface MoodleFake {
  status: MoodleStatus;
  sync: MoodleSyncStatus;
  courses: MoodleCourse[];
  links: MoodleCourseLink[];
  items: MoodleItem[];
  deadlines: MoodleSyncedDeadline[];
  /** Verzögert schreibende Anfragen (Doppelklick-Tests) */
  delayMs: number;
  /** POST /moodle/auto-assign wie im Core (#141): ändert den Stand und liefert, was geschah */
  onAutoAssign?: () => { assigned: number; created: number };
  /** Verzögert GET /moodle/courses (Moodle ist langsamer als die lokalen Endpunkte) */
  coursesDelayMs?: number;
}

/** Moodle-Endpunkte (VERTRAEGE §17) über dem Fake-Core */
function installMoodle(core: FakeCore, initial: Partial<MoodleFake> = {}): MoodleFake {
  const fake: MoodleFake = {
    status: {
      state: 'ok',
      site_url: 'https://moodle.example.org',
      site_name: 'Beispiel-Moodle',
      user_fullname: 'Erika Beispiel',
      token_valid_until: '2027-01-31',
      checked_at: NOW,
    },
    sync: { state: 'bereit', connection: 'ok', last_run: null, next_run_at: null },
    courses: [],
    links: [],
    items: [],
    deadlines: [],
    delayMs: 0,
    ...initial,
  };
  const decidedAt = new Map<string, number>();
  let decisionClock = 0;
  const inner = globalThis.fetch;
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      const path = url.pathname.replace(/^\/api\/v1/, '');
      const method = init?.method ?? 'GET';
      const restore = /^\/trash\/([0-9a-f-]{36})\/restore$/.exec(path);
      if (restore && method === 'POST') {
        core.requests.push({ method, path, body: null, headers: {} });
        const module = core.modules.find((m) => m.id === restore[1]);
        if (module) module.deleted_at = null;
        return json({ id: restore[1], kind: 'module', restored_count: 1 });
      }
      if (!path.startsWith('/moodle/')) return inner(input, init);
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      core.requests.push({ method, path: path + url.search, body, headers: {} });
      if (path === '/moodle/status') return json(fake.status);
      if (path === '/moodle/sync' && method === 'GET') return json(fake.sync);
      if (path === '/moodle/sync' && method === 'POST') {
        fake.sync = { ...fake.sync, state: 'laeuft' };
        return json(fake.sync, 202);
      }
      if (fake.delayMs > 0 && method !== 'GET') await new Promise((r) => setTimeout(r, fake.delayMs));
      if (path === '/moodle/courses') {
        if (fake.coursesDelayMs) await new Promise((r) => setTimeout(r, fake.coursesDelayMs));
        if (fake.status.state === 'nicht_eingerichtet') {
          return json({ error: { code: 'moodle_not_configured', message: 'x' } }, 503);
        }
        if (fake.status.state === 'ungueltig' || fake.status.state === 'abgelaufen') {
          return json({ error: { code: 'moodle_token_invalid', message: 'x' } }, 409);
        }
        if (fake.status.state === 'nicht_erreichbar') {
          return json({ error: { code: 'moodle_unreachable', message: 'x' } }, 502);
        }
        return json({ items: fake.courses });
      }
      if (path === '/moodle/auto-assign' && method === 'POST') {
        const automatic = fake.onAutoAssign;
        fake.onAutoAssign = undefined;
        return json(automatic?.() ?? { assigned: 0, created: 0 });
      }
      if (path === '/moodle/links') return json({ items: fake.links });
      const removeModule = /^\/moodle\/links\/(\d+)\/module$/.exec(path);
      if (removeModule && method === 'DELETE') {
        const id = Number(removeModule[1]);
        const target = fake.links.find((l) => l.moodle_course_id === id);
        if (!target?.module_removable) {
          return json({ error: { code: 'moodle_module_not_removable', message: 'x' } }, 409);
        }
        // Wie im Core: Modul in den Papierkorb, die Zuordnung bleibt (unsichtbar) stehen
        const removed = core.modules.find((m) => m.id === target.module_id);
        if (removed) removed.deleted_at = NOW;
        fake.links = fake.links.filter((l) => l.moodle_course_id !== id);
        fake.courses = fake.courses.map((c) => (c.moodle_id === id ? { ...c, module_id: null } : c));
        return new Response(null, { status: 204 });
      }
      const link = /^\/moodle\/links\/(\d+)$/.exec(path);
      if (link && method === 'PUT') {
        const id = Number(link[1]);
        const before = fake.links.find((l) => l.moodle_course_id === id);
        const same = before?.module_id === body?.module_id;
        const created: MoodleCourseLink = {
          moodle_course_id: id,
          module_id: String(body?.module_id),
          sync_enabled: body?.sync_enabled === undefined ? true : Boolean(body.sync_enabled),
          last_synced_at: null,
          auto: same ? (before?.auto ?? null) : null,
          module_removable: same ? (before?.module_removable ?? false) : false,
          created_at: NOW,
          updated_at: NOW,
        };
        fake.links = [...fake.links.filter((l) => l.moodle_course_id !== id), created];
        fake.courses = fake.courses.map((c) =>
          c.moodle_id === id ? { ...c, module_id: created.module_id, suggested_module_id: null } : c,
        );
        return json(created);
      }
      if (link && method === 'DELETE') {
        const id = Number(link[1]);
        fake.links = fake.links.filter((l) => l.moodle_course_id !== id);
        fake.courses = fake.courses.map((c) => (c.moodle_id === id ? { ...c, module_id: null } : c));
        return new Response(null, { status: 204 });
      }
      if (path === '/moodle/items') {
        const kind = url.searchParams.get('kind');
        const moduleId = url.searchParams.get('module_id');
        return json({
          items: fake.items.filter(
            (i) => (!kind || i.kind === kind) && (!moduleId || i.module_id === moduleId),
          ),
        });
      }
      const itemMatch = /^\/moodle\/items\/([0-9a-f-]{36})$/.exec(path);
      if (itemMatch && method === 'PATCH') {
        const target = fake.items.find((i) => i.id === itemMatch[1]);
        if (!target) return json({ error: { code: 'moodle_item_not_found', message: 'x' } }, 404);
        // Wie im Core (decideItem): eine Entscheidung erfasst die Datei und die noch OFFENEN Dateien derselben
        // Aktivität; „offen“ nimmt die Datei und alle mit derselben Entscheidung (gleicher Zeitstempel) zurück
        const sameActivity = (i: MoodleItem) =>
          i.cmid === target.cmid && i.moodle_course_id === target.moodle_course_id;
        const stamp = decidedAt.get(target.id);
        const revert = body?.kind === 'offen';
        const affected = revert
          ? fake.items.filter(
              (i) =>
                i.id === target.id ||
                (stamp !== undefined && sameActivity(i) && decidedAt.get(i.id) === stamp),
            )
          : fake.items.filter((i) => i.id === target.id || (sameActivity(i) && i.kind === 'offen'));
        decisionClock += 1;
        for (const i of affected) {
          Object.assign(i, { kind: body?.kind, kind_source: revert ? 'auto' : 'manuell' });
          if (revert) decidedAt.delete(i.id);
          else decidedAt.set(i.id, decisionClock);
        }
        return json(target);
      }
      if (path === '/moodle/synced-deadlines') {
        const moduleId = url.searchParams.get('module_id');
        const limit = Number(url.searchParams.get('limit') ?? 50);
        return json({
          items: fake.deadlines.filter((d) => !moduleId || d.module_id === moduleId).slice(0, limit),
        });
      }
      return json({ error: { code: 'not_found', message: 'x' } }, 404);
    }),
  );
  return fake;
}

function wrap(children: ReactNode) {
  return render(
    <ThemeProvider>
      <QueryProvider>
        <ToastProvider>
          <UploadProvider>{children}</UploadProvider>
        </ToastProvider>
      </QueryProvider>
    </ThemeProvider>,
  );
}

function deadline(overrides: Partial<MoodleSyncedDeadline>): MoodleSyncedDeadline {
  return {
    id: '0190f6a2-0000-7000-8000-000000000401',
    source: 'aufgabe',
    moodle_course_id: 901,
    module_id: DBS.id,
    assignment_id: 701,
    event_id: null,
    cmid: 6101,
    name: 'Abgabe Übungsblatt 1',
    due_at: '2026-11-12T22:59:00Z',
    url: 'https://moodle.example.org/mod/assign/view.php?id=6101',
    exercise_sheet_id: '0190f6a2-0000-7000-8000-000000000501',
    removed_in_moodle_at: null,
    ...overrides,
  };
}

/** Zwei Klicks ohne Rendern dazwischen (Doppelklick-Sperre per Ref, Review #134 N1) */
function twice(element: HTMLElement) {
  fireEvent.click(element);
  fireEvent.click(element);
}

let core: FakeCore;
beforeEach(() => {
  window.localStorage.clear();
  search.value = '';
  window.history.replaceState(null, '', '/');
  core = installFakeCore({ semesters: [makeSemester()], modules: [DBS, STAT] });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function openMoodleTab() {
  window.history.replaceState(null, '', '/einstellungen?bereich=moodle');
  wrap(<SettingsView />);
  await waitFor(() =>
    expect(screen.getByRole('tab', { name: 'Moodle' })).toHaveAttribute('aria-selected', 'true'),
  );
}

describe('Einstellungen › Moodle (F-MDL-03)', () => {
  it('zeigt Vorschläge, ordnet erst nach Bestätigung zu und klappt weitere Kurse ein', async () => {
    const fake = installMoodle(core, {
      courses: [
        course({ suggested_module_id: DBS.id }),
        course({ moodle_id: 904, full_name: 'Statistik', short_name: 'STAT' }),
        course({
          moodle_id: 902,
          full_name: 'Klausurtermine Beispielfakultät',
          short_name: 'KT',
          category: 'organisatorisch',
        }),
      ],
    });
    await openMoodleTab();
    const user = userEvent.setup();

    const row = (await screen.findByText('Datenbanksysteme (Beispielkurs)')).closest('li') as HTMLElement;
    expect(within(row).getByText('Vorschlag')).toBeInTheDocument();
    expect(within(row).getByRole('combobox')).toHaveValue(DBS.id);
    // Ohne Vorschlag: noch nichts gewählt, kein Knopf
    const stat = screen.getByText('Statistik', { selector: 'p' }).closest('li') as HTMLElement;
    expect(within(stat).queryByRole('button', { name: 'Zuordnen' })).toBeNull();
    // Organisatorische Kurse stehen eingeklappt unter „Weitere Kurse“
    const more = screen.getByText(/Weitere Kurse \(1\)/).closest('details') as HTMLElement;
    expect(more).not.toHaveAttribute('open');
    expect(within(more).getByText('Klausurtermine Beispielfakultät')).toBeInTheDocument();
    expect(core.requests.some((r) => r.method === 'PUT')).toBe(false);

    await user.click(within(row).getByRole('button', { name: 'Zuordnen' }));
    await waitFor(() =>
      expect(core.requests.find((r) => r.method === 'PUT')).toMatchObject({
        path: '/moodle/links/901',
        body: { module_id: DBS.id },
      }),
    );
    expect(await screen.findByText(/Zugeordnet zu Datenbanksysteme/)).toBeInTheDocument();
    expect(fake.links).toHaveLength(1);
    const linked = (await screen.findByText('Datenbanksysteme (Beispielkurs)')).closest('li') as HTMLElement;
    expect(await within(linked).findByRole('button', { name: 'Lösen' })).toBeInTheDocument();
    expect(within(linked).getByRole('checkbox', { name: 'Abgleichen' })).toBeChecked();

    // Anderes Modul wählen: „Ändern“
    await user.selectOptions(within(linked).getByRole('combobox'), STAT.id);
    await user.click(within(linked).getByRole('button', { name: 'Ändern' }));
    await waitFor(() => expect(fake.links[0]?.module_id).toBe(STAT.id));

    // Lösen
    const relinked = (await screen.findByText('Datenbanksysteme (Beispielkurs)')).closest(
      'li',
    ) as HTMLElement;
    await user.click(within(relinked).getByRole('button', { name: 'Lösen' }));
    await waitFor(() => expect(fake.links).toHaveLength(0));
    expect(await screen.findByText(/Übernommenes Material bleibt im Modul/)).toBeInTheDocument();
  });

  it('„Jetzt abgleichen“ startet den Abgleich und zeigt ihn ruhig an', async () => {
    const fake = installMoodle(core, {
      sync: {
        state: 'bereit',
        connection: 'ok',
        next_run_at: null,
        last_run: {
          trigger: 'zeitplan',
          started_at: '2026-11-05T10:00:00Z',
          finished_at: '2026-11-05T10:00:12Z',
          ok: true,
          error_code: null,
          courses: 2,
          files_new: 3,
          files_changed: 0,
          files_imported: 2,
          inbox_new: 1,
          deadlines: 4,
          failed_courses: [],
        },
      },
    });
    await openMoodleTab();
    expect(await screen.findByText(/2 Kurse · 2 übernommen · 1 in der Inbox/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Jetzt abgleichen' }));
    expect(await screen.findByRole('button', { name: 'Gleicht ab …' })).toBeDisabled();
    expect(core.requests.filter((r) => r.method === 'POST' && r.path === '/moodle/sync')).toHaveLength(1);
    expect(fake.sync.state).toBe('laeuft');
  });

  const LINK: MoodleCourseLink = {
    moodle_course_id: 901,
    module_id: DBS.id,
    sync_enabled: true,
    last_synced_at: '2026-11-05T11:00:00Z',
    auto: null,
    module_removable: false,
    created_at: NOW,
    updated_at: NOW,
  };
  const status = (state: MoodleStatus['state']): MoodleStatus => ({
    state,
    site_url: 'https://moodle.example.org',
    site_name: 'Beispiel-Moodle',
    user_fullname: 'Erika Beispiel',
    token_valid_until: '2026-11-10',
    checked_at: NOW,
  });
  const loginHints = () =>
    screen.queryAllByText((_, el) => el?.tagName === 'CODE' && el.textContent === 'pnpm sg moodle login');

  it('Zugang ok: „gültig bis“, kein Hinweis zum Erneuern', async () => {
    installMoodle(core, { status: status('ok'), courses: [course({ module_id: DBS.id })], links: [LINK] });
    await openMoodleTab();
    expect(await screen.findByText(/Zugang gültig bis 10\.11\.2026/)).toBeInTheDocument();
    expect(loginHints()).toHaveLength(0);
  });

  it('läuft bald ab: „gültig bis“ und genau ein ruhiger Hinweis', async () => {
    installMoodle(core, {
      status: status('laeuft_bald_ab'),
      courses: [course({ module_id: DBS.id })],
      links: [LINK],
    });
    await openMoodleTab();
    expect(await screen.findByText(/Zugang gültig bis 10\.11\.2026/)).toBeInTheDocument();
    expect(await screen.findByText(/läuft am 10\.11\.2026 ab/)).toBeInTheDocument();
    expect(loginHints()).toHaveLength(1);
  });

  it.each(['abgelaufen', 'ungueltig'] as const)(
    '%s: ein Hinweis, kein „gültig bis“, Zuordnungen aus /moodle/links bleiben bedienbar',
    async (state) => {
      const fake = installMoodle(core, {
        status: status(state),
        sync: { state: 'pausiert', connection: state, last_run: null, next_run_at: null },
        links: [LINK],
      });
      await openMoodleTab();
      expect(await screen.findByText(/nimmt den Zugang nicht mehr an/)).toBeInTheDocument();
      // Die Kursliste ist beantwortet (abgelehnt), erst dann zählt das Fehlen des Satzes
      await waitFor(() => expect(core.requests.some((r) => r.path === '/moodle/courses')).toBe(true));
      await new Promise((r) => setTimeout(r, 50));
      expect(loginHints()).toHaveLength(1);
      expect(screen.queryByText(/gültig bis/)).toBeNull();
      expect(screen.queryByText(/sobald Moodle antwortet/)).toBeNull();
      expect(screen.getByRole('button', { name: 'Jetzt abgleichen' })).toBeDisabled();
      // Ohne Kursliste: die Zuordnung mit Modul, Schalter und „Lösen“
      const row = (await screen.findByText('Moodle-Kurs 901')).closest('li') as HTMLElement;
      expect(within(row).getByRole('combobox')).toHaveValue(DBS.id);
      expect(within(row).getByRole('checkbox', { name: 'Abgleichen' })).toBeChecked();
      await userEvent.setup().click(within(row).getByRole('button', { name: 'Lösen' }));
      await waitFor(() => expect(fake.links).toHaveLength(0));
    },
  );

  it('nicht erreichbar: kein Hinweis zum Erneuern, Kursliste kommt später', async () => {
    installMoodle(core, { status: status('nicht_erreichbar'), links: [LINK] });
    await openMoodleTab();
    expect(await screen.findByText(/sobald Moodle antwortet/)).toBeInTheDocument();
    expect(loginHints()).toHaveLength(0);
    expect(screen.queryByText(/gültig bis/)).toBeNull();
    expect(await screen.findByText('Moodle-Kurs 901')).toBeInTheDocument();
    expect(screen.getByText('Zugeordnete Kurse:')).toBeInTheDocument();
  });

  it('Kursliste lädt noch: kein Zwischenstand „Zugeordnete Kurse“, erst die Kurse (#135)', async () => {
    installMoodle(core, {
      courses: [course({ module_id: DBS.id })],
      links: [LINK],
      coursesDelayMs: 150,
    });
    await openMoodleTab();
    expect(await screen.findByText('Lädt die Kurse aus Moodle …')).toBeInTheDocument();
    // Die Zuordnungen sind schon da, die Ersatzansicht darf trotzdem nicht aufblitzen
    await waitFor(() => expect(core.requests.some((r) => r.path === '/moodle/links')).toBe(true));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('Zugeordnete Kurse:')).toBeNull();
    expect(screen.queryByText('Moodle-Kurs 901')).toBeNull();
    expect(await screen.findByText('Datenbanksysteme (Beispielkurs)')).toBeInTheDocument();
    expect(screen.queryByText('Zugeordnete Kurse:')).toBeNull();
  });

  it('Neuladen der Kurse schlägt fehl: keine doppelte Ersatzliste, die alten Kurse bleiben (#135)', async () => {
    const fake = installMoodle(core, {
      courses: [course({ module_id: DBS.id })],
      links: [LINK],
    });
    await openMoodleTab();
    const row = () => screen.getByText('Datenbanksysteme (Beispielkurs)').closest('li') as HTMLElement;
    await screen.findByText('Datenbanksysteme (Beispielkurs)');
    // Moodle fällt aus; das Umschalten löst ein Neuladen der Kursliste aus
    fake.status = { ...fake.status, state: 'nicht_erreichbar' };
    await userEvent.setup().click(within(row()).getByRole('checkbox', { name: 'Abgleichen' }));
    await screen.findByText(/sobald Moodle antwortet/);
    expect(screen.queryByText('Zugeordnete Kurse:')).toBeNull();
    expect(screen.getAllByText('Datenbanksysteme (Beispielkurs)')).toHaveLength(1);
    expect(screen.queryByText('Moodle-Kurs 901')).toBeNull();
  });

  it('Fokus auf die Auswahl erst, wenn sie nicht mehr gesperrt ist (#135)', async () => {
    // Synchroner Frame: ein Fokus im Erfolgs-Callback träfe die noch gesperrte Auswahl (disabled nimmt keinen Fokus)
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    const fake = installMoodle(core, { courses: [course({ suggested_module_id: DBS.id })], delayMs: 50 });
    await openMoodleTab();
    const row = () => screen.getByText('Datenbanksysteme (Beispielkurs)').closest('li') as HTMLElement;
    await screen.findByText('Datenbanksysteme (Beispielkurs)');
    await userEvent.setup().click(within(row()).getByRole('button', { name: 'Zuordnen' }));
    await waitFor(() => expect(fake.links).toHaveLength(1));
    await waitFor(() => expect(document.activeElement).toBe(within(row()).getByRole('combobox')));
  });

  it('Doppelklick auf Zuordnen, Schalter und Lösen ergibt je eine Anfrage (Review N1); Fokus danach auf der Auswahl (N3)', async () => {
    const fake = installMoodle(core, { courses: [course({ suggested_module_id: DBS.id })], delayMs: 50 });
    await openMoodleTab();
    const row = () => screen.getByText('Datenbanksysteme (Beispielkurs)').closest('li') as HTMLElement;
    await screen.findByText('Datenbanksysteme (Beispielkurs)');
    const assign = within(row()).getByRole('button', { name: 'Zuordnen' });
    // Zwei Klicks im selben Takt, bevor React neu rendert (isPending bzw. disabled greifen dann noch nicht)
    twice(assign);
    await waitFor(() => expect(fake.links).toHaveLength(1));
    expect(core.requests.filter((r) => r.method === 'PUT')).toHaveLength(1);
    await waitFor(() => expect(within(row()).getByRole('combobox')).toHaveFocus());

    const toggle = await within(row()).findByRole('checkbox', { name: 'Abgleichen' });
    twice(toggle);
    await waitFor(() => expect(core.requests.filter((r) => r.method === 'PUT')).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 120));
    expect(core.requests.filter((r) => r.method === 'PUT')).toHaveLength(2);

    twice(within(row()).getByRole('button', { name: 'Lösen' }));
    await waitFor(() => expect(fake.links).toHaveLength(0));
    await new Promise((r) => setTimeout(r, 120));
    expect(core.requests.filter((r) => r.method === 'DELETE')).toHaveLength(1);
  });

  it('„Jetzt abgleichen“: Doppelklick startet einen Abgleich (Review N1)', async () => {
    installMoodle(core, { delayMs: 50 });
    await openMoodleTab();
    twice(await screen.findByRole('button', { name: 'Jetzt abgleichen' }));
    await new Promise((r) => setTimeout(r, 120));
    expect(core.requests.filter((r) => r.method === 'POST' && r.path === '/moodle/sync')).toHaveLength(1);
  });

  it('nicht eingerichtet: ein Satz, wie es geht', async () => {
    installMoodle(core, {
      status: {
        state: 'nicht_eingerichtet',
        site_url: null,
        site_name: null,
        user_fullname: null,
        token_valid_until: null,
        checked_at: null,
      },
    });
    await openMoodleTab();
    expect(await screen.findByText('Moodle ist noch nicht eingerichtet')).toBeInTheDocument();
    expect(core.requests.some((r) => r.path === '/moodle/courses')).toBe(false);
  });
});

describe('Einstellungen › Moodle: automatische Zuordnung (#141)', () => {
  const MARKETING = makeModule({
    id: '0190f6a2-0000-7000-8000-0000000000c1',
    name: 'Einführung in das Marketing',
    short_name: 'EiM',
    color: 'mod-04',
  });
  const autoLink = (overrides: Partial<MoodleCourseLink>): MoodleCourseLink => ({
    moodle_course_id: 2001,
    module_id: MARKETING.id,
    sync_enabled: true,
    last_synced_at: null,
    auto: 'angelegt',
    module_removable: true,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  });
  const marketing = course({
    moodle_id: 2001,
    full_name: 'Einführung in das Marketing WiSe 26/27',
    short_name: 'EiM-WS2627',
    module_id: MARKETING.id,
  });
  const wi = course({
    moodle_id: 2005,
    full_name: 'Einführung in die Wirtschaftsinformatik WiSe 26/27',
    short_name: 'EWI WS26/27',
    module_id: DBS.id,
  });
  const rowOf = (name: string) => screen.getByText(name).closest('li') as HTMLElement;

  it('zeigt den Vermerk je Zeile, „Modul entfernen“ nur bei leeren, automatisch angelegten Modulen', async () => {
    core.modules.push(MARKETING);
    installMoodle(core, {
      courses: [marketing, wi],
      links: [
        autoLink({}),
        autoLink({ moodle_course_id: 2005, module_id: DBS.id, auto: 'zugeordnet', module_removable: false }),
      ],
    });
    await openMoodleTab();
    await screen.findByText(marketing.full_name);
    await waitFor(() =>
      expect(within(rowOf(marketing.full_name)).getByText(/Modul automatisch angelegt/)).toBeInTheDocument(),
    );
    expect(within(rowOf(marketing.full_name)).getByRole('combobox')).toHaveValue(MARKETING.id);
    expect(
      within(rowOf(marketing.full_name)).getByRole('button', { name: 'Modul entfernen' }),
    ).toBeInTheDocument();
    expect(within(rowOf(wi.full_name)).getByText(/automatisch zugeordnet/)).toBeInTheDocument();
    expect(within(rowOf(wi.full_name)).queryByRole('button', { name: 'Modul entfernen' })).toBeNull();
    expect(within(rowOf(wi.full_name)).getByRole('button', { name: 'Lösen' })).toBeInTheDocument();
    // Mit aktuellem Semester kein Hinweis
    expect(screen.queryByText(/zuerst das/)).toBeNull();
  });

  it('„Modul entfernen“ legt das Modul in den Papierkorb, „Rückgängig“ holt es zurück', async () => {
    core.modules.push(MARKETING);
    const fake = installMoodle(core, { courses: [marketing], links: [autoLink({})] });
    await openMoodleTab();
    const user = userEvent.setup();
    await screen.findByText(marketing.full_name);
    await user.click(
      await within(rowOf(marketing.full_name)).findByRole('button', { name: 'Modul entfernen' }),
    );
    await waitFor(() =>
      expect(core.requests.some((r) => r.method === 'DELETE' && r.path === '/moodle/links/2001/module')).toBe(
        true,
      ),
    );
    expect(fake.links).toHaveLength(0);
    expect(
      await screen.findByText(/Einführung in das Marketing entfernt\. Das Modul liegt im Papierkorb/),
    ).toBeInTheDocument();
    await waitFor(() => expect(within(rowOf(marketing.full_name)).getByRole('combobox')).toHaveValue(''));
    await user.click(screen.getByRole('button', { name: 'Rückgängig' }));
    await waitFor(() =>
      expect(
        core.requests.some((r) => r.method === 'POST' && r.path === `/trash/${MARKETING.id}/restore`),
      ).toBe(true),
    );
  });

  it('stößt beim Öffnen einmal die Automatik an und lädt danach Zuordnungen und Module neu', async () => {
    const fake = installMoodle(core, { courses: [{ ...marketing, module_id: null }] });
    // Wie der Core: POST /moodle/auto-assign legt das Modul samt Zuordnung an
    fake.onAutoAssign = () => {
      core.modules.push(MARKETING);
      fake.links = [autoLink({})];
      fake.courses = [marketing];
      return { assigned: 0, created: 1 };
    };
    await openMoodleTab();
    await screen.findByText(marketing.full_name);
    await waitFor(() =>
      expect(within(rowOf(marketing.full_name)).getByText(/Modul automatisch angelegt/)).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        within(rowOf(marketing.full_name)).getByRole('option', { name: MARKETING.name }),
      ).toBeInTheDocument(),
    );
    expect(within(rowOf(marketing.full_name)).getByRole('combobox')).toHaveValue(MARKETING.id);
    expect(within(rowOf(marketing.full_name)).queryByRole('button', { name: 'Zuordnen' })).toBeNull();
    expect(core.requests.filter((r) => r.path === '/moodle/auto-assign')).toHaveLength(1);
    // Die Kursliste selbst schreibt nichts: Sie ist ein reines GET
    expect(core.requests.filter((r) => r.path === '/moodle/courses').every((r) => r.method === 'GET')).toBe(
      true,
    );
  });

  it('ohne Einrichtung kein Anstoß der Automatik', async () => {
    installMoodle(core, {
      status: {
        state: 'nicht_eingerichtet',
        site_url: null,
        site_name: null,
        user_fullname: null,
        token_valid_until: null,
        checked_at: null,
      },
    });
    await openMoodleTab();
    expect(await screen.findByText('Moodle ist noch nicht eingerichtet')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(core.requests.some((r) => r.path === '/moodle/auto-assign')).toBe(false);
  });

  it('ordnet der Abgleich zu, während die Seite offen ist, folgt die Zeile', async () => {
    const fake = installMoodle(core, { courses: [{ ...marketing, module_id: null }] });
    await openMoodleTab();
    await screen.findByText(marketing.full_name);
    expect(within(rowOf(marketing.full_name)).getByRole('combobox')).toHaveValue('');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Jetzt abgleichen' }));
    await screen.findByRole('button', { name: 'Gleicht ab …' });
    // Der Abgleich legt das Modul an und ordnet zu, danach lädt die Seite neu (Abfrage alle 2 s). Moodle antwortet
    // langsamer als die lokalen Zuordnungen: Die neuen Module müssen trotzdem nachgeladen werden
    fake.coursesDelayMs = 150;
    core.modules.push(MARKETING);
    fake.links = [autoLink({})];
    fake.courses = [marketing];
    fake.sync = { ...fake.sync, state: 'bereit' };
    await waitFor(
      () =>
        expect(
          within(rowOf(marketing.full_name)).getByText(/Modul automatisch angelegt/),
        ).toBeInTheDocument(),
      { timeout: 4000 },
    );
    await waitFor(() =>
      expect(within(rowOf(marketing.full_name)).getByRole('combobox')).toHaveValue(MARKETING.id),
    );
    expect(within(rowOf(marketing.full_name)).queryByRole('button', { name: 'Zuordnen' })).toBeNull();
  }, 10_000);

  it.each([
    ['ohne Semester', [], 'Lege zuerst das Semester an.'],
    ['ohne aktuelles Semester', [makeSemester({ is_current: false })], 'Wähle zuerst das aktuelle Semester.'],
  ])('%s: ruhiger Hinweis mit Link zu den Semestern', async (_, semesters, text) => {
    core.semesters = semesters;
    installMoodle(core, { courses: [{ ...marketing, module_id: null }] });
    await openMoodleTab();
    const hint = (await screen.findByText(text)).closest('p') as HTMLElement;
    expect(hint).toHaveAttribute('role', 'status');
    expect(within(hint).getByRole('link', { name: 'Zu den Semestern' })).toHaveAttribute(
      'href',
      '/einstellungen?bereich=allgemein',
    );
  });
});

describe('Inbox (F-MDL-04)', () => {
  function inboxPage() {
    return wrap(
      <section>
        <h1 id="screen-title" tabIndex={-1}>
          Inbox
        </h1>
        <MoodleInbox />
      </section>,
    );
  }

  it('„Ignorieren“ hat „Rückgängig“: zurück auf offen (Review M2)', async () => {
    const fake = installMoodle(core, { items: [item({})] });
    inboxPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Ignorieren' }));
    expect(await screen.findByText(/Nichts zu entscheiden/)).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Rückgängig' }));
    await waitFor(() =>
      expect(core.requests.filter((r) => r.method === 'PATCH').map((r) => r.body)).toEqual([
        { kind: 'ignoriert' },
        { kind: 'offen' },
      ]),
    );
    expect(fake.items[0]?.kind).toBe('offen');
    expect(await screen.findByText('Skript.pdf')).toBeInTheDocument();
    expect(screen.queryByText(/ab Phase 2/)).toBeNull();
  });

  it('Doppelklick ergibt eine Entscheidung (N1); Fokus auf die nächste Datei, dann auf die Überschrift (N3)', async () => {
    installMoodle(core, {
      items: [
        item({}),
        item({
          id: '0190f6a2-0000-7000-8000-000000000302',
          cmid: 5004,
          activity_name: 'Übung',
          filename: 'Anhang.pdf',
          file_ref: '/5004/x/Anhang.pdf',
        }),
      ],
      delayMs: 50,
    });
    inboxPage();
    const user = userEvent.setup();
    const first = (await screen.findByText('Skript.pdf')).closest('li') as HTMLElement;
    twice(within(first).getByRole('button', { name: 'Als Folien' }));
    await waitFor(() => expect(screen.queryByText('Skript.pdf')).toBeNull());
    expect(core.requests.filter((r) => r.method === 'PATCH')).toHaveLength(1);
    const second = screen.getByText('Anhang.pdf').closest('li') as HTMLElement;
    await waitFor(() => expect(within(second).getByRole('button', { name: 'Als Folien' })).toHaveFocus());

    await user.click(within(second).getByRole('button', { name: 'Als Übung' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inbox' })).toHaveFocus());
  });

  it('Fokus nach der Entscheidung: Dateien derselben Aktivität verschwinden mit, Ziel ist die nächste andere Aktivität (#135)', async () => {
    installMoodle(core, {
      items: [
        item({}),
        item({
          id: '0190f6a2-0000-7000-8000-000000000302',
          filename: 'Anhang.pdf',
          file_ref: '/5003/x/Anhang.pdf',
        }),
        item({
          id: '0190f6a2-0000-7000-8000-000000000303',
          cmid: 5004,
          activity_name: 'Übung',
          filename: 'Blatt.pdf',
          file_ref: '/5004/x/Blatt.pdf',
        }),
      ],
    });
    inboxPage();
    const user = userEvent.setup();
    const first = (await screen.findByText('Skript.pdf')).closest('li') as HTMLElement;
    await user.click(within(first).getByRole('button', { name: 'Als Folien' }));
    await waitFor(() => expect(screen.queryByText('Skript.pdf')).toBeNull());
    // Anhang.pdf (gleiche cmid) ist mit verschwunden: der Fokus liegt auf Blatt.pdf, nicht auf BODY
    expect(screen.queryByText('Anhang.pdf')).toBeNull();
    const target = screen.getByText('Blatt.pdf').closest('li') as HTMLElement;
    await waitFor(() =>
      expect(document.activeElement).toBe(within(target).getByRole('button', { name: 'Als Folien' })),
    );
  });

  it('Fokus nach der Entscheidung: gibt es nur Dateien derselben Aktivität, landet er auf der Überschrift (#135)', async () => {
    installMoodle(core, {
      items: [
        item({}),
        item({
          id: '0190f6a2-0000-7000-8000-000000000302',
          filename: 'Anhang.pdf',
          file_ref: '/5003/x/Anhang.pdf',
        }),
      ],
    });
    inboxPage();
    const first = (await screen.findByText('Skript.pdf')).closest('li') as HTMLElement;
    await userEvent.setup().click(within(first).getByRole('button', { name: 'Als Folien' }));
    await screen.findByText(/Nichts zu entscheiden/);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Inbox' })));
  });

  it('zeigt offene Dateien nach Modul und schickt die Entscheidung', async () => {
    const fake = installMoodle(core, { items: [item({})] });
    wrap(<MoodleInbox />);
    const group = await screen.findByRole('region', { name: /Moodle · Datenbanksysteme/ });
    expect(within(group).getByText('Skript.pdf')).toBeInTheDocument();
    expect(within(group).getByRole('link', { name: 'Ansehen' })).toHaveAttribute(
      'href',
      `/api/v1/moodle/file?ref=${encodeURIComponent('/5003/mod_folder/content/1/Skript.pdf')}`,
    );
    await userEvent.setup().click(within(group).getByRole('button', { name: 'Als Folien' }));
    await waitFor(() =>
      expect(core.requests.find((r) => r.method === 'PATCH')).toMatchObject({
        path: `/moodle/items/${fake.items[0]?.id}`,
        body: { kind: 'folien' },
      }),
    );
    expect(await screen.findByText(/Gilt auch für weitere Dateien in „Material“/)).toBeInTheDocument();
    expect(await screen.findByText(/Nichts zu entscheiden/)).toBeInTheDocument();
  });
});

describe('Fristen', () => {
  it('Heute: Fristen mit Modul, Art, Blatt und Link nach Moodle', async () => {
    installMoodle(core, {
      deadlines: [
        deadline({}),
        deadline({
          id: '0190f6a2-0000-7000-8000-000000000402',
          source: 'termin',
          assignment_id: null,
          event_id: 802,
          name: 'Projektpräsentation',
          due_at: '2026-11-20T09:00:00Z',
          exercise_sheet_id: null,
        }),
      ],
    });
    wrap(<MoodleDeadlines modules={[DBS, STAT]} days={14} headingId="f" />);
    const list = await screen.findByRole('region', { name: 'Fristen' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Abgabe Übungsblatt 1');
    expect(rows[0]).toHaveTextContent('Datenbanksysteme · Abgabe');
    expect(within(rows[0] as HTMLElement).getByRole('link', { name: 'Blatt' })).toHaveAttribute(
      'href',
      '/dokument?typ=blatt&id=0190f6a2-0000-7000-8000-000000000501',
    );
    expect(rows[1]).toHaveTextContent('Termin');
    expect(core.requests.find((r) => r.path.startsWith('/moodle/synced-deadlines'))?.path).toContain('to=');
  });

  it('Heute fragt höchstens 5 Fristen der nächsten 14 Tage an (Review N2) und zeigt den Zugangshinweis', async () => {
    installMoodle(core, {
      status: {
        state: 'laeuft_bald_ab',
        site_url: 'https://moodle.example.org',
        site_name: 'Beispiel-Moodle',
        user_fullname: null,
        token_valid_until: '2026-11-10',
        checked_at: NOW,
      },
      deadlines: [deadline({})],
    });
    const before = Date.now();
    wrap(<HeuteView />);
    await screen.findByRole('region', { name: 'Fristen' });
    const request = core.requests.find((r) => r.path.startsWith('/moodle/synced-deadlines'));
    const params = new URL(`http://x${request?.path ?? ''}`).searchParams;
    expect(params.get('limit')).toBe('5');
    const to = Date.parse(params.get('to') ?? '');
    const days14 = 14 * 86_400_000;
    expect(Math.abs(to - (before + days14))).toBeLessThan(60_000);
    expect(await screen.findByText(/läuft am 10\.11\.2026 ab/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Moodle-Einstellungen' })).toHaveAttribute(
      'href',
      '/einstellungen?bereich=moodle',
    );
  });

  it('Links nach Moodle nur für http(s)', async () => {
    installMoodle(core, {
      deadlines: [deadline({ url: 'javascript:alert(1)' })],
    });
    wrap(<MoodleDeadlines headingId="f" />);
    const list = await screen.findByRole('region', { name: 'Fristen' });
    expect(within(list).queryByRole('link', { name: 'In Moodle' })).toBeNull();
  });

  it('ohne Fristen zeigt die Liste nichts', async () => {
    installMoodle(core);
    wrap(<MoodleDeadlines headingId="f" />);
    await waitFor(() =>
      expect(core.requests.some((r) => r.path.startsWith('/moodle/synced-deadlines'))).toBe(true),
    );
    expect(screen.queryByRole('region', { name: 'Fristen' })).toBeNull();
    expect(screen.queryByText('Fristen')).toBeNull();
  });

  it('Modulseite: Zeile zum Abgleich, Hinweis auf die Inbox und Fristen des Moduls', async () => {
    search.value = `id=${DBS.id}`;
    installMoodle(core, {
      links: [
        {
          moodle_course_id: 901,
          module_id: DBS.id,
          sync_enabled: true,
          last_synced_at: '2026-11-05T11:00:00Z',
          auto: null,
          module_removable: false,
          created_at: NOW,
          updated_at: NOW,
        },
      ],
      items: [item({})],
      deadlines: [deadline({})],
    });
    wrap(<ModulView />);
    expect(await screen.findByText(/Moodle-Kurs zugeordnet · abgeglichen/)).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: '1 Datei wartet in der Inbox' })).toHaveAttribute(
      'href',
      '/inbox',
    );
    const list = await screen.findByRole('region', { name: 'Fristen' });
    expect(list).toHaveTextContent('Abgabe Übungsblatt 1');
    // Auf der Modulseite ohne Modulname
    expect(list).not.toHaveTextContent('Datenbanksysteme');
  });

  it('Modulseite: höchstens 5 Fristen, „Alle anzeigen“ lädt den Rest (Review N4)', async () => {
    search.value = `id=${DBS.id}`;
    installMoodle(core, {
      links: [
        {
          moodle_course_id: 901,
          module_id: DBS.id,
          sync_enabled: true,
          last_synced_at: null,
          auto: null,
          module_removable: false,
          created_at: NOW,
          updated_at: NOW,
        },
      ],
      deadlines: Array.from({ length: 7 }, (_, i) =>
        deadline({
          id: `0190f6a2-0000-7000-8000-00000000041${i}`,
          name: `Abgabe Übungsblatt ${i + 1}`,
          due_at: `2026-11-${String(10 + i).padStart(2, '0')}T22:59:00Z`,
        }),
      ),
    });
    wrap(<ModulView />);
    const list = await screen.findByRole('region', { name: 'Fristen' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
    await userEvent.setup().click(within(list).getByRole('button', { name: 'Alle anzeigen' }));
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(7));
    expect(within(list).queryByRole('button', { name: 'Alle anzeigen' })).toBeNull();
  });

  it('Modulseite: nach „Alle anzeigen“ liegt der Fokus auf der ersten neu angezeigten Frist (#135)', async () => {
    search.value = `id=${DBS.id}`;
    installMoodle(core, {
      links: [
        {
          moodle_course_id: 901,
          module_id: DBS.id,
          sync_enabled: true,
          last_synced_at: null,
          auto: null,
          module_removable: false,
          created_at: NOW,
          updated_at: NOW,
        },
      ],
      deadlines: Array.from({ length: 7 }, (_, i) =>
        deadline({
          id: `0190f6a2-0000-7000-8000-00000000041${i}`,
          name: `Abgabe Übungsblatt ${i + 1}`,
          due_at: `2026-11-${String(10 + i).padStart(2, '0')}T22:59:00Z`,
        }),
      ),
    });
    wrap(<ModulView />);
    const list = await screen.findByRole('region', { name: 'Fristen' });
    await userEvent.setup().click(within(list).getByRole('button', { name: 'Alle anzeigen' }));
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(7));
    const sixth = within(list).getByText('Abgabe Übungsblatt 6').closest('li');
    await waitFor(() => expect(document.activeElement).toBe(sixth));
  });

  it('formatDue: heute, morgen, sonst Wochentag und Datum', () => {
    const now = Date.parse('2026-11-05T12:00:00Z');
    expect(formatDue('2026-11-05T22:30:00Z', now)).toBe('heute 23:30');
    expect(formatDue('2026-11-06T08:00:00Z', now)).toBe('morgen 09:00');
    expect(formatDue('2026-11-12T22:59:00Z', now)).toBe('Do., 12.11. · 23:59');
  });
});
