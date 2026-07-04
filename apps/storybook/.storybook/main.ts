import type { StorybookConfig } from '@storybook/svelte-vite';

// Dev-only Storybook for @salt/ui-components. Renders components from unbuilt
// TS/Svelte source (workspace resolution → packages/ui-components/src) through
// the Tailwind v3 PostCSS + autoprefixer pipeline (postcss.config.js +
// tailwind.config.ts in this app root). Layer map: storybook → ui-components.
//
// The @storybook/svelte-vite framework auto-injects @sveltejs/vite-plugin-svelte
// (reading svelte.config.js), so no viteFinal / vite.config.ts is needed here.
//
// Stories are authored as standard CSF3 (.stories.ts), NOT Svelte CSF
// (.stories.svelte): @storybook/addon-svelte-csf@5.1.2 is not yet Vite-8/Rolldown
// compatible (its compiler calls Rolldown's JS parser on raw .svelte source and
// crashes). CSF3 renders the real components via @storybook/svelte with no
// Svelte-CSF compiler in the graph. The `svelte` extension is kept in the glob so
// the setup is forward-compatible once the addon ships a Vite-8 fix.
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(svelte|ts)'],
  addons: ['@storybook/addon-a11y'],
  framework: {
    name: '@storybook/svelte-vite',
    options: {
      // Disable Svelte docgen (static prop-table extraction). Under Vite 8 the
      // storybook:svelte-docgen-plugin runs `this.parse()` on the RAW .svelte
      // source with Rolldown's JS/oxc parser, which chokes on `<script module>`
      // and fails every *.stories.svelte transform (upstream
      // storybookjs/storybook#34304 / the Rolldown migration). Every story here
      // declares its `argTypes` explicitly, so docgen contributes nothing to the
      // Controls panel — turning it off is lossless. Re-enable once the upstream
      // Rolldown/docgen fix ships.
      docgen: false,
    },
  },
};

export default config;
