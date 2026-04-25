// spec: SPEC.md §3.3 v0.2.3
import type { Config } from 'tailwindcss';
import salt from '@salt/ui-components/tailwind-preset';

export default {
  presets: [salt],
  content: [
    './src/**/*.{ts,svelte,html}',
    './index.html',
    '../../packages/ui-components/src/**/*.{ts,svelte}',
  ],
  darkMode: 'class',
} satisfies Config;
