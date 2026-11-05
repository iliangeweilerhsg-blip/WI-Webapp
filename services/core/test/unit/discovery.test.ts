// Host für den QR-Code und Name für Bonjour (VERTRAEGE §12)
import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import { macName, pickPairingHost } from '../../src/services/discovery.ts';

function v4(address: string, internal = false): NetworkInterfaceInfo {
  return {
    address,
    family: 'IPv4',
    internal,
    netmask: '255.255.255.0',
    mac: '00:00:00:00:00:00',
    cidr: null,
  };
}
function v6(address: string): NetworkInterfaceInfo {
  return {
    address,
    family: 'IPv6',
    internal: false,
    netmask: 'ffff:ffff:ffff:ffff::',
    mac: '00:00:00:00:00:00',
    cidr: null,
    scopeid: 0,
  };
}

describe('pickPairingHost', () => {
  it('bevorzugt die IPv4 von en0', () => {
    expect(
      pickPairingHost({
        lo0: [v4('127.0.0.1', true)],
        en1: [v4('10.0.0.9')],
        en0: [v6('fe80::1'), v4('192.168.1.20')],
        utun3: [v4('100.64.0.2')],
      }),
    ).toBe('192.168.1.20');
  });

  it('fällt auf andere en*-Schnittstellen und dann auf sonstige zurück, ohne VPN, Docker und Bridges', () => {
    expect(pickPairingHost({ en5: [v4('10.0.0.9')], eth0: [v4('172.16.0.3')] })).toBe('10.0.0.9');
    expect(
      pickPairingHost({ utun0: [v4('100.64.0.2')], docker0: [v4('172.17.0.1')], eth0: [v4('172.16.0.3')] }),
    ).toBe('172.16.0.3');
    expect(pickPairingHost({ bridge100: [v4('192.168.64.1')], wlan0: [v4('192.168.0.7')] })).toBe(
      '192.168.0.7',
    );
  });

  it('Link-Local nur als letzter Ausweg, ohne Netz 127.0.0.1', () => {
    expect(pickPairingHost({ en0: [v4('169.254.10.2')], en1: [v4('192.168.2.4')] })).toBe('192.168.2.4');
    expect(pickPairingHost({ en0: [v4('169.254.10.2')] })).toBe('169.254.10.2');
    expect(pickPairingHost({ lo0: [v4('127.0.0.1', true)] })).toBe('127.0.0.1');
    expect(pickPairingHost({})).toBe('127.0.0.1');
  });
});

describe('macName', () => {
  it('ohne .local und nie leer', () => {
    expect(macName('Ilians-MacBook-Air.local')).toBe('Ilians-MacBook-Air');
    expect(macName('mac.LOCAL.')).toBe('mac');
    expect(macName('  ')).toBe('Mac');
    expect(macName('x'.repeat(80))).toHaveLength(63);
  });
});
