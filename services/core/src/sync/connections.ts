// Offene Sync-Verbindungen (VERTRAEGE §11, §16.2).
import { getActiveHub } from './hub.ts';

/** Alle WebSockets eines Geräts schließen, z. B. mit 4401 nach `DELETE /devices/{id}` */
export function closeDeviceConnections(deviceId: string, code: number): void {
  getActiveHub()?.closeDeviceConnections(deviceId, code);
}

/** Hat das Gerät gerade eine Sync-Verbindung (nach `welcome`)? (`Device.connected`) */
export function isDeviceConnected(deviceId: string): boolean {
  return getActiveHub()?.isDeviceConnected(deviceId) ?? false;
}
