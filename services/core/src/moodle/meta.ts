// `config/moodle.json`: Metadaten zum Moodle-Zugang, ohne Token (08 §9.1)
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

const MoodleMetaSchema = z.object({
  site_url: z.string().url().optional(),
  user_id: z.number().int().positive().optional(),
  token_valid_until: z.iso.date().optional(),
  created_at: z.string().optional(),
});

export type MoodleMeta = z.infer<typeof MoodleMetaSchema>;

export function moodleMetaPath(dataDir: string): string {
  return join(dataDir, 'config', 'moodle.json');
}

/**
 * Liest `config/moodle.json`. Fehlt die Datei oder ist sie kaputt, ist das Ergebnis `{}`:
 * Der Zugang funktioniert auch ohne Metadaten, nur das Ablaufdatum ist dann unbekannt.
 * Unbekannte Felder werden ignoriert. Ein Feld `token` wird nie gelesen.
 */
export async function readMoodleMeta(dataDir: string): Promise<MoodleMeta> {
  let raw: string;
  try {
    raw = await readFile(moodleMetaPath(dataDir), 'utf8');
  } catch {
    return {};
  }
  try {
    const parsed = MoodleMetaSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}
