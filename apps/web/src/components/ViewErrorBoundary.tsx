'use client';

// Fehlergrenze um den Seiteninhalt der App-Shell (Issue #266). Wirft eine Seite beim Rendern, bleiben Shell,
// RecordingProvider und Aufnahme-Leiste stehen: Die Aufnahme läuft weiter. Bewusst hier und nicht als `app/error.tsx`:
// Die Grenze steht so unter unserer Kontrolle (testbar ohne Next-Laufzeit, setzt sich beim Seitenwechsel zurück).
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Ändert sich der Schlüssel (Seitenwechsel), verschwindet die Fehleranzeige */
  resetKey?: string;
  /** Nach „Neu laden“ (z. B. um den Fokus zu setzen, weil der Knopf verschwindet) */
  onReset?: () => void;
}
interface State {
  error: Error | null;
}

/** Next.js nutzt geworfene Fehler für `notFound()` und `redirect()`: Die gehen weiter nach oben. */
function isNextControlFlow(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === 'string' && digest.startsWith('NEXT_');
}

export class ViewErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Ansicht hat einen Fehler', error, info.componentStack);
  }

  override componentDidUpdate(prev: Props, prevState: State) {
    // Nur einen Fehler zurücksetzen, der schon VOR diesem Wechsel stand. Wirft die neue Seite gleich beim Wechsel,
    // kommen Fehler und neuer Schlüssel in derselben Übergabe: Ein Zurücksetzen rendert sie sonst sofort noch einmal.
    if (this.state.error && prevState.error && prev.resetKey !== this.props.resetKey)
      this.setState({ error: null });
  }

  private readonly reset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  override render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    if (isNextControlFlow(error)) throw error;
    return (
      <section aria-labelledby="view-error-title" data-testid="view-error">
        <h1 id="view-error-title" className="text-xxl font-semibold">
          Etwas ist schiefgegangen
        </h1>
        <p role="status" className="mt-4 text-md">
          Diese Ansicht hat einen Fehler. Die Aufnahme läuft weiter.
        </p>
        <button
          type="button"
          onClick={this.reset}
          className="mt-4 inline-flex min-h-11 items-center justify-center rounded-md border border-border-strong px-4 py-2 text-md hover:bg-surface-raised"
        >
          Neu laden
        </button>
      </section>
    );
  }
}
