import { describe, expect, it } from 'vitest';
import { pino } from 'pino';
import { loggerOptions } from '../../src/logger.ts';
import { startTestApp, TEST_PORT } from './helpers.ts';

/** Issue #87: abgelehnte Netzanfragen dürfen das Log nicht fluten; Schwärzung (#95) und lokales Log bleiben */
async function withLoggedApp(
  run: (ctx: Awaited<ReturnType<typeof startTestApp>>, lines: string[]) => Promise<void>,
) {
  const lines: string[] = [];
  const logger = pino(loggerOptions({ logLevel: 'info' }), {
    write: (chunk: string) => void lines.push(chunk),
  });
  const t = await startTestApp(
    {},
    {
      logger,
      verifyDeviceToken: async (token) => (token === 'TEST-TOKEN-OK' ? { deviceId: 'dev-1' } : null),
    },
  );
  try {
    await run(t, lines);
  } finally {
    await t.close();
  }
}

const netHeaders = (headers: Record<string, string> = {}) => ({
  host: `192.168.1.10:${TEST_PORT}`,
  ...headers,
});

describe('Log-Flut durch abgelehnte Netzanfragen (#87)', () => {
  it('10.000 abgelehnte Netzanfragen ergeben nur eine zusammengefasste Zeile', async () => {
    await withLoggedApp(async (t, lines) => {
      lines.length = 0;
      for (let i = 0; i < 10_000; i++) {
        const res = await t.app.inject({
          url: `/api/v1/devices?pairing_id=TEST-PAIRING-${i}`,
          remoteAddress: '192.168.1.23',
          headers: netHeaders({ authorization: 'Bearer TEST-TOKEN-0001' }),
        });
        expect(res.statusCode).toBe(401);
      }
      const wrongHost = await t.app.inject({
        url: '/api/v1/devices',
        remoteAddress: '192.168.1.23',
        headers: netHeaders({ host: 'evil.example' }),
      });
      expect(wrongHost.statusCode).toBe(421);
      const wrongOrigin = await t.app.inject({
        method: 'POST',
        url: '/api/v1/devices/pair/start',
        remoteAddress: '192.168.1.23',
        headers: netHeaders({ origin: 'http://evil.example' }),
      });
      expect(wrongOrigin.statusCode).toBe(403);
      // Vor der Zusammenfassung (Fenster läuft noch) steht keine einzige Zeile im Log
      expect(lines).toEqual([]);
      await t.app.close();
      console.log(`Logzeilen nach 10.002 abgelehnten Anfragen: ${lines.length}`);
      expect(lines.length).toBeLessThanOrEqual(5);
      const summaries = lines.filter((line) => line.includes('Abgelehnte Netzanfragen'));
      expect(summaries).toHaveLength(1);
      expect(JSON.parse(summaries[0] as string)).toMatchObject({
        source: '192.168.1.23',
        count: 10_002,
        statuses: { '401': 10_000, '421': 1, '403': 1 },
      });
      expect(lines.join('')).not.toMatch(/TEST-PAIRING|TEST-TOKEN/);
    });
  });

  it('Kopplungsrouten ohne Token: 10.000 Anfragen mit 4xx (400, 429) ergeben nur eine Zusammenfassung', async () => {
    await withLoggedApp(async (t, lines) => {
      lines.length = 0;
      const seen = new Set<number>();
      for (let i = 0; i < 10_000; i++) {
        const res = await t.app.inject({
          method: 'POST',
          url: i % 2 ? '/api/v1/devices/pair/start' : '/api/v1/devices/pair/confirm',
          remoteAddress: '192.168.1.24',
          headers: netHeaders({ 'content-type': 'application/json' }),
          // Gültiger Body bei start (Fenster zu → 423, danach Rate-Limit → 429), leerer bei confirm (400)
          payload: i % 2 ? { device_name: 'TEST-iPad', kind: 'ipad', public_nonce: 'A'.repeat(24) } : {},
        });
        seen.add(res.statusCode);
        expect(res.statusCode).toBeGreaterThanOrEqual(400);
      }
      // Das Rate-Limit (§12) greift: neben 400 kommt 429 vor
      expect(seen.has(429)).toBe(true);
      expect(lines).toEqual([]);
      await t.app.close();
      expect(lines.length).toBeLessThanOrEqual(3);
      const summary = JSON.parse(lines.find((l) => l.includes('Abgelehnte Netzanfragen')) as string) as {
        count: number;
        source: string;
      };
      expect(summary).toMatchObject({ source: '192.168.1.24', count: 10_000 });
    });
  });

  it('lokale und angenommene Netzanfragen loggen wie bisher, geheime Query-Werte bleiben geschwärzt', async () => {
    await withLoggedApp(async (t, lines) => {
      lines.length = 0;
      await t.request({ url: '/api/v1/health?token=TEST-LOCAL-0001' });
      const local = lines.join('');
      expect(local).toContain('incoming request');
      expect(local).toContain('request completed');
      expect(local).toContain('token=[Redacted]');
      expect(local).not.toContain('TEST-LOCAL-0001');

      lines.length = 0;
      const ok = await t.app.inject({
        url: '/api/v1/health?token=TEST-NET-0001',
        remoteAddress: '192.168.1.23',
        headers: netHeaders({ authorization: 'Bearer TEST-TOKEN-OK' }),
      });
      expect(ok.statusCode).toBe(200);
      const network = lines.join('');
      expect(network).toContain('incoming request');
      expect(network).toContain('request completed');
      expect(network).toContain('token=[Redacted]');
      expect(network).not.toMatch(/TEST-NET-0001|TEST-TOKEN-OK/);
    });
  });
});
