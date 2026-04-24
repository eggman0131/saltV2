import type { Config } from 'tailwindcss';
import salt from '@salt/ui-components/tailwind-preset';

export default {
  presets: [salt],
  content: ['./src/**/*.{ts,svelte,html}', './index.html'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        display: ['Epilogue', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
      },
      colors: {
        sage: {
          DEFAULT: 'hsl(98 20% 33%)' /* #4f6443 */,
          container: 'hsl(94 47% 82%)' /* #cfe7bd */,
          on: 'hsl(99 19% 35%)' /* #536947 */,
        },
        terracotta: {
          DEFAULT: 'hsl(6 100% 10%)' /* #340500 */,
          container: 'hsl(10 100% 17%)' /* #580f00 */,
          on: 'hsl(12 76% 61%)' /* #e76e50 */,
        },
        'midnight-navy': 'hsl(195 77% 7%)' /* #041920 */,
      },
      boxShadow: {
        /* Ambient — soft diffused navy tint at 5% opacity per spec */
        ambient: '0 2px 12px 0 hsl(195 77% 7% / 0.05)',
      },
      spacing: {
        xs: '4px',
        sm: '8px',
        md: '16px',
        lg: '24px',
        xl: '48px',
      },
    },
  },
} satisfies Config;
