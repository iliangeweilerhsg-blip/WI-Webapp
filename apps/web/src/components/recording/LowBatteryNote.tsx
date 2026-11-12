'use client';

// Ruhige Zeile in der Statusleiste, wenn während einer Session der Akku des Macs unter 20 % liegt und kein Netzteil
// steckt (UX-315). Kein Dialog, kein Ton (R1); die Aufnahme läuft weiter. Bei Fehlern der Abfrage (etwa ein älterer
// Core) oder ohne Akku: nichts.
import { isBatteryLow, useSystemPower } from '../../lib/system.ts';

/** So oft fragt die Leiste während der Session nach dem Akku (der Core hält den Stand 30 Sekunden) */
const POLL_POWER_MS = 60_000;

export function LowBatteryNote({ active }: { active: boolean }) {
  const power = useSystemPower({ refetchIntervalMs: active ? POLL_POWER_MS : false });
  if (!active || !isBatteryLow(power.data)) return null;
  return (
    <p className="text-text-muted" data-testid="battery-status" role="status">
      Akku {power.data?.percent} % · Netzteil anschließen
    </p>
  );
}
