// Layout des Live-Dashboards (F-DSH-01): Vorlagen, Spaltenbreiten und ihre Auflösung aus `module.settings`.
// Reine Funktionen ohne React, damit sie sich ohne Oberfläche testen lassen.
import type { Module } from '@sg/shared';

export type LayoutId = NonNullable<Module['settings']['layout']>;
/** Breiten in Prozent: Folie | Übung | Notizen, Summe 100 (so heißt das Feld `column_widths` im Schema) */
export type Widths = [number, number, number];
export type HandleIndex = 0 | 1;

export interface LayoutPreset {
  id: LayoutId;
  label: string;
  /** Taste für den Wechsel ohne Maus (Akzeptanzkriterium F-DSH-01) */
  key: '1' | '2' | '3' | '4';
  widths: Widths;
}

/**
 * Die Vorlagen aus F-DSH-01. „Standard“ ist festgelegt (50/25/25); bei den anderen nennt die Spezifikation nur den
 * Charakter: „Folie groß“ mit Übung und Notizen als schmale Leiste, „Notizen groß“, „Fokus“ nur die Folie.
 */
export const LAYOUTS: readonly LayoutPreset[] = [
  { id: 'standard', label: 'Standard', key: '1', widths: [50, 25, 25] },
  { id: 'folie_gross', label: 'Folie groß', key: '2', widths: [70, 15, 15] },
  { id: 'notizen_gross', label: 'Notizen groß', key: '3', widths: [25, 15, 60] },
  { id: 'fokus', label: 'Fokus', key: '4', widths: [100, 0, 0] },
];

export const DEFAULT_LAYOUT: LayoutId = 'standard';
/** Schmalste Breite (%), auf die sich eine sichtbare Spalte ziehen lässt */
export const MIN_WIDTH = 8;
/** Die Folie bleibt mindestens so breit (%): schmaler ist sie nicht mehr lesbar */
export const MIN_FOLIE_WIDTH = 25;

export function presetOf(id: LayoutId | undefined | null): LayoutPreset {
  return LAYOUTS.find((l) => l.id === id) ?? LAYOUTS[0]!;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Prüft gespeicherte Breiten: genau drei Zahlen, Summe 100 (±0,5), jede Spalte mindestens `MIN_WIDTH`, die Folie
 * mindestens `MIN_FOLIE_WIDTH`. Alles andere gilt als unbrauchbar (dann gilt die Vorlage).
 */
export function validWidths(value: readonly number[] | undefined | null): value is Widths {
  if (!value || value.length !== 3) return false;
  if (!value.every((n) => Number.isFinite(n) && n >= MIN_WIDTH && n <= 100)) return false;
  if (value[0]! < MIN_FOLIE_WIDTH) return false;
  return Math.abs(value[0]! + value[1]! + value[2]! - 100) <= 0.5;
}

export interface ResolvedLayout {
  layout: LayoutId;
  widths: Widths;
}

/**
 * Wahl für ein Modul: `settings.layout` (sonst der globale Standard `lecture.default_layout`), darin die gezogenen
 * `column_widths`, sonst die Breiten der Vorlage. „Fokus“ zeigt nur die Folie, gezogene Breiten gelten dort nicht.
 */
export function resolveLayout(
  settings: Module['settings'] | undefined,
  defaultLayout: LayoutId | undefined,
): ResolvedLayout {
  const layout = settings?.layout ?? defaultLayout ?? DEFAULT_LAYOUT;
  const preset = presetOf(layout);
  if (preset.id === 'fokus') return { layout: preset.id, widths: [...preset.widths] };
  const custom = settings?.column_widths;
  return { layout: preset.id, widths: validWidths(custom) ? [...custom] : [...preset.widths] };
}

/**
 * Zieht die Trennlinie `handle` um `deltaPct` Prozent: 0 = zwischen Folie und Übung (Notizen bleiben), 1 = zwischen
 * Übung und Notizen (Folie bleibt). Keine Spalte wird schmaler als `MIN_WIDTH`, die Folie nicht als `MIN_FOLIE_WIDTH`; die Summe bleibt 100.
 */
export function dragWidths(start: Widths, handle: HandleIndex, deltaPct: number): Widths {
  const [a, b, c] = start;
  if (handle === 0) {
    const total = a + b;
    const next = Math.min(
      Math.max(a + deltaPct, MIN_FOLIE_WIDTH),
      Math.max(total - MIN_WIDTH, MIN_FOLIE_WIDTH),
    );
    const left = round1(next);
    return [left, round1(total - left), c];
  }
  const total = b + c;
  const next = Math.min(Math.max(b + deltaPct, MIN_WIDTH), Math.max(total - MIN_WIDTH, MIN_WIDTH));
  const mid = round1(next);
  return [a, mid, round1(total - mid)];
}

export function sameWidths(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((n, i) => Math.abs(n - b[i]!) < 0.05);
}
