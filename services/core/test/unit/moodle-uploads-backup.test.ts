// Uploads für Moodle-Aktionen landen nicht im Backup (Plan T1-24 §5.3): `sg backup` kopiert nur `media/` und `vault/`,
// Uploads liegen unter `tmp/moodle-uploads/`.
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MoodleUploadStore, storeUploadStream } from '../../src/moodle/uploads.ts';
import { uploadTmpDir } from '../../src/services/material.ts';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

let dataDir: string;
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sg-moodle-upload-backup-'));
});
afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(relative(dataDir, full).split(sep).join('/'));
  }
  return out;
}

describe('Uploads und Backup', () => {
  it('sg backup kopiert genau media/ und vault/ (Pin auf die Quelle des Backups)', () => {
    const source = readFileSync(join(repoRoot, 'infra', 'sg', 'src', 'backup.ts'), 'utf8');
    const copied = [...source.matchAll(/for \(const sub of \[([^\]]+)\] as const\)/g)].map((m) => m[1]);
    expect(copied).toEqual(["'media', 'vault'"]);
    // und keine Stelle im Backup nennt tmp/ oder die Uploads
    expect(source).not.toMatch(/moodle-uploads/);
    expect(source).not.toMatch(/join\(\s*cfg\.dataDir,\s*['"]tmp['"]/);
  });

  it('ein Upload liegt weder unter media/ noch unter vault/, sondern unter tmp/moodle-uploads/', async () => {
    const store = new MoodleUploadStore({ dataDir });
    await store.reset();
    const slot = store.reserve(100);
    const upload = await storeUploadStream(slot, {
      filename: 'loesung.pdf',
      file: Readable.from([Buffer.from('%PDF-1.7\n')]),
    });
    const relativePath = relative(dataDir, upload.path).split(sep).join('/');
    expect(relativePath).toBe(`tmp/moodle-uploads/${upload.id}`);
    expect(statSync(upload.path).isFile()).toBe(true);
    for (const backedUp of ['media', 'vault']) {
      expect(relativePath.startsWith(`${backedUp}/`)).toBe(false);
    }
    // Nachgestellt: Was ein Backup aus media/ und vault/ erfasst, enthält den Upload nicht
    const backedUpFiles = walk(dataDir).filter((f) => f.startsWith('media/') || f.startsWith('vault/'));
    expect(backedUpFiles.some((f) => f.includes(upload.id))).toBe(false);
    // Gegenprobe: Der Ordner der Material-Uploads (media/.tmp) liegt dagegen unter media/ und wäre im Backup
    expect(relative(dataDir, uploadTmpDir(dataDir)).split(sep)[0]).toBe('media');
    expect(relative(dataDir, store.dir).split(sep)[0]).toBe('tmp');
  });
});
