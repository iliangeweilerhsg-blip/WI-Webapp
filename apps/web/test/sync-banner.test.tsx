import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OtherTabBanner, type OtherTabSource } from '../src/lib/sync/OtherTabBanner.tsx';
import type { ClientEventMap, ConnectionState } from '../src/lib/sync/types.ts';

function source(initial: ConnectionState) {
  const handlers = new Set<(c: ClientEventMap['connection']) => void>();
  const takeOver = vi.fn();
  const src = {
    connectionState: initial,
    takeOver,
    onEvent: ((name: string, fn: (c: ClientEventMap['connection']) => void) => {
      if (name === 'connection') handlers.add(fn);
      return () => handlers.delete(fn);
    }) as OtherTabSource['onEvent'],
  } satisfies OtherTabSource;
  return {
    src,
    takeOver,
    emit: (state: ConnectionState) => handlers.forEach((h) => h({ state, retryInMs: null, closeCode: null })),
  };
}

describe('OtherTabBanner', () => {
  it('zeigt nichts, solange dieser Tab synchronisiert', () => {
    const { src } = source('online');
    const { container } = render(<OtherTabBanner client={src} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('zeigt Hinweis und übernimmt per Knopf; verschwindet wieder', async () => {
    const { src, takeOver, emit } = source('other_tab');
    render(<OtherTabBanner client={src} />);
    expect(screen.getByText('Studien-Gehirn ist in einem anderen Tab aktiv.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Hier übernehmen' }));
    expect(takeOver).toHaveBeenCalledOnce();
    act(() => emit('online'));
    expect(screen.queryByRole('button', { name: 'Hier übernehmen' })).toBeNull();
  });
});
