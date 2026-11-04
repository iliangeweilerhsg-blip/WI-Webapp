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
writeFileSync(
  join(out.ts, 'index.ts'),
  `/* ${BANNER} */\nexport type * from './types.ts';\nexport * from './zod.ts';\n`,
);

// 4. Python (Pydantic v2) über datamodel-code-generator (feste Version)
mkdirSync(dirname(out.py), { recursive: true });
execFileSync(
  'uvx',
  [
    '--from',
    'datamodel-code-generator==0.88.0',
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
  ],
  { stdio: 'inherit' },
);

// 5. Swift (Codable) über quicktype
mkdirSync(dirname(out.swift), { recursive: true });
execFileSync(
  join(root, 'node_modules', '.bin', 'quicktype'),
  ['--src-lang', 'schema', '--lang', 'swift', '--top-level', 'SchemaBundle', '--out', out.swift, out.bundle],
  { stdio: 'inherit' },
);
const swift = readFileSync(out.swift, 'utf8');
writeFileSync(out.swift, `// ${BANNER}\n${swift}`);

console.log(`Schemas erzeugt: ${names.length} Typen → TS, Zod, Python, Swift`);
