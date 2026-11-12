// Tunnel-Schlüssel je Gerät (UX-12, Plan E3/E4/E8, §5.1): Ableitungen mit festen Testvektoren und die Schlüsseldatei
// (Rechte, atomar, Symlink, Abgleich). Dieselben Testvektoren nutzen PR 3 (Mac-Helfer) und PR 4 (iPad) in Swift.
// Die Erwartungswerte stammen nicht aus dem Code unter Test, sondern aus `openssl dgst -sha256 -mac HMAC -macopt hexkey:…`.
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  generateTunnelKey,
  TUNNEL_KEY_RE,
  TUNNEL_PSK_IDENTITY,
  tunnelPsk,
  tunnelServiceName,
  tunnelSocketPath,
  TunnelKeyStore,
} from '../../src/services/tunnel.ts';

/** Rohbytes 0x00 … 0x1f */
const KEY_SEQ = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
/** Rohbytes 0xff × 32 */
const KEY_FF = '__________________________________________8';

const ID_A = '019a4e14-0000-7000-8000-0000000000a1';
const ID_B = '019a4e14-0000-7000-8000-0000000000b2';
const ID_C = '019a4e14-0000-7000-8000-0000000000c3';

describe('Ableitungen (feste Testvektoren)', () => {
  it('Dienstname: sg- + die ersten 16 Hex-Zeichen von HMAC-SHA256(tunnel_key, "sg-tunnel-name-v1")', () => {
    expect(tunnelServiceName(KEY_SEQ)).toBe('sg-076cd8b5e7079472');
    expect(tunnelServiceName(KEY_FF)).toBe('sg-8c534139d3632c4d');
  });

  it('PSK: HMAC-SHA256(tunnel_key, "sg-tunnel-psk-v1") als 32 rohe Byte', () => {
    expect(tunnelPsk(KEY_SEQ).toString('hex')).toBe(
      '6285d1ea289e4f9e017e2368656e3255f85eb5153e1d34a2d782c71cef12e710',
    );
    expect(tunnelPsk(KEY_FF).toString('hex')).toBe(
      '9b23102d57bde494bf1fb0527e1a2db8f3461626ebfabf5020b0e69b677021d9',
    );
    expect(tunnelPsk(KEY_SEQ)).toHaveLength(32);
  });

  it('PSK-Kennung ist fest "sg1" (E13), keine device_id', () => {
    expect(TUNNEL_PSK_IDENTITY).toBe('sg1');
  });

  it('der Dienstname verrät weder Schlüssel noch PSK noch einen Rechnernamen', () => {
    const name = tunnelServiceName(KEY_SEQ);
    expect(name).toMatch(/^sg-[0-9a-f]{16}$/);
    expect(name).not.toContain(KEY_SEQ.slice(0, 8));
  });

  it('ein Schlüssel im falschen Format wird abgelehnt (kein Ableiten aus Müll)', () => {
    for (const bad of ['', 'abc', `${KEY_SEQ}x`, KEY_SEQ.slice(1), `${KEY_SEQ.slice(0, 42)}!`]) {
      expect(() => tunnelServiceName(bad), bad).toThrow();
      expect(() => tunnelPsk(bad), bad).toThrow();
    }
  });

  it('nur die kanonische base64url-Schreibweise gilt (überzählige Bits im 43. Zeichen → Fehler)', () => {
    // `…Hh8` und `…Hh9` ergeben in Node dieselben 32 Rohbytes. Nur `…Hh8` ist kanonisch
    const nonCanonical = `${KEY_SEQ.slice(0, 42)}9`;
    expect(Buffer.from(nonCanonical, 'base64url')).toEqual(Buffer.from(KEY_SEQ, 'base64url'));
    expect(() => tunnelPsk(nonCanonical)).toThrow(/kanonisch/);
    expect(() => tunnelServiceName(`${KEY_FF.slice(0, 42)}_`)).toThrow(/kanonisch/);
  });

  it('generateTunnelKey: 43 Zeichen base64url, 32 Byte, jedes Mal anders', () => {
    const keys = new Set(Array.from({ length: 50 }, () => generateTunnelKey()));
    expect(keys.size).toBe(50);
    for (const key of keys) {
      expect(key).toMatch(TUNNEL_KEY_RE);
      expect(Buffer.from(key, 'base64url')).toHaveLength(32);
    }
  });

  it('der Socket liegt in run/ des Datenordners', () => {
    expect(tunnelSocketPath('/daten')).toBe('/daten/run/tunnel.sock');
  });
});

const dirs: string[] = [];
function dataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sg-tunnel-keys-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const mode = (path: string) => lstatSync(path).mode & 0o777;
const fileJson = (store: TunnelKeyStore) => JSON.parse(readFileSync(store.file, 'utf8')) as unknown;

describe('Schlüsseldatei', () => {
  it('Datei 0600, Ordner secrets/ 0700, Format { v: 1, devices: [{ device_id, tunnel_key }] }', async () => {
    const store = new TunnelKeyStore({ dataDir: dataDir() });
    await store.add(ID_A, KEY_SEQ);
    expect(store.file.endsWith('/secrets/tunnel-keys.json')).toBe(true);
    expect(mode(store.file)).toBe(0o600);
    expect(mode(store.dir)).toBe(0o700);
    expect(fileJson(store)).toEqual({ v: 1, devices: [{ device_id: ID_A, tunnel_key: KEY_SEQ }] });
  });

  it('bleibt nach jedem Neuschreiben 0600, auch bei großzügiger umask; keine Temp-Dateien bleiben liegen', async () => {
    const old = process.umask(0o000);
    try {
      const store = new TunnelKeyStore({ dataDir: dataDir() });
      await store.add(ID_A, KEY_SEQ);
      await store.add(ID_B, KEY_FF);
      await store.remove(ID_A);
      expect(mode(store.file)).toBe(0o600);
      expect(mode(store.dir)).toBe(0o700);
      expect(readdirSync(store.dir)).toEqual(['tunnel-keys.json']);
    } finally {
      process.umask(old);
    }
  });

  it('ein vorhandener Ordner secrets/ mit offenen Rechten wird auf 0700 gesetzt', async () => {
    const root = dataDir();
    mkdirSync(join(root, 'secrets'), { mode: 0o755 });
    const store = new TunnelKeyStore({ dataDir: root });
    await store.add(ID_A, KEY_SEQ);
    expect(mode(store.dir)).toBe(0o700);
  });

  it('eine zu offene vorhandene Datei wird beim Laden auf 0600 gesetzt', async () => {
    const root = dataDir();
    const store = new TunnelKeyStore({ dataDir: root });
    await store.add(ID_A, KEY_SEQ);
    const { chmodSync } = await import('node:fs');
    chmodSync(store.file, 0o644);
    const reloaded = new TunnelKeyStore({ dataDir: root });
    expect(await reloaded.load()).toBe(1);
    expect(mode(store.file)).toBe(0o600);
  });

  it('atomar: gleichzeitige Änderungen laufen durch eine Warteschlange, keine geht verloren', async () => {
    const store = new TunnelKeyStore({ dataDir: dataDir() });
    const ids = Array.from(
      { length: 25 },
      (_, i) => `019a4e14-0000-7000-8000-${String(i).padStart(12, '0')}`,
    );
    await Promise.all(ids.map((id) => store.add(id, generateTunnelKey())));
    const written = fileJson(store) as { devices: { device_id: string }[] };
    expect(written.devices.map((d) => d.device_id).sort()).toEqual([...ids].sort());
    expect(readdirSync(store.dir)).toEqual(['tunnel-keys.json']);
  });

  it('die Datei ist nie halb geschrieben: ein Leser sieht immer vollständiges JSON', async () => {
    const store = new TunnelKeyStore({ dataDir: dataDir() });
    await store.add(ID_A, KEY_SEQ);
    let broken = 0;
    let reading = true;
    const reader = (async () => {
      while (reading) {
        try {
          JSON.parse(readFileSync(store.file, 'utf8'));
        } catch {
          broken++;
        }
        await new Promise((r) => setImmediate(r));
      }
    })();
    for (let i = 0; i < 40; i++) {
      await store.add(`019a4e14-0000-7000-8000-${String(i).padStart(12, '0')}`, generateTunnelKey());
    }
    reading = false;
    await reader;
    expect(broken).toBe(0);
  });

  it('secrets/ als Symlink statt Ordner wird abgelehnt: nichts landet im Ziel, der Speicher bleibt unverändert', async () => {
    const root = dataDir();
    const elsewhere = join(root, 'woanders');
    mkdirSync(elsewhere);
    symlinkSync(elsewhere, join(root, 'secrets'));
    const store = new TunnelKeyStore({ dataDir: root });
    await expect(store.add(ID_A, KEY_SEQ)).rejects.toThrow(/kein echter Ordner/);
    expect(readdirSync(elsewhere)).toEqual([]);
    expect(store.size).toBe(0);
  });

  it('tunnel-keys.json als Symlink wird beim Schreiben ersetzt, sein Ziel bleibt unberührt', async () => {
    const root = dataDir();
    mkdirSync(join(root, 'secrets'), { mode: 0o700 });
    const target = join(root, 'fremd.txt');
    writeFileSync(target, 'FREMD');
    symlinkSync(target, join(root, 'secrets', 'tunnel-keys.json'));
    const store = new TunnelKeyStore({ dataDir: root });
    await store.add(ID_A, KEY_SEQ);
    expect(readFileSync(target, 'utf8')).toBe('FREMD');
    expect(lstatSync(store.file).isSymbolicLink()).toBe(false);
    expect(store.size).toBe(1);
  });

  it('entfernte Geräte fehlen in der Datei', async () => {
    const store = new TunnelKeyStore({ dataDir: dataDir() });
    await store.add(ID_A, KEY_SEQ);
    await store.add(ID_B, KEY_FF);
    expect(await store.remove(ID_A)).toBe(true);
    expect(await store.remove(ID_A)).toBe(false);
    expect(fileJson(store)).toEqual({ v: 1, devices: [{ device_id: ID_B, tunnel_key: KEY_FF }] });
  });

  it('nach einem Neustart (load) sind die Einträge wieder da', async () => {
    const root = dataDir();
    const first = new TunnelKeyStore({ dataDir: root });
    await first.add(ID_A, KEY_SEQ);
    const second = new TunnelKeyStore({ dataDir: root });
    expect(await second.load()).toBe(1);
    expect(second.deviceIds()).toEqual([ID_A]);
    await second.add(ID_B, KEY_FF);
    expect((fileJson(second) as { devices: unknown[] }).devices).toHaveLength(2);
  });

  it('Abgleich beim Start: verwaiste Einträge fliegen raus, Altgeräte bekommen keinen neuen Schlüssel', async () => {
    const root = dataDir();
    const store = new TunnelKeyStore({ dataDir: root });
    await store.add(ID_A, KEY_SEQ); // aktives Gerät
    await store.add(ID_B, KEY_FF); // Gerät wurde inzwischen entfernt (verwaist)
    const restarted = new TunnelKeyStore({ dataDir: root });
    await restarted.load();
    // ID_C ist aktiv, hat aber keinen Eintrag (vor UX-12 gekoppelt oder aus dem Backup wiederhergestellt)
    const result = await restarted.reconcile([ID_A, ID_C]);
    expect(result).toEqual({ removed: 1, withoutKey: 1 });
    expect(fileJson(restarted)).toEqual({ v: 1, devices: [{ device_id: ID_A, tunnel_key: KEY_SEQ }] });
    expect(restarted.deviceIds()).not.toContain(ID_C);
  });

  it('Abgleich während einer Kopplung: der frisch eingetragene Schlüssel bleibt (Gerät noch nicht in Postgres)', async () => {
    const dir = dataDir();
    const before = new TunnelKeyStore({ dataDir: dir });
    await before.add(ID_A, KEY_SEQ); // aus einem früheren Lauf, Gerät inzwischen entfernt
    const store = new TunnelKeyStore({ dataDir: dir });
    await store.load();
    // pair/confirm: Schlüssel zuerst, das Gerät steht noch nicht in der Liste aktiver Geräte
    await store.add(ID_B, KEY_FF);
    expect(await store.reconcile([])).toEqual({ removed: 1, withoutKey: 0 });
    expect(store.deviceIds()).toEqual([ID_B]);
    // entfernt die Route den Eintrag selbst (Anlegen gescheitert), ist er weg
    expect(await store.remove(ID_B)).toBe(true);
    expect(store.size).toBe(0);
  });

  it('Abgleich ohne Änderung schreibt die Datei nicht neu', async () => {
    const store = new TunnelKeyStore({ dataDir: dataDir() });
    await store.add(ID_A, KEY_SEQ);
    const before = lstatSync(store.file).ino;
    expect(await store.reconcile([ID_A])).toEqual({ removed: 0, withoutKey: 0 });
    expect(lstatSync(store.file).ino).toBe(before);
  });

  it('secrets/ als Symlink: load liest nichts daraus (leere Liste, Fehler im Log), auch wenn dort eine gültige Datei liegt', async () => {
    const root = dataDir();
    const elsewhere = join(root, 'woanders');
    mkdirSync(elsewhere);
    writeFileSync(
      join(elsewhere, 'tunnel-keys.json'),
      JSON.stringify({ v: 1, devices: [{ device_id: ID_A, tunnel_key: KEY_SEQ }] }),
      { mode: 0o600 },
    );
    symlinkSync(elsewhere, join(root, 'secrets'));
    const errors: string[] = [];
    const store = new TunnelKeyStore({
      dataDir: root,
      logger: { warn: () => {}, error: (_f, message) => void errors.push(message) },
    });
    expect(await store.load()).toBe(0);
    expect(store.size).toBe(0);
    expect(errors).toHaveLength(1);
  });

  it('eine kaputte Datei ergibt eine leere Liste (sicherer Ausfall) und wird beim nächsten Schreiben ersetzt', async () => {
    const root = dataDir();
    mkdirSync(join(root, 'secrets'), { mode: 0o700 });
    writeFileSync(join(root, 'secrets', 'tunnel-keys.json'), '{"v":1,"devices":[{"device_id":"x"}]}', {
      mode: 0o600,
    });
    const errors: string[] = [];
    const store = new TunnelKeyStore({
      dataDir: root,
      logger: { warn: () => {}, error: (_f, message) => void errors.push(message) },
    });
    expect(await store.load()).toBe(0);
    expect(errors).toHaveLength(1);
    await store.add(ID_A, KEY_SEQ);
    expect(fileJson(store)).toEqual({ v: 1, devices: [{ device_id: ID_A, tunnel_key: KEY_SEQ }] });
  });

  it('Meldungen des Stores enthalten nie einen Schlüssel', async () => {
    const root = dataDir();
    mkdirSync(join(root, 'secrets'), { mode: 0o700 });
    writeFileSync(
      join(root, 'secrets', 'tunnel-keys.json'),
      `{"v":1,"devices":[{"device_id":"x","tunnel_key":"${KEY_SEQ}"}]}`,
      {
        mode: 0o644,
      },
    );
    const lines: string[] = [];
    const sink = (fields: object, message: string) => void lines.push(JSON.stringify(fields) + message);
    const store = new TunnelKeyStore({ dataDir: root, logger: { warn: sink, error: sink } });
    await store.load();
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toContain(KEY_SEQ);
  });

  it('add mit ungültigem Schlüssel schreibt nichts', async () => {
    const store = new TunnelKeyStore({ dataDir: dataDir() });
    await expect(store.add(ID_A, 'zu-kurz')).rejects.toThrow();
    expect(existsSync(store.file)).toBe(false);
  });

  it('add mit einer ID, die load() nicht annähme, schreibt nichts (sonst wäre die Datei beim Start „kaputt“)', async () => {
    const store = new TunnelKeyStore({ dataDir: dataDir() });
    await store.add(ID_A, KEY_SEQ);
    for (const bad of ['', 'kein-uuid', ID_B.toUpperCase(), `${ID_B}\n`]) {
      await expect(store.add(bad, KEY_FF), JSON.stringify(bad)).rejects.toThrow(/UUID/);
    }
    expect(fileJson(store)).toEqual({ v: 1, devices: [{ device_id: ID_A, tunnel_key: KEY_SEQ }] });
    const reloaded = new TunnelKeyStore({ dataDir: store.dir.replace(/\/secrets$/, '') });
    expect(await reloaded.load()).toBe(1);
  });

  it('deleteFile löscht die Datei und leert die Liste (SG_TUNNEL=0)', async () => {
    const store = new TunnelKeyStore({ dataDir: dataDir() });
    await store.add(ID_A, KEY_SEQ);
    await store.deleteFile();
    expect(existsSync(store.file)).toBe(false);
    expect(store.size).toBe(0);
    await store.deleteFile(); // ohne Datei kein Fehler
  });

  it('onChange meldet jede Änderung der Liste', async () => {
    const store = new TunnelKeyStore({ dataDir: dataDir() });
    let calls = 0;
    const off = store.onChange(() => calls++);
    await store.add(ID_A, KEY_SEQ);
    await store.remove(ID_A);
    off();
    await store.add(ID_B, KEY_FF);
    expect(calls).toBe(2);
  });
});
