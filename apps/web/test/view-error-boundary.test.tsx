// Fehlergrenze um den Seiteninhalt (Issue #266): zurücksetzen beim Seitenwechsel, Next-Steuerfehler weiterreichen,
// Fehler protokollieren.
import { Component, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { ViewErrorBoundary } from '../src/components/ViewErrorBoundary.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

let renders = 0;
function Page({ fail, label = 'ok' }: { fail: unknown; label?: string }) {
  renders += 1;
  if (fail) throw fail;
  return <p data-testid="page">{label}</p>;
}

class Outer extends Component<{ children: ReactNode }, { error: unknown }> {
  override state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  override render() {
    return this.state.error ? (
      <p data-testid="outer">{String((this.state.error as Error).message)}</p>
    ) : (
      this.props.children
    );
  }
}

describe('ViewErrorBoundary', () => {
  it('protokolliert den Fehler und zeigt die Fehleransicht', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const err = new Error('kaputt');
    render(
      <ViewErrorBoundary resetKey="/a">
        <Page fail={err} />
      </ViewErrorBoundary>,
    );
    expect(screen.getByTestId('view-error')).toBeInTheDocument();
    expect(log.mock.calls.some((c) => c[0] === 'Ansicht hat einen Fehler' && c[1] === err)).toBe(true);
  });

  it('eine Seite, die schon beim Wechsel wirft, rendert nur einmal neu (kein sofortiges Zurücksetzen)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { rerender } = render(
      <ViewErrorBoundary resetKey="/a">
        <Page fail={null} />
      </ViewErrorBoundary>,
    );
    renders = 0;
    rerender(
      <ViewErrorBoundary resetKey="/b">
        <Page fail={new Error('kaputt')} />
      </ViewErrorBoundary>,
    );
    expect(screen.getByTestId('view-error')).toBeInTheDocument();
    // React wiederholt ein fehlgeschlagenes Rendern einmal; ein Zurücksetzen in derselben Übergabe käme dazu
    expect(renders).toBeLessThanOrEqual(2);
  });

  it('setzt sich beim Seitenwechsel zurück', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { rerender } = render(
      <ViewErrorBoundary resetKey="/a">
        <Page fail={new Error('kaputt')} />
      </ViewErrorBoundary>,
    );
    expect(screen.getByTestId('view-error')).toBeInTheDocument();
    rerender(
      <ViewErrorBoundary resetKey="/b">
        <Page fail={null} label="b" />
      </ViewErrorBoundary>,
    );
    expect(screen.getByTestId('page')).toHaveTextContent('b');
    expect(screen.queryByTestId('view-error')).toBeNull();
  });

  it('reicht Next-Steuerfehler (notFound, redirect) weiter und protokolliert sie nicht', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const control = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/x;307;' });
    render(
      <Outer>
        <ViewErrorBoundary resetKey="/a">
          <Page fail={control} />
        </ViewErrorBoundary>
      </Outer>,
    );
    expect(screen.getByTestId('outer')).toHaveTextContent('NEXT_REDIRECT');
    expect(screen.queryByTestId('view-error')).toBeNull();
    expect(log.mock.calls.some((c) => c[0] === 'Ansicht hat einen Fehler')).toBe(false);
  });

  it('„Neu laden“ ruft onReset auf', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onReset = vi.fn();
    render(
      <ViewErrorBoundary resetKey="/a" onReset={onReset}>
        <Page fail={new Error('kaputt')} />
      </ViewErrorBoundary>,
    );
    act(() => screen.getByRole('button', { name: 'Neu laden' }).click());
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
