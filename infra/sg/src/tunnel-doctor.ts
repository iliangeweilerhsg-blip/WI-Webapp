// `sg doctor` für den Mac-Helfer `sg-tunnel` (UX-12, Plan §5.2 „sg doctor“). Die Prüfungen sind reine Logik über
// `TunnelDoctorIo`; die echten Fassungen (Dateien, Prozess, Core-API, Firewall) stehen unten in `realTunnelDoctorIo`.
//
// Der Helfer meldet seinen Zustand über eine Zustandsdatei (`<SG_DATA_DIR>/run/tunnel-state.json`, alle 5 s). Hier steht
// nie ein Schlüssel: gelesen werden nur Geräte-IDs aus der Schlüsseldatei, und nur zum Vergleich mit den gekoppelten Geräten.
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  type Stats,
} from 'node:fs';
import { dirname } from 'node:path';
import type { CheckResult } from './doctor.ts';
import type { SgConfig } from './config.ts';
import { readService } from './procs.ts';
import type { System } from './system.ts';
import {
  hasTunnelBinary,
  readTunnelStamp,
  tunnelBinary,
  tunnelBinaryProblem,
  tunnelBuildReason,
  tunnelSourceFingerprint,
} from './tunnel.ts';

/** Ist die Zustandsdatei älter, steht der Helfer oder hängt (er schreibt alle 5 s). */
export const TUNNEL_STATE_MAX_AGE_MS = 15_000;
/** Ab so vielen gescheiterten Handshakes (seit dem Start des Helfers) weist `sg doctor` darauf hin. */
export const TUNNEL_MANY_FAILED_HANDSHAKES = 20;

export type TunnelStateRead =
  { kind: 'missing' } | { kind: 'broken' } | { kind: 'ok'; state: unknown; ageMs: number };

/** Befund über die Schlüsseldatei (ohne Inhalt, nur Rechte und Geräte-IDs) */
export interface KeyFileInfo {
  exists: boolean;
  isSymlink: boolean;
  isRegularFile: boolean;
  /** Rechte der Datei (letzte 9 Bit) */
  mode: number;
  dirExists: boolean;
  dirIsSymlink: boolean;
  dirMode: number;
  /** Gehören Ordner und Datei dem Benutzer, der `sg` ausführt? */
  ownerOk: boolean;
  /** Geräte-IDs aus der Datei, `null` wenn nicht lesbar oder falsches Format */
  deviceIds: string[] | null;
}

export interface FirewallInfo {
  /** `null`: nicht feststellbar */
  enabled: boolean | null;
  /** Blockt die Firewall den Helfer? `null`: nicht feststellbar */
  blocked: boolean | null;
}

export interface TunnelDoctorIo {
  platform: string;
  hasSwift: () => Promise<boolean>;
  binaryExists: () => boolean;
  /** Grund, warum `sg` das vorhandene Programm nicht starten würde (fremder Besitzer, beschreibbar), sonst `null` */
  binaryProblem: () => string | null;
  fingerprint: () => string | null;
  stamp: () => string | null;
  /** Läuft der Helfer (PID-Datei mit passender Identität)? */
  helperRunning: () => boolean;
  /** Läuft der Core (PID-Datei)? */
  coreRunning: () => boolean;
  readState: () => TunnelStateRead;
  keyFile: () => KeyFileInfo;
  /** IDs der gekoppelten Geräte laut Core (`GET /devices`), `null` wenn der Core nicht antwortet */
  pairedDeviceIds: () => Promise<string[] | null>;
  firewall: () => Promise<FirewallInfo>;
}

const NAME = 'Tunnel-Helfer';

const ok = (part: string, detail: string): CheckResult => ({
  name: `${NAME} · ${part}`,
  status: 'ok',
  detail,
});
const info = (part: string, detail: string): CheckResult => ({
  name: `${NAME} · ${part}`,
  status: 'info',
  detail,
});
const fail = (part: string, detail: string, hint: string): CheckResult => ({
  name: `${NAME} · ${part}`,
  status: 'fail',
  detail,
  hint,
});

// ---------------------------------------------------------------- Zustandsdatei

interface ListenerLike {
  service_name: string;
  advertised_name: string | null;
  state: string;
  handshakes_failed: number;
}

interface StateLike {
  core: string;
  p2p: boolean;
  keys: string;
  listeners: ListenerLike[];
  last_error: string | null;
}

/** Prüft die Form der Zustandsdatei. Unerwartetes ergibt `null` (dann gilt sie als kaputt). */
export function parseTunnelState(value: unknown): StateLike | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.core !== 'string' || typeof v.p2p !== 'boolean' || typeof v.keys !== 'string') return null;
  if (!Array.isArray(v.listeners)) return null;
  const listeners: ListenerLike[] = [];
  for (const item of v.listeners as unknown[]) {
    if (typeof item !== 'object' || item === null) return null;
    const l = item as Record<string, unknown>;
    if (typeof l.service_name !== 'string' || typeof l.state !== 'string') return null;
    listeners.push({
      service_name: l.service_name,
      advertised_name: typeof l.advertised_name === 'string' ? l.advertised_name : null,
      state: l.state,
      handshakes_failed: typeof l.handshakes_failed === 'number' ? l.handshakes_failed : 0,
    });
  }
  return {
    core: v.core,
    p2p: v.p2p,
    keys: v.keys,
    listeners,
    last_error: typeof v.last_error === 'string' ? v.last_error : null,
  };
}

// ---------------------------------------------------------------- Prüfungen

export async function runTunnelChecks(cfg: SgConfig, io: TunnelDoctorIo): Promise<CheckResult[]> {
  if (!cfg.tunnel) return [info('Hinweis', 'aus (SG_TUNNEL=0): keine Direktverbindung vom iPad')];
  if (io.platform !== 'darwin') return [info('Hinweis', `gibt es nur auf macOS (hier: ${io.platform})`)];

  const results: CheckResult[] = [];

  // Swift und Programm
  const swift = await io.hasSwift();
  results.push(
    swift
      ? ok('Swift', 'vorhanden')
      : fail(
          'Swift',
          'nicht gefunden',
          'Xcode oder die Kommandozeilenwerkzeuge installieren ("xcode-select --install"). Ohne Swift startet "pnpm sg start" ohne Direktverbindung vom iPad.',
        ),
  );
  const binaryExists = io.binaryExists();
  const reason = tunnelBuildReason({
    binaryExists,
    fingerprint: io.fingerprint(),
    stamp: io.stamp(),
  });
  const binaryProblem = binaryExists ? io.binaryProblem() : null;
  results.push(
    binaryProblem !== null
      ? fail(
          'Programm',
          `wird nicht gestartet: ${binaryProblem}`,
          'apps/mac-tunnel/.build löschen, Rechte des Repo-Ordners prüfen ("chmod go-w"), dann "pnpm sg stop" und "pnpm sg start" (baut neu).',
        )
      : reason === null
        ? ok('Programm', 'gebaut und aktuell')
        : info(
            'Programm',
            reason === 'missing'
              ? 'noch nicht gebaut: "pnpm sg start" baut es beim nächsten Start (etwa eine Minute)'
              : 'veraltet: "pnpm sg start" baut es beim nächsten Start neu',
          ),
  );

  // Prozess und Zustand
  const running = io.helperRunning();
  const coreRunning = io.coreRunning();
  if (!running) {
    results.push(
      coreRunning
        ? fail(
            'Prozess',
            'läuft nicht, obwohl der Core läuft',
            'Die Meldungen mit [tunnel] im Terminal von "pnpm sg start" lesen (Bau fehlgeschlagen, Absturz, falsche Rechte?). Danach "pnpm sg stop" und "pnpm sg start".',
          )
        : info('Prozess', 'läuft nicht ("pnpm sg start" startet ihn zusammen mit dem Core)'),
    );
  } else {
    results.push(ok('Prozess', 'läuft'));
    results.push(...checkState(io));
  }

  // Schlüsseldatei
  const file = io.keyFile();
  results.push(checkKeyFile(file));

  // Gekoppelte Geräte ohne Tunnel-Schlüssel
  results.push(await checkPairedWithoutKey(io, file));

  // Firewall
  results.push(await checkFirewall(io));

  return results;
}

function checkState(io: TunnelDoctorIo): CheckResult[] {
  const read = io.readState();
  if (read.kind === 'missing') {
    return [
      fail(
        'Zustand',
        'Zustandsdatei fehlt',
        'Der Helfer läuft, schreibt aber keine Zustandsdatei. "pnpm sg stop" und "pnpm sg start"; bleibt es so, die Meldungen mit [tunnel] lesen.',
      ),
    ];
  }
  const state = read.kind === 'ok' ? parseTunnelState(read.state) : null;
  if (read.kind === 'broken' || state === null) {
    return [
      fail(
        'Zustand',
        'Zustandsdatei ist unlesbar',
        '"pnpm sg stop" und "pnpm sg start". Bleibt es so, ist der Helfer älter oder neuer als sg: neu bauen lassen (apps/mac-tunnel/.build löschen).',
      ),
    ];
  }
  if (read.kind === 'ok' && read.ageMs > TUNNEL_STATE_MAX_AGE_MS) {
    return [
      fail(
        'Zustand',
        `Zustandsdatei ist ${Math.round(read.ageMs / 1000)} s alt (erwartet: höchstens 15 s)`,
        'Der Helfer hängt oder die Datei lässt sich nicht schreiben. "pnpm sg stop" und "pnpm sg start".',
      ),
    ];
  }

  const results: CheckResult[] = [ok('Zustand', 'Zustandsdatei ist aktuell')];

  results.push(
    state.core === 'ok'
      ? ok('Core', 'Tunnel-Eingang erreichbar')
      : fail(
          'Core',
          'Tunnel-Eingang des Core nicht erreichbar',
          'Läuft der Core? Wurde er mit SG_TUNNEL=0 gestartet, gibt es den Tunnel-Eingang nicht (dann den Helfer ebenfalls mit SG_TUNNEL=0 laufen lassen). Solange das so ist, hat der Helfer alle Dienste gestoppt.',
        ),
  );

  if (state.keys === 'unsicher' || state.keys === 'kaputt') {
    results.push(
      fail(
        'Schlüssel',
        `Der Helfer lehnt die Schlüsseldatei ab (${state.keys})${state.last_error ? `: ${state.last_error}` : ''}`,
        'Alle Dienste sind gestoppt. Rechte setzen ("chmod 700" für den Ordner secrets/, "chmod 600" für tunnel-keys.json) oder den Core neu starten, er richtet beides beim Start wieder her.',
      ),
    );
  } else if (state.keys === 'fehlt' || state.listeners.length === 0) {
    results.push(
      info(
        'Dienste',
        state.keys === 'fehlt'
          ? 'Schlüsseldatei fehlt: noch kein Gerät gekoppelt, also keine Dienste'
          : 'noch kein Gerät mit Tunnel-Schlüssel gekoppelt, also keine Dienste',
      ),
    );
  } else {
    const ready = state.listeners.filter((l) => l.state === 'ready').length;
    results.push(
      ready > 0
        ? ok('Dienste', `${ready} von ${state.listeners.length} bereit`)
        : fail(
            'Dienste',
            `keiner von ${state.listeners.length} Diensten ist bereit (Zustand: ${state.listeners.map((l) => l.state).join(', ')})`,
            'Der Helfer startet ausgefallene Dienste alle paar Sekunden neu. Bleibt es so: "pnpm sg stop" und "pnpm sg start", Meldungen mit [tunnel] lesen.',
          ),
    );
  }

  results.push(
    info(
      'Peer-to-peer',
      state.p2p
        ? 'an (Direktverbindung ohne Netz möglich)'
        : 'aus (SG_TUNNEL_P2P=0): nur im gemeinsamen WLAN',
    ),
  );

  const conflicts = state.listeners.filter(
    (l) => l.advertised_name !== null && l.advertised_name !== l.service_name,
  );
  if (conflicts.length > 0) {
    results.push(
      fail(
        'Dienstname',
        `Bonjour hat ${conflicts.length} Dienst(e) umbenannt (Namenskonflikt: ${conflicts
          .map((l) => `${l.service_name} → ${l.advertised_name}`)
          .join(', ')})`,
        'Jemand anderes im Funk oder Netz hat den Namen belegt, oder ein alter Dienst läuft noch. "pnpm sg stop" und "pnpm sg start"; bleibt es so, in der Nähe nach einem zweiten Gerät mit Studien-Gehirn suchen. Das iPad probiert auch den Namen mit Zusatz.',
      ),
    );
  }

  const failedTotal = state.listeners.reduce((sum, l) => sum + l.handshakes_failed, 0);
  if (failedTotal >= TUNNEL_MANY_FAILED_HANDSHAKES) {
    results.push(
      info(
        'Handshakes',
        `${failedTotal} Verbindungsversuche seit dem Start gescheitert. Ein iPad mit altem Schlüssel (neu koppeln) oder ein Fremder im Funk. Das ist nur Verzögerung, kein Leck. Hört es nicht auf: iPad entkoppeln und neu koppeln`,
      ),
    );
  }
  return results;
}

function describeFileMode(mode: number): string {
  return `0${(mode & 0o777).toString(8)}`;
}

export function checkKeyFile(file: KeyFileInfo): CheckResult {
  const part = 'Schlüsseldatei';
  if (!file.dirExists || !file.exists) {
    return info(part, 'noch keine (entsteht bei der ersten Kopplung eines Geräts)');
  }
  const hint =
    'Der Core richtet Ordner und Datei beim Start wieder her ("pnpm sg stop", "pnpm sg start"). Von Hand: "chmod 700 <Datenordner>/secrets" und "chmod 600 <Datenordner>/secrets/tunnel-keys.json". Ist es ein Symlink, ihn entfernen.';
  if (file.dirIsSymlink) return fail(part, 'secrets/ ist ein Symlink', hint);
  if (file.isSymlink) return fail(part, 'tunnel-keys.json ist ein Symlink', hint);
  if (!file.isRegularFile) return fail(part, 'tunnel-keys.json ist keine reguläre Datei', hint);
  if (!file.ownerOk) return fail(part, 'Ordner oder Datei gehören einem anderen Benutzer', hint);
  if ((file.dirMode & 0o777) !== 0o700) {
    return fail(part, `Rechte von secrets/ sind ${describeFileMode(file.dirMode)} (erwartet 0700)`, hint);
  }
  if ((file.mode & 0o777) !== 0o600) {
    return fail(
      part,
      `Rechte von tunnel-keys.json sind ${describeFileMode(file.mode)} (erwartet 0600)`,
      hint,
    );
  }
  if (file.deviceIds === null) {
    return fail(part, 'tunnel-keys.json ist unlesbar oder hat ein falsches Format', hint);
  }
  return ok(part, `vorhanden, 0600, Ordner 0700, ${file.deviceIds.length} Gerät(e)`);
}

async function checkPairedWithoutKey(io: TunnelDoctorIo, file: KeyFileInfo): Promise<CheckResult> {
  const part = 'Geräte ohne Schlüssel';
  const paired = await io.pairedDeviceIds();
  if (paired === null) return info(part, 'nicht prüfbar (der Core antwortet nicht)');
  if (file.exists && file.deviceIds === null) return info(part, 'nicht prüfbar (Schlüsseldatei unlesbar)');
  const have = new Set(file.exists ? (file.deviceIds ?? []) : []);
  const missing = paired.filter((id) => !have.has(id));
  if (missing.length === 0) {
    return ok(
      part,
      paired.length === 0 ? 'kein Gerät gekoppelt' : 'alle gekoppelten Geräte haben einen Tunnel-Schlüssel',
    );
  }
  return fail(
    part,
    `${missing.length} gekoppelte(s) Gerät(e) ohne Tunnel-Schlüssel (vor UX-12 gekoppelt)`,
    'Neu koppeln: In der Web-App unter Einstellungen → Geräte das Gerät entfernen und das iPad im Heimnetz neu koppeln (QR-Code). Der Schlüssel entsteht nur bei der Kopplung und wird nie nachträglich erzeugt.',
  );
}

async function checkFirewall(io: TunnelDoctorIo): Promise<CheckResult> {
  const part = 'Firewall';
  const fw = await io.firewall();
  if (fw.enabled === null) return info(part, 'Zustand der macOS-Firewall nicht feststellbar');
  if (!fw.enabled) return ok(part, 'macOS-Firewall ist aus');
  if (fw.blocked === true) {
    return fail(
      part,
      'Die macOS-Firewall blockiert den Tunnel-Helfer (eingehende Verbindungen abgelehnt)',
      'Systemeinstellungen → Netzwerk → Firewall → Optionen: "sg-tunnel" auf "Eingehende Verbindungen erlauben" stellen (nach jedem Neubau kann das nötig sein), danach "pnpm sg stop" und "pnpm sg start".',
    );
  }
  if (fw.blocked === false) return ok(part, 'macOS-Firewall ist an, der Helfer ist nicht blockiert');
  return info(
    part,
    'macOS-Firewall ist an. Fragt macOS beim Start "eingehende Verbindungen zulassen?", mit "Erlauben" antworten (die Frage kann nach jedem Neubau wiederkommen). Wer "Ablehnen" klickt, sperrt den Helfer still: dann unter Systemeinstellungen → Netzwerk → Firewall → Optionen "sg-tunnel" erlauben',
  );
}

// ---------------------------------------------------------------- Echte Fassung

const SOCKETFILTERFW = '/usr/libexec/ApplicationFirewall/socketfilterfw';

/** Auswertung der Ausgabe von `socketfilterfw --getglobalstate` („Firewall is enabled. (State = 1)“ o. Ä.). */
export function parseFirewallEnabled(output: string): boolean | null {
  const text = output.toLowerCase();
  if (/\bdisabled\b/.test(text) || /state = 0/.test(text)) return false;
  if (/\benabled\b/.test(text) || /state = [12]/.test(text)) return true;
  return null;
}

/**
 * Auswertung der Ausgabe von `socketfilterfw --getappblocked <Pfad>`. Der genaue Wortlaut ist **nicht geprüft**
 * (kein macOS in der Entstehungsumgebung): Erkannt werden nur eindeutige Sätze, alles andere ergibt `null`.
 */
export function parseFirewallBlocked(output: string): boolean | null {
  const text = output.toLowerCase();
  if (/\bnot blocked\b|\bis not blocked\b/.test(text)) return false;
  if (/\bblocked\b/.test(text)) return true;
  return null;
}

export function inspectKeyFile(file: string, uid: number | undefined): KeyFileInfo {
  const dir = dirname(file);
  const empty: KeyFileInfo = {
    exists: false,
    isSymlink: false,
    isRegularFile: false,
    mode: 0,
    dirExists: false,
    dirIsSymlink: false,
    dirMode: 0,
    ownerOk: true,
    deviceIds: null,
  };
  let dirInfo: Stats;
  try {
    dirInfo = lstatSync(dir);
  } catch {
    return empty;
  }
  const result: KeyFileInfo = {
    ...empty,
    dirExists: true,
    dirIsSymlink: dirInfo.isSymbolicLink(),
    dirMode: dirInfo.mode & 0o777,
    ownerOk: uid === undefined || dirInfo.uid === uid,
  };
  let fileInfo: Stats;
  try {
    fileInfo = lstatSync(file);
  } catch {
    return result;
  }
  result.exists = true;
  result.isSymlink = fileInfo.isSymbolicLink();
  result.isRegularFile = fileInfo.isFile();
  result.mode = fileInfo.mode & 0o777;
  result.ownerOk = result.ownerOk && (uid === undefined || fileInfo.uid === uid);
  // Nur eine eigene, reguläre Datei wird gelesen (O_NOFOLLOW), und nur die Geräte-IDs werden behalten
  if (result.isSymlink || !result.isRegularFile || result.dirIsSymlink || !result.ownerOk) return result;
  let fd: number | undefined;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    if (!fstatSync(fd).isFile() || fstatSync(fd).size > 256 * 1024) return result;
    const buffer = Buffer.alloc(fstatSync(fd).size);
    let offset = 0;
    while (offset < buffer.length) {
      const n = readSync(fd, buffer, offset, buffer.length - offset, null);
      if (n === 0) break;
      offset += n;
    }
    const parsed: unknown = JSON.parse(buffer.subarray(0, offset).toString('utf8'));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      Array.isArray((parsed as { devices?: unknown }).devices)
    ) {
      const ids: string[] = [];
      for (const d of (parsed as { devices: unknown[] }).devices) {
        const id = (d as { device_id?: unknown } | null)?.device_id;
        if (typeof id !== 'string') return result;
        ids.push(id);
      }
      result.deviceIds = ids;
    }
  } catch {
    // unlesbar: deviceIds bleibt null
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  return result;
}

export function realTunnelDoctorIo(cfg: SgConfig, sys: System): TunnelDoctorIo {
  return {
    platform: sys.platform,
    hasSwift: async () => (await sys.run('swift', ['--version'])).ok,
    binaryExists: () => hasTunnelBinary(cfg),
    binaryProblem: () => tunnelBinaryProblem(cfg),
    fingerprint: () => tunnelSourceFingerprint(cfg.tunnelPackageDir),
    stamp: () => readTunnelStamp(cfg),
    helperRunning: () => readService(cfg, 'tunnel') !== null,
    coreRunning: () => readService(cfg, 'core') !== null,
    readState: () => {
      try {
        const info = lstatSync(cfg.tunnelStateFile);
        if (!info.isFile()) return { kind: 'broken' };
        const state: unknown = JSON.parse(readFileSync(cfg.tunnelStateFile, 'utf8'));
        return { kind: 'ok', state, ageMs: Math.max(0, Date.now() - info.mtimeMs) };
      } catch (e) {
        return (e as NodeJS.ErrnoException).code === 'ENOENT' ? { kind: 'missing' } : { kind: 'broken' };
      }
    },
    keyFile: () => inspectKeyFile(cfg.tunnelKeysFile, process.getuid?.()),
    pairedDeviceIds: async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${cfg.corePort}/api/v1/devices?limit=100`, {
          signal: AbortSignal.timeout(2000),
        });
        if (!res.ok) return null;
        const body = (await res.json()) as {
          items?: { id?: unknown; deleted_at?: unknown }[];
          next_cursor?: unknown;
        };
        if (!Array.isArray(body.items) || body.next_cursor) return null;
        return body.items
          .filter((d) => d.deleted_at === null || d.deleted_at === undefined)
          .map((d) => d.id)
          .filter((id): id is string => typeof id === 'string');
      } catch {
        return null;
      }
    },
    firewall: async () => {
      const state = await sys.run(SOCKETFILTERFW, ['--getglobalstate']);
      if (!state.ok) return { enabled: null, blocked: null };
      const enabled = parseFirewallEnabled(state.stdout + state.stderr);
      if (enabled !== true || !hasTunnelBinary(cfg)) return { enabled, blocked: null };
      const blocked = await sys.run(SOCKETFILTERFW, ['--getappblocked', tunnelBinary(cfg)]);
      return { enabled, blocked: blocked.ok ? parseFirewallBlocked(blocked.stdout + blocked.stderr) : null };
    },
  };
}
