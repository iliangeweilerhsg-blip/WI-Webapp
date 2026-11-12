// Suche (T2-13, VERTRAEGE §19.7): Overlay mit Entprellung, Abbruch, Gruppen, Tastatur, Zuständen und Fokus.
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const nav = vi.hoisted(() => ({ pathname: '/', push: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push }),
}));

import { SearchOverlay } from '../src/components/search/SearchOverlay.tsx';
import { QueryProvider } from '../src/lib/query.tsx';
import { installFakeCore, makeConceptDetail, type FakeCore, type SearchFixtureHit } from './fake-core.ts';

let core: FakeCore;
let openSpy: ReturnType<typeof vi.fn>;

/** Wie im AppShell: ein Knopf öffnet das Overlay */
function Host({ start = true }: { start?: boolean }) {
  const [open, setOpen] = useState(start);
  return (
    <QueryProvider>
      <button type="button" onClick={() => setOpen(true)}>
        Suche öffnen
      </button>
      <SearchOverlay open={open} onClose={() => setOpen(false)} />
    </QueryProvider>
  );
}

const searchRequests = () => core.requests.filter((r) => r.path.startsWith('/search'));
const input = () => screen.getByRole('combobox', { name: 'Suchbegriff' });
const options = () => screen.queryAllByRole('option');
const selected = () => options().filter((o) => o.getAttribute('aria-selected') === 'true');

async function typeQuery(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(input(), text);
}

beforeEach(() => {
  nav.pathname = '/';
  nav.push = vi.fn();
  core = installFakeCore();
  openSpy = vi.fn();
  vi.stubGlobal('open', openSpy);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Suche: Zustände', () => {
  it('leer: Hinweis auf die Präfixe, keine Anfrage', async () => {
    render(<Host />);
    expect(screen.getByRole('dialog', { name: 'Suche' })).toBeVisible();
    expect(input()).toHaveFocus();
    expect(screen.getByText('fach:DBS')).toBeVisible();
    expect(screen.getByText('typ:folie')).toBeVisible();
    expect(screen.getByText('typ:gesagtes')).toBeVisible();
    expect(searchRequests()).toHaveLength(0);
  });

  it('nur Leerzeichen sind keine Anfrage', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await typeQuery(user, '   ');
    await new Promise((r) => setTimeout(r, 300));
    expect(searchRequests()).toHaveLength(0);
  });

  it('keine Treffer: „Nichts gefunden“', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await typeQuery(user, 'zzzz');
    expect(await screen.findByText('Nichts gefunden')).toBeVisible();
    expect(options()).toHaveLength(0);
  });

  it('unbekannter Filter wird genannt', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await typeQuery(user, 'normalform fach:XYZ');
    expect(await screen.findByText('Unbekannter Filter: fach:XYZ')).toBeVisible();
    expect(screen.queryByText('Nichts gefunden')).toBeNull();
  });

  it.each([
    ['embedder_not_ready', 'Nur Wortsuche · Bedeutungssuche startet noch'],
    ['embedder_unavailable', 'Nur Wortsuche · Bedeutungssuche nicht verfügbar'],
  ] as const)('reine Wortsuche (%s) zeigt eine ruhige Zeile, die Treffer bleiben', async (reason, text) => {
    core.searchDegraded = reason;
    const user = userEvent.setup();
    render(<Host />);
    await typeQuery(user, 'normalform');
    expect(await screen.findByText(text)).toBeVisible();
    expect(options().length).toBeGreaterThan(0);
  });

  it('Fehler der Anfrage: „Suche gerade nicht erreichbar“', async () => {
    core.failSearch = true;
    const user = userEvent.setup();
    render(<Host />);
    await typeQuery(user, 'normalform');
    expect(await screen.findByText('Suche gerade nicht erreichbar')).toBeVisible();
    expect(options()).toHaveLength(0);
  });

  it('Core aus: dieselbe Zeile', async () => {
    core.down = true;
    const user = userEvent.setup();
    render(<Host />);
    await typeQuery(user, 'normalform');
    expect(await screen.findByText('Suche gerade nicht erreichbar')).toBeVisible();
  });

  it('Ladehinweis erst nach 300 ms ohne Antwort', async () => {
    const real = globalThis.fetch;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (...args: Parameters<typeof fetch>) => {
        await gate;
        return real(...args);
      }),
    );
    const user = userEvent.setup();
    render(<Host />);
    await typeQuery(user, 'normalform');
    // Anfrage läuft (nach 120 ms), aber der Hinweis fehlt noch
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(screen.queryByText('Sucht …')).toBeNull();
    expect(await screen.findByText('Sucht …')).toBeVisible();
    release();
    await waitFor(() => expect(options().length).toBeGreaterThan(0));
    expect(screen.queryByText('Sucht …')).toBeNull();
  });
});

describe('Suche: Anfrage', () => {
  it('entprellt (eine Anfrage nach schnellem Tippen), limit=50, Text unverändert', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await typeQuery(user, 'normalform');
    await waitFor(() => expect(options().length).toBeGreaterThan(0));
    const requests = searchRequests();
    expect(requests).toHaveLength(1);
    const params = new URLSearchParams(requests[0]!.path.split('?')[1]);
    expect(params.get('q')).toBe('normalform');
    expect(params.get('limit')).toBe('50');
    expect(requests[0]!.method).toBe('GET');
  });

  it('wartet 120 ms nach dem letzten Tastendruck', async () => {
    vi.useFakeTimers();
    try {
      render(<Host />);
      const type = (value: string) => fireEvent.change(input(), { target: { value } });
      type('ab');
      await act(async () => void vi.advanceTimersByTime(100));
      expect(searchRequests()).toHaveLength(0);
      await act(async () => void vi.advanceTimersByTime(30));
      expect(searchRequests()).toHaveLength(1);
      // Jeder weitere Tastendruck setzt die Wartezeit zurück
      type('abc');
      await act(async () => void vi.advanceTimersByTime(100));
      type('abcd');
      await act(async () => void vi.advanceTimersByTime(100));
      expect(searchRequests()).toHaveLength(1);
      await act(async () => void vi.advanceTimersByTime(30));
      expect(searchRequests()).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('bricht die vorige Anfrage ab (AbortController)', async () => {
    const real = globalThis.fetch;
    const signals: AbortSignal[] = [];
    let first = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        // nur `/search`; der Konzeptaufruf (UX-309) läuft nebenher
        if (!String(input).includes('/search')) return real(input, init);
        if (init?.signal) signals.push(init.signal);
        if (first) {
          first = false;
          await new Promise((_, reject) =>
            init?.signal?.addEventListener('abort', () => reject(new DOMException('x', 'AbortError'))),
          );
        }
        return real(input, init);
      }),
    );
    const user = userEvent.setup();
    render(<Host />);
    await typeQuery(user, 'norm');
    await waitFor(() => expect(signals).toHaveLength(1));
    await typeQuery(user, 'alform');
    await waitFor(() => expect(signals).toHaveLength(2));
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[1]!.aborted).toBe(false);
    // Der Abbruch ist kein Fehler
    await waitFor(() => expect(options().length).toBeGreaterThan(0));
    expect(screen.queryByText('Suche gerade nicht erreichbar')).toBeNull();
  });

  it('die letzte Antwort bleibt sichtbar, bis die neue da ist', async () => {
    const real = globalThis.fetch;
    let hold: Promise<void> | null = null;
    let release: () => void = () => undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (...args: Parameters<typeof fetch>) => {
        if (hold) await hold;
        return real(...args);
      }),
    );
    const user = userEvent.setup();
    render(<Host />);
    await typeQuery(user, 'normalform');
    await waitFor(() => expect(options()).toHaveLength(4));
    hold = new Promise<void>((resolve) => (release = resolve));
    await typeQuery(user, ' typ:folie');
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2));
    // Neue Anfrage hängt: die alten vier Treffer stehen weiter da (kein Flackern)
    expect(options()).toHaveLength(4);
    release();
    await waitFor(() => expect(options()).toHaveLength(2));
  });

  it('leeres Feld verwirft die Antwort', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await typeQuery(user, 'normalform');
    await waitFor(() => expect(options()).toHaveLength(4));
    await user.clear(input());
    await waitFor(() => expect(options()).toHaveLength(0));
    expect(screen.getByText('typ:folie')).toBeVisible();
  });
});

describe('Suche: Treffer', () => {
  it('Gruppen „Folien“, dann „Gesagtes“, je höchstens 8 nach score', async () => {
    const MOD = { id: '0190f6a2-0000-7000-8000-0000000000a3', name: 'Datenbanksysteme', short_name: 'DBS' };
    const id = (n: number) => `0190f6a2-0000-7000-8000-${String(7000 + n).padStart(12, '0')}`;
    const fixtures: SearchFixtureHit[] = [];
    // Gesagtes zuerst und mit höherem score: die feste Reihenfolge der Gruppen gilt trotzdem
    for (let n = 1; n <= 10; n++) {
      fixtures.push({
        kind: 'transcript',
        chunk_id: id(100 + n),
        score: 1 + n / 100,
        module: MOD,
        text: `Das Thema Index Nummer ${n}`,
        session_id: id(300),
        session_number: 3,
        session_title: 'Indizes',
        session_started_at: null,
        t_ms: n * 60_000,
        t_end_ms: n * 60_000 + 1000,
      });
    }
    for (let n = 1; n <= 12; n++) {
      fixtures.push({
        kind: 'slide',
        chunk_id: id(n),
        score: n / 100,
        module: MOD,
        text: `Index Nummer ${n}`,
        deck_id: id(200),
        deck_title: 'VL 9 Indizes',
        slide_index: n,
        slide_title: null,
      });
    }
    core.searchFixtures = fixtures;
    const user = userEvent.setup();
    render(<Host />);
    await typeQuery(user, 'index');
    await waitFor(() => expect(options()).toHaveLength(16));
    const groupsNames = screen.getAllByRole('group').map((g) => g.getAttribute('aria-labelledby'));
    expect(groupsNames).toHaveLength(2);
    expect(screen.getAllByRole('group').map((g) => g.firstElementChild?.textContent)).toEqual([
      'Folien',
      'Gesagtes',
    ]);
    expect(screen.queryAllByRole('heading')).toHaveLength(0);
    const slides = within(screen.getByRole('group', { name: 'Folien' })).getAllByRole('option');
    expect(slides).toHaveLength(8);
    expect(slides[0]).toHaveTextContent('Folie 12');
    expect(slides[7]).toHaveTextContent('Folie 5');
    const spoken = within(screen.getByRole('group', { name: 'Gesagtes' })).getAllByRole('option');
    expect(spoken).toHaveLength(8);
    // höchster score zuerst: Stelle 10 bei 10:00
    expect(spoken[0]).toHaveTextContent('VL 3 · Indizes');
    expect(spoken[0]).toHaveTextContent('10:00');
  });

  it('Folie: Foliensatz · Folie n · Titel; Gesagtes: VL n bzw. Datum, mm:ss und ▶', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await typeQuery(user, 'normalform');
    await waitFor(() => expect(options()).toHaveLength(4));
    const [first] = within(screen.getByRole('group', { name: 'Folien' })).getAllByRole('option');
    expect(first).toHaveTextContent('VL 7 Normalisierung · Folie 14 · 3NF');
    expect(first).toHaveTextContent('DBS');
    const spoken = within(screen.getByRole('group', { name: 'Gesagtes' })).getAllByRole('option');
    // VL 7 ohne Titel, t = 2 512 000 ms
    expect(spoken[0]).toHaveTextContent('VL 7');
    expect(spoken[0]).toHaveTextContent('41:52');
    expect(spoken[0]).toHaveTextContent('▶');
    // weder Nummer noch Titel: das Datum der Session
    expect(spoken[1]).toHaveTextContent(/2026/);
    expect(spoken[1]).toHaveTextContent('01:35');
    expect(first).not.toHaveTextContent('▶');
  });

  it('Treffer-Wörter stehen als <mark>, fremdes HTML wird nicht interpretiert', async () => {
    core.searchFixtures = [
      {
        kind: 'slide',
        chunk_id: '0190f6a2-0000-7000-8000-000000007001',
        score: 1,
        module: { id: '0190f6a2-0000-7000-8000-0000000000a3', name: 'Datenbanksysteme', short_name: null },
        text: '<img src=x onerror=alert(1)> Normalform <script>alert(2)</script>',
        deck_id: '0190f6a2-0000-7000-8000-000000007100',
        deck_title: 'VL 1',
        slide_index: 1,
        slide_title: null,
      },
    ];
    const user = userEvent.setup();
    render(<Host />);
    await typeQuery(user, 'normalform');
    const option = await screen.findByRole('option');
    expect(option.querySelectorAll('mark')).toHaveLength(1);
    expect(option.querySelector('mark')).toHaveTextContent('Normalform');
    expect(option.querySelector('img, script')).toBeNull();
    expect(option).toHaveTextContent('<img src=x onerror=alert(1)>');
    // ohne Kurznamen steht der Modulname
    expect(option).toHaveTextContent('Datenbanksysteme');
  });
});

describe('Suche: Tastatur', () => {
  async function ready(text = 'normalform') {
    const user = userEvent.setup();
    render(<Host />);
    await typeQuery(user, text);
    await waitFor(() => expect(options().length).toBeGreaterThan(0));
    return user;
  }

  it('↑/↓ wählen über alle Gruppen und springen am Ende herum', async () => {
    const user = await ready();
    const all = options();
    expect(all).toHaveLength(4);
    expect(selected()).toEqual([all[0]]);
    expect(input()).toHaveAttribute('aria-activedescendant', all[0]!.id);
    await user.keyboard('{ArrowDown}');
    expect(selected()).toEqual([all[1]]);
    await user.keyboard('{ArrowDown}{ArrowDown}');
    // dritte Wahl liegt schon in „Gesagtes“
    expect(selected()).toEqual([all[3]]);
    expect(all[3]!.closest('[role="group"]')).toBe(screen.getByRole('group', { name: 'Gesagtes' }));
    await user.keyboard('{ArrowDown}');
    expect(selected()).toEqual([all[0]]);
    await user.keyboard('{ArrowUp}');
    expect(selected()).toEqual([all[3]]);
    expect(input()).toHaveFocus();
  });

  it('Enter öffnet eine Folie in der PDF-Anzeige und schließt das Overlay', async () => {
    const user = await ready();
    await user.keyboard('{Enter}');
    expect(nav.push).toHaveBeenCalledWith(
      '/dokument?typ=folien&id=0190f6a2-0000-7000-8000-000000005100&seite=14',
    );
    expect(openSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Enter auf Gesagtem öffnet den Rückblick bei t', async () => {
    const user = await ready();
    await user.keyboard('{ArrowUp}{Enter}');
    // zuletzt gewählt: letzter Treffer aus „Gesagtes“ (t = 95 000)
    expect(nav.push).toHaveBeenCalledWith('/rueckblick?id=0190f6a2-0000-7000-8000-000000005201&t=95000');
  });

  it('Strg+Enter öffnet in einem neuen Tab, das Overlay bleibt', async () => {
    const user = await ready();
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(openSpy).toHaveBeenCalledWith(
      '/dokument?typ=folien&id=0190f6a2-0000-7000-8000-000000005100&seite=14',
      '_blank',
      'noopener',
    );
    expect(nav.push).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeVisible();
  });

  it('⌘Enter ebenso', async () => {
    const user = await ready();
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(nav.push).not.toHaveBeenCalled();
  });

  it('auf der Live-Route (/session) öffnet auch Enter in einem neuen Tab', async () => {
    nav.pathname = '/session';
    const user = await ready();
    expect(screen.getByText(/Enter öffnet in neuem Tab/)).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy.mock.calls[0]![1]).toBe('_blank');
    expect(nav.push).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeVisible();
  });

  it('Klick auf einen Treffer öffnet ihn', async () => {
    const user = await ready();
    await user.click(options()[3]!);
    expect(nav.push).toHaveBeenCalledWith('/rueckblick?id=0190f6a2-0000-7000-8000-000000005201&t=95000');
  });

  it('Enter ohne Treffer tut nichts', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await typeQuery(user, 'zzzz');
    await screen.findByText('Nichts gefunden');
    await user.keyboard('{Enter}');
    expect(nav.push).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });
});

describe('Suche: Fokus und Schließen', () => {
  it('Esc schließt, der Fokus kehrt zum Knopf zurück', async () => {
    const user = userEvent.setup();
    render(<Host start={false} />);
    const opener = screen.getByRole('button', { name: 'Suche öffnen' });
    await user.click(opener);
    expect(input()).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('Fokusfalle: Tab und Umschalt+Tab bleiben im Overlay', async () => {
    const user = userEvent.setup();
    render(<Host />);
    const dialog = screen.getByRole('dialog');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Schließen' })).toHaveFocus();
    await user.tab();
    expect(input()).toHaveFocus();
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(screen.getByRole('button', { name: 'Schließen' })).toHaveFocus();
  });

  it('Schließen-Knopf und Klick auf den Hintergrund schließen', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByRole('button', { name: 'Schließen' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Suche öffnen' }));
    const backdrop = screen.getByRole('dialog').parentElement as HTMLElement;
    await user.click(backdrop);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('das Overlay ist 640 px breit und auf schmalen Bildschirmen volle Breite mit 16 px Rand', () => {
    render(<Host />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('max-w-[640px]');
    expect(dialog.className).toContain('w-full');
    expect(dialog.parentElement?.className).toContain('px-4');
  });
});

describe('Suche: Tasten bleiben im Overlay (auf /session)', () => {
  it('Tab + P, Klick in die Fußzeile + P und Pfeiltasten erreichen window nicht', async () => {
    nav.pathname = '/session';
    const user = userEvent.setup();
    render(<Host />);
    const spy = vi.fn();
    window.addEventListener('keydown', spy);
    try {
      await user.tab();
      expect(screen.getByRole('button', { name: 'Schließen' })).toHaveFocus();
      await user.keyboard('p2');
      expect(spy).not.toHaveBeenCalled();
      // Klick ins Leere der Fußzeile: Fokus bleibt im Dialog
      await user.click(screen.getByText(/Enter öffnet in neuem Tab/));
      expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
      await user.keyboard('p');
      expect(spy).not.toHaveBeenCalled();
      // Fokus von außen hineinholen
      const outside = document.createElement('button');
      document.body.appendChild(outside);
      outside.focus();
      expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
      outside.remove();
      // ⌘/Strg+K darf durch (schaltet die Suche um)
      await user.keyboard('{Control>}k{/Control}');
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('keydown', spy);
    }
  });

  it('Esc während einer IME-Eingabe schließt nicht', async () => {
    render(<Host />);
    fireEvent.keyDown(input(), { key: 'Escape', isComposing: true });
    expect(screen.getByRole('dialog')).toBeVisible();
  });
});

describe('Suche: Konzepte (UX-309)', () => {
  const conceptRequests = () => core.requests.filter((r) => r.path.startsWith('/concepts'));

  beforeEach(() => {
    core.concepts = [
      makeConceptDetail({
        id: '0190f6a2-0000-7000-8000-0000000c0042',
        name: 'Normalform',
        aliases: ['NF'],
        one_liner: 'Regeln gegen Redundanz',
      }),
    ];
  });

  it('zeigt Konzepte als Gruppe mit Name, Modul und Link zur Konzeptseite', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await typeQuery(user, 'normalform');
    const group = await screen.findByRole('group', { name: 'Konzepte' });
    const row = within(group).getByRole('option');
    expect(row).toHaveTextContent('Normalform');
    expect(row).toHaveTextContent('DBS');
    expect(row).toHaveAttribute('data-kind', 'concept');
    const params = new URLSearchParams(conceptRequests()[0]!.path.split('?')[1]);
    expect(params.get('q')).toBe('normalform');
    expect(params.get('limit')).toBe('5');
    await user.click(row);
    expect(nav.push).toHaveBeenCalledWith('/bibliothek?konzept=0190f6a2-0000-7000-8000-0000000c0042');
  });

  it('findet ein Konzept auch über seinen Alias, Enter öffnet es', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await typeQuery(user, 'nf');
    await screen.findByRole('group', { name: 'Konzepte' });
    await user.keyboard('{ArrowUp}{Enter}');
    expect(nav.push).toHaveBeenCalledWith('/bibliothek?konzept=0190f6a2-0000-7000-8000-0000000c0042');
  });

  it('mit Filterpräfix kein Konzeptaufruf', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await typeQuery(user, 'normalform typ:folie');
    await waitFor(() => expect(searchRequests().length).toBeGreaterThan(0));
    expect(conceptRequests()).toHaveLength(0);
    expect(screen.queryByRole('group', { name: 'Konzepte' })).toBeNull();
  });

  it('Konzepte allein genügen: kein „Nichts gefunden“', async () => {
    core.concepts = [makeConceptDetail({ name: 'Zzyzx' })];
    const user = userEvent.setup();
    render(<Host />);
    await typeQuery(user, 'zzyzx');
    await screen.findByRole('group', { name: 'Konzepte' });
    expect(screen.queryByText('Nichts gefunden')).toBeNull();
  });

  it('scheitert nur der Konzeptaufruf, bleiben Folien und Gesagtes ohne Fehlerzeile', async () => {
    const real = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (...args: Parameters<typeof fetch>) => {
        if (String(args[0]).includes('/concepts')) throw new TypeError('offline');
        return real(...args);
      }),
    );
    const user = userEvent.setup();
    render(<Host />);
    await typeQuery(user, 'normalform');
    await waitFor(() => expect(options().length).toBeGreaterThan(0));
    expect(screen.queryByText('Suche gerade nicht erreichbar')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Konzepte' })).toBeNull();
  });

  it('fällt nur `/search` aus, bleiben die Konzepte neben der Fehlerzeile erreichbar', async () => {
    const real = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (...args: Parameters<typeof fetch>) => {
        if (String(args[0]).includes('/search')) throw new TypeError('offline');
        return real(...args);
      }),
    );
    const user = userEvent.setup();
    render(<Host />);
    await typeQuery(user, 'normalform');
    const group = await screen.findByRole('group', { name: 'Konzepte' });
    expect(within(group).getByRole('option')).toHaveTextContent('Normalform');
    expect(await screen.findByText('Suche gerade nicht erreichbar')).toBeVisible();
    await user.keyboard('{Enter}');
    expect(nav.push).toHaveBeenCalledWith('/bibliothek?konzept=0190f6a2-0000-7000-8000-0000000c0042');
  });
});
