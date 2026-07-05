// spec: SPEC.md §3.3 v0.2.3
// Compares design/design.md frontmatter against the CSS-first design-system
// entry (src/salt.css). Fails with a diff when the two drift. Run via
// `pnpm theme:check`.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');
const DESIGN_MD_PATH = join(REPO_ROOT, 'docs/design/design.md');
const CSS_SRC_PATH = join(__dirname, '../src/salt.css');

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

// ── Extract hex values from /* #rrggbb */ comments on --salt-* declarations ───
// Matches:  --salt-foo: H S% L%; /* #rrggbb ...
function extractVarHexComments(src: string): Record<string, string> {
  const result: Record<string, string> = {};
  const re = /(--salt-[a-z0-9-]+):\s*[^;]+;\s*\/\*\s*(#[0-9a-fA-F]{6})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (!(m[1]! in result)) result[m[1]!] = m[2]!.toLowerCase();
  }
  return result;
}

// ── Extract every `--name: value;` custom-property value (first wins) ─────────
// Captures the :root/@theme values (light theme wins over the later .dark
// overrides), covering both the raw --salt-* primitives and the @theme tokens
// (--text-*, --radius-*, --spacing-*).
function extractCssVarValues(src: string): Record<string, string> {
  const result: Record<string, string> = {};
  const re = /(--[a-z0-9-]+):\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (!(m[1]! in result)) result[m[1]!] = m[2]!.trim();
  }
  return result;
}

// ── Mappings ──────────────────────────────────────────────────────────────────

/** design.md color key → salt CSS var name */
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

/** design.md rounded key → CSS var name.
 * sm/md/lg/xl/DEFAULT map to the raw --salt-radius-* primitives; `full` is the
 * literal --radius-full @theme token. */
const ROUNDED_MAP: Record<string, string> = {
  sm: '--salt-radius-sm',
  DEFAULT: '--salt-radius-default',
  md: '--salt-radius-md',
  lg: '--salt-radius-lg',
  xl: '--salt-radius-xl',
  full: '--radius-full',
};

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

// Compare two dimensional CSS values (e.g. "1.0" vs "1", "-.01em" vs "-0.01em",
// "0.25rem" vs ".25rem", "48px") for numeric equality. Prettier normalises number
// formatting in salt.css (drops trailing/leading zeros), so a raw string compare
// would spuriously flag identical values as drift. Split into numeric magnitude +
// unit; compare the magnitude as a float and the unit verbatim. Non-numeric values
// (e.g. hex is handled separately) fall back to an exact trimmed compare.
const dimEq = (a: string, b: string): boolean => {
  const parse = (v: string): [number, string] | null => {
    const m = v.trim().match(/^(-?(?:\d+\.?\d*|\.\d+))\s*([a-z%]*)$/i);
    return m ? [parseFloat(m[1]), m[2].toLowerCase()] : null;
  };
  const pa = parse(a);
  const pb = parse(b);
  if (pa && pb) return pa[0] === pb[0] && pa[1] === pb[1];
  return a.trim() === b.trim();
};

const designSrc = readFileSync(DESIGN_MD_PATH, 'utf8');
const cssSrc = readFileSync(CSS_SRC_PATH, 'utf8');
const design = parseFrontmatter(designSrc);
const varHex = extractVarHexComments(cssSrc);
const cssVars = extractCssVarValues(cssSrc);

// ── Colors ────────────────────────────────────────────────────────────────────

const designColors = design.colors as YamlMap;
for (const [dmKey, varName] of Object.entries(COLOR_MAP)) {
  const dmHex = (designColors[dmKey] as string | undefined)?.toLowerCase();
  if (!dmHex) {
    fail(`  colors.${dmKey}: not found in design.md`);
    continue;
  }
  const cssHex = varHex[varName];
  if (!cssHex) {
    fail(`  ${varName}: no /* #rrggbb */ comment in salt.css — add one so drift can be detected`);
    continue;
  }
  if (dmHex !== cssHex) {
    fail(`  colors.${dmKey}: design.md=${dmHex}  salt.css ${varName}=${cssHex}`);
  }
}

// ── Typography ────────────────────────────────────────────────────────────────
// design.md typography[key] ↔ @theme --text-<key> (+ --line-height/--letter-spacing).

const designTypo = design.typography as YamlMap;

for (const key of TYPO_KEYS) {
  const dm = designTypo[key] as YamlMap | undefined;
  if (!dm) {
    fail(`  typography.${key}: not found in design.md`);
    continue;
  }
  const cssSize = cssVars[`--text-${key}`];
  if (!cssSize) {
    fail(`  --text-${key}: not found in salt.css @theme`);
    continue;
  }

  const dmSize = dm.fontSize as string;
  if (!dimEq(dmSize, cssSize)) {
    fail(`  typography.${key}.fontSize: design.md=${dmSize}  salt.css --text-${key}=${cssSize}`);
  }
  const dmLh = dm.lineHeight as string | undefined;
  const cssLh = cssVars[`--text-${key}--line-height`];
  if (dmLh !== undefined && cssLh !== undefined && !dimEq(dmLh, cssLh)) {
    fail(
      `  typography.${key}.lineHeight: design.md=${dmLh}  salt.css --text-${key}--line-height=${cssLh}`,
    );
  }
  const dmLs = dm.letterSpacing as string | undefined;
  const cssLs = cssVars[`--text-${key}--letter-spacing`];
  if (dmLs !== undefined && cssLs !== undefined && !dimEq(dmLs, cssLs)) {
    fail(
      `  typography.${key}.letterSpacing: design.md=${dmLs}  salt.css --text-${key}--letter-spacing=${cssLs}`,
    );
  }
}

// ── Rounded ───────────────────────────────────────────────────────────────────

const designRounded = design.rounded as YamlMap;

for (const [key, varName] of Object.entries(ROUNDED_MAP)) {
  const dmVal = designRounded[key] as string | undefined;
  if (!dmVal) {
    fail(`  rounded.${key}: not found in design.md`);
    continue;
  }
  const cssVal = cssVars[varName];
  if (!cssVal) {
    fail(`  ${varName}: not found in salt.css (expected for rounded.${key})`);
    continue;
  }
  if (!dimEq(dmVal, cssVal)) {
    fail(`  rounded.${key}: design.md=${dmVal}  salt.css ${varName}=${cssVal}`);
  }
}

// ── Spacing ───────────────────────────────────────────────────────────────────
// No spacing drift check. The design.md spacing scale (xs/sm/md/lg/xl) has no
// collision-free home in v4's unified sizing model: `@theme --spacing-{sm,md,lg,
// xl}` shares its keys with the `--container-*` scale and hijacks
// `max-w-{sm,md,lg,xl}` (they collapse to 8/16/24/48px). Components use the
// numeric scale off v4's default `--spacing: 0.25rem` base, so no named spacing
// tokens are emitted. Re-homing the scale collision-free (e.g. `--salt-space-*`)
// and restoring this check are deferred to Phase 4. (It was briefly restored in
// Phase 3 against `@theme --spacing-*` — which caused exactly that max-w collapse.)

// ── Controls (Checkbox sizes) ─────────────────────────────────────────────────

const designControls = design.controls as YamlMap | undefined;
const designCheckbox = designControls?.checkbox as YamlMap | undefined;
for (const [key, varName] of Object.entries(CONTROLS_CHECKBOX_MAP)) {
  const dmVal = designCheckbox?.[key] as string | undefined;
  const cssVal = cssVars[varName];
  if (!dmVal) {
    fail(`  controls.checkbox.${key}: not found in design.md`);
    continue;
  }
  if (!cssVal) {
    fail(`  ${varName}: not found in salt.css (expected for controls.checkbox.${key})`);
    continue;
  }
  if (!dimEq(dmVal, cssVal)) {
    fail(`  controls.checkbox.${key}: design.md=${dmVal}  salt.css ${varName}=${cssVal}`);
  }
}

const designSwitch = designControls?.switch as YamlMap | undefined;
for (const [key, varName] of Object.entries(CONTROLS_SWITCH_MAP)) {
  const dmVal = designSwitch?.[key] as string | undefined;
  const cssVal = cssVars[varName];
  if (!dmVal) {
    fail(`  controls.switch.${key}: not found in design.md`);
    continue;
  }
  if (!cssVal) {
    fail(`  ${varName}: not found in salt.css (expected for controls.switch.${key})`);
    continue;
  }
  if (!dimEq(dmVal, cssVal)) {
    fail(`  controls.switch.${key}: design.md=${dmVal}  salt.css ${varName}=${cssVal}`);
  }
}

// ── Report ────────────────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.error('theme:check failed — drift detected between design.md and salt.css:\n');
  for (const f of failures) console.error(f);
  process.exit(1);
}

console.log('theme:check passed — design.md and salt.css are in sync.');
