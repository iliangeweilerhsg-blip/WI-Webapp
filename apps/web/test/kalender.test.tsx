import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Vor allen Imports: Die Formatierer in lib/calendar.ts lesen die Zeitzone beim Laden
vi.hoisted(() => {
  process.env.TZ = 'Europe/Zurich';
});

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { ApiRequestError } from '../src/lib/api.ts';
import {
  addDays,
  calendarErrorMessage,
  dayKey,
  eventDay,
  formatCount,
  formatEventTime,
  formatWeek,
  groupByDay,
  isoWeek,
  startOfWeek,
  summarizeImport,
} from '../src/lib/calendar.ts';
import { AppShell } from '../src/components/AppShell.tsx';
import { CalendarView } from '../src/components/CalendarView.tsx';
import { QueryProvider } from '../src/lib/query.tsx';
import { ThemeProvider } from '../src/lib/theme.tsx';
import { installCalendarCore, makeEvent, makeSource, summaryOf, type CalendarCore } from './calendar-core.ts';
import { makeModule, makeSemester } from './fake-core.ts';

vi.mock('next/navigation', () => ({
  usePathname: () => '/kalender',
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ push: vi.fn() }),
}));

const SEMESTER = makeSemester();
const MIKRO = makeModule({
  id: '0190f6a2-0000-7000-8000-0000000000a2',
  name: 'Mikroökonomie I',
  color: 'mod-02',
});
const DBS = makeModule({
  id: '0190f6a2-0000-7000-8000-0000000000a3',
  name: 'Datenbanksysteme',
  color: 'mod-03',
});
const SOURCE = makeSource({ id: '0190f6a2-0000-7000-8000-0000000000c1' });

function mount(children: ReactNode = <CalendarView />) {
  return render(
    <ThemeProvider>
      <QueryProvider>
        <AppShell>{children}</AppShell>
      </QueryProvider>
    </ThemeProvider>,
  );
}

/** Mittwoch, 4. November 2026, 10:00 Uhr: die Woche 2.–8. November (KW 45). Nur `Date` ist falsch, Timer laufen echt. */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 4, 10, 0, 0));
  document.documentElement.removeAttribute('data-sidebar');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const writes = (core: CalendarCore) => core.calendarRequests.filter((r) => r.method !== 'GET');
const icsFile = (name = 'plan.ics', size = 100) =>
  new File(['x'.repeat(size)], name, { type: 'text/calendar' });

async function weekHeading() {
  return screen.findByRole('heading', { level: 2, name: /^KW \d+/ });
}

describe('Hilfsfunktionen: Woche und Tage', () => {
  it('startOfWeek: Montag 00:00 der Woche, auch von Sonntag aus', () => {
    expect(dayKey(startOfWeek(new Date(2026, 10, 4)))).toBe('2026-11-02');
    expect(dayKey(startOfWeek(new Date(2026, 10, 2)))).toBe('2026-11-02');
    expect(dayKey(startOfWeek(new Date(2026, 10, 8, 23, 59)))).toBe('2026-11-02');
    expect(dayKey(startOfWeek(new Date(2026, 10, 9)))).toBe('2026-11-09');
    expect(startOfWeek(new Date(2026, 10, 4, 15)).getHours()).toBe(0);
  });

  it('addDays rechnet über die Zeitumstellung in Kalendertagen', () => {
    // Sommerzeit endet am 25. Oktober 2026
    expect(dayKey(addDays(new Date(2026, 9, 24), 2))).toBe('2026-10-26');
    expect(dayKey(addDays(new Date(2026, 11, 30), 3))).toBe('2027-01-02');
  });

  it.each([
    [new Date(2026, 10, 9), 46],
    [new Date(2026, 10, 4), 45],
    [new Date(2026, 11, 31), 53],
    [new Date(2027, 0, 1), 53],
    [new Date(2027, 0, 4), 1],
    [new Date(2025, 11, 29), 1],
  ])('isoWeek(%s) = %i', (date, week) => {
    expect(isoWeek(date)).toBe(week);
  });

  it('formatWeek: in einem Monat und über den Monatswechsel', () => {
    expect(formatWeek(new Date(2026, 10, 2))).toBe('KW 45 · 2. – 8. November 2026');
    expect(formatWeek(new Date(2026, 9, 26))).toBe('KW 44 · 26. Oktober – 1. November 2026');
    expect(formatWeek(new Date(2026, 11, 28))).toBe('KW 53 · 28. Dezember – 3. Januar 2027');
  });

  it('eventDay: ganztägige Termine zählen an ihrem Datum, andere in der Ortszeit', () => {
    expect(eventDay(makeEvent({ all_day: true, starts_at: '2026-11-01T00:00:00Z' }))).toBe('2026-11-01');
    // 23:30 Uhr UTC ist in Zürich schon der nächste Tag
    expect(eventDay(makeEvent({ starts_at: '2026-11-03T23:30:00Z' }))).toBe('2026-11-04');
  });

  it('formatEventTime', () => {
    expect(formatEventTime(makeEvent())).toBe('10:15–12:00');
    expect(formatEventTime(makeEvent({ all_day: true }))).toBe('ganztägig');
    expect(formatEventTime(makeEvent({ ends_at: '2026-11-04T09:15:00Z' }))).toBe('10:15');
  });

  it('groupByDay: sieben Tage, ganztägig zuerst, dann nach Beginn', () => {
    const late = makeEvent({
      title: 'Spät',
      starts_at: '2026-11-04T15:00:00Z',
      ends_at: '2026-11-04T16:00:00Z',
    });
    const early = makeEvent({ title: 'Früh' });
    const allDay = makeEvent({ title: 'Ganztag', all_day: true, starts_at: '2026-11-04T00:00:00Z' });
    const other = makeEvent({
      title: 'Sonntag',
      starts_at: '2026-11-08T08:00:00Z',
      ends_at: '2026-11-08T09:00:00Z',
    });
    const outside = makeEvent({ title: 'Nächste Woche', starts_at: '2026-11-09T08:00:00Z' });
    const days = groupByDay(new Date(2026, 10, 2), [late, other, allDay, early, outside]);
    expect(days.map((d) => d.key)).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
    ]);
    expect(days[2]?.events.map((e) => e.title)).toEqual(['Ganztag', 'Früh', 'Spät']);
    expect(days[6]?.events.map((e) => e.title)).toEqual(['Sonntag']);
    expect(days.flatMap((d) => d.events)).toHaveLength(4);
  });

  it('summarizeImport', () => {
    const base = summaryOf({ events: [], suggestions: [], warnings: [] }, SOURCE);
    expect(summarizeImport(base)).toBe('Die Datei enthält keine Termine.');
    expect(summarizeImport({ ...base, counts: { ...base.counts, unveraendert: 5 } })).toBe(
      'Nichts hat sich geändert.',
    );
    expect(summarizeImport({ ...base, counts: { ...base.counts, neu: 1 } })).toBe('1 Termin neu');
    expect(
      summarizeImport({ ...base, counts: { ...base.counts, neu: 24, geaendert: 2, entfallen: 1 } }),
    ).toBe('24 Termine neu · 2 geändert · 1 entfällt');
    expect(summarizeImport({ ...base, counts: { ...base.counts, entfallen: 3 } })).toBe('3 entfallen');
  });

  it('calendarErrorMessage: freundliche Texte, bei Abruffehlern mit der Meldung des Core', () => {
    const api = (code: string, message: string) =>
      new ApiRequestError({
        kind: 'api',
        status: 400,
        code,
        message: `${code}: ${message}`,
        userMessage: 'Die Anfrage hat nicht geklappt.',
      });
    expect(calendarErrorMessage(api('ics_invalid', 'kaputt'))).toContain('keine gültige ICS-Datei');
    expect(calendarErrorMessage(api('ics_fetch_failed', 'Der Server antwortet nicht rechtzeitig.'))).toBe(
      'Die Adresse lässt sich nicht abrufen. Der Server antwortet nicht rechtzeitig.',
    );
    expect(calendarErrorMessage(api('calendar_source_exists', 'x'))).toBe('Diesen Kalender gibt es schon.');
    expect(calendarErrorMessage(api('file_too_large', 'x'))).toContain('5 MB');
    expect(calendarErrorMessage(api('weird', 'x'))).toBe('Die Anfrage hat nicht geklappt.');
    expect(calendarErrorMessage(new Error('boom'))).toBe('Das hat nicht geklappt.');
  });
});

describe('Navigation', () => {
  it('„Kalender“ steht in der Seitenleiste und führt nach /kalender', async () => {
    installCalendarCore();
    mount(<p>Inhalt</p>);
    expect(screen.getByRole('link', { name: 'Kalender' })).toHaveAttribute('href', '/kalender');
  });
});

describe('Kalender: Woche', () => {
  it('zeigt die Woche mit Wochentagen, Terminen, Zeit, Ort, Art und Modul', async () => {
    installCalendarCore({
      semesters: [SEMESTER],
      modules: [MIKRO],
      sources: [SOURCE],
      events: [
        makeEvent({
          title: 'Mikroökonomie I – Vorlesung',
          location: 'Hörsaal A-01',
          module_id: MIKRO.id,
          source_id: SOURCE.id,
        }),
        makeEvent({
          title: 'Statistik Übung',
          kind: 'uebung',
          starts_at: '2026-11-05T12:15:00Z',
          ends_at: '2026-11-05T13:45:00Z',
        }),
        makeEvent({
          title: 'Allerheiligen',
          kind: 'fest',
          all_day: true,
          starts_at: '2026-11-04T00:00:00Z',
          ends_at: '2026-11-05T00:00:00Z',
        }),
        makeEvent({
          title: 'Nächste Woche',
          starts_at: '2026-11-10T09:15:00Z',
          ends_at: '2026-11-10T11:00:00Z',
        }),
      ],
    });
    mount();
    expect(await weekHeading()).toHaveTextContent('KW 45 · 2. – 8. November 2026');
    const wednesday = await screen.findByRole('region', { name: 'Mittwoch, 4. November' });
    const vorlesung = within(wednesday).getByText('Mikroökonomie I – Vorlesung').closest('li') as HTMLElement;
    expect(vorlesung).toHaveTextContent('10:15–12:00 · Hörsaal A-01 · Vorlesung');
    expect(within(vorlesung).getByText('Mikroökonomie I')).toBeInTheDocument();
    expect(within(wednesday).getByText('Allerheiligen').closest('li')).toHaveTextContent(
      'ganztägig · Fester Termin',
    );
    expect(within(wednesday).getByText(/heute/)).toBeInTheDocument();
    const thursday = screen.getByRole('region', { name: 'Donnerstag, 5. November' });
    expect(within(thursday).getByText('Statistik Übung').closest('li')).toHaveTextContent(
      '13:15–14:45 · Übung',
    );
    expect(within(thursday).getByText('Kein Modul')).toBeInTheDocument();
    // Tage ohne Termine bleiben ruhig kurz
    expect(
      within(screen.getByRole('region', { name: 'Montag, 2. November' })).getByText('Keine Termine'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Nächste Woche')).not.toBeInTheDocument();
  });

  it('fragt genau die Woche ab (Montag 00:00 bis Montag 00:00, Ortszeit) mit abgesagten Terminen', async () => {
    const core = installCalendarCore({ sources: [SOURCE] });
    mount();
    await weekHeading();
    await waitFor(() =>
      expect(core.calendarRequests.some((r) => r.path.startsWith('/calendar/events?from='))).toBe(true),
    );
    const query = core.calendarRequests.find((r) => r.path.startsWith('/calendar/events?from='))?.path ?? '';
    const params = new URL(query, 'http://x').searchParams;
    expect(params.get('from')).toBe(new Date(2026, 10, 2).toISOString());
    expect(params.get('to')).toBe(new Date(2026, 10, 9).toISOString());
    expect(params.get('include_cancelled')).toBe('true');
  });

  it('abgesagte Termine stehen durchgestrichen mit „entfällt“', async () => {
    installCalendarCore({ sources: [SOURCE], events: [makeEvent({ title: 'Statistik', cancelled: true })] });
    mount();
    const item = (await screen.findByText('Statistik')).closest('li') as HTMLElement;
    expect(item).toHaveTextContent('entfällt');
    expect(screen.getByText('Statistik')).toHaveClass('line-through');
  });

  it('blättert zwischen den Wochen; „Heute“ springt zurück', async () => {
    const core = installCalendarCore({
      sources: [SOURCE],
      events: [
        makeEvent({ title: 'Diese Woche' }),
        makeEvent({
          title: 'Nächste Woche',
          starts_at: '2026-11-10T09:15:00Z',
          ends_at: '2026-11-10T11:00:00Z',
        }),
      ],
    });
    const user = userEvent.setup();
    mount();
    await screen.findByText('Diese Woche');
    await user.click(screen.getByRole('button', { name: 'Nächste Woche' }));
    expect(await screen.findByText('Nächste Woche', { selector: 'p' })).toBeInTheDocument();
    expect(screen.queryByText('Diese Woche')).not.toBeInTheDocument();
    expect(await weekHeading()).toHaveTextContent('KW 46 · 9. – 15. November 2026');
    await user.click(screen.getByRole('button', { name: 'Vorherige Woche' }));
    await user.click(screen.getByRole('button', { name: 'Vorherige Woche' }));
    expect(await weekHeading()).toHaveTextContent('KW 44 · 26. Oktober – 1. November 2026');
    await user.click(screen.getByRole('button', { name: 'Heute' }));
    expect(await screen.findByText('Diese Woche')).toBeInTheDocument();
    expect(await weekHeading()).toHaveTextContent('KW 45');
    expect(
      core.calendarRequests.filter((r) => r.path.startsWith('/calendar/events?from=')).length,
    ).toBeGreaterThanOrEqual(3);
  });

  it('weist auf Termine ohne Modul hin', async () => {
    installCalendarCore({
      sources: [SOURCE],
      modules: [MIKRO],
      semesters: [SEMESTER],
      events: [
        makeEvent({ title: 'A' }),
        makeEvent({ title: 'B' }),
        makeEvent({ title: 'C', module_id: MIKRO.id }),
      ],
    });
    mount();
    expect(await screen.findByText(/2 kommende Termine haben noch kein Modul/)).toBeInTheDocument();
  });

  it('ohne Quellen: Import-Karte und ein ruhiger leerer Zustand', async () => {
    installCalendarCore();
    mount();
    expect(await screen.findByRole('heading', { name: 'Stundenplan importieren' })).toBeInTheDocument();
    expect(await screen.findByText(/Noch keine Termine/)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Kalenderquellen' })).not.toBeInTheDocument();
  });

  it('Core nicht erreichbar: ruhiger Hinweis, kein Absturz', async () => {
    installCalendarCore({ down: true });
    mount();
    // Ein Wiederholungsversuch nach 1 s, dann der Hinweis
    await screen.findAllByText('Core nicht erreichbar');
    expect(within(screen.getByRole('main')).getAllByText('Core nicht erreichbar').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Kalender' })).toBeInTheDocument();
  });
});

describe('Kalender: Import', () => {
  it('Datei: Upload als multipart, Ergebnis mit Zusammenfassung und Hinweisen', async () => {
    const core = installCalendarCore({ semesters: [SEMESTER] });
    core.importPlan = {
      events: [makeEvent({ module_id: MIKRO.id }), makeEvent({ title: 'Zwei' })],
      suggestions: [],
      warnings: [
        {
          code: 'timezone_unknown',
          message: 'Die Zeitzone „Mars/Olympus“ ist unbekannt.',
          external_uid: 'x',
        },
      ],
    };
    const user = userEvent.setup();
    mount();
    const submit = await screen.findByRole('button', { name: 'Datei importieren' });
    expect(submit).toBeDisabled();
    await user.upload(screen.getByLabelText('ICS-Datei'), icsFile('stundenplan-hs26.ics'));
    expect(submit).toBeEnabled();
    await user.click(submit);

    const result = await screen.findByRole('region', { name: 'Ergebnis des Imports' });
    expect(result).toHaveTextContent('stundenplan-hs26.ics');
    expect(result).toHaveTextContent('2 Termine neu');
    expect(result).toHaveTextContent('1 automatisch einem Modul zugeordnet · 1 ohne Modul');
    expect(within(result).getByText('Die Zeitzone „Mars/Olympus“ ist unbekannt.')).toBeInTheDocument();

    const post = writes(core).find((r) => r.method === 'POST');
    expect(post?.path).toBe('/calendar/sources');
    const sent = post?.form?.get('file') as File;
    expect(sent.name).toBe('stundenplan-hs26.ics');
    // Die Quelle erscheint in der Liste, der Dateiauswahl-Zustand ist zurückgesetzt
    expect(await screen.findByRole('list', { name: 'Kalenderquellen' })).toHaveTextContent(
      'stundenplan-hs26.ics',
    );
    await user.click(within(result).getByRole('button', { name: 'Schließen' }));
    expect(screen.queryByRole('region', { name: 'Ergebnis des Imports' })).not.toBeInTheDocument();
  });

  it('URL: webcal:// wird so gesendet, der Core macht https:// daraus', async () => {
    const core = installCalendarCore();
    core.importPlan = { events: [makeEvent()], suggestions: [], warnings: [] };
    const user = userEvent.setup();
    mount();
    await user.type(await screen.findByLabelText(/Adresse/), '  webcal://stundenplan.example.edu/plan.ics ');
    await user.click(screen.getByRole('button', { name: 'Abonnieren' }));
    expect(await screen.findByRole('region', { name: 'Ergebnis des Imports' })).toHaveTextContent(
      '1 Termin neu',
    );
    const post = writes(core)[0];
    expect(post?.body).toEqual({ url: 'webcal://stundenplan.example.edu/plan.ics' });
    expect(await screen.findByRole('list', { name: 'Kalenderquellen' })).toHaveTextContent('abonniert');
  });

  it.each([
    [
      { status: 502, code: 'ics_fetch_failed', message: 'Der Server antwortet nicht rechtzeitig.' },
      'Die Adresse lässt sich nicht abrufen. Der Server antwortet nicht rechtzeitig.',
    ],
    [
      {
        status: 502,
        code: 'ics_fetch_failed',
        message: 'Die Adresse zeigt ins lokale Netz und wird nicht abgerufen.',
      },
      'Die Adresse zeigt ins lokale Netz und wird nicht abgerufen.',
    ],
    [{ status: 422, code: 'ics_invalid', message: 'x' }, 'keine gültige ICS-Datei'],
    [{ status: 409, code: 'calendar_source_exists', message: 'x' }, 'Diesen Kalender gibt es schon.'],
    [
      {
        status: 400,
        code: 'validation_failed',
        message: 'Die Adresse ist ungültig. Sie muss mit https:// oder webcal:// beginnen.',
      },
      'Die Adresse ist ungültig. Sie muss mit https:// oder webcal:// beginnen.',
    ],
    [{ status: 400, code: 'validation_failed', message: 'Die Anfrage ist ungültig.' }, 'Das passt so nicht'],
    [{ status: 400, code: 'ics_too_complex', message: 'x' }, 'zu komplex'],
  ])('URL-Fehler %j wird freundlich gezeigt, nichts bleibt zurück', async (rejection, expected) => {
    const core = installCalendarCore();
    const user = userEvent.setup();
    mount();
    await user.type(await screen.findByLabelText(/Adresse/), 'https://stundenplan.example.edu/plan.ics');
    core.rejectNext = rejection;
    await user.click(screen.getByRole('button', { name: 'Abonnieren' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(expected);
    expect(screen.queryByRole('region', { name: 'Ergebnis des Imports' })).not.toBeInTheDocument();
    // Die Eingabe bleibt zum Korrigieren
    expect(screen.getByLabelText(/Adresse/)).toHaveValue('https://stundenplan.example.edu/plan.ics');
  });

  it('Datei-Fehler: ungültiger Inhalt wird gemeldet', async () => {
    const core = installCalendarCore();
    const user = userEvent.setup();
    mount();
    await user.upload(await screen.findByLabelText('ICS-Datei'), icsFile('kaputt.ics'));
    core.rejectNext = { status: 422, code: 'ics_invalid', message: 'x' };
    await user.click(screen.getByRole('button', { name: 'Datei importieren' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('keine gültige ICS-Datei');
  });

  it('Dateien über 5 MB gehen gar nicht erst raus', async () => {
    const core = installCalendarCore();
    const user = userEvent.setup();
    mount();
    await user.upload(await screen.findByLabelText('ICS-Datei'), icsFile('riesig.ics', 5 * 1024 * 1024 + 1));
    expect(await screen.findByRole('alert')).toHaveTextContent('höchstens 5 MB');
    expect(screen.getByRole('button', { name: 'Datei importieren' })).toBeDisabled();
    expect(writes(core)).toHaveLength(0);
  });

  it('Modulvorschläge: Anlegen → POST /modules, dann PATCH mit scope=serie je Serie; der Vorschlag verschwindet', async () => {
    const first = makeEvent({
      id: '0190f6a2-0000-7000-8000-0000000000f1',
      external_uid: 'dbs@x',
      source_id: SOURCE.id,
      title: 'Datenbanksysteme (VL)',
    });
    const second = makeEvent({
      id: '0190f6a2-0000-7000-8000-0000000000f2',
      external_uid: 'stat@x',
      source_id: SOURCE.id,
      title: 'Statistik',
    });
    const core = installCalendarCore({ semesters: [SEMESTER], sources: [SOURCE], events: [first, second] });
    core.importPlan = { events: [], suggestions: [], warnings: [] };
    const user = userEvent.setup();
    mount();
    await weekHeading();
    // Abgleich einer URL-Quelle meldet Vorschläge
    const original = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        if (String(input).includes('/sync')) {
          return new Response(
            JSON.stringify(
              summaryOf(
                {
                  events: [],
                  suggestions: [
                    {
                      name: 'Datenbanksysteme',
                      short: 'DBS',
                      kind: 'vorlesung',
                      event_count: 4,
                      series_event_ids: [first.id],
                    },
                    { name: 'Statistik', kind: 'vorlesung', event_count: 3, series_event_ids: [second.id] },
                  ],
                  warnings: [],
                },
                SOURCE,
              ),
            ),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return original(input, init);
      }),
    );
    await user.click(await screen.findByRole('button', { name: `Jetzt abgleichen: ${SOURCE.name}` }));
    const result = await screen.findByRole('region', { name: 'Ergebnis des Imports' });
    await user.click(within(result).getByRole('button', { name: 'Anlegen: Modul Datenbanksysteme' }));
    await waitFor(() => expect(within(result).queryByText('Datenbanksysteme')).not.toBeInTheDocument());
    const requests = core.requests.filter((r) => r.method === 'POST' && r.path === '/modules');
    expect(requests[0]?.body).toMatchObject({ semester_id: SEMESTER.id, name: 'Datenbanksysteme' });
    const createdModule = core.modules.find((m) => m.name === 'Datenbanksysteme');
    // Das Kürzel wandert in short_name, die Termine ordnet ein einziger Aufruf von /calendar/reassign zu
    expect(requests[0]?.body).toMatchObject({ short_name: 'DBS' });
    expect(core.calendarRequests.filter((r) => r.path === '/calendar/reassign')).toHaveLength(1);
    expect(core.calendarRequests.some((r) => r.method === 'PATCH')).toBe(false);
    expect(core.events.find((e) => e.id === first.id)?.module_id).toBe(createdModule?.id);
    // Der zweite Vorschlag ist noch da
    expect(within(result).getByRole('button', { name: 'Anlegen: Modul Statistik' })).toBeInTheDocument();
  });

  it('Modulvorschläge: „Alle anlegen“ legt jedes Modul an', async () => {
    const a = makeEvent({ id: '0190f6a2-0000-7000-8000-0000000000f3', external_uid: 'a@x', title: 'Alpha' });
    const b = makeEvent({ id: '0190f6a2-0000-7000-8000-0000000000f4', external_uid: 'b@x', title: 'Beta' });
    const core = installCalendarCore({ semesters: [SEMESTER], events: [a, b] });
    core.importPlan = {
      events: [],
      suggestions: [
        { name: 'Alpha', kind: 'vorlesung', event_count: 1, series_event_ids: [a.id] },
        { name: 'Beta', kind: 'uebung', event_count: 1, series_event_ids: [b.id] },
      ],
      warnings: [],
    };
    const user = userEvent.setup();
    mount();
    await user.type(await screen.findByLabelText(/Adresse/), 'https://x.example.edu/a.ics');
    await user.click(screen.getByRole('button', { name: 'Abonnieren' }));
    const result = await screen.findByRole('region', { name: 'Ergebnis des Imports' });
    await user.click(within(result).getByRole('button', { name: 'Alle anlegen' }));
    await waitFor(() => expect(core.modules.map((m) => m.name)).toEqual(['Alpha', 'Beta']));
    await waitFor(() =>
      expect(within(result).queryByRole('list', { name: 'Modulvorschläge' })).not.toBeInTheDocument(),
    );
    // Ein einziger Aufruf für alle Module, nach dem Anlegen
    expect(core.calendarRequests.filter((r) => r.path === '/calendar/reassign')).toHaveLength(1);
    expect(core.events.find((e) => e.id === a.id)?.module_id).toBe(core.modules[0]?.id);
    expect(core.events.find((e) => e.id === b.id)?.module_id).toBe(core.modules[1]?.id);
  });

  it('Modulvorschläge ohne Semester: Hinweis statt Knopf', async () => {
    const core = installCalendarCore();
    core.importPlan = {
      events: [makeEvent()],
      suggestions: [
        {
          name: 'Alpha',
          kind: 'vorlesung',
          event_count: 1,
          series_event_ids: ['0190f6a2-0000-7000-8000-0000000000f5'],
        },
      ],
      warnings: [],
    };
    const user = userEvent.setup();
    mount();
    await user.type(await screen.findByLabelText(/Adresse/), 'https://x.example.edu/a.ics');
    await user.click(screen.getByRole('button', { name: 'Abonnieren' }));
    const result = await screen.findByRole('region', { name: 'Ergebnis des Imports' });
    expect(within(result).getByText(/Lege zuerst in den Einstellungen ein Semester an/)).toBeInTheDocument();
    expect(within(result).queryByRole('button', { name: /anlegen/ })).not.toBeInTheDocument();
  });
});

describe('Kalender: Termin zuordnen', () => {
  function seriesCore() {
    const events = [0, 7, 14].map((d, i) =>
      makeEvent({
        id: `0190f6a2-0000-7000-8000-00000000010${i}`,
        source_id: SOURCE.id,
        external_uid: 'serie@x',
        recurrence_id: `2026-11-${String(4 + d).padStart(2, '0')}T10:15:00+01:00`,
        starts_at: `2026-11-${String(4 + d).padStart(2, '0')}T09:15:00Z`,
        ends_at: `2026-11-${String(4 + d).padStart(2, '0')}T11:00:00Z`,
        title: 'Unbekannte Vorlesung',
      }),
    );
    const core = installCalendarCore({
      semesters: [SEMESTER],
      modules: [MIKRO, DBS],
      sources: [SOURCE],
      events,
    });
    return { core, events };
  }

  it('Modul und Art setzen: Standard ist die ganze Serie', async () => {
    const { core, events } = seriesCore();
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Zuordnen: Unbekannte Vorlesung' }));
    const form = screen.getByRole('form', { name: 'Termin „Unbekannte Vorlesung“ bearbeiten' });
    const save = within(form).getByRole('button', { name: 'Speichern' });
    expect(save).toBeDisabled();
    expect(within(form).getByRole('radio', { name: 'Ganze Serie' })).toBeChecked();
    await user.selectOptions(within(form).getByLabelText('Modul'), 'Datenbanksysteme');
    await user.selectOptions(within(form).getByLabelText('Art'), 'Übung');
    await user.click(save);

    const patch = core.calendarRequests.find((r) => r.method === 'PATCH');
    expect(patch?.path).toBe(`/calendar/events/${events[0]?.id}`);
    expect(patch?.body).toEqual({ module_id: DBS.id, kind: 'uebung', scope: 'serie' });
    expect(core.events.every((e) => e.module_id === DBS.id && e.assigned_by === 'manuell')).toBe(true);
    // Der Editor schließt, der Termin zeigt das Modul
    await waitFor(() => expect(screen.queryByRole('form', { name: /bearbeiten/ })).not.toBeInTheDocument());
    const item = (await screen.findByText('Unbekannte Vorlesung')).closest('li') as HTMLElement;
    await waitFor(() => expect(within(item).getByText('Datenbanksysteme')).toBeInTheDocument());
    expect(item).toHaveTextContent('Übung');
    expect(await screen.findByText('Zuordnung gespeichert · 3 Termine')).toBeInTheDocument();
  });

  it('„Nur diesen Termin“ sendet scope=einzeln; nur Geändertes geht raus', async () => {
    const { core, events } = seriesCore();
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Zuordnen: Unbekannte Vorlesung' }));
    const form = screen.getByRole('form', { name: /bearbeiten/ });
    await user.selectOptions(within(form).getByLabelText('Modul'), 'Mikroökonomie I');
    await user.click(within(form).getByRole('radio', { name: 'Nur diesen Termin' }));
    await user.click(within(form).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(writes(core)).toHaveLength(1));
    expect(writes(core)[0]?.body).toEqual({ module_id: MIKRO.id, scope: 'einzeln' });
    expect(core.events.find((e) => e.id === events[0]?.id)?.module_id).toBe(MIKRO.id);
    expect(core.events.find((e) => e.id === events[1]?.id)?.module_id).toBeNull();
    expect(await screen.findByText('Zuordnung gespeichert')).toBeInTheDocument();
  });

  it('Einzeltermine haben keine Serienwahl und senden scope=einzeln', async () => {
    const single = makeEvent({ title: 'Einzeln' });
    const core = installCalendarCore({
      semesters: [SEMESTER],
      modules: [MIKRO],
      sources: [SOURCE],
      events: [single],
    });
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Zuordnen: Einzeln' }));
    const form = screen.getByRole('form', { name: /bearbeiten/ });
    expect(within(form).queryByText('Gilt für')).not.toBeInTheDocument();
    await user.selectOptions(within(form).getByLabelText('Modul'), 'Mikroökonomie I');
    await user.click(within(form).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(writes(core)).toHaveLength(1));
    expect(writes(core)[0]?.body).toEqual({ module_id: MIKRO.id, scope: 'einzeln' });
  });

  it('Modul wieder wegnehmen sendet module_id: null', async () => {
    const assigned = makeEvent({ title: 'Mit Modul', module_id: MIKRO.id });
    const core = installCalendarCore({ semesters: [SEMESTER], modules: [MIKRO], events: [assigned] });
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Ändern: Mit Modul' }));
    const form = screen.getByRole('form', { name: /bearbeiten/ });
    expect(within(form).getByLabelText('Modul')).toHaveValue(MIKRO.id);
    await user.selectOptions(within(form).getByLabelText('Modul'), 'Kein Modul');
    await user.click(within(form).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(writes(core)).toHaveLength(1));
    expect(writes(core)[0]?.body).toEqual({ module_id: null, scope: 'einzeln' });
  });

  it('Fehler beim Speichern bleibt im Editor, mit freundlichem Text', async () => {
    const { core } = seriesCore();
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Zuordnen: Unbekannte Vorlesung' }));
    const form = screen.getByRole('form', { name: /bearbeiten/ });
    await user.selectOptions(within(form).getByLabelText('Modul'), 'Datenbanksysteme');
    core.rejectNext = { status: 404, code: 'module_not_found', message: 'x' };
    await user.click(within(form).getByRole('button', { name: 'Speichern' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Dieses Modul gibt es nicht mehr.');
    await user.click(within(form).getByRole('button', { name: 'Abbrechen' }));
    expect(screen.queryByRole('form', { name: /bearbeiten/ })).not.toBeInTheDocument();
  });
});

describe('Kalender: Quellen', () => {
  const FILE_SOURCE = makeSource({
    id: '0190f6a2-0000-7000-8000-0000000000c2',
    kind: 'ics_file',
    name: 'hs26.ics',
    url: null,
    last_synced_at: null,
  });

  it('zeigt Name, Anzahl, Art und letzten Abgleich; Fehler ruhig und mit Hinweis, dass die Termine bleiben', async () => {
    installCalendarCore({
      sources: [
        { ...SOURCE, last_error: 'Abruf fehlgeschlagen (timeout): Der Server antwortet nicht rechtzeitig.' },
        FILE_SOURCE,
      ],
      events: [makeEvent({ source_id: SOURCE.id }), makeEvent({ source_id: SOURCE.id })],
    });
    mount();
    const list = await screen.findByRole('list', { name: 'Kalenderquellen' });
    await waitFor(() => expect(list).toHaveTextContent('2 Termine · abonniert'));
    expect(list).toHaveTextContent('Zuletzt abgeglichen:');
    expect(list).toHaveTextContent('Noch nicht abgeglichen');
    expect(within(list).getByRole('status')).toHaveTextContent(
      'Der letzte Abgleich hat nicht geklappt. Die bisherigen Termine bleiben.',
    );
    expect(within(list).getByRole('status')).toHaveTextContent('timeout');
    expect(
      within(list).getByRole('button', { name: 'Jetzt abgleichen: stundenplan.example.edu' }),
    ).toBeInTheDocument();
    expect(within(list).getByLabelText('Neue Fassung für hs26.ics hochladen')).toBeInTheDocument();
  });

  it('URL-Quelle abgleichen: POST /sync, Rückmeldung als Meldung', async () => {
    const core = installCalendarCore({ sources: [SOURCE] });
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: `Jetzt abgleichen: ${SOURCE.name}` }));
    expect(await screen.findByText(`${SOURCE.name}: Die Datei enthält keine Termine.`)).toBeInTheDocument();
    expect(writes(core)[0]).toMatchObject({ method: 'POST', path: `/calendar/sources/${SOURCE.id}/sync` });
  });

  it('Abgleich einer URL-Quelle scheitert: kein Alarm, der Fehler steht an der Quelle (nur einmal)', async () => {
    const core = installCalendarCore({ sources: [SOURCE] });
    const user = userEvent.setup();
    mount();
    const button = await screen.findByRole('button', { name: `Jetzt abgleichen: ${SOURCE.name}` });
    core.rejectNext = {
      status: 502,
      code: 'ics_fetch_failed',
      message: 'Der Server antwortet nicht rechtzeitig.',
    };
    // Der Core hat den Fehler an der Quelle vermerkt, bevor die Liste neu geladen wird
    core.sources[0]!.last_error = 'Abruf fehlgeschlagen (timeout): Der Server antwortet nicht rechtzeitig.';
    await user.click(button);
    const list = await screen.findByRole('list', { name: 'Kalenderquellen' });
    await waitFor(() =>
      expect(within(list).getByRole('status')).toHaveTextContent('Der letzte Abgleich hat nicht geklappt'),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getAllByText(/Der Server antwortet nicht rechtzeitig/)).toHaveLength(1);
  });

  it('Abgleich einer Datei-Quelle scheitert: Hinweis (die Datei steht nicht an der Quelle)', async () => {
    const core = installCalendarCore({ sources: [FILE_SOURCE] });
    const user = userEvent.setup();
    mount();
    const input = await screen.findByLabelText('Neue Fassung für hs26.ics hochladen');
    core.rejectNext = { status: 422, code: 'ics_invalid', message: 'x' };
    await user.upload(input, icsFile('kaputt.ics'));
    expect(await screen.findByRole('alert')).toHaveTextContent('hs26.ics: Das ist keine gültige ICS-Datei');
    expect(screen.getByRole('list', { name: 'Kalenderquellen' })).toBeInTheDocument();
  });

  it('Datei-Quelle: neue Fassung hochladen', async () => {
    const core = installCalendarCore({ sources: [FILE_SOURCE] });
    const user = userEvent.setup();
    mount();
    await user.upload(
      await screen.findByLabelText('Neue Fassung für hs26.ics hochladen'),
      icsFile('hs26-neu.ics'),
    );
    await waitFor(() => expect(writes(core)).toHaveLength(1));
    const post = writes(core)[0];
    expect(post?.path).toBe(`/calendar/sources/${FILE_SOURCE.id}/sync`);
    expect((post?.form?.get('file') as File).name).toBe('hs26-neu.ics');
  });

  it('Entfernen fragt nach, löscht erst nach „Ja“ und kann abgebrochen werden', async () => {
    const core = installCalendarCore({
      sources: [SOURCE],
      events: [makeEvent({ source_id: SOURCE.id, title: 'Weg damit' })],
    });
    const user = userEvent.setup();
    mount();
    await screen.findByText('Weg damit');
    await user.click(await screen.findByRole('button', { name: `Entfernen: ${SOURCE.name}` }));
    expect(screen.getByText(/Die Quelle und ihre Termine verschwinden aus dem Kalender/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(writes(core)).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: `Entfernen: ${SOURCE.name}` }));
    await user.click(screen.getByRole('button', { name: `Ja, entfernen: ${SOURCE.name}` }));
    await waitFor(() => expect(writes(core)).toHaveLength(1));
    expect(writes(core)[0]).toMatchObject({ method: 'DELETE', path: `/calendar/sources/${SOURCE.id}` });
    await waitFor(() => expect(screen.queryByText('Weg damit')).not.toBeInTheDocument());
    expect(screen.queryByRole('list', { name: 'Kalenderquellen' })).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Stundenplan importieren' })).toBeInTheDocument();
  });
});

describe('Kalender: Bedienung und Nachträge aus dem Review', () => {
  it('formatCount zeigt die Obergrenze sichtbar', () => {
    expect(formatCount(7)).toBe('7');
    expect(formatCount(199)).toBe('199');
    expect(formatCount(200)).toBe('200+');
  });

  it('Termine ohne Modul zählen ab heute und zeigen „200+“ an der Obergrenze', async () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      makeEvent({ id: `0190f6a2-0000-7000-8000-${String(700000 + i).padStart(12, '0')}`, title: `T${i}` }),
    );
    const core = installCalendarCore({ sources: [SOURCE], events: many });
    mount();
    expect(await screen.findByText(/200\+ kommende Termine haben noch kein Modul/)).toBeInTheDocument();
    const query = core.calendarRequests.find((r) => r.path.includes('unassigned=true'))?.path ?? '';
    const params = new URL(query, 'http://x').searchParams;
    expect(params.get('from')).toBe(new Date(2026, 10, 4).toISOString());
    expect(params.get('limit')).toBe('200');
  });

  it('Der Fokus kehrt nach „Speichern“ und „Abbrechen“ zum Auslöser zurück', async () => {
    const single = makeEvent({ title: 'Einzeln' });
    installCalendarCore({ semesters: [SEMESTER], modules: [MIKRO], events: [single] });
    const user = userEvent.setup();
    mount();
    const trigger = await screen.findByRole('button', { name: 'Zuordnen: Einzeln' });
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(trigger).toHaveFocus());
    await user.click(trigger);
    const form = screen.getByRole('form', { name: /bearbeiten/ });
    await user.selectOptions(within(form).getByLabelText('Modul'), 'Mikroökonomie I');
    await user.click(within(form).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(screen.queryByRole('form', { name: /bearbeiten/ })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Ändern: Einzeln' })).toHaveFocus());
  });

  it('sichtbarer Text steht am Anfang des zugänglichen Namens (WCAG 2.5.3)', async () => {
    installCalendarCore({ sources: [SOURCE], events: [makeEvent({ title: 'Titel' })] });
    const user = userEvent.setup();
    mount();
    const visible = await screen.findByRole('button', { name: /Zuordnen/ });
    expect(visible).toHaveTextContent('Zuordnen');
    expect(visible.getAttribute('aria-label')).toBe('Zuordnen: Titel');
    await user.click(await screen.findByRole('button', { name: `Entfernen: ${SOURCE.name}` }));
    const yes = screen.getByRole('button', { name: `Ja, entfernen: ${SOURCE.name}` });
    expect(yes).toHaveTextContent('Ja, entfernen');
  });

  it('„Neue Fassung“ zeigt einen sichtbaren Fokus am Etikett', async () => {
    const fileSource = makeSource({
      id: '0190f6a2-0000-7000-8000-0000000000c9',
      kind: 'ics_file',
      name: 'f.ics',
      url: null,
    });
    installCalendarCore({ sources: [fileSource] });
    mount();
    const input = await screen.findByLabelText('Neue Fassung für f.ics hochladen');
    expect(input.closest('label')?.className).toContain('focus-within:outline');
  });

  it('Ein Wiederholen nach einem Netzfehler benutzt denselben Idempotency-Key', async () => {
    const core = installCalendarCore();
    core.importPlan = { events: [makeEvent()], suggestions: [], warnings: [] };
    const user = userEvent.setup();
    mount();
    const file = icsFile('wieder.ics');
    await user.upload(await screen.findByLabelText('ICS-Datei'), file);
    core.down = true;
    await user.click(screen.getByRole('button', { name: 'Datei importieren' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    core.down = false;
    await user.click(screen.getByRole('button', { name: 'Datei importieren' }));
    await screen.findByRole('region', { name: 'Ergebnis des Imports' });
    const posts = core.calendarRequests.filter((r) => r.method === 'POST' && r.path === '/calendar/sources');
    expect(posts.length).toBeGreaterThanOrEqual(1);
    const keys = posts.map((r) => r.headers['Idempotency-Key']);
    expect(new Set(keys).size).toBe(1);
  });

  it('Fehlertexte stehen in der Fehlerfarbe', async () => {
    const core = installCalendarCore();
    const user = userEvent.setup();
    mount();
    await user.type(await screen.findByLabelText(/Adresse/), 'https://x.example.edu/a.ics');
    core.rejectNext = { status: 409, code: 'calendar_source_exists', message: 'x' };
    await user.click(screen.getByRole('button', { name: 'Abonnieren' }));
    expect(await screen.findByRole('alert')).toHaveClass('text-danger');
  });
});
