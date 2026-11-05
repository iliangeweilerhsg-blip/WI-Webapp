// Auto-Stopp-Regeln im Browser (F-SES-03, VERTRAEGE §9.4). Reine Logik, ohne React und ohne eigene Uhr:
// alle Zeiten sind Epochen-ms und werden hereingegeben.
import type { Session, Settings, StopReason } from '@sg/shared';

const MINUTE_MS = 60_000;

/** Die Einstellungen `lecture.auto_stop_*` (VERTRAEGE §14.1, Schema `LectureSettings`) */
export type AutoStopSettings = Pick<
  Settings['lecture'],
  | 'auto_stop_after_end_min'
  | 'auto_stop_quiet_window_min'
  | 'auto_stop_hard_after_end_min'
  | 'auto_stop_silence_min'
  | 'auto_stop_max_duration_min'
  | 'auto_stop_warning_s'
  | 'auto_stop_extend_min'
>;

export type AutoStopRule = 1 | 2 | 3 | 4;

/** `stop_reason` je Regel laut VERTRAEGE §9.4 */
export const STOP_REASON: Record<
  AutoStopRule,
  Extract<StopReason, 'kalenderende' | 'stille' | 'maximaldauer'>
> = {
  1: 'kalenderende',
  2: 'kalenderende',
  3: 'stille',
  4: 'maximaldauer',
};

/** Was die Regeln von der Session brauchen (Zeiten als Epochen-ms) */
export interface AutoStopSession {
  startedAt: number;
  /** `null` bei spontanen Sessions: dann gelten nur die Regeln 3 und 4 */
  plannedEndsAt: number | null;
  /** `auto_stop_extended_until`, vor diesem Zeitpunkt stoppt keine Regel */
  extendedUntil: number | null;
  /** Pause: Stille zählt nicht (Regeln 1 und 3 ruhen), die harten Grenzen (2 und 4) gelten weiter */
  paused: boolean;
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/** Nur `laeuft` und `pausiert` sind aktiv, nur dann gibt es etwas zu stoppen */
export function toAutoStopSession(session: Session): AutoStopSession | null {
  if (session.state !== 'laeuft' && session.state !== 'pausiert') return null;
  if (session.deleted_at) return null;
  const startedAt = parseTime(session.started_at);
  if (startedAt === null) return null;
  return {
    startedAt,
    plannedEndsAt: parseTime(session.planned_ends_at),
    extendedUntil: parseTime(session.auto_stop_extended_until),
    paused: session.state === 'pausiert',
  };
}

/**
 * Harte Grenze G der Session. Muss genau der Formel des Core-Takts entsprechen (`autoStopDecision` in
 * `services/core/src/services/sessions.ts`, T1-02; VERTRAEGE §9.1/§10.1):
 *
 *   G = max(min(planned_ends_at + hard_after_end, started_at + max_duration), auto_stop_extended_until)
 *
 * Der erste Term im `min` entfällt ohne Termin. Der Core bildet je Regel `max(Grenze, extended_until)` und nimmt
 * die frühere der beiden Zeiten; das ist dasselbe wie die Formel oben, weil max(min(a, b), e) = min(max(a, e), max(b, e)).
 * `evaluateAutoStop` rechnet wie der Core (je Regel), `hardBoundary` ist die zusammengefasste Form.
 */
export function hardBoundary(
  session: Pick<AutoStopSession, 'startedAt' | 'plannedEndsAt' | 'extendedUntil'>,
  settings: Pick<AutoStopSettings, 'auto_stop_hard_after_end_min' | 'auto_stop_max_duration_min'>,
): number {
  const maxDuration = session.startedAt + settings.auto_stop_max_duration_min * MINUTE_MS;
  const base =
    session.plannedEndsAt === null
      ? maxDuration
      : Math.min(session.plannedEndsAt + settings.auto_stop_hard_after_end_min * MINUTE_MS, maxDuration);
  return session.extendedUntil === null ? base : Math.max(base, session.extendedUntil);
}

export type AutoStopStatus =
  | { state: 'inaktiv' }
  | { state: 'ok' }
  | {
      /** Vorwarnung: Der Stopp tritt voraussichtlich in `remainingMs` ein (bei Sprache verschiebt er sich) */
      state: 'hinweis';
      remainingMs: number;
      rule: AutoStopRule;
      stopReason: StopReason;
    }
  | { state: 'stoppen'; rule: AutoStopRule; stopReason: StopReason };

export interface EvaluateInput {
  session: AutoStopSession;
  settings: AutoStopSettings;
  now: number;
  /**
   * Beginn der lückenlos beobachteten Stille (`SilenceTracker.silentSince`). `null` = unbekannt (keine Messwerte,
   * `AudioContext` nicht `running`): Dann greifen die Regeln 1 und 3 NICHT. Fehlende Werte sind keine Stille.
   */
  silentSince: number | null;
}

interface Candidate {
  rule: AutoStopRule;
  /** Frühester Zeitpunkt, an dem die Regel (bei anhaltender Stille) greift, schon mit `extended_until` verrechnet */
  at: number;
}

/**
 * Wertet die Regeln aus. Die erste zutreffende gewinnt, bei Gleichstand die kleinere Regelnummer (wie im Core
 * das Kalenderende vor der Maximaldauer). Vor `extendedUntil` stoppt keine Regel (VERTRAEGE §9.4).
 */
export function evaluateAutoStop(input: EvaluateInput): AutoStopStatus {
  const { session, settings, now, silentSince } = input;
  const effective = (t: number) => (session.extendedUntil === null ? t : Math.max(t, session.extendedUntil));
  const candidates: Candidate[] = [];
  const silence = session.paused ? null : silentSince;

  if (session.plannedEndsAt !== null) {
    if (silence !== null) {
      // Regel 1: ab Kalenderende + X min UND Y min Stille am Stück
      candidates.push({
        rule: 1,
        at: effective(
          Math.max(
            session.plannedEndsAt + settings.auto_stop_after_end_min * MINUTE_MS,
            silence + settings.auto_stop_quiet_window_min * MINUTE_MS,
          ),
        ),
      });
    }
    // Regel 2: harte Grenze nach dem Terminende
    candidates.push({
      rule: 2,
      at: effective(session.plannedEndsAt + settings.auto_stop_hard_after_end_min * MINUTE_MS),
    });
  }
  if (silence !== null) {
    // Regel 3: Stille ab X min am Stück (mit oder ohne Termin)
    candidates.push({ rule: 3, at: effective(silence + settings.auto_stop_silence_min * MINUTE_MS) });
  }
  // Regel 4: Maximaldauer
  candidates.push({
    rule: 4,
    at: effective(session.startedAt + settings.auto_stop_max_duration_min * MINUTE_MS),
  });

  candidates.sort((a, b) => a.at - b.at || a.rule - b.rule);
  const next = candidates[0];
  if (!next) return { state: 'ok' };
  const remainingMs = next.at - now;
  if (remainingMs <= 0) return { state: 'stoppen', rule: next.rule, stopReason: STOP_REASON[next.rule] };
  const warningMs = settings.auto_stop_warning_s * 1000;
  if (warningMs > 0 && remainingMs <= warningMs) {
    return { state: 'hinweis', remainingMs, rule: next.rule, stopReason: STOP_REASON[next.rule] };
  }
  return { state: 'ok' };
}
