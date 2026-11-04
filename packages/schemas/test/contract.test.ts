// Contract-Tests (09 §6): dieselben Beispielnachrichten müssen von JSON Schema (ajv),
// Zod (TS) und Pydantic (python/tests) gleich bewertet werden.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import * as generated from '@sg/shared';

const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => void;
const root = join(import.meta.dirname, '..');
const bundle = JSON.parse(readFileSync(join(root, 'generated', 'bundle.schema.json'), 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(bundle);

type ZodLike = { safeParse: (v: unknown) => { success: boolean } };
const zodFor = (type: string): ZodLike => {
  const schema = (generated as Record<string, unknown>)[`${type}Schema`];
  if (!schema) throw new Error(`Kein Zod-Schema für ${type}`);
  return schema as ZodLike;
};

function examples(kind: 'valid' | 'invalid') {
  const dir = join(root, 'examples', kind);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((file) => ({
      file,
      type: file.split('.')[0]!,
      data: JSON.parse(readFileSync(join(dir, file), 'utf8')),
    }));
}

describe('Contract: gültige Beispiele', () => {
  for (const { file, type, data } of examples('valid')) {
    it(`${file} ist gültig (JSON Schema + Zod)`, () => {
      const validate = ajv.getSchema(`${bundle.$id}#/$defs/${type}`);
      expect(validate, `Typ ${type} fehlt im Bundle`).toBeTruthy();
      expect(validate!(data), JSON.stringify(validate!.errors)).toBe(true);
      expect(zodFor(type).safeParse(data).success).toBe(true);
    });
  }
});

describe('Contract: ungültige Beispiele', () => {
  for (const { file, type, data } of examples('invalid')) {
    it(`${file} wird abgelehnt (JSON Schema + Zod)`, () => {
      const validate = ajv.getSchema(`${bundle.$id}#/$defs/${type}`)!;
      expect(validate(data)).toBe(false);
      expect(zodFor(type).safeParse(data).success).toBe(false);
    });
  }
});

describe('Bundle', () => {
  it('enthält jeden Typ, für den es Beispiele gibt', () => {
    for (const { type } of [...examples('valid'), ...examples('invalid')]) {
      expect(Object.keys(bundle.$defs)).toContain(type);
    }
  });
});
