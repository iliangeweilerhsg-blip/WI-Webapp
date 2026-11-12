// Codegen: packages/schemas/src/*.schema.json  →  TS-Typen + Zod, Pydantic, Swift
// Aufruf: pnpm schemas:gen   (Prüfung in CI: pnpm schemas:check)
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { compile } from 'json-schema-to-typescript';
import { jsonSchemaToZod } from 'json-schema-to-zod';
import $RefParser from '@apidevtools/json-schema-ref-parser';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'src');
const out = {
  bundle: join(root, 'generated', 'bundle.schema.json'),
  ts: join(root, '..', 'shared', 'src', 'generated'),
  py: join(root, 'python', 'sg_schemas', 'models.py'),
  swift: join(root, 'generated', 'swift', 'Schemas.swift'),
};
const BANNER = 'GENERIERT aus packages/schemas/src – nicht von Hand ändern. Neu erzeugen: pnpm schemas:gen';

// 1. Bündeln: alle $defs in einen Namensraum, Namen müssen eindeutig sein
const defs = {};
for (const file of readdirSync(srcDir)
  .filter((f) => f.endsWith('.schema.json'))
  .sort()) {
  const schema = JSON.parse(readFileSync(join(srcDir, file), 'utf8'));
  for (const [name, def] of Object.entries(schema.$defs ?? {})) {
    if (defs[name]) throw new Error(`Doppelter Schema-Name "${name}" in ${file}`);
    defs[name] = { title: name, ...def };
  }
}
const names = Object.keys(defs).sort();
const bundle = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://studien-gehirn.local/schemas/bundle.schema.json',
  title: 'SchemaBundle',
  description: BANNER,
  type: 'object',
  properties: Object.fromEntries(names.map((n) => [n, { $ref: `#/$defs/${n}` }])),
  $defs: Object.fromEntries(names.map((n) => [n, defs[n]])),
};
mkdirSync(dirname(out.bundle), { recursive: true });
writeFileSync(out.bundle, JSON.stringify(bundle, null, 2) + '\n');

// 2. TypeScript-Typen
let types = await compile(structuredClone(bundle), 'SchemaBundle', {
  bannerComment: `/* ${BANNER} */`,
  unreachableDefinitions: true,
  additionalProperties: false,
  // gleiche Semantik wie Zod: freie Objekte als any, Arraylängen nur zur Laufzeit geprüft
  unknownAny: false,
  ignoreMinAndMaxItems: true,
  format: false,
});
types = types.replace(/export interface SchemaBundle \{[\s\S]*?\n\}\n/, '');
mkdirSync(out.ts, { recursive: true });
writeFileSync(join(out.ts, 'types.ts'), types.trimEnd() + '\n');

// 3. Zod-Validatoren (Refs aufgelöst, eine Konstante pro Typ)
const deref = await $RefParser.dereference(structuredClone(bundle), { dereference: { circular: false } });
let zod = `/* ${BANNER} */\nimport { z } from 'zod';\n`;
for (const n of names) {
  const { title: _t, ...def } = deref.$defs[n];
  const expr = jsonSchemaToZod(def, { module: 'none', noImport: true });
  zod += `\nexport const ${n}Schema = ${expr.trim().replace(/;$/, '')};\n`;
}
writeFileSync(join(out.ts, 'zod.ts'), zod);
// Typ-Gleichheit: z.infer<XSchema> muss exakt X entsprechen (wird von tsc in @sg/shared geprüft)
let check = `/* ${BANNER} */\n/* eslint-disable @typescript-eslint/no-unused-vars */\nimport type { z } from 'zod';\nimport type * as T from './types.ts';\nimport type * as Z from './zod.ts';\n\n`;
check +=
  'type Equal<A, B> = (<X>() => X extends A ? 1 : 2) extends <X>() => X extends B ? 1 : 2 ? true : false;\n\n';
for (const n of names) check += `const _${n}: Equal<z.infer<typeof Z.${n}Schema>, T.${n}> = true;\n`;
writeFileSync(join(out.ts, 'type-equality.check.ts'), check);
writeFileSync(
  join(out.ts, 'index.ts'),
  `/* ${BANNER} */\nexport type * from './types.ts';\nexport * from './zod.ts';\n`,
);

// 4. Python (Pydantic v2) über datamodel-code-generator (Version über python/uv.lock gepinnt)
mkdirSync(dirname(out.py), { recursive: true });
execFileSync(
  'uv',
  [
    'run',
    '--project',
    join(root, 'python'),
    '--locked',
    'datamodel-codegen',
    '--input',
    out.bundle,
    '--input-file-type',
    'jsonschema',
    '--output',
    out.py,
    '--output-model-type',
    'pydantic_v2.BaseModel',
    '--target-python-version',
    '3.12',
    '--use-standard-collections',
    '--use-union-operator',
    '--field-constraints',
    '--use-title-as-name',
    '--disable-timestamp',
    '--use-schema-description',
    '--custom-file-header',
    `# ${BANNER}`,
    '--formatters',
    'builtin',
    '--strict-types',
    'str',
    'int',
    'float',
    'bool',
    '--collapse-root-models',
  ],
  { stdio: 'inherit' },
);

// --collapse-root-models entfernt Union-Typen auf oberster Ebene: als TypeAlias wieder anhängen
const unions = names.filter((n) => Array.isArray(defs[n].anyOf) && defs[n].anyOf.every((s) => s.$ref));
if (unions.length) {
  let py = readFileSync(out.py, 'utf8');
  py += '\n\n# Union-Typen (für Validierung: pydantic.TypeAdapter(<Typ>))\n';
  for (const n of unions) {
    const parts = defs[n].anyOf.map((s) => s.$ref.split('/').pop());
    py += `type ${n} = ${parts.join(' | ')}\n`;
  }
  writeFileSync(out.py, py);
}

// 5. Swift (Codable) über quicktype
mkdirSync(dirname(out.swift), { recursive: true });
execFileSync(
  join(root, 'node_modules', '.bin', 'quicktype'),
  ['--src-lang', 'schema', '--lang', 'swift', '--top-level', 'SchemaBundle', '--out', out.swift, out.bundle],
  { stdio: 'inherit' },
);
const swift = patchSwift(readFileSync(out.swift, 'utf8'));
writeFileSync(out.swift, `// ${BANNER}\n${swift}`);

/**
 * Nacharbeit an der quicktype-Ausgabe (docs/VERTRAEGE.md §11.7):
 * 1. Datumswerte mit Millisekunden lesen und schreiben (.iso8601 kann keine Sekundenbruchteile).
 * 2. Je Struct ein explizites encode(to:): Pflichtfelder werden immer geschrieben, auch als null.
 *    Das synthetisierte Codable lässt nil-Werte weg, die Schemas verlangen aber den Schlüssel.
 *    Zuordnung Struct → Schema über die Menge der JSON-Schlüssel; Unions (zusammengefasste
 *    Structs) passen auf kein Schema und behalten das synthetisierte Verhalten.
 */
function patchSwift(text) {
  const coders = `func newJSONDecoder() -> JSONDecoder {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .custom { decoder in
        let container = try decoder.singleValueContainer()
        let string = try container.decode(String.self)
        if let date = sgParseTimestamp(string) { return date }
        throw DecodingError.dataCorruptedError(in: container, debugDescription: "Ungültiger Zeitstempel: \\(string)")
    }
    return decoder
}

func newJSONEncoder() -> JSONEncoder {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .custom { date, encoder in
        var container = encoder.singleValueContainer()
        try container.encode(sgFormatTimestamp(date))
    }
    return encoder
}

/// ISO 8601 mit und ohne Sekundenbruchteile, mit Z oder Offset
func sgParseTimestamp(_ string: String) -> Date? {
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = fractional.date(from: string) { return date }
    let plain = ISO8601DateFormatter()
    plain.formatOptions = [.withInternetDateTime]
    return plain.date(from: string)
}

/// UTC mit Z; Millisekunden nur, wenn sie nicht 0 sind (wie der Core sie schreibt)
func sgFormatTimestamp(_ date: Date) -> String {
    let millis = Int64((date.timeIntervalSince1970 * 1000).rounded())
    var seconds = millis / 1000
    var rest = millis % 1000
    if rest < 0 { rest += 1000; seconds -= 1 }
    let plain = ISO8601DateFormatter()
    plain.formatOptions = [.withInternetDateTime]
    let base = plain.string(from: Date(timeIntervalSince1970: TimeInterval(seconds)))
    if rest == 0 { return base }
    return String(base.dropLast()) + "." + String(format: "%03d", Int(rest)) + "Z"
}`;
  const start = text.indexOf('func newJSONDecoder() -> JSONDecoder {');
  const end = text.indexOf('// MARK: - Encode/decode helpers');
  if (start < 0 || end < 0)
    throw new Error('quicktype-Ausgabe: Encoder/Decoder-Hilfsfunktionen nicht gefunden');
  text = `${text.slice(0, start)}${coders}\n\n${text.slice(end)}`;

  // Swift 6: CodingKey verlangt Sendable, eine nicht-finale Klasse darf das nicht erfüllen.
  // Ohne `final` bricht jeder Build im Swift-6-Sprachmodus ab (Standard in neuen Xcode-Projekten, #56)
  // Liefert quicktype die Klasse schon als final, bleibt sie, wie sie ist (kein `final final`)
  const codingKey = /^(final )?class JSONCodingKey: CodingKey \{$/m;
  if (!codingKey.test(text)) throw new Error('quicktype-Ausgabe: JSONCodingKey nicht gefunden');
  text = text.replace(codingKey, 'final class JSONCodingKey: CodingKey {');

  // Swift 6: SGServerMessage ist nur Sendable, wenn JSONAny und JSONNull es sind (SyncError.details, #97).
  // JSONNull hat keine gespeicherten Eigenschaften, final reicht für geprüftes Sendable.
  // JSONAny hält `let value: Any`: Any ist nicht Sendable, der Compiler kann es nicht prüfen. Vertretbar mit
  // @unchecked, weil (1) `value` ein `let` ist und die Klasse final ist, es also nach dem Init nie geändert wird,
  // und (2) der Decoder nur JSON-Werte hineinlegt (Bool, Int64, Double, String, JSONNull, [Any], [String: Any]),
  // also Werttypen und die Sendable-Klasse JSONNull. Die Prüfung unten bricht den Codegen, falls quicktype das ändert.
  const jsonNull = /^(final )?class JSONNull: Codable, Hashable \{$/m;
  const jsonAny = /^(final )?class JSONAny: Codable \{$/m;
  if (!jsonNull.test(text)) throw new Error('quicktype-Ausgabe: JSONNull nicht gefunden');
  if (!jsonAny.test(text)) throw new Error('quicktype-Ausgabe: JSONAny nicht gefunden');
  const anyStart = text.search(jsonAny);
  const anyBody = text.slice(anyStart, text.indexOf('\n}\n', anyStart));
  if (!/^ {4}let value: Any$/m.test(anyBody) || /^ {4}(public )?var \w+/m.test(anyBody))
    throw new Error(
      'quicktype-Ausgabe: JSONAny hat veränderliche oder unerwartete gespeicherte Eigenschaften, @unchecked Sendable nicht mehr vertretbar',
    );
  text = text
    .replace(jsonNull, 'final class JSONNull: Codable, Hashable, Sendable {')
    .replace(jsonAny, 'final class JSONAny: Codable, @unchecked Sendable {');

  const schemas = Object.entries(bundle.$defs)
    .filter(([, d]) => d.type === 'object' && d.properties)
    .map(([n, d]) => ({
      name: n,
      keys: Object.keys(d.properties).sort().join(','),
      required: new Set(d.required ?? []),
    }));
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const extensions = [];
  for (const m of text.matchAll(/^struct (\w+): Codable \{\n([\s\S]*?)\n\}$/gm)) {
    const [, struct, body] = m;
    const props = [...body.matchAll(/^ {4}let (`?\w+`?): /gm)].map((p) => p[1]);
    if (props.length === 0) continue;
    const keyOf = Object.fromEntries(
      [...body.matchAll(/^ {8}case (`?\w+`?) = "([^"]+)"$/gm)].map((c) => [c[1], c[2]]),
    );
    const jsonKeys = props.map((p) => keyOf[p] ?? p.replace(/`/g, ''));
    let candidates = schemas.filter((s) => s.keys === [...jsonKeys].sort().join(','));
    if (candidates.length > 1) {
      const byName = candidates.filter((s) => norm(s.name) === norm(struct));
      if (byName.length) candidates = byName;
    }
    const required = candidates[0]?.required;
    const consistent =
      candidates.length > 0 &&
      candidates.every((c) => [...c.required].sort().join(',') === [...required].sort().join(','));
    if (!consistent) continue;
    const lines = props.map((p, i) => {
      const caseName = p;
      const method = required.has(jsonKeys[i]) ? 'encode' : 'encodeIfPresent';
      return `        try container.${method}(${p}, forKey: .${caseName.replace(/`/g, '')})`;
    });
    const hasKeys = Object.keys(keyOf).length > 0;
    if (!hasKeys) continue;
    extensions.push(
      `extension ${struct} {\n    func encode(to encoder: Encoder) throws {\n        var container = encoder.container(keyedBy: CodingKeys.self)\n${lines.join('\n')}\n    }\n}`,
    );
  }
  return `${text.trimEnd()}\n\n// MARK: - Pflichtfelder explizit kodieren (auch null), siehe docs/VERTRAEGE.md §11.7\n\n${extensions.join('\n\n')}\n`;
}

console.log(`Schemas erzeugt: ${names.length} Typen → TS, Zod, Python, Swift`);
