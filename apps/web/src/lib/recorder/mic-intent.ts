// Absicht, aufzunehmen (UX-03): Wer „Start“ drückt, hat das Mikrofon schon gewollt. Der Klick liegt vor der Navigation
// ins Dashboard; dort genügt diese Absicht (kurz zuvor), damit die Aufnahme ohne zweiten Klick beginnt. Nur im Speicher
// dieses Tabs und nur für die gestartete Session: Eine andere Session (z. B. nach einem gescheiterten Start) braucht
// weiterhin „Aufnahme starten“. Gelesen, nicht verbraucht (StrictMode ruft Initialisierer doppelt auf).
let intent: { sessionId: string; at: number } | null = null;

/** Vermerkt: Der Nutzer hat gerade diese Session gestartet */
export function noteMicIntent(sessionId: string): void {
  intent = { sessionId, at: Date.now() };
}

/** Liegt die letzte Startgeste für diese Session höchstens `maxAgeMs` zurück? */
export function hasMicIntent(sessionId: string, maxAgeMs = 60_000): boolean {
  return intent !== null && intent.sessionId === sessionId && Date.now() - intent.at <= maxAgeMs;
}

/** Nur für Tests */
export function resetMicIntent(): void {
  intent = null;
}
