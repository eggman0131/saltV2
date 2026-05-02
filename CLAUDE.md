# Salt 2.0 — Architecture Contract for AI Agents

This file is the authoritative, machine-enforced architecture contract. Violating these rules will cause CI to fail. The full prose contract lives in [docs/salt-architecture.md](docs/salt-architecture.md).

## Layer map

```
shared-types    →  (nothing)
domain          →  shared-types
local-store     →  domain, shared-types          # IndexedDB only
firebase-sync   →  domain, shared-types          # Firebase SDKs only
ld-observability  →  domain, shared-types          # LaunchDarkly Observability SDK only — browser-only
ui-components   →  (external only — shadcn/tailwind)
testing-utils   →  shared-types, domain, local-store, firebase-sync, ld-observability
web-pwa         →  shared-types, domain, local-store, firebase-sync, ld-observability, ui-components
cloud-functions →  shared-types, domain, firebase-sync
```

`local-store`, `firebase-sync`, and `ld-observability` are **siblings** — they must not import each other. `web-pwa` composes all three; `cloud-functions` composes `firebase-sync` only. `@salt/ld-observability` depends on browser-only LaunchDarkly SDKs and cannot run in Node — Cloud Functions log via `firebase-functions/logger` directly.

## Hard rules

1. **Domain is pure.** `packages/domain` must not import Firebase, Node.js built-ins, browser APIs, or any I/O. No side effects. Pure functions and types only. Conflict resolution policy lives here.
2. **Firebase SDK only in `firebase-sync`.** The only place `firebase` or `firebase-admin` may be imported is `packages/adapters/firebase-sync`.
3. **IndexedDB / browser storage only in `local-store`.** No other package may import `idb`, `idb-keyval`, or touch `window.indexedDB` / `localStorage` / `sessionStorage` / `caches` directly.
4. **Adapters do not import each other.** `local-store` ↔ `firebase-sync` is forbidden in both directions.
5. **Cloud Functions do not import `local-store` or `ld-observability`.** CFs run server‑side: no browser storage, and the LaunchDarkly Observability SDK is browser-only. CFs log via `firebase-functions/logger`.
6. **No importing apps.** Nothing may import `@salt/web-pwa` or `@salt/cloud-functions`.
7. **UI primitives go through `@salt/ui-components`.** `apps/web-pwa` must never import `shadcn-svelte`, `bits-ui`, or `melt-ui` directly — always through `@salt/ui-components`.
8. **No circular dependencies.** Enforced by dependency-cruiser.
9. **`shared-types` imports nothing from `@salt/*`.** It may only depend on external packages or nothing.
10. **Adapters never throw for operational errors.** All failures cross the boundary as `Failure<DomainError>` or `Conflict<T>` (see [docs/salt-architecture.md §7](docs/salt-architecture.md)).

## Enforcement

- `pnpm lint` — ESLint with `eslint-plugin-boundaries` checks the import graph.
- `pnpm typecheck` — TypeScript project references prevent out-of-graph imports at compile time.
- `pnpm boundary:test` — Runs `.boundary-tests/run.sh` which lints deliberate violation fixtures and asserts each produces an error.
- Pre-commit (Phase 3): Husky + lint-staged blocks bad commits locally.
- CI (Phase 7): GitHub Actions blocks bad PRs before merge.

## Package names

| Path                              | Package name           |
| --------------------------------- | ---------------------- |
| `packages/shared-types`           | `@salt/shared-types`   |
| `packages/domain`                 | `@salt/domain`         |
| `packages/adapters/local-store`   | `@salt/local-store`    |
| `packages/adapters/firebase-sync`  | `@salt/firebase-sync`  |
| `packages/adapters/ld-observability` | `@salt/ld-observability` |
| `packages/ui-components`           | `@salt/ui-components`  |
| `packages/testing-utils`          | `@salt/testing-utils`  |
| `apps/web-pwa`                    | `@salt/web-pwa`        |
| `apps/cloud-functions`            | `@salt/cloud-functions`|
