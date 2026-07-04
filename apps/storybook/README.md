# @salt/storybook

A **dev-only** Storybook for `@salt/ui-components`. It renders each component in
isolation from **unbuilt TS/Svelte source** through the same Tailwind v3 PostCSS +
autoprefixer pipeline and `--salt-*` design tokens the app ships with.

```bash
pnpm --filter @salt/storybook storybook   # → http://localhost:6006
```

## How the wiring works

- **Framework:** `@storybook/svelte-vite` (Vite 8 + `@sveltejs/vite-plugin-svelte` 7 +
  Svelte 5 runes — no Vite downgrade). The framework auto-injects the Svelte Vite
  plugin (reading `svelte.config.js`), so there is no `vite.config.ts` here.
- **Source, not build:** `@salt/ui-components` resolves via `workspace:*` to
  `packages/ui-components/src`, so stories compile the component source directly.
- **Tokens + Tailwind:** `.storybook/preview.ts` imports `.storybook/preview.css`,
  which pulls in `src/tokens.css` (the `--salt-*` custom properties) and the
  Tailwind `base/components/utilities` layers. `tailwind.config.ts` loads
  `@salt/ui-components/tailwind-preset` and scopes `content` to this app **and**
  `packages/ui-components/src/**` so preset utilities used only inside components
  are still generated.
- **Story format:** standard CSF3 (`src/stories/*.stories.ts`) — `Meta`/`StoryObj`
  from `@storybook/svelte-vite`. Svelte CSF (`.stories.svelte` via
  `@storybook/addon-svelte-csf`) is intentionally **not** used yet: that addon
  (v5.1.2) is not Vite-8/Rolldown compatible. Button's label is supplied as a
  Svelte `children` snippet built with `createRawSnippet` (Svelte 5). Swap to
  Svelte CSF once the addon ships a Vite-8 fix.
- **Addons:** `@storybook/addon-a11y` (accessibility panel) plus the built-in
  Controls that ship in Storybook core.

## Read this before copying patterns from here

- Imports go through `@salt/ui-components` only (Rule 7). Never import `bits-ui`,
  `melt-ui`, or `shadcn-svelte` directly.
- **Light-only, like production.** There is no dark-mode toggle (see
  `apps/kitchen-sink/README.md`); do not build/QA `dark:` variants against it.

## Enforcement & CI

Under the architecture contract:

- **Layer:** `storybook → ui-components` only (CLAUDE.md layer map). ESLint
  boundary rules forbid any other `@salt/*` import and direct UI-primitive imports.
- **Typecheck + svelte-check run in CI** via the root `pnpm typecheck` (project
  reference) and `pnpm check` (`--if-present` `check` script).
- **No dedicated production build or e2e.** This is a dev tool; it is intentionally
  not part of the deploy or e2e pipelines.

Port `6006` is Storybook's default and is deliberately distinct from web-pwa
(`5173`), the e2e app server (`5174`), and kitchen-sink (`5175`).
