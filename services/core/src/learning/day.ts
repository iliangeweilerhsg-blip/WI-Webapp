// Lerntag (VERTRAEGE §21.5): Es gilt die Ortszeit des Macs, der Tageswechsel ist 04:00. Der Lerntag eines Zeitpunkts ist
// sein Kalendertag in `tz`, vor 04:00 der Vortag. Testfälle: `packages/schemas/fixtures/cards/learn-day.json`.
import { LEARN_DAY_START_HOUR } from './params.ts';

/** IANA-Name der Ortszeit des Core-Prozesses (wie beim Monatsbudget, §20.5) */
export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

interface Wall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let found = formatters.get(tz);
  if (!found) {
    found = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(tz, found);
  }
  return found;
}

/** Wanduhr von `instant` in `tz` */
function wallClock(instant: Date, tz: string): Wall {
  const parts: Record<string, number> = {};
  for (const part of formatter(tz).formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year!,
    month: parts.month!,
    day: parts.day!,
    hour: parts.hour!,
    minute: parts.minute!,
    second: parts.second!,
  };
}

/** Abstand der Ortszeit von UTC in Millisekunden zum Zeitpunkt `instantMs` */
function offsetMs(instantMs: number, tz: string): number {
  const wall = wallClock(new Date(instantMs), tz);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

/** Der Zeitpunkt, zu dem die Wanduhr in `tz` `Y-M-D hour:00` zeigt (bei einer Lücke der Umstellung: der Zeitpunkt danach) */
function wallToInstant(year: number, month: number, day: number, hour: number, tz: string): Date {
  const naive = Date.UTC(year, month - 1, day, hour);
  const first = naive - offsetMs(naive, tz);
  const second = naive - offsetMs(first, tz);
  return new Date(second);
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** Kalendertag plus `delta` Tage (reine Kalenderrechnung) */
function shiftDay(year: number, month: number, day: number, delta: number): [number, number, number] {
  const date = new Date(Date.UTC(year, month - 1, day + delta));
  return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
}

/** Lerntag eines Zeitpunkts als Kalendertag (Zahlen) */
function learnDayParts(instant: Date, tz: string): [number, number, number] {
  const wall = wallClock(instant, tz);
  return wall.hour < LEARN_DAY_START_HOUR
    ? shiftDay(wall.year, wall.month, wall.day, -1)
    : [wall.year, wall.month, wall.day];
}

export interface LearnDay {
  /** Lerntag `YYYY-MM-DD` */
  day: string;
  /** Erster Zeitpunkt des Lerntags */
  startsAt: Date;
  /** Erster Zeitpunkt des nächsten Lerntags */
  endsAt: Date;
}

/** Lerntag von `now` in `tz` samt Anfang und Ende */
export function learnDay(now: Date, tz: string): LearnDay {
  const [year, month, day] = learnDayParts(now, tz);
  const [ny, nm, nd] = shiftDay(year, month, day, 1);
  return {
    day: `${pad(year, 4)}-${pad(month)}-${pad(day)}`,
    startsAt: wallToInstant(year, month, day, LEARN_DAY_START_HOUR, tz),
    endsAt: wallToInstant(ny, nm, nd, LEARN_DAY_START_HOUR, tz),
  };
}

/** Überfälligkeit in Tagen: `max(0, Lerntag(now) − Lerntag(due))` in Kalendertagen */
export function overdueDays(now: Date, due: Date, tz: string): number {
  const [ny, nm, nd] = learnDayParts(now, tz);
  const [dy, dm, dd] = learnDayParts(due, tz);
  const days = Math.round((Date.UTC(ny, nm - 1, nd) - Date.UTC(dy, dm - 1, dd)) / 86_400_000);
  return Math.max(0, days);
}
