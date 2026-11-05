// Grenze des Auto-Stopps (VERTRAEGE §9.4, Regeln 2 und 4). Gemeinsam genutzt vom Core-Takt (sessions.ts) und von
// der Plausibilitätsprüfung nachträglich angelegter Aufnahmen (recordings.ts, §10.1).
const MINUTE_MS = 60_000;

export interface AutoStopLimits {
  hardAfterEndMin: number;
  maxDurationMin: number;
}

export interface AutoStopSession {
  startedAt: Date;
  plannedEndsAt: Date | null;
  extendedUntil: Date | null;
}

/** Zeitpunkt der Regel 2 (Terminende + Hardlimit) und der Regel 4 (Maximaldauer), jeweils ohne Verlängerung */
export function autoStopRuleTimes(
  s: Pick<AutoStopSession, 'startedAt' | 'plannedEndsAt'>,
  limits: AutoStopLimits,
): { calendarEnd: Date | null; maxDuration: Date } {
  return {
    calendarEnd: s.plannedEndsAt
      ? new Date(s.plannedEndsAt.getTime() + limits.hardAfterEndMin * MINUTE_MS)
      : null,
    maxDuration: new Date(s.startedAt.getTime() + limits.maxDurationMin * MINUTE_MS),
  };
}

/**
 * `G = max(min(planned_ends_at + hard_after_end, started_at + max_duration), auto_stop_extended_until)`.
 * Der erste Term der `min` entfällt bei Sessions ohne Termin. Vor `G` stoppt keine Regel.
 */
export function autoStopBoundary(s: AutoStopSession, limits: AutoStopLimits): Date {
  const { calendarEnd, maxDuration } = autoStopRuleTimes(s, limits);
  const first = calendarEnd && calendarEnd < maxDuration ? calendarEnd : maxDuration;
  return s.extendedUntil && s.extendedUntil > first ? s.extendedUntil : first;
}

/** Regel, die `G` setzt: die zuerst erreichte (mit Verlängerung gerechnet), bei Gleichstand das Kalenderende */
export function autoStopReason(s: AutoStopSession, limits: AutoStopLimits): 'kalenderende' | 'maximaldauer' {
  const { calendarEnd, maxDuration } = autoStopRuleTimes(s, limits);
  const eff = (d: Date): number => Math.max(d.getTime(), s.extendedUntil?.getTime() ?? 0);
  return calendarEnd && eff(calendarEnd) <= eff(maxDuration) ? 'kalenderende' : 'maximaldauer';
}
