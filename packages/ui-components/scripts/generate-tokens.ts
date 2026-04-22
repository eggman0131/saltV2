// spec: SPEC.md §3.3 v0.2.3
// Reads the Tailwind preset and (re)writes src/tokens/*.ts + src/tokens.ts.
// Idempotent: running twice produces no git diff.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import preset from '../src/tailwind-preset.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tokensDir = join(__dirname, '../src/tokens');
const srcDir = join(__dirname, '../src');

const HEADER =
  '// spec: SPEC.md §3.3 v0.2.3\n// AUTO-GENERATED — do not hand-edit. Run `pnpm --filter @salt/ui-components generate-tokens` to regenerate.\n';

function stripAlpha(value: string): string {
  return value.replace(/ \/ <alpha-value>/g, '');
}

// --- colors.ts ---
const colorsTheme = preset.theme.extend.colors as Record<
  string,
  string | { DEFAULT: string; foreground: string }
>;
const colorLines: string[] = [];
for (const [key, value] of Object.entries(colorsTheme)) {
  const camel = key.replace(/-([a-z])/g, (_, c: string) => (c as string).toUpperCase());
  if (typeof value === 'string') {
    colorLines.push(`export const ${camel} = '${stripAlpha(value)}';`);
  } else {
    colorLines.push(`export const ${camel} = '${stripAlpha(value.DEFAULT)}';`);
    colorLines.push(`export const ${camel}Foreground = '${stripAlpha(value.foreground)}';`);
  }
}
writeFileSync(
  join(tokensDir, 'colors.ts'),
  HEADER.replace('§3.3', '§3.3').replace('§4.1', '§3.3') + colorLines.join('\n') + '\n',
);

// --- radius.ts ---
const radiusTheme = preset.theme.extend.borderRadius as Record<string, string>;
const radiusLines = Object.entries(radiusTheme).map(([key, value]) => {
  const camel = key.replace(/-([a-z])/g, (_, c: string) => (c as string).toUpperCase());
  return `export const ${camel} = '${value}';`;
});
writeFileSync(
  join(tokensDir, 'radius.ts'),
  HEADER.replace('§3.3', '§4.1') + radiusLines.join('\n') + '\n',
);

// --- motion.ts ---
const durTheme = preset.theme.extend.transitionDuration as Record<string, string>;
const easeTheme = preset.theme.extend.transitionTimingFunction as Record<string, string>;
const motionLines: string[] = [];
for (const [key, value] of Object.entries(durTheme)) {
  const camel = 'duration' + key[0]!.toUpperCase() + key.slice(1);
  motionLines.push(`export const ${camel} = '${value}';`);
}
for (const [key, value] of Object.entries(easeTheme)) {
  const camel = 'ease' + key[0]!.toUpperCase() + key.slice(1);
  motionLines.push(`export const ${camel} = '${value}';`);
}
writeFileSync(
  join(tokensDir, 'motion.ts'),
  HEADER.replace('§3.3', '§4.1') + motionLines.join('\n') + '\n',
);

// --- elevation.ts ---
const shadowTheme = preset.theme.extend.boxShadow as Record<string, string>;
const elevationLines: string[] = [];
const shadowEntries = Object.entries(shadowTheme);
for (const [key, value] of shadowEntries) {
  const camel = key.replace(/-([a-z])/g, (_, c: string) => (c as string).toUpperCase());
  // popover and dialog alias to md and lg respectively — emit reference
  if (key === 'popover') {
    elevationLines.push(`export const popover = md;`);
  } else if (key === 'dialog') {
    elevationLines.push(`export const dialog = lg;`);
  } else {
    elevationLines.push(`export const ${camel} = '${value}';`);
  }
}
writeFileSync(
  join(tokensDir, 'elevation.ts'),
  HEADER.replace('§3.3', '§4.1') + elevationLines.join('\n') + '\n',
);

// --- z-index.ts ---
const zTheme = preset.theme.extend.zIndex as Record<string, string>;
const zLines = Object.entries(zTheme).map(([key, value]) => {
  const camel = key.replace(/-([a-z])/g, (_, c: string) => (c as string).toUpperCase());
  return `export const ${camel} = ${value};`;
});
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
`;
writeFileSync(join(srcDir, 'tokens.ts'), tokensBarrel);

console.log('Tokens generated successfully.');
