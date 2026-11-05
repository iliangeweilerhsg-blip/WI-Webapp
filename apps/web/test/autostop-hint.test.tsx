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
  it('zeigt „Aufnahme endet in 0:42“ und den Knopf „Verlängern“, kein Dialog', () => {
    render(<AutoStopHint status={hinweis} extendMinutes={15} onExtend={() => undefined} />);
    expect(screen.getByText('Aufnahme endet in 0:42')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aufnahme um 15 Minuten verlängern' })).toHaveTextContent(
      'Verlängern',
    );
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
    expect(status.querySelector('[aria-hidden="true"]')).toHaveTextContent('Aufnahme endet in 0:42');
    expect(status.querySelector('.sr-only')).toHaveTextContent('Aufnahme endet gleich.');
    rerender(
      <AutoStopHint
        status={{ ...hinweis, remainingMs: 41_000 }}
        extendMinutes={15}
        onExtend={() => undefined}
      />,
    );
    expect(screen.getByRole('status').querySelector('.sr-only')).toHaveTextContent('Aufnahme endet gleich.');
    expect(document.querySelector('[aria-live]')).toBeNull();
  });

  it('verschwindet, sobald der Zustand wieder ok oder inaktiv ist', () => {
    const { rerender } = render(
      <AutoStopHint status={hinweis} extendMinutes={15} onExtend={() => undefined} />,
    );
    expect(screen.getByRole('button')).toBeInTheDocument();
    rerender(<AutoStopHint status={{ state: 'ok' }} extendMinutes={15} onExtend={() => undefined} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(/Aufnahme endet/)).toBeNull();
    rerender(<AutoStopHint status={{ state: 'inaktiv' }} extendMinutes={15} onExtend={() => undefined} />);
    expect(screen.queryByText(/Aufnahme endet/)).toBeNull();
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

describe('useAutoStop', () => {
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
    expect(extend).toHaveBeenCalledWith(session.id, 15);
    expect(result.current.status.state).toBe('ok');
    expect(stop).not.toHaveBeenCalled();
  });

  it('ohne geladene Einstellungen bleibt er inaktiv', () => {
    const { result } = renderHook(() => useAutoStop({ session: makeSession(), lecture: undefined }));
    expect(result.current.status.state).toBe('inaktiv');
  });
});
