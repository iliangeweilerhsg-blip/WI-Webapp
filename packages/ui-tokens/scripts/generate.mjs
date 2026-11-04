// Erzeugt aus tokens.json die CSS-Variablen (Web) und die Swift-Konstanten (iPad).
// Aufruf: node scripts/generate.mjs [--check]   (--check schlägt fehl, wenn generated/ veraltet ist)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const HEADER =
  'GENERIERT aus tokens.json – nicht von Hand ändern. Neu erzeugen: pnpm --filter @sg/ui-tokens gen';

const px = (n) => `${n}px`;
const ms = (n) => `${n}ms`;

function colorVars(t, mode) {
  const lines = [];
  for (const [k, v] of Object.entries(t.color[mode])) lines.push(`  --sg-color-${k}: ${v};`);
  for (const [k, v] of Object.entries(t.module)) lines.push(`  --sg-${k}: ${v[mode]};`);
  return lines;
}

export function buildCss(t) {
  const staticVars = [
    ...Object.entries(t.space).map(([k, v]) => `  --sg-space-${k}: ${px(v)};`),
    ...Object.entries(t.radius).map(([k, v]) => `  --sg-radius-${k}: ${px(v)};`),
    `  --sg-font-sans: ${t.font.sans};`,
    `  --sg-font-mono: ${t.font.mono};`,
    ...Object.entries(t.font.size).map(([k, v]) => `  --sg-font-size-${k}: ${px(v)};`),
    `  --sg-font-size-card-min: ${px(t.font.card.min)};`,
    `  --sg-font-size-card-max: ${px(t.font.card.max)};`,
    ...Object.entries(t.motion).map(([k, v]) => `  --sg-motion-${k}: ${ms(v)};`),
  ];
  const light = colorVars(t, 'light');
  const dark = colorVars(t, 'dark');
  return [
    `/* ${HEADER} */`,
    ':root {',
    '  color-scheme: light dark;',
    ...staticVars,
    ...light,
    '}',
    '',
    '@media (prefers-color-scheme: dark) {',
    '  :root:not([data-theme="light"]) {',
    ...dark.map((l) => `  ${l}`),
    '  }',
    '}',
    '',
    ':root[data-theme="light"] {',
    '  color-scheme: light;',
    '}',
    '',
    ':root[data-theme="dark"] {',
    '  color-scheme: dark;',
    ...dark,
    '}',
    '',
    '@media (prefers-reduced-motion: reduce) {',
    '  :root {',
    '    --sg-motion-fast: 0ms;',
    '    --sg-motion-base: 0ms;',
    '  }',
    '}',
    '',
  ].join('\n');
}

const camel = (s) => s.replace(/-(\w)/g, (_, c) => c.toUpperCase());
const hex = (h) => `0x${h.slice(1).toUpperCase()}`;

export function buildSwift(t) {
  const dyn = (v) => `Tokens.dynamic(light: ${hex(v.light)}, dark: ${hex(v.dark)})`;
  const colors = Object.keys(t.color.light)
    .map(
      (k) =>
        `        public static let ${camel(k)} = ${dyn({ light: t.color.light[k], dark: t.color.dark[k] })}`,
    )
    .join('\n');
  const mods = Object.entries(t.module)
    .map(([k, v]) => `        public static let ${camel(k)} = ${dyn(v)}`)
    .join('\n');
  const modList = Object.keys(t.module)
    .map((k) => camel(k))
    .join(', ');
  const nums = (obj) =>
    Object.entries(obj)
      .map(([k, v]) => `        public static let ${/^\d/.test(k) ? `s${k}` : camel(k)}: CGFloat = ${v}`)
      .join('\n');
  return `// ${HEADER}
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

public enum Tokens {
    /// Farbe, die automatisch zwischen Hell und Dunkel wechselt.
    public static func dynamic(light: UInt32, dark: UInt32) -> Color {
        #if canImport(UIKit)
        return Color(UIColor { traits in
            UIColor(hex: traits.userInterfaceStyle == .dark ? dark : light)
        })
        #else
        return Color(hex: light)
        #endif
    }

    public enum Colors {
${colors}
    }

    /// Modulfarben mod-01 bis mod-12 (07 §8).
    public enum Module {
${mods}
        public static let all: [Color] = [${modList}]
    }

    public enum Space {
${nums(t.space)}
    }

    public enum Radius {
${nums(t.radius)}
    }

    public enum FontSize {
${nums(t.font.size)}
        public static let cardMin: CGFloat = ${t.font.card.min}
        public static let cardMax: CGFloat = ${t.font.card.max}
    }

    /// Dauer in Sekunden (Übergänge höchstens 150 ms, 07 §8).
    public enum Motion {
        public static let fast: Double = ${t.motion.fast / 1000}
        public static let base: Double = ${t.motion.base / 1000}
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
}

#if canImport(UIKit)
extension UIColor {
    convenience init(hex: UInt32) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: 1
        )
    }
}
#endif
`;
}

export function loadTokens() {
  return JSON.parse(readFileSync(join(root, 'tokens.json'), 'utf8'));
}

export function outputs() {
  const t = loadTokens();
  return { 'tokens.css': buildCss(t), 'Tokens.swift': buildSwift(t) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const check = process.argv.includes('--check');
  const dir = join(root, 'generated');
  let stale = false;
  for (const [name, content] of Object.entries(outputs())) {
    const file = join(dir, name);
    if (check) {
      if (!existsSync(file) || readFileSync(file, 'utf8') !== content) {
        console.error(
          `Veraltet: generated/${name} – pnpm --filter @sg/ui-tokens gen ausführen und committen`,
        );
        stale = true;
      }
    } else {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, content);
    }
  }
  if (stale) process.exit(1);
}
