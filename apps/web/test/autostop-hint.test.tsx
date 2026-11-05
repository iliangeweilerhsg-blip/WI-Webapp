// Auto-Stopp (T1-07): Hinweis-Komponente und Hook
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AutoStopHint, formatRemaining } from '../src/components/autostop/index.ts';
import { useAutoStop } from '../src/lib/autostop/index.ts';
import { makeSession, makeSettings } from './fake-core.ts';

const hinweis = { state: 'hinweis', remainingMs: 42_000, rule: 4, stopReason: 'maximaldauer' } as const;

afterEach(() => {
  vi.useRealTimers();
});

describe('AutoStopHint', () => {
  it('zeigt „Stoppt gleich 0:42“ und den Knopf „weiter aufnehmen“, kein Dialog', () => {
    render(<AutoStopHint status={hinweis} extendMinutes={15} onExtend={() => undefined} />);
    expect(screen.getByRole('status')).toHaveTextContent('Stoppt gleich 0:42');
    expect(
      screen.getByRole('button', { name: 'Weiter aufnehmen, Aufnahme um 15 Minuten verlängern' }),
    ).toHaveTextContent('weiter aufnehmen');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('der Knopf ruft onExtend auf und sperrt sich, solange extend läuft', async () => {
    const onExtend = vi.fn();
    const { rerender } = render(<AutoStopHint status={hinweis} extendMinutes={15} onExtend={onExtend} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onExtend).toHaveBeenCalledTimes(1);
    rerender(<AutoStopHint status={hinweis} extendMinutes={15} onExtend={onExtend} extending />);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('role=status bleibt eingehängt; die Sekunden sind aria-hidden, der Screenreader-Satz ist fest', () => {
    const { rerender } = render(
      <AutoStopHint status={{ state: 'ok' }} extendMinutes={15} onExtend={() => undefined} />,
    );
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<AutoStopHint status={hinweis} extendMinutes={15} onExtend={() => undefined} />);
    const status = screen.getByRole('status');
    expect(status.querySelector('[aria-hidden="true"]')).toHaveTextContent('Stoppt gleich 0:42');
    expect(status.querySelector('.sr-only')).toHaveTextContent('Aufnahme stoppt gleich.');
    rerender(
      <AutoStopHint
        status={{ ...hinweis, remainingMs: 41_000 }}
        extendMinutes={15}
        onExtend={() => undefined}
      />,
    );
    expect(screen.getByRole('status').querySelector('.sr-only')).toHaveTextContent('Aufnahme stoppt gleich.');
    expect(document.querySelector('[aria-live]')).toBeNull();
  });

  it('verschwindet, sobald der Zustand wieder ok oder inaktiv ist', () => {
    const { rerender } = render(
      <AutoStopHint status={hinweis} extendMinutes={15} onExtend={() => undefined} />,
    );
    expect(screen.getByRole('button')).toBeInTheDocument();
    rerender(<AutoStopHint status={{ state: 'ok' }} extendMinutes={15} onExtend={() => undefined} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(/Stoppt gleich/)).toBeNull();
    rerender(<AutoStopHint status={{ state: 'inaktiv' }} extendMinutes={15} onExtend={() => undefined} />);
    expect(screen.queryByText(/Stoppt gleich/)).toBeNull();
  });

  it('zeigt die Meldung eines gescheiterten extend', () => {
    render(
      <AutoStopHint
        status={hinweis}
        extendMinutes={15}
        onExtend={() => undefined}
        error="Core nicht erreichbar"
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Core nicht erreichbar');
  });

  it('formatRemaining rundet auf ganze Sekunden', () => {
    expect(formatRemaining(42_000)).toBe('0:42');
    expect(formatRemaining(41_001)).toBe('0:42');
    expect(formatRemaining(125_000)).toBe('2:05');
    expect(formatRemaining(0)).toBe('0:00');
    expect(formatRemaining(-5)).toBe('0:00');
  });
});

describe('AutoStopHint Fokus', () => {
  it('nach dem Tippen auf „weiter aufnehmen“ fällt der Fokus nicht auf body', async () => {
    const { rerender } = render(
      <AutoStopHint status={hinweis} extendMinutes={15} onExtend={() => undefined} />,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button')).toHaveFocus();
    // der Hinweis verschwindet, der Knopf wird entfernt (Fokus wäre auf body gefallen)
    act(() => (document.activeElement as HTMLElement).blur());
    rerender(<AutoStopHint status={{ state: 'ok' }} extendMinutes={15} onExtend={() => undefined} />);
    expect(screen.getByRole('status')).toHaveFocus();
  });
});

describe('useAutoStop', () => {
  it('meldet sich bei einer erst nach dem Mount gelieferten Ereignisquelle an', () => {
    const lecture = makeSettings().lecture;
    const session = makeSession({ updated_at: new Date().toISOString() });
    let handler: ((s: typeof session) => void) | null = null;
    const events = {
      onEvent: (_n: 'session.updated', fn: (s: typeof session) => void) => {
        handler = fn;
        return () => {
          handler = null;
        };
      },
    };
    const { result, rerender } = renderHook(
      ({ ev }: { ev: typeof events | undefined }) => useAutoStop({ session, lecture, events: ev }),
      { initialProps: { ev: undefined as typeof events | undefined } },
    );
    expect(handler).toBeNull();
    rerender({ ev: events });
    expect(handler).not.toBeNull();
    act(() =>
      handler!({ ...session, state: 'beendet', updated_at: new Date(Date.now() + 1000).toISOString() }),
    );
    expect(result.current.status.state).toBe('inaktiv');
  });

  it('liefert hinweis und extend, StrictMode-fest', async () => {
    vi.useFakeTimers();
    const T0 = Date.parse('2026-11-05T08:00:00Z');
    vi.setSystemTime(T0);
    const lecture = makeSettings().lecture;
    const session = makeSession({
      started_at: new Date(T0 - 240 * 60_000 + 30_000).toISOString(),
      updated_at: new Date(T0).toISOString(),
    });
    const extend = vi.fn(async () => ({
      ...session,
      auto_stop_extended_until: new Date(Date.now() + 15 * 60_000).toISOString(),
      updated_at: new Date(Date.now()).toISOString(),
    }));
    const stop = vi.fn();
    const { result } = renderHook(() => useAutoStop({ session, lecture, api: { stop, extend } }), {
      wrapper: StrictMode,
    });
    expect(result.current.status.state).toBe('hinweis');
    await act(async () => {
      await result.current.extend();
    });
    expect(extend).toHaveBeenCalledWith(session.id);
    expect(result.current.status.state).toBe('ok');
    expect(stop).not.toHaveBeenCalled();
  });

  it('ohne geladene Einstellungen bleibt er inaktiv', () => {
    const { result } = renderHook(() => useAutoStop({ session: makeSession(), lecture: undefined }));
    expect(result.current.status.state).toBe('inaktiv');
  });
});
