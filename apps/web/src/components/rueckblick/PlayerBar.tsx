'use client';

// Player am unteren Rand des Rückblicks (07 §3.4): Abspielen/Pause, ±15 s, Position, Geschwindigkeit 1–2×.
// Tasten: Leertaste, `J` (−15 s), `L` (+15 s), gehandhabt in ReviewView.
import { clockAt } from '../../lib/transcript.ts';
import { RATES, SKIP_MS, type Player } from './use-player.ts';

const icon =
  'inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-2 text-md hover:bg-surface-raised disabled:opacity-40';

export function PlayerBar({ player, startedAt }: { player: Player; startedAt: string | null }) {
  const { bounds, t } = player;
  const disabled = bounds === null || player.failed;
  return (
    <div
      role="group"
      aria-label="Wiedergabe"
      data-testid="review-player"
      className="shrink-0 border-t border-border bg-surface px-3 py-2 md:px-6"
    >
      {player.failed ? (
        <p role="status" className="pb-1 text-sm text-text-muted">
          Die Aufnahme lässt sich gerade nicht abspielen.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0 md:flex-nowrap">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={icon}
            disabled={disabled}
            aria-label="15 Sekunden zurück"
            aria-keyshortcuts="J"
            onClick={() => player.skip(-SKIP_MS)}
          >
            −15
          </button>
          <button
            type="button"
            className={`${icon} border border-border-strong px-4`}
            disabled={disabled}
            aria-label={player.playing ? 'Pause' : 'Abspielen'}
            aria-keyshortcuts="Space"
            onClick={player.toggle}
          >
            <span aria-hidden="true">{player.playing ? '❚❚' : '▶'}</span>
          </button>
          <button
            type="button"
            className={icon}
            disabled={disabled}
            aria-label="15 Sekunden vor"
            aria-keyshortcuts="L"
            onClick={() => player.skip(SKIP_MS)}
          >
            +15
          </button>
        </div>
        {/* Schmal: Position über den Tasten, damit der Regler Platz hat */}
        <div className="order-first flex w-full min-w-0 items-center gap-2 md:order-none md:w-auto md:flex-1">
          <span
            data-testid="review-clock"
            className="w-[4.5rem] shrink-0 text-sm tabular-nums text-text-muted"
          >
            {clockAt(startedAt, t, true)}
          </span>
          <input
            type="range"
            aria-label="Position"
            className="h-11 min-w-0 flex-1 accent-[var(--sg-color-accent)]"
            disabled={disabled}
            min={bounds?.start ?? 0}
            max={bounds?.end ?? 0}
            step={1000}
            value={Math.min(Math.max(t, bounds?.start ?? 0), bounds?.end ?? 0)}
            aria-valuetext={clockAt(startedAt, t, true)}
            onChange={(e) => player.seek(Number(e.target.value))}
          />
        </div>
        <select
          aria-label="Geschwindigkeit"
          value={player.rate}
          disabled={disabled}
          onChange={(e) => player.setRate(Number(e.target.value))}
          className="ml-auto min-h-11 rounded-md border border-border bg-surface px-2 text-sm text-text md:ml-0"
        >
          {RATES.map((rate) => (
            <option key={rate} value={rate}>
              {String(rate).replace('.', ',')}×
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
