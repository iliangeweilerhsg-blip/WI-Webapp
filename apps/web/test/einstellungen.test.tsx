// Einstellungen (T1-19): Reiter, Formulare je Bereich, Speichern mit Toast, Fehleranzeige
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useQuery } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({
  usePathname: () => '/einstellungen',
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ push: vi.fn() }),
}));

import { AppShell } from '../src/components/AppShell.tsx';
import { LearningSettingsForm } from '../src/components/settings/LearningSettings.tsx';
import { SettingsView } from '../src/components/SettingsView.tsx';
import { QueryProvider } from '../src/lib/query.tsx';
import { AppearanceDefault, ThemeProvider } from '../src/lib/theme.tsx';
import { installFakeCore, makeSemester, type FakeCore } from './fake-core.ts';

function page() {
  return render(
    <ThemeProvider>
      <QueryProvider>
        <AppearanceDefault />
        <AppShell>
          <SettingsView />
        </AppShell>
      </QueryProvider>
    </ThemeProvider>,
  );
}

const patches = (core: FakeCore) =>
  core.requests.filter((r) => r.method === 'PATCH' && r.path === '/settings');

beforeEach(() => {
  document.documentElement.removeAttribute('data-theme');
  window.localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Reiter', () => {
  it('zeigt alle Bereiche; „Allgemein“ enthält weiterhin Darstellung und Semester', async () => {
    installFakeCore();
    page();
    const tabs = screen.getByRole('tablist', { name: 'Bereiche der Einstellungen' });
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((t) => t.textContent),
    ).toEqual([
      'Allgemein',
      'Vorlesung',
      'Lernen',
      'Stift',
      'Geräte',
      'Moodle',
      'KI',
      'Daten und Papierkorb',
    ]);
    expect(screen.getByRole('tab', { name: 'Allgemein' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('group', { name: 'Darstellung' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Semester' })).toBeInTheDocument();
  });

  it('schmale Leiste bricht um statt abzuschneiden; der aktive Reiter rollt ins Bild (#86)', async () => {
    installFakeCore();
    // jsdom kennt scrollIntoView nicht: erst anlegen, dann ausspionieren (afterEach stellt es wieder her)
    Element.prototype.scrollIntoView ??= () => {};
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    page();
    const tabs = screen.getByRole('tablist', { name: 'Bereiche der Einstellungen' });
    expect(tabs.className).toContain('flex-wrap');
    expect(tabs.className).not.toMatch(/(^|\s)overflow-x-auto/);
    expect(scroll).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Daten und Papierkorb' }));
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    expect(scroll.mock.contexts.at(-1)).toBe(screen.getByRole('tab', { name: 'Daten und Papierkorb' }));
  });

  it('mountet „Daten und Papierkorb“ erst beim ersten Öffnen (keine Anfragen vorher)', async () => {
    const core = installFakeCore();
    const user = userEvent.setup();
    page();
    expect(await screen.findByRole('heading', { name: 'Semester' })).toBeInTheDocument();
    const dataRequests = () => core.requests.filter((r) => /^\/(backups|trash)/.test(r.path));
    expect(dataRequests()).toEqual([]);
    await user.click(screen.getByRole('tab', { name: 'Daten und Papierkorb' }));
    expect(await screen.findByRole('heading', { name: 'Papierkorb' })).toBeInTheDocument();
    expect(dataRequests().length).toBeGreaterThan(0);
  });

  it('wechselt per Klick und Pfeiltasten; Geräte zeigt die Geräteverwaltung, Daten die Bereiche Backups und Papierkorb', async () => {
    installFakeCore();
    const user = userEvent.setup();
    page();
    await user.click(screen.getByRole('tab', { name: 'Geräte' }));
    expect(screen.getByRole('heading', { name: 'Geräte' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Allgemein', hidden: true })).not.toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Daten und Papierkorb' }));
    expect(await screen.findByRole('heading', { name: 'Daten und Backups' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Papierkorb' })).toBeInTheDocument();

    screen.getByRole('tab', { name: 'Allgemein' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Vorlesung' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Vorlesung' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Daten und Papierkorb' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Allgemein' })).toHaveFocus();
  });
});

describe('Allgemein', () => {
  it('zeigt die Werte vom Core, data_dir nur lesbar', async () => {
    installFakeCore();
    page();
    expect(await screen.findByLabelText('Sprache der Inhalte')).toHaveValue('de');
    expect(screen.getByLabelText('Standard-Darstellung')).toHaveValue('system');
    const dataDir = screen.getByLabelText('Datenordner');
    expect(dataDir).toHaveValue('/Users/ich/Studien-Gehirn');
    expect(dataDir).toHaveAttribute('readonly');
  });

  it('speichert nur geänderte Felder und zeigt einen Toast', async () => {
    const core = installFakeCore();
    const user = userEvent.setup();
    page();
    const save = await screen.findByRole('button', { name: 'Speichern' });
    expect(save).toBeDisabled();
    expect(save).toHaveAccessibleDescription('Keine Änderungen zu speichern.');
    await user.selectOptions(screen.getByLabelText('Sprache der Inhalte'), 'en');
    expect(save).toBeEnabled();
    await user.click(save);
    expect(await screen.findByText('Allgemeine Einstellungen gespeichert')).toBeInTheDocument();
    expect(patches(core).map((r) => r.body)).toEqual([{ general: { content_lang: 'en' } }]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled());
  });

  it('Standard-Darstellung gilt ohne Geräte-Wahl und wirkt nach dem Speichern', async () => {
    installFakeCore();
    const user = userEvent.setup();
    page();
    await user.selectOptions(await screen.findByLabelText('Standard-Darstellung'), 'dunkel');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(document.documentElement).toHaveAttribute('data-theme', 'dark'));
    expect(window.localStorage.getItem('sg-theme')).toBeNull();
    expect(window.localStorage.getItem('sg-theme-default')).toBe('dark');
  });

  it('Speichern anderer Felder setzt die Geräte-Wahl nicht zurück', async () => {
    window.localStorage.setItem('sg-theme', 'light');
    installFakeCore();
    const user = userEvent.setup();
    page();
    await user.selectOptions(await screen.findByLabelText('Sprache der Inhalte'), 'en');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await screen.findByText('Allgemeine Einstellungen gespeichert');
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(window.localStorage.getItem('sg-theme')).toBe('light');
  });

  it('Geräte-Wahl hat Vorrang vor der Standard-Darstellung; „Wie Standard“ folgt ihr wieder', async () => {
    const core = installFakeCore();
    core.settings.general.appearance = 'dunkel';
    window.localStorage.setItem('sg-theme', 'light');
    const user = userEvent.setup();
    page();
    await screen.findByLabelText('Sprache der Inhalte');
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    await user.click(screen.getByRole('button', { name: 'Wie Standard' }));
    await waitFor(() => expect(document.documentElement).toHaveAttribute('data-theme', 'dark'));
    expect(window.localStorage.getItem('sg-theme')).toBeNull();
  });

  it('verwirft Änderungen', async () => {
    const core = installFakeCore();
    const user = userEvent.setup();
    page();
    await user.selectOptions(await screen.findByLabelText('Sprache der Inhalte'), 'en');
    await user.click(screen.getByRole('button', { name: 'Änderungen verwerfen' }));
    expect(screen.getByLabelText('Sprache der Inhalte')).toHaveValue('de');
    expect(patches(core)).toHaveLength(0);
  });

  it('zeigt die Fehlermeldung des Core', async () => {
    const core = installFakeCore();
    core.rejectNextSettings = {
      status: 400,
      code: 'validation_failed',
      message: 'Die Anfrage ist ungültig.',
    };
    const user = userEvent.setup();
    page();
    await user.selectOptions(await screen.findByLabelText('Sprache der Inhalte'), 'en');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Allgemeine Einstellungen gespeichert')).not.toBeInTheDocument();
    // Ist das Panel sichtbar, sagt nur `role=alert` den Fehler an (kein zweiter Toast)
    expect(screen.queryByText(/Nicht gespeichert/)).not.toBeInTheDocument();
    // Eingabe bleibt erhalten und lässt sich erneut speichern
    expect(screen.getByLabelText('Sprache der Inhalte')).toHaveValue('en');
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeEnabled();
  });

  it('Core nicht erreichbar: ruhiger Hinweis, keine Felder', async () => {
    installFakeCore({ down: true });
    page();
    expect(await screen.findAllByText('Core nicht erreichbar')).not.toHaveLength(0);
    expect(screen.queryByLabelText('Sprache der Inhalte')).not.toBeInTheDocument();
  });
});

describe('Vorlesung', () => {
  async function open() {
    const user = userEvent.setup();
    page();
    await user.click(screen.getByRole('tab', { name: 'Vorlesung' }));
    await screen.findByLabelText('Höchstdauer (Minuten)');
    return user;
  }

  it('zeigt Standards, jedes Feld mit Label und Erklärung', async () => {
    installFakeCore();
    await open();
    expect(screen.getByLabelText('Höchstdauer (Minuten)')).toHaveValue('240');
    expect(screen.getByLabelText('Hinweis vor dem Stopp (Sekunden)')).toHaveValue('60');
    expect(screen.getByLabelText('Mikrofon')).toHaveValue('');
    expect(screen.getByLabelText('Werkzeugleiste auf dem iPad')).toHaveValue('rechts');
    expect(screen.getByLabelText('Höchstdauer (Minuten)')).toHaveAccessibleDescription(
      'Eine Aufnahme endet spätestens nach dieser Zeit.',
    );
  });

  it('speichert Zahlen als ganze Zahlen und lässt Rest unberührt', async () => {
    const core = installFakeCore();
    const user = await open();
    const max = screen.getByLabelText('Höchstdauer (Minuten)');
    await user.clear(max);
    await user.type(max, '180');
    await user.selectOptions(screen.getByLabelText('Werkzeugleiste auf dem iPad'), 'links');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByText('Vorlesungs-Einstellungen gespeichert')).toBeInTheDocument();
    expect(patches(core).map((r) => r.body)).toEqual([
      { lecture: { auto_stop_max_duration_min: 180, toolbar_side: 'links' } },
    ]);
    expect(core.settings.lecture.auto_stop_silence_min).toBe(15);
  });

  it('ungültige Zahl: Fehler am Feld, Speichern gesperrt, nichts wird gesendet', async () => {
    const core = installFakeCore();
    const user = await open();
    const silence = screen.getByLabelText('Stille (Minuten)');
    await user.clear(silence);
    await user.type(silence, '0');
    expect(silence).toHaveAttribute('aria-invalid', 'true');
    expect(silence).toHaveAccessibleDescription(/Bitte eine ganze Zahl ab 1 eingeben\./);
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled();
    await user.clear(silence);
    await user.type(silence, '12');
    expect(silence).not.toHaveAttribute('aria-invalid');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await screen.findByText('Vorlesungs-Einstellungen gespeichert');
    expect(patches(core).map((r) => r.body)).toEqual([{ lecture: { auto_stop_silence_min: 12 } }]);
  });

  it('0 Sekunden sind für den Hinweis erlaubt', async () => {
    const core = installFakeCore();
    const user = await open();
    const warn = screen.getByLabelText('Hinweis vor dem Stopp (Sekunden)');
    await user.clear(warn);
    await user.type(warn, '0');
    expect(warn).not.toHaveAttribute('aria-invalid');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await screen.findByText('Vorlesungs-Einstellungen gespeichert');
    expect(patches(core).map((r) => r.body)).toEqual([{ lecture: { auto_stop_warning_s: 0 } }]);
  });

  it('ein gespeichertes, nicht gefundenes Mikrofon bleibt auswählbar; Standardmikrofon setzt null', async () => {
    const core = installFakeCore();
    core.settings.lecture.microphone_id = 'abc';
    const user = await open();
    const mic = screen.getByLabelText('Mikrofon');
    expect(mic).toHaveValue('abc');
    await user.selectOptions(mic, 'Standardmikrofon');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await screen.findByText('Vorlesungs-Einstellungen gespeichert');
    expect(patches(core).map((r) => r.body)).toEqual([{ lecture: { microphone_id: null } }]);
  });
});

describe('Lernen', () => {
  async function open() {
    const user = userEvent.setup();
    page();
    await user.click(screen.getByRole('tab', { name: 'Lernen' }));
    await screen.findByLabelText('Neue Karten pro Tag (Karten)');
    return user;
  }
  const budget = () => screen.getByLabelText('Zeitbudget für Heute wiederholen (Minuten)');
  const newCards = () => screen.getByLabelText('Neue Karten pro Tag (Karten)');

  it('zeigt die Standardwerte mit Hilfetexten', async () => {
    installFakeCore();
    await open();
    expect(budget()).toHaveValue('20');
    expect(newCards()).toHaveValue('20');
    expect(budget()).toHaveAccessibleDescription(/Was nicht in den Block passt, bleibt fällig/);
    expect(newCards()).toHaveAccessibleDescription(/0 pausiert neue Karten, Wiederholungen laufen weiter\./);
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled();
  });

  it('speichert nur geänderte Felder über PATCH /settings', async () => {
    const core = installFakeCore();
    const user = await open();
    await user.clear(budget());
    await user.type(budget(), '45');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByText('Lern-Einstellungen gespeichert')).toBeInTheDocument();
    expect(patches(core).map((r) => r.body)).toEqual([{ learning: { review_budget_minutes: 45 } }]);
    expect(core.settings.learning).toEqual({ review_budget_minutes: 45, new_cards_per_day: 20 });
  });

  it('0 neue Karten und die Grenzen 5, 120 und 100 sind erlaubt', async () => {
    const core = installFakeCore();
    const user = await open();
    await user.clear(budget());
    await user.type(budget(), '120');
    await user.clear(newCards());
    await user.type(newCards(), '0');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await screen.findByText('Lern-Einstellungen gespeichert');
    expect(patches(core).map((r) => r.body)).toEqual([
      { learning: { review_budget_minutes: 120, new_cards_per_day: 0 } },
    ]);
    await user.clear(budget());
    await user.type(budget(), '5');
    await user.clear(newCards());
    await user.type(newCards(), '100');
    expect(budget()).not.toHaveAttribute('aria-invalid');
    expect(newCards()).not.toHaveAttribute('aria-invalid');
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeEnabled();
  });

  it.each([
    ['Zeitbudget für Heute wiederholen (Minuten)', '4', 'von 5 bis 120'],
    ['Zeitbudget für Heute wiederholen (Minuten)', '121', 'von 5 bis 120'],
    ['Neue Karten pro Tag (Karten)', '-1', 'von 0 bis 100'],
    ['Neue Karten pro Tag (Karten)', '101', 'von 0 bis 100'],
    ['Neue Karten pro Tag (Karten)', '2,5', 'von 0 bis 100'],
  ])('%s = %s wird abgelehnt, nichts wird gesendet', async (label, value, range) => {
    const core = installFakeCore();
    const user = await open();
    const field = screen.getByLabelText(label);
    await user.clear(field);
    await user.type(field, value);
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription(new RegExp(`Bitte eine ganze Zahl ${range} eingeben\\.`));
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled();
    expect(patches(core)).toHaveLength(0);
  });

  it('zeigt die Fehlermeldung des Core und behält die Eingabe', async () => {
    const core = installFakeCore();
    core.rejectNextSettings = {
      status: 400,
      code: 'validation_failed',
      message: 'Die Anfrage ist ungültig.',
    };
    const user = await open();
    await user.clear(newCards());
    await user.type(newCards(), '10');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Lern-Einstellungen gespeichert')).not.toBeInTheDocument();
    expect(newCards()).toHaveValue('10');
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeEnabled();
    expect(core.settings.learning.new_cards_per_day).toBe(20);
  });

  it('Speichern markiert die Warteschlange für /lernen als veraltet (Neuladen)', async () => {
    installFakeCore();
    const user = userEvent.setup();
    let loads = 0;
    function Queue() {
      useQuery({
        queryKey: ['review', 'queue', 0],
        staleTime: Infinity,
        queryFn: async () => ++loads,
      });
      return null;
    }
    render(
      <ThemeProvider>
        <QueryProvider>
          <AppShell>
            <Queue />
            <LearningSettingsForm />
          </AppShell>
        </QueryProvider>
      </ThemeProvider>,
    );
    await waitFor(() => expect(loads).toBe(1));
    const field = await screen.findByLabelText('Neue Karten pro Tag (Karten)');
    await user.clear(field);
    await user.type(field, '15');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await screen.findByText('Lern-Einstellungen gespeichert');
    await waitFor(() => expect(loads).toBe(2));
  });
});

describe('Stift', () => {
  async function open() {
    const user = userEvent.setup();
    page();
    await user.click(screen.getByRole('tab', { name: 'Stift' }));
    await screen.findByLabelText('Doppeltippen');
    return user;
  }

  it('speichert Gesten und Formerkennung', async () => {
    const core = installFakeCore();
    const user = await open();
    await user.selectOptions(screen.getByLabelText('Doppeltippen'), 'aus');
    await user.click(screen.getByRole('checkbox', { name: 'Formen erkennen' }));
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByText('Stift-Einstellungen gespeichert')).toBeInTheDocument();
    expect(patches(core).map((r) => r.body)).toEqual([
      { pen: { double_tap: 'aus', shape_recognition: true } },
    ]);
  });

  it('Lieblingsfarben: entfernen und hinzufügen, höchstens 8', async () => {
    const core = installFakeCore();
    const user = await open();
    const group = screen.getByRole('group', { name: 'Lieblingsfarben' });
    expect(within(group).getAllByLabelText(/^Farbe \d$/)).toHaveLength(8);
    expect(within(group).getByRole('button', { name: 'Farbe hinzufügen' })).toBeDisabled();
    await user.click(within(group).getByRole('button', { name: 'Farbe 8 entfernen' }));
    expect(within(group).getByRole('button', { name: 'Farbe hinzufügen' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await screen.findByText('Stift-Einstellungen gespeichert');
    expect(core.settings.pen.favorite_colors).toHaveLength(7);
    expect(patches(core)[0]?.body).toEqual({
      pen: { favorite_colors: core.settings.pen.favorite_colors },
    });
  });
});

describe('Reiter bleiben erhalten', () => {
  it('ungespeicherte Eingaben überstehen den Reiterwechsel und markieren den Reiter', async () => {
    installFakeCore();
    const user = userEvent.setup();
    page();
    const max = await screen.findByLabelText('Höchstdauer (Minuten)');
    await user.click(screen.getByRole('tab', { name: 'Vorlesung' }));
    await user.clear(max);
    await user.type(max, '120');
    await user.click(screen.getByRole('tab', { name: 'Stift' }));
    expect(screen.getByRole('tab', { name: /Vorlesung/ })).toHaveAccessibleName(
      'Vorlesung (ungespeicherte Änderungen)',
    );
    await user.click(screen.getByRole('tab', { name: /Vorlesung/ }));
    expect(screen.getByLabelText('Höchstdauer (Minuten)')).toHaveValue('120');
  });

  it('jedes Panel hat eine eigene ID passend zu aria-controls', async () => {
    installFakeCore();
    page();
    for (const tab of screen.getAllByRole('tab')) {
      const id = tab.getAttribute('aria-controls');
      expect(id).toMatch(/^settings-panel-/);
      expect(document.getElementById(id ?? '')).toHaveAttribute('role', 'tabpanel');
    }
  });

  it('Speicherfehler eines verborgenen Reiters: Toast und Markierung am Reiter', async () => {
    const core = installFakeCore();
    const user = userEvent.setup();
    page();
    await screen.findByLabelText('Sprache der Inhalte');
    await user.click(screen.getByRole('tab', { name: 'Stift' }));
    await user.selectOptions(screen.getByLabelText('Doppeltippen'), 'aus');
    core.rejectNextSettings = {
      status: 400,
      code: 'validation_failed',
      message: 'Die Anfrage ist ungültig.',
    };
    // Auf den Reiter wechseln, während das Speichern läuft
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Allgemein' }));
    expect(await screen.findByText(/Nicht gespeichert/)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Stift/ })).toHaveAccessibleName(
      'Stift (nicht gespeichert, Fehler)',
    );
  });

  it('ab md: senkrechte Tabliste, Pfeil hoch und runter', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    window.matchMedia = globalThis.matchMedia;
    installFakeCore({ semesters: [makeSemester()] });
    const user = userEvent.setup();
    page();
    const list = screen.getByRole('tablist');
    await waitFor(() => expect(list).toHaveAttribute('aria-orientation', 'vertical'));
    screen.getByRole('tab', { name: 'Allgemein' }).focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('tab', { name: 'Vorlesung' })).toHaveFocus();
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(screen.getByRole('tab', { name: 'Daten und Papierkorb' })).toHaveFocus();
    // Pfeil rechts gehört zur waagerechten Liste
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Daten und Papierkorb' })).toHaveFocus();
  });
});
