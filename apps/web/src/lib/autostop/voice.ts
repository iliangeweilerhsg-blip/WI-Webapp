// Sprachaktivität aus den Pegelwerten des Recorders (VERTRAEGE §16.2, `subscribeAudioLevel`).
//
// Der Recorder meldet alle 250 ms `{ at, rms }`, `rms` ist der Effektivwert eines 2048er-Fensters (ca. 43 ms) im
// Bereich 0 bis 1. Ein einzelner Wert sagt wenig, denn Sprache hat Pausen zwischen Wörtern und Silben. Darum:
//
// - Glättung: Hüllkurve mit schnellem Anstieg und langsamem Abfall (`envelope = max(rms, envelope * release)`).
//   Mit `release = 0.9` pro 250-ms-Wert sinkt die Hüllkurve nach dem letzten lauten Wert in ca. 1,6 s auf die Hälfte.
//   Wortpausen bis etwa 1 s zählen so noch als Sprache.
// - Schwellwert mit Hysterese: Sprache beginnt ab `onThreshold`, endet erst unter `offThreshold`. Das verhindert
//   Flattern um die Schwelle.
// - Werte (Lead-Entscheidung): `onThreshold = 0.003` (ca. -50 dBFS), `offThreshold = 0.002` (ca. -54 dBFS). Bewusst
//   niedrig: Leise Sprache (ferner Dozent, Flüstern) darf NIEMALS als Stille gelten, denn ein fälschlich beendeter
//   Vortrag ist der schlimmere Fehler. Dafür darf lautes Raumrauschen fälschlich als Sprache zählen; dann stoppen
//   nur noch die harten Grenzen (Regeln 2 und 4) die Aufnahme. Die Kalibrierung im Hörsaal bleibt offen (T1-20).
// - Digitale Stille: `rms < 1e-6` (stummgeschaltetes Mikrofon, Gerät liefert Nullen) ist „unbekannt“, nicht Stille
//   (siehe `SilenceTracker`). Ein stummes Mikrofon beweist nicht, dass nicht gesprochen wird.
// - Fehlalarme gehen in die sichere Richtung: Ein lautes Geräusch (Tür, Husten) gilt als Sprache und schiebt den
//   Stopp hinaus.
//
// Alle Werte sind konfigurierbar (`VoiceActivityOptions`), denn Mikrofone und Browser-Verstärkung unterscheiden sich.

export interface VoiceActivityOptions {
  /** Hüllkurve ab diesem Wert: Sprache beginnt (rms, 0 bis 1) */
  onThreshold: number;
  /** Hüllkurve unter diesem Wert: Sprache endet (darf nicht über `onThreshold` liegen) */
  offThreshold: number;
  /** Abfallfaktor der Hüllkurve je Messwert, 0 bis 1 (größer = träger) */
  release: number;
}

export const DEFAULT_VOICE_OPTIONS: VoiceActivityOptions = {
  onThreshold: 0.003,
  offThreshold: 0.002,
  release: 0.9,
};

/** Erkennt Sprache Messwert für Messwert. Zustand: Hüllkurve und aktueller Sprachzustand. */
export class VoiceDetector {
  private readonly options: VoiceActivityOptions;
  private envelope = 0;
  private voiced = false;

  constructor(options: Partial<VoiceActivityOptions> = {}) {
    this.options = { ...DEFAULT_VOICE_OPTIONS, ...options };
    if (this.options.offThreshold > this.options.onThreshold) {
      throw new RangeError('offThreshold darf nicht über onThreshold liegen');
    }
  }

  /** Verarbeitet einen Pegelwert, Rückgabe: ist gerade Sprache aktiv? Ungültige Werte (NaN, negativ) zählen als 0. */
  push(rms: number): boolean {
    const value = Number.isFinite(rms) && rms > 0 ? rms : 0;
    this.envelope = Math.max(value, this.envelope * this.options.release);
    if (this.voiced) {
      if (this.envelope < this.options.offThreshold) this.voiced = false;
    } else if (this.envelope >= this.options.onThreshold) {
      this.voiced = true;
    }
    return this.voiced;
  }

  reset(): void {
    this.envelope = 0;
    this.voiced = false;
  }
}

/** Ein Pegelwert wie von `subscribeAudioLevel` geliefert */
export interface LevelSample {
  at: number;
  rms: number;
}

export interface SilenceTrackerOptions extends Partial<VoiceActivityOptions> {
  /**
   * Größter Abstand zwischen zwei Messwerten, der noch als lückenlos gilt. Der Recorder misst alle 250 ms; ab
   * 2 s ohne Messwert (angehaltener `AudioContext`, Tab im Hintergrund, Recorder aus) ist die Lage unbekannt.
   */
  maxGapMs?: number;
}

export const DEFAULT_MAX_GAP_MS = 2000;

/** Darunter liefert das Gerät digitale Stille (Nullen): kein Signal, also unbekannt statt still */
export const DIGITAL_SILENCE_RMS = 1e-6;

/**
 * Verfolgt, seit wann es ununterbrochen still ist.
 *
 * WICHTIG: Keine Messwerte sind NICHT dasselbe wie Stille. Läuft der `AudioContext` nicht (`suspended`), liefert der
 * Recorder gar keine Werte (level.ts), und ein Analysator würde nur Nullen liefern. Beides darf nie als Stille
 * zählen, sonst würde eine laufende Vorlesung fälschlich gestoppt. Darum gilt:
 * - `silentSince(now)` ist `null` (unbekannt), solange der letzte Messwert älter als `maxGapMs` ist.
 * - Eine Lücke zwischen zwei Messwerten (größer als `maxGapMs`) beginnt die Stille neu: Gezählt wird nur Stille,
 *   die lückenlos beobachtet wurde.
 * - Zu Beginn (noch kein Messwert) ist die Stille ebenfalls unbekannt. Vor dem ersten Messwert zählt nichts.
 * - Digitale Stille (`rms < DIGITAL_SILENCE_RMS`) ist ebenfalls „unbekannt“ und setzt die Zählung zurück.
 */
export class SilenceTracker {
  private readonly detector: VoiceDetector;
  private readonly maxGapMs: number;
  private anchor: number | null = null;
  private lastSampleAt: number | null = null;

  constructor(options: SilenceTrackerOptions = {}) {
    const { maxGapMs, ...voice } = options;
    this.detector = new VoiceDetector(voice);
    this.maxGapMs = maxGapMs ?? DEFAULT_MAX_GAP_MS;
  }

  push(sample: LevelSample): void {
    const { at, rms } = sample;
    if (!Number.isFinite(at)) return;
    if (!(rms >= DIGITAL_SILENCE_RMS)) {
      // Nullen (stummes Mikrofon, NaN): keine Aussage über Sprache. Neu anfangen, sobald wieder Signal kommt.
      this.reset();
      return;
    }
    const gap = this.lastSampleAt === null ? Infinity : at - this.lastSampleAt;
    // Lücke oder Zeitsprung rückwärts: neu anfangen, auch die Hüllkurve
    if (gap > this.maxGapMs || gap < 0) {
      this.detector.reset();
      this.anchor = at;
    }
    if (this.detector.push(rms)) this.anchor = at;
    this.lastSampleAt = at;
  }

  /** Beginn der aktuellen, lückenlos beobachteten Stille. `null` = unbekannt (keine frischen Messwerte). */
  silentSince(now: number): number | null {
    if (this.lastSampleAt === null || this.anchor === null) return null;
    if (now - this.lastSampleAt > this.maxGapMs) return null;
    return this.anchor;
  }

  /** Vergisst alles (nach Pause oder Sitzungswechsel): die Stille beginnt mit dem nächsten Messwert neu. */
  reset(): void {
    this.detector.reset();
    this.anchor = null;
    this.lastSampleAt = null;
  }
}
