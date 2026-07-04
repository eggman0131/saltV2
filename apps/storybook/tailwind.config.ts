import type { Config } from 'tailwindcss';
import salt from '@salt/ui-components/tailwind-preset';

export default {
  presets: [salt],
  content: [
    './src/**/*.{ts,svelte,html}',
    './.storybook/**/*.{ts,svelte,html}',
    '../../packages/ui-components/src/**/*.{ts,svelte}',
  ],
  darkMode: 'class',
} satisfies Config;
