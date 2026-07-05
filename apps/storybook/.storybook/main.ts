import type { StorybookConfig } from '@storybook/svelte-vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';

// Dev-only Storybook for @salt/ui-components. Renders components from unbuilt
// TS/Svelte source (workspace resolution → packages/ui-components/src) through
// the Tailwind v3 PostCSS + autoprefixer pipeline (postcss.config.js +
// tailwind.config.ts in this app root). Layer map: storybook → ui-components.
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
  async viteFinal(cfg) {
    // Register the Tailwind v4 plugin (@tailwindcss/vite) so the design-system
    // preset — still authored in JS and loaded via the `@config` directive in
    // .storybook/preview.css — compiles for the Storybook canvas. Prepended so it
    // runs ahead of the Svelte transform; the svelte-injection guard below is
    // unaffected (it only looks for vite-plugin-svelte).
    cfg.plugins = [tailwindcss(), ...(cfg.plugins ?? [])];

    // Register @sveltejs/vite-plugin-svelte ourselves. Contrary to a common
    // assumption, @storybook/svelte-vite@10.4.6 does NOT inject vite-plugin-svelte
    // — its framework preset only adds the (disabled-above) docgen plugin and
    // expects the Svelte compiler plugin to come from a project vite.config, which
    // this app intentionally doesn't have. Without the plugin nothing compiles
    // `.svelte`, so under Vite 8 the Rolldown/Oxc parser reads raw Svelte markup
    // as JS and every `.svelte` (app-local wrappers AND resolved @salt/ui-components
    // source) fails with `HTML comments are not allowed in modules` /
    // `JSX syntax is disabled` — breaking both `storybook build` and `storybook dev`.
    // Adding the plugin here fixes both. It auto-loads svelte.config.js
    // (vitePreprocess) so `<script lang="ts">` wrappers transpile correctly.
    const alreadyPresent = (cfg.plugins ?? [])
      .flat(Infinity as number)
      .some(
        (p): p is { name: string } =>
          !!p &&
          typeof p === 'object' &&
          'name' in p &&
          String(p.name).startsWith('vite-plugin-svelte'),
      );
    if (!alreadyPresent) {
      cfg.plugins = [...(cfg.plugins ?? []), svelte()];
    }
    return cfg;
  },
};

export default config;
