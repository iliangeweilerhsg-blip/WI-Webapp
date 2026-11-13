// Kennzahlen für die Messskripte unter test/perf.

/** Ziel für ⌘K (10-UMSETZUNG §3, Phase 2) */
export const TARGET_MS = 300;

/** Perzentil nach dem Verfahren „nächster Rang“ (p zwischen 0 und 1) */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(p * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1] as number;
}

export interface Summary {
  n: number;
  p50: number;
  p95: number;
  max: number;
}

export function summarize(values: number[]): Summary {
  return {
    n: values.length,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: values.length === 0 ? Number.NaN : Math.max(...values),
  };
}
