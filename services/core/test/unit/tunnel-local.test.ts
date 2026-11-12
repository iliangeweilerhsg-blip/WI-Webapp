// „Lokal“ im Core (UX-12, Plan E2, §5.1, B17): Ein Socket des Tunnel-Eingangs gilt nie als lokal, die Markierung schlägt
// die Adresse, und „lokal“ wird im ganzen Core nur über `isLocalRequest` entschieden (Architekturtest).
import { EventEmitter } from 'node:events';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  isLocalRequest,
  isLoopbackAddress,
  isTunnelSocket,
  NetworkConnectionGate,
  rejectionSource,
  tunnelSockets,
  type ConnectionGateLimits,
} from '../../src/plugins/security.ts';

const sock = (remoteAddress?: string) => ({ remoteAddress });

describe('isLocalRequest', () => {
  it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1'])('Loopback %s ohne Markierung ist lokal', (address) => {
    expect(isLocalRequest({ socket: sock(address) })).toBe(true);
  });

  it('fremde Adresse und fehlende Adresse (Unix-Socket) sind nicht lokal', () => {
    expect(isLocalRequest({ socket: sock('192.168.1.5') })).toBe(false);
    expect(isLocalRequest({ socket: sock(undefined) })).toBe(false);
  });

  it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1', undefined, '192.168.1.5'])(
    'ein markierter Tunnel-Socket ist nie lokal, auch mit gefälschter Adresse (%s)',
    (address) => {
      const socket = sock(address);
      tunnelSockets.add(socket);
      expect(isTunnelSocket(socket)).toBe(true);
      expect(isLocalRequest({ socket })).toBe(false);
      // Die Adresse allein hätte „lokal“ ergeben: genau das verhindert die Markierung
      expect(isLoopbackAddress(address)).toBe(
        address === undefined || address === '192.168.1.5' ? false : true,
      );
    },
  );

  it('die Markierung gilt je Socket-Objekt, nicht für andere Verbindungen', () => {
    const marked = sock('127.0.0.1');
    const other = sock('127.0.0.1');
    tunnelSockets.add(marked);
    expect(isLocalRequest({ socket: marked })).toBe(false);
    expect(isLocalRequest({ socket: other })).toBe(true);
  });

  it('isTunnelSocket verträgt null und undefined', () => {
    expect(isTunnelSocket(null)).toBe(false);
    expect(isTunnelSocket(undefined)).toBe(false);
  });
});

describe('rejectionSource', () => {
  it('alle Tunnel-Anfragen teilen sich die Quelle "tunnel", sonst gilt die Adresse', () => {
    const socket = sock(undefined);
    tunnelSockets.add(socket);
    expect(rejectionSource({ socket })).toBe('tunnel');
    expect(rejectionSource({ socket: sock('10.0.0.7') })).toBe('10.0.0.7');
  });
});

class FakeSocket extends EventEmitter {
  destroyed = false;
  readonly remoteAddress: string | undefined;
  constructor(remoteAddress?: string) {
    super();
    this.remoteAddress = remoteAddress;
  }
  destroy(): void {
    this.destroyed = true;
    queueMicrotask(() => this.emit('close'));
  }
}

describe('NetworkConnectionGate und Tunnel-Sockets', () => {
  const limits: ConnectionGateLimits = {
    maxPerSource: 2,
    maxNetwork: 4,
    firstRequestTimeoutMs: 15_000,
    tokenlessRequestTimeoutMs: 10_000,
    trustedAddressTtlMs: 15 * 60_000,
    maxTrustedAddresses: 64,
  };

  it('authenticate gibt für einen Tunnel-Socket nicht die Pseudo-Adresse "unbekannt" frei (S6)', () => {
    const gate = new NetworkConnectionGate(limits, undefined, { now: () => 0 });
    const tunnel = new FakeSocket(undefined);
    tunnelSockets.add(tunnel);
    gate.authenticate(tunnel);
    // Eine adresslose Netzverbindung hätte sonst Vorrang (protected) und zählte nicht gegen maxNetwork
    const stranger = new FakeSocket(undefined);
    gate.admit(stranger);
    expect(gate.openConnections).toBe(1);
  });

  it('admit zählt Tunnel-Sockets nicht (eigene Grenzen am Tunnel-Server)', () => {
    const gate = new NetworkConnectionGate(limits, undefined, { now: () => 0 });
    for (let i = 0; i < 10; i++) {
      const tunnel = new FakeSocket(undefined);
      tunnelSockets.add(tunnel);
      gate.admit(tunnel);
      expect(tunnel.destroyed).toBe(false);
    }
    expect(gate.openConnections).toBe(0);
  });
});

/**
 * Architekturtest (B17): `isLoopbackAddress(` darf nur in `plugins/security.ts` vorkommen. Alle anderen Stellen, die
 * wissen wollen, ob eine Anfrage lokal ist, nehmen `isLocalRequest(request)`. So bleiben auch künftige Routen an der
 * Markierung des Tunnel-Eingangs.
 */
const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
const ALLOWED = new Set(['plugins/security.ts']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}

/** Aufrufe und Importe von `isLoopbackAddress` ohne Kommentare und Strings */
function usesLoopbackCheck(code: string): boolean {
  const withoutComments = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  return /\bisLoopbackAddress\b/.test(withoutComments);
}

describe('Architektur: eine Stelle für „lokal“', () => {
  it('isLoopbackAddress kommt außerhalb von plugins/security.ts nicht vor', () => {
    const offenders = sourceFiles(SRC)
      .map((file) => relative(SRC, file))
      .filter((file) => !ALLOWED.has(file))
      .filter((file) => usesLoopbackCheck(readFileSync(join(SRC, file), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('der Test erkennt einen Verstoß (Gegenprobe)', () => {
    expect(usesLoopbackCheck('if (!isLoopbackAddress(request.socket.remoteAddress)) {}')).toBe(true);
    expect(usesLoopbackCheck("import { isLoopbackAddress } from './security.ts';")).toBe(true);
    expect(usesLoopbackCheck('// isLoopbackAddress( steht nur im Kommentar')).toBe(false);
    expect(usesLoopbackCheck('/* isLoopbackAddress( */ const a = isLocalRequest(request);')).toBe(false);
  });

  it('die drei Stellen aus B17 gehen über isLocalRequest', () => {
    for (const file of ['routes/settings.ts', 'routes/calendar.ts', 'plugins/rejection-log.ts']) {
      expect(readFileSync(join(SRC, file), 'utf8'), file).toContain('isLocalRequest');
    }
  });

  it('nur security.ts liest die Socket-Adresse für eine Lokal-Entscheidung gegen Loopback-Literale', () => {
    const offenders = sourceFiles(SRC)
      .map((file) => relative(SRC, file))
      .filter((file) => !ALLOWED.has(file))
      .filter((file) =>
        /remoteAddress\s*(===|!==|==|!=)\s*['"`](127\.0\.0\.1|::1)/.test(
          readFileSync(join(SRC, file), 'utf8'),
        ),
      );
    expect(offenders).toEqual([]);
  });
});
