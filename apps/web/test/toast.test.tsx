// Toast-Warteschlange (Folgepunkt 1): „Rückgängig“ wird durch nichts vorzeitig beendet
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MAX_WAITING_TOASTS, ToastProvider, useToast, type ToastOptions } from '../src/lib/toast.tsx';

let api: ReturnType<typeof useToast>;
function Grab() {
  api = useToast();
  return null;
}

function setup() {
  vi.useFakeTimers();
  render(
    <ToastProvider>
      <Grab />
    </ToastProvider>,
  );
}

const show = (options: ToastOptions) => act(() => api.show(options));
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const undo = (extra: Partial<ToastOptions> = {}): ToastOptions => ({
  message: 'Modul gelöscht',
  actionLabel: 'Rückgängig',
  group: 'module-delete',
  durationMs: 10_000,
  onExpire: vi.fn(),
  ...extra,
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Toast-Warteschlange', () => {
  it('eine Dublette mit Aktion verdrängt „Rückgängig“ nicht und wartet, bis es abläuft', async () => {
    setup();
    const onExpire = vi.fn();
    await show(undo({ onExpire }));
    await show({ message: 'Schon vorhanden', actionLabel: 'Anzeigen', onAction: vi.fn() });
    expect(screen.getByText('Modul gelöscht')).toBeInTheDocument();
    expect(screen.queryByText('Schon vorhanden')).not.toBeInTheDocument();
    expect(onExpire).not.toHaveBeenCalled();

    await advance(10_100);
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Schon vorhanden')).toBeInTheDocument();
    await advance(5_100);
    expect(screen.queryByText('Schon vorhanden')).not.toBeInTheDocument();
  });

  it('ein zweiter „Rückgängig“-Toast einer anderen Gruppe beendet den ersten nicht', async () => {
    setup();
    const first = vi.fn();
    const second = vi.fn();
    await show(undo({ onExpire: first }));
    await show(undo({ message: 'Foliensatz gelöscht', group: 'material-delete', onExpire: second }));
    expect(screen.getByText('Modul gelöscht')).toBeInTheDocument();
    expect(first).not.toHaveBeenCalled();
    await advance(10_100);
    expect(first).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Foliensatz gelöscht')).toBeInTheDocument();
    expect(second).not.toHaveBeenCalled();
  });

  it('derselben Gruppe führt der neue Toast den sichtbaren fort (ohne Ablauf)', async () => {
    setup();
    const onExpire = vi.fn();
    await show(undo({ onExpire }));
    await advance(6_000);
    await show(undo({ message: '2 Module gelöscht', onExpire }));
    expect(screen.getByText('2 Module gelöscht')).toBeInTheDocument();
    expect(onExpire).not.toHaveBeenCalled();
    await advance(6_000);
    expect(onExpire).not.toHaveBeenCalled();
    await advance(4_100);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('mehrere Meldungen warten der Reihe nach, die ältesten bloßen verfallen über der Obergrenze', async () => {
    setup();
    await show(undo());
    for (let i = 1; i <= MAX_WAITING_TOASTS + 2; i += 1) await show({ message: `Meldung ${i}` });
    await advance(10_100);
    // Meldung 1 und 2 sind verfallen, 3 bis 5 warten
    expect(screen.queryByText('Meldung 1')).not.toBeInTheDocument();
    expect(screen.queryByText('Meldung 2')).not.toBeInTheDocument();
    expect(screen.getByText('Meldung 3')).toBeInTheDocument();
    await advance(5_100);
    expect(screen.getByText('Meldung 4')).toBeInTheDocument();
    await advance(5_100);
    expect(screen.getByText('Meldung 5')).toBeInTheDocument();
  });

  it('wartende „Rückgängig“-Toasts verfallen nie, auch über der Obergrenze', async () => {
    setup();
    const expired = vi.fn();
    await show(undo({ group: 'a' }));
    for (const group of ['b', 'c', 'd', 'e', 'f']) {
      await show(undo({ group, message: `Gelöscht ${group}`, onExpire: expired }));
    }
    for (let i = 0; i < 6; i += 1) await advance(10_100);
    expect(expired).toHaveBeenCalledTimes(5);
  });

  it('eine bloße Meldung wird von einer neuen ersetzt, solange nichts wartet', async () => {
    setup();
    await show({ message: 'Eins' });
    await show({ message: 'Zwei' });
    expect(screen.queryByText('Eins')).not.toBeInTheDocument();
    expect(screen.getByText('Zwei')).toBeInTheDocument();
  });
});
