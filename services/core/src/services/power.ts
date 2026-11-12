// Akku des Macs (UX-315, VERTRAEGE §7.7): Prozent und Netzteil, gelesen mit `pmset -g batt` (nur macOS).
// Ohne macOS, ohne Akku (Mac mini) oder wenn `pmset` scheitert, heißt die Antwort „kein Akku“, nie ein Fehler.
// Der Befehl läuft ohne Shell mit festem Argument-Array, Zeitgrenze und begrenzter Ausgabe. Das Ergebnis gilt
// 30 Sekunden; gleichzeitige Aufrufe teilen sich einen Lauf.
import { execFile as nodeExecFile } from 'node:child_process';
import type { SystemPower } from '@sg/shared';

/** So lange gilt ein gelesener Akkustand, bevor der nächste Aufruf neu liest */
export const POWER_TTL_MS = 30_000;
/** Höchstzeit für `pmset` */
export const PMSET_TIMEOUT_MS = 2000;
/** Höchstzahl Byte der Ausgabe von `pmset`; mehr bricht den Lauf ab (die echte Ausgabe ist unter 500 Byte) */
export const PMSET_MAX_OUTPUT_BYTES = 8192;

const PMSET = '/usr/bin/pmset';
const PMSET_ARGS = ['-g', 'batt'] as const;

export type PmsetRunner = () => Promise<string>;

/** Standard-Läufer: festes Programm, feste Argumente, keine Shell, Zeit- und Ausgabegrenze */
export const runPmset: PmsetRunner = () =>
  new Promise((resolve, reject) => {
    nodeExecFile(
      PMSET,
      [...PMSET_ARGS],
      { timeout: PMSET_TIMEOUT_MS, maxBuffer: PMSET_MAX_OUTPUT_BYTES, windowsHide: true, encoding: 'utf8' },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });

export interface PowerReading {
  has_battery: boolean;
  percent: number | null;
  on_ac: boolean | null;
}

const NO_BATTERY: PowerReading = { has_battery: false, percent: null, on_ac: null };

/**
 * Liest die Ausgabe von `pmset -g batt`:
 *
 *     Now drawing from 'Battery Power'
 *      -InternalBattery-0 (id=4653155)	87%; discharging; 4:12 remaining present: true
 *
 * Quelle ist die erste Zeile (`'AC Power'` oder `'Battery Power'`), der Prozentwert steht in der Akkuzeile.
 * Ohne Akkuzeile (Mac mini, Mac Studio) oder bei unlesbarem Text: kein Akku.
 */
export function parsePmset(output: string): PowerReading {
  const text = output.slice(0, PMSET_MAX_OUTPUT_BYTES);
  const battery = /InternalBattery[^\n]*?(\d{1,3})%/.exec(text);
  if (!battery) return NO_BATTERY;
  const percent = Number(battery[1]);
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) return NO_BATTERY;
  const source = /Now drawing from '([^']*)'/.exec(text)?.[1];
  const onAc = source === 'AC Power' ? true : source === 'Battery Power' ? false : null;
  return { has_battery: true, percent, on_ac: onAc };
}

export interface PowerMeterOptions {
  platform?: NodeJS.Platform;
  run?: PmsetRunner;
  now?: () => number;
  /** Meldet, dass `pmset` scheiterte (die Antwort ist dann „kein Akku“) */
  onError?: (error: unknown) => void;
}

export class PowerMeter {
  private cached: { at: number; value: SystemPower } | null = null;
  private inflight: Promise<SystemPower> | null = null;

  private readonly options: PowerMeterOptions;

  constructor(options: PowerMeterOptions = {}) {
    this.options = options;
  }

  async read(): Promise<SystemPower> {
    const now = this.options.now ?? Date.now;
    if (this.cached && now() - this.cached.at < POWER_TTL_MS) return this.cached.value;
    this.inflight ??= this.measure(now).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async measure(now: () => number): Promise<SystemPower> {
    const platform = this.options.platform ?? process.platform;
    let reading: PowerReading = NO_BATTERY;
    if (platform === 'darwin') {
      try {
        reading = parsePmset(await (this.options.run ?? runPmset)());
      } catch (error) {
        this.options.onError?.(error);
      }
    }
    const at = now();
    const value: SystemPower = { ...reading, measured_at: new Date(at).toISOString() };
    this.cached = { at, value };
    return value;
  }
}
