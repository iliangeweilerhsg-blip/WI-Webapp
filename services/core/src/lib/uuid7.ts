import { randomBytes } from 'node:crypto';

let lastMs = 0;
let counter = 0;

/**
 * UUIDv7 (RFC 9562): 48 Bit Unix-Millisekunden, danach 12 Bit Zähler (rand_a) und 62 Bit Zufall.
 * Innerhalb derselben Millisekunde wächst der Zähler, so bleibt die Reihenfolge der IDs stabil
 * (03 §1: „zeitlich sortierbar“).
 */
export function uuidv7(now: number = Date.now()): string {
  let ms = now;
  if (ms <= lastMs) {
    // Uhr stand still oder lief rückwärts: Zeit festhalten und Zähler erhöhen
    ms = lastMs;
    counter += 1;
    if (counter > 0xfff) {
      ms += 1;
      counter = 0;
    }
  } else {
    counter = randomBytes(2).readUInt16BE(0) & 0x1ff; // Start niedrig, damit Platz zum Zählen bleibt
  }
  lastMs = ms;

  const bytes = randomBytes(16);
  bytes[0] = Math.floor(ms / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(ms / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(ms / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(ms / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(ms / 2 ** 8) & 0xff;
  bytes[5] = ms & 0xff;
  bytes[6] = 0x70 | ((counter >> 8) & 0x0f); // Version 7
  bytes[7] = counter & 0xff;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // Variante 10

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Zeitstempel (ms) aus einer UUIDv7 */
export function uuidv7Time(id: string): number {
  return Number.parseInt(id.replaceAll('-', '').slice(0, 12), 16);
}
