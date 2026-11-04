// Tafel-Fotos (VERTRAEGE §7.4, §11.3, §16.2). Gerüst aus T1-DB, füllt Core-Ink.
// upsertPhotoMeta (Op `photo.add`) und storePhotoFile (`PUT /photos/{id}/file`) prüfen sich gegenseitig (sha256, Typ).
import type { Readable } from 'node:stream';
import type { FileReceipt, PhotoAddData, PhotoMime } from '@sg/shared';
import type { Tx } from '../db/client.ts';

/** `photo`-Zeile anlegen (idempotent über `photo_id`), `has_file` aus der Ablage */
export async function upsertPhotoMeta(_tx: Tx, _data: PhotoAddData): Promise<void> {
  throw new Error('nicht umgesetzt');
}

/** Datei nach `media/photos/<id>.<ext>` schreiben (`.part`, sha256 prüfen, umbenennen) */
export async function storePhotoFile(
  _id: string,
  _stream: Readable,
  _sha256: string,
  _mime: PhotoMime,
): Promise<FileReceipt> {
  throw new Error('nicht umgesetzt');
}
