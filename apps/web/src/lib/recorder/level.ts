// Pegel der laufenden Aufnahme (VERTRAEGE §16.2). T1-07 baut darauf die Stille-Erkennung für den Auto-Stopp.
//
// `subscribeAudioLevel(fn)` meldet alle 250 ms `{ at, rms }`, solange eine Aufnahme läuft:
// - `at`: Epochen-ms (`Date.now()`) der Messung
// - `rms`: Effektivwert der letzten Abtastung im Bereich 0 bis 1 (0 = Stille, 1 = Vollaussteuerung)

export const LEVEL_INTERVAL_MS = 250;

export interface AudioLevel {
  at: number;
  rms: number;
}

export type AudioLevelListener = (sample: AudioLevel) => void;

// Hörer sind Modulzustand, weil `subscribeAudioLevel` ohne Bezug auf eine Recorder-Instanz aufrufbar sein muss
// (T1-07 kennt den Recorder nicht). Der Recorder speist alle Hörer über `publishAudioLevel`.
const listeners = new Set<AudioLevelListener>();

/** Meldet sich für Pegelwerte an. Rückgabe: abmelden. */
export function subscribeAudioLevel(fn: AudioLevelListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Verteilt einen Messwert an alle Hörer. Ein fehlerhafter Hörer stört die anderen nicht. */
export function publishAudioLevel(sample: AudioLevel): void {
  for (const fn of [...listeners]) {
    try {
      fn(sample);
    } catch (error) {
      console.warn('Pegel-Hörer ist fehlgeschlagen', error);
    }
  }
}

/** Effektivwert von Abtastwerten im Bereich -1 bis 1 */
export function rmsOf(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] ?? 0;
    sum += v * v;
  }
  return Math.sqrt(sum / samples.length);
}

/** Teilmenge der Web-Audio-Schnittstelle, die der Messer braucht (Tests liefern einen Fake) */
export interface AnalyserLike {
  fftSize: number;
  getFloatTimeDomainData(array: Float32Array<ArrayBuffer>): void;
}
export interface AudioContextLike {
  createMediaStreamSource(stream: MediaStream): { connect(node: unknown): void; disconnect(): void };
  createAnalyser(): AnalyserLike;
  resume?(): Promise<void>;
  close(): Promise<void>;
}

export interface LevelMeterOptions {
  createContext?: () => AudioContextLike | null;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  now?: () => number;
}

function defaultContext(): AudioContextLike | null {
  const Ctor =
    globalThis.AudioContext ??
    (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return Ctor ? (new Ctor() as unknown as AudioContextLike) : null;
}

/**
 * Misst den Pegel des Mikrofonstroms alle 250 ms und verteilt ihn. Ohne Web Audio passiert nichts
 * (der Auto-Stopp fällt dann auf seine Rückfallebene zurück). Rückgabe: beenden.
 */
export function startLevelMeter(stream: MediaStream, options: LevelMeterOptions = {}): () => void {
  let context: AudioContextLike | null = null;
  try {
    context = (options.createContext ?? defaultContext)();
  } catch {
    context = null;
  }
  if (!context) return () => undefined;

  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  void context.resume?.().catch(() => undefined);
  const buffer = new Float32Array(analyser.fftSize);
  const now = options.now ?? Date.now;
  const set = options.setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms));
  const clear =
    options.clearInterval ?? ((h) => globalThis.clearInterval(h as ReturnType<typeof setInterval>));

  const handle = set(() => {
    analyser.getFloatTimeDomainData(buffer);
    publishAudioLevel({ at: now(), rms: rmsOf(buffer) });
  }, LEVEL_INTERVAL_MS);

  return () => {
    clear(handle);
    try {
      source.disconnect();
    } catch {
      // schon getrennt
    }
    void context.close().catch(() => undefined);
  };
}
