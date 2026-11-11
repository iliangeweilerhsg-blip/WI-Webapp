// Absicht, aufzunehmen (UX-03): Wer „Start“ drückt, hat das Mikrofon schon gewollt. Der Klick liegt vor der Navigation
// ins Dashboard; dort genügt diese Absicht (kurz zuvor), damit die Aufnahme ohne zweiten Klick beginnt. Nur im Speicher
// dieses Tabs. Gelesen, nicht verbraucht (StrictMode ruft Initialisierer doppelt auf).
let intentAt: number | null = null;

/** Vermerkt: Der Nutzer hat gerade eine Session gestartet */
export function noteMicIntent(): void {
  intentAt = Date.now();
}

/** Liegt die letzte Startgeste höchstens `maxAgeMs` zurück? */
export function hasMicIntent(maxAgeMs = 60_000): boolean {
  return intentAt !== null && Date.now() - intentAt <= maxAgeMs;
}

/** Nur für Tests */
export function resetMicIntent(): void {
  intentAt = null;
}
