// Offene Sync-Verbindungen (VERTRAEGE §11, §16.2). Gerüst aus T1-DB, füllt T1-08.

/** Alle WebSockets eines Geräts schließen, z. B. mit 4401 nach `DELETE /devices/{id}` */
export function closeDeviceConnections(_deviceId: string, _code: number): void {
  throw new Error('nicht umgesetzt');
}

/** Hat das Gerät gerade eine Sync-Verbindung? (`Device.connected`) */
export function isDeviceConnected(_deviceId: string): boolean {
  throw new Error('nicht umgesetzt');
}
