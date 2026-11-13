import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KeychainTokenStore } from '../../../services/core/src/moodle/token-store.ts';
import { resolveConfig, type SgConfig } from '../src/config.ts';
import { SecurityKeychain, spawnSecurity, type Keychain } from '../src/keychain.ts';
import { InputError } from '../src/secret-input.ts';
import {
  DEFAULT_MOODLE_URL,
  KEYCHAIN_SERVICE,
  keychainAccount,
  moodleCommand,
  parseLoginArgs,
  parseTokenInput,
  printable,
  realMoodleDeps,
  resolveMoodleUrl,
  validateMoodleUrl,
  TOKEN_VALIDITY_DAYS,
  type FetchFn,
  type MoodleDeps,
} from '../src/moodle.ts';
import { installFakeSecurity, TEST_SERVICE } from './fixtures/fake-security.ts';

// Testwerte zur Laufzeit gebaut und offensichtlich unecht (öffentliches Repo, Secret-Scanner)
const TOKEN = 'ab'.repeat(16);
const PRIVATE_TOKEN = ['privat', 'unecht', 'test'].join('-');
const PASSWORD = ['passwort', 'unecht', 'test'].join('-');
const USERNAME = 'anna.student';
const MOODLE = 'https://moodle.test';
const NOW = new Date('2026-11-05T10:00:00Z');

interface Recorded {
  method: string;
  url: string;
  body: string;
}

type Handler = (req: Recorded, res: ServerResponse) => void;

/** Fake-Moodle über HTTP. Die CLI spricht https://moodle.test, der Test leitet das auf diesen Server um */
class FakeMoodle {
  readonly requests: Recorded[] = [];
  private server: Server | null = null;
  handlers: Record<string, Handler> = {};
  port = 0;

  async start(): Promise<void> {
    this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk: string) => (body += chunk));
      req.on('end', () => {
        const recorded = { method: req.method ?? '', url: req.url ?? '', body };
        this.requests.push(recorded);
        const path = (req.url ?? '').split('?')[0] ?? '';
        const handler = this.handlers[path];
        if (handler) handler(recorded, res);
        else {
          res.statusCode = 404;
          res.end('{}');
        }
      });
    });
    await new Promise<void>((resolve) => this.server?.listen(0, '127.0.0.1', resolve));
    this.port = (this.server?.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }

  /** fetch, das https://moodle.test auf den lokalen Server umbiegt. Alle anderen Optionen bleiben unverändert */
  fetch: FetchFn = (url, init) => {
    this.fetchCalls += 1;
    const target = url.startsWith(MOODLE) ? `http://127.0.0.1:${this.port}${url.slice(MOODLE.length)}` : url;
    return fetch(target, init);
  };
  fetchCalls = 0;
}

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(data));
}

function form(body: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(body));
}

const SITE_INFO = {
  sitename: 'Moodle.UP',
  siteurl: 'https://moodle.test',
  fullname: 'Anna Student',
  userid: 4242,
  functions: [],
};

/** Schlüsselbund im Speicher, verhält sich wie `security` (erster Treffer zum Dienst) */
class MemoryKeychain implements Keychain {
  items: { service: string; account: string; secret: string }[] = [];
  async store(service: string, account: string, secret: string): Promise<void> {
    const existing = this.items.find((i) => i.service === service && i.account === account);
    if (existing) existing.secret = secret;
    else this.items.push({ service, account, secret });
  }
  async read(service: string): Promise<string | null> {
    return this.items.find((i) => i.service === service)?.secret ?? null;
  }
  async exists(service: string): Promise<boolean> {
    return this.items.some((i) => i.service === service);
  }
  async removeAll(service: string): Promise<number> {
    const before = this.items.length;
    this.items = this.items.filter((i) => i.service !== service);
    return before - this.items.length;
  }
}

interface TestIo {
  lines: string[];
  prompts: string[];
  hiddenPrompts: string[];
}

function makeDeps(
  overrides: Partial<MoodleDeps> & {
    answers?: string[];
    hidden?: string[];
    stdin?: string;
    stdinError?: Error;
    tty?: boolean;
  } = {},
): { deps: MoodleDeps; io: TestIo; keychain: Keychain } {
  const io: TestIo = { lines: [], prompts: [], hiddenPrompts: [] };
  const answers = [...(overrides.answers ?? [USERNAME])];
  const hidden = [...(overrides.hidden ?? [PASSWORD])];
  const kc = overrides.keychain ?? new MemoryKeychain();
  const deps: MoodleDeps = {
    fetch: overrides.fetch ?? (() => Promise.reject(new Error('kein fetch erwartet'))),
    keychain: kc,
    env: overrides.env ?? { SG_MOODLE_URL: MOODLE },
    now: () => NOW,
    account: 'anna',
    // Nie der echte Dienst: Tests dürfen den Token des Owners nicht berühren
    service: TEST_SERVICE,
    io: {
      out: (line) => io.lines.push(line),
      err: (line) => io.lines.push(line),
      prompt: async (question) => {
        io.prompts.push(question);
        return answers.shift() ?? '';
      },
      promptHidden: async (question) => {
        io.hiddenPrompts.push(question);
        return hidden.shift() ?? '';
      },
      readStdin: async () => {
        if (overrides.stdinError) throw overrides.stdinError;
        return overrides.stdin ?? '';
      },
      stdinIsTty: overrides.tty ?? true,
    },
  };
  return { deps, io, keychain: kc };
}

/** Kein Geheimnis darf in Ausgaben, Meldungen oder Prompts stehen */
function expectNoSecrets(io: TestIo, extra: string[] = []): void {
  const all = [...io.lines, ...io.prompts, ...io.hiddenPrompts].join('\n');
  for (const secret of [TOKEN, PASSWORD, PRIVATE_TOKEN, ...extra]) expect(all).not.toContain(secret);
}

let dataDir: string;
let cfg: SgConfig;
let moodle: FakeMoodle;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'sg-moodle-'));
  cfg = resolveConfig({ SG_DATA_DIR: dataDir, SG_CORE_PORT: '1' }, tmpdir(), '/repo');
  moodle = new FakeMoodle();
  moodle.handlers['/login/token.php'] = (req, res) => {
    const params = form(req.body);
    if (params.username === USERNAME && params.password === PASSWORD) {
      json(res, { token: TOKEN, privatetoken: PRIVATE_TOKEN });
    } else {
      // Moodle-Fehlertexte werden nie ausgegeben, auch wenn sie Eingaben wiederholen
      json(res, { error: `Ungültige Anmeldung für ${params.password}`, errorcode: 'invalidlogin' });
    }
  };
  moodle.handlers['/webservice/rest/server.php'] = (req, res) => {
    const params = form(req.body);
    if (params.wstoken === TOKEN && params.wsfunction === 'core_webservice_get_site_info')
      json(res, SITE_INFO);
    else
      json(res, {
        exception: 'moodle_exception',
        errorcode: 'invalidtoken',
        message: `Token ${params.wstoken}`,
      });
  };
  await moodle.start();
});

afterEach(async () => {
  await moodle.stop();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('moodle login mit Benutzername und Passwort', () => {
  it('holt den Token per POST, prüft ihn, speichert ihn im Schlüsselbund und zeigt Name und Seite', async () => {
    const { deps, io, keychain } = makeDeps({ fetch: moodle.fetch });
    const code = await moodleCommand(cfg, ['login'], deps);
    expect(code).toBe(0);

    // Passwort nur verdeckt abgefragt
    expect(io.prompts).toEqual(['Moodle-Benutzername: ']);
    expect(io.hiddenPrompts).toEqual(['Passwort (wird nicht angezeigt): ']);

    // Passwort und Token nur im Body, nie in der URL (Gegenprobe: Parameter als Query → rot)
    const [tokenReq, siteReq] = moodle.requests;
    expect(tokenReq).toMatchObject({ method: 'POST', url: '/login/token.php' });
    expect(form(tokenReq?.body ?? '')).toEqual({
      username: USERNAME,
      password: PASSWORD,
      service: 'moodle_mobile_app',
    });
    expect(siteReq).toMatchObject({ method: 'POST', url: '/webservice/rest/server.php' });
    expect(form(siteReq?.body ?? '')).toMatchObject({
      wstoken: TOKEN,
      wsfunction: 'core_webservice_get_site_info',
    });
    for (const req of moodle.requests) {
      expect(req.url).not.toContain(PASSWORD);
      expect(req.url).not.toContain(TOKEN);
    }

    // Token im Schlüsselbund unter der Kennung des Core
    await expect(keychain.read(TEST_SERVICE)).resolves.toBe(TOKEN);

    // Metadaten ohne Token, Rechte 600
    const metaFile = join(dataDir, 'config', 'moodle.json');
    const raw = readFileSync(metaFile, 'utf8');
    expect(raw).not.toContain(TOKEN);
    expect(raw).not.toContain(PRIVATE_TOKEN);
    expect(JSON.parse(raw)).toEqual({
      site_url: MOODLE,
      user_id: 4242,
      token_valid_until: '2027-01-28',
      created_at: NOW.toISOString(),
    });
    expect(TOKEN_VALIDITY_DAYS).toBe(84);
    expect(statSync(metaFile).mode & 0o777).toBe(0o600);

    const output = io.lines.join('\n');
    expect(output).toContain('Moodle.UP');
    expect(output).toContain('https://moodle.test');
    expect(output).toContain('Anna Student');
    expectNoSecrets(io);
  });

  it('übernimmt --gueltig-bis', async () => {
    const { deps } = makeDeps({ fetch: moodle.fetch });
    expect(await moodleCommand(cfg, ['login', '--gueltig-bis', '2027-02-01'], deps)).toBe(0);
    const meta = JSON.parse(readFileSync(join(dataDir, 'config', 'moodle.json'), 'utf8'));
    expect(meta.token_valid_until).toBe('2027-02-01');
  });

  it('meldet ein falsches Passwort ohne Passwort und ohne Moodle-Fehlertext', async () => {
    const wrong = ['falsch', 'unecht'].join('-');
    const { deps, io, keychain } = makeDeps({ fetch: moodle.fetch, hidden: [wrong] });
    expect(await moodleCommand(cfg, ['login'], deps)).toBe(1);
    const output = io.lines.join('\n');
    expect(output).toContain('invalidlogin');
    expect(output).toContain('--token-stdin');
    // Gegenprobe: Moodle wiederholt das Passwort im Fehlertext
    expect(output).not.toContain('Ungültige Anmeldung');
    expectNoSecrets(io, [wrong]);
    await expect(keychain.read(TEST_SERVICE)).resolves.toBeNull();
  });

  it('folgt keiner Weiterleitung, das Passwort geht nicht an ein anderes Ziel', async () => {
    let evilHits = 0;
    moodle.handlers['/login/token.php'] = (_req, res) => {
      res.statusCode = 307;
      res.setHeader('location', `http://127.0.0.1:${moodle.port}/evil`);
      res.end();
    };
    moodle.handlers['/evil'] = (_req, res) => {
      evilHits += 1;
      json(res, { token: TOKEN });
    };
    const { deps, io, keychain } = makeDeps({ fetch: moodle.fetch });
    expect(await moodleCommand(cfg, ['login'], deps)).toBe(1);
    expect(evilHits).toBe(0);
    expect(moodle.requests.map((r) => r.url)).toEqual(['/login/token.php']);
    expect(io.lines.join('\n')).toContain('leitet');
    expectNoSecrets(io);
    await expect(keychain.read(TEST_SERVICE)).resolves.toBeNull();
  });

  it('lehnt einen Token ab, den login/token.php nicht im Token-Format liefert', async () => {
    moodle.handlers['/login/token.php'] = (_req, res) =>
      json(res, { token: `${TOKEN}\nadd-generic-password -s x`, privatetoken: PRIVATE_TOKEN });
    const { deps, io, keychain } = makeDeps({ fetch: moodle.fetch });
    expect(await moodleCommand(cfg, ['login'], deps)).toBe(1);
    expect(io.lines.join('\n')).toContain('keinen gültigen Token');
    expect(moodle.requests.map((r) => r.url)).toEqual(['/login/token.php']);
    await expect(keychain.read(TEST_SERVICE)).resolves.toBeNull();
    expectNoSecrets(io);
  });

  it('verbindet sich nur per https und nur zur konfigurierten Instanz', async () => {
    for (const url of [
      'http://moodle.test',
      'https://user:pw@moodle.test',
      'https://moodle.test/?x=1',
      'ftp://x',
    ]) {
      const { deps, io } = makeDeps({ fetch: moodle.fetch, env: { SG_MOODLE_URL: url } });
      expect(await moodleCommand(cfg, ['login'], deps)).toBe(1);
      expect(io.lines.join('\n')).toContain('SG_MOODLE_URL');
      expect(io.lines.join('\n')).not.toContain('pw@');
    }
    expect(moodle.fetchCalls).toBe(0);
  });

  it('speichert einen Token nicht, den Moodle ablehnt', async () => {
    moodle.handlers['/webservice/rest/server.php'] = (req, res) =>
      json(res, {
        exception: 'x',
        errorcode: 'invalidtoken',
        message: `Token ${form(req.body).wstoken} ungültig`,
      });
    const { deps, io, keychain } = makeDeps({ fetch: moodle.fetch });
    expect(await moodleCommand(cfg, ['login'], deps)).toBe(1);
    expect(io.lines.join('\n')).toContain('invalidtoken');
    expectNoSecrets(io);
    await expect(keychain.read(TEST_SERVICE)).resolves.toBeNull();
    expect(existsSync(join(dataDir, 'config', 'moodle.json'))).toBe(false);
  });

  it('nennt bei Netzwerkfehlern nur den Grund, nie den Fehlertext', async () => {
    const failing: FetchFn = async (_url, init) => {
      throw new TypeError(`fetch failed: ${String(init.body)}`, {
        cause: Object.assign(new Error(String(init.body)), { code: 'ECONNREFUSED' }),
      });
    };
    const { deps, io } = makeDeps({ fetch: failing });
    expect(await moodleCommand(cfg, ['login'], deps)).toBe(1);
    expect(io.lines.join('\n')).toContain('ECONNREFUSED');
    expectNoSecrets(io, [USERNAME]);
  });

  it('nennt bei unerwarteten Fehlern keine Meldung (könnte den Token enthalten)', async () => {
    const keychain = new MemoryKeychain();
    keychain.store = async (_s, _a, secret) => {
      throw new Error(`kaputt: ${secret}`);
    };
    const { deps, io } = makeDeps({ fetch: moodle.fetch, keychain });
    expect(await moodleCommand(cfg, ['login'], deps)).toBe(1);
    expect(io.lines.join('\n')).toContain('Unerwarteter Fehler');
    expectNoSecrets(io);
  });

  it('räumt einen fremden Eintrag zum selben Dienst auf, damit der Core den neuen Token liest', async () => {
    const keychain = new MemoryKeychain();
    await keychain.store(TEST_SERVICE, 'altes-konto', 'a'.repeat(32));
    const { deps } = makeDeps({ fetch: moodle.fetch, keychain });
    expect(await moodleCommand(cfg, ['login'], deps)).toBe(0);
    await expect(keychain.read(TEST_SERVICE)).resolves.toBe(TOKEN);
    expect(keychain.items).toEqual([{ service: TEST_SERVICE, account: 'anna', secret: TOKEN }]);
  });

  it('fragt ohne Terminal kein Passwort ab', async () => {
    const { deps, io } = makeDeps({ fetch: moodle.fetch, tty: false });
    expect(await moodleCommand(cfg, ['login'], deps)).toBe(1);
    expect(io.prompts).toEqual([]);
    expect(io.hiddenPrompts).toEqual([]);
    expect(io.lines.join('\n')).toContain('--token-stdin');
  });
});

describe('moodle login: Hinweis zum laufenden Core', () => {
  const coreStatus = (state: string, siteUrl: string | null = MOODLE): Record<string, unknown> => ({
    state,
    site_url: siteUrl,
    site_name: null,
    user_fullname: null,
    token_valid_until: null,
    checked_at: null,
  });

  /** Moodle-Aufrufe gehen an den Fake-Server, Core-Aufrufe (127.0.0.1) an `core` */
  function routedFetch(core: (url: string) => Promise<Response>): { fetch: FetchFn; coreCalls: string[] } {
    const coreCalls: string[] = [];
    const fetchFn: FetchFn = (url, init) => {
      if (url.startsWith('http://127.0.0.1:')) {
        coreCalls.push(`${init.method ?? 'GET'} ${url}`);
        return core(url);
      }
      return moodle.fetch(url, init);
    };
    return { fetch: fetchFn, coreCalls };
  }

  it('Core läuft und kennt noch keinen Token: Hinweis auf höchstens etwa 30 Sekunden, nur lesend über 127.0.0.1', async () => {
    const { fetch: fetchFn, coreCalls } = routedFetch(async () =>
      Response.json(coreStatus('nicht_eingerichtet')),
    );
    const { deps, io } = makeDeps({ fetch: fetchFn });
    expect(await moodleCommand(cfg, ['login'], deps)).toBe(0);
    expect(coreCalls).toEqual([`GET http://127.0.0.1:${cfg.corePort}/api/v1/moodle/status`]);
    expect(io.lines.join('\n')).toMatch(
      /Der Core läuft und liest den neuen Token spätestens nach etwa 30 Sekunden/,
    );
    expectNoSecrets(io);
  });

  it('fragt den Core, bevor der Token im Schlüsselbund liegt (sonst lädt schon die Abfrage den neuen Token)', async () => {
    const keychain = new MemoryKeychain();
    const seen: (string | null)[] = [];
    const { fetch: fetchFn } = routedFetch(async () => {
      seen.push(await keychain.read(TEST_SERVICE));
      return Response.json(coreStatus('nicht_eingerichtet'));
    });
    const { deps } = makeDeps({ fetch: fetchFn, keychain });
    expect(await moodleCommand(cfg, ['login'], deps)).toBe(0);
    expect(seen).toEqual([null]);
    expect(await keychain.read(TEST_SERVICE)).toBe(TOKEN);
  });

  it('Core lief mit bisherigem Token: Hinweis auf Neustart, Exit-Code 0', async () => {
    for (const state of ['ok', 'laeuft_bald_ab', 'nicht_erreichbar']) {
      const { deps, io } = makeDeps({
        fetch: routedFetch(async () => Response.json(coreStatus(state))).fetch,
      });
      expect(await moodleCommand(cfg, ['login'], deps)).toBe(0);
      expect(io.lines.join('\n')).toMatch(/bisherigen Token: pnpm sg stop && pnpm sg start/);
    }
  });

  it('Core hatte einen abgelehnten Token: liest den neuen binnen etwa einer Minute', async () => {
    for (const state of ['ungueltig', 'abgelaufen']) {
      const { deps, io } = makeDeps({
        fetch: routedFetch(async () => Response.json(coreStatus(state))).fetch,
      });
      expect(await moodleCommand(cfg, ['login'], deps)).toBe(0);
      expect(io.lines.join('\n')).toMatch(/spätestens nach etwa einer Minute/);
    }
  });

  it('Core läuft ohne SG_MOODLE_URL: Hinweis auf Eintrag und Neustart', async () => {
    const { fetch: fetchFn } = routedFetch(async () => Response.json(coreStatus('nicht_eingerichtet', null)));
    const { deps, io } = makeDeps({ fetch: fetchFn });
    expect(await moodleCommand(cfg, ['login'], deps)).toBe(0);
    expect(io.lines.join('\n')).toMatch(
      /ohne SG_MOODLE_URL\. Nach dem Eintrag: pnpm sg stop && pnpm sg start/,
    );
    expect(io.lines.join('\n')).not.toMatch(/30 Sekunden/);
  });

  it('Core läuft nicht oder antwortet falsch: kein Hinweis, kein Fehler', async () => {
    for (const core of [
      async (): Promise<Response> => Promise.reject(new Error('ECONNREFUSED')),
      async (): Promise<Response> => new Response('kaputt', { status: 500 }),
      async (): Promise<Response> => Response.json({ state: 'unbekannt' }),
    ]) {
      const { deps, io } = makeDeps({ fetch: routedFetch(core).fetch });
      expect(await moodleCommand(cfg, ['login'], deps)).toBe(0);
      expect(io.lines.join('\n')).not.toMatch(/Der Core läuft/);
    }
  });
});

describe('moodle login --token-stdin', () => {
  it('nimmt einen Token aus einer Pipe, ohne login/token.php', async () => {
    const { deps, io, keychain } = makeDeps({ fetch: moodle.fetch, tty: false, stdin: `${TOKEN}\n` });
    expect(await moodleCommand(cfg, ['login', '--token-stdin'], deps)).toBe(0);
    expect(moodle.requests.map((r) => r.url)).toEqual(['/webservice/rest/server.php']);
    await expect(keychain.read(TEST_SERVICE)).resolves.toBe(TOKEN);
    expectNoSecrets(io);
  });

  it('nimmt im Terminal den Token verdeckt entgegen, auch als moodlemobile://-Link', async () => {
    const link = `moodlemobile://token=${Buffer.from(`sig123:::${TOKEN}:::${PRIVATE_TOKEN}`).toString('base64')}`;
    const { deps, io, keychain } = makeDeps({ fetch: moodle.fetch, tty: true, hidden: [link] });
    expect(await moodleCommand(cfg, ['login', '--token-stdin'], deps)).toBe(0);
    expect(io.hiddenPrompts).toHaveLength(1);
    expect(io.prompts).toEqual([]);
    await expect(keychain.read(TEST_SERVICE)).resolves.toBe(TOKEN);
    expectNoSecrets(io, [link]);
  });

  it('lehnt Unbrauchbares ab, ohne es zu wiederholen', async () => {
    const junk = ['kein', 'brauchbarer', 'wert'].join('-');
    const { deps, io } = makeDeps({ fetch: moodle.fetch, tty: false, stdin: junk });
    expect(await moodleCommand(cfg, ['login', '--token-stdin'], deps)).toBe(1);
    expect(moodle.fetchCalls).toBe(0);
    expectNoSecrets(io, [junk]);
  });

  it('Ende-zu-Ende mit Schlüsselbund-Fake: kein Token in argv von `security`, der Core liest ihn', async () => {
    const fake = installFakeSecurity();
    try {
      const { deps, io } = makeDeps({
        fetch: moodle.fetch,
        tty: false,
        stdin: TOKEN,
        keychain: new SecurityKeychain(spawnSecurity(fake.bin)),
      });
      expect(await moodleCommand(cfg, ['login', '--token-stdin'], deps)).toBe(0);
      expectNoSecrets(io);
      const calls = fake.calls();
      expect(calls.length).toBeGreaterThan(0);
      for (const argv of calls) expect(argv.join(' ')).not.toContain(TOKEN);
      await expect(new KeychainTokenStore({ service: TEST_SERVICE }).getToken()).resolves.toBe(TOKEN);

      // logout löscht den Eintrag, der Core findet danach nichts mehr
      expect(await moodleCommand(cfg, ['logout'], deps)).toBe(0);
      expect(fake.items()).toEqual([]);
      await expect(new KeychainTokenStore({ service: TEST_SERVICE }).getToken()).resolves.toBeNull();
    } finally {
      fake.restore();
    }
  });
});

describe('moodle status und logout', () => {
  it('status fragt den laufenden Core', async () => {
    const core = createServer((req, res) => {
      if (req.url === '/api/v1/moodle/status') {
        json(res, {
          state: 'ok',
          site_url: 'https://moodle.test',
          site_name: 'Moodle.UP',
          user_fullname: 'Anna Student',
          token_valid_until: '2027-01-28',
          checked_at: NOW.toISOString(),
        });
      } else json(res, {}, 404);
    });
    await new Promise<void>((resolve) => core.listen(0, '127.0.0.1', resolve));
    try {
      const port = (core.address() as AddressInfo).port;
      const coreCfg = { ...cfg, corePort: port };
      const { deps, io } = makeDeps({ fetch: (url, init) => fetch(url, init) });
      expect(await moodleCommand(coreCfg, ['status'], deps)).toBe(0);
      const output = io.lines.join('\n');
      expect(output).toContain('ok');
      expect(output).toContain('Moodle.UP');
      expect(output).toContain('Anna Student');
      expect(output).toContain('2027-01-28');
    } finally {
      await new Promise<void>((resolve) => core.close(() => resolve()));
    }
  });

  it('status ohne Core sieht nur nach, ob es einen Eintrag gibt (liest den Token nicht)', async () => {
    const keychain = new MemoryKeychain();
    let reads = 0;
    keychain.read = async () => {
      reads += 1;
      return null;
    };
    const { deps, io } = makeDeps({ fetch: (url, init) => fetch(url, init), keychain });
    expect(await moodleCommand(cfg, ['status'], deps)).toBe(1);
    expect(io.lines.join('\n')).toContain('kein Eintrag');
    await keychain.store(TEST_SERVICE, 'anna', TOKEN);
    expect(await moodleCommand(cfg, ['status'], deps)).toBe(0);
    expect(io.lines.join('\n')).toContain('Eintrag vorhanden');
    expect(reads).toBe(0);
    expectNoSecrets(io);
  });

  it('logout löscht alle Einträge zum Dienst und config/moodle.json', async () => {
    const keychain = new MemoryKeychain();
    await keychain.store(TEST_SERVICE, 'anna', TOKEN);
    await keychain.store(TEST_SERVICE, 'alt', 'b'.repeat(32));
    await keychain.store('anderer-dienst', 'anna', 'c'.repeat(32));
    mkdirSync(join(dataDir, 'config'), { recursive: true });
    writeFileSync(join(dataDir, 'config', 'moodle.json'), '{}');
    const { deps, io } = makeDeps({ keychain });
    expect(await moodleCommand(cfg, ['logout'], deps)).toBe(0);
    expect(await keychain.exists(TEST_SERVICE)).toBe(false);
    expect(await keychain.exists('anderer-dienst')).toBe(true);
    expect(existsSync(join(dataDir, 'config', 'moodle.json'))).toBe(false);
    expect(io.lines.join('\n')).toContain('2 Eintrag');
  });

  it('meldet unbekannte Unterbefehle', async () => {
    const { deps, io } = makeDeps();
    expect(await moodleCommand(cfg, ['loginn'], deps)).toBe(1);
    expect(await moodleCommand(cfg, [], deps)).toBe(1);
    expect(io.lines.join('\n')).toContain('moodle login');
  });

  it('wiederholt einen Token nicht, der versehentlich als Unterbefehl getippt wurde (pnpm sg moodle <token>)', async () => {
    const { deps, io } = makeDeps();
    expect(await moodleCommand(cfg, [TOKEN], deps)).toBe(1);
    expect(await moodleCommand(cfg, [PASSWORD, TOKEN], deps)).toBe(1);
    expect(io.lines.join('\n')).toContain('Unbekannter Unterbefehl');
    expectNoSecrets(io);
  });

  it('meldet zu lange Eingaben verständlich, ohne die Eingabe', async () => {
    const { deps, io } = makeDeps({
      fetch: moodle.fetch,
      tty: false,
      stdinError: new InputError('Eingabe ist zu lang (höchstens 4096 Zeichen).'),
    });
    expect(await moodleCommand(cfg, ['login', '--token-stdin'], deps)).toBe(1);
    const output = io.lines.join('\n');
    expect(output).toContain('Eingabe ist zu lang');
    expect(output).not.toContain('Unerwarteter Fehler');
  });

  it('die echten Abhängigkeiten nutzen den Dienst des Core', () => {
    expect(realMoodleDeps().service).toBe(KEYCHAIN_SERVICE);
  });
});

describe('Hilfsfunktionen', () => {
  it('parseLoginArgs wiederholt keine Werte unbekannter Optionen', () => {
    const result = parseLoginArgs(['--token', TOKEN], NOW);
    expect(result).toHaveProperty('error');
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(JSON.stringify(parseLoginArgs([`--password=${PASSWORD}`], NOW))).not.toContain(PASSWORD);
    expect(JSON.stringify(parseLoginArgs([PASSWORD], NOW))).not.toContain(PASSWORD);
    expect(parseLoginArgs(['--gueltig-bis=2027-01-01', '--token-stdin'], NOW)).toEqual({
      tokenStdin: true,
      validUntil: '2027-01-01',
    });
    expect(parseLoginArgs(['--gueltig-bis', '2026-02-30'], NOW)).toHaveProperty('error');
    expect(parseLoginArgs(['--gueltig-bis', '2025-01-01'], NOW)).toHaveProperty('error');
    expect(parseLoginArgs(['--gueltig-bis'], NOW)).toHaveProperty('error');
  });

  it('parseTokenInput akzeptiert Token und moodlemobile://-Link', () => {
    expect(parseTokenInput(` ${TOKEN}\n`)).toBe(TOKEN);
    const encoded = Buffer.from(`sig:::${TOKEN}`).toString('base64').replace(/=/g, '%3D');
    expect(parseTokenInput(`moodlemobile://token=${encoded}`)).toBe(TOKEN);
    expect(parseTokenInput(TOKEN.toUpperCase())).toBeNull();
    expect(parseTokenInput('moodlemobile://token=AAAA')).toBeNull();
    expect(parseTokenInput('')).toBeNull();
  });

  it('resolveMoodleUrl: Umgebung vor config/.env vor Moodle.UP', () => {
    expect(resolveMoodleUrl({}, dataDir)).toEqual({ url: DEFAULT_MOODLE_URL, source: 'default' });
    mkdirSync(join(dataDir, 'config'), { recursive: true });
    writeFileSync(join(dataDir, 'config', '.env'), 'SG_MOODLE_URL=https://aus-datei.test/\n');
    expect(resolveMoodleUrl({}, dataDir)).toEqual({ url: 'https://aus-datei.test', source: 'dotenv' });
    expect(resolveMoodleUrl({ SG_MOODLE_URL: 'https://env.test' }, dataDir)).toEqual({
      url: 'https://env.test',
      source: 'env',
    });
    writeFileSync(join(dataDir, 'config', '.env'), 'SG_MOODLE_URL=http://unsicher.test\n');
    expect(() => resolveMoodleUrl({}, dataDir)).toThrow('https');
  });

  it('printable entfernt Steuerzeichen aus Moodle-Texten (keine Terminal-Steuerfolgen)', () => {
    expect(printable('Moodle\x1b]0;x\x07.UP\r\n\x9b2J')).toBe('Moodle]0;x.UP2J');
    expect(printable(42)).toBe('');
  });

  it('validateMoodleUrl lehnt täuschende Rohwerte ab und gibt nur die normalisierte Form zurück', () => {
    // Backslash: der Parser macht daraus "/", der Host wäre evil.test
    expect(() => validateMoodleUrl('https://evil.test\\@moodle2.uni-potsdam.de')).toThrow('Backslash');
    expect(() => validateMoodleUrl('https://moodle2.uni-potsdam.de\t.evil.test')).toThrow('Steuerzeichen');
    expect(() => validateMoodleUrl('https://moodle2.uni-potsdam.de\n')).not.toThrow(); // nur außen, wird abgeschnitten
    expect(() => validateMoodleUrl('https://moodle2 .uni-potsdam.de')).toThrow('Leer');
    expect(validateMoodleUrl('HTTPS://Moodle2.Uni-Potsdam.DE/')).toBe('https://moodle2.uni-potsdam.de');
    expect(validateMoodleUrl('https://moodle.test:443/lernen/')).toBe('https://moodle.test/lernen');
    expect(validateMoodleUrl('https://moodle.test/a/../b')).toBe('https://moodle.test/b');
  });

  it('zeigt bei login nur die normalisierte Adresse an', async () => {
    const { deps, io } = makeDeps({ fetch: moodle.fetch, env: { SG_MOODLE_URL: 'HTTPS://MOODLE.test/' } });
    expect(await moodleCommand(cfg, ['login'], deps)).toBe(0);
    expect(io.lines[0]).toBe('Moodle-Instanz: https://moodle.test');
    const { deps: deps2, io: io2 } = makeDeps({
      fetch: moodle.fetch,
      env: { SG_MOODLE_URL: 'https://evil.test\\@moodle.test' },
    });
    expect(await moodleCommand(cfg, ['login'], deps2)).toBe(1);
    expect(io2.lines.join('\n')).not.toContain('@moodle.test');
  });

  it('keychainAccount nimmt den Kurznamen, sonst einen festen Namen', () => {
    expect(keychainAccount('anna')).toBe('anna');
    expect(keychainAccount('an na')).toBe('studiengehirn');
    expect(keychainAccount('')).toBe('studiengehirn');
  });
});
