'use client';

import {
  formatSize,
  isStorageLow,
  lecturesThatFit,
  STORAGE_MIN_FREE_BYTES,
  useSystemStorage,
} from '../../lib/storage.ts';

/**
 * Speicherplatz in Einstellungen → Daten (UX-11): belegt (Daten plus Datenbank) und frei, darunter die Aufteilung,
 * soweit der Core sie liefert. Fehlt die Antwort (etwa ein älterer Core), zeigt der Bereich nichts.
 */
export function StorageInfo() {
  const storage = useSystemStorage();
  const data = storage.data;
  if (!data) return null;
  const used = data.data_dir_size_bytes + (data.db_bytes ?? 0);
  const parts: Array<[string, number]> = [];
  if (data.media_bytes !== undefined) parts.push(['Aufnahmen, Folien und Notizen', data.media_bytes]);
  if (data.vault_bytes !== undefined) parts.push(['Vault', data.vault_bytes]);
  if (data.db_bytes !== undefined) parts.push(['Datenbank', data.db_bytes]);
  const fit = lecturesThatFit(data.data_dir_free_bytes);
  return (
    <div className="space-y-1" aria-labelledby="storage-title">
      <h3 id="storage-title" className="text-md font-semibold">
        Speicherplatz
      </h3>
      <p className="text-sm">
        Belegt: {formatSize(used)}. Frei auf dem Mac: {formatSize(data.data_dir_free_bytes)}.
      </p>
      <p className="text-sm text-text-muted">
        {fit < 1
          ? 'Das reicht nicht für eine ganze Vorlesung Audio.'
          : `Das reicht für etwa ${fit} ${fit === 1 ? 'Vorlesung' : 'Vorlesungen'} Audio.`}
        {isStorageLow(data.data_dir_free_bytes)
          ? ` Empfohlen sind mindestens ${formatSize(STORAGE_MIN_FREE_BYTES)} frei, damit macOS, Datenbank, Backups und Verarbeitung Luft haben. Räume Platz frei, bevor du aufnimmst.`
          : ''}
      </p>
      {parts.length > 0 ? (
        <ul className="text-sm text-text-muted">
          {parts.map(([label, bytes]) => (
            <li key={label}>
              {label}: {formatSize(bytes)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
