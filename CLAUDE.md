# Salt 2.0 — Architecture Contract for AI Agents

This file is the authoritative, machine-enforced architecture contract. Violating these rules will cause CI to fail. The full prose contract lives in [docs/salt-architecture.md](docs/salt-architecture.md).

## Layer map

```
shared-types               →  (nothing)
domain                     →  shared-types
firebase-sync              →  domain, shared-types          # Firebase SDKs only; Firestore is the live data layer
ld-observability           →  domain, shared-types          # LaunchDarkly browser SDK; default subpath
ld-observability/server    →  domain, shared-types          # Ships CF spans to LD's OTLP endpoint; exposes a span-processor registration hook for CF-local concerns
observability              →  domain, shared-types          # PostHog browser SDK; default subpath, for web-pwa (LD browser-side replacement)
ui-components              →  (external only — shadcn/tailwind)
testing-utils              →  shared-types, domain, firebase-sync, ld-observability
web-pwa                    →  shared-types, domain, firebase-sync, ld-observability, ui-components
cloud-functions            →  shared-types, domain, ld-observability/server
```

`firebase-sync` and `ld-observability` are **siblings** — they must not import each other. `@salt/ld-observability` ships two subpath entrypoints from a single package: the default subpath wraps the LaunchDarkly browser SDK and is for `web-pwa`; `@salt/ld-observability/server` wraps the LaunchDarkly Node SDK and is for `cloud-functions`. The two subpaths share a runtime-neutral schema mapper (`src/shared/`) so the `canon.match` wire schema cannot drift between fast-path and CF emissions. Cross-runtime imports are forbidden: `web-pwa` must not import `/server`, and `cloud-functions` must not import the default subpath.

## Hard rules

1. **Domain is pure.** `packages/domain` must not import Firebase, Node.js built-ins, browser APIs, or any I/O. No side effects. Pure functions and types only. Conflict resolution policy lives here.
2. **Firebase SDK only in `firebase-sync`.** The only place `firebase` or `firebase-admin` may be imported is `packages/adapters/firebase-sync`.
3. **No IndexedDB / browser storage.** No package may import `idb`, `idb-keyval`, or touch `window.indexedDB` / `localStorage` / `sessionStorage` / `caches` directly. Offline reads and writes are handled by Firestore's `persistentLocalCache`. **Narrow exception:** `apps/web-pwa` may use `window.localStorage` for pre-authentication ephemeral state that has no Firestore-backed alternative — specifically the magic-link pending email in `apps/web-pwa/src/lib/auth.svelte.ts`, which must persist before any user is signed in (email clients open the link in a fresh tab/window, so `sessionStorage` is unavailable). This exception is scoped to `apps/web-pwa` only and explicitly excludes all adapters; everything else stays forbidden.
4. **Adapters do not import each other.** `firebase-sync` ↔ `ld-observability` is forbidden in both directions.
5. **Cloud Functions do not import the default `@salt/ld-observability` subpath.** That subpath wraps the browser-only LaunchDarkly SDK and cannot run in Node. Server-side observability uses `@salt/ld-observability/server` (LaunchDarkly Node SDK). `firebase-functions/logger` continues to be used additively for CF-side match logs.
6. **No importing apps.** Nothing may import `@salt/web-pwa` or `@salt/cloud-functions`.
7. **UI primitives go through `@salt/ui-components`.** `apps/web-pwa` must never import `shadcn-svelte`, `bits-ui`, or `melt-ui` directly — always through `@salt/ui-components`.
8. **No circular dependencies.** Enforced by dependency-cruiser.
9. **`shared-types` imports nothing from `@salt/*`.** It may only depend on external packages or nothing.
10. **Adapters never throw for operational errors.** All failures cross the boundary as `Failure<DomainError>` or `Conflict<T>` (see [docs/salt-architecture.md §7](docs/salt-architecture.md)).

## Data model conventions

- **All data is family-shared.** No `userId`, `householdId`, or per-user scoping on any collection. Equipment, recipes, shopping list, canon, aisles, and meal planner all live in single shared collections. Do not add user-scoped fields to new collections.
- **No soft-delete, no tombstones.** Firestore is the master; delete means delete. Canon has a vestigial `deletedAt` field from the local-first era — do not copy this pattern to new schemas.
- **LWW per document.** Last-write-wins at the document level. No merge logic at the storage layer; conflict resolution lives in `packages/domain`.

## AI / Genkit conventions

- **All AI access via Genkit callables.** Every Gemini call goes through a Genkit flow invoked as a Firebase callable Cloud Function. No AI API keys in the client.
- **Wrap every AI call in `withAiTimeout`.** Bare Genkit flow calls have no built-in timeout and will hang the function for the full 60 s quota on a slow or hung model response. This applies to callable flows and Firestore triggers alike. Functions calling AI must also declare their AI-related secrets.
- **Trace propagation is dormant.** Cross-callable trace context propagation was disabled 2026-05-11 (it broke the Genkit Dev UI). New callable flows use `onCallGenkit`. Do not re-add `runWithExtractedTraceContext` without first resolving that regression. Grep `DORMANT: trace propagation` to find all plumbing sites.

## Workflow

- **Issue-first for substantial changes.** New packages, new dependencies, layer-map edits, and cross-package refactors require a GitHub issue and explicit go-ahead before implementation. Design Q&A in chat is not a greenlight.
- **Production data back-compat.** Canon, Aisles, Equipment, Shopping List, Meal Planner, and Recipes collections hold real production data — schema changes must be backward-compatible on read, or require a one-off migration. (Recipes lost their greenfield status when the module shipped to all members in #240, 2026-06-17; treat recipe schema changes like any other production collection from here on.) See also: Zod schema conventions below.

## Zod schema conventions

- **Schemas live in `@salt/domain/schemas`.** All zod schemas are defined under `packages/domain/src/schemas/` and exported via the `@salt/domain/schemas` subpath. Do not define schemas in adapters, apps, or `@salt/shared-types`.
- **Schema-first.** Define the zod schema first; derive the TypeScript type with `type Foo = z.infer<typeof FooSchema>`. Never maintain a hand-written type alongside a schema for the same shape.
- **Validate at trust boundaries only.** Add `.parse()` or `.safeParse()` at: AI/Genkit flow outputs, Firestore document reads (in `firebase-sync`), callable CF inputs, and "type laundering" sites (`as` casts, `unknown` narrowings, `JSON.parse`, string → structured parsers). Do **not** add validation to internal domain → domain calls, adapter internals, or any code the TypeScript compiler already proves correct.
- **Handle validation failures per boundary type.** Always use `.safeParse()`, then:
  - **Adapter single-document reads** (e.g. `load(id)`) → return `Failure<DomainError>` (`{ kind: 'StorageError', reason: 'corruption' }`); do not throw across internal layer seams.
  - **Adapter list reads & realtime subscriptions** → skip the invalid doc, log it, and return the valid subset; one corrupt doc must not fail the whole read. Stream-level errors still surface via `onError`.
  - **Callable CF entrypoints** → `throw new HttpsError('invalid-argument', …)`; this is the Firebase callable protocol for rejecting bad client input, not an internal seam.
  - **Firestore triggers** → log and return; there is no caller to surface a `Failure` to.
- **Production schema changes need a back-compat check.** Pre-launch (greenfield) schema-shape changes are free. Once production holds real data, a schema-shape change must not break documents already written — keep it backward-compatible on read or run a one-off migration. See [docs/salt-architecture.md §1.1](docs/salt-architecture.md).

## Enforcement

- `pnpm lint` — ESLint with `eslint-plugin-boundaries` checks the import graph.
- `pnpm typecheck` — TypeScript project references prevent out-of-graph imports at compile time.
- `pnpm boundary:test` — Runs `.boundary-tests/run.sh` which lints deliberate violation fixtures and asserts each produces an error.
- Husky + lint-staged — blocks bad commits locally at pre-commit.
- GitHub Actions CI — blocks bad PRs before merge.

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
