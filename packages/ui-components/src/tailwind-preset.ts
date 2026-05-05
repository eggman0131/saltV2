// spec: SPEC.md §3.3 v0.2.3
import plugin from 'tailwindcss/plugin';
import animate from 'tailwindcss-animate';

const cssVarsPlugin = plugin(({ addBase }) => {
  addBase({
    ':root': {
      // ── Culinary Modernist — light ──────────────────────────────────
      '--salt-background': '180 11% 98%' /* #f8fafa  surface */,
      '--salt-foreground': '195 7% 11%' /* #191c1d  on-surface */,
      '--salt-primary': '195 35% 32%' /* #35606e  slate teal */,
      '--salt-primary-foreground': '0 0% 100%' /* #ffffff */,
      '--salt-secondary': '98 20% 33%' /* #4f6443  sage */,
      '--salt-secondary-foreground': '0 0% 100%' /* #ffffff */,
      '--salt-secondary-container': '94 47% 82%' /* #cfe7bd  sage container */,
      '--salt-on-secondary-container': '99 19% 35%' /* #536947 */,
      '--salt-tertiary': '6 100% 10%' /* #340500  terracotta */,
      '--salt-tertiary-foreground': '0 0% 100%' /* #ffffff */,
      '--salt-tertiary-container': '10 100% 17%' /* #580f00 */,
      '--salt-on-tertiary-container': '12 76% 61%' /* #e76e50 */,
      '--salt-muted': '180 6% 93%' /* #eceeee  surface-container */,
      '--salt-muted-foreground': '195 6% 27%' /* #42484a  on-surface-variant */,
      '--salt-accent': '94 47% 82%' /* secondary-container */,
      '--salt-accent-foreground': '99 19% 35%' /* on-secondary-container */,
      '--salt-destructive': '0 75% 42%' /* #ba1a1a  error */,
      '--salt-destructive-foreground': '0 0% 100%' /* #ffffff */,
      '--salt-card': '0 0% 100%' /* surface-container-lowest */,
      '--salt-card-foreground': '195 7% 11%' /* on-surface */,
      '--salt-popover': '0 0% 100%',
      '--salt-popover-foreground': '195 7% 11%',
      '--salt-border': '203 7% 78%' /* #c2c7ca  outline-variant */,
      '--salt-input': '203 7% 78%',
      '--salt-ring': '195 35% 32%' /* #35606e  slate teal */,
      '--salt-radius-sm': '0.25rem',
      '--salt-radius-default': '0.5rem',
      '--salt-radius-md': '0.75rem',
      '--salt-radius-lg': '1rem',
      '--salt-radius-xl': '1.5rem',
      '--salt-control-checkbox-sm': '14px',
      '--salt-control-checkbox-md': '16px',
      '--salt-control-checkbox-lg': '18px',
      '--salt-control-switch-sm-h': '16px',
      '--salt-control-switch-sm-w': '28px',
      '--salt-control-switch-md-h': '20px',
      '--salt-control-switch-md-w': '36px',
      '--salt-control-switch-lg-h': '24px',
      '--salt-control-switch-lg-w': '44px',
      '--salt-control-switch-thumb-sm': '12px',
      '--salt-control-switch-thumb-md': '16px',
      '--salt-control-switch-thumb-lg': '20px',
    },
    '.dark': {
      // ── Culinary Modernist — dark ───────────────────────────────────
      '--salt-background': '180 3% 19%' /* #2e3131  inverse-surface */,
      '--salt-foreground': '180 7% 94%' /* #eff1f1 */,
      '--salt-primary': '198 26% 77%' /* #b4cad3  inverse-primary */,
      '--salt-primary-foreground': '195 77% 7%' /* #041920 */,
      '--salt-secondary': '98 20% 33%' /* #4f6443  sage */,
      '--salt-secondary-foreground': '0 0% 100%',
      '--salt-secondary-container': '94 47% 82%',
      '--salt-on-secondary-container': '99 19% 35%',
      '--salt-tertiary': '6 100% 10%',
      '--salt-tertiary-foreground': '0 0% 100%',
      '--salt-tertiary-container': '10 100% 17%',
      '--salt-on-tertiary-container': '12 76% 61%',
      '--salt-muted': '180 3% 24%',
      '--salt-muted-foreground': '195 5% 58%',
      '--salt-accent': '98 20% 33%',
      '--salt-accent-foreground': '0 0% 100%',
      '--salt-destructive': '0 75% 42%',
      '--salt-destructive-foreground': '0 0% 100%',
      '--salt-card': '180 3% 22%',
      '--salt-card-foreground': '180 7% 94%',
      '--salt-popover': '180 3% 22%',
      '--salt-popover-foreground': '180 7% 94%',
      '--salt-border': '197 3% 46%' /* #73787a  outline */,
      '--salt-input': '197 3% 46%',
      '--salt-ring': '198 26% 77%' /* #b4cad3 */,
    },
  });
});

const saltFocusRingPlugin = plugin(({ addUtilities }) => {
  addUtilities({
    '.salt-focus-ring': {
      '@apply focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1':
        {},
    },
    '.salt-focus-ring-within': {
      '@apply focus-within:outline focus-within:outline-2 focus-within:outline-ring focus-within:outline-offset-1':
        {},
    },
  });
});

const saltComponentPlugin = plugin(({ addComponents }) => {
  addComponents({
    // ─ Button ─────────────────────────────────────────────────────────
    '.salt-button': {
      '@apply inline-flex items-center justify-center gap-2 rounded font-medium transition-colors duration-fast ease-standard motion-reduce:transition-none disabled:pointer-events-none data-[disabled]:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1':
        {},
    },
    '.salt-button--solid': { '@apply bg-primary text-primary-foreground hover:bg-primary/90': {} },
    '.salt-button--outline': {
      '@apply border border-secondary text-secondary bg-background hover:bg-secondary hover:text-secondary-foreground':
        {},
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
      '@apply flex items-center gap-2 rounded border border-input bg-background': {},
    },
    '.salt-input--sm': { '@apply h-8 px-3 text-sm': {} },
    '.salt-input--md': { '@apply h-9 px-4 text-sm': {} },
    '.salt-input--lg': { '@apply h-10 px-6 text-base': {} },
    '.salt-input--error': {
      '@apply border-destructive focus-within:ring-destructive': {},
    },
    '.salt-input--disabled': { '@apply opacity-50 pointer-events-none': {} },
    // Combobox variant: direct <input>; focus ring lives on the ComboboxField
    // wrapper so it surrounds input + trigger, not just the input.
    '.salt-input--combobox': {
      '@apply outline-none h-10 w-full px-3 py-2 text-sm placeholder:text-muted-foreground': {},
    },

    // ─ Trigger (SelectTrigger) ────────────────────────────────────────
    '.salt-trigger': {
      '@apply flex h-9 w-full items-center justify-between gap-2 rounded border border-input bg-background px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1':
        {},
    },
    '.salt-trigger--disabled': { '@apply cursor-not-allowed opacity-50 pointer-events-none': {} },
    '.salt-trigger--enabled': { '@apply cursor-pointer hover:bg-accent/50': {} },

    // ─ Control (Checkbox / Radio / Switch) ────────────────────────────
    '.salt-control': {
      '@apply focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1':
        {},
    },
    // Checkbox
    '.salt-control--checkbox': {
      '@apply shrink-0 min-h-0 rounded-sm border border-input bg-background aspect-square data-[state=checked]:bg-secondary data-[state=checked]:text-secondary-foreground':
        {},
    },
    '.salt-control--checkbox-sm': {
      width: 'var(--salt-control-checkbox-sm)',
      height: 'var(--salt-control-checkbox-sm)',
    },
    '.salt-control--checkbox-md': {
      width: 'var(--salt-control-checkbox-md)',
      height: 'var(--salt-control-checkbox-md)',
    },
    '.salt-control--checkbox-lg': {
      width: 'var(--salt-control-checkbox-lg)',
      height: 'var(--salt-control-checkbox-lg)',
    },
    // Radio item (the focusable row: indicator + label)
    '.salt-control--radio': {
      '@apply flex items-center gap-2 cursor-pointer rounded-sm outline-none': {},
    },
    // Radio indicator (the visual dot)
    '.salt-control--radio-indicator': {
      '@apply h-4 w-4 shrink-0 rounded-full border border-secondary flex items-center justify-center':
        {},
    },
    '.salt-control--radio-indicator-checked': { '@apply bg-secondary': {} },
    '.salt-control--radio-indicator-unchecked': { '@apply bg-background': {} },
    // Switch root (the track)
    '.salt-control--switch': {
      '@apply inline-flex shrink-0 min-h-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-base ease-standard motion-reduce:transition-none data-[state=checked]:bg-secondary data-[state=unchecked]:bg-input':
        {},
    },
    '.salt-control--switch-sm': {
      height: 'var(--salt-control-switch-sm-h)',
      width: 'var(--salt-control-switch-sm-w)',
    },
    '.salt-control--switch-md': {
      height: 'var(--salt-control-switch-md-h)',
      width: 'var(--salt-control-switch-md-w)',
    },
    '.salt-control--switch-lg': {
      height: 'var(--salt-control-switch-lg-h)',
      width: 'var(--salt-control-switch-lg-w)',
    },
    // Switch thumb
    '.salt-control--switch-thumb': {
      '@apply pointer-events-none block rounded-full bg-background shadow-sm transition-transform duration-base ease-standard motion-reduce:transition-none data-[state=unchecked]:translate-x-0':
        {},
    },
    '.salt-control--switch-thumb-sm': {
      '@apply data-[state=checked]:translate-x-3': {},
      height: 'var(--salt-control-switch-thumb-sm)',
      width: 'var(--salt-control-switch-thumb-sm)',
    },
    '.salt-control--switch-thumb-md': {
      '@apply data-[state=checked]:translate-x-4': {},
      height: 'var(--salt-control-switch-thumb-md)',
      width: 'var(--salt-control-switch-thumb-md)',
    },
    '.salt-control--switch-thumb-lg': {
      '@apply data-[state=checked]:translate-x-5': {},
      height: 'var(--salt-control-switch-thumb-lg)',
      width: 'var(--salt-control-switch-thumb-lg)',
    },
    // Shared disabled state
    '.salt-control--disabled': { '@apply opacity-50 pointer-events-none cursor-not-allowed': {} },
  });
});

const saltTypographyPlugin = plugin(({ addBase, addComponents }) => {
  addBase({
    html: {
      fontFamily: "'Inter', sans-serif",
      fontSize: '1rem',
      fontWeight: '400',
      lineHeight: '1.5',
    },
    body: {
      backgroundColor: 'hsl(var(--salt-background))',
      color: 'hsl(var(--salt-foreground))',
    },
    h1: {
      fontFamily: "'Epilogue', sans-serif",
      fontSize: '2rem',
      fontWeight: '600',
      lineHeight: '1.2',
      letterSpacing: '-0.01em',
    },
    h2: {
      fontFamily: "'Epilogue', sans-serif",
      fontSize: '1.5rem',
      fontWeight: '600',
      lineHeight: '1.3',
    },
    'h3, h4, h5, h6': {
      fontFamily: "'Epilogue', sans-serif",
    },
  });

  addComponents({
    '.text-display': {
      fontFamily: "'Epilogue', sans-serif",
      fontSize: '3rem',
      fontWeight: '700',
      lineHeight: '1.1',
      letterSpacing: '-0.02em',
    },
    '.text-h1': {
      fontFamily: "'Epilogue', sans-serif",
      fontSize: '2rem',
      fontWeight: '600',
      lineHeight: '1.2',
      letterSpacing: '-0.01em',
    },
    '.text-h2': {
      fontFamily: "'Epilogue', sans-serif",
      fontSize: '1.5rem',
      fontWeight: '600',
      lineHeight: '1.3',
    },
    '.text-body-lg': {
      fontSize: '1.125rem',
      fontWeight: '400',
      lineHeight: '1.6',
    },
    '.text-body-md': {
      fontSize: '1rem',
      fontWeight: '400',
      lineHeight: '1.5',
    },
    '.text-label-caps': {
      fontSize: '0.75rem',
      fontWeight: '600',
      lineHeight: '1',
      letterSpacing: '0.05em',
      textTransform: 'uppercase',
    },
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
        'secondary-container': {
          DEFAULT: 'hsl(var(--salt-secondary-container) / <alpha-value>)',
          foreground: 'hsl(var(--salt-on-secondary-container) / <alpha-value>)',
        },
        tertiary: {
          DEFAULT: 'hsl(var(--salt-tertiary) / <alpha-value>)',
          foreground: 'hsl(var(--salt-tertiary-foreground) / <alpha-value>)',
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
        DEFAULT: 'var(--salt-radius-default)',
        md: 'var(--salt-radius-md)',
        lg: 'var(--salt-radius-lg)',
        xl: 'var(--salt-radius-xl)',
        full: '9999px',
      },
      fontFamily: {
        display: ['Epilogue', 'sans-serif'],
        sans: ['Inter', 'sans-serif'],
      },
      fontSize: {
        display: ['48px', { lineHeight: '1.1', letterSpacing: '-0.02em' }],
        h1: ['32px', { lineHeight: '1.2', letterSpacing: '-0.01em' }],
        h2: ['24px', { lineHeight: '1.3', letterSpacing: '0' }],
        'body-lg': ['18px', { lineHeight: '1.6' }],
        'body-md': ['16px', { lineHeight: '1.5' }],
        'label-caps': ['12px', { lineHeight: '1.0', letterSpacing: '0.05em' }],
      },
      boxShadow: {
        sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
        md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
        lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
        ambient: '0 2px 12px 0 hsl(var(--salt-primary) / 0.05)',
        popover: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
        dialog: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
      },
      spacing: {
        xs: '4px',
        sm: '8px',
        md: '16px',
        lg: '24px',
        xl: '48px',
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
      zIndex: {
        popover: '40',
        dialog: '50',
        tooltip: '70',
      },
    },
  },
  plugins: [
    animate,
    cssVarsPlugin,
    saltFocusRingPlugin,
    saltComponentPlugin,
    saltProgressPlugin,
    saltTypographyPlugin,
  ],
};

export default preset;
