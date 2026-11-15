// F-LRN-16 Schritt 2 (VERTRAEGE §21.14): `/lernen/karten` gegen den Fake-Core. Alle Karten, Konzepte und Module sind erfunden.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import type { Card, CardContent } from '@sg/shared';

vi.mock('next/navigation', () => ({
  usePathname: () => '/lernen/karten',
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { CardManager } from '../src/components/learn/CardManager.tsx';
import { ConceptCards } from '../src/components/learn/ConceptCards.tsx';
import { LearnView } from '../src/components/learn/LearnView.tsx';
import {
  bulkMessage,
  cardListHref,
  cardListQuery,
  filtersFromParams,
  filtersToSearch,
} from '../src/lib/card-list.ts';
import { QueryProvider } from '../src/lib/query.tsx';
import { ThemeProvider } from '../src/lib/theme.tsx';
import { ToastProvider } from '../src/lib/toast.tsx';
import { BASIC, CLOZE, makeCard, makeCardState } from './fake-cards.ts';
import { installFakeCore, makeConceptDetail, makeModule, makeSemester, type FakeCore } from './fake-core.ts';

const id = (n: number) => `0190f6a2-0000-7000-8000-${String(n).padStart(12, '0')}`;
const C_3NF = id(801);
const C_SQL = id(803);
const MOD_DBS = id(161);
const MOD_BWL = id(162);

let core: FakeCore;

function boot(cards: Card[]) {
  core = installFakeCore({
    semesters: [makeSemester()],
    modules: [
      makeModule({ id: MOD_DBS, name: 'Datenbanksysteme', short_name: 'DBS' }),
      makeModule({ id: MOD_BWL, name: 'Betriebswirtschaft', short_name: null }),
    ],
  });
  core.concepts = [
    makeConceptDetail({ id: C_3NF, name: 'Dritte Normalform (3NF)' }),
    makeConceptDetail({ id: C_SQL, name: 'SQL-Joins' }),
  ];
  core.cards.conceptNames = { [C_3NF]: 'Dritte Normalform (3NF)', [C_SQL]: 'SQL-Joins' };
  core.cards.conceptModules = {
    [C_3NF]: [{ id: MOD_DBS, name: 'Datenbanksysteme', short_name: 'DBS' }],
    [C_SQL]: [{ id: MOD_BWL, name: 'Betriebswirtschaft', short_name: null }],
  };
  core.cards.cards = cards;
  return core;
}

function wrap(children: ReactNode) {
  return render(
    <ThemeProvider>
      <QueryProvider>
        <ToastProvider>{children}</ToastProvider>
      </QueryProvider>
    </ThemeProvider>,
  );
}

function setUrl(search = '') {
  window.history.replaceState(null, '', `/lernen/karten${search}`);
}

const listGets = () => core.requests.filter((r) => r.method === 'GET' && /^\/cards\?/.test(r.path));
const lastListGet = () => listGets().at(-1)?.path ?? '';
const bulkPosts = () => core.requests.filter((r) => r.method === 'POST' && r.path === '/cards/bulk');
const restorePosts = () =>
  core.requests.filter((r) => r.method === 'POST' && /\/trash\/.+\/restore$/.test(r.path));

const frage = (text: string, overrides: Partial<Card> = {}) =>
  makeCard({
    concept_id: C_3NF,
    content: {
      kind: 'basic',
      front: { text_md: text },
      back: { text_md: 'Antwort', explanation_md: null },
    } as CardContent,
    ...overrides,
  });

const bodyOf = (request: { body: unknown } | undefined) => (request?.body ?? {}) as Record<string, unknown>;

/** Schlüssel in jeder Reihenfolge der Anfrage lesen */
const param = (path: string, name: string) => new URL(path, 'http://x').searchParams.get(name);

beforeEach(() => {
  setUrl();
});

describe('Liste', () => {
  it('zeigt Vorderseite, Konzept, Modul-Kürzel, Typ, Zustand und Quellen – ohne Gesamtzahl', async () => {
    boot([
      makeCard({ concept_id: C_3NF, content: BASIC }),
      makeCard({
        concept_id: C_3NF,
        content: CLOZE,
        origin: 'manuell',
        state: makeCardState({ state: 'review', due: '2026-12-02T10:00:00Z', reps: 3 }),
      }),
      makeCard({ concept_id: C_SQL, content: BASIC, suspended: true }),
    ]);
    wrap(<CardManager />);
    const rows = await screen.findAllByRole('listitem', { name: /^Karte:/ });
    expect(rows).toHaveLength(3);
    expect(screen.getAllByText('Wann ist eine Relation in dritter Normalform?')).toHaveLength(2);
    // Lückentext mit […] verdeckt, die Lösung steht nicht da
    const cloze = rows.find((r) => r.textContent?.includes('Eine Relation in 3NF'));
    expect(cloze).toBeDefined();
    expect(cloze?.textContent).toContain('[…]');
    expect(cloze?.textContent).not.toContain('{{c1');
    expect(within(cloze as HTMLElement).getByText('Lückentext')).toBeInTheDocument();
    expect(within(cloze as HTMLElement).getByTestId('card-state')).toHaveTextContent('fällig am 2. Dezember');
    expect(within(cloze as HTMLElement).getByTestId('card-concept')).toHaveAttribute(
      'href',
      `/bibliothek?konzept=${C_3NF}`,
    );
    expect(within(cloze as HTMLElement).getByTestId('card-modules')).toHaveTextContent('DBS');
    // Ohne Kürzel steht der Name
    expect(
      screen.getByText('Betriebswirtschaft', { selector: '[data-testid="card-modules"]' }),
    ).toBeInTheDocument();
    expect(screen.getByText('pausiert')).toBeInTheDocument();
    expect(screen.getAllByRole('list', { name: 'Quellen dieser Karte' })).toHaveLength(3);
    expect(document.body.textContent).not.toMatch(/Rückstand|insgesamt|\d+ Karten|von \d+/);
  });

  it('„schwer“ steht nur dezent da, nie rot (LP9)', async () => {
    boot([
      frage('Schwere Karte', {
        state: makeCardState({ state: 'review', due: '2026-12-02T10:00:00Z', lapses: 4, difficulty: 8 }),
      }),
    ]);
    wrap(<CardManager />);
    const hard = await screen.findByTestId('card-hard');
    expect(hard).toHaveTextContent('schwer');
    expect(hard.className).not.toMatch(/red|danger|error/);
    expect(hard.closest('p')?.className).toMatch(/text-muted/);
  });

  it('lädt die erste Seite ohne Filter mit dem Standard', async () => {
    boot([frage('Eins')]);
    wrap(<CardManager />);
    await screen.findByText('Eins');
    expect(listGets()).toHaveLength(1);
    expect(lastListGet()).toBe('/cards?limit=50');
  });
});

describe('Filter und Adresse', () => {
  it('Fach, Typ, Herkunft, Status und Sortierung ergeben die richtige Anfrage und stehen in der Adresse', async () => {
    boot([
      frage('A', { origin: 'ki' }),
      makeCard({ concept_id: C_3NF, content: CLOZE, origin: 'manuell', suspended: true }),
    ]);
    const user = userEvent.setup();
    wrap(<CardManager />);
    await screen.findByText('A');

    await user.selectOptions(screen.getByLabelText('Fach'), MOD_DBS);
    await waitFor(() => expect(param(lastListGet(), 'module_id')).toBe(MOD_DBS));
    await user.selectOptions(screen.getByLabelText('Typ'), 'cloze');
    await waitFor(() => expect(param(lastListGet(), 'kind')).toBe('cloze'));
    await user.selectOptions(screen.getByLabelText('Herkunft'), 'manuell');
    await waitFor(() => expect(param(lastListGet(), 'origin')).toBe('manuell'));
    await user.selectOptions(screen.getByLabelText('Status'), 'pausiert');
    await waitFor(() => expect(param(lastListGet(), 'status')).toBe('pausiert'));
    await user.selectOptions(screen.getByLabelText('Sortierung'), 'faellig');
    await waitFor(() => expect(param(lastListGet(), 'sort')).toBe('faellig'));

    const search = new URLSearchParams(window.location.search);
    expect(search.get('module_id')).toBe(MOD_DBS);
    expect(search.get('kind')).toBe('cloze');
    expect(search.get('origin')).toBe('manuell');
    expect(search.get('status')).toBe('pausiert');
    expect(search.get('sort')).toBe('faellig');
    // Nur die eine pausierte Lückentext-Karte bleibt
    await waitFor(() => expect(screen.getAllByRole('listitem', { name: /^Karte:/ })).toHaveLength(1));
    // Standardwerte stehen nicht in der Adresse
    await user.selectOptions(screen.getByLabelText('Status'), 'alle');
    await waitFor(() => expect(new URLSearchParams(window.location.search).has('status')).toBe(false));
  });

  it('liest die Filter beim Öffnen aus der Adresse', async () => {
    boot([frage('Eins'), frage('Zwei', { suspended: true })]);
    setUrl(`?status=pausiert&module_id=${MOD_DBS}&sort=schwer`);
    wrap(<CardManager />);
    await screen.findByText('Zwei');
    expect(screen.queryByText('Eins')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Status')).toHaveValue('pausiert');
    expect(screen.getByLabelText('Fach')).toHaveValue(MOD_DBS);
    expect(screen.getByLabelText('Sortierung')).toHaveValue('schwer');
    expect(listGets()).toHaveLength(1);
    expect(param(lastListGet(), 'status')).toBe('pausiert');
    expect(param(lastListGet(), 'sort')).toBe('schwer');
  });

  it('die Zurück-Taste stellt den vorigen Filter wieder her', async () => {
    boot([frage('Eins'), frage('Zwei', { suspended: true })]);
    const user = userEvent.setup();
    wrap(<CardManager />);
    await screen.findByText('Eins');
    await user.selectOptions(screen.getByLabelText('Status'), 'pausiert');
    await waitFor(() => expect(screen.queryByText('Eins')).not.toBeInTheDocument());
    // Zurück: Der Browser setzt die Adresse und meldet `popstate`
    act(() => {
      window.history.replaceState(null, '', '/lernen/karten');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await screen.findByText('Eins');
    expect(screen.getByLabelText('Status')).toHaveValue('alle');
  });

  it('die Suche wird entprellt und ersetzt den Verlaufseintrag', async () => {
    boot([frage('Normalform Eins'), frage('Joins Zwei')]);
    const lengthBefore = window.history.length;
    wrap(<CardManager />);
    await screen.findByText('Normalform Eins');
    const input = screen.getByLabelText('Karten suchen');
    fireEvent.change(input, { target: { value: 'J' } });
    fireEvent.change(input, { target: { value: 'Jo' } });
    fireEvent.change(input, { target: { value: 'Joins' } });
    expect(listGets()).toHaveLength(1);
    await waitFor(() => expect(param(lastListGet(), 'q')).toBe('Joins'), { timeout: 2000 });
    // Eine einzige Suchanfrage trotz dreier Eingaben
    expect(listGets().filter((r) => param(r.path, 'q') !== null)).toHaveLength(1);
    await waitFor(() => expect(screen.queryByText('Normalform Eins')).not.toBeInTheDocument());
    expect(new URLSearchParams(window.location.search).get('q')).toBe('Joins');
    expect(window.history.length).toBe(lengthBefore);
  });

  it('concept_id steht als entfernbarer Chip und filtert', async () => {
    boot([frage('3NF-Karte'), makeCard({ concept_id: C_SQL, content: CLOZE })]);
    setUrl(`?concept_id=${C_3NF}`);
    const user = userEvent.setup();
    wrap(<CardManager />);
    await screen.findByText('3NF-Karte');
    expect(param(lastListGet(), 'concept_id')).toBe(C_3NF);
    expect(screen.getAllByRole('listitem', { name: /^Karte:/ })).toHaveLength(1);
    expect(await screen.findByText('Konzept: Dritte Normalform (3NF)')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Konzept-Filter entfernen: Dritte Normalform (3NF)' }),
    );
    await waitFor(() => expect(screen.getAllByRole('listitem', { name: /^Karte:/ })).toHaveLength(2));
    expect(new URLSearchParams(window.location.search).has('concept_id')).toBe(false);
    expect(screen.queryByText(/Konzept: /)).not.toBeInTheDocument();
  });

  it('Hilfsfunktionen: Adresse ↔ Filter ↔ Anfrage', () => {
    const filters = filtersFromParams(
      new URLSearchParams(
        `status=schwer&kind=cloze&origin=ki&q=%20Join%20&sort=faellig&module_id=${MOD_DBS}`,
      ).get.bind(
        new URLSearchParams(
          `status=schwer&kind=cloze&origin=ki&q=%20Join%20&sort=faellig&module_id=${MOD_DBS}`,
        ),
      ),
    );
    expect(filters).toMatchObject({
      status: 'schwer',
      kind: 'cloze',
      origin: 'ki',
      q: 'Join',
      sort: 'faellig',
    });
    expect(filtersToSearch(filters)).toBe(
      `?module_id=${MOD_DBS}&kind=cloze&origin=ki&status=schwer&q=Join&sort=faellig`,
    );
    // Unbekannte Werte fallen auf den Standard
    const odd = filtersFromParams(
      new URLSearchParams('status=x&kind=y&module_id=nope&sort=z').get.bind(
        new URLSearchParams('status=x&kind=y&module_id=nope&sort=z'),
      ),
    );
    expect(filtersToSearch(odd)).toBe('');
    expect(cardListQuery(odd, 'abc')).toBe('limit=50&cursor=abc');
    expect(cardListHref({ concept_id: C_3NF })).toBe(`/lernen/karten?concept_id=${C_3NF}`);
    expect(cardListHref()).toBe('/lernen/karten');
  });
});

describe('Mehr laden', () => {
  it('lädt die nächste Seite über den Cursor und zeigt keine Gesamtzahl', async () => {
    const cards = ['Eins', 'Zwei', 'Drei'].map((t, i) =>
      frage(t, { created_at: `2026-11-1${3 - i}T10:00:00Z` }),
    );
    boot(cards);
    core.cards.listPageSize = 2;
    const user = userEvent.setup();
    wrap(<CardManager />);
    await screen.findByText('Eins');
    expect(screen.getAllByRole('listitem', { name: /^Karte:/ })).toHaveLength(2);
    expect(screen.queryByText('Drei')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mehr laden' }));
    await screen.findByText('Drei');
    expect(screen.getAllByRole('listitem', { name: /^Karte:/ })).toHaveLength(3);
    expect(param(lastListGet(), 'cursor')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Mehr laden' })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\b3 Karten|insgesamt/);
  });
});

describe('Einzelaktionen', () => {
  async function openMenu(user: ReturnType<typeof userEvent.setup>, front: string) {
    await user.click(await screen.findByRole('button', { name: `Menü: ${front}` }));
  }

  it('Pausieren und Fortsetzen senden PATCH und laden Liste und Warteschlange neu', async () => {
    boot([frage('Eins')]);
    const user = userEvent.setup();
    wrap(<CardManager />);
    await openMenu(user, 'Eins');
    await user.click(screen.getByRole('button', { name: 'Pausieren' }));
    await waitFor(() => expect(core.cards.cards[0]?.suspended).toBe(true));
    await waitFor(() => expect(screen.getByText('pausiert')).toBeInTheDocument());
    expect(core.requests.some((r) => r.method === 'PATCH' && bodyOf(r).suspended === true)).toBe(true);
    await openMenu(user, 'Eins');
    await user.click(screen.getByRole('button', { name: 'Fortsetzen' }));
    await waitFor(() => expect(core.cards.cards[0]?.suspended).toBe(false));
  });

  it('Pausieren lädt die Warteschlange (`review`) neu', async () => {
    boot([frage('Eins')]);
    const user = userEvent.setup();
    wrap(
      <>
        <CardManager />
        <LearnView />
      </>,
    );
    await screen.findByText('Eins');
    await waitFor(() => expect(core.requests.some((r) => r.path.startsWith('/review/queue'))).toBe(true));
    const before = core.requests.filter((r) => r.path.startsWith('/review/queue')).length;
    await openMenu(user, 'Eins');
    await user.click(screen.getByRole('button', { name: 'Pausieren' }));
    await waitFor(() =>
      expect(core.requests.filter((r) => r.path.startsWith('/review/queue')).length).toBeGreaterThan(before),
    );
  });

  it('Bearbeiten speichert den neuen Text', async () => {
    boot([frage('Eins')]);
    const user = userEvent.setup();
    wrap(<CardManager />);
    await openMenu(user, 'Eins');
    await user.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    const field = await screen.findByLabelText('Vorderseite');
    await user.clear(field);
    await user.type(field, 'Neu formuliert');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await screen.findByText('Neu formuliert');
    expect(core.cards.cards[0]?.content.front.text_md).toBe('Neu formuliert');
  });

  it('Löschen bietet 10 s Rückgängig, das die Karte zurückholt', async () => {
    boot([frage('Eins')]);
    const user = userEvent.setup();
    wrap(<CardManager />);
    await openMenu(user, 'Eins');
    await user.click(screen.getByRole('button', { name: 'Löschen' }));
    await waitFor(() => expect(screen.queryByText('Eins')).not.toBeInTheDocument());
    await user.click(await screen.findByRole('button', { name: 'Rückgängig' }));
    await screen.findByText('Eins');
    expect(restorePosts()).toHaveLength(1);
  });
});

describe('Mehrfachauswahl', () => {
  const three = () => [frage('Eins'), frage('Zwei', { suspended: true }), frage('Drei')];

  it('Checkbox je Zeile und „Alle auf dieser Seite“ zeigen „n ausgewählt“ mit den Aktionen', async () => {
    boot(three());
    const user = userEvent.setup();
    wrap(<CardManager />);
    await screen.findByText('Eins');
    expect(screen.queryByRole('toolbar', { name: 'Auswahl' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Karte auswählen: Eins' }));
    const bar = screen.getByRole('toolbar', { name: 'Auswahl' });
    expect(within(bar).getByText('1 ausgewählt')).toBeInTheDocument();
    for (const name of ['Pausieren', 'Fortsetzen', 'Löschen']) {
      expect(within(bar).getByRole('button', { name })).toBeInTheDocument();
    }
    await user.click(screen.getByRole('checkbox', { name: 'Alle auf dieser Seite' }));
    expect(
      within(screen.getByRole('toolbar', { name: 'Auswahl' })).getByText('3 ausgewählt'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Alle auf dieser Seite' }));
    expect(screen.queryByRole('toolbar', { name: 'Auswahl' })).not.toBeInTheDocument();
  });

  it('Pausieren: ein POST mit den IDs, `skipped` ruhig gemeldet, Liste neu geladen', async () => {
    const cards = three();
    boot(cards);
    const user = userEvent.setup();
    wrap(<CardManager />);
    await screen.findByText('Eins');
    await user.click(screen.getByRole('checkbox', { name: 'Alle auf dieser Seite' }));
    await user.click(screen.getByRole('button', { name: 'Pausieren' }));
    await waitFor(() => expect(bulkPosts()).toHaveLength(1));
    const post = bulkPosts()[0];
    expect(bodyOf(post).action).toBe('suspend');
    expect([...((bodyOf(post).ids as string[]) ?? [])].sort()).toEqual(cards.map((c) => c.id).sort());
    // „Zwei“ war schon pausiert
    expect(await screen.findByText('2 pausiert · 1 unverändert')).toBeInTheDocument();
    expect(core.cards.cards.every((c) => c.suspended)).toBe(true);
    // Auswahl aufgehoben, Liste neu geladen
    expect(screen.queryByRole('toolbar', { name: 'Auswahl' })).not.toBeInTheDocument();
    expect(listGets().length).toBeGreaterThan(1);
  });

  it('Fortsetzen setzt pausierte Karten fort', async () => {
    boot(three());
    const user = userEvent.setup();
    wrap(<CardManager />);
    await screen.findByText('Zwei');
    await user.click(screen.getByRole('checkbox', { name: 'Karte auswählen: Zwei' }));
    await user.click(screen.getByRole('button', { name: 'Fortsetzen' }));
    await screen.findByText('1 fortgesetzt');
    expect(bodyOf(bulkPosts()[0]).action).toBe('resume');
    expect(core.cards.cards.some((c) => c.suspended)).toBe(false);
  });

  it('Löschen: 10 s Rückgängig stellt jede geänderte ID über den Papierkorb wieder her', async () => {
    const cards = three();
    boot(cards);
    const user = userEvent.setup();
    wrap(<CardManager />);
    await screen.findByText('Eins');
    await user.click(screen.getByRole('checkbox', { name: 'Karte auswählen: Eins' }));
    await user.click(screen.getByRole('checkbox', { name: 'Karte auswählen: Drei' }));
    await user.click(screen.getByRole('button', { name: 'Löschen' }));
    await waitFor(() => expect(core.cards.cards).toHaveLength(1));
    expect(await screen.findByText('2 gelöscht')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Drei')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Rückgängig' }));
    await waitFor(() => expect(core.cards.cards).toHaveLength(3));
    const restored = restorePosts()
      .map((r) => r.path.split('/')[2])
      .sort();
    expect(restored).toEqual([cards[0]?.id, cards[2]?.id].sort());
    await screen.findByText('Drei');
  });

  it('eine bereits gelöschte Karte wird als „nicht mehr vorhanden“ gemeldet', async () => {
    const cards = three();
    boot(cards);
    const user = userEvent.setup();
    wrap(<CardManager />);
    await screen.findByText('Eins');
    await user.click(screen.getByRole('checkbox', { name: 'Karte auswählen: Eins' }));
    // Inzwischen anderswo gelöscht
    core.cards.trashed.push(...core.cards.cards.filter((c) => c.id === cards[0]?.id));
    core.cards.cards = core.cards.cards.filter((c) => c.id !== cards[0]?.id);
    await user.click(screen.getByRole('button', { name: 'Pausieren' }));
    expect(await screen.findByText('1 nicht mehr vorhanden')).toBeInTheDocument();
  });

  it('bulkMessage fasst ruhig zusammen', () => {
    expect(bulkMessage('suspend', { changed: ['a', 'b', 'c'], skipped: [] })).toBe('3 pausiert');
    expect(
      bulkMessage('delete', {
        changed: ['a'],
        skipped: [
          { id: 'b', code: 'unchanged' },
          { id: 'c', code: 'unchanged' },
        ],
      }),
    ).toBe('1 gelöscht · 2 unverändert');
    expect(bulkMessage('resume', { changed: [], skipped: [{ id: 'b', code: 'unchanged' }] })).toBe(
      '1 unverändert',
    );
  });
});

describe('Tastatur', () => {
  it('Pfeiltasten wechseln die Zeile, Leertaste markiert, E bearbeitet', async () => {
    boot([
      frage('Eins', { created_at: '2026-11-13T10:00:00Z' }),
      frage('Zwei', { created_at: '2026-11-12T10:00:00Z' }),
    ]);
    const user = userEvent.setup();
    wrap(<CardManager />);
    const first = await screen.findByRole('listitem', { name: 'Karte: Eins' });
    const second = screen.getByRole('listitem', { name: 'Karte: Zwei' });
    first.focus();
    await user.keyboard('{ArrowDown}');
    expect(second).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(first).toHaveFocus();
    await user.keyboard(' ');
    expect(screen.getByRole('checkbox', { name: 'Karte auswählen: Eins' })).toBeChecked();
    await user.keyboard(' ');
    expect(screen.getByRole('checkbox', { name: 'Karte auswählen: Eins' })).not.toBeChecked();
    await user.keyboard('e');
    expect(await screen.findByLabelText('Vorderseite')).toBeInTheDocument();
  });
});

describe('Leere Zustände', () => {
  it('ohne Karten: „Noch keine Karten“ mit Link zur Inbox', async () => {
    boot([]);
    wrap(<CardManager />);
    expect(await screen.findByText(/Noch keine Karten/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zur Inbox' })).toHaveAttribute('href', '/inbox');
  });

  it('mit Filter ohne Treffer: „Keine Karten für diese Filter“, Zurücksetzen hilft', async () => {
    boot([frage('Eins')]);
    setUrl('?status=pausiert');
    const user = userEvent.setup();
    wrap(<CardManager />);
    expect(await screen.findByText('Keine Karten für diese Filter.')).toBeInTheDocument();
    expect(screen.queryByText(/Noch keine Karten/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));
    await screen.findByText('Eins');
  });

  it('erreicht der Core die Karten nicht, steht ein ruhiger Hinweis da', async () => {
    boot([frage('Eins')]);
    core.down = true;
    wrap(<CardManager />);
    expect(await screen.findByText('Core nicht erreichbar')).toBeInTheDocument();
  });
});

describe('Einstiege', () => {
  it('Lernen verweist ruhig auf „Karten verwalten“', async () => {
    boot([frage('Eins')]);
    wrap(<LearnView />);
    const link = await screen.findByRole('link', { name: 'Karten verwalten' });
    expect(link).toHaveAttribute('href', '/lernen/karten');
  });

  it('die Konzeptansicht verweist auf „Alle Karten dieses Konzepts“', async () => {
    boot([frage('Eins')]);
    wrap(<ConceptCards conceptId={C_3NF} conceptName="Dritte Normalform (3NF)" evidence={[]} />);
    const link = await screen.findByRole('link', { name: 'Alle Karten dieses Konzepts' });
    expect(link).toHaveAttribute('href', `/lernen/karten?concept_id=${C_3NF}`);
  });
});
