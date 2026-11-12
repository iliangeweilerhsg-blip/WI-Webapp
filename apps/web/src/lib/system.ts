'use client';

// Akku des Macs (UX-315, VERTRAEGE §7.7): Abruf von `GET /system/power` und die Schwellen für die ruhigen Hinweise.
import { useQuery } from '@tanstack/react-query';
import { SystemPowerSchema, type SystemPower } from '@sg/shared';
import { apiGet } from './api.ts';
import { useHydrationSafe } from './hydrated.ts';

/** Statusleiste während der Session: darunter, ohne Netzteil, steht der Hinweis */
export const BATTERY_WARN_PERCENT = 20;
/** Start-Karte: darunter, ohne Netzteil, fragt sie „Mac am Netz?“ (eine Vorlesung dauert rund anderthalb Stunden) */
export const BATTERY_START_WARN_PERCENT = 40;

/** Akku vorhanden, Prozent bekannt und der Mac läuft sicher nicht am Netzteil (`on_ac === false`) */
function onBatteryBelow(power: SystemPower | undefined, percent: number): boolean {
  return (
    power !== undefined &&
    power.has_battery &&
    power.on_ac === false &&
    power.percent !== null &&
    power.percent < percent
  );
}

export function isBatteryLow(power: SystemPower | undefined): boolean {
  return onBatteryBelow(power, BATTERY_WARN_PERCENT);
}

export function isBatteryLowForStart(power: SystemPower | undefined): boolean {
  return onBatteryBelow(power, BATTERY_START_WARN_PERCENT);
}

export function useSystemPower(options: { refetchIntervalMs?: number | false } = {}) {
  const query = useQuery({
    queryKey: ['system', 'power'],
    queryFn: ({ signal }) => apiGet('/system/power', SystemPowerSchema, { signal }),
    // Der Core hält den Stand 30 Sekunden
    staleTime: 30_000,
    // Ein Fehler (etwa ein älterer Core) wird nicht wiederholt, die Hinweise fehlen dann einfach
    retry: false,
    refetchInterval: options.refetchIntervalMs ?? false,
  });
  return useHydrationSafe(query);
}
