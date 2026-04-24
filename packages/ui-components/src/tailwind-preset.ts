// spec: SPEC.md §3.3 v0.2.3
import plugin from 'tailwindcss/plugin';
import animate from 'tailwindcss-animate';

const cssVarsPlugin = plugin(({ addBase }) => {
  addBase({
    ':root': {
      '--salt-background': '0 0% 100%',
      '--salt-foreground': '222.2 84% 4.9%',
      '--salt-primary': '222.2 47.4% 11.2%',
      '--salt-primary-foreground': '210 40% 98%',
      '--salt-secondary': '210 40% 96.1%',
      '--salt-secondary-foreground': '222.2 47.4% 11.2%',
      '--salt-muted': '210 40% 96.1%',
      '--salt-muted-foreground': '215.4 16.3% 46.9%',
      '--salt-accent': '210 40% 96.1%',
      '--salt-accent-foreground': '222.2 47.4% 11.2%',
      '--salt-destructive': '0 84.2% 60.2%',
      '--salt-destructive-foreground': '210 40% 98%',
      '--salt-card': '0 0% 100%',
      '--salt-card-foreground': '222.2 84% 4.9%',
      '--salt-popover': '0 0% 100%',
      '--salt-popover-foreground': '222.2 84% 4.9%',
      '--salt-border': '214.3 31.8% 91.4%',
      '--salt-input': '214.3 31.8% 91.4%',
      '--salt-ring': '222.2 84% 4.9%',
      '--salt-radius-sm': '2px',
      '--salt-radius-md': '6px',
      '--salt-radius-lg': '10px',
      '--salt-radius-xl': '14px',
    },
    '.dark': {
      '--salt-background': '222.2 84% 4.9%',
      '--salt-foreground': '210 40% 98%',
      '--salt-primary': '210 40% 98%',
      '--salt-primary-foreground': '222.2 47.4% 11.2%',
      '--salt-secondary': '217.2 32.6% 17.5%',
      '--salt-secondary-foreground': '210 40% 98%',
      '--salt-muted': '217.2 32.6% 17.5%',
      '--salt-muted-foreground': '215 20.2% 65.1%',
      '--salt-accent': '217.2 32.6% 17.5%',
      '--salt-accent-foreground': '210 40% 98%',
      '--salt-destructive': '0 62.8% 30.6%',
      '--salt-destructive-foreground': '210 40% 98%',
      '--salt-card': '222.2 84% 4.9%',
      '--salt-card-foreground': '210 40% 98%',
      '--salt-popover': '222.2 84% 4.9%',
      '--salt-popover-foreground': '210 40% 98%',
      '--salt-border': '217.2 32.6% 17.5%',
      '--salt-input': '217.2 32.6% 17.5%',
      '--salt-ring': '212.7 26.8% 83.9%',
    },
  });
});

const saltFocusRingPlugin = plugin(({ addUtilities }) => {
  addUtilities({
    '.salt-focus-ring': {
      '@apply focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background':
        {},
    },
    '.salt-focus-ring-within': {
      '@apply focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background':
        {},
    },
  });
});

const saltComponentPlugin = plugin(({ addComponents }) => {
  addComponents({
    // ─ Button ─────────────────────────────────────────────────────────
    '.salt-button': {
      '@apply focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors motion-reduce:transition-none disabled:pointer-events-none data-[disabled]:opacity-50':
        {},
    },
    '.salt-button--solid': { '@apply bg-primary text-primary-foreground hover:bg-primary/90': {} },
    '.salt-button--outline': {
      '@apply border border-input bg-background hover:bg-accent hover:text-accent-foreground': {},
    },
    '.salt-button--ghost': { '@apply bg-transparent hover:bg-muted hover:text-foreground': {} },
    '.salt-button--link': {
      '@apply bg-transparent underline-offset-4 hover:underline text-primary': {},
    },
    '.salt-button--destructive': {
      '@apply bg-destructive text-destructive-foreground hover:bg-destructive/90': {},
    },
    '.salt-button--sm': { '@apply h-8 px-3 text-sm': {} },
    '.salt-button--md': { '@apply h-9 px-4 text-sm': {} },
    '.salt-button--lg': { '@apply h-10 px-6 text-base': {} },
    '.salt-button--icon': { '@apply h-9 w-9 p-0': {} },
    '.salt-button--full': { '@apply w-full': {} },

    // ─ Input (TextField frame + ComboboxInput) ────────────────────────
    '.salt-input': {
      '@apply flex items-center gap-2 rounded-md border border-input bg-background': {},
    },
    '.salt-input--sm': { '@apply h-8 px-3 text-sm': {} },
    '.salt-input--md': { '@apply h-9 px-4 text-sm': {} },
    '.salt-input--lg': { '@apply h-10 px-6 text-base': {} },
    '.salt-input--error': {
      '@apply border-destructive focus-within:ring-destructive': {},
    },
    '.salt-input--disabled': { '@apply opacity-50 pointer-events-none': {} },
    // Combobox variant: direct <input> element (owns its own focus ring)
    '.salt-input--combobox': {
      '@apply focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background h-10 w-full px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground':
        {},
    },

    // ─ Trigger (SelectTrigger) ────────────────────────────────────────
    '.salt-trigger': {
      '@apply focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-offset-background':
        {},
    },
    '.salt-trigger--disabled': { '@apply cursor-not-allowed opacity-50 pointer-events-none': {} },
    '.salt-trigger--enabled': { '@apply cursor-pointer hover:bg-accent/50': {} },

    // ─ Control (Checkbox / Radio / Switch) ────────────────────────────
    '.salt-control': {
      '@apply focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background':
        {},
    },
    // Checkbox
    '.salt-control--checkbox': {
      '@apply peer shrink-0 rounded border border-input bg-background data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground':
        {},
    },
    '.salt-control--checkbox-sm': { '@apply h-3.5 w-3.5': {} },
    '.salt-control--checkbox-md': { '@apply h-4 w-4': {} },
    '.salt-control--checkbox-lg': { '@apply h-5 w-5': {} },
    // Radio item (the focusable row: indicator + label)
    '.salt-control--radio': {
      '@apply flex items-center gap-2 cursor-pointer rounded-sm outline-none': {},
    },
    // Radio indicator (the visual dot)
    '.salt-control--radio-indicator': {
      '@apply h-4 w-4 shrink-0 rounded-full border border-primary flex items-center justify-center':
        {},
    },
    '.salt-control--radio-indicator-checked': { '@apply bg-primary': {} },
    '.salt-control--radio-indicator-unchecked': { '@apply bg-background': {} },
    // Switch root (the track)
    '.salt-control--switch': {
      '@apply inline-flex shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors motion-reduce:transition-none data-[state=checked]:bg-primary data-[state=unchecked]:bg-input':
        {},
    },
    '.salt-control--switch-sm': { '@apply h-4 w-7': {} },
    '.salt-control--switch-md': { '@apply h-5 w-9': {} },
    '.salt-control--switch-lg': { '@apply h-6 w-11': {} },
    // Switch thumb
    '.salt-control--switch-thumb': {
      '@apply pointer-events-none block rounded-full bg-background shadow-sm transition-transform motion-reduce:transition-none data-[state=unchecked]:translate-x-0':
        {},
    },
    '.salt-control--switch-thumb-sm': {
      '@apply h-3 w-3 data-[state=checked]:translate-x-3': {},
    },
    '.salt-control--switch-thumb-md': {
      '@apply h-4 w-4 data-[state=checked]:translate-x-4': {},
    },
    '.salt-control--switch-thumb-lg': {
      '@apply h-5 w-5 data-[state=checked]:translate-x-5': {},
    },
    // Shared disabled state
    '.salt-control--disabled': { '@apply opacity-50 pointer-events-none cursor-not-allowed': {} },
  });
});

const saltProgressPlugin = plugin(({ addBase }) => {
  addBase({
    '@keyframes salt-progress-indeterminate': {
      '0%': { transform: 'translateX(-100%)' },
      '100%': { transform: 'translateX(300%)' },
    },
  });
});

const preset = {
  darkMode: 'class' as const,
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--salt-background) / <alpha-value>)',
        foreground: 'hsl(var(--salt-foreground) / <alpha-value>)',
        primary: {
          DEFAULT: 'hsl(var(--salt-primary) / <alpha-value>)',
          foreground: 'hsl(var(--salt-primary-foreground) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'hsl(var(--salt-secondary) / <alpha-value>)',
          foreground: 'hsl(var(--salt-secondary-foreground) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'hsl(var(--salt-muted) / <alpha-value>)',
          foreground: 'hsl(var(--salt-muted-foreground) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'hsl(var(--salt-accent) / <alpha-value>)',
          foreground: 'hsl(var(--salt-accent-foreground) / <alpha-value>)',
        },
        destructive: {
          DEFAULT: 'hsl(var(--salt-destructive) / <alpha-value>)',
          foreground: 'hsl(var(--salt-destructive-foreground) / <alpha-value>)',
        },
        card: {
          DEFAULT: 'hsl(var(--salt-card) / <alpha-value>)',
          foreground: 'hsl(var(--salt-card-foreground) / <alpha-value>)',
        },
        popover: {
          DEFAULT: 'hsl(var(--salt-popover) / <alpha-value>)',
          foreground: 'hsl(var(--salt-popover-foreground) / <alpha-value>)',
        },
        border: 'hsl(var(--salt-border) / <alpha-value>)',
        input: 'hsl(var(--salt-input) / <alpha-value>)',
        ring: 'hsl(var(--salt-ring) / <alpha-value>)',
      },
      borderRadius: {
        sm: 'var(--salt-radius-sm)',
        md: 'var(--salt-radius-md)',
        lg: 'var(--salt-radius-lg)',
        xl: 'var(--salt-radius-xl)',
        full: '9999px',
      },
      transitionDuration: {
        fast: '120ms',
        base: '180ms',
        slow: '260ms',
      },
      transitionTimingFunction: {
        standard: 'cubic-bezier(0.2, 0, 0, 1)',
        emphasized: 'cubic-bezier(0.3, 0, 0, 1)',
        decel: 'cubic-bezier(0, 0, 0, 1)',
      },
      boxShadow: {
        sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
        md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
        lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
        popover: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
        dialog: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
      },
      zIndex: {
        popover: '40',
        dialog: '50',
        tooltip: '70',
      },
    },
  },
  plugins: [animate, cssVarsPlugin, saltFocusRingPlugin, saltComponentPlugin, saltProgressPlugin],
};

export default preset;
