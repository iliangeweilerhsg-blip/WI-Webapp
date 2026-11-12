// Upload-Speicher für Moodle-Aktionen (08 §9.3, Plan T1-24 §3.4 und §5.3).
// Dateien liegen unter `<dataDir>/tmp/moodle-uploads/<uuid>`, nur im Speicher des Core verzeichnet, werden nie
// ausgeliefert und nicht gesichert (`sg backup` kopiert nur `media/` und `vault/`). Ein Neustart verwirft alles.
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { chmod, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { HttpError } from '../errors.ts';
import { sanitizeFilename } from './content-disposition.ts';
import { uuidv7 } from '../lib/uuid7.ts';

/** Größte einzelne Datei (Vertrag, 08 §9.3) */
export const MAX_UPLOAD_FILE_BYTES = 100 * 1024 * 1024;
/** Höchstens so viele offene Uploads, laufende zählen mit */
export const MAX_OPEN_UPLOADS = 20;
/** Höchstens so viele Byte aller offenen Uploads zusammen, laufende zählen mit (reservierte Obergrenze) */
export const MAX_OPEN_UPLOAD_BYTES = 500 * 1024 * 1024;
/** So lange bleibt ein Upload gültig */
export const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
/** Längster Dateiname in Byte (UTF-8) */
export const MAX_UPLOAD_FILENAME_BYTES = 255;

export type UploadKind = 'pdf' | 'png' | 'jpeg' | 'zip' | 'text';

export interface StoredUpload {
  /** UUIDv7, vom Core vergeben */
  id: string;
  /** `<dataDir>/tmp/moodle-uploads/<id>`, nie aus einer Eingabe gebaut */
  path: string;
  /** Bereinigt (`sanitizeFilename`), höchstens 255 Byte. Nur Anzeige und Name bei Moodle, nie ein Pfad */
  filename: string;
  sizeBytes: number;
  sha256: string;
  kind: UploadKind;
  expiresAt: Date;
}

export interface MoodleUploadStoreOptions {
  dataDir: string;
  now?: () => number;
}

/** Ein reservierter Platz für einen laufenden Upload. `commit` oder `cancel` gibt ihn wieder frei */
export interface UploadSlot {
  /** Vom Core vergeben, auch für den Pfad */
  readonly id: string;
  /** Zielpfad der Datei. Das Verzeichnis existiert (Rechte 0700) */
  readonly path: string;
  /** Macht aus dem Platz einen fertigen Upload. Danach ist der Platz belegt, nicht mehr reserviert */
  commit(file: Omit<StoredUpload, 'id' | 'path' | 'expiresAt'>): StoredUpload;
  /** Gibt den Platz frei (Abbruch, Fehler). Mehrfacher Aufruf schadet nicht. Die Datei löscht der Aufrufer */
  cancel(): void;
}

export function uploadsDir(dataDir: string): string {
  return join(dataDir, 'tmp', 'moodle-uploads');
}

export class MoodleUploadStore {
  readonly dir: string;
  private readonly now: () => number;
  private readonly files = new Map<string, StoredUpload>();
  /** Laufende Uploads: Kennung → reservierte Byte */
  private readonly reserved = new Map<string, number>();
  /** Uploads in Benutzung: Kennung → Anzahl der Aktionen, die sie gerade lesen */
  private readonly inUse = new Map<string, number>();
  private ready: Promise<void> = Promise.resolve();

  constructor(options: MoodleUploadStoreOptions) {
    this.dir = uploadsDir(options.dataDir);
    this.now = options.now ?? Date.now;
  }

  /** Leert das Verzeichnis und legt es mit 0700 neu an. Beim Start des Core (E4) */
  reset(): Promise<void> {
    this.files.clear();
    this.reserved.clear();
    this.inUse.clear();
    const run = (async () => {
      await rm(this.dir, { recursive: true, force: true });
      await this.ensureDir();
    })();
    this.ready = run.catch(() => {});
    return run;
  }

  /** Läuft gerade ein `reset`, wartet das darauf. Uploads dürfen nie in ein Verzeichnis schreiben, das gleich geleert wird */
  whenReady(): Promise<void> {
    return this.ready;
  }

  async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    // `mkdir` beachtet die umask und ändert ein vorhandenes Verzeichnis nicht
    await chmod(this.dir, 0o700);
  }

  /** Anzahl offener Uploads einschließlich laufender (für Tests und Anzeige) */
  get openCount(): number {
    return this.files.size + this.reserved.size;
  }

  /** Reservierte plus belegte Byte (für Tests) */
  get openBytes(): number {
    let sum = 0;
    for (const file of this.files.values()) sum += file.sizeBytes;
    for (const bytes of this.reserved.values()) sum += bytes;
    return sum;
  }

  /**
   * Reserviert **vor** dem Streamen Anzahl und Byte (laufende Uploads zählen mit), sonst überschreiten viele
   * gleichzeitige Uploads die Grenze, bevor der erste fertig ist. `maxBytes` ist die Obergrenze für diese Datei
   * (bekannte Länge der Anfrage, sonst {@link MAX_UPLOAD_FILE_BYTES}). Zu viele oder zu große: `409 moodle_upload_limit`.
   */
  reserve(maxBytes: number = MAX_UPLOAD_FILE_BYTES): UploadSlot {
    const bytes = Math.min(Math.max(0, Math.floor(maxBytes)), MAX_UPLOAD_FILE_BYTES);
    if (this.openCount >= MAX_OPEN_UPLOADS) {
      throw new HttpError(
        409,
        'moodle_upload_limit',
        `Es sind schon ${MAX_OPEN_UPLOADS} Uploads offen. Bitte zuerst welche entfernen.`,
        { reason: 'count' },
      );
    }
    if (this.openBytes + bytes > MAX_OPEN_UPLOAD_BYTES) {
      throw new HttpError(
        409,
        'moodle_upload_limit',
        `Die offenen Uploads dürfen zusammen höchstens ${MAX_OPEN_UPLOAD_BYTES / (1024 * 1024)} MB groß sein.`,
        { reason: 'bytes' },
      );
    }
    const id = uuidv7(this.now());
    this.reserved.set(id, bytes);
    let done = false;
    return {
      id,
      path: join(this.dir, id),
      commit: (file) => {
        if (done) throw new Error('Der Upload-Platz ist schon abgeschlossen');
        done = true;
        this.reserved.delete(id);
        return this.add({ ...file, id, path: join(this.dir, id) });
      },
      cancel: () => {
        if (done) return;
        done = true;
        this.reserved.delete(id);
      },
    };
  }

  /** Nimmt einen fertigen Upload auf. Der Verfall ist {@link UPLOAD_TTL_MS} nach jetzt */
  add(file: Omit<StoredUpload, 'expiresAt'>): StoredUpload {
    const stored: StoredUpload = { ...file, expiresAt: new Date(this.now() + UPLOAD_TTL_MS) };
    this.files.set(stored.id, stored);
    return stored;
  }

  private find(id: string): StoredUpload | undefined {
    const file = this.files.get(id);
    return file && file.expiresAt.getTime() > this.now() ? file : undefined;
  }

  /**
   * Löst IDs auf. Unbekannt oder verfallen → `404 moodle_upload_not_found`, doppelte ID → `400 validation_failed`.
   * IDs werden nur über die Liste im Speicher aufgelöst, nie zu einem Pfad zusammengesetzt.
   */
  resolve(ids: readonly string[]): StoredUpload[] {
    if (new Set(ids).size !== ids.length) {
      throw new HttpError(400, 'validation_failed', 'Jede Datei darf nur einmal angegeben werden.', {
        in: 'body',
        issues: [{ path: 'params.upload_ids', message: 'doppelte upload_id' }],
      });
    }
    return ids.map((id) => {
      const file = this.find(id);
      if (!file) {
        throw new HttpError(404, 'moodle_upload_not_found', 'Der Upload ist unbekannt oder abgelaufen.', {
          upload_id: id,
        });
      }
      return file;
    });
  }

  /**
   * Löst IDs auf und markiert sie als „in Benutzung“ (alle oder keine). Solange sie so markiert sind, lassen
   * `sweep` und `remove` sie liegen. `release` im `finally` aufrufen, mit denselben IDs.
   */
  acquire(ids: readonly string[]): StoredUpload[] {
    const files = this.resolve(ids);
    for (const file of files) this.inUse.set(file.id, (this.inUse.get(file.id) ?? 0) + 1);
    return files;
  }

  release(ids: readonly string[]): void {
    for (const id of ids) {
      const count = this.inUse.get(id);
      if (count === undefined) continue;
      if (count <= 1) this.inUse.delete(id);
      else this.inUse.set(id, count - 1);
    }
  }

  isInUse(id: string): boolean {
    return this.inUse.has(id);
  }

  /**
   * Entfernt einen Upload samt Datei. `false`, wenn er unbekannt ist. In Benutzung: `409 moodle_upload_in_use`,
   * die Datei bleibt. Ein verfallener Upload ist unbekannt, wird aber trotzdem gelöscht.
   */
  async remove(id: string): Promise<boolean> {
    const file = this.files.get(id);
    if (!file) return false;
    if (this.inUse.has(id)) {
      throw new HttpError(
        409,
        'moodle_upload_in_use',
        'Der Upload wird gerade von einer Aktion gelesen und lässt sich nicht entfernen.',
        { upload_id: id },
      );
    }
    const live = this.find(id) !== undefined;
    this.files.delete(id);
    await rm(file.path, { force: true });
    return live;
  }

  /** Löscht nach erfolgreicher Aktion, was danach nicht mehr in Benutzung ist. Unbekannte IDs werden übergangen */
  async removeUnused(ids: readonly string[]): Promise<void> {
    for (const id of ids) {
      const file = this.files.get(id);
      if (!file || this.inUse.has(id)) continue;
      this.files.delete(id);
      await rm(file.path, { force: true });
    }
  }

  /** Löscht Verfallenes, das nicht in Benutzung ist. Stündlich und vor jedem Upload */
  async sweep(): Promise<void> {
    const now = this.now();
    const expired = [...this.files.values()].filter(
      (f) => f.expiresAt.getTime() <= now && !this.inUse.has(f.id),
    );
    // Erst aus der Liste nehmen (ohne `await` dazwischen), dann die Dateien löschen
    for (const file of expired) this.files.delete(file.id);
    for (const file of expired) await rm(file.path, { force: true });
  }

  /** Dateien im Verzeichnis ohne Eintrag (z. B. nach einem Abbruch mitten im Schreiben). Nur Namen, für Tests */
  async orphans(): Promise<string[]> {
    const names = await readdir(this.dir).catch(() => [] as string[]);
    return names.filter((name) => !this.files.has(name) && !this.reserved.has(name)).sort();
  }
}

// ---------- Annehmen einer Datei ----------

/**
 * Endung → Art. Nur Endungen, deren Inhalt wir prüfen können. Kein HTML, kein SVG.
 * Text nur als `txt`, `md` und `csv` (Startumfang laut Plan T1-24, F2). Weitere Endungen (z. B. Quellcode, Office)
 * kommen erst nach der Entscheidung des Owners zu F2 (Issue #289).
 */
const EXTENSION_KINDS: ReadonlyMap<string, UploadKind> = new Map([
  ['pdf', 'pdf'],
  ['png', 'png'],
  ['jpg', 'jpeg'],
  ['jpeg', 'jpeg'],
  ['zip', 'zip'],
  ['txt', 'text'],
  ['md', 'text'],
  ['csv', 'text'],
]);

/** `%PDF` darf in den ersten 1024 Byte stehen (wie bei den Material-Uploads) */
const MAGIC_WINDOW = 1024;
const PDF_MAGIC = Buffer.from('%PDF');
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

export function uploadKindOf(filename: string): UploadKind | null {
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return null;
  return EXTENSION_KINDS.get(filename.slice(dot + 1).toLowerCase()) ?? null;
}

/** Anfangsbytes passen zur Art. Text wird getrennt über den ganzen Strom geprüft (UTF-8, kein NUL) */
export function matchesMagic(kind: Exclude<UploadKind, 'text'>, head: Buffer): boolean {
  switch (kind) {
    case 'pdf':
      return head.subarray(0, MAGIC_WINDOW).includes(PDF_MAGIC);
    case 'png':
      return head.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC);
    case 'jpeg':
      return head.subarray(0, JPEG_MAGIC.length).equals(JPEG_MAGIC);
    case 'zip':
      // Lokaler Dateikopf oder leeres Archiv
      return (
        head.length >= 4 &&
        head[0] === 0x50 &&
        head[1] === 0x4b &&
        ((head[2] === 0x03 && head[3] === 0x04) || (head[2] === 0x05 && head[3] === 0x06))
      );
  }
}

/**
 * Kürzt auf {@link MAX_UPLOAD_FILENAME_BYTES} Byte, die Endung bleibt. Gekürzt wird je Codepunkt, nie mitten in einem
 * Ersatzpaar (sonst bliebe ein einzelnes Surrogat stehen, das bei Moodle als U+FFFD ankommt)
 */
export function limitFilename(name: string): string {
  if (Buffer.byteLength(name) <= MAX_UPLOAD_FILENAME_BYTES) return name;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot) : '';
  const base = Array.from(dot > 0 ? name.slice(0, dot) : name);
  let bytes = Buffer.byteLength(base.join('')) + Buffer.byteLength(ext);
  while (base.length > 0 && bytes > MAX_UPLOAD_FILENAME_BYTES) {
    bytes -= Buffer.byteLength(base.pop() ?? '');
  }
  return base.join('') + ext;
}

export interface UploadInput {
  /** Name aus dem Formular, roh */
  filename: string | undefined;
  file: AsyncIterable<Buffer> & { truncated?: boolean };
}

async function drain(stream: AsyncIterable<Buffer>): Promise<void> {
  for await (const chunk of stream) void chunk;
}

const typeInvalid = (message: string) => new HttpError(400, 'moodle_upload_type_invalid', message);

/**
 * Schreibt die Datei gestreamt nach `slot.path` (Rechte 0600) und prüft dabei Endung, Anfangsbytes, Größe und
 * Leere. Bei jedem Fehler ist die Teildatei gelöscht. Der Platz bleibt reserviert: Der Aufrufer ruft danach
 * `slot.cancel()` im `finally` auf (nach einem erfolgreichen `commit` tut das nichts).
 * Der `Content-Type` des Browsers zählt nicht.
 */
export async function storeUploadStream(slot: UploadSlot, input: UploadInput): Promise<StoredUpload> {
  const sanitized = sanitizeFilename(input.filename ?? '');
  const filename = sanitized === null ? null : limitFilename(sanitized);
  const kind = filename === null ? null : uploadKindOf(filename);
  if (filename === null || kind === null) {
    await drain(input.file);
    throw typeInvalid(
      'Erlaubt sind PDF, PNG, JPEG, ZIP und Text (UTF-8, .txt, .md, .csv). Die Endung der Datei passt nicht dazu.',
    );
  }
  const hash = createHash('sha256');
  let size = 0;
  let valid = true;
  try {
    await pipeline(
      input.file,
      async function* (source: AsyncIterable<Buffer>) {
        const head: Buffer[] = [];
        let headSize = 0;
        let decided = false;
        const utf8 = kind === 'text' ? new TextDecoder('utf-8', { fatal: true }) : null;
        for await (const chunk of source) {
          hash.update(chunk);
          size += chunk.length;
          // Schon abgelehnt: nur noch mitlesen, damit die Verbindung sauber weiterläuft
          if (!valid) continue;
          if (utf8) {
            try {
              if (chunk.includes(0)) throw new Error('NUL');
              utf8.decode(chunk, { stream: true });
              yield chunk;
            } catch {
              valid = false;
            }
            continue;
          }
          if (decided) {
            yield chunk;
            continue;
          }
          head.push(chunk);
          headSize += chunk.length;
          if (headSize >= MAGIC_WINDOW) {
            decided = true;
            const first = Buffer.concat(head);
            valid = matchesMagic(kind as Exclude<UploadKind, 'text'>, first);
            if (valid) yield first;
          }
        }
        if (utf8) {
          try {
            utf8.decode();
          } catch {
            valid = false;
          }
        } else if (!decided && valid) {
          const first = Buffer.concat(head);
          valid = matchesMagic(kind as Exclude<UploadKind, 'text'>, first);
          if (valid) yield first;
        }
      },
      createWriteStream(slot.path, { flags: 'wx', mode: 0o600 }),
    );
    if (input.file.truncated) {
      throw new HttpError(
        413,
        'file_too_large',
        `Die Datei ist größer als ${MAX_UPLOAD_FILE_BYTES / (1024 * 1024)} MB.`,
      );
    }
    if (size === 0) throw typeInvalid('Die Datei ist leer.');
    if (!valid) throw typeInvalid('Der Inhalt der Datei passt nicht zur Endung.');
  } catch (error) {
    await rm(slot.path, { force: true });
    throw error;
  }
  return slot.commit({ filename, sizeBytes: size, sha256: hash.digest('hex'), kind });
}
