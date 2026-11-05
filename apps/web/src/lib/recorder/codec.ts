// Codec-Wahl je Browser (Spike S4, VERTRAEGE §10.1): Chrome nimmt Opus in WebM, Safari AAC in fragmentiertem MP4.
import type { AudioCodec } from '@sg/shared';

export interface RecorderFormat {
  /** Wert für `MediaRecorder` und `RecordingCreate.mime` */
  mime: string;
  codec: AudioCodec;
}

/** Reihenfolge der Vorlieben. Der Core versteht nur `audio/webm` und `audio/mp4` (Schema `RecordingCreate.mime`). */
const CANDIDATES: RecorderFormat[] = [
  { mime: 'audio/webm;codecs=opus', codec: 'opus' },
  { mime: 'audio/mp4;codecs=mp4a.40.2', codec: 'aac' },
  { mime: 'audio/mp4', codec: 'aac' },
  { mime: 'audio/webm', codec: 'opus' },
];

/** Erstes unterstütztes Format, oder `null` (kein `MediaRecorder` bzw. kein passender Typ, z. B. nur Ogg) */
export function pickRecorderFormat(
  isTypeSupported: ((mime: string) => boolean) | undefined,
): RecorderFormat | null {
  if (!isTypeSupported) return null;
  for (const candidate of CANDIDATES) {
    try {
      if (isTypeSupported(candidate.mime)) return candidate;
    } catch {
      // Ein Browser, der bei unbekannten Typen wirft: nächster Kandidat
    }
  }
  return null;
}

/** Basistyp ohne Parameter, wie ihn der Core als `Content-Type` der Chunks erwartet */
export function baseMime(mime: string): string {
  return (mime.split(';')[0] ?? '').trim().toLowerCase();
}
