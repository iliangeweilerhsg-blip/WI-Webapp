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

  it('Löschen, während „Schon vorhanden · Anzeigen“ sichtbar ist: „Rückgängig“ sofort sichtbar und fokussiert', async () => {
    setup();
    await show({ message: 'Schon vorhanden', actionLabel: 'Anzeigen', onAction: vi.fn() });
    expect(screen.getByText('Schon vorhanden')).toBeInTheDocument();
    await show(undo({ focusAction: true }));
    expect(screen.getByRole('button', { name: 'Rückgängig' })).toHaveFocus();
    expect(screen.queryByText('Schon vorhanden')).not.toBeInTheDocument();
    // Der verdrängte Toast mit Aktion kommt danach wieder, eine bloße Meldung wäre verfallen
    await advance(10_100);
    expect(screen.getByText('Schon vorhanden')).toBeInTheDocument();
  });

  it('eine bloße Meldung, die von „Rückgängig“ verdrängt wird, verfällt', async () => {
    setup();
    await show({ message: 'Irgendwas' });
    await show(undo());
    await advance(10_100);
    expect(screen.queryByText('Irgendwas')).not.toBeInTheDocument();
  });

  it('zwei Löschungen verschiedener Gruppen: ein Toast, beide gleichzeitig rückgängig machbar, kein Warten', async () => {
    setup();
    const first = vi.fn();
    const second = vi.fn();
    const undoFirst = vi.fn();
    const undoSecond = vi.fn();
    await show(undo({ onExpire: first, onAction: undoFirst, focusAction: true }));
    await advance(3_000);
    await show(
      undo({
        message: 'Foliensatz gelöscht',
        group: 'material-delete',
        onExpire: second,
        onAction: undoSecond,
        focusAction: true,
      }),
    );
    expect(screen.getByText('Modul gelöscht · Foliensatz gelöscht')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rückgängig' })).toHaveFocus();
    expect(first).not.toHaveBeenCalled();
    await act(async () => screen.getByRole('button', { name: 'Rückgängig' }).click());
    expect(undoFirst).toHaveBeenCalledTimes(1);
    expect(undoSecond).toHaveBeenCalledTimes(1);
    await advance(11_000);
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });

  it('zusammengefasste Löschungen laufen gemeinsam nach 10 s ab', async () => {
    setup();
    const first = vi.fn();
    const second = vi.fn();
    await show(undo({ onExpire: first }));
    await show(undo({ message: 'Foliensatz gelöscht', group: 'material-delete', onExpire: second }));
    await advance(9_000);
    expect(first).not.toHaveBeenCalled();
    await advance(1_200);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
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
    expect(screen.queryByText('Meldung 1')).not.toBeInTheDocument();
    expect(screen.queryByText('Meldung 2')).not.toBeInTheDocument();
    expect(screen.getByText('Meldung 3')).toBeInTheDocument();
    await advance(5_100);
    expect(screen.getByText('Meldung 4')).toBeInTheDocument();
    await advance(5_100);
    expect(screen.getByText('Meldung 5')).toBeInTheDocument();
  });

  it('eine bloße Meldung wird von einer neuen ersetzt, solange nichts wartet', async () => {
    setup();
    await show({ message: 'Eins' });
    await show({ message: 'Zwei' });
    expect(screen.queryByText('Eins')).not.toBeInTheDocument();
    expect(screen.getByText('Zwei')).toBeInTheDocument();
  });
});
