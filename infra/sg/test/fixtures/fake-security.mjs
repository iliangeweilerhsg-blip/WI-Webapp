// Schlüsselbund-Fake für Linux/CI: ahmt die genutzten Teile von macOS `security` nach.
// Zustand in der JSON-Datei FAKE_KEYCHAIN_FILE (Liste von { service, account, password }).
// Jeder Aufruf hängt seine argv (so wie `ps` sie zeigen würde) an FAKE_SECURITY_LOG an.
//
// Unterstützt: -i (Befehle zeilenweise von stdin), add-generic-password -a -s [-U] -w <wert>,
// find-generic-password -s [-a] [-w], delete-generic-password -s [-a]. „Nicht gefunden“ = Exit 44.
// Wie beim echten `security -i` ist der Exit-Code im interaktiven Modus 0, auch wenn ein Befehl scheitert.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const store = process.env.FAKE_KEYCHAIN_FILE;
const log = process.env.FAKE_SECURITY_LOG;
if (!store) {
  process.stderr.write('FAKE_KEYCHAIN_FILE fehlt\n');
  process.exit(2);
}
if (log) appendFileSync(log, `${JSON.stringify(process.argv.slice(2))}\n`);

const load = () => (existsSync(store) ? JSON.parse(readFileSync(store, 'utf8')) : []);
const save = (items) => writeFileSync(store, JSON.stringify(items));

function option(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function matches(item, args) {
  const service = option(args, '-s');
  const account = option(args, '-a');
  return (
    (service === undefined || item.service === service) && (account === undefined || item.account === account)
  );
}

/** Führt einen Befehl aus, Rückgabe: Exit-Code */
function execute(args) {
  const [command, ...rest] = args;
  const items = load();
  if (command === 'add-generic-password') {
    const service = option(rest, '-s');
    const account = option(rest, '-a') ?? '';
    const wIndex = rest.indexOf('-w');
    const password = wIndex >= 0 ? rest[wIndex + 1] : undefined;
    if (!service || password === undefined) {
      process.stderr.write('security: add-generic-password: Wert fehlt\n');
      return 2;
    }
    const existing = items.find((item) => item.service === service && item.account === account);
    if (existing && !rest.includes('-U')) {
      process.stderr.write(
        'security: SecKeychainItemCreateFromContent: The specified item already exists in the keychain.\n',
      );
      return 45;
    }
    if (existing) existing.password = password;
    else items.push({ service, account, password });
    save(items);
    return 0;
  }
  if (command === 'find-generic-password') {
    const item = items.find((entry) => matches(entry, rest));
    if (!item) {
      process.stderr.write(
        'security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.\n',
      );
      return 44;
    }
    if (rest.includes('-w')) process.stdout.write(`${item.password}\n`);
    else
      process.stdout.write(
        `keychain: "/fake/login.keychain-db"\nclass: "genp"\n    "acct"<blob>="${item.account}"\n    "svce"<blob>="${item.service}"\n`,
      );
    return 0;
  }
  if (command === 'delete-generic-password') {
    const index = items.findIndex((entry) => matches(entry, rest));
    if (index < 0) {
      process.stderr.write(
        'security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.\n',
      );
      return 44;
    }
    items.splice(index, 1);
    save(items);
    process.stdout.write('password has been deleted.\n');
    return 0;
  }
  process.stderr.write(`security: unbekannter Befehl ${command}\n`);
  return 1;
}

const argv = process.argv.slice(2);
if (argv[0] === '-i') {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => (input += chunk));
  process.stdin.on('end', () => {
    for (const line of input.split('\n')) {
      const words = line.trim().split(/\s+/).filter(Boolean);
      if (words.length > 0) execute(words);
    }
    process.exit(Number(process.env.FAKE_SECURITY_INTERACTIVE_EXIT ?? 0));
  });
} else {
  process.exit(execute(argv));
}
