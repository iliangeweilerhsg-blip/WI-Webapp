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

/**
 * Liest `src` genau einmal und schreibt dabei die Kopie `dst` (0600, darf noch nicht existieren). Rückgabe: SHA-256
 * der gelesenen Bytes, also derselben Bytes, die in der Kopie stehen.
 *
 * Weder `src` noch `dst` werden über einen Symlink geöffnet (`O_NOFOLLOW`, Fehler `ELOOP`). `src` muss eine reguläre
 * Datei sein: Eine FIFO oder ein Gerät im Ziel blockiert `open` nicht (`O_NONBLOCK`) und wird per `fstat`
 * abgewiesen (Fehlercode `NOT_REGULAR`). `dst` entsteht exklusiv (`O_EXCL`), synchron über `openDst`, wenn
 * angegeben (`NoFollowWriter.openNew`: im verankerten Ordner, nie über einen Pfad im Ziel). Geschrieben wird nur über
 * den Deskriptor.
 */
export async function copyAndHash(src: string, dst: string, openDst?: () => number): Promise<string> {
  const hash = createHash('sha256');
  const input = await open(src, READ_FLAGS);
  try {
    if (!(await input.stat()).isFile()) {
      throw Object.assign(new Error(`${src.split('/').pop()} ist keine reguläre Datei.`), {
        code: NOT_REGULAR,
      });
    }
    const output = openDst ? openDst() : openSync(dst, NEW_FILE_FLAGS, 0o600);
    try {
      const buffer = Buffer.allocUnsafe(1024 * 1024);
      for (;;) {
        const { bytesRead } = await input.read(buffer, 0, buffer.length, null);
        if (bytesRead === 0) break;
        const chunk = buffer.subarray(0, bytesRead);
        hash.update(chunk);
        let offset = 0;
        while (offset < chunk.length) offset += writeSync(output, chunk, offset, chunk.length - offset);
      }
    } finally {
      closeSync(output);
    }
  } finally {
    await input.close();
  }
  return hash.digest('hex');
}

/**
 * Kopiert den Dump in einen privaten Ordner, vergleicht dabei die Prüfsumme mit `expectedSha` und ruft `fn` mit
 * dem Pfad der **Kopie** auf. Stimmt die Prüfsumme nicht, wird `fn` nicht aufgerufen (`StandError`). Die Kopie
 * wird in jedem Fall gelöscht.
 */
export async function withVerifiedDump<T>(
  dataDir: string,
  src: string,
  expectedSha: string,
  label: string,
  fn: (verifiedCopy: string) => Promise<T>,
): Promise<T> {
  const dir = makePrivateDir(dataDir, 'restore');
  try {
    const copy = join(dir, `dump-${randomBytes(4).toString('hex')}.dump`);
    let sha: string;
    try {
      sha = await copyAndHash(src, copy);
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
      throw error;
    }
    if (sha !== expectedSha) {
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
