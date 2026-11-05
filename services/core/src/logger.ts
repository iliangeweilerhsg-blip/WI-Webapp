import { existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { pino, type Logger } from 'pino';
import type { Config } from './config.ts';

/** Logdateien werden 14 Tage aufbewahrt (09 §7) */
export const LOG_KEEP_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

function dayString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Tägliche Rotation von `core.log`. `openedDay` ist der (UTC-)Tag, an dem die aktuelle Datei begonnen
 * wurde, nicht ihr mtime: Zeilen nach Mitternacht vor der nächsten Prüfung verschieben sonst den Tag.
 * Ist heute ein anderer Tag, wird die Datei zu `core-<openedDay>.log`. Archive, die älter als
 * `keepDays` Tage sind, werden gelöscht.
 * Rückgabe: der Tag, für den die aktuelle Datei jetzt gilt. Weicht er von `openedDay` ab, wurde
 * rotiert und der Aufrufer öffnet die Logdatei neu.
 */
export function rotateLogs(
  logDir: string,
  openedDay: string,
  now: Date = new Date(),
  keepDays: number = LOG_KEEP_DAYS,
): string {
  mkdirSync(logDir, { recursive: true });
  const today = dayString(now);
  let day = openedDay;

  if (openedDay < today) {
    const current = join(logDir, 'core.log');
    if (existsSync(current)) {
      const target = join(logDir, `core-${openedDay}.log`);
      renameSync(current, existsSync(target) ? join(logDir, `core-${openedDay}-${Date.now()}.log`) : target);
    }
    day = today;
  }

  const cutoff = now.getTime() - keepDays * DAY_MS;
  for (const name of readdirSync(logDir)) {
    if (!/^core-\d{4}-\d{2}-\d{2}.*\.log$/.test(name)) continue;
    const file = join(logDir, name);
    if (statSync(file).mtime.getTime() < cutoff) unlinkSync(file);
  }
  return day;
}

/** Größengrenzen für `core.log` (Issue #87): je Datei 50 MB, alle Logdateien zusammen 500 MB */
export const LOG_MAX_FILE_BYTES = 50 * 1024 * 1024;
export const LOG_MAX_TOTAL_BYTES = 500 * 1024 * 1024;

export interface LogSizeLimits {
  maxFileBytes: number;
  maxTotalBytes: number;
}

/**
 * Größengrenzen. Ist `core.log` größer als `maxFileBytes`, wird sie zu `core-<Tag>-<Zeitstempel>.log`
 * rotiert. Übersteigen `core.log` und alle `core-*.log` zusammen `maxTotalBytes`, werden die ältesten Archive
 * gelöscht (nie die aktuelle Datei). Rückgabe: `true`, wenn `core.log` rotiert wurde (Aufrufer öffnet sie neu).
 */
export function enforceLogSizeLimits(
  logDir: string,
  limits: LogSizeLimits = { maxFileBytes: LOG_MAX_FILE_BYTES, maxTotalBytes: LOG_MAX_TOTAL_BYTES },
  now: Date = new Date(),
): boolean {
  mkdirSync(logDir, { recursive: true });
  const current = join(logDir, 'core.log');
  let rotated = false;
  if (existsSync(current) && statSync(current).size >= limits.maxFileBytes) {
    renameSync(current, join(logDir, `core-${dayString(now)}-${now.getTime()}.log`));
    rotated = true;
  }
  const archives = readdirSync(logDir)
    .filter((name) => /^core-\d{4}-\d{2}-\d{2}.*\.log$/.test(name))
    .map((name) => ({ file: join(logDir, name), stat: statSync(join(logDir, name)) }))
    .sort((a, b) => a.stat.mtime.getTime() - b.stat.mtime.getTime());
  let total = archives.reduce((sum, a) => sum + a.stat.size, 0);
  if (!rotated && existsSync(current)) total += statSync(current).size;
  for (const archive of archives) {
    if (total <= limits.maxTotalBytes) break;
    unlinkSync(archive.file);
    total -= archive.stat.size;
  }
  return rotated;
}

/** Tag, an dem eine vorhandene `core.log` begonnen wurde (Näherung beim Start: ihr mtime), sonst heute */
export function initialLogDay(logDir: string, now: Date = new Date()): string {
  const current = join(logDir, 'core.log');
  return existsSync(current) ? dayString(statSync(current).mtime) : dayString(now);
}

/**
 * Query-Parameter, deren Wert ein Geheimnis sein kann (z. B. `pairing_id` an `DELETE /devices/pairings`,
 * VERTRAEGE §7.5). Gilt für alle Routen. Der Name muss an Namensgrenzen (`_`, `-`, Anfang, Ende) passen, damit
 * `author`, `keyword`, `sort_key` oder `session_id` nicht getroffen werden; Groß-/Kleinschreibung egal. Ein
 * nacktes `key` fehlt bewusst (`sort_key` ist ein normaler Parameter), API-Schlüssel deckt `api_key` u. ä. ab.
 */
const SECRET_PARAM =
  /(^|[_-])(pairing_id|token|wstoken|access_token|secret|password|passwd|nonce|code|api_key|apikey|access_key|private_key|auth)($|[_-])/i;

/** Ein Paar `name=wert` der Query: geheimer Name → Wert `[Redacted]`. Der Name wird vor dem Vergleich dekodiert */
function redactQueryPair(pair: string): string {
  const eq = pair.indexOf('=');
  if (eq <= 0) return pair;
  const rawName = pair.slice(0, eq);
  let name = rawName;
  try {
    name = decodeURIComponent(rawName.replace(/\+/g, ' '));
  } catch {
    // kaputte Kodierung: den Rohnamen prüfen
  }
  // `/p#?pairing_id=…`: Fastify liest den Schlüssel `?pairing_id`. Kein Geheimnis für den Core, aber
  // vermutlich eines für den Absender, darum führende `?`/`#` beim Vergleich ignorieren (lieber zu viel schwärzen)
  return SECRET_PARAM.test(name.replace(/^[?#]+/, '')) ? `${rawName}=[Redacted]` : pair;
}

/**
 * Ersetzt in einer URL oder einem Logtext (z. B. Fastifys „Route GET:/x?… not found“) die Werte geheimer
 * Query-Parameter durch `[Redacted]`. Zerlegt wird wie Fastify (find-my-way `url-sanitizer` und Query-Parser,
 * Issue #100): Die Query beginnt beim ersten `?` **oder** `#`, je nachdem, was zuerst kommt
 * (`DELETE /devices/pairings#pairing_id=…` liest Fastify als Query), und reicht bis zum nächsten Leerraum. Paare
 * trennt nur `&`, ein Wert reicht bis zum nächsten `&` (auch über weitere `#` und `?` hinweg). So bleibt weder
 * ein Rest des Werts (`?pairing_id=…#x`) noch ein Parameter hinter einem `&` im Pfad (`/a&b=c?pairing_id=…`)
 * stehen.
 */
export function redactUrl(text: string): string {
  return text.replace(
    /([?#])(\S*)/g,
    (_match, sep: string, query: string) => `${sep}${query.split('&').map(redactQueryPair).join('&')}`,
  );
}

/** `err`-Serializer: wie pino, aber `message` und `stack` laufen durch `redactUrl` */
export function serializeError(err: unknown): unknown {
  const serialized = pino.stdSerializers.err(err as Error);
  if (serialized && typeof serialized === 'object') {
    const out = serialized as unknown as Record<string, unknown>;
    for (const field of ['message', 'stack']) {
      if (typeof out[field] === 'string') out[field] = redactUrl(out[field]);
    }
  }
  return serialized;
}

/** `req`-Serializer für das Request-Log: wie der von Fastify, aber mit geschwärzter Query */
export function serializeRequest(req: {
  method?: string;
  url?: string;
  headers?: Record<string, unknown>;
  host?: string;
  hostname?: string;
  ip?: string;
  socket?: { remoteAddress?: string; remotePort?: number };
}): Record<string, unknown> {
  return {
    method: req.method,
    url: typeof req.url === 'string' ? redactUrl(req.url) : req.url,
    host: req.host ?? req.hostname,
    remoteAddress: req.ip ?? req.socket?.remoteAddress,
    remotePort: req.socket?.remotePort,
  };
}

/** Gemeinsame pino-Optionen (auch für Tests über den echten Log-Strom) */
export function loggerOptions(config: Pick<Config, 'logLevel'>): pino.LoggerOptions {
  return {
    level: config.logLevel,
    base: { service: 'core' },
    timestamp: pino.stdTimeFunctions.isoTime,
    // Geheimnisse nie loggen (09 §4). Moodle-Token (08 §9.1) zur Sicherheit auch, falls er je in ein Log-Objekt gerät
    redact: ['req.headers.authorization', 'req.headers.cookie', 'wstoken', 'token', '*.wstoken', '*.token'],
    serializers: { req: serializeRequest, err: serializeError },
    hooks: {
      // Auch Meldungstexte schwärzen, in denen eine URL steht („Route … not found“)
      logMethod(args, method) {
        // Formatstring und alle printf-Argumente (`log.info('Route %s', url)`)
        const list: unknown[] = [...args];
        // `log.error(err)`: pino übernimmt `err.message` als Meldung am Hook vorbei, darum selbst setzen
        if (list[0] instanceof Error)
          list.splice(0, 1, { err: list[0] }, ...(list.length === 1 ? [list[0].message] : []));
        const redacted = list.map((arg) => (typeof arg === 'string' ? redactUrl(arg) : arg));
        return method.apply(this, redacted as unknown as Parameters<typeof method>);
      },
    },
  };
}

/**
 * Strukturierte JSON-Logs nach stdout und (optional) `$SG_DATA_DIR/logs/core.log` (VERTRAEGE §4).
 * Die Datei wird synchron geschrieben, damit auch Fehler beim Start (z. B. Port belegt) im Log landen.
 * Rotation: beim Start, stündlich und nach je etwa 1 MB geschriebener Zeilen geprüft (täglich: `rotateLogs`,
 * Größe: `enforceLogSizeLimits`).
 */
export function createLogger(
  config: Pick<Config, 'dataDir' | 'logLevel'>,
  options: { file?: boolean; limits?: LogSizeLimits } = {},
): Logger {
  const streams: pino.StreamEntry[] = [{ stream: process.stdout }];
  if (options.file !== false) {
    const logDir = join(config.dataDir, 'logs');
    const limits = options.limits ?? { maxFileBytes: LOG_MAX_FILE_BYTES, maxTotalBytes: LOG_MAX_TOTAL_BYTES };
    let openedDay = rotateLogs(logDir, initialLogDay(logDir));
    enforceLogSizeLimits(logDir, limits);
    const destination = pino.destination({ dest: join(logDir, 'core.log'), mkdir: true, sync: true });
    const maintain = (): void => {
      try {
        const day = rotateLogs(logDir, openedDay);
        const sizeRotated = enforceLogSizeLimits(logDir, limits);
        if (day !== openedDay || sizeRotated) {
          destination.reopen();
          // Die synchrone SonicBoom-Datei meldet „ready“ nach reopen() nie, jedes reopen() hinterlässt aber einen
          // Listener (Warnung ab dem 11., bei häufiger Größenrotation sonst ein Leck)
          destination.removeAllListeners('ready');
          openedDay = day;
        }
      } catch {
        // Rotation darf den Core nie stören
      }
    };
    // Größe nach jeweils etwa 1 MB (bzw. 1/8 der Dateigrenze) neu prüfen, nicht nur stündlich:
    // So überschreitet auch eine Flut die Grenze nur um diese Spanne
    const checkEvery = Math.max(1, Math.min(1024 * 1024, Math.floor(limits.maxFileBytes / 8)));
    let sinceCheck = 0;
    streams.push({
      stream: {
        write(chunk: string): void {
          destination.write(chunk);
          sinceCheck += Buffer.byteLength(chunk);
          if (sinceCheck >= checkEvery) {
            sinceCheck = 0;
            maintain();
          }
        },
      },
    });
    setInterval(maintain, 60 * 60 * 1000).unref();
  }
  return pino(loggerOptions(config), pino.multistream(streams));
}
