import type { Preview } from '@storybook/svelte';
// Global stylesheet: pulls in the --salt-* design tokens and the Tailwind
// base/components/utilities layers so stories render with real design tokens,
// exactly as web-pwa does.
import './preview.css';

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    // Render stories on the app background surface so --salt-* tokens are visible.
    backgrounds: { disable: true },
    a11y: {
      // Surface a11y findings in the panel; do not fail the build in Phase 1.
      test: 'todo',
    },
  },
};

export default preview;
