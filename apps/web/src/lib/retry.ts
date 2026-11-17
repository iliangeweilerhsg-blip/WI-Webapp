// Wartezeit zwischen Wiederholungen eines gescheiterten ersten Ladens (wie `InkColumn`: 1 s, verdoppelt bis 15 s).
export const RETRY_START_MS = 1_000;
export const RETRY_MAX_MS = 15_000;

/** Nächste Wartezeit: verdoppelt, höchstens `RETRY_MAX_MS` */
export const nextRetryDelay = (ms: number) => Math.min(ms * 2, RETRY_MAX_MS);
