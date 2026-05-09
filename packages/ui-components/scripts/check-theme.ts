// spec: SPEC.md §3.3 v0.2.3
// Compares design/design.md frontmatter against tailwind-preset.ts.
// Fails with a diff when the two drift. Run via `pnpm theme:check`.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import preset from '../src/tailwind-preset.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');
const DESIGN_MD_PATH = join(REPO_ROOT, 'docs/design/design.md');
const PRESET_SRC_PATH = join(__dirname, '../src/tailwind-preset.ts');

// ── Minimal YAML-block parser (handles the exact frontmatter shape) ───────────

type YamlVal = string | Record<string, YamlVal>;
type YamlMap = Record<string, YamlVal>;

function parseYamlBlock(lines: string[]): YamlMap {
  const result: YamlMap = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    const indent = line.search(/\S/);
    const colonIdx = line.indexOf(':');
    if (colonIdx < 0) {
      i++;
      continue;
    }
    const key = line.slice(indent, colonIdx).trim();
    const rawVal = line.slice(colonIdx + 1).trim();
    if (rawVal === '') {
      const children: string[] = [];
      i++;
      while (i < lines.length) {
        const cl = lines[i]!;
        if (!cl.trim()) {
          children.push('');
          i++;
          continue;
        }
        if (cl.search(/\S/) <= indent) break;
        children.push(cl);
        i++;
      }
      result[key] = parseYamlBlock(children);
    } else {
      result[key] = rawVal.replace(/^['"]|['"]$/g, '');
      i++;
    }
  }
  return result;
}

function parseFrontmatter(src: string): YamlMap {
  const m = src.match(/^---\r?\n([\s\S]+?)\r?\n---/);
  if (!m) throw new Error('No frontmatter found in design.md');
  return parseYamlBlock(m[1]!.split('\n'));
}

// ── Extract hex values from /* #rrggbb */ comments in preset source ───────────

function extractVarHexComments(src: string): Record<string, string> {
  const result: Record<string, string> = {};
  // matches: '--salt-foo': 'H S% L%' /* #rrggbb ...
  const re = /['"](--(salt)[a-z0-9-]*)['"]:\s*['"][^'"]*['"]\s*\/\*\s*(#[0-9a-fA-F]{6})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (!(m[1]! in result)) result[m[1]!] = m[3]!.toLowerCase();
  }
  return result;
}

// ── Extract raw CSS var string values from preset source ──────────────────────

function extractCssVarValues(src: string): Record<string, string> {
  const result: Record<string, string> = {};
  const re = /['"](--(salt)[a-z0-9-]*)['"]:\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (!(m[1]! in result)) result[m[1]!] = m[3]!;
  }
  return result;
}

// ── Mappings ──────────────────────────────────────────────────────────────────

/** design.md color key → preset CSS var name */
const COLOR_MAP: Record<string, string> = {
  surface: '--salt-background',
  'on-surface': '--salt-foreground',
  primary: '--salt-primary',
  'on-primary': '--salt-primary-foreground',
  secondary: '--salt-secondary',
  'on-secondary': '--salt-secondary-foreground',
  'secondary-container': '--salt-secondary-container',
  'on-secondary-container': '--salt-on-secondary-container',
  tertiary: '--salt-tertiary',
  'on-tertiary': '--salt-tertiary-foreground',
  'tertiary-container': '--salt-tertiary-container',
  'on-tertiary-container': '--salt-on-tertiary-container',
  'surface-container': '--salt-muted',
  'on-surface-variant': '--salt-muted-foreground',
  error: '--salt-destructive',
  'on-error': '--salt-destructive-foreground',
  'outline-variant': '--salt-border',
};

/** design.md rounded key → CSS var name (null = hardcoded in theme.extend) */
const ROUNDED_MAP: Record<string, string | null> = {
  sm: '--salt-radius-sm',
  DEFAULT: '--salt-radius-default',
  md: '--salt-radius-md',
  lg: '--salt-radius-lg',
  xl: '--salt-radius-xl',
  full: null,
};

const SPACING_KEYS = ['xs', 'sm', 'md', 'lg', 'xl'];
const TYPO_KEYS = ['display', 'h1', 'h2', 'body-lg', 'body-md', 'label-caps'];

/** design.md controls.checkbox key → CSS var name */
const CONTROLS_CHECKBOX_MAP: Record<string, string> = {
  sm: '--salt-control-checkbox-sm',
  md: '--salt-control-checkbox-md',
  lg: '--salt-control-checkbox-lg',
};

/** design.md controls.switch key → CSS var name */
const CONTROLS_SWITCH_MAP: Record<string, string> = {
  'sm-h': '--salt-control-switch-sm-h',
  'sm-w': '--salt-control-switch-sm-w',
  'md-h': '--salt-control-switch-md-h',
  'md-w': '--salt-control-switch-md-w',
  'lg-h': '--salt-control-switch-lg-h',
  'lg-w': '--salt-control-switch-lg-w',
  'thumb-sm': '--salt-control-switch-thumb-sm',
  'thumb-md': '--salt-control-switch-thumb-md',
  'thumb-lg': '--salt-control-switch-thumb-lg',
};

// ── Main ──────────────────────────────────────────────────────────────────────

const failures: string[] = [];
const fail = (msg: string) => failures.push(msg);

const designSrc = readFileSync(DESIGN_MD_PATH, 'utf8');
const presetSrc = readFileSync(PRESET_SRC_PATH, 'utf8');
const design = parseFrontmatter(designSrc);
const varHex = extractVarHexComments(presetSrc);
const cssVars = extractCssVarValues(presetSrc);

// ── Colors ────────────────────────────────────────────────────────────────────

const designColors = design.colors as YamlMap;
for (const [dmKey, varName] of Object.entries(COLOR_MAP)) {
  const dmHex = (designColors[dmKey] as string | undefined)?.toLowerCase();
  if (!dmHex) {
    fail(`  colors.${dmKey}: not found in design.md`);
    continue;
  }
  const presetHex = varHex[varName];
  if (!presetHex) {
    fail(`  ${varName}: no /* #rrggbb */ comment in preset — add one so drift can be detected`);
    continue;
  }
  if (dmHex !== presetHex) {
    fail(`  colors.${dmKey}: design.md=${dmHex}  preset ${varName}=${presetHex}`);
  }
}

// ── Typography ────────────────────────────────────────────────────────────────

type FontSizeTuple = [string, { lineHeight?: string; letterSpacing?: string }];
const designTypo = design.typography as YamlMap;
const presetFontSize = preset.theme.extend.fontSize as Record<string, FontSizeTuple>;

for (const key of TYPO_KEYS) {
  const dm = designTypo[key] as YamlMap | undefined;
  const p = presetFontSize[key];
  if (!dm) {
    fail(`  typography.${key}: not found in design.md`);
    continue;
  }
  if (!p) {
    fail(`  fontSize.${key}: not found in preset`);
    continue;
  }

  const dmSize = dm.fontSize as string;
  if (dmSize !== p[0]) {
    fail(`  typography.${key}.fontSize: design.md=${dmSize}  preset=${p[0]}`);
  }
  const dmLh = dm.lineHeight as string | undefined;
  if (dmLh !== undefined && p[1].lineHeight !== undefined && dmLh !== p[1].lineHeight) {
    fail(`  typography.${key}.lineHeight: design.md=${dmLh}  preset=${p[1].lineHeight}`);
  }
  const dmLs = dm.letterSpacing as string | undefined;
  if (dmLs !== undefined && p[1].letterSpacing !== undefined && dmLs !== p[1].letterSpacing) {
    fail(`  typography.${key}.letterSpacing: design.md=${dmLs}  preset=${p[1].letterSpacing}`);
  }
}

// ── Rounded ───────────────────────────────────────────────────────────────────

const designRounded = design.rounded as YamlMap;
const presetRadius = preset.theme.extend.borderRadius as Record<string, string>;

for (const [key, varName] of Object.entries(ROUNDED_MAP)) {
  const dmVal = designRounded[key] as string | undefined;
  if (!dmVal) {
    fail(`  rounded.${key}: not found in design.md`);
    continue;
  }

  if (varName === null) {
    // full: hardcoded in borderRadius, not a CSS var
    const presetVal = presetRadius[key];
    if (!presetVal) {
      fail(`  borderRadius.${key}: not found in preset`);
      continue;
    }
    if (dmVal !== presetVal) {
      fail(`  rounded.${key}: design.md=${dmVal}  preset=${presetVal}`);
    }
  } else {
    const varVal = cssVars[varName];
    if (!varVal) {
      fail(`  ${varName}: not found in preset CSS vars (expected for rounded.${key})`);
      continue;
    }
    if (dmVal !== varVal) {
      fail(`  rounded.${key}: design.md=${dmVal}  preset ${varName}=${varVal}`);
    }
  }
}

// ── Spacing ───────────────────────────────────────────────────────────────────

const designSpacing = design.spacing as YamlMap;
const presetSpacing = preset.theme.extend.spacing as Record<string, string>;

for (const key of SPACING_KEYS) {
  const dmVal = designSpacing[key] as string | undefined;
  const pVal = presetSpacing[key];
  if (!dmVal) {
    fail(`  spacing.${key}: not found in design.md`);
    continue;
  }
  if (!pVal) {
    fail(`  spacing.${key}: not found in preset`);
    continue;
  }
  if (dmVal !== pVal) {
    fail(`  spacing.${key}: design.md=${dmVal}  preset=${pVal}`);
  }
}

// ── Controls (Checkbox sizes) ─────────────────────────────────────────────────

const designControls = design.controls as YamlMap | undefined;
const designCheckbox = designControls?.checkbox as YamlMap | undefined;
for (const [key, varName] of Object.entries(CONTROLS_CHECKBOX_MAP)) {
  const dmVal = designCheckbox?.[key] as string | undefined;
  const varVal = cssVars[varName];
  if (!dmVal) {
    fail(`  controls.checkbox.${key}: not found in design.md`);
    continue;
  }
  if (!varVal) {
    fail(`  ${varName}: not found in preset CSS vars (expected for controls.checkbox.${key})`);
    continue;
  }
  if (dmVal !== varVal) {
    fail(`  controls.checkbox.${key}: design.md=${dmVal}  preset ${varName}=${varVal}`);
  }
}

const designSwitch = designControls?.switch as YamlMap | undefined;
for (const [key, varName] of Object.entries(CONTROLS_SWITCH_MAP)) {
  const dmVal = designSwitch?.[key] as string | undefined;
  const varVal = cssVars[varName];
  if (!dmVal) {
    fail(`  controls.switch.${key}: not found in design.md`);
    continue;
  }
  if (!varVal) {
    fail(`  ${varName}: not found in preset CSS vars (expected for controls.switch.${key})`);
    continue;
  }
  if (dmVal !== varVal) {
    fail(`  controls.switch.${key}: design.md=${dmVal}  preset ${varName}=${varVal}`);
  }
}

// ── Report ────────────────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.error('theme:check failed — drift detected between design.md and tailwind-preset.ts:\n');
  for (const f of failures) console.error(f);
  process.exit(1);
}

console.log('theme:check passed — design.md and tailwind-preset.ts are in sync.');
