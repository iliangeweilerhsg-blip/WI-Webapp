// Private Zwischenablage für Dumps (Sicherheit, docs/VERTRAEGE.md §13).
//
// Das Backup-Ziel kann für Dritte beschreibbar sein (externer Datenträger, iCloud-Ordner, Netzlaufwerk). Wer die
// Prüfsumme einer Datei über ihren Pfad bildet und die Datei danach über denselben Pfad erneut öffnet (`pg_restore`,
// Kopie), lässt eine Lücke, in der die Datei getauscht werden kann (TOCTOU). `pg_restore` führt SQL als Superuser aus.
// Darum gilt überall:
//   - Eine Datei wird **einmal** geöffnet. Aus diesem einen Lesevorgang entstehen Prüfsumme und Kopie.
//   - Die Kopie liegt in einem privaten Ordner (`<Datenordner>/tmp/…`, Ordner 0700, Datei 0600), den kein Dritter
//     beschreiben kann. Erst nach dem Vergleich der Prüfsumme wird **genau diese Kopie** weiterverwendet.
//   - Die Kopie wird danach immer gelöscht.
import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  rmSync,
  statfsSync,
  statSync,
  writeSync,
} from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { NEW_FILE_FLAGS, READ_FLAGS } from './nofollow.ts';

/** Ein Stand lässt sich nicht verwenden. `reason` entspricht `RestoreTestReason` (docs/VERTRAEGE.md §13). */
export class StandError extends Error {
  readonly reason: 'nicht_authentisch' | 'beschaedigt';
  constructor(reason: 'nicht_authentisch' | 'beschaedigt', message: string) {
    super(message);
    this.name = 'StandError';
    this.reason = reason;
  }
}

export const STAGE_ROOT = 'tmp';
const STALE_MS = 86_400_000;

/** Legt einen privaten Ordner an (0700) und räumt alte, übrig gebliebene Ordner desselben Zwecks auf */
export function makePrivateDir(dataDir: string, purpose: 'restore' | 'backup'): string {
  const root = join(dataDir, STAGE_ROOT);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  chmodSync(root, 0o700);
  try {
    for (const name of readdirSync(root)) {
      if (!name.startsWith(`${purpose}-`)) continue;
      const path = join(root, name);
      if (Date.now() - statSync(path).mtimeMs > STALE_MS) rmSync(path, { recursive: true, force: true });
    }
  } catch {
    // Aufräumen ist nur eine Zugabe
  }
  const dir = mkdtempSync(join(root, `${purpose}-`));
  chmodSync(dir, 0o700);
  return dir;
}

/** `src` ist keine reguläre Datei (FIFO, Gerät, Ordner): Fehlercode für `withVerifiedDump` */
export const NOT_REGULAR = 'SG_NOT_REGULAR';
/** `src` hat nicht die erwartete Größe (oder wächst beim Lesen darüber hinaus): Fehlercode für `withVerifiedDump` */
export const SIZE_MISMATCH = 'SG_SIZE_MISMATCH';

/**
 * So viel Platz bleibt im Datenordner mindestens frei, wenn dort eine Prüfkopie entsteht (M-1, #114): Postgres und
 * der Core liegen oft auf derselben Platte.
 */
export const FREE_RESERVE_BYTES = 512 * 1024 * 1024;

function sizeError(src: string, message: string): Error {
  return Object.assign(new Error(`${src.split('/').pop()} ${message}`), { code: SIZE_MISMATCH });
}

/**
 * Liest `src` genau einmal und schreibt dabei die Kopie `dst` (0600, darf noch nicht existieren). Rückgabe: SHA-256
 * der gelesenen Bytes, also derselben Bytes, die in der Kopie stehen.
 *
 * Weder `src` noch `dst` werden über einen Symlink geöffnet (`O_NOFOLLOW`, Fehler `ELOOP`). `src` muss eine reguläre
 * Datei sein: Eine FIFO oder ein Gerät im Ziel blockiert `open` nicht (`O_NONBLOCK`) und wird per `fstat`
 * abgewiesen (Fehlercode `NOT_REGULAR`). `dst` entsteht exklusiv (`O_EXCL`), synchron über `openDst`, wenn
 * angegeben (`NoFollowWriter.openNew`: im verankerten Ordner, nie über einen Pfad im Ziel). Geschrieben wird nur über
 * den Deskriptor.
 *
 * Mit `expectedBytes` (M-1, #114) muss `src` laut `fstat` genau so groß sein, sonst entsteht `dst` gar nicht erst
 * (Fehlercode `SIZE_MISMATCH`). Wächst die Datei beim Lesen über diese Größe hinaus, bricht das Kopieren sofort ab:
 * Eine riesige oder sparse Datei im Ziel füllt so nie die Platte, bevor die Prüfsumme verglichen ist.
 */
export async function copyAndHash(
  src: string,
  dst: string,
  openDst?: () => number,
  expectedBytes?: number,
): Promise<string> {
  const hash = createHash('sha256');
  const input = await open(src, READ_FLAGS);
  try {
    const info = await input.stat();
    if (!info.isFile()) {
      throw Object.assign(new Error(`${src.split('/').pop()} ist keine reguläre Datei.`), {
        code: NOT_REGULAR,
      });
    }
    if (expectedBytes !== undefined && info.size !== expectedBytes) {
      throw sizeError(src, `ist ${info.size} Bytes groß, erwartet sind ${expectedBytes} Bytes.`);
    }
    const output = openDst ? openDst() : openSync(dst, NEW_FILE_FLAGS, 0o600);
    try {
      const buffer = Buffer.allocUnsafe(1024 * 1024);
      let total = 0;
      for (;;) {
        // Nie mehr als ein Byte über die erwartete Größe hinaus lesen
        const want =
          expectedBytes === undefined ? buffer.length : Math.min(buffer.length, expectedBytes - total + 1);
        const { bytesRead } = await input.read(buffer, 0, want, null);
        if (bytesRead === 0) break;
        total += bytesRead;
        if (expectedBytes !== undefined && total > expectedBytes) {
          throw sizeError(src, `wächst beim Lesen über die erwarteten ${expectedBytes} Bytes hinaus.`);
        }
        const chunk = buffer.subarray(0, bytesRead);
        hash.update(chunk);
        let offset = 0;
        while (offset < chunk.length) offset += writeSync(output, chunk, offset, chunk.length - offset);
      }
      if (expectedBytes !== undefined && total !== expectedBytes) {
        throw sizeError(src, `ist beim Lesen kürzer als die erwarteten ${expectedBytes} Bytes.`);
      }
    } finally {
      closeSync(output);
    }
  } finally {
    await input.close();
  }
  return hash.digest('hex');
}

/** Freier Platz für den aktuellen Benutzer im Dateisystem von `dir` (`undefined`: nicht feststellbar) */
export function freeBytes(dir: string): number | undefined {
  try {
    const info = statfsSync(dir);
    return info.bavail * info.bsize;
  } catch {
    return undefined;
  }
}

/** Was vom Dump erwartet wird: Prüfsumme und Größe in Bytes (beides aus dem Manifest, ggf. gegen `backup_run` geprüft) */
export interface ExpectedDump {
  sha256: string;
  bytes: number;
}

/**
 * Kopiert den Dump in einen privaten Ordner, vergleicht dabei die Prüfsumme mit `expected.sha256` und ruft `fn` mit
 * dem Pfad der **Kopie** auf. Stimmt die Prüfsumme nicht, wird `fn` nicht aufgerufen (`StandError`). Die Kopie
 * wird in jedem Fall gelöscht.
 *
 * Größengrenze (M-1, #114): Die Datei muss genau `expected.bytes` groß sein, sonst wird nichts kopiert
 * (`StandError('beschaedigt')`). Ohne gültige Größe wird nicht kopiert (fail-closed). Passt die Kopie nicht mit
 * `FREE_RESERVE_BYTES` Rest auf die Platte des Datenordners, bricht der Lauf vorher mit klarer Meldung ab.
 * `free` ist nur für Tests austauschbar.
 */
export async function withVerifiedDump<T>(
  dataDir: string,
  src: string,
  expected: ExpectedDump,
  label: string,
  fn: (verifiedCopy: string) => Promise<T>,
  free: (dir: string) => number | undefined = freeBytes,
): Promise<T> {
  const name = src.split('/').pop();
  if (!Number.isSafeInteger(expected.bytes) || expected.bytes <= 0) {
    throw new StandError(
      'beschaedigt',
      `Das Manifest des Standes ${label} nennt keine gültige Größe für ${name}. Der Stand ist beschädigt.`,
    );
  }
  const dir = makePrivateDir(dataDir, 'restore');
  try {
    const available = free(dir);
    if (available !== undefined && expected.bytes + FREE_RESERVE_BYTES > available) {
      throw new Error(
        `Für die Prüfkopie von ${name} ist im Datenordner zu wenig Platz frei (nötig: ${expected.bytes} Bytes plus ${FREE_RESERVE_BYTES} Bytes Reserve, frei: ${available} Bytes). Es wurde nichts kopiert.`,
      );
    }
    const copy = join(dir, `dump-${randomBytes(4).toString('hex')}.dump`);
    let sha: string;
    try {
      sha = await copyAndHash(src, copy, undefined, expected.bytes);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT')
        throw new StandError('beschaedigt', `Im Stand ${label} fehlt ${src.split('/').pop()}.`);
      // Symlink, FIFO oder Gerät statt Datei: so legt `sg backup` nie einen Stand an
      if (code === 'ELOOP' || code === NOT_REGULAR) {
        throw new StandError(
          'beschaedigt',
          `Im Stand ${label} ist ${src.split('/').pop()} keine reguläre Datei. Der Stand ist beschädigt.`,
        );
      }
      if (code === SIZE_MISMATCH) {
        throw new StandError(
          'beschaedigt',
          `Im Stand ${label} hat ${name} nicht die Größe aus dem Manifest (${(error as Error).message}). Der Stand ist beschädigt, es wurde nichts eingespielt.`,
        );
      }
      throw error;
    }
    if (sha !== expected.sha256) {
      throw new StandError(
        'beschaedigt',
        `Die Prüfsumme von ${src.split('/').pop()} im Stand ${label} stimmt nicht. Der Stand ist beschädigt.`,
      );
    }
    return await fn(copy);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
