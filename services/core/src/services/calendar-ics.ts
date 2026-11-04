// ICS lesen und Serien auflösen (VERTRAEGE §8 „Auflösen“, F-KAL-01). Reine Funktionen ohne Datenbank und Netz.
//
// Aufbau: `ical.js` liest die Datei und liefert die Wiederholungen samt Ausnahmen (RECURRENCE-ID).
// Die Umrechnung auf absolute Zeitpunkte machen wir selbst:
// - VALUE=DATE: 00:00 UTC des Datums (ganztägig)
// - Zeit in UTC (`…Z`): wie angegeben
// - TZID mit VTIMEZONE: deren Regeln (ical.js)
// - TZID ohne VTIMEZONE: als IANA-Name über `Intl` (Fall 6b)
// - ohne Zone (floating) oder unbekannte Zone: die Zeitzone des Systems (`TZ`), bei unbekannter Zone mit Warnung
import ICAL from 'ical.js';
import type { IcsWarning } from '@sg/shared';

type IcalTime = InstanceType<typeof ICAL.Time>;
type IcalComponent = InstanceType<typeof ICAL.Component>;
type IcalEvent = InstanceType<typeof ICAL.Event>;

export interface ParsedEvent {
  uid: string;
  /** null bei Einzelterminen (VERTRAEGE §8: Kennung des ursprünglichen Beginns bei Serien) */
  recurrenceId: string | null;
  title: string;
  location: string | null;
  description: string | null;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  cancelled: boolean;
}

export interface ParseOptions {
  /** Jetzt (für den Horizont offener Serien) */
  now: Date;
  /** Zeitzone für Termine ohne Zone (`TZ` des Systems) */
  defaultTimeZone: string;
  /** Offene Serien werden bis heute + so viele Tage aufgelöst (Standard 180) */
  horizonDays?: number;
  /** Höchstens so viele Termine pro Quelle (Standard 5000) */
  maxEvents?: number;
}

export interface ParseResult {
  events: ParsedEvent[];
  warnings: IcsWarning[];
  /** true, wenn wegen `maxEvents` Vorkommen fehlen. Dann darf der Abgleich nichts als „entfallen“ werten. */
  truncated: boolean;
}

/** Datei ist kein lesbarer Kalender (→ 422 `ics_invalid`) */
export class IcsParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IcsParseError';
  }
}

/** Byte-Order-Mark am Anfang mancher Exporte */
const BOM = String.fromCharCode(0xfeff);

export const DEFAULT_HORIZON_DAYS = 180;
export const MAX_EVENTS_PER_SOURCE = 5000;
/** Obergrenze für Schritte pro Serie, damit eine Regel wie FREQ=SECONDLY den Core nicht lahmlegt */
const MAX_ITERATIONS_PER_SERIES = 20_000;
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------------------------
// Zeitzonen über Intl
// ---------------------------------------------------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat | null>();

function formatterFor(zone: string): Intl.DateTimeFormat | null {
  let cached = formatters.get(zone);
  if (cached === undefined) {
    try {
      cached = new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
      });
    } catch {
      cached = null;
    }
    formatters.set(zone, cached);
  }
  return cached;
}

/** Kennt die Laufzeit (`Intl`) diesen IANA-Namen? */
export function isKnownTimeZone(zone: string): boolean {
  return formatterFor(zone) !== null;
}

/** Abstand der Ortszeit von UTC in ms zum Zeitpunkt `utcMs` (positiv östlich von Greenwich) */
function zoneOffsetMs(zone: string, utcMs: number): number {
  const formatter = formatterFor(zone);
  if (!formatter) return 0;
  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(utcMs)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  const wall = Date.UTC(
    parts.year ?? 1970,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
  return wall - Math.floor(utcMs / 1000) * 1000;
}

/** Ortszeit (Wanduhr) in der Zone → UTC-Zeitpunkt in ms. In der Lücke der Sommerzeit zählt der spätere Offset. */
export function zonedWallToUtc(
  zone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  let utc = guess - zoneOffsetMs(zone, guess);
  const corrected = guess - zoneOffsetMs(zone, utc);
  if (corrected !== utc) utc = corrected;
  return utc;
}

const pad = (n: number, width = 2) => String(Math.abs(n)).padStart(width, '0');

/** `2026-10-27T10:15:00+01:00` aus Wanduhrzeit und Zeitpunkt */
function formatWithOffset(time: IcalTime, instantMs: number): string {
  const wallMs = Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second);
  const offsetMin = Math.round((wallMs - instantMs) / 60_000);
  const sign = offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  return (
    `${pad(time.year, 4)}-${pad(time.month)}-${pad(time.day)}` +
    `T${pad(time.hour)}:${pad(time.minute)}:${pad(time.second)}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

// ---------------------------------------------------------------------------------------------
// Zeiten auflösen
// ---------------------------------------------------------------------------------------------

interface Context {
  options: ParseOptions;
  warnings: IcsWarning[];
  warnedZones: Set<string>;
}

function warn(ctx: Context, code: string, message: string, uid: string | null): void {
  ctx.warnings.push({ code, message, external_uid: uid });
}

function tzidOf(component: IcalComponent, property: string): string | null {
  const prop = component.getFirstProperty(property);
  const tzid = prop ? prop.getParameter('tzid') : null;
  return typeof tzid === 'string' && tzid !== '' ? tzid : null;
}

/** true bei Zeiten, die ical.js ohne Zone liest (floating, auch bei TZID ohne VTIMEZONE) */
const isFloating = (time: IcalTime) => time.zone.tzid === 'floating';
const isUtc = (time: IcalTime) => time.zone.tzid === 'UTC';

/** Zeitpunkt (ms seit Epoche) einer ical.js-Zeit. `tzid` ist der TZID-Parameter der Eigenschaft, falls es einen gibt. */
function instantOf(time: IcalTime, tzid: string | null, ctx: Context, uid: string): number {
  if (time.isDate) return Date.UTC(time.year, time.month - 1, time.day);
  if (isUtc(time)) return Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second);
  if (!isFloating(time)) return time.toUnixTime() * 1000; // VTIMEZONE der Datei
  let zone = ctx.options.defaultTimeZone;
  if (tzid !== null) {
    if (isKnownTimeZone(tzid)) {
      zone = tzid;
    } else if (!ctx.warnedZones.has(tzid)) {
      ctx.warnedZones.add(tzid);
      warn(
        ctx,
        'timezone_unknown',
        `Die Zeitzone „${tzid}“ ist unbekannt. Es gilt ${ctx.options.defaultTimeZone}.`,
        uid,
      );
    }
  }
  return zonedWallToUtc(zone, time.year, time.month, time.day, time.hour, time.minute, time.second);
}

/** Kennung eines Vorkommens: Datum (ganztägig), `…Z` (UTC) oder Ortszeit mit Offset */
function recurrenceKey(time: IcalTime, instantMs: number): string {
  if (time.isDate) return `${pad(time.year, 4)}-${pad(time.month)}-${pad(time.day)}`;
  if (isUtc(time)) {
    return `${pad(time.year, 4)}-${pad(time.month)}-${pad(time.day)}T${pad(time.hour)}:${pad(time.minute)}:${pad(time.second)}Z`;
  }
  return formatWithOffset(time, instantMs);
}

// ---------------------------------------------------------------------------------------------
// Texte
// ---------------------------------------------------------------------------------------------

function textOf(component: IcalComponent, name: string): string | null {
  const value = component.getFirstPropertyValue(name);
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function isCancelled(component: IcalComponent): boolean {
  return String(component.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED';
}

// ---------------------------------------------------------------------------------------------
// Hauptfunktion
// ---------------------------------------------------------------------------------------------

/** ical.js liefert bei mehreren VCALENDAR eine Liste von jCal-Objekten, sonst ein einzelnes */
function firstCalendar(jcal: unknown): IcalComponent {
  const single =
    Array.isArray(jcal) && typeof jcal[0] === 'string' ? jcal : Array.isArray(jcal) ? jcal[0] : null;
  if (!Array.isArray(single)) throw new IcsParseError('Die Datei enthält keinen Kalender.');
  const component = new ICAL.Component(single);
  if (component.name !== 'vcalendar') throw new IcsParseError('Die Datei enthält keinen VCALENDAR.');
  return component;
}

interface Series {
  uid: string;
  master: IcalComponent | null;
  exceptions: IcalComponent[];
}

/**
 * Liest ICS-Text und löst alle Termine auf (Wiederholungen, Ausnahmen, Zeitzonen).
 * Wirft `IcsParseError`, wenn der Text kein Kalender ist.
 */
export function parseIcs(text: string, options: ParseOptions): ParseResult {
  const source = text.startsWith(BOM) ? text.slice(1) : text;
  if (!/^\s*BEGIN:VCALENDAR/im.test(source)) {
    throw new IcsParseError('Die Datei ist kein ICS-Kalender (BEGIN:VCALENDAR fehlt).');
  }
  let calendar: IcalComponent;
  try {
    calendar = firstCalendar(ICAL.parse(source));
  } catch (error) {
    if (error instanceof IcsParseError) throw error;
    throw new IcsParseError(
      `Die Datei lässt sich nicht lesen: ${error instanceof Error ? error.message : 'Fehler'}`,
    );
  }

  const ctx: Context = { options, warnings: [], warnedZones: new Set() };
  const maxEvents = options.maxEvents ?? MAX_EVENTS_PER_SOURCE;
  const horizonMs = options.now.getTime() + (options.horizonDays ?? DEFAULT_HORIZON_DAYS) * DAY_MS;

  // Nach UID gruppieren: Master (ohne RECURRENCE-ID) und Ausnahmen
  const groups = new Map<string, Series>();
  for (const vevent of calendar.getAllSubcomponents('vevent')) {
    const uid = textOf(vevent, 'uid');
    if (!uid) {
      warn(ctx, 'uid_missing', 'Ein Termin ohne UID wurde übersprungen.', null);
      continue;
    }
    let group = groups.get(uid);
    if (!group) {
      group = { uid, master: null, exceptions: [] };
      groups.set(uid, group);
    }
    if (vevent.hasProperty('recurrence-id')) group.exceptions.push(vevent);
    else if (group.master === null) group.master = vevent;
    else warn(ctx, 'uid_duplicate', 'Die UID kommt mehrfach vor. Nur der erste Termin zählt.', uid);
  }

  const events: ParsedEvent[] = [];
  let truncated = false;
  const seen = new Set<string>();

  const push = (event: ParsedEvent): boolean => {
    const key = `${event.uid}\u0000${event.recurrenceId ?? ''}`;
    if (seen.has(key)) return true;
    if (events.length >= maxEvents) {
      if (!truncated) {
        truncated = true;
        warn(
          ctx,
          'too_many_events',
          `Es gibt mehr als ${maxEvents} Termine. Der Rest wurde ausgelassen.`,
          event.uid,
        );
      }
      return false;
    }
    seen.add(key);
    events.push(event);
    return true;
  };

  for (const group of groups.values()) {
    try {
      resolveSeries(group, ctx, horizonMs, push);
    } catch (error) {
      warn(
        ctx,
        'event_invalid',
        `Der Termin ließ sich nicht auflösen: ${error instanceof Error ? error.message : 'Fehler'}`,
        group.uid,
      );
    }
  }
  return { events, warnings: ctx.warnings, truncated };
}

/** Termin aus Komponente und (bereits berechneter) Start-/Endzeit */
function toEvent(
  item: IcalComponent,
  uid: string,
  recurrenceId: string | null,
  start: { time: IcalTime; instant: number },
  end: { instant: number },
): ParsedEvent {
  const startsAt = start.instant;
  const endsAt = Math.max(end.instant, startsAt);
  return {
    uid,
    recurrenceId,
    title: textOf(item, 'summary') ?? '(ohne Titel)',
    location: textOf(item, 'location'),
    description: textOf(item, 'description'),
    startsAt: new Date(startsAt),
    endsAt: new Date(endsAt),
    allDay: start.time.isDate,
    cancelled: isCancelled(item),
  };
}

/** Einzeltermin oder Ausnahme außerhalb einer Serie: Start/Ende aus den eigenen Eigenschaften */
function standalone(
  item: IcalComponent,
  uid: string,
  recurrenceId: string | null,
  ctx: Context,
): ParsedEvent {
  const event = new ICAL.Event(item);
  const start = event.startDate;
  if (!start) throw new Error('DTSTART fehlt');
  const startInstant = instantOf(start, tzidOf(item, 'dtstart'), ctx, uid);
  const endTime = event.endDate;
  const endInstant = instantOf(endTime, tzidOf(item, 'dtend') ?? tzidOf(item, 'dtstart'), ctx, uid);
  return toEvent(item, uid, recurrenceId, { time: start, instant: startInstant }, { instant: endInstant });
}

function resolveSeries(
  group: Series,
  ctx: Context,
  horizonMs: number,
  push: (event: ParsedEvent) => boolean,
): void {
  const { uid, master, exceptions } = group;
  const consumed = new Set<IcalComponent>();

  if (master) {
    const event: IcalEvent = new ICAL.Event(master, { exceptions });
    if (!event.isRecurring()) {
      if (!push(standalone(master, uid, null, ctx))) return;
    } else {
      const masterTzid = tzidOf(master, 'dtstart');
      const openEnded = master.getAllProperties('rrule').some((prop) => {
        const rule = prop.getFirstValue() as { until?: unknown; count?: unknown } | null;
        return !rule || (!rule.until && !rule.count);
      });
      try {
        const iterator = event.iterator();
        let steps = 0;
        let next: IcalTime | null;
        while ((next = iterator.next())) {
          steps += 1;
          if (steps > MAX_ITERATIONS_PER_SERIES) {
            warn(
              ctx,
              'rrule_unsupported',
              'Die Wiederholungsregel erzeugt zu viele Schritte. Der Rest wurde ausgelassen.',
              uid,
            );
            break;
          }
          const details = event.getOccurrenceDetails(next);
          const occurrenceInstant = instantOf(next, masterTzid, ctx, uid);
          if (openEnded && occurrenceInstant > horizonMs) break;

          const item = details.item.component;
          const itemTzid = tzidOf(item, 'dtstart') ?? masterTzid;
          const isException = item !== master;
          if (isException) consumed.add(item);
          const startInstant = isException
            ? instantOf(details.startDate, itemTzid, ctx, uid)
            : occurrenceInstant;
          // Ende: aus der Ausnahme bzw. Beginn + Dauer, in derselben Ortszeit-Rechnung wie der Beginn
          const endInstant = instantOf(details.endDate, itemTzid, ctx, uid);
          const parsed = toEvent(
            item,
            uid,
            recurrenceKey(next, occurrenceInstant),
            { time: details.startDate, instant: startInstant },
            { instant: endInstant },
          );
          if (!push(parsed)) return;
        }
      } catch (error) {
        warn(
          ctx,
          'rrule_unsupported',
          `Die Wiederholungsregel wird nicht unterstützt (${error instanceof Error ? error.message : 'Fehler'}).`,
          uid,
        );
        // Wenigstens den ersten Termin behalten
        push(standalone(master, uid, null, ctx));
      }
    }
  }

  // Ausnahmen, die zu keinem Vorkommen der Serie passen (oder ohne Serie): als eigene Termine
  for (const item of exceptions) {
    if (consumed.has(item)) continue;
    const recurrenceTime = item.getFirstPropertyValue('recurrence-id') as IcalTime | null;
    if (!recurrenceTime) continue;
    const instant = instantOf(recurrenceTime, tzidOf(item, 'recurrence-id'), ctx, uid);
    if (!push(standalone(item, uid, recurrenceKey(recurrenceTime, instant), ctx))) return;
  }
}
