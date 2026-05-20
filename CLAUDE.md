# Salt 2.0 — Architecture Contract for AI Agents

This file is the authoritative, machine-enforced architecture contract. Violating these rules will cause CI to fail. The full prose contract lives in [docs/salt-architecture.md](docs/salt-architecture.md).

## Layer map

```
shared-types               →  (nothing)
domain                     →  shared-types
firebase-sync              →  domain, shared-types          # Firebase SDKs only; Firestore is the live data layer
ld-observability           →  domain, shared-types          # LaunchDarkly browser SDK; default subpath
ld-observability/server    →  domain, shared-types          # Ships CF spans to LD's OTLP endpoint; exposes a span-processor registration hook for CF-local concerns
ui-components              →  (external only — shadcn/tailwind)
testing-utils              →  shared-types, domain, firebase-sync, ld-observability
web-pwa                    →  shared-types, domain, firebase-sync, ld-observability, ui-components
cloud-functions            →  shared-types, domain, ld-observability/server
```

`firebase-sync` and `ld-observability` are **siblings** — they must not import each other. `@salt/ld-observability` ships two subpath entrypoints from a single package: the default subpath wraps the LaunchDarkly browser SDK and is for `web-pwa`; `@salt/ld-observability/server` wraps the LaunchDarkly Node SDK and is for `cloud-functions`. The two subpaths share a runtime-neutral schema mapper (`src/shared/`) so the `canon.match` wire schema cannot drift between fast-path and CF emissions. Cross-runtime imports are forbidden: `web-pwa` must not import `/server`, and `cloud-functions` must not import the default subpath.

## Hard rules

1. **Domain is pure.** `packages/domain` must not import Firebase, Node.js built-ins, browser APIs, or any I/O. No side effects. Pure functions and types only. Conflict resolution policy lives here.
2. **Firebase SDK only in `firebase-sync`.** The only place `firebase` or `firebase-admin` may be imported is `packages/adapters/firebase-sync`.
3. **No IndexedDB / browser storage.** No package may import `idb`, `idb-keyval`, or touch `window.indexedDB` / `localStorage` / `sessionStorage` / `caches` directly. Offline reads and writes are handled by Firestore's `persistentLocalCache`.
4. **Adapters do not import each other.** `firebase-sync` ↔ `ld-observability` is forbidden in both directions.
5. **Cloud Functions do not import the default `@salt/ld-observability` subpath.** That subpath wraps the browser-only LaunchDarkly SDK and cannot run in Node. Server-side observability uses `@salt/ld-observability/server` (LaunchDarkly Node SDK). `firebase-functions/logger` continues to be used additively for CF-side match logs.
6. **No importing apps.** Nothing may import `@salt/web-pwa` or `@salt/cloud-functions`.
7. **UI primitives go through `@salt/ui-components`.** `apps/web-pwa` must never import `shadcn-svelte`, `bits-ui`, or `melt-ui` directly — always through `@salt/ui-components`.
8. **No circular dependencies.** Enforced by dependency-cruiser.
9. **`shared-types` imports nothing from `@salt/*`.** It may only depend on external packages or nothing.
10. **Adapters never throw for operational errors.** All failures cross the boundary as `Failure<DomainError>` or `Conflict<T>` (see [docs/salt-architecture.md §7](docs/salt-architecture.md)).

## Zod schema conventions

- **Schemas live in `@salt/domain/schemas`.** All zod schemas are defined under `packages/domain/src/schemas/` and exported via the `@salt/domain/schemas` subpath. Do not define schemas in adapters, apps, or `@salt/shared-types`.
- **Schema-first.** Define the zod schema first; derive the TypeScript type with `type Foo = z.infer<typeof FooSchema>`. Never maintain a hand-written type alongside a schema for the same shape.
- **Validate at trust boundaries only.** Add `.parse()` or `.safeParse()` at: AI/Genkit flow outputs, Firestore document reads (in `firebase-sync`), callable CF inputs, and "type laundering" sites (`as` casts, `unknown` narrowings, `JSON.parse`, string → structured parsers). Do **not** add validation to internal domain → domain calls, adapter internals, or any code the TypeScript compiler already proves correct.
- **Validation failures funnel into `Failure<DomainError>`.** Do not throw across layer seams. Use `.safeParse()` and surface errors as `Failure` per the architecture contract (see [docs/salt-architecture.md §7](docs/salt-architecture.md)).

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
| `packages/adapters/firebase-sync`  | `@salt/firebase-sync`  |
| `packages/adapters/ld-observability` | `@salt/ld-observability` |
| `packages/ui-components`           | `@salt/ui-components`  |
| `packages/testing-utils`          | `@salt/testing-utils`  |
| `apps/web-pwa`                    | `@salt/web-pwa`        |
| `apps/cloud-functions`            | `@salt/cloud-functions`|
