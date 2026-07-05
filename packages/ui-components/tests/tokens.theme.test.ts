// spec: SPEC.md §3.3 v0.2.3
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as colors from '../src/tokens/colors';
import * as radius from '../src/tokens/radius';
import * as motion from '../src/tokens/motion';
import * as elevation from '../src/tokens/elevation';
import * as zIndex from '../src/tokens/z-index';
import * as tokens from '../src/tokens';
import * as typography from '../src/tokens/typography';

const __dirname = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(__dirname, '../src/salt.css'), 'utf8');

describe('salt.css design-system entry', () => {
  describe('imports & structure', () => {
    it('imports tailwindcss and tw-animate-css', () => {
      expect(css).toMatch(/@import\s+['"]tailwindcss['"]/);
      expect(css).toMatch(/@import\s+['"]tw-animate-css['"]/);
    });

    it('declares the dark custom-variant', () => {
      expect(css).toMatch(/@custom-variant\s+dark\s+\(&:where\(\.dark, \.dark \*\)\)/);
    });

    it('declares an @source so v4 scans the ui-components source', () => {
      expect(css).toMatch(/@source\s+"\.\/\*\*\/\*\.\{ts,svelte\}"/);
    });
  });

  describe('@theme tokens', () => {
    it('defines semantic --color-* tokens with no <alpha-value>', () => {
      expect(css).toMatch(/--color-background:\s*hsl\(var\(--salt-background\)\)/);
      expect(css).toMatch(/--color-primary:\s*hsl\(var\(--salt-primary\)\)/);
      expect(css).toMatch(/--color-primary-foreground:\s*hsl\(var\(--salt-primary-foreground\)\)/);
      expect(css).toMatch(/--color-icon-tile:\s*hsl\(var\(--salt-icon-tile\)\)/);
      // v4 derives opacity via color-mix, so no color token carries the v3
      // `/ <alpha-value>` placeholder (a bare mention in a comment is fine).
      expect(css).not.toMatch(/hsl\(var\(--salt-[a-z-]+\)\s*\/\s*<alpha-value>\)/);
    });

    it('defines the radius scale incl. the DEFAULT (--radius) and full tokens', () => {
      expect(css).toMatch(/--radius-sm:\s*var\(--salt-radius-sm\)/);
      expect(css).toMatch(/--radius:\s*var\(--salt-radius-default\)/);
      expect(css).toMatch(/--radius-lg:\s*var\(--salt-radius-lg\)/);
      expect(css).toMatch(/--radius-full:\s*9999px/);
    });

    it('defines font-size tokens with line-height / letter-spacing modifiers', () => {
      expect(css).toMatch(/--text-display:\s*48px/);
      expect(css).toMatch(/--text-display--line-height:\s*1\.1/);
      expect(css).toMatch(/--text-display--letter-spacing:\s*-0\.02em/);
      expect(css).toMatch(/--text-label-caps:\s*12px/);
    });

    it('defines motion + elevation tokens', () => {
      expect(css).toMatch(/--duration-fast:\s*120ms/);
      expect(css).toMatch(/--ease-standard:\s*cubic-bezier\(0\.2, 0, 0, 1\)/);
      expect(css).toMatch(/--shadow-ambient:\s*0 2px 12px 0 hsl\(var\(--salt-primary\) \/ 0\.05\)/);
    });

    it('pins the default-palette colours consolidated from the apps', () => {
      expect(css).toMatch(/--color-amber-500:\s*#f59e0b/);
      expect(css).toMatch(/--color-red-600:\s*#dc2626/);
      expect(css).toMatch(/--color-orange-500:\s*#f97316/);
    });
  });

  describe('--salt-* primitives', () => {
    it('defines --salt-background in :root and overrides it in .dark', () => {
      const rootBg = css.match(/:root\s*\{[\s\S]*?--salt-background:\s*([^;]+);/)?.[1];
      const darkBg = css.match(/\.dark\s*\{[\s\S]*?--salt-background:\s*([^;]+);/)?.[1];
      expect(rootBg).toBeDefined();
      expect(darkBg).toBeDefined();
      expect(rootBg).not.toBe(darkBg);
    });

    it('keeps /* #rrggbb */ provenance comments on salt colour tokens', () => {
      expect(css).toMatch(/--salt-primary:\s*[^;]+;\s*\/\*\s*#35606e/);
      expect(css).toMatch(/--salt-background:\s*[^;]+;\s*\/\*\s*#f8fafa/);
    });

    it('defines the radius + control-size primitives', () => {
      expect(css).toMatch(/--salt-radius-sm:\s*0\.25rem/);
      expect(css).toMatch(/--salt-radius-default:\s*0\.5rem/);
      expect(css).toMatch(/--salt-control-checkbox-md:\s*16px/);
      expect(css).toMatch(/--salt-control-switch-md-w:\s*36px/);
    });
  });

  describe('component classes & custom utilities', () => {
    it('defines the button / input / trigger / control component classes', () => {
      expect(css).toContain('.salt-button {');
      expect(css).toContain('.salt-button--solid {');
      expect(css).toContain('.salt-input {');
      expect(css).toContain('.salt-trigger {');
      expect(css).toContain('.salt-control--checkbox {');
    });

    it('checkbox size classes use the control CSS vars', () => {
      expect(css).toMatch(
        /\.salt-control--checkbox-sm\s*\{[\s\S]*?width:\s*var\(--salt-control-checkbox-sm\)/,
      );
    });

    it('defines the typography component classes', () => {
      expect(css).toContain('.text-display {');
      expect(css).toContain('.text-h1 {');
      expect(css).toContain('.text-label-caps {');
    });

    it('defines the focus-ring and z-index custom utilities', () => {
      expect(css).toMatch(/@utility\s+salt-focus-ring\s*\{/);
      expect(css).toMatch(/@utility\s+salt-focus-ring-within\s*\{/);
      expect(css).toMatch(/@utility\s+z-popover\s*\{\s*z-index:\s*40/);
      expect(css).toMatch(/@utility\s+z-dialog\s*\{\s*z-index:\s*50/);
      expect(css).toMatch(/@utility\s+z-tooltip\s*\{\s*z-index:\s*70/);
    });

    it('defines the progress @keyframes', () => {
      expect(css).toMatch(/@keyframes\s+salt-progress-indeterminate/);
      expect(css).toMatch(/translateX\(-100%\)/);
      expect(css).toMatch(/translateX\(300%\)/);
    });
  });
});

describe('token constants', () => {
  describe('colors', () => {
    it('background is a CSS var reference string', () => {
      expect(colors.background).toBe('hsl(var(--salt-background))');
    });
    it('foreground is a CSS var reference string', () => {
      expect(colors.foreground).toBe('hsl(var(--salt-foreground))');
    });
    it('primary is a CSS var reference string', () => {
      expect(colors.primary).toBe('hsl(var(--salt-primary))');
    });
    it('primaryForeground is a CSS var reference string', () => {
      expect(colors.primaryForeground).toBe('hsl(var(--salt-primary-foreground))');
    });
    it('exports all 23 semantic color constants', () => {
      const keys = Object.keys(colors);
      expect(keys.length).toBe(23);
    });
  });

  describe('radius', () => {
    it('sm is the CSS var reference', () => {
      expect(radius.sm).toBe('var(--salt-radius-sm)');
    });
    it('full is the literal value', () => {
      expect(radius.full).toBe('9999px');
    });
  });

  describe('motion', () => {
    it('durationFast is 120ms', () => {
      expect(motion.durationFast).toBe('120ms');
    });
    it('easeStandard matches spec', () => {
      expect(motion.easeStandard).toBe('cubic-bezier(0.2, 0, 0, 1)');
    });
  });

  describe('elevation', () => {
    it('popover aliases to md', () => {
      expect(elevation.popover).toBe(elevation.md);
    });
    it('dialog aliases to lg', () => {
      expect(elevation.dialog).toBe(elevation.lg);
    });
  });

  describe('zIndex', () => {
    it('popover is 40', () => {
      expect(zIndex.popover).toBe(40);
    });
    it('dialog is 50', () => {
      expect(zIndex.dialog).toBe(50);
    });
    it('tooltip is 70', () => {
      expect(zIndex.tooltip).toBe(70);
    });
  });

  describe('tokens barrel', () => {
    it('exports colors namespace', () => {
      expect(tokens.colors).toBeDefined();
      expect(tokens.colors.background).toBe('hsl(var(--salt-background))');
    });
    it('exports radius namespace', () => {
      expect(tokens.radius).toBeDefined();
      expect(tokens.radius.sm).toBe('var(--salt-radius-sm)');
    });
    it('exports motion namespace', () => {
      expect(tokens.motion).toBeDefined();
      expect(tokens.motion.durationFast).toBe('120ms');
    });
    it('exports elevation namespace', () => {
      expect(tokens.elevation).toBeDefined();
    });
    it('exports zIndex namespace', () => {
      expect(tokens.zIndex).toBeDefined();
      expect(tokens.zIndex.popover).toBe(40);
    });
    it('exports typography namespace', () => {
      expect(tokens.typography).toBeDefined();
      expect(tokens.typography.fontFamilyDisplay).toContain('Epilogue');
    });
  });
});

describe('typography tokens', () => {
  it('fontFamilyDisplay includes Epilogue', () => {
    expect(typography.fontFamilyDisplay).toContain('Epilogue');
  });
  it('fontFamilyBody includes Inter', () => {
    expect(typography.fontFamilyBody).toContain('Inter');
  });
  it('fontSizeDisplay is 48px', () => {
    expect(typography.fontSizeDisplay).toBe('48px');
  });
  it('fontSizeH1 is 32px', () => {
    expect(typography.fontSizeH1).toBe('32px');
  });
  it('fontSizeH2 is 24px', () => {
    expect(typography.fontSizeH2).toBe('24px');
  });
  it('fontSizeBodyLg is 18px', () => {
    expect(typography.fontSizeBodyLg).toBe('18px');
  });
  it('fontSizeBodyMd is 16px', () => {
    expect(typography.fontSizeBodyMd).toBe('16px');
  });
  it('fontSizeLabelCaps is 12px', () => {
    expect(typography.fontSizeLabelCaps).toBe('12px');
  });
  it('letterSpacingDisplay is -0.02em', () => {
    expect(typography.letterSpacingDisplay).toBe('-0.02em');
  });
  it('letterSpacingLabelCaps is 0.05em', () => {
    expect(typography.letterSpacingLabelCaps).toBe('0.05em');
  });
  it('fontWeightDisplay is 700', () => {
    expect(typography.fontWeightDisplay).toBe('700');
  });
  it('fontWeightHeading is 600', () => {
    expect(typography.fontWeightHeading).toBe('600');
  });
  it('exports 21 typography constants', () => {
    expect(Object.keys(typography).length).toBe(21);
  });
});
