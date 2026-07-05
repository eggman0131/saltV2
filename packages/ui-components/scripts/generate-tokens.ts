// spec: SPEC.md §3.3 v0.2.3
// Reads the CSS-first design-system entry (src/salt.css) and (re)writes
// src/tokens/*.ts + src/tokens.ts. Idempotent: running twice produces no git diff.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tokensDir = join(__dirname, '../src/tokens');
const srcDir = join(__dirname, '../src');
const css = readFileSync(join(srcDir, 'salt.css'), 'utf8');

const HEADER =
  '// spec: SPEC.md §3.3 v0.2.3\n// AUTO-GENERATED — do not hand-edit. Run `pnpm --filter @salt/ui-components generate-tokens` to regenerate.\n';

// Every `--name: value;` custom-property value in salt.css, first occurrence
// wins (so :root/@theme light values beat the later .dark overrides). Insertion
// order is preserved, which the emitters below rely on for stable output.
function extractCssVars(src: string): Record<string, string> {
  const result: Record<string, string> = {};
  const re = /(--[a-z0-9-]+):\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (!(m[1]! in result)) result[m[1]!] = m[2]!.trim();
  }
  return result;
}

const vars = extractCssVars(css);
const camel = (key: string): string =>
  key.replace(/-([a-z])/g, (_, c: string) => (c as string).toUpperCase());
const cap = (s: string): string => s[0]!.toUpperCase() + s.slice(1);

// --- colors.ts ---
// Semantic `--color-*` tokens that resolve to the --salt-* primitives. The
// default-palette pins (--color-amber-* etc., raw #hex) are skipped, and
// --color-icon-tile is intentionally excluded: it is a component-surface colour,
// not a semantic role, and is kept out of the public token API (the 23-constant
// contract asserted by tokens.theme.test.ts).
const colorLines: string[] = [];
for (const [name, value] of Object.entries(vars)) {
  if (!name.startsWith('--color-')) continue;
  if (name === '--color-icon-tile') continue;
  if (!/^hsl\(var\(--salt-/.test(value)) continue;
  colorLines.push(`export const ${camel(name.slice('--color-'.length))} = '${value}';`);
}
writeFileSync(join(tokensDir, 'colors.ts'), HEADER + colorLines.join('\n') + '\n');

// --- radius.ts ---
// `--radius` (bare) is the DEFAULT; `--radius-<key>` map 1:1.
const radiusLines: string[] = [];
for (const [name, value] of Object.entries(vars)) {
  if (name !== '--radius' && !name.startsWith('--radius-')) continue;
  const key = name === '--radius' ? 'DEFAULT' : name.slice('--radius-'.length);
  const constName = key === 'DEFAULT' ? 'DEFAULT' : camel(key);
  radiusLines.push(`export const ${constName} = '${value}';`);
}
writeFileSync(
  join(tokensDir, 'radius.ts'),
  HEADER.replace('§3.3', '§4.1') + radiusLines.join('\n') + '\n',
);

// --- motion.ts ---
const motionLines: string[] = [];
for (const [name, value] of Object.entries(vars)) {
  if (name.startsWith('--duration-')) {
    motionLines.push(`export const duration${cap(name.slice('--duration-'.length))} = '${value}';`);
  }
}
for (const [name, value] of Object.entries(vars)) {
  if (name.startsWith('--ease-')) {
    motionLines.push(`export const ease${cap(name.slice('--ease-'.length))} = '${value}';`);
  }
}
writeFileSync(
  join(tokensDir, 'motion.ts'),
  HEADER.replace('§3.3', '§4.1') + motionLines.join('\n') + '\n',
);

// --- elevation.ts ---
// popover and dialog alias to md and lg respectively — emit references.
const elevationLines: string[] = [];
for (const [name, value] of Object.entries(vars)) {
  if (!name.startsWith('--shadow-')) continue;
  const key = name.slice('--shadow-'.length);
  if (key === 'popover') {
    elevationLines.push(`export const popover = md;`);
  } else if (key === 'dialog') {
    elevationLines.push(`export const dialog = lg;`);
  } else {
    elevationLines.push(`export const ${camel(key)} = '${value}';`);
  }
}
writeFileSync(
  join(tokensDir, 'elevation.ts'),
  HEADER.replace('§3.3', '§4.1') + elevationLines.join('\n') + '\n',
);

// --- z-index.ts ---
// Sourced from the @utility z-* blocks (v4 has no z-index theme namespace).
const zLines: string[] = [];
const zRe = /@utility\s+z-([a-z]+)\s*\{\s*z-index:\s*(\d+)\s*;?\s*\}/g;
let zm: RegExpExecArray | null;
while ((zm = zRe.exec(css)) !== null) {
  zLines.push(`export const ${zm[1]} = ${zm[2]};`);
}
writeFileSync(
  join(tokensDir, 'z-index.ts'),
  HEADER.replace('§3.3', '§4.1') + zLines.join('\n') + '\n',
);

// --- tokens.ts ---
const tokensBarrel = `// spec: SPEC.md §1.3 v0.2.3
// AUTO-GENERATED — do not hand-edit. Run \`pnpm --filter @salt/ui-components generate-tokens\` to regenerate.
export * as colors from './tokens/colors';
export * as radius from './tokens/radius';
export * as motion from './tokens/motion';
export * as elevation from './tokens/elevation';
export * as zIndex from './tokens/z-index';
export * as typography from './tokens/typography';
`;
writeFileSync(join(srcDir, 'tokens.ts'), tokensBarrel);

console.log('Tokens generated successfully.');
