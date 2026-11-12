import { isIP } from 'node:net';
import { LogController } from 'fastify';
import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from 'fastify';
import { isLocalRequest } from './security.ts';

/**
 * Begrenzung der Log-Flut durch abgelehnte Netzanfragen (Issue #87):
 *
 * - Eine vom Wächter abgelehnte Anfrage (401, 403, 421) aus einer Nicht-Loopback-Adresse erzeugt keine Logzeile
 *   (weder Fastifys `incoming request`/`request completed` noch Fehlerzeilen). Sie wird nur gezählt.
 * - Je Quelladresse (IPv6 je /64) und Minute schreibt der `RejectionLog` höchstens eine Zusammenfassung:
 *   Anzahl, Statuscodes, erster und letzter Zeitpunkt.
 * - Die Zähler sind begrenzt (`maxSources`, Standard 4096). Wird die Tabelle voll, wandert die älteste Quelle in
 *   einen gemeinsamen Sammelzähler. Je Minute erscheinen höchstens `maxLinesPerFlush` Quellzeilen, der Rest wird
 *   in einer Sammelzeile zusammengefasst. So wächst weder der Speicher noch das Log mit der Zahl der Quellen.
 * - Lokale Anfragen und angenommene Netzanfragen loggen wie bisher.
 */

export const REJECTION_WINDOW_MS = 60_000;
export const REJECTION_MAX_SOURCES = 4096;
export const REJECTION_MAX_LINES_PER_FLUSH = 64;

/** Schlüssel einer Quelle: IPv4 unverändert, IPv6 als /64-Präfix, IPv4-mapped IPv6 als IPv4 */
export function sourceKey(address: string | undefined): string {
  if (!address) return 'unbekannt';
  const bare = address.split('%')[0] ?? address;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(bare);
  if (mapped?.[1]) return mapped[1];
  if (isIP(bare) !== 6) return bare;
  // IPv6 auf 8 Gruppen erweitern; ein eingebettetes IPv4 am Ende zählt als zwei Gruppen
  let text = bare.toLowerCase();
  const tail = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (tail) {
    const [a, b, c, d] = tail.slice(1).map(Number) as [number, number, number, number];
    text = `${text.slice(0, tail.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = '', rest] = text.split('::');
  const headGroups = head === '' ? [] : head.split(':');
  const restGroups = rest === undefined || rest === '' ? [] : rest.split(':');
  const missing = Math.max(0, 8 - headGroups.length - restGroups.length);
  const groups =
    rest === undefined ? headGroups : [...headGroups, ...Array<string>(missing).fill('0'), ...restGroups];
  const prefix = groups.slice(0, 4).map((g) => (g || '0').replace(/^0+(?=.)/, ''));
  return `${prefix.join(':')}::/64`;
}

interface Bucket {
  windowStart: number;
  first: number;
  last: number;
  count: number;
  statuses: Record<string, number>;
}

function newBucket(now: number): Bucket {
  return { windowStart: now, first: now, last: now, count: 0, statuses: {} };
}

function merge(into: Bucket, from: Bucket): void {
  into.first = into.count === 0 ? from.first : Math.min(into.first, from.first);
  into.last = Math.max(into.last, from.last);
  into.count += from.count;
  for (const [status, n] of Object.entries(from.statuses)) {
    into.statuses[status] = (into.statuses[status] ?? 0) + n;
  }
}

export interface RejectionLogOptions {
  logger: Pick<FastifyBaseLogger, 'info'>;
  maxSources?: number;
  maxLinesPerFlush?: number;
  windowMs?: number;
  now?: () => number;
}

/** Zählt abgelehnte Netzanfragen je Quelle und schreibt höchstens eine Zeile je Quelle und Minute */
export class RejectionLog {
  private readonly buckets = new Map<string, Bucket>();
  private overflow: (Bucket & { sources: number }) | null = null;
  private budgetStart = Number.NEGATIVE_INFINITY;
  private budgetUsed = 0;
  private readonly logger: RejectionLogOptions['logger'];
  private readonly maxSources: number;
  private readonly maxLines: number;
  private readonly windowMs: number;
  private readonly clock: () => number;

  constructor(options: RejectionLogOptions) {
    this.logger = options.logger;
    this.maxSources = options.maxSources ?? REJECTION_MAX_SOURCES;
    this.maxLines = options.maxLinesPerFlush ?? REJECTION_MAX_LINES_PER_FLUSH;
    this.windowMs = options.windowMs ?? REJECTION_WINDOW_MS;
    this.clock = options.now ?? Date.now;
  }

  /** Anzahl der aktuell gezählten Quellen */
  get size(): number {
    return this.buckets.size;
  }

  record(address: string | undefined, status: number): void {
    const now = this.clock();
    const key = sourceKey(address);
    let bucket = this.buckets.get(key);
    if (bucket && now - bucket.windowStart >= this.windowMs) {
      // Fenster dieser Quelle ist um: zusammenfassen (unter dem Zeilenbudget), neues Fenster beginnen
      this.buckets.delete(key);
      this.settle(key, bucket, now);
      bucket = undefined;
    }
    if (!bucket) {
      if (this.buckets.size >= this.maxSources) this.evictOldest(now);
      bucket = newBucket(now);
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    bucket.last = now;
    const code = String(status);
    bucket.statuses[code] = (bucket.statuses[code] ?? 0) + 1;
  }

  /** Schreibt alle abgelaufenen Fenster (`force`: auch laufende, z. B. beim Beenden) */
  flush(force = false): void {
    const now = this.clock();
    for (const [key, bucket] of [...this.buckets]) {
      if (!force && now - bucket.windowStart < this.windowMs) continue;
      this.buckets.delete(key);
      this.settle(key, bucket, now);
    }
    const overflow = this.overflow;
    if (overflow && (force || now - overflow.windowStart >= this.windowMs)) {
      this.overflow = null;
      this.logger.info(
        {
          sources: overflow.sources,
          count: overflow.count,
          statuses: overflow.statuses,
          first: new Date(overflow.first).toISOString(),
          last: new Date(overflow.last).toISOString(),
        },
        'Abgelehnte Netzanfragen weiterer Quellen (zusammengefasst)',
      );
    }
  }

  /** Schreibt die Zeile einer Quelle, solange das Zeilenbudget der Minute reicht, sonst in den Sammelzähler */
  private settle(source: string, bucket: Bucket, now: number): void {
    if (now - this.budgetStart >= this.windowMs) {
      this.budgetStart = now;
      this.budgetUsed = 0;
    }
    if (this.budgetUsed < this.maxLines) {
      this.budgetUsed += 1;
      this.emit(source, bucket);
    } else {
      this.toOverflow(bucket, now);
    }
  }

  private toOverflow(bucket: Bucket, now: number): void {
    this.overflow ??= { ...newBucket(now), sources: 0 };
    merge(this.overflow, bucket);
    this.overflow.sources += 1;
  }

  private evictOldest(now: number): void {
    const oldest = this.buckets.entries().next().value;
    if (!oldest) return;
    const [key, bucket] = oldest;
    this.buckets.delete(key);
    this.toOverflow(bucket, now);
  }

  private emit(source: string, bucket: Bucket): void {
    this.logger.info(
      {
        source,
        count: bucket.count,
        statuses: bucket.statuses,
        first: new Date(bucket.first).toISOString(),
        last: new Date(bucket.last).toISOString(),
      },
      'Abgelehnte Netzanfragen (zusammengefasst)',
    );
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Der Wächter hat diese Anfrage durchgelassen (Netzanfragen werden nur dann einzeln geloggt) */
    sgAdmitted?: boolean;
    /** Die Ablehnung wurde schon gezählt (nicht noch einmal in `onResponse`) */
    sgRejectionCounted?: boolean;
  }
}

/**
 * Fastifys Request-Log, aber still für Netzanfragen, die der Wächter (noch) nicht durchgelassen hat.
 * Für angenommene Netzanfragen schreibt `registerSecurity` die Zeile `incoming request` nach dem Wächter selbst.
 * Lokale Anfragen loggen unverändert.
 */
export class RequestLogController extends LogController {
  override isLogDisabled(req: object): boolean {
    const request = req as FastifyRequest;
    // Nur über `isLocalRequest`: Tunnel-Anfragen sind nie lokal (UX-12, B17)
    if (request.socket && isLocalRequest(request)) return false;
    return request.sgAdmitted !== true;
  }
}

/** Legt den Zähler an: Zusammenfassungen alle 15 s fällig prüfen, beim Beenden alles schreiben */
export function createRejectionLog(
  app: FastifyInstance,
  options: Partial<RejectionLogOptions> = {},
): RejectionLog {
  const log = new RejectionLog({ logger: app.log, ...options });
  const timer = setInterval(() => log.flush(), 15_000);
  timer.unref();
  app.addHook('onClose', async () => {
    clearInterval(timer);
    log.flush(true);
  });
  return log;
}
