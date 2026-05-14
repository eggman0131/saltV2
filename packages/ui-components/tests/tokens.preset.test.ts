// spec: SPEC.md §3.3 v0.2.3
import { describe, it, expect, vi } from 'vitest';
import animate from 'tailwindcss-animate';
import preset from '../src/tailwind-preset';
import * as colors from '../src/tokens/colors';
import * as radius from '../src/tokens/radius';
import * as motion from '../src/tokens/motion';
import * as elevation from '../src/tokens/elevation';
import * as zIndex from '../src/tokens/z-index';
import * as tokens from '../src/tokens';
import * as typography from '../src/tokens/typography';

// Helper to extract the handler from a plugin object (Tailwind v3 plugin() return shape).
function getHandler(plugin: unknown): ((api: Record<string, unknown>) => void) | null {
  if (plugin !== null && typeof plugin === 'object' && 'handler' in plugin) {
    return (plugin as { handler: (api: Record<string, unknown>) => void }).handler;
  }
  return null;
}

describe('tailwind-preset', () => {
  describe('preset structure', () => {
    it('has darkMode: class', () => {
      expect(preset.darkMode).toBe('class');
    });

    it('has theme.extend.colors with all semantic color tokens', () => {
      const { colors: c } = preset.theme.extend;
      expect(c).toHaveProperty('background');
      expect(c).toHaveProperty('foreground');
      expect(c).toHaveProperty('primary');
      expect(c).toHaveProperty('secondary');
      expect(c).toHaveProperty('muted');
      expect(c).toHaveProperty('accent');
      expect(c).toHaveProperty('destructive');
      expect(c).toHaveProperty('card');
      expect(c).toHaveProperty('popover');
      expect(c).toHaveProperty('border');
      expect(c).toHaveProperty('input');
      expect(c).toHaveProperty('ring');
    });

    it('has nested primary with DEFAULT and foreground', () => {
      const primary = preset.theme.extend.colors.primary;
      expect(primary).toHaveProperty('DEFAULT');
      expect(primary).toHaveProperty('foreground');
    });

    it('has theme.extend.borderRadius with salt radius tokens', () => {
      const { borderRadius } = preset.theme.extend;
      expect(borderRadius).toHaveProperty('sm', 'var(--salt-radius-sm)');
      expect(borderRadius).toHaveProperty('DEFAULT', 'var(--salt-radius-default)');
      expect(borderRadius).toHaveProperty('md', 'var(--salt-radius-md)');
      expect(borderRadius).toHaveProperty('lg', 'var(--salt-radius-lg)');
      expect(borderRadius).toHaveProperty('xl', 'var(--salt-radius-xl)');
    });

    it('has theme.extend.zIndex with popover, dialog, tooltip', () => {
      const { zIndex: z } = preset.theme.extend;
      expect(z).toHaveProperty('popover', '40');
      expect(z).toHaveProperty('dialog', '50');
      expect(z).toHaveProperty('tooltip', '70');
    });

    it('has 6 plugins registered', () => {
      expect(preset.plugins).toHaveLength(6);
    });

    it('includes tailwindcss-animate plugin', () => {
      expect(preset.plugins).toContain(animate);
    });
  });

  describe('CSS vars plugin', () => {
    it('registers :root and .dark CSS vars', () => {
      const cssVarsPlugin = preset.plugins[1];
      const addBase = vi.fn();
      const handler = getHandler(cssVarsPlugin);
      expect(handler).not.toBeNull();
      handler!({ addBase, addUtilities: vi.fn(), theme: vi.fn() });
      expect(addBase).toHaveBeenCalledOnce();
      const [rules] = addBase.mock.calls[0] as [Record<string, Record<string, string>>];
      expect(rules).toHaveProperty(':root');
      expect(rules).toHaveProperty('.dark');
    });

    it(':root defines --salt-background', () => {
      const cssVarsPlugin = preset.plugins[1];
      const addBase = vi.fn();
      const handler = getHandler(cssVarsPlugin);
      handler!({ addBase, addUtilities: vi.fn(), theme: vi.fn() });
      const [rules] = addBase.mock.calls[0] as [Record<string, Record<string, string>>];
      expect(rules[':root']!['--salt-background']).toBeDefined();
    });

    it(':root and .dark have different values for --salt-background (dark mode flips tokens)', () => {
      const cssVarsPlugin = preset.plugins[1];
      const addBase = vi.fn();
      const handler = getHandler(cssVarsPlugin);
      handler!({ addBase, addUtilities: vi.fn(), theme: vi.fn() });
      const [rules] = addBase.mock.calls[0] as [Record<string, Record<string, string>>];
      expect(rules[':root']!['--salt-background']).not.toBe(rules['.dark']!['--salt-background']);
    });

    it(':root defines radius CSS vars', () => {
      const cssVarsPlugin = preset.plugins[1];
      const addBase = vi.fn();
      const handler = getHandler(cssVarsPlugin);
      handler!({ addBase, addUtilities: vi.fn(), theme: vi.fn() });
      const [rules] = addBase.mock.calls[0] as [Record<string, Record<string, string>>];
      expect(rules[':root']!['--salt-radius-sm']).toBe('0.25rem');
      expect(rules[':root']!['--salt-radius-default']).toBe('0.5rem');
      expect(rules[':root']!['--salt-radius-md']).toBe('0.75rem');
      expect(rules[':root']!['--salt-radius-lg']).toBe('1rem');
      expect(rules[':root']!['--salt-radius-xl']).toBe('1.5rem');
    });
  });

  describe('salt-focus-ring plugin', () => {
    it('adds global :focus-visible base rule', () => {
      const focusPlugin = preset.plugins[2];
      const addBase = vi.fn();
      const handler = getHandler(focusPlugin);
      handler!({ addBase, addUtilities: vi.fn(), theme: vi.fn() });
      expect(addBase).toHaveBeenCalledOnce();
      const [rules] = addBase.mock.calls[0] as [Record<string, Record<string, string>>];
      expect(rules).toHaveProperty(':focus-visible');
      expect(rules[':focus-visible']['outline']).toBe('2px solid hsl(var(--salt-border))');
      expect(rules[':focus-visible']['outline-offset']).toBe('0px');
    });

    it('registers .salt-focus-ring utility', () => {
      const focusPlugin = preset.plugins[2];
      const addUtilities = vi.fn();
      const handler = getHandler(focusPlugin);
      expect(handler).not.toBeNull();
      handler!({ addBase: vi.fn(), addUtilities, theme: vi.fn() });
      expect(addUtilities).toHaveBeenCalledOnce();
      const [utilities] = addUtilities.mock.calls[0] as [Record<string, unknown>];
      expect(utilities).toHaveProperty('.salt-focus-ring');
    });

    it('salt-focus-ring utility contains focus-visible @apply with outline classes', () => {
      const focusPlugin = preset.plugins[2];
      const addUtilities = vi.fn();
      const handler = getHandler(focusPlugin);
      handler!({ addBase: vi.fn(), addUtilities, theme: vi.fn() });
      const [utilities] = addUtilities.mock.calls[0] as [Record<string, unknown>];
      const rule = utilities['.salt-focus-ring'] as Record<string, unknown>;
      const applyKey = Object.keys(rule).find((k) => k.startsWith('@apply'));
      expect(applyKey).toContain('focus-visible:outline');
      expect(applyKey).toContain('focus-visible:outline-2');
      expect(applyKey).toContain('focus-visible:outline-border');
      expect(applyKey).toContain('focus-visible:outline-offset-0');
    });
  });

  describe('salt-component plugin (checkbox tokens)', () => {
    function getComponents(): Record<string, unknown> {
      const componentPlugin = preset.plugins[3];
      const addComponents = vi.fn();
      const handler = getHandler(componentPlugin);
      handler!({ addBase: vi.fn(), addComponents, addUtilities: vi.fn(), theme: vi.fn() });
      return addComponents.mock.calls[0]![0] as Record<string, unknown>;
    }

    it('checkbox base includes aspect-square and min-h-0 to override global button min-height', () => {
      const components = getComponents();
      const rule = components['.salt-control--checkbox'] as Record<string, unknown>;
      const applyKey = Object.keys(rule).find((k) => k.startsWith('@apply'));
      expect(applyKey).toContain('aspect-square');
      expect(applyKey).toContain('min-h-0');
    });

    it('checkbox sm is var(--salt-control-checkbox-sm) × var(--salt-control-checkbox-sm)', () => {
      const components = getComponents();
      const rule = components['.salt-control--checkbox-sm'] as Record<string, string>;
      expect(rule.width).toBe('var(--salt-control-checkbox-sm)');
      expect(rule.height).toBe('var(--salt-control-checkbox-sm)');
    });

    it('checkbox md is var(--salt-control-checkbox-md) × var(--salt-control-checkbox-md)', () => {
      const components = getComponents();
      const rule = components['.salt-control--checkbox-md'] as Record<string, string>;
      expect(rule.width).toBe('var(--salt-control-checkbox-md)');
      expect(rule.height).toBe('var(--salt-control-checkbox-md)');
    });

    it('checkbox lg is var(--salt-control-checkbox-lg) × var(--salt-control-checkbox-lg)', () => {
      const components = getComponents();
      const rule = components['.salt-control--checkbox-lg'] as Record<string, string>;
      expect(rule.width).toBe('var(--salt-control-checkbox-lg)');
      expect(rule.height).toBe('var(--salt-control-checkbox-lg)');
    });

    it('switch base includes min-h-0 to override global button min-height', () => {
      const components = getComponents();
      const rule = components['.salt-control--switch'] as Record<string, unknown>;
      const applyKey = Object.keys(rule).find((k) => k.startsWith('@apply'));
      expect(applyKey).toContain('min-h-0');
    });

    it('switch md track uses CSS var width and height', () => {
      const components = getComponents();
      const rule = components['.salt-control--switch-md'] as Record<string, string>;
      expect(rule.height).toBe('var(--salt-control-switch-md-h)');
      expect(rule.width).toBe('var(--salt-control-switch-md-w)');
    });

    it('switch md thumb uses CSS var width and height', () => {
      const components = getComponents();
      const rule = components['.salt-control--switch-thumb-md'] as Record<string, string>;
      expect(rule.height).toBe('var(--salt-control-switch-thumb-md)');
      expect(rule.width).toBe('var(--salt-control-switch-thumb-md)');
    });
  });

  describe('salt-progress-indeterminate plugin', () => {
    it('registers @keyframes salt-progress-indeterminate', () => {
      const progressPlugin = preset.plugins[4];
      const addBase = vi.fn();
      const handler = getHandler(progressPlugin);
      expect(handler).not.toBeNull();
      handler!({ addBase, addUtilities: vi.fn(), theme: vi.fn() });
      expect(addBase).toHaveBeenCalledOnce();
      const [rules] = addBase.mock.calls[0] as [Record<string, unknown>];
      expect(rules).toHaveProperty('@keyframes salt-progress-indeterminate');
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
