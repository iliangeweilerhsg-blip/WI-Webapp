// Zustand des Moodle-Zugangs (F-MDL-01, GET /moodle/status)
import type { MoodleConnectionState, MoodleStatus } from '@sg/shared';
import { HttpError } from '../errors.ts';
import { moodleNotConfigured, type MoodleClient } from './client.ts';
import type { MoodleMeta } from './meta.ts';

/** Ab so vielen Resttagen gilt der Token als „läuft bald ab“ */
export const EXPIRY_WARNING_DAYS = 7;
/** `core_webservice_get_site_info` höchstens so oft (08 §9.2) */
export const STATUS_CACHE_MS = 5 * 60 * 1000;
/** „Nicht erreichbar“ und „ungültig“ nur kurz merken: Ausfall oder neuer Token wirken so schnell */
export const UNREACHABLE_CACHE_MS = 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

export type MoodleCheckResult = 'ok' | 'invalid' | 'unreachable' | 'not_configured';

/** Ganze Tage von `today` (UTC-Tag) bis `validUntil` (Datum), negativ = vorbei */
export function daysUntil(validUntil: string, today: Date): number {
  const end = Date.parse(`${validUntil}T00:00:00Z`);
  const start = Date.parse(`${today.toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.round((end - start) / DAY_MS);
}

/**
 * Leitet den Zustand ab. Moodle hat das letzte Wort: Ein Token, den Moodle annimmt, ist nie
 * `abgelaufen`, auch wenn das eingetragene Datum vorbei ist (dann `laeuft_bald_ab`).
 */
export function computeState(
  check: MoodleCheckResult,
  validUntil: string | null,
  today: Date,
): MoodleConnectionState {
  if (check === 'not_configured') return 'nicht_eingerichtet';
  const days = validUntil ? daysUntil(validUntil, today) : null;
  if (check === 'invalid') return days !== null && days < 0 ? 'abgelaufen' : 'ungueltig';
  if (check === 'unreachable') return 'nicht_erreichbar';
  return days !== null && days <= EXPIRY_WARNING_DAYS ? 'laeuft_bald_ab' : 'ok';
}

interface SiteInfo {
  sitename?: unknown;
  fullname?: unknown;
  userid?: unknown;
  functions?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface CachedCheck {
  check: MoodleCheckResult;
  siteName: string | null;
  userFullname: string | null;
  userId: number | null;
  functions: ReadonlySet<string> | null;
  checkedAt: Date;
}

export interface MoodleStatusServiceOptions {
  client: MoodleClient;
  readMeta: () => Promise<MoodleMeta>;
  now?: () => Date;
  cacheMs?: number;
}

export class MoodleStatusService {
  private readonly client: MoodleClient;
  private readonly readMeta: () => Promise<MoodleMeta>;
  private readonly now: () => Date;
  private readonly cacheMs: number;
  private cached: CachedCheck | null = null;
  private pending: Promise<CachedCheck> | null = null;
  private pendingRecheck: Promise<MoodleStatus> | null = null;
  /** Zählt Verwerfungen des Zwischenspeichers: Ein Lauf mit altem Stand darf ihn nicht mehr füllen */
  private epoch = 0;

  constructor(options: MoodleStatusServiceOptions) {
    this.client = options.client;
    this.readMeta = options.readMeta;
    this.now = options.now ?? (() => new Date());
    this.cacheMs = options.cacheMs ?? STATUS_CACHE_MS;
    // Lehnt Moodle den Token bei irgendeinem Aufruf ab, gilt der Status sofort als veraltet
    this.client.onTokenRejected(() => this.invalidate());
  }

  /** Nächste Abfrage geht wieder an Moodle (z. B. nach neuem Token) */
  invalidate(): void {
    this.cached = null;
  }

  /**
   * Token-Cache und Status-Cache leeren und den Zustand neu holen (`POST /moodle/recheck`). Gleichzeitige
   * Aufrufe teilen sich einen Lauf. Löst keinen Abgleich und keine Moodle-Aktion aus.
   */
  recheck(): Promise<MoodleStatus> {
    this.pendingRecheck ??= this.runRecheck().finally(() => {
      this.pendingRecheck = null;
    });
    return this.pendingRecheck;
  }

  private async runRecheck(): Promise<MoodleStatus> {
    this.epoch += 1;
    this.cached = null;
    // Ein noch laufender Aufruf mit dem alten Token zählt nicht
    this.pending = null;
    this.client.resetToken();
    return this.getStatus();
  }

  async getStatus(): Promise<MoodleStatus> {
    const [check, meta] = await Promise.all([this.check(), this.readMeta()]);
    const validUntil = meta.token_valid_until ?? null;
    const configured = check.check !== 'not_configured';
    return {
      state: computeState(check.check, validUntil, this.now()),
      site_url: this.client.baseUrl || null,
      site_name: check.siteName,
      user_fullname: check.userFullname,
      token_valid_until: configured ? validUntil : null,
      checked_at: configured ? check.checkedAt.toISOString() : null,
    };
  }

  /** Für den Token freigegebene Moodle-Funktionen, null = unbekannt (Moodle aus oder nicht erreichbar) */
  async availableFunctions(): Promise<ReadonlySet<string> | null> {
    return (await this.check()).functions;
  }

  /** Moodle-Nutzer-ID aus `core_webservice_get_site_info` */
  async userId(): Promise<number> {
    const check = await this.check();
    // Gleiche Fehler wie ein direkter Moodle-Aufruf, nicht pauschal „nicht erreichbar“
    if (check.check === 'not_configured') throw moodleNotConfigured();
    if (check.check === 'invalid') {
      throw new HttpError(
        409,
        'moodle_token_invalid',
        'Moodle lehnt den Token ab. Bitte den Token erneuern (docs/anleitungen/MOODLE-TOKEN.md).',
      );
    }
    if (check.userId === null) {
      throw new HttpError(502, 'moodle_unreachable', 'Moodle ist nicht erreichbar.', {
        reason: 'no_site_info',
      });
    }
    return check.userId;
  }

  private async check(): Promise<CachedCheck> {
    const now = this.now();
    if (this.cached) {
      const ttl = this.cached.check === 'ok' ? this.cacheMs : Math.min(this.cacheMs, UNREACHABLE_CACHE_MS);
      if (now.getTime() - this.cached.checkedAt.getTime() < ttl) return this.cached;
    }
    // Gleichzeitige Anfragen teilen sich einen Aufruf
    if (!this.pending) {
      const run: Promise<CachedCheck> = this.fetchCheck().finally(() => {
        if (this.pending === run) this.pending = null;
      });
      this.pending = run;
    }
    return this.pending;
  }

  private async fetchCheck(): Promise<CachedCheck> {
    const empty = { siteName: null, userFullname: null, userId: null, functions: null };
    const checkedAt = this.now();
    const epoch = this.epoch;
    if (!(await this.client.isConfigured())) {
      // Nicht zwischenspeichern: Nach `security add-generic-password` soll der Zugang sofort gehen
      return { check: 'not_configured', ...empty, checkedAt };
    }
    let result: CachedCheck;
    try {
      const raw = await this.client.read<unknown>('core_webservice_get_site_info');
      if (!isRecord(raw)) {
        // Keine Seiteninfo (z. B. `null` von einem Proxy): wie nicht erreichbar, nur kurz gemerkt
        result = { check: 'unreachable', ...empty, checkedAt };
      } else {
        const info = raw as SiteInfo;
        // Einträge defensiv lesen: `[null]` oder Zahlen in der Liste dürfen nicht zum 500 führen
        const functions = Array.isArray(info.functions)
          ? new Set(
              info.functions
                .map((entry: unknown) => (isRecord(entry) ? entry.name : undefined))
                .filter((name): name is string => typeof name === 'string'),
            )
          : null;
        result = {
          check: 'ok',
          siteName: typeof info.sitename === 'string' ? info.sitename : null,
          userFullname: typeof info.fullname === 'string' ? info.fullname : null,
          // Nur echte Moodle-Nutzer-IDs: ganze Zahl > 0 (kein 0, -1, 1.5, NaN, Text)
          userId:
            typeof info.userid === 'number' && Number.isInteger(info.userid) && info.userid > 0
              ? info.userid
              : null,
          functions,
          checkedAt,
        };
      }
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      const check: MoodleCheckResult =
        error.code === 'moodle_token_invalid'
          ? 'invalid'
          : error.code === 'moodle_not_configured'
            ? 'not_configured'
            : 'unreachable';
      result = { check, ...empty, checkedAt };
    }
    if (epoch === this.epoch) this.cached = result;
    return result;
  }
}
