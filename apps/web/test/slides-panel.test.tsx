// Folien-Spalte (T1-05, F-DSH-02): Anzeige, Blättern per Taste/Klick, `slide.change` mit Sitzungszeit, fremde Wechsel.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import type { SlideEvent, SyncOp } from '@sg/shared';
import { SlidesPanel, slideStep } from '../src/components/dashboard/slides/SlidesPanel.tsx';
import { makeQueryClient } from '../src/lib/query.tsx';
import { SyncHandedOverError, type SyncClient } from '../src/lib/sync/client.ts';
import {
  installFakeCore,
  makeDeck,
  makeModule,
  makeSession,
  makeSlides,
  type FakeCore,
} from './fake-core.ts';

const SESSION_ID = '0190f6a2-0000-7000-8000-0000000000e1';
const DECK_ID = '0190f6a2-0000-7000-8000-0000000000d1';
const MODULE = makeModule({ id: '0190f6a2-0000-7000-8000-0000000000a3' });
const STARTED = Date.parse('2026-11-04T08:00:00Z');

let core: FakeCore;

/** Sync-Client, der `send` aufzeichnet und den Strom für Tests steuerbar macht. */
function fakeClient() {
  const sent: Record<string, unknown>[] = [];
  let onOp: ((op: SyncOp) => void) | null = null;
  let from: { lastSeq: number; lastOpId: string | null } | null = null;
  const unsubscribe = vi.fn();
  const send = vi.fn(async (input: Record<string, unknown>) => {
    sent.push(input);
    return { type: 'ack', op_id: 'x', seq: sent.length };
  });
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  const client = {
    connectionState: 'online',
    clockOffsetMs: null as number | null,
    send,
    onEvent: vi.fn((name: string, fn: (data: unknown) => void) => {
      const set = listeners.get(name) ?? new Set();
      set.add(fn);
      listeners.set(name, set);
      return () => void set.delete(fn);
    }),
    subscribe: vi.fn(
      (_stream: string, pos: { lastSeq: number; lastOpId: string | null }, cb: (op: SyncOp) => void) => {
        from = pos;
        onOp = cb;
        return unsubscribe;
      },
    ),
  };
  return {
    client: client as unknown as SyncClient,
    send,
    sent,
    unsubscribe,
    raw: client,
    emit: (name: string, data: unknown) => act(() => listeners.get(name)?.forEach((fn) => fn(data))),
    deliver: (op: SyncOp) => act(() => onOp?.(op)),
    get from() {
      return from;
    },
    subscribe: client.subscribe,
  };
}

function slideEvent(index: number, tMs: number): SlideEvent {
  return {
    id: `0190f6a2-0000-7000-8000-${String(7000 + tMs).padStart(12, '0')}`,
    user_id: '0190f6a2-0000-7000-8000-000000000000',
    created_at: '2026-11-04T08:00:00Z',
    updated_at: '2026-11-04T08:00:00Z',
    deleted_at: null,
    session_id: SESSION_ID,
    slide_id: null,
    slide_index: index,
    t_ms: tMs,
    device: 'ipad',
    source: 'manuell_ipad',
  };
}

function remoteChange(index: number, tMs: number, seq: number): SyncOp {
  return {
    type: 'op',
    op_id: `0190f6a2-0000-7000-8000-${String(8000 + seq).padStart(12, '0')}`,
    stream: `session:${SESSION_ID}`,
    kind: 'slide.change',
    at: STARTED + tMs,
    clock_uncertain: false,
    seq,
    origin: 'ipad',
    data: {
      event_id: `0190f6a2-0000-7000-8000-${String(9000 + seq).padStart(12, '0')}`,
      session_id: SESSION_ID,
      slide_id: null,
      slide_index: index,
      t_ms: tMs,
      device: 'ipad',
    },
  } as SyncOp;
}

type Props = Partial<React.ComponentProps<typeof SlidesPanel>>;
const queryClient = { current: makeQueryClient() };

function panel(sync: ReturnType<typeof fakeClient>, props: Props = {}) {
  return (
    <QueryClientProvider client={queryClient.current}>
      <SlidesPanel
        sessionId={SESSION_ID}
        moduleId={MODULE.id}
        slideDeckId={DECK_ID}
        active
        startedAt={STARTED}
        client={sync.client}
        {...props}
      />
    </QueryClientProvider>
  );
}

async function open(sync = fakeClient(), props: Props = {}) {
  const view = render(panel(sync, props));
  await screen.findByTestId('slide-counter');
  return { sync, ...view, rerenderWith: (p: Props) => view.rerender(panel(sync, p)) };
}

const counter = () => screen.getByTestId('slide-counter');
const showing = (text: string) => waitFor(() => expect(counter()).toHaveTextContent(text));
const events = (sync: ReturnType<typeof fakeClient>) =>
  sync.sent.map((s) => (s as { data: Record<string, unknown> }).data);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(STARTED + 60_000);
  queryClient.current = makeQueryClient();
  core = installFakeCore({
    modules: [MODULE],
    sessions: [makeSession({ id: SESSION_ID, slide_deck_id: DECK_ID })],
  });
  core.decks = [makeDeck({ id: DECK_ID, module_id: MODULE.id, ingest_state: 'verarbeitet', page_count: 20 })];
  core.slides[DECK_ID] = makeSlides(DECK_ID, 20);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('SlidesPanel: Anzeige', () => {
  it('zeigt ohne Foliensatz den ruhigen Hinweis', () => {
    const sync = fakeClient();
    render(panel(sync, { slideDeckId: null }));
    expect(screen.getByTestId('slides-panel')).toHaveTextContent(
      'Folien kommen später – einfach mitschreiben',
    );
    expect(sync.subscribe).not.toHaveBeenCalled();
  });

  it('zeigt Folie 1, Seitenleiste mit allen Folien und Zähler', async () => {
    await open();
    await showing('Folie 1 / 20');
    expect(screen.getByRole('img', { name: 'Folie 1' })).toHaveAttribute(
      'src',
      expect.stringContaining('/slides/0190f6a2-0000-7000-8000-000000005000/image'),
    );
    expect(screen.getAllByRole('button', { name: /^Folie \d+$/ })).toHaveLength(20);
    expect(screen.getByRole('button', { name: 'Folie 1' })).toHaveAttribute('aria-current', 'true');
  });

  it('übernimmt die Folie aus dem letzten slide_event und abonniert ab der Snapshot-Position', async () => {
    core.slideEvents = [slideEvent(4, 1000), slideEvent(7, 5000), slideEvent(5, 3000)];
    core.streamSeq = 3;
    core.streamOpId = '0190f6a2-0000-7000-8000-000000000bbb';
    const { sync } = await open();
    await waitFor(() => expect(counter()).toHaveTextContent('Folie 7 / 20'));
    expect(sync.subscribe).toHaveBeenCalledWith(
      `session:${SESSION_ID}`,
      { lastSeq: 3, lastOpId: '0190f6a2-0000-7000-8000-000000000bbb' },
      expect.any(Function),
      expect.any(Object),
    );
  });

  it('meldet einen Foliensatz, der noch verarbeitet wird', async () => {
    core.decks = [makeDeck({ id: DECK_ID, module_id: MODULE.id, ingest_state: 'fehler' })];
    render(panel(fakeClient()));
    expect(await screen.findByText('Der Foliensatz konnte nicht eingelesen werden.')).toBeVisible();
  });
});

describe('SlidesPanel: Blättern und slide.change', () => {
  it('Rücksprung 12 → 9 → 12 erzeugt drei Ereignisse mit Sitzungszeit', async () => {
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    const { sync } = await open();
    await user.click(screen.getByRole('button', { name: 'Folie 12' }));
    vi.setSystemTime(STARTED + 75_500);
    await user.click(screen.getByRole('button', { name: 'Folie 9' }));
    vi.setSystemTime(STARTED + 90_250);
    await user.click(screen.getByRole('button', { name: 'Folie 12' }));

    await showing('Folie 12 / 20');
    const sentOps = sync.sent as { stream: string; kind: string }[];
    expect(sentOps).toHaveLength(3);
    expect(sentOps.every((s) => s.kind === 'slide.change' && s.stream === `session:${SESSION_ID}`)).toBe(
      true,
    );
    const data = events(sync);
    expect(data.map((d) => d.slide_index)).toEqual([12, 9, 12]);
    expect(data.map((d) => d.t_ms)).toEqual([60_000, 75_500, 90_250]);
    expect(data.map((d) => d.slide_id)).toEqual([
      '0190f6a2-0000-7000-8000-000000005011',
      '0190f6a2-0000-7000-8000-000000005008',
      '0190f6a2-0000-7000-8000-000000005011',
    ]);
    expect(data.every((d) => d.session_id === SESSION_ID && d.device === 'mac')).toBe(true);
    expect(new Set(data.map((d) => d.event_id)).size).toBe(3);
  });

  it('blättert mit →, ← und Leertaste und bleibt an den Enden stehen', async () => {
    const { sync } = await open();
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(sync.send).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    fireEvent.keyDown(document.body, { key: ' ' });
    await showing('Folie 3 / 20');
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    await showing('Folie 2 / 20');
    expect(events(sync).map((d) => d.slide_index)).toEqual([2, 3, 2]);
    // Ende
    await act(async () => {
      for (let i = 0; i < 25; i++) fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    });
    await showing('Folie 20 / 20');
    expect(sync.send).toHaveBeenCalledTimes(3 + 18);
  });

  it('ignoriert Tasten, die einem anderen gehören', async () => {
    const { sync } = await open();
    const input = document.createElement('input');
    const separator = document.createElement('div');
    separator.setAttribute('role', 'separator');
    separator.tabIndex = 0;
    const tab = document.createElement('div');
    tab.setAttribute('role', 'tab');
    const button = document.createElement('button');
    document.body.append(input, separator, tab, button);

    fireEvent.keyDown(input, { key: 'ArrowRight' });
    fireEvent.keyDown(input, { key: ' ' });
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    fireEvent.keyDown(tab, { key: 'ArrowRight' });
    fireEvent.keyDown(button, { key: ' ' });
    fireEvent.keyDown(document.body, { key: 'ArrowRight', metaKey: true });
    fireEvent.keyDown(document.body, { key: 'ArrowRight', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'ArrowRight', repeat: true });
    await showing('Folie 1 / 20');

    // defaultPrevented
    const prevent = (e: Event) => e.preventDefault();
    document.body.addEventListener('keydown', prevent, { once: true });
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    await showing('Folie 1 / 20');
    expect(sync.send).not.toHaveBeenCalled();
    // Pfeil auf einer Schaltfläche blättert dagegen
    fireEvent.keyDown(button, { key: 'ArrowRight' });
    await showing('Folie 2 / 20');
    for (const el of [input, separator, tab, button]) el.remove();
  });

  it('slideStep: ordnet Tasten zu', () => {
    const e = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init);
    expect(slideStep(e({ key: 'ArrowLeft' }))).toBe(-1);
    expect(slideStep(e({ key: 'ArrowRight' }))).toBe(1);
    expect(slideStep(e({ key: ' ' }))).toBe(1);
    expect(slideStep(e({ key: 'ArrowRight', shiftKey: true }))).toBeNull();
    expect(slideStep(e({ key: 'a' }))).toBeNull();
  });

  it('sendet ohne started_at nichts, blättert aber die Anzeige', async () => {
    const { sync } = await open(fakeClient(), { startedAt: null });
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    await showing('Folie 2 / 20');
    expect(sync.send).not.toHaveBeenCalled();
    expect(await screen.findByRole('status')).toHaveTextContent('Wechsel nicht aufgezeichnet');
  });

  it('blättert nicht, solange die Session nicht läuft', async () => {
    const { sync } = await open(fakeClient(), { active: false });
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    await showing('Folie 1 / 20');
    expect(screen.getByRole('button', { name: 'Folie 5' })).toBeDisabled();
    expect(sync.send).not.toHaveBeenCalled();
  });

  it('meldet, wenn das Senden scheitert, und lässt die Anzeige stehen', async () => {
    const sync = fakeClient();
    sync.send.mockRejectedValueOnce(new Error('kein Leader'));
    await open(sync);
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    await showing('Folie 2 / 20');
    expect(await screen.findByText('Wechsel nicht aufgezeichnet')).toBeVisible();
  });
});

describe('SlidesPanel: fremde Wechsel und Cache', () => {
  it('übernimmt Wechsel vom iPad aus dem Strom', async () => {
    const { sync } = await open();
    await sync.deliver(remoteChange(14, 120_000, 5));
    await showing('Folie 14 / 20');
    await sync.deliver(remoteChange(2, 130_000, 6));
    await showing('Folie 2 / 20');
    // Der eigene Wechsel geht von der angezeigten Folie aus
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(events(sync).at(-1)?.slide_index).toBe(3);
  });

  it('behält den Stand beim Aus- und Wiedereinhängen (Query-Cache) ohne Flackern', async () => {
    const { sync, unmount } = await open();
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    await showing('Folie 3 / 20');
    unmount();
    expect(sync.unsubscribe).toHaveBeenCalled();
    // Der Core kennt den Wechsel noch nicht (noch nicht bestätigt): der lokale Stand bleibt
    const again = fakeClient();
    render(panel(again));
    expect(await screen.findByTestId('slide-counter')).toHaveTextContent('Folie 3 / 20');
    await waitFor(() => expect(again.subscribe).toHaveBeenCalled());
    await showing('Folie 3 / 20');
  });

  it('lässt sich beim Wiedereinhängen von einem neueren Stand des Cores korrigieren', async () => {
    const { unmount } = await open();
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    unmount();
    core.slideEvents = [slideEvent(9, 600_000)];
    render(panel(fakeClient()));
    await waitFor(() => expect(screen.getByTestId('slide-counter')).toHaveTextContent('Folie 9 / 20'));
  });

  it('lädt bei reset den Snapshot neu und meldet dessen Position', async () => {
    const sync = fakeClient();
    await open(sync);
    core.slideEvents = [slideEvent(6, 700_000)];
    core.streamSeq = 9;
    core.streamOpId = '0190f6a2-0000-7000-8000-000000000ccc';
    const opts = (sync.subscribe.mock.calls[0] as unknown[])[3] as { onReset: () => Promise<unknown> };
    await expect(opts.onReset()).resolves.toEqual({
      lastSeq: 9,
      lastOpId: '0190f6a2-0000-7000-8000-000000000ccc',
    });
    await waitFor(() => expect(counter()).toHaveTextContent('Folie 6 / 20'));
  });

  it('ein lokaler, noch unbestätigter Wechsel schlägt beim Wiedereinhängen einen älteren Snapshot', async () => {
    const { unmount } = await open();
    fireEvent.keyDown(document.body, { key: 'ArrowRight' }); // Folie 2, t_ms 60 000
    await showing('Folie 2 / 20');
    unmount();
    // Der Core kennt nur einen älteren Wechsel (t_ms 5 000), den eigenen noch nicht
    core.slideEvents = [slideEvent(9, 5_000)];
    const again = fakeClient();
    render(panel(again));
    // Abonniert wird erst, wenn der Snapshot übernommen ist
    await waitFor(() => expect(again.subscribe).toHaveBeenCalled());
    await showing('Folie 2 / 20');
  });

  it('scheitert das Laden bei reset, wird der Strom bei der nächsten Verbindung neu aufgebaut', async () => {
    const sync = fakeClient();
    await open(sync);
    expect(sync.subscribe).toHaveBeenCalledTimes(1);
    const opts = (sync.subscribe.mock.calls[0] as unknown[])[3] as { onReset: () => Promise<unknown> };
    core.down = true;
    await expect(opts.onReset()).rejects.toBeDefined();
    core.down = false;
    core.slideEvents = [slideEvent(8, 900_000)];
    await sync.emit('connection', { state: 'online', retryInMs: null, closeCode: null });
    await waitFor(() => expect(sync.subscribe).toHaveBeenCalledTimes(2));
    await showing('Folie 8 / 20');
    expect(sync.unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe('SlidesPanel: Uhrabgleich und Meldungen', () => {
  it('rechnet t_ms in synchronisierter Zeit (lokale Uhr + Versatz)', async () => {
    const sync = fakeClient();
    sync.raw.clockOffsetMs = 2_500;
    await open(sync);
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(events(sync)[0]?.t_ms).toBe(62_500);
  });

  it('meldet nichts, wenn ein anderer Tab die Operation übernimmt', async () => {
    const sync = fakeClient();
    sync.send.mockRejectedValueOnce(new SyncHandedOverError('x'));
    await open(sync);
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    await showing('Folie 2 / 20');
    await act(async () => undefined);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
