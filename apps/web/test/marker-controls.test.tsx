// Marker vom Mac (T1-17, F-DSH-05): Tasten F/K/L, Klick, Zähler, Hervorhebung, Rückgängig innerhalb von 10 s.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import type { Marker, SyncOp } from '@sg/shared';
import { MarkerControls, markerKeyAction } from '../src/components/dashboard/markers/MarkerControls.tsx';
import { makeQueryClient } from '../src/lib/query.tsx';
import { SyncNotLeaderError, type SyncClient } from '../src/lib/sync/client.ts';
import { installFakeCore, makeSession, type FakeCore } from './fake-core.ts';

const SESSION_ID = '0190f6a2-0000-7000-8000-0000000000e1';
const STARTED = Date.parse('2026-11-04T08:00:00Z');

let core: FakeCore;
const queryClient = { current: makeQueryClient() };

function fakeClient() {
  const sent: { stream: string; kind: string; data: Record<string, unknown> }[] = [];
  let onOp: ((op: SyncOp) => void) | null = null;
  const send = vi.fn(async (input: (typeof sent)[number]) => {
    sent.push(input);
    return { type: 'ack', op_id: 'x', seq: sent.length };
  });
  const subscribe = vi.fn(
    (_s: string, _p: { lastSeq: number; lastOpId: string | null }, cb: (op: SyncOp) => void) => {
      onOp = cb;
      return () => undefined;
    },
  );
  const client = { connectionState: 'online', send, subscribe, onEvent: vi.fn(() => () => undefined) };
  return {
    client: client as unknown as SyncClient,
    send,
    sent,
    subscribe,
    deliver: (op: SyncOp) => act(() => onOp?.(op)),
  };
}

function marker(id: number, kind: Marker['kind']): Marker {
  return {
    id: `0190f6a2-0000-7000-8000-${String(6000 + id).padStart(12, '0')}`,
    user_id: '0190f6a2-0000-7000-8000-000000000000',
    created_at: '2026-11-04T08:00:00Z',
    updated_at: '2026-11-04T08:00:00Z',
    deleted_at: null,
    session_id: SESSION_ID,
    kind,
    t_ms: 1000 * id,
    page_id: null,
    position: null,
    source: 'ipad',
    note: null,
    resolved_at: null,
  };
}

type Props = Partial<React.ComponentProps<typeof MarkerControls>>;
function controls(sync: ReturnType<typeof fakeClient>, props: Props = {}) {
  return (
    <QueryClientProvider client={queryClient.current}>
      <MarkerControls sessionId={SESSION_ID} active startedAt={STARTED} client={sync.client} {...props} />
    </QueryClientProvider>
  );
}
async function open(sync = fakeClient(), props: Props = {}) {
  const view = render(controls(sync, props));
  await waitFor(() => expect(sync.subscribe).toHaveBeenCalled());
  return { sync, ...view };
}

const count = (kind: string) => screen.getByTestId(`marker-count-${kind}`);
const counts = () => ['frage', 'klausur', 'verknuepfung'].map((k) => count(k).textContent);
const press = (init: KeyboardEventInit, target: Element = document.body) => fireEvent.keyDown(target, init);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(STARTED + 125_000);
  queryClient.current = makeQueryClient();
  core = installFakeCore({ sessions: [makeSession({ id: SESSION_ID })] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('MarkerControls: Tasten und Zähler', () => {
  it('zeigt drei Zähler mit 0', async () => {
    await open();
    expect(counts()).toEqual(['0', '0', '0']);
    expect(screen.getByRole('button', { name: /Frage markieren/ })).toHaveAttribute('aria-keyshortcuts', 'F');
  });

  it('F, K, L senden marker.add mit Art, Sitzungszeit und source mac und zählen hoch', async () => {
    const { sync } = await open();
    press({ key: 'f' });
    vi.setSystemTime(STARTED + 130_500);
    press({ key: 'k' });
    vi.setSystemTime(STARTED + 140_000);
    press({ key: 'l' });
    press({ key: 'F' });
    await waitFor(() => expect(counts()).toEqual(['2', '1', '1']));
    expect(sync.sent.map((s) => s.kind)).toEqual(['marker.add', 'marker.add', 'marker.add', 'marker.add']);
    expect(sync.sent.every((s) => s.stream === `session:${SESSION_ID}`)).toBe(true);
    expect(sync.sent.map((s) => s.data.kind)).toEqual(['frage', 'klausur', 'verknuepfung', 'frage']);
    expect(sync.sent.map((s) => s.data.t_ms)).toEqual([125_000, 130_500, 140_000, 140_000]);
    expect(
      sync.sent.every(
        (s) =>
          s.data.session_id === SESSION_ID &&
          s.data.source === 'mac' &&
          s.data.page_id === null &&
          s.data.position === null &&
          s.data.note === null,
      ),
    ).toBe(true);
    expect(new Set(sync.sent.map((s) => s.data.marker_id)).size).toBe(4);
  });

  it('Klick in der Statusleiste setzt den Marker', async () => {
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    const { sync } = await open();
    await user.click(screen.getByRole('button', { name: /Klausur markieren/ }));
    await waitFor(() => expect(counts()).toEqual(['0', '1', '0']));
    expect(sync.sent[0]?.data.kind).toBe('klausur');
  });

  it('hebt den Zähler 300 ms hervor', async () => {
    await open();
    press({ key: 'f' });
    const button = screen.getByRole('button', { name: /Frage markieren/ });
    await waitFor(() => expect(button).toHaveAttribute('data-flash', 'true'));
    await waitFor(() => expect(button).not.toHaveAttribute('data-flash'), { timeout: 1500 });
  });

  it('ignoriert Tasten in Eingabefeldern, mit Modifier, bei defaultPrevented und auf Trennlinien', async () => {
    const { sync } = await open();
    const input = document.createElement('input');
    const separator = document.createElement('div');
    separator.setAttribute('role', 'separator');
    const tab = document.createElement('div');
    tab.setAttribute('role', 'tab');
    document.body.append(input, separator, tab);
    press({ key: 'f' }, input);
    press({ key: 'f' }, separator);
    press({ key: 'k' }, tab);
    press({ key: 'k', metaKey: true });
    press({ key: 'l', ctrlKey: true });
    press({ key: 'f', repeat: true });
    press({ key: 'x' });
    document.body.addEventListener('keydown', (e) => e.preventDefault(), { once: true });
    press({ key: 'f' });
    expect(sync.send).not.toHaveBeenCalled();
    expect(counts()).toEqual(['0', '0', '0']);
    for (const el of [input, separator, tab]) el.remove();
  });

  it('setzt ohne laufende Session oder ohne started_at keine Marker', async () => {
    const inactive = await open(fakeClient(), { active: false });
    press({ key: 'f' });
    expect(inactive.sync.send).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Frage markieren/ })).toBeDisabled();
    cleanup();
    const notStarted = await open(fakeClient(), { startedAt: null });
    press({ key: 'f' });
    expect(notStarted.sync.send).not.toHaveBeenCalled();
  });

  it('nimmt den Marker zurück, wenn er nicht in die Warteschlange kam', async () => {
    const sync = fakeClient();
    sync.send.mockRejectedValueOnce(new SyncNotLeaderError());
    await open(sync);
    press({ key: 'f' });
    await waitFor(() => expect(counts()).toEqual(['0', '0', '0']));
    expect(await screen.findByRole('status')).toHaveTextContent('Nicht gesendet');
  });

  it('markerKeyAction: ordnet Tasten zu (Mac: ⌘Z, sonst Strg+Z)', () => {
    const e = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init);
    expect(markerKeyAction(e({ key: 'f' }), true)).toBe('frage');
    expect(markerKeyAction(e({ key: 'K' }), true)).toBe('klausur');
    expect(markerKeyAction(e({ key: 'l' }), true)).toBe('verknuepfung');
    expect(markerKeyAction(e({ key: 'z', metaKey: true }), true)).toBe('undo');
    expect(markerKeyAction(e({ key: 'z', ctrlKey: true }), true)).toBeNull();
    expect(markerKeyAction(e({ key: 'z', ctrlKey: true }), false)).toBe('undo');
    expect(markerKeyAction(e({ key: 'z', metaKey: true }), false)).toBeNull();
    expect(markerKeyAction(e({ key: 'z', metaKey: true, shiftKey: true }), true)).toBeNull();
    expect(markerKeyAction(e({ key: 'z' }), true)).toBeNull();
  });
});

describe('MarkerControls: Rückgängig', () => {
  it('nimmt den letzten Marker innerhalb von 10 s mit marker.remove zurück', async () => {
    const { sync } = await open();
    press({ key: 'f' });
    vi.setSystemTime(STARTED + 125_000 + 1000);
    press({ key: 'k' });
    await waitFor(() => expect(counts()).toEqual(['1', '1', '0']));
    vi.setSystemTime(STARTED + 125_000 + 9_900);
    press({ key: 'z', ctrlKey: true });
    await waitFor(() => expect(counts()).toEqual(['1', '0', '0']));
    const last = sync.sent.at(-1);
    expect(last?.kind).toBe('marker.remove');
    expect(last?.data).toEqual({ marker_id: sync.sent[1]?.data.marker_id });
    // Der zweite Zug nimmt den ersten Marker zurück, solange er innerhalb von 10 s liegt
    press({ key: 'z', ctrlKey: true });
    await waitFor(() => expect(counts()).toEqual(['0', '0', '0']));
    expect(sync.sent.at(-1)?.data).toEqual({ marker_id: sync.sent[0]?.data.marker_id });
    // Nichts mehr da: kein weiteres Senden
    const before = sync.send.mock.calls.length;
    press({ key: 'z', ctrlKey: true });
    expect(sync.send.mock.calls.length).toBe(before);
  });

  it('nimmt nach 10 s nichts mehr zurück und lässt Strg+Z unberührt', async () => {
    const { sync } = await open();
    press({ key: 'f' });
    await waitFor(() => expect(counts()).toEqual(['1', '0', '0']));
    vi.setSystemTime(STARTED + 125_000 + 10_001);
    const notPrevented = fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(notPrevented).toBe(true);
    expect(counts()).toEqual(['1', '0', '0']);
    expect(sync.sent.map((s) => s.kind)).toEqual(['marker.add']);
  });

  it('⌘Z am Mac, nicht Strg+Z', async () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    const { sync } = await open();
    press({ key: 'f' });
    await waitFor(() => expect(counts()).toEqual(['1', '0', '0']));
    press({ key: 'z', ctrlKey: true });
    expect(counts()).toEqual(['1', '0', '0']);
    press({ key: 'z', metaKey: true });
    await waitFor(() => expect(counts()).toEqual(['0', '0', '0']));
    expect(sync.sent.at(-1)?.kind).toBe('marker.remove');
  });

  it('lässt ⌘Z/Strg+Z in Eingabefeldern dem Feld', async () => {
    const { sync } = await open();
    press({ key: 'f' });
    const input = document.createElement('input');
    document.body.append(input);
    press({ key: 'z', ctrlKey: true }, input);
    expect(sync.sent.map((s) => s.kind)).toEqual(['marker.add']);
    input.remove();
  });
});

describe('MarkerControls: Snapshot, Strom und Cache', () => {
  it('zählt Marker aus dem Snapshot (ohne gelöschte) und abonniert ab dessen Position', async () => {
    core.markers = [
      marker(1, 'frage'),
      marker(2, 'frage'),
      marker(3, 'klausur'),
      { ...marker(4, 'frage'), deleted_at: 'x' },
    ];
    core.streamSeq = 4;
    core.streamOpId = '0190f6a2-0000-7000-8000-000000000bbb';
    const { sync } = await open();
    await waitFor(() => expect(counts()).toEqual(['2', '1', '0']));
    expect(sync.subscribe).toHaveBeenCalledWith(
      `session:${SESSION_ID}`,
      { lastSeq: 4, lastOpId: '0190f6a2-0000-7000-8000-000000000bbb' },
      expect.any(Function),
      expect.any(Object),
    );
  });

  it('übernimmt Marker und Entfernen vom iPad aus dem Strom', async () => {
    core.markers = [marker(1, 'frage')];
    const { sync } = await open();
    await waitFor(() => expect(counts()).toEqual(['1', '0', '0']));
    const m = marker(2, 'verknuepfung');
    await sync.deliver({
      type: 'op',
      op_id: '0190f6a2-0000-7000-8000-000000008001',
      stream: `session:${SESSION_ID}`,
      kind: 'marker.add',
      at: STARTED,
      clock_uncertain: false,
      seq: 5,
      origin: 'ipad',
      data: {
        marker_id: m.id,
        session_id: SESSION_ID,
        kind: 'verknuepfung',
        t_ms: 5000,
        page_id: null,
        position: null,
        note: null,
        source: 'ipad',
      },
    } as SyncOp);
    await waitFor(() => expect(counts()).toEqual(['1', '0', '1']));
    await sync.deliver({
      type: 'op',
      op_id: '0190f6a2-0000-7000-8000-000000008002',
      stream: `session:${SESSION_ID}`,
      kind: 'marker.remove',
      at: STARTED,
      clock_uncertain: false,
      seq: 6,
      origin: 'ipad',
      data: { marker_id: m.id },
    } as SyncOp);
    await waitFor(() => expect(counts()).toEqual(['1', '0', '0']));
  });

  it('behält Zähler und Rückgängig-Liste beim Aus- und Wiedereinhängen', async () => {
    const first = await open();
    press({ key: 'f' });
    press({ key: 'l' });
    await waitFor(() => expect(counts()).toEqual(['1', '0', '1']));
    first.unmount();
    // Der Core kennt die Marker noch nicht (nicht bestätigt): sie bleiben gezählt
    const second = await open();
    expect(counts()).toEqual(['1', '0', '1']);
    await waitFor(() => expect(core.requests.filter((r) => r.path.endsWith('/snapshot'))).toHaveLength(2));
    expect(counts()).toEqual(['1', '0', '1']);
    // und lassen sich noch zurücknehmen
    press({ key: 'z', ctrlKey: true });
    await waitFor(() => expect(counts()).toEqual(['1', '0', '0']));
    expect(second.sync.sent.at(-1)?.kind).toBe('marker.remove');
  });

  it('belebt einen zurückgenommenen Marker nicht durch einen älteren Snapshot wieder', async () => {
    const first = await open();
    press({ key: 'f' });
    await waitFor(() => expect(counts()).toEqual(['1', '0', '0']));
    const id = first.sync.sent[0]?.data.marker_id as string;
    press({ key: 'z', ctrlKey: true });
    await waitFor(() => expect(counts()).toEqual(['0', '0', '0']));
    first.unmount();
    // Der Core hat zwar das marker.add, aber noch nicht das marker.remove
    core.markers = [{ ...marker(1, 'frage'), id }];
    await open();
    await waitFor(() => expect(core.requests.filter((r) => r.path.endsWith('/snapshot'))).toHaveLength(2));
    expect(counts()).toEqual(['0', '0', '0']);
  });
});
