// Auto-Stopp-Controller: führt Pegel (`subscribeAudioLevel`), Session, Einstellungen und `session.updated` zusammen,
// wertet die Regeln aus (rules.ts) und stoppt per `POST /sessions/{id}/stop` (VERTRAEGE §7.2, §9.4).
// Ohne React und mit injizierter Uhr bzw. Timern, damit er sich mit einer Fake-Uhr testen lässt.
import type { Session } from '@sg/shared';
import { ApiRequestError } from '../api.ts';
import { subscribeAudioLevel, type AudioLevelListener } from '../recorder/level.ts';
import type { SessionEventSource } from '../recorder/recorder.ts';
import { extendSession, stopSession } from '../sessions.ts';
import { SilenceTracker, type SilenceTrackerOptions } from './voice.ts';
import {
  evaluateAutoStop,
  toAutoStopSession,
  type AutoStopSession,
  type AutoStopSettings,
  type AutoStopStatus,
} from './rules.ts';

export interface AutoStopApi {
  stop: typeof stopSession;
  extend: typeof extendSession;
}

export interface AutoStopControllerOptions {
  /** Uhr in Epochen-ms (Standard `Date.now`) */
  now?: () => number;
  /** Quelle der Pegelwerte (Standard `subscribeAudioLevel` des Recorders) */
  subscribeLevel?: (fn: AudioLevelListener) => () => void;
  /** `session.updated` vom Sync-Client; ohne Quelle kommt der Stand nur über `setSession` */
  events?: SessionEventSource;
  api?: AutoStopApi;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  /** Prüftakt, Standard 1 s */
  tickMs?: number;
  /** Wartezeit bis zum nächsten Stopp-Versuch nach einem Netz- oder Serverfehler, Standard 10 s */
  retryMs?: number;
  /** Schwellwerte der Sprachaktivität (voice.ts) */
  voice?: SilenceTrackerOptions;
}

export interface AutoStopSnapshot {
  status: AutoStopStatus;
  /** `POST …/extend` läuft */
  extending: boolean;
  /** Meldung des letzten gescheiterten `extend` (verschwindet beim nächsten Versuch) */
  extendError: string | null;
  /** `POST …/stop` wurde gesendet (läuft oder ist gelungen): kein zweiter Stopp */
  stopping: boolean;
}

const INACTIVE: AutoStopSnapshot = {
  status: { state: 'inaktiv' },
  extending: false,
  extendError: null,
  stopping: false,
};

function sameStatus(a: AutoStopStatus, b: AutoStopStatus): boolean {
  if (a.state !== b.state) return false;
  if (a.state === 'hinweis' && b.state === 'hinweis') {
    // Anzeige in ganzen Sekunden: kein neuer Stand für jede Millisekunde
    return a.rule === b.rule && Math.ceil(a.remainingMs / 1000) === Math.ceil(b.remainingMs / 1000);
  }
  if (a.state === 'stoppen' && b.state === 'stoppen') return a.rule === b.rule;
  return true;
}

export class AutoStopController {
  private readonly now: () => number;
  private readonly api: AutoStopApi;
  private readonly tickMs: number;
  private readonly retryMs: number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly tracker: SilenceTracker;
  private readonly listeners = new Set<() => void>();
  private readonly offLevel: () => void;
  private readonly offEvents: (() => void) | null;

  private session: Session | null = null;
  private rules: AutoStopSession | null = null;
  private settings: AutoStopSettings | null = null;
  private timer: unknown = null;
  private snapshot: AutoStopSnapshot = INACTIVE;
  private extending = false;
  private extendError: string | null = null;
  /** Für diese Session ist ein Stopp unterwegs oder gelungen: nie ein zweiter */
  private stopSentFor: string | null = null;
  private retryAt = 0;
  private disposed = false;

  constructor(options: AutoStopControllerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.api = options.api ?? { stop: stopSession, extend: extendSession };
    this.tickMs = options.tickMs ?? 1000;
    this.retryMs = options.retryMs ?? 10_000;
    this.setTimer = options.setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms));
    this.clearTimer =
      options.clearInterval ?? ((h) => globalThis.clearInterval(h as ReturnType<typeof setInterval>));
    this.tracker = new SilenceTracker(options.voice);
    this.offLevel = (options.subscribeLevel ?? subscribeAudioLevel)((sample) => this.tracker.push(sample));
    this.offEvents =
      options.events?.onEvent('session.updated', (s) => {
        if (this.session && s.id === this.session.id) this.setSession(s);
      }) ?? null;
  }

  // --- Eingaben -------------------------------------------------------------------------------------

  /**
   * Setzt bzw. aktualisiert die Session (Prop, `session.updated`, Antwort von stop/extend). Eine andere Session
   * startet frisch. Ein älterer Stand (`updated_at`) derselben Session wird ignoriert, so überholt ein spät
   * eintreffendes Ereignis kein neueres `extend`.
   */
  setSession(session: Session | null): void {
    if (this.disposed) return;
    const previous = this.session;
    if (session && previous && session.id === previous.id) {
      if (Date.parse(session.updated_at) < Date.parse(previous.updated_at)) return;
    }
    if (!session || !previous || session.id !== previous.id) {
      this.tracker.reset();
      this.stopSentFor = null;
      this.retryAt = 0;
      this.extending = false;
      this.extendError = null;
    } else if (previous.state !== session.state) {
      // Pause beginnt oder endet: Stille neu zählen (die Pause selbst zählt nie als Stille)
      this.tracker.reset();
    }
    this.session = session;
    this.rules = session ? toAutoStopSession(session) : null;
    this.sync();
  }

  setSettings(settings: AutoStopSettings | null): void {
    if (this.disposed) return;
    this.settings = settings;
    this.sync();
  }

  /**
   * „Verlängern“ (+ `auto_stop_extend_min`, Standard 15). Der Core setzt `auto_stop_extended_until`; die Antwort
   * (und `session.updated`) schiebt die Grenzen. Solange die Anfrage läuft, stoppt der Controller nicht.
   */
  async extend(): Promise<void> {
    const session = this.session;
    const settings = this.settings;
    if (this.disposed || !session || !settings || !this.rules || this.extending) return;
    this.extending = true;
    this.extendError = null;
    this.update();
    try {
      const updated = await this.api.extend(session.id, settings.auto_stop_extend_min);
      if (this.session?.id === session.id) this.setSession(updated);
    } catch (error) {
      if (this.session?.id === session.id) {
        this.extendError =
          error instanceof ApiRequestError ? error.userMessage : 'Verlängern hat nicht geklappt.';
      }
    } finally {
      if (this.session?.id === session.id) this.extending = false;
      if (!this.disposed) this.sync();
    }
  }

  // --- Ausgabe --------------------------------------------------------------------------------------

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = (): AutoStopSnapshot => this.snapshot;

  dispose(): void {
    this.disposed = true;
    this.offLevel();
    this.offEvents?.();
    this.stopTimer();
    this.listeners.clear();
  }

  // --- Innenleben -----------------------------------------------------------------------------------

  /** Timer an- oder ausschalten und sofort auswerten */
  private sync(): void {
    const active = this.rules !== null && this.settings !== null && this.stopSentFor !== this.session?.id;
    if (active && this.timer === null) {
      this.timer = this.setTimer(() => this.tick(), this.tickMs);
    } else if (!active) {
      this.stopTimer();
    }
    this.tick();
  }

  private stopTimer(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  private tick(): void {
    if (this.disposed) return;
    const { rules, settings, session } = this;
    if (!rules || !settings || !session) {
      this.update({ state: 'inaktiv' });
      return;
    }
    if (this.stopSentFor === session.id) {
      this.update({ state: 'inaktiv' });
      return;
    }
    const now = this.now();
    const status = evaluateAutoStop({
      session: rules,
      settings,
      now,
      silentSince: this.tracker.silentSince(now),
    });
    if (status.state === 'stoppen' && !this.extending && now >= this.retryAt) {
      this.stopSentFor = session.id;
      this.stopTimer();
      void this.sendStop(session.id, status.stopReason);
    }
    this.update(status);
  }

  /** Stopp senden, genau einmal je Session. Netz- und Serverfehler geben den Weg für einen späteren Versuch frei. */
  private async sendStop(id: string, reason: Extract<AutoStopStatus, { state: 'stoppen' }>['stopReason']) {
    try {
      const ended = await this.api.stop(id, reason);
      if (this.session?.id === id) this.setSession(ended);
    } catch (error) {
      if (this.session?.id !== id) return;
      // 404 und 409 (z. B. schon beendet, gleicher Zielzustand ist 200): Es gibt nichts mehr zu stoppen.
      // Das `session.updated` bzw. der nächste Session-Stand räumt auf, ein weiterer Stopp wäre falsch.
      if (error instanceof ApiRequestError && (error.status === 404 || error.status === 409)) return;
      this.stopSentFor = null;
      this.retryAt = this.now() + this.retryMs;
      this.sync();
    }
  }

  private update(status?: AutoStopStatus): void {
    const current = this.snapshot;
    const next: AutoStopSnapshot = {
      status: status ?? current.status,
      extending: this.extending,
      extendError: this.extendError,
      stopping: this.session !== null && this.stopSentFor === this.session.id,
    };
    if (
      sameStatus(current.status, next.status) &&
      current.extending === next.extending &&
      current.extendError === next.extendError &&
      current.stopping === next.stopping
    ) {
      return;
    }
    this.snapshot = next;
    this.emit();
  }

  private emit(): void {
    for (const fn of [...this.listeners]) fn();
  }
}
