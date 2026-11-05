// Kopplung im Speicher (VERTRAEGE §12): Fenster, Budgets, Sperre, Rate-Limit, Schutz des QR-Wegs
import { describe, expect, it } from 'vitest';
import { HttpError } from '../../src/errors.ts';
import {
  cleanDeviceName,
  cleanDeviceText,
  generatePairingCode,
  MAX_TRACKED_ADDRESSES,
  PAIRING_WINDOW_MS,
  PairingManager,
  rateLimitKey,
} from '../../src/services/pairing.ts';

const NONCE = (n: number) => `nonce-${String(n).padStart(20, '0')}`;

function setup() {
  const clock = { now: Date.parse('2026-11-05T10:00:00Z') };
  const pm = new PairingManager({ now: () => clock.now });
  return { clock, pm };
}

/** Jeder Aufruf von einer eigenen Adresse, damit das Rate-Limit (10/min) nicht stört */
let ipCounter = 0;
const freshIp = () => `10.1.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

function codeOf(e: unknown): string {
  if (!(e instanceof HttpError)) throw e;
  return `${e.statusCode} ${e.code}`;
}

function fails(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return codeOf(e);
  }
  throw new Error('kein Fehler');
}

function wrong(code: string): string {
  return code === '000000' ? '000001' : '000000';
}

function startPublic(pm: PairingManager, nonce = NONCE(0)): string {
  return pm.start({ device_name: 'iPad', kind: 'ipad', public_nonce: nonce }, freshIp()).response.pairing_id;
}

describe('Code', () => {
  it('hat immer 6 Ziffern', () => {
    for (let i = 0; i < 500; i++) expect(generatePairingCode()).toMatch(/^[0-9]{6}$/);
  });
});

describe('Fenster', () => {
  it('ohne Fenster: start und confirm → 409, Zustand none', () => {
    const { pm } = setup();
    expect(pm.status().state).toBe('none');
    expect(fails(() => startPublic(pm))).toBe('409 pairing_window_closed');
    expect(
      fails(() =>
        pm.beginConfirm(
          { pairing_id: crypto.randomUUID(), code: '123456', public_nonce: NONCE(1) },
          freshIp(),
        ),
      ),
    ).toBe('409 pairing_window_closed');
  });

  it('läuft nach 5 min ab', () => {
    const { pm, clock } = setup();
    const w = pm.open();
    expect(w.expiresAt.getTime() - clock.now).toBe(PAIRING_WINDOW_MS);
    clock.now += PAIRING_WINDOW_MS - 1;
    expect(pm.status().state).toBe('open');
    clock.now += 1;
    expect(pm.status().state).toBe('expired');
    expect(fails(() => startPublic(pm))).toBe('409 pairing_window_closed');
    expect(
      fails(() =>
        pm.beginConfirm({ pairing_id: w.pairingId, code: w.code, public_nonce: NONCE(1) }, freshIp()),
      ),
    ).toBe('409 pairing_window_closed');
  });

  it('ein neues Fenster ersetzt das alte (alte Kennung und alter Code gelten nicht mehr)', () => {
    const { pm } = setup();
    const old = pm.open();
    const neu = pm.open();
    expect(neu.pairingId).not.toBe(old.pairingId);
    expect(
      fails(() =>
        pm.beginConfirm({ pairing_id: old.pairingId, code: old.code, public_nonce: NONCE(1) }, freshIp()),
      ),
    ).toBe('409 pairing_window_closed');
  });

  it('die öffentliche Kennung aus pair/start ist nicht die geheime aus dem QR-Code', () => {
    const { pm } = setup();
    const w = pm.open();
    const publicId = startPublic(pm);
    expect(publicId).not.toBe(w.pairingId);
    expect(pm.listRequests()[0]?.pairing_id).toBe(publicId);
  });

  it('richtiger Code über beide Wege; danach ist das Fenster zu', () => {
    for (const via of ['qr', 'public'] as const) {
      const { pm } = setup();
      const w = pm.open();
      const id = via === 'qr' ? w.pairingId : startPublic(pm);
      const grant = pm.beginConfirm({ pairing_id: id, code: w.code, public_nonce: NONCE(1) }, freshIp());
      expect(grant.path).toBe(via);
      grant.commit();
      expect(pm.status().state).toBe('paired');
      expect(
        fails(() => pm.beginConfirm({ pairing_id: id, code: w.code, public_nonce: NONCE(2) }, freshIp())),
      ).toBe('409 pairing_window_closed');
    }
  });

  it('gleichzeitige Bestätigungen: genau eine gewinnt; scheitert das Anlegen, ist das Fenster wieder offen', () => {
    const { pm } = setup();
    const w = pm.open();
    const first = pm.beginConfirm(
      { pairing_id: w.pairingId, code: w.code, public_nonce: NONCE(1) },
      freshIp(),
    );
    expect(
      fails(() =>
        pm.beginConfirm({ pairing_id: w.pairingId, code: w.code, public_nonce: NONCE(2) }, freshIp()),
      ),
    ).toBe('409 pairing_window_closed');
    first.abort();
    const second = pm.beginConfirm(
      { pairing_id: w.pairingId, code: w.code, public_nonce: NONCE(2) },
      freshIp(),
    );
    second.commit();
    expect(pm.status().state).toBe('paired');
  });
});

describe('Fehlversuche (§12 Schritt 4)', () => {
  it('pro Nonce: nach 5 falschen Codes wird die Nonce abgewiesen, auch mit richtigem Code', () => {
    const { pm } = setup();
    const w = pm.open();
    const id = startPublic(pm);
    for (let i = 0; i < 5; i++) {
      expect(
        fails(() =>
          pm.beginConfirm({ pairing_id: id, code: wrong(w.code), public_nonce: NONCE(1) }, freshIp()),
        ),
      ).toBe('403 pairing_code_invalid');
    }
    // Gleiche Antwort wie ein falscher Code: verrät nicht, dass der Code jetzt richtig wäre
    expect(
      fails(() => pm.beginConfirm({ pairing_id: id, code: w.code, public_nonce: NONCE(1) }, freshIp())),
    ).toBe('403 pairing_code_invalid');
    // Andere Geräte sind nicht betroffen
    pm.beginConfirm({ pairing_id: id, code: w.code, public_nonce: NONCE(2) }, freshIp()).commit();
  });

  it('Fehlversuche über pair/start schließen nach 20 nur diesen Weg, der QR-Weg bleibt offen (DoS-Schutz)', () => {
    const { pm } = setup();
    const w = pm.open();
    const publicId = startPublic(pm);
    for (let i = 0; i < 20; i++) {
      expect(
        fails(() =>
          pm.beginConfirm(
            { pairing_id: publicId, code: wrong(w.code), public_nonce: NONCE(100 + i) },
            freshIp(),
          ),
        ),
      ).toBe('403 pairing_code_invalid');
    }
    expect(pm.status().state).toBe('qr_only');
    expect(fails(() => startPublic(pm, NONCE(500)))).toBe('409 pairing_window_closed');
    expect(
      fails(() =>
        pm.beginConfirm({ pairing_id: publicId, code: w.code, public_nonce: NONCE(501) }, freshIp()),
      ),
    ).toBe('409 pairing_window_closed');
    expect(pm.listRequests()).toHaveLength(1);
    // Das echte iPad scannt den QR-Code: klappt
    pm.beginConfirm({ pairing_id: w.pairingId, code: w.code, public_nonce: NONCE(502) }, freshIp()).commit();
    expect(pm.status().state).toBe('paired');
  });

  it('20 falsche Codes über den QR-Weg schließen das Fenster', () => {
    const { pm } = setup();
    const w = pm.open();
    for (let i = 0; i < 20; i++) {
      fails(() =>
        pm.beginConfirm({ pairing_id: w.pairingId, code: wrong(w.code), public_nonce: NONCE(i) }, freshIp()),
      );
    }
    expect(pm.status().state).toBe('closed_failures');
    expect(
      fails(() =>
        pm.beginConfirm({ pairing_id: w.pairingId, code: w.code, public_nonce: NONCE(99) }, freshIp()),
      ),
    ).toBe('409 pairing_window_closed');
  });

  it('global: mehr als 20 falsche Codes pro Stunde sperren alle pair/*-Aufrufe (423), bis ein neues Fenster kommt', () => {
    const { pm } = setup();
    const w = pm.open();
    const publicId = startPublic(pm);
    for (let i = 0; i < 20; i++) {
      fails(() =>
        pm.beginConfirm({ pairing_id: publicId, code: wrong(w.code), public_nonce: NONCE(i) }, freshIp()),
      );
    }
    expect(pm.status().state).toBe('qr_only');
    // 21. Fehlversuch (über den QR-Weg, nur wer den QR-Code sieht) → Sperre
    expect(
      fails(() =>
        pm.beginConfirm({ pairing_id: w.pairingId, code: wrong(w.code), public_nonce: NONCE(50) }, freshIp()),
      ),
    ).toBe('403 pairing_code_invalid');
    expect(pm.status().state).toBe('locked');
    expect(
      fails(() =>
        pm.beginConfirm({ pairing_id: w.pairingId, code: w.code, public_nonce: NONCE(51) }, freshIp()),
      ),
    ).toBe('423 pairing_locked');
    expect(fails(() => startPublic(pm, NONCE(52)))).toBe('423 pairing_locked');

    // Neues Fenster am Mac setzt alles zurück
    const neu = pm.open();
    expect(pm.status().state).toBe('open');
    pm.beginConfirm(
      { pairing_id: neu.pairingId, code: neu.code, public_nonce: NONCE(51) },
      freshIp(),
    ).commit();
  });

  it('unbekannte Kennung und abgelehnte Nonces zählen nicht zum Budget', () => {
    const { pm } = setup();
    const w = pm.open();
    const created = pm.start({ device_name: 'Fremd', kind: 'ipad', public_nonce: NONCE(7) }, freshIp());
    pm.reject(created.response.request_id);
    for (let i = 0; i < 30; i++) {
      expect(
        fails(() =>
          pm.beginConfirm(
            { pairing_id: crypto.randomUUID(), code: wrong(w.code), public_nonce: NONCE(i) },
            freshIp(),
          ),
        ),
      ).toBe('409 pairing_window_closed');
      expect(
        fails(() =>
          pm.beginConfirm(
            { pairing_id: created.response.pairing_id, code: wrong(w.code), public_nonce: NONCE(7) },
            freshIp(),
          ),
        ),
      ).toBe('403 pairing_request_rejected');
    }
    expect(pm.status().state).toBe('open');
    pm.beginConfirm({ pairing_id: w.pairingId, code: w.code, public_nonce: NONCE(8) }, freshIp()).commit();
  });
});

describe('Anfragen (Bonjour-Weg)', () => {
  it('höchstens 10 offene Anfragen; eine Ablehnung macht einen Platz frei', () => {
    const { pm } = setup();
    pm.open();
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      ids.push(
        pm.start({ device_name: `G${i}`, kind: 'ipad', public_nonce: NONCE(i) }, freshIp()).response
          .request_id,
      );
    }
    expect(fails(() => startPublic(pm, NONCE(10)))).toBe('429 pairing_requests_full');
    pm.reject(ids[3] ?? '');
    expect(pm.listRequests()).toHaveLength(9);
    startPublic(pm, NONCE(10));
    expect(pm.listRequests()).toHaveLength(10);
  });

  it('gleiche Nonce erneut: dieselbe Anfrage, auch eine abgelehnte wird nicht wieder geöffnet', () => {
    const { pm } = setup();
    const w = pm.open();
    const first = pm.start({ device_name: 'iPad', kind: 'ipad', public_nonce: NONCE(1) }, freshIp());
    expect(first.created).not.toBeNull();
    const again = pm.start({ device_name: 'Anders', kind: 'iphone', public_nonce: NONCE(1) }, freshIp());
    expect(again.created).toBeNull();
    expect(again.response.request_id).toBe(first.response.request_id);
    pm.reject(first.response.request_id);
    const third = pm.start({ device_name: 'iPad', kind: 'ipad', public_nonce: NONCE(1) }, freshIp());
    expect(third.response.request_id).toBe(first.response.request_id);
    expect(pm.listRequests()).toHaveLength(0);
    expect(
      fails(() =>
        pm.beginConfirm({ pairing_id: w.pairingId, code: w.code, public_nonce: NONCE(1) }, freshIp()),
      ),
    ).toBe('403 pairing_request_rejected');
  });

  it('request_id lässt sich nur einmal ablehnen und gilt nur im eigenen Fenster', () => {
    const { pm } = setup();
    pm.open();
    const id = pm.start({ device_name: 'iPad', kind: 'ipad', public_nonce: NONCE(1) }, freshIp()).response
      .request_id;
    pm.reject(id);
    expect(fails(() => pm.reject(id))).toBe('404 pairing_request_not_found');
    const other = pm.start({ device_name: 'iPad', kind: 'ipad', public_nonce: NONCE(2) }, freshIp()).response
      .request_id;
    pm.open();
    expect(fails(() => pm.reject(other))).toBe('404 pairing_request_not_found');
    expect(fails(() => pm.reject(crypto.randomUUID()))).toBe('404 pairing_request_not_found');
  });

  it('säubert Gerätenamen (Steuer- und Bidi-Zeichen)', () => {
    const { pm } = setup();
    pm.open();
    pm.start({ device_name: '‮iPad\u0007 von Ilian ', kind: 'ipad', public_nonce: NONCE(1) }, freshIp());
    expect(pm.listRequests()[0]?.device_name).toBe('iPad von Ilian');
    pm.start({ device_name: '‎‪', kind: 'ipad', public_nonce: NONCE(2) }, freshIp());
    expect(pm.listRequests()[1]?.device_name).toBe('Unbenanntes Gerät');
    expect(cleanDeviceName('  ')).toBeNull();
  });

  it('entfernt alle unsichtbaren Zeichen (Cc, Cf, Zl, Zp) und normalisiert NFKC (K1)', () => {
    // U+061C, U+200B, „iʀad“, Leerzeichen, U+2060, U+FEFF, Tag-Zeichen U+E0041
    expect(cleanDeviceName('\u061C\u200Bi\u0280ad \u2060\uFEFF\u{E0041}')).toBe('i\u0280ad');
    expect(cleanDeviceName('iPad\u200C\u200D\u2028von\u2029Ilian')).toBe('iPad von Ilian');
    // NFKC: Vollbreiten- und Ligaturformen werden zu normalen Zeichen
    expect(cleanDeviceName('\uFF49\uFF30\uFF41\uFF44 \uFB01')).toBe('iPad fi');
    expect(cleanDeviceName('iPad   von\tIlian')).toBe('iPad von Ilian');
    expect(cleanDeviceName('\u200B\uFEFF')).toBeNull();
    expect(cleanDeviceText('x'.repeat(100), 64)).toHaveLength(64);
    expect([...(cleanDeviceText('\u{1F600}'.repeat(70), 64) ?? '')]).toHaveLength(64);
  });
});

describe('Fenster schließen (DELETE /devices/pairings)', () => {
  it('schließt sofort, verwirft Anfragen, ist idempotent', () => {
    const { pm } = setup();
    const w = pm.open();
    startPublic(pm);
    pm.close();
    expect(pm.status().state).toBe('closed');
    expect(pm.listRequests()).toEqual([]);
    expect(fails(() => startPublic(pm, NONCE(3)))).toBe('409 pairing_window_closed');
    expect(
      fails(() =>
        pm.beginConfirm({ pairing_id: w.pairingId, code: w.code, public_nonce: NONCE(4) }, freshIp()),
      ),
    ).toBe('409 pairing_window_closed');
    pm.close();
    expect(pm.status().state).toBe('closed');
  });

  it('mit fremder pairing_id passiert nichts; ein laufendes confirm wird nicht abgebrochen', () => {
    const { pm } = setup();
    const w = pm.open();
    pm.close(crypto.randomUUID());
    expect(pm.status().state).toBe('open');
    const grant = pm.beginConfirm(
      { pairing_id: w.pairingId, code: w.code, public_nonce: NONCE(1) },
      freshIp(),
    );
    pm.close(w.pairingId);
    grant.commit();
    expect(pm.status().state).toBe('paired');
  });
});

describe('Rate-Limit pro Absenderadresse', () => {
  it('höchstens 10 pair/*-Aufrufe pro Minute, danach 429; nach einer Minute wieder frei', () => {
    const { pm, clock } = setup();
    pm.open();
    const ip = '192.168.1.66';
    for (let i = 0; i < 10; i++) pm.start({ device_name: 'x', kind: 'ipad', public_nonce: NONCE(1) }, ip);
    expect(fails(() => pm.start({ device_name: 'x', kind: 'ipad', public_nonce: NONCE(1) }, ip))).toBe(
      '429 pairing_rate_limited',
    );
    expect(
      fails(() =>
        pm.beginConfirm({ pairing_id: crypto.randomUUID(), code: '123456', public_nonce: NONCE(1) }, ip),
      ),
    ).toBe('429 pairing_rate_limited');
    // Andere Adressen sind nicht betroffen
    pm.start({ device_name: 'x', kind: 'ipad', public_nonce: NONCE(2) }, '192.168.1.67');
    clock.now += 60_000;
    pm.start({ device_name: 'x', kind: 'ipad', public_nonce: NONCE(1) }, ip);
  });

  it('IPv6-Adressen eines /64-Netzes teilen sich ein Limit; IPv4-mapped zählt wie IPv4', () => {
    expect(rateLimitKey('2001:db8:1:2:aaaa::1')).toBe(rateLimitKey('2001:db8:1:2:bbbb:cccc:dddd:eeee'));
    expect(rateLimitKey('2001:db8:1:2::1')).toBe('2001:db8:1:2::/64');
    expect(rateLimitKey('2001:db8:1:3::1')).not.toBe(rateLimitKey('2001:db8:1:2::1'));
    expect(rateLimitKey('fe80::1%en0')).toBe('fe80:0:0:0::/64');
    expect(rateLimitKey('::ffff:192.168.1.5')).toBe('192.168.1.5');
    expect(rateLimitKey('192.168.1.5')).toBe('192.168.1.5');
    expect(rateLimitKey(undefined)).toBe('unbekannt');

    const { pm } = setup();
    pm.open();
    for (let i = 0; i < 10; i++) {
      pm.start({ device_name: 'x', kind: 'ipad', public_nonce: NONCE(1) }, `2001:db8:1:2::${i + 1}`);
    }
    expect(
      fails(() => pm.start({ device_name: 'x', kind: 'ipad', public_nonce: NONCE(1) }, '2001:db8:1:2::ff')),
    ).toBe('429 pairing_rate_limited');
  });

  it('merkt sich nur begrenzt viele Adressen', () => {
    const { pm } = setup();
    for (let i = 0; i < MAX_TRACKED_ADDRESSES + 50; i++) {
      fails(() =>
        pm.start({ device_name: 'x', kind: 'ipad', public_nonce: NONCE(1) }, `10.9.${i >> 8}.${i & 255}`),
      );
    }
    const size = (pm as unknown as { calls: Map<string, number[]> }).calls.size;
    expect(size).toBeLessThanOrEqual(MAX_TRACKED_ADDRESSES);
  });
});
