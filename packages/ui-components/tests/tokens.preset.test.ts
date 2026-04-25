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
      expect(rules[':root']!['--salt-radius-md']).toBe('0.5rem');
      expect(rules[':root']!['--salt-radius-lg']).toBe('1rem');
      expect(rules[':root']!['--salt-radius-xl']).toBe('1.5rem');
    });
  });

  describe('salt-focus-ring plugin', () => {
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

    it('salt-focus-ring utility contains focus-visible @apply with §4.2 classes', () => {
      const focusPlugin = preset.plugins[2];
      const addUtilities = vi.fn();
      const handler = getHandler(focusPlugin);
      handler!({ addBase: vi.fn(), addUtilities, theme: vi.fn() });
      const [utilities] = addUtilities.mock.calls[0] as [Record<string, unknown>];
      const rule = utilities['.salt-focus-ring'] as Record<string, unknown>;
      const applyKey = Object.keys(rule).find((k) => k.startsWith('@apply'));
      expect(applyKey).toContain('focus-visible:outline-none');
      expect(applyKey).toContain('focus-visible:ring-2');
      expect(applyKey).toContain('focus-visible:ring-ring');
      expect(applyKey).toContain('focus-visible:ring-offset-2');
      expect(applyKey).toContain('focus-visible:ring-offset-background');
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
    it('exports all 19 semantic color constants', () => {
      const keys = Object.keys(colors);
      expect(keys.length).toBe(19);
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
  });
});
