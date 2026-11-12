// Tunnel-Schlüssel je Gerät (UX-12, docs/plaene/UX-12-MAC-WIEDERFINDEN.md E3, E8, §5.1; VERTRAEGE §12 Schritt 8).
//
// Jedes gekoppelte Gerät bekommt bei `pair/confirm` einen eigenen `tunnel_key` (32 Byte Zufall). Der Core legt ihn
// **nur** in `<SG_DATA_DIR>/secrets/tunnel-keys.json` ab (Datei 0600, Ordner 0700), nie in Postgres, nie im Backup.
// Den Helfer `sg-tunnel` (PR 3) liest nur diese Datei. Der Core gibt die Schlüssel über keine Route heraus.
//
// Diese Datei enthält zwei Dinge:
// 1. Die Ableitungen (Dienstname, PSK, PSK-Kennung). Dieselben Testvektoren nutzen PR 3 und PR 4 in Swift.
// 2. Die Schlüsseldatei (`TunnelKeyStore`): ein Schreiber, atomar, mit Rechte- und Symlink-Prüfung.
import { createHmac, randomBytes } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { chmod, lstat, mkdir, open, rename, rm, unlink, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

/** Tunnel-Schlüssel: 32 Byte Zufall, base64url ohne Padding = genau 43 Zeichen (`PairResponse.tunnel_key`) */
export const TUNNEL_KEY_RE = /^[A-Za-z0-9_-]{43}$/;

/** Feste PSK-Kennung (E13). Bei TLS 1.2 geht sie im Klartext über den Funk, darum nie eine `device_id` */
export const TUNNEL_PSK_IDENTITY = 'sg1';

/** Bonjour-Diensttyp des Helfers */
export const TUNNEL_SERVICE_TYPE = '_sg-tunnel._tcp';

const NAME_LABEL = 'sg-tunnel-name-v1';
const PSK_LABEL = 'sg-tunnel-psk-v1';

/** Neuer Tunnel-Schlüssel aus `crypto.randomBytes` (256 Bit). Wird nur einmal ausgegeben, nie geloggt */
export function generateTunnelKey(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Die 32 Rohbytes hinter dem base64url-Text. Alle Ableitungen nehmen **diese** Bytes als HMAC-Schlüssel, nicht den
 * Text (der Swift-Teil decodiert den Text ebenso).
 */
function keyBytes(tunnelKey: string): Buffer {
  if (!TUNNEL_KEY_RE.test(tunnelKey))
    throw new Error('Der Tunnel-Schlüssel hat nicht das Format aus PairResponse.');
  const bytes = Buffer.from(tunnelKey, 'base64url');
  if (bytes.length !== 32) throw new Error('Der Tunnel-Schlüssel muss 32 Byte lang sein.');
  // Nur die kanonische Schreibweise: Das 43. Zeichen trägt 2 überzählige Bits. Node ignoriert sie, andere Decoder
  // (Swift im Helfer und am iPad) lehnen sie womöglich ab. Sonst ergäben zwei Texte dieselben Rohbytes
  if (bytes.toString('base64url') !== tunnelKey)
    throw new Error('Der Tunnel-Schlüssel ist nicht kanonisch kodiert.');
  return bytes;
}

/** `"sg-" + hex(HMAC-SHA256(tunnel_key, "sg-tunnel-name-v1"))[0..16]` (E4). Enthält keinen Rechnernamen */
export function tunnelServiceName(tunnelKey: string): string {
  const mac = createHmac('sha256', keyBytes(tunnelKey)).update(NAME_LABEL, 'utf8').digest('hex');
  return `sg-${mac.slice(0, 16)}`;
}

/** `HMAC-SHA256(tunnel_key, "sg-tunnel-psk-v1")` als 32 rohe Byte (E3) */
export function tunnelPsk(tunnelKey: string): Buffer {
  return createHmac('sha256', keyBytes(tunnelKey)).update(PSK_LABEL, 'utf8').digest();
}

/** Pfad des Tunnel-Eingangs (Unix-Socket, Rechte 0600, Ordner 0700) */
export function tunnelSocketPath(dataDir: string): string {
  return join(dataDir, 'run', 'tunnel.sock');
}

/** Format der `device_id` in der Schlüsseldatei (UUID, klein geschrieben, wie `uuidv7()` sie erzeugt) */
const DEVICE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const KeyFileSchema = z
  .object({
    v: z.literal(1),
    devices: z.array(
      z
        .object({
          device_id: z.string().regex(DEVICE_ID_RE),
          tunnel_key: z.string().regex(TUNNEL_KEY_RE),
        })
        .strict(),
    ),
  })
  .strict();

/** Inhalt der Schlüsseldatei (Format: `{ v: 1, devices: [{ device_id, tunnel_key }] }`) */
export type TunnelKeyFile = z.infer<typeof KeyFileSchema>;

export interface TunnelKeyStoreOptions {
  dataDir: string;
  /** Nur Meldungen ohne Schlüssel. Fehlt der Logger, bleibt alles still */
  logger?: {
    warn: (fields: object, message: string) => void;
    error: (fields: object, message: string) => void;
    info?: (fields: object, message: string) => void;
  };
}

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** Besitzer prüfen, wo es das System kennt (nicht unter Windows) */
function ownedByUs(info: Stats): boolean {
  const uid = process.getuid?.();
  return uid === undefined || info.uid === uid;
}

/**
 * Die Schlüsseldatei des Core. Genau ein Schreiber: Alle Änderungen laufen nacheinander durch eine Warteschlange
 * (`queue`), jede schreibt die ganze Datei atomar neu (Temp-Datei 0600, `fsync`, `rename`). Der Core hält die
 * Einträge zusätzlich im Speicher, um die Datei neu schreiben zu können.
 */
export class TunnelKeyStore {
  readonly dir: string;
  readonly file: string;
  private readonly entries = new Map<string, string>();
  private readonly logger: NonNullable<TunnelKeyStoreOptions['logger']> | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<() => void>();
  /**
   * Geräte, deren Schlüssel dieser Prozess eingetragen hat. Der Abgleich beim Start lässt sie stehen: `pair/confirm`
   * schreibt den Schlüssel **vor** dem Gerät in Postgres, ein Abgleich mit einer Geräteliste von kurz davor hielte ihn
   * sonst für verwaist. Scheitert das Anlegen, entfernt die Route den Eintrag selbst (sonst der nächste Start).
   */
  private readonly addedHere = new Set<string>();
  private loaded = false;

  constructor(options: TunnelKeyStoreOptions) {
    this.dir = join(options.dataDir, 'secrets');
    this.file = join(this.dir, 'tunnel-keys.json');
    this.logger = options.logger;
  }

  /** Anzahl der Geräte mit Schlüssel */
  get size(): number {
    return this.entries.size;
  }

  /** Geräte mit Schlüssel (ohne die Schlüssel) */
  deviceIds(): string[] {
    return [...this.entries.keys()];
  }

  /** Ruft `listener` nach jeder Änderung der Schlüsselliste auf. Rückgabe: Abmelden */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Läuft nacheinander: ein Schreiber. Ein Fehler stoppt die Kette nicht, der Aufrufer bekommt ihn */
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        // Ein Zuhörer darf das Schreiben nicht stören
      }
    }
  }

  /**
   * Der Ordner `secrets/` muss ein echter Ordner sein (kein Symlink), uns gehören und 0700 haben. Fehlt er, wird er
   * angelegt. Ein Symlink oder ein fremder Besitzer ist ein Fehler: Wir schreiben dort keine Schlüssel hin.
   */
  private async ensureDir(): Promise<void> {
    const info = await lstat(this.dir).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (info === null) {
      await mkdir(this.dir, { mode: DIR_MODE, recursive: true });
      // `mode` unterliegt der umask und gilt bei `recursive` nur für den letzten Ordner nicht immer: nachziehen
      await chmod(this.dir, DIR_MODE);
    }
    const checked = await lstat(this.dir);
    if (checked.isSymbolicLink() || !checked.isDirectory()) {
      throw new Error(
        'secrets/ ist kein echter Ordner (Symlink?). Der Core schreibt dort keine Tunnel-Schlüssel.',
      );
    }
    if (!ownedByUs(checked)) {
      throw new Error(
        'secrets/ gehört einem anderen Benutzer. Der Core schreibt dort keine Tunnel-Schlüssel.',
      );
    }
    if ((checked.mode & 0o077) !== 0) await chmod(this.dir, DIR_MODE);
  }

  /**
   * Liest die Datei in den Speicher (beim Start). Fehlt sie, ist die Liste leer. Ist sie unlesbar oder kaputt, bleibt
   * die Liste leer und die Datei wird beim nächsten Schreiben ersetzt (sicherer Ausfall: lieber neu koppeln als einen
   * Schlüssel raten). Zu offene Rechte werden auf 0600 gesetzt. Rückgabe: Anzahl der Einträge.
   */
  load(): Promise<number> {
    return this.serial(async () => {
      this.loaded = true;
      return this.readIntoMemory();
    });
  }

  /** Vor der ersten Änderung ohne `load()` (Tests): erst lesen, damit `add` nichts überschreibt */
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    await this.readIntoMemory();
  }

  private async readIntoMemory(): Promise<number> {
    this.entries.clear();
    // Auch zum Lesen: kein Symlink als Ordner, kein fremder Besitzer. Sonst läse der Core Einträge von dort
    const dirInfo = await lstat(this.dir).catch(() => null);
    if (dirInfo === null) return 0;
    if (dirInfo.isSymbolicLink() || !dirInfo.isDirectory() || !ownedByUs(dirInfo)) {
      this.logger?.error(
        {},
        'secrets/ ist kein eigener, echter Ordner (Symlink oder fremder Besitzer): die Schlüsseldatei wird ignoriert',
      );
      return 0;
    }
    if ((dirInfo.mode & 0o077) !== 0) await chmod(this.dir, DIR_MODE).catch(() => undefined);
    const info = await lstat(this.file).catch(() => null);
    if (info === null) return 0;
    if (info.isSymbolicLink() || !info.isFile()) {
      this.logger?.error({}, 'Tunnel-Schlüsseldatei ist keine reguläre Datei und wird ignoriert');
      return 0;
    }
    if ((info.mode & 0o077) !== 0) {
      this.logger?.warn(
        { mode: (info.mode & 0o777).toString(8) },
        'Tunnel-Schlüsseldatei hatte zu offene Rechte',
      );
      await chmod(this.file, FILE_MODE).catch(() => undefined);
    }
    let handle: FileHandle | undefined;
    try {
      // Nie einem Symlink folgen, der zwischen `lstat` und dem Öffnen ausgetauscht wurde
      handle = await open(this.file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const parsed = KeyFileSchema.parse(JSON.parse(await handle.readFile('utf8')));
      for (const item of parsed.devices) this.entries.set(item.device_id, item.tunnel_key);
    } catch {
      // Keine Details: sie könnten Teile der Datei enthalten
      this.logger?.error(
        {},
        'Tunnel-Schlüsseldatei ist unlesbar oder hat ein falsches Format und wird ersetzt',
      );
      this.entries.clear();
    } finally {
      await handle?.close();
    }
    return this.entries.size;
  }

  /**
   * Schreibt den aktuellen Stand atomar: Temp-Datei (0600, `O_EXCL`), `fsync`, `rename`, `fsync` des Ordners.
   * Gibt im Fehlerfall die Temp-Datei frei und wirft.
   */
  private async persist(): Promise<void> {
    await this.ensureDir();
    const body: TunnelKeyFile = {
      v: 1,
      devices: [...this.entries].map(([device_id, tunnel_key]) => ({ device_id, tunnel_key })),
    };
    const tmp = join(this.dir, `.tunnel-keys.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
    let handle: FileHandle | undefined;
    try {
      // `wx` = O_CREAT | O_EXCL: scheitert, wenn dort schon etwas liegt (auch ein Symlink)
      handle = await open(tmp, 'wx', FILE_MODE);
      await handle.writeFile(`${JSON.stringify(body)}\n`, 'utf8');
      // Die umask darf die Rechte nur verringern, nie erweitern: trotzdem ausdrücklich setzen
      await handle.chmod(FILE_MODE);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(tmp, this.file);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await unlink(tmp).catch(() => undefined);
      throw error;
    }
    // Der Ordner wird nachgezogen, damit der Eintrag einen Absturz überlebt (nicht überall möglich)
    const dirHandle = await open(this.dir, constants.O_RDONLY).catch(() => undefined);
    if (dirHandle) {
      await dirHandle.sync().catch(() => undefined);
      await dirHandle.close().catch(() => undefined);
    }
  }

  /**
   * Trägt den Schlüssel eines Geräts ein und schreibt die Datei. Wirft, wenn das Schreiben scheitert (dann scheitert
   * die Kopplung, VERTRAEGE §12 Schritt 8). Bei einem Fehler bleibt die Liste im Speicher unverändert.
   */
  async add(deviceId: string, tunnelKey: string): Promise<void> {
    keyBytes(tunnelKey); // Format prüfen, bevor etwas geschrieben wird
    // Eine ID, die `load()` nicht annähme, machte die ganze Datei beim nächsten Start „kaputt“ (alle Schlüssel weg)
    if (!DEVICE_ID_RE.test(deviceId)) throw new Error('Die Geräte-ID hat nicht das Format einer UUID.');
    return this.serial(async () => {
      await this.ensureLoaded();
      const before = this.entries.get(deviceId);
      this.entries.set(deviceId, tunnelKey);
      try {
        await this.persist();
      } catch (error) {
        if (before === undefined) this.entries.delete(deviceId);
        else this.entries.set(deviceId, before);
        throw error;
      }
      this.addedHere.add(deviceId);
      this.notify();
    });
  }

  /** Entfernt den Schlüssel eines Geräts und schreibt die Datei. `true`, wenn es einen Eintrag gab */
  remove(deviceId: string): Promise<boolean> {
    return this.serial(async () => {
      await this.ensureLoaded();
      const before = this.entries.get(deviceId);
      if (before === undefined) return false;
      this.entries.delete(deviceId);
      try {
        await this.persist();
      } catch (error) {
        this.entries.set(deviceId, before);
        throw error;
      }
      this.notify();
      return true;
    });
  }

  /**
   * Abgleich beim Start: Einträge ohne aktives Gerät fliegen raus. Aktive Geräte ohne Eintrag (vor UX-12 gekoppelt,
   * oder nach einer Wiederherstellung) bekommen **keinen** neuen Schlüssel, sie müssen neu koppeln.
   * Rückgabe: wie viele Einträge entfernt wurden und wie viele aktive Geräte ohne Schlüssel sind.
   */
  reconcile(activeDeviceIds: Iterable<string>): Promise<{ removed: number; withoutKey: number }> {
    const active = new Set(activeDeviceIds);
    return this.serial(async () => {
      await this.ensureLoaded();
      // Eigene, frische Einträge nie als verwaist werten (Kopplung läuft womöglich gerade, siehe `addedHere`)
      const stale = [...this.entries.keys()].filter((id) => !active.has(id) && !this.addedHere.has(id));
      const withoutKey = [...active].filter((id) => !this.entries.has(id)).length;
      if (stale.length > 0) {
        const backup = new Map(this.entries);
        for (const id of stale) this.entries.delete(id);
        try {
          await this.persist();
        } catch (error) {
          this.entries.clear();
          for (const [id, key] of backup) this.entries.set(id, key);
          throw error;
        }
        this.notify();
      }
      return { removed: stale.length, withoutKey };
    });
  }

  /** `SG_TUNNEL=0`: die Datei wird nicht geschrieben und beim Start gelöscht */
  deleteFile(): Promise<void> {
    return this.serial(async () => {
      this.entries.clear();
      this.loaded = true;
      // `force`: kein Fehler, wenn es sie nicht gibt. Ein Symlink wird selbst entfernt, nie sein Ziel
      await rm(this.file, { force: true });
      this.notify();
    });
  }
}
