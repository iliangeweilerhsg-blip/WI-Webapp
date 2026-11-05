// Kopplung (VERTRAEGE §12, F-INK-13): Kopplungsfenster, Anfragen, Fehlversuche, Sperre und Rate-Limit.
//
// Alles lebt nur im Speicher des Core-Prozesses (§12 Schritt 5): Code, Fenster, Zähler. Alle Prüfungen und
// Zählerstände ändern sich synchron, ohne `await` dazwischen. Gleichzeitige Anfragen sehen darum immer einen
// konsistenten Stand (genau ein `confirm` gewinnt, kein Zähler wird übersprungen).
//
// Schutz gegen Blockade (DoS, Nachtrag in §12): Das Fenster hat zwei Kennungen.
// - `pairingId` (geheim, 122 Bit Zufall): steht nur im QR-Code und in der lokalen Web-App.
// - `publicId`: bekommt jeder, der `pair/start` aufruft (Bonjour-Weg und manuelle Eingabe).
// Fehlversuche über die öffentliche Kennung verbrauchen nur deren Budget. Ist es aufgebraucht, schließt nur der
// Weg über `pair/start`; der QR-Weg bleibt offen, weil ein Angreifer im Netz die geheime Kennung nicht kennt.
import { randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { DeviceKind, PairingRequest, PairStartResponse } from '@sg/shared';
import { HttpError } from '../errors.ts';
import { uuidv7 } from '../lib/uuid7.ts';

export const PAIRING_WINDOW_MS = 5 * 60_000;
/** Offene (nicht abgelehnte) Anfragen pro Fenster */
export const MAX_OPEN_REQUESTS = 10;
/** Falsche Codes pro Nonce, danach wird diese Nonce abgewiesen */
export const MAX_FAILURES_PER_NONCE = 5;
/** Falsche Codes pro Fenster und Weg (öffentlich bzw. QR), danach schließt dieser Weg */
export const MAX_FAILURES_PER_WINDOW = 20;
/** Mehr als so viele falsche Codes pro Stunde sperren alle `pair/*`-Aufrufe (423) */
export const MAX_FAILURES_PER_HOUR = 20;
/** `pair/*`-Aufrufe pro Absenderadresse (IPv6: /64-Netz) und Minute */
export const RATE_LIMIT_PER_MINUTE = 10;
/** So viele Absenderadressen merkt sich das Rate-Limit höchstens (Speichergrenze) */
export const MAX_TRACKED_ADDRESSES = 4096;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * Zustand des Fensters für die Web-App (Header `SG-Pairing-State` an `GET /devices/pairings/requests`):
 * - `none`: nie geöffnet (seit dem Start des Core)
 * - `open`: offen, beide Wege
 * - `qr_only`: zu viele Fehlversuche über `pair/start`, nur noch der QR-Weg ist offen
 * - `confirming`: ein richtiger Code wird gerade eingelöst, das Fenster ist für alle anderen zu. Danach `paired`;
 *   scheitert das Anlegen, wieder `open` bzw. `qr_only`, `closed` (währenddessen geschlossen) oder `expired`
 *   (währenddessen abgelaufen)
 * - `expired`: 5 min abgelaufen
 * - `paired`: ein Gerät wurde gekoppelt, Fenster geschlossen
 * - `closed_failures`: zu viele Fehlversuche über den QR-Weg, Fenster geschlossen
 * - `closed`: am Mac geschlossen (`DELETE /devices/pairings`)
 * - `locked`: globale Sperre (423), bis ein neues Fenster geöffnet wird
 */
export type PairingState =
  'none' | 'open' | 'qr_only' | 'confirming' | 'expired' | 'paired' | 'closed_failures' | 'closed' | 'locked';

/** Weg einer Bestätigung: über die geheime Kennung (QR) oder die öffentliche (`pair/start`) */
export type PairingPath = 'qr' | 'public';

interface StoredRequest {
  requestId: string;
  nonce: string;
  deviceName: string;
  kind: DeviceKind;
  requestedAt: number;
  rejected: boolean;
}

interface PairingWindow {
  pairingId: string;
  publicId: string;
  code: string;
  openedAt: number;
  expiresAt: number;
  /** `confirming`: ein richtiger Code wird gerade eingelöst (Gerät wird angelegt) */
  closed: null | 'confirming' | 'paired' | 'failures' | 'cancelled';
  /** `close()` kam während `confirming`: `abort()` lässt das Fenster dann zu, statt es zu öffnen */
  closePending: boolean;
  publicClosed: boolean;
  failures: Record<PairingPath, number>;
  nonceFailures: Map<string, number>;
  requests: Map<string, StoredRequest>;
  requestByNonce: Map<string, string>;
  rejectedNonces: Set<string>;
}

export interface OpenedWindow {
  pairingId: string;
  code: string;
  expiresAt: Date;
}

/** Ergebnis eines richtigen Codes: Gerät anlegen, dann `commit()`; schlägt das fehl, `abort()` */
export interface ConfirmGrant {
  path: PairingPath;
  commit: () => void;
  abort: () => void;
}

const errors = {
  rateLimited: () =>
    new HttpError(429, 'pairing_rate_limited', 'Zu viele Kopplungsversuche. Bitte eine Minute warten.'),
  locked: () =>
    new HttpError(
      423,
      'pairing_locked',
      'Die Kopplung ist nach vielen Fehlversuchen gesperrt. Öffne am Mac ein neues Kopplungsfenster.',
    ),
  windowClosed: () =>
    new HttpError(409, 'pairing_window_closed', 'Es ist kein Kopplungsfenster offen. Öffne es am Mac.'),
  codeInvalid: () => new HttpError(403, 'pairing_code_invalid', 'Der Code stimmt nicht.'),
  rejected: () =>
    new HttpError(403, 'pairing_request_rejected', 'Diese Kopplungsanfrage wurde am Mac abgelehnt.'),
  full: () =>
    new HttpError(
      429,
      'pairing_requests_full',
      'Es warten schon zu viele Kopplungsanfragen. Lehne am Mac eine ab oder öffne ein neues Fenster.',
    ),
  requestNotFound: () =>
    new HttpError(404, 'pairing_request_not_found', 'Diese Kopplungsanfrage gibt es nicht (mehr).'),
};

/** Vergleich in konstanter Zeit (für gleich lange Werte). Unterschiedliche Länge → false */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** 6 Ziffern aus `crypto.randomInt`, gleichverteilt, führende Nullen erlaubt */
export function generatePairingCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * Schlüssel fürs Rate-Limit: IPv4 (auch als `::ffff:a.b.c.d`) bleibt, wie es ist. IPv6 wird auf sein /64-Netz
 * gekürzt, weil ein Gerät dort beliebig viele Adressen hat.
 */
export function rateLimitKey(address: string | undefined): string {
  if (!address) return 'unbekannt';
  const lower = address.toLowerCase().split('%')[0] ?? '';
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower);
  if (mapped?.[1]) return mapped[1];
  if (!lower.includes(':')) return lower;
  const halves = lower.split('::');
  if (halves.length > 2) return lower;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return lower;
  const groups = [...head, ...Array<string>(missing).fill('0'), ...tail];
  const prefix = groups.slice(0, 4).map((g) => {
    const n = Number.parseInt(g, 16);
    return Number.isNaN(n) ? g : n.toString(16);
  });
  return `${prefix.join(':')}::/64`;
}

/**
 * Zeichen, die einen Gerätenamen in der Anzeige verfälschen oder unsichtbar verlängern: Steuerzeichen (Cc), Format-
 * zeichen (Cf: Bidi-Steuerung, U+200B–U+200D, U+061C, U+2060, U+FEFF, Tag-Zeichen) sowie Zeilen- und
 * Absatztrenner (Zl, Zp). Dazu Default_Ignorable_Code_Point (U+3164, U+FFA0 nach NFKC U+1160, Variation Selectors …)
 * und U+2800 (Braille-Leerzeichen).
 */
const UNSAFE_NAME_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u2800]/gu;
/** Ein Name braucht mindestens ein sichtbares Zeichen: Buchstabe, Ziffer, Satz- oder sonstiges Symbol */
const VISIBLE_CHAR = /[\p{L}\p{N}\p{P}\p{S}]/u;
/** Mehr als 2 Kombinationszeichen hintereinander („Zalgo“) werden auf 2 gekürzt */
const EXCESS_MARKS = /(\p{M}{2})\p{M}+/gu;

/** Freitext eines Geräts für Anzeige und Speicherung: NFKC, ohne unsichtbare Zeichen, Leerraum zusammengefasst, gekürzt */
export function cleanDeviceText(text: string, maxLength: number): string | null {
  // Erst Leerraum (auch Tab und Zeilentrenner) zu einem Leerzeichen, dann unsichtbare Zeichen entfernen
  const cleaned = text
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .replace(UNSAFE_NAME_CHARS, '')
    .replace(EXCESS_MARKS, '$1')
    .replace(/ {2,}/g, ' ')
    .trim();
  if (!VISIBLE_CHAR.test(cleaned)) return null;
  // Nach Codepoints kürzen, damit kein halbes Surrogat-Paar übrig bleibt
  return [...cleaned].slice(0, maxLength).join('').trim();
}

/** Gerätename (höchstens 64 Zeichen wie im Schema). Leer → null */
export function cleanDeviceName(name: string): string | null {
  return cleanDeviceText(name, 64);
}

export interface PairingManagerOptions {
  now?: () => number;
}

export class PairingManager {
  private window: PairingWindow | null = null;
  private failureTimes: number[] = [];
  private locked = false;
  private readonly calls = new Map<string, number[]>();
  private readonly now: () => number;

  constructor(options: PairingManagerOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  /**
   * Öffnet ein neues Fenster (nur lokal, `POST /devices/pairings`). Ersetzt ein altes samt Anfragen und setzt
   * die Zähler pro Nonce, pro Fenster und global sowie die Sperre zurück (§12 Schritt 4).
   */
  open(): OpenedWindow {
    const now = this.now();
    this.window = {
      pairingId: randomUUID(),
      publicId: randomUUID(),
      code: generatePairingCode(),
      openedAt: now,
      expiresAt: now + PAIRING_WINDOW_MS,
      closed: null,
      closePending: false,
      publicClosed: false,
      failures: { qr: 0, public: 0 },
      nonceFailures: new Map(),
      requests: new Map(),
      requestByNonce: new Map(),
      rejectedNonces: new Set(),
    };
    this.failureTimes = [];
    this.locked = false;
    return {
      pairingId: this.window.pairingId,
      code: this.window.code,
      expiresAt: new Date(this.window.expiresAt),
    };
  }

  /**
   * `DELETE /devices/pairings` (nur lokal): schließt das offene Fenster sofort und verwirft seine Anfragen.
   * Idempotent. Mit `pairingId` nur, wenn es genau dieses Fenster ist (ein anderer Tab hat evtl. ein neues
   * geöffnet). Ein Code, der gerade eingelöst wird (`confirming`), läuft zu Ende. Sperre und Zähler bleiben.
   */
  close(pairingId?: string): void {
    const w = this.window;
    if (!w || (w.closed !== null && w.closed !== 'confirming')) return;
    if (pairingId !== undefined && !safeEqual(pairingId, w.pairingId)) return;
    if (w.closed === 'confirming') {
      // Das Schließen nicht verlieren: scheitert das Anlegen, schließt `abort()` das Fenster
      w.closePending = true;
      return;
    }
    w.closed = 'cancelled';
    w.code = '';
    w.requests.clear();
    w.requestByNonce.clear();
  }

  /** Zustand für die Web-App (siehe `PairingState`) und die geheime Kennung des aktuellen Fensters */
  status(): { state: PairingState; pairingId: string | null } {
    const w = this.window;
    const pairingId = w?.pairingId ?? null;
    if (this.locked) return { state: 'locked', pairingId };
    if (!w) return { state: 'none', pairingId };
    if (w.closed === 'paired') return { state: 'paired', pairingId };
    if (w.closed === 'failures') return { state: 'closed_failures', pairingId };
    if (w.closed === 'cancelled') return { state: 'closed', pairingId };
    // Vor dem Ablauf prüfen: Ein Code, der vor Ablauf richtig war, wird noch eingelöst (#100, H-4)
    if (w.closed === 'confirming') return { state: 'confirming', pairingId };
    if (this.now() >= w.expiresAt) {
      w.code = '';
      return { state: 'expired', pairingId };
    }
    if (w.publicClosed) return { state: 'qr_only', pairingId };
    return { state: 'open', pairingId };
  }

  /** Offene (nicht abgelehnte) Anfragen des aktuellen Fensters, älteste zuerst. Ohne offenes Fenster leer */
  listRequests(): PairingRequest[] {
    const w = this.activeWindow();
    if (!w) return [];
    return [...w.requests.values()]
      .filter((r) => !r.rejected)
      .sort((a, b) => a.requestedAt - b.requestedAt)
      .map((r) => this.toRequest(w, r));
  }

  /**
   * `POST /devices/pair/start`. Rückgabe: Antwort und – nur bei einer neuen Anfrage – die Nutzlast für
   * `pairing.requested`. Wiederholt ein Gerät den Aufruf mit derselben Nonce, bekommt es dieselbe Anfrage
   * zurück (auch eine abgelehnte: deren `confirm` scheitert dann mit `pairing_request_rejected`).
   */
  start(
    input: { device_name: string; kind: DeviceKind; public_nonce: string },
    address: string | undefined,
  ): { response: PairStartResponse; created: PairingRequest | null } {
    this.hit(address);
    if (this.locked) throw errors.locked();
    const w = this.activeWindow();
    if (!w || w.publicClosed) throw errors.windowClosed();

    const existingId = w.requestByNonce.get(input.public_nonce);
    const existing = existingId ? w.requests.get(existingId) : undefined;
    if (existing) return { response: this.toStartResponse(w, existing), created: null };

    const open = [...w.requests.values()].filter((r) => !r.rejected).length;
    if (open >= MAX_OPEN_REQUESTS) throw errors.full();

    const request: StoredRequest = {
      requestId: uuidv7(),
      nonce: input.public_nonce,
      deviceName: cleanDeviceName(input.device_name) ?? 'Unbenanntes Gerät',
      kind: input.kind,
      requestedAt: this.now(),
      rejected: false,
    };
    w.requests.set(request.requestId, request);
    w.requestByNonce.set(request.nonce, request.requestId);
    return { response: this.toStartResponse(w, request), created: this.toRequest(w, request) };
  }

  /** `DELETE /devices/pairings/requests/{id}` (nur lokal): Anfrage ablehnen, ihre Nonce wird abgewiesen */
  reject(requestId: string): void {
    const w = this.activeWindow();
    const request = w?.requests.get(requestId);
    if (!w || !request || request.rejected) throw errors.requestNotFound();
    request.rejected = true;
    w.rejectedNonces.add(request.nonce);
  }

  /**
   * `POST /devices/pair/confirm`, erster Teil: prüft Rate-Limit, Sperre, Fenster, Nonce und Code.
   * Falscher Code: zählt pro Nonce, pro Weg und global und wirft 403 `pairing_code_invalid`.
   * Richtiger Code: das Fenster ist ab sofort für alle anderen zu (`confirming`). Der Aufrufer legt das Gerät an
   * und ruft danach `commit()`; scheitert das, öffnet `abort()` das Fenster wieder.
   */
  beginConfirm(
    input: { pairing_id: string; code: string; public_nonce: string },
    address: string | undefined,
  ): ConfirmGrant {
    this.hit(address);
    if (this.locked) throw errors.locked();
    const w = this.activeWindow();
    if (!w) throw errors.windowClosed();

    // Beide Vergleiche laufen immer (konstante Zeit, keine Abkürzung über die öffentliche Kennung)
    const isQr = safeEqual(input.pairing_id, w.pairingId);
    const isPublic = safeEqual(input.pairing_id, w.publicId);
    const path: PairingPath | null = isQr ? 'qr' : isPublic ? 'public' : null;
    // Unbekannte Kennung zählt nicht zum Budget (§12 Schritt 4)
    if (!path) throw errors.windowClosed();
    if (path === 'public' && w.publicClosed) throw errors.windowClosed();
    // Abgelehnte Nonce: abweisen, zählt nicht
    if (w.rejectedNonces.has(input.public_nonce)) throw errors.rejected();
    // Nonce mit 5 Fehlversuchen: abweisen wie einen falschen Code, ohne den Code zu prüfen
    if ((w.nonceFailures.get(input.public_nonce) ?? 0) >= MAX_FAILURES_PER_NONCE) throw errors.codeInvalid();

    if (!safeEqual(input.code, w.code)) {
      this.recordFailure(w, path, input.public_nonce);
      throw errors.codeInvalid();
    }

    w.closed = 'confirming';
    return {
      path,
      commit: () => {
        if (w.closed === 'confirming') {
          w.closed = 'paired';
          w.code = '';
        }
      },
      abort: () => {
        if (w.closed !== 'confirming') return;
        if (w.closePending) {
          w.closed = 'cancelled';
          w.code = '';
          w.requests.clear();
          w.requestByNonce.clear();
        } else {
          w.closed = null;
        }
      },
    };
  }

  private recordFailure(w: PairingWindow, path: PairingPath, nonce: string): void {
    const now = this.now();
    w.nonceFailures.set(nonce, (w.nonceFailures.get(nonce) ?? 0) + 1);
    w.failures[path] += 1;
    if (path === 'public' && w.failures.public >= MAX_FAILURES_PER_WINDOW) w.publicClosed = true;
    if (path === 'qr' && w.failures.qr >= MAX_FAILURES_PER_WINDOW) {
      w.closed = 'failures';
      w.code = '';
    }
    this.failureTimes = this.failureTimes.filter((t) => now - t < HOUR_MS);
    this.failureTimes.push(now);
    if (this.failureTimes.length > MAX_FAILURES_PER_HOUR) this.locked = true;
  }

  /** Das aktuelle Fenster, wenn es offen und nicht abgelaufen ist */
  private activeWindow(): PairingWindow | null {
    const w = this.window;
    if (!w || w.closed !== null) return null;
    if (this.now() >= w.expiresAt) {
      w.code = '';
      return null;
    }
    return w;
  }

  /** Rate-Limit pro Absenderadresse: höchstens 10 `pair/*`-Aufrufe pro Minute (abgelehnte zählen nicht mit) */
  private hit(address: string | undefined): void {
    const now = this.now();
    const key = rateLimitKey(address);
    const recent = (this.calls.get(key) ?? []).filter((t) => now - t < MINUTE_MS);
    if (recent.length >= RATE_LIMIT_PER_MINUTE) {
      this.calls.set(key, recent);
      throw errors.rateLimited();
    }
    recent.push(now);
    this.calls.delete(key);
    this.calls.set(key, recent);
    if (this.calls.size > MAX_TRACKED_ADDRESSES) this.pruneCalls(now);
  }

  private pruneCalls(now: number): void {
    for (const [key, times] of this.calls) {
      if (times.every((t) => now - t >= MINUTE_MS)) this.calls.delete(key);
    }
    // Immer noch zu viele: die am längsten ruhigen zuerst vergessen (Map hält die Einfügereihenfolge)
    for (const key of this.calls.keys()) {
      if (this.calls.size <= MAX_TRACKED_ADDRESSES) break;
      this.calls.delete(key);
    }
  }

  private toRequest(w: PairingWindow, r: StoredRequest): PairingRequest {
    return {
      request_id: r.requestId,
      pairing_id: w.publicId,
      device_name: r.deviceName,
      kind: r.kind,
      requested_at: new Date(r.requestedAt).toISOString(),
    };
  }

  private toStartResponse(w: PairingWindow, r: StoredRequest): PairStartResponse {
    return {
      request_id: r.requestId,
      pairing_id: w.publicId,
      expires_at: new Date(w.expiresAt).toISOString(),
    };
  }
}
