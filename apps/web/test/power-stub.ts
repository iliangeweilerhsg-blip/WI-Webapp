import { vi } from 'vitest';

/** Antwort von `GET /system/power` (UX-315) */
export interface PowerStub {
  percent: number;
  on_ac: boolean;
}

/** Legt `GET /system/power` über den bisherigen `fetch`; alles andere geht unverändert durch */
export function stubPower(power: PowerStub): void {
  const before = globalThis.fetch;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
    String(input).includes('/system/power')
      ? Promise.resolve(
          Response.json({
            has_battery: true,
            percent: power.percent,
            on_ac: power.on_ac,
            measured_at: '2026-11-04T08:00:00Z',
          }),
        )
      : before(input, init),
  );
}
