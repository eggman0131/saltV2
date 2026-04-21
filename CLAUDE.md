# Salt 2.0 — Architecture Contract for AI Agents

This file is the authoritative, machine-enforced architecture contract. Violating these rules will cause CI to fail.

## Layer map

```
shared-types  →  (nothing)
domain        →  shared-types
firebase-adapter  →  domain, shared-types
ui-components →  (external only — shadcn/tailwind)
testing-utils →  shared-types, domain, firebase-adapter
web-pwa       →  shared-types, domain, firebase-adapter, ui-components
cloud-functions → shared-types, domain, firebase-adapter
```

## Hard rules

1. **Domain is pure.** `packages/domain` must not import Firebase, Node.js built-ins, browser APIs, or any I/O. No side effects. Pure functions and types only.
2. **Firebase SDK only in the adapter.** The only place `firebase` or `firebase-admin` may be imported is `packages/adapters/firebase`.
3. **No importing apps.** Nothing may import `@salt/web-pwa` or `@salt/cloud-functions`.
4. **UI primitives go through `@salt/ui-components`.** `apps/web-pwa` must never import `shadcn-svelte`, `bits-ui`, or `melt-ui` directly — always through `@salt/ui-components`.
5. **No circular dependencies.** Enforced by dependency-cruiser.
6. **`shared-types` imports nothing from `@salt/*`.** It may only depend on external packages or nothing.

## Enforcement

- `pnpm lint` — ESLint with `eslint-plugin-boundaries` checks the import graph.
- `pnpm typecheck` — TypeScript project references prevent out-of-graph imports at compile time.
- `pnpm boundary:test` — Runs `.boundary-tests/run.sh` which lints deliberate violation fixtures and asserts each produces an error.
- Pre-commit (Phase 3): Husky + lint-staged blocks bad commits locally.
- CI (Phase 7): GitHub Actions blocks bad PRs before merge.

## Package names

| Path                         | Package name             |
| ---------------------------- | ------------------------ |
| `packages/shared-types`      | `@salt/shared-types`     |
| `packages/domain`            | `@salt/domain`           |
| `packages/adapters/firebase` | `@salt/firebase-adapter` |
| `packages/ui-components`     | `@salt/ui-components`    |
| `packages/testing-utils`     | `@salt/testing-utils`    |
| `apps/web-pwa`               | `@salt/web-pwa`          |
| `apps/cloud-functions`       | `@salt/cloud-functions`  |
