import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tunnelPsk, tunnelServiceName } from '../../../services/core/src/services/tunnel.ts';

// Brücke zwischen Core (TypeScript) und Mac-Helfer (Swift): Die Testvektoren in den Swift-Tests müssen genau das
// ergeben, was der Core aus denselben Schlüsselbytes ableitet (docs/VERTRAEGE.md §7.5). Ändert jemand eine Seite, schlägt
// dieser Test schon unter Linux an, nicht erst im macOS-Job. Schlüssel entstehen hier zur Laufzeit aus Bytes.
const repoRoot = join(import.meta.dirname, '..', '..', '..');
const swiftTests = readFileSync(
  join(repoRoot, 'apps', 'mac-tunnel', 'Tests', 'TunnelSharedTests', 'TunnelKeyTests.swift'),
  'utf8',
);

const sequential = Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString('base64url');
const allOnes = Buffer.alloc(32, 0xff).toString('base64url');

describe('Testvektoren Swift gegen Core', () => {
  it('Dienstname und PSK für die Bytes 0…31 stehen in den Swift-Tests', () => {
    expect(swiftTests).toContain(`"${tunnelServiceName(sequential)}"`);
    expect(swiftTests).toContain(`"${tunnelPsk(sequential).toString('hex')}"`);
  });

  it('Dienstname und PSK für 32 × 0xff stehen in den Swift-Tests', () => {
    expect(swiftTests).toContain(`"${tunnelServiceName(allOnes)}"`);
    expect(swiftTests).toContain(`"${tunnelPsk(allOnes).toString('hex')}"`);
  });

  it('die Swift-Tests nutzen dieselben Rohbytes (0…31 und 0xff × 32)', () => {
    expect(swiftTests).toMatch(/sequential: \[UInt8\] = Array\(0\.\.<32\)/);
    expect(swiftTests).toMatch(/allOnes: \[UInt8\] = \[UInt8\]\(repeating: 0xFF, count: 32\)/);
  });

  it('die Swift-Seite benutzt dieselben Beschriftungen und die feste Kennung wie der Core', () => {
    const swiftKey = readFileSync(
      join(repoRoot, 'apps', 'mac-tunnel', 'Sources', 'TunnelShared', 'TunnelKey.swift'),
      'utf8',
    );
    expect(swiftKey).toContain('"sg-tunnel-name-v1"');
    expect(swiftKey).toContain('"sg-tunnel-psk-v1"');
    expect(swiftKey).toContain('"sg1"');
    expect(swiftKey).toContain('"_sg-tunnel._tcp"');
  });
});
