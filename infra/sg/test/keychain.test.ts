import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// Der Leser des Core: beweist, dass CLI und Core dieselbe Schlüsselbund-Kennung nutzen
import {
  KEYCHAIN_SERVICE as CORE_KEYCHAIN_SERVICE,
  KeychainTokenStore,
} from '../../../services/core/src/moodle/token-store.ts';
import { KeychainError, redact, SecurityKeychain, type SecurityRunner } from '../src/keychain.ts';
import { KEYCHAIN_SERVICE } from '../src/moodle.ts';
import { installFakeSecurity, type FakeSecurity } from './fixtures/fake-security.ts';

// Testwerte zur Laufzeit gebaut und offensichtlich unecht (öffentliches Repo, Secret-Scanner)
const TOKEN = 'ab'.repeat(16);

describe('SecurityKeychain mit Schlüsselbund-Fake (echtes Programm `security` in PATH)', () => {
  let fake: FakeSecurity;
  beforeEach(() => {
    fake = installFakeSecurity();
  });
  afterEach(() => fake.restore());

  it('nutzt dieselbe Kennung wie der Core: was die CLI speichert, liest der Core', async () => {
    expect(KEYCHAIN_SERVICE).toBe(CORE_KEYCHAIN_SERVICE);
    const keychain = new SecurityKeychain();
    await keychain.store(KEYCHAIN_SERVICE, 'anna', TOKEN);
    // Der echte Leser des Core (security find-generic-password -s studiengehirn-moodle -w)
    await expect(new KeychainTokenStore().getToken()).resolves.toBe(TOKEN);
    await expect(keychain.read(KEYCHAIN_SERVICE)).resolves.toBe(TOKEN);
  });

  it('übergibt den Token nie als Argument (ps), sondern über stdin an `security -i`', async () => {
    const keychain = new SecurityKeychain();
    await keychain.store(KEYCHAIN_SERVICE, 'anna', TOKEN);
    await keychain.exists(KEYCHAIN_SERVICE);
    await keychain.removeAll(KEYCHAIN_SERVICE);
    const calls = fake.calls();
    expect(calls[0]).toEqual(['-i']);
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const argv of calls) expect(argv.join(' ')).not.toContain(TOKEN);
    expect(fake.items()).toEqual([]);
  });

  it('exists() liest den Wert nicht (weder -w noch -g)', async () => {
    const keychain = new SecurityKeychain();
    await expect(keychain.exists(KEYCHAIN_SERVICE)).resolves.toBe(false);
    await keychain.store(KEYCHAIN_SERVICE, 'anna', TOKEN);
    await expect(keychain.exists(KEYCHAIN_SERVICE)).resolves.toBe(true);
    const existsCalls = fake.calls().filter((argv) => argv[0] === 'find-generic-password');
    for (const argv of existsCalls) {
      expect(argv).not.toContain('-w');
      expect(argv).not.toContain('-g');
    }
  });

  it('ersetzt einen vorhandenen Eintrag (-U) und löscht alle Einträge zum Dienst', async () => {
    const keychain = new SecurityKeychain();
    await keychain.store(KEYCHAIN_SERVICE, 'anna', TOKEN);
    await keychain.store(KEYCHAIN_SERVICE, 'anna', 'f'.repeat(32));
    await keychain.store(KEYCHAIN_SERVICE, 'zweites-konto', 'e'.repeat(32));
    expect(fake.items()).toHaveLength(2);
    await expect(keychain.read(KEYCHAIN_SERVICE)).resolves.toBe('f'.repeat(32));
    await expect(keychain.removeAll(KEYCHAIN_SERVICE)).resolves.toBe(2);
    await expect(keychain.read(KEYCHAIN_SERVICE)).resolves.toBeNull();
  });
});

describe('SecurityKeychain (Fehlerfälle)', () => {
  it('nennt den Token nicht, auch wenn `security` ihn in einer Fehlermeldung wiederholt', async () => {
    const runner: SecurityRunner = async () => ({
      code: 1,
      stdout: '',
      stderr: `add-generic-password -a anna -s ${KEYCHAIN_SERVICE} -U -w ${TOKEN}: User interaction is not allowed.`,
    });
    const error = await new SecurityKeychain(runner).store(KEYCHAIN_SERVICE, 'anna', TOKEN).catch((e) => e);
    expect(error).toBeInstanceOf(KeychainError);
    expect(error.message).toContain('User interaction is not allowed');
    expect(error.message).not.toContain(TOKEN);
  });

  it('verweigert Werte, die den interaktiven Modus manipulieren könnten', async () => {
    const calls: string[][] = [];
    const runner: SecurityRunner = async (args) => {
      calls.push(args);
      return { code: 0, stdout: '', stderr: '' };
    };
    const keychain = new SecurityKeychain(runner);
    await expect(
      keychain.store(KEYCHAIN_SERVICE, 'anna', `${TOKEN}\ndelete-generic-password -s x`),
    ).rejects.toBeInstanceOf(KeychainError);
    await expect(keychain.store(KEYCHAIN_SERVICE, 'an na', TOKEN)).rejects.toBeInstanceOf(KeychainError);
    expect(calls).toEqual([]);
  });

  it('redact entfernt Geheimnisse und tokenartige Zeichenketten', () => {
    expect(redact(`x ${TOKEN} y`)).toBe('x *** y');
    expect(redact('Passwort=abc', ['abc'])).toBe('Passwort=***');
  });
});
