// Zusammenspiel Folie (T1-05) und Marker (T1-17): Ein Klick auf einen Marker nimmt der Leertaste nicht die Folie weg.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { MarkerControls } from '../src/components/dashboard/markers/MarkerControls.tsx';
import { SlidesPanel } from '../src/components/dashboard/slides/SlidesPanel.tsx';
import { makeQueryClient } from '../src/lib/query.tsx';
import type { SyncClient } from '../src/lib/sync/client.ts';
import { installFakeCore, makeDeck, makeModule, makeSession, makeSlides } from './fake-core.ts';

const SESSION_ID = '0190f6a2-0000-7000-8000-0000000000e1';
const DECK_ID = '0190f6a2-0000-7000-8000-0000000000d1';
const MODULE = makeModule({ id: '0190f6a2-0000-7000-8000-0000000000a3' });
const STARTED = Date.parse('2026-11-04T08:00:00Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(STARTED + 60_000);
  const core = installFakeCore({
    modules: [MODULE],
    sessions: [makeSession({ id: SESSION_ID, slide_deck_id: DECK_ID })],
  });
  core.decks = [makeDeck({ id: DECK_ID, module_id: MODULE.id, ingest_state: 'verarbeitet', page_count: 5 })];
  core.slides[DECK_ID] = makeSlides(DECK_ID, 5);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Folie und Marker: Fokus', () => {
  it('Klick auf Marker, dann Leertaste: die Folie wechselt, es entsteht kein zweiter Marker', async () => {
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    const sent: { kind: string }[] = [];
    const client = {
      connectionState: 'online',
      clockOffsetMs: null,
      send: vi.fn(async (op: { kind: string }) => {
        sent.push(op);
        return { type: 'ack', op_id: 'x', seq: sent.length };
      }),
      subscribe: vi.fn(() => () => undefined),
      onEvent: vi.fn(() => () => undefined),
    } as unknown as SyncClient;
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <SlidesPanel
          sessionId={SESSION_ID}
          moduleId={MODULE.id}
          slideDeckId={DECK_ID}
          active
          startedAt={STARTED}
          client={client}
        />
        <MarkerControls sessionId={SESSION_ID} active startedAt={STARTED} client={client} />
      </QueryClientProvider>,
    );
    await screen.findByTestId('slide-counter');
    await user.click(screen.getByRole('button', { name: /Frage markieren/ }));
    await waitFor(() => expect(screen.getByTestId('marker-count-frage')).toHaveTextContent('1'));
    // Der Fokus bleibt nicht an der Schaltfläche hängen
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: /Frage markieren/ }));
    await user.keyboard(' ');
    await waitFor(() => expect(screen.getByTestId('slide-counter')).toHaveTextContent('Folie 2 / 5'));
    expect(screen.getByTestId('marker-count-frage')).toHaveTextContent('1');
    expect(sent.map((s) => s.kind)).toEqual(['marker.add', 'slide.change']);
  });
});
