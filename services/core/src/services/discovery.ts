// Auffinden des Core im lokalen Netz (VERTRAEGE §12): IPv4 für den QR-Code und Bonjour-Ankündigung.
import { hostname, networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import { Bonjour } from 'bonjour-service';
import type { Logger } from 'pino';

/** Bonjour-Diensttyp (`_studiengehirn._tcp`) */
export const BONJOUR_TYPE = 'studiengehirn';

/** Schnittstellen, die nie ins WLAN zeigen (VPN-Tunnel, Docker, VMs, AirDrop) */
const IGNORED_INTERFACES =
  /^(lo|utun|tun|tap|wg|docker|br-|veth|vboxnet|vmnet|bridge|awdl|llw|anpi|ap\d|gif|stf)/i;

type Interfaces = NodeJS.Dict<NetworkInterfaceInfo[]>;

/**
 * IPv4 der aktiven Netzwerkschnittstelle (§12 Schritt 1): bevorzugt `en0` (WLAN am Mac), dann andere `en*`,
 * dann jede andere sinnvolle Schnittstelle. Link-Local-Adressen (169.254.x.x) kommen nur als letzter Ausweg in
 * Frage. Ohne Netz: `127.0.0.1` (die Web-App zeigt den Code trotzdem an).
 */
export function pickPairingHost(interfaces: Interfaces = networkInterfaces()): string {
  const candidates: { name: string; address: string; rank: number }[] = [];
  for (const [name, infos] of Object.entries(interfaces)) {
    if (!infos || IGNORED_INTERFACES.test(name)) continue;
    for (const info of infos) {
      if (info.family !== 'IPv4' || info.internal) continue;
      const linkLocal = info.address.startsWith('169.254.');
      const rank = (name === 'en0' ? 0 : /^en\d/.test(name) ? 1 : 2) + (linkLocal ? 10 : 0);
      candidates.push({ name, address: info.address, rank });
    }
  }
  candidates.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  return candidates[0]?.address ?? '127.0.0.1';
}

/** Name des Macs für die TXT-Angabe `name=` (ohne `.local`, höchstens 63 Zeichen) */
export function macName(raw: string = hostname()): string {
  const name = raw.replace(/\.local\.?$/i, '').trim();
  return (name || 'Mac').slice(0, 63);
}

export interface BonjourHandle {
  stop: () => Promise<void>;
}

/**
 * Kündigt den Core als `_studiengehirn._tcp` an (TXT `v=1`, `name=<Macname>`). Fehler (kein Multicast, Port
 * 5353 belegt, Namenskonflikt) werden nur protokolliert, der Core läuft ohne Bonjour weiter: Der QR-Weg und die
 * manuelle Eingabe brauchen es nicht.
 */
export function startBonjour(options: { port: number; logger: Logger; name?: string }): BonjourHandle {
  const name = macName(options.name);
  let bonjour: Bonjour | null = null;
  const logError = (error: unknown) =>
    options.logger.warn(
      { err: error },
      'Bonjour-Ankündigung nicht möglich, Kopplung per QR-Code geht weiter',
    );
  try {
    bonjour = new Bonjour({}, logError);
    const service = bonjour.publish({
      name: `Studien-Gehirn (${name})`,
      type: BONJOUR_TYPE,
      protocol: 'tcp',
      port: options.port,
      txt: { v: '1', name },
    });
    service.on('error', logError);
    options.logger.info({ type: `_${BONJOUR_TYPE}._tcp`, port: options.port }, 'Bonjour-Ankündigung aktiv');
  } catch (error) {
    logError(error);
  }
  return {
    stop: () =>
      new Promise<void>((resolve) => {
        if (!bonjour) return resolve();
        const current = bonjour;
        bonjour = null;
        let finished = false;
        const done = () => {
          if (finished) return;
          finished = true;
          try {
            current.destroy();
          } catch {
            // Beim Beenden egal
          }
          resolve();
        };
        try {
          current.unpublishAll(done);
        } catch {
          done();
        }
        // unpublishAll ruft den Callback ohne Netz evtl. nie auf
        setTimeout(done, 1_000).unref();
      }),
  };
}
