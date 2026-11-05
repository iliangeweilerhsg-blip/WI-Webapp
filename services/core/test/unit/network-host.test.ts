// Host-Prüfung für Anfragen aus dem Netz (Schutz vor DNS-Rebinding, VERTRAEGE §5)
import { describe, expect, it } from 'vitest';
import { isAllowedNetworkHost } from '../../src/plugins/security.ts';

describe('isAllowedNetworkHost', () => {
  it.each([
    '192.168.1.20',
    '192.168.1.20:4710',
    '10.0.0.1:80',
    '[fe80::1]',
    '[fe80::1]:4710',
    '[::ffff:192.168.1.2]:4710',
    'ilians-macbook-air.local',
    'ilians-macbook-air.local:4710',
    'mac.local.:4710',
  ])('erlaubt %s', (host) => {
    expect(isAllowedNetworkHost(host)).toBe(true);
  });

  it.each([
    undefined,
    '',
    'localhost',
    'localhost:4710',
    'evil.example',
    'evil.example:4710',
    '192.168.1.20.nip.io:4710',
    'local',
    '.local',
    'evil.local.example.com',
    'fe80::1',
    '[fe80::1',
    '[fe80::1]x',
    '[evil.example]:4710',
    '192.168.1.20:abc',
    '192.168.1.20:123456',
    '999.1.1.1',
    'mac.local:4710:1',
  ])('lehnt %s ab', (host) => {
    expect(isAllowedNetworkHost(host)).toBe(false);
  });
});
