# @salt/kitchen-sink

A **dev-only** visual showcase for `@salt/ui-components` — every primitive, template,
and token rendered on one page so you can eyeball a component change in isolation.

```bash
pnpm dev:kitchen-sink   # → http://localhost:5175
```

## Read this before copying patterns from here

This app is a **faithful reference for component usage** — imports go through
`@salt/ui-components` only (Rule 7), and props/composition match production. Two
caveats where it deliberately diverges from `@salt/web-pwa`:

- **Light-only, like production.** There is no dark-mode toggle. `@salt/web-pwa`
  configures `darkMode: 'class'` but never applies `.dark` at runtime, so the app
  renders light-only. `app.css` still carries dormant `.dark` token overrides —
  they exist solely because `ui-components`' Tooltip renders on an inverted
  surface — but do **not** treat dark mode as a shipped feature or build/QA
  `dark:` variants against this showcase.
- **`src/tokens.css` is a generated mirror, not the source of truth.** The design
  tokens are defined in `packages/ui-components/src/tailwind-preset.ts`. This
  file re-exports them as CSS custom properties for non-Tailwind consumers; if
  the two ever disagree, the preset wins.

## Enforcement & CI

Under the architecture contract as of #414:

- **Layer:** `kitchen-sink → ui-components` only (CLAUDE.md layer map). ESLint
  boundary rules forbid any other `@salt/*` import and direct UI-primitive imports.
- **Typecheck + svelte-check run in CI** via the root `pnpm typecheck` (project
  reference) and `pnpm check` (`--if-present`) — so a breaking `ui-components` API
  change fails CI here instead of silently rotting.
- **No dedicated production build or e2e.** This is a dev tool; it is intentionally
  not part of the deploy or e2e pipelines.

Port `5175` is deliberate — the e2e app server owns `:5174`, and running this
showcase there would collide with (and be killed by) an e2e run.
