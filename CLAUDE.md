# Salt 2.0 — Architecture Contract for AI Agents

This file is the authoritative, machine-enforced architecture contract. Violating these rules will cause CI to fail. The full prose contract lives in [docs/salt-architecture.md](docs/salt-architecture.md).

## Layer map

```
shared-types               →  (nothing)
domain                     →  shared-types
firebase-sync              →  domain, shared-types          # Firebase SDKs only; Firestore is the live data layer
observability              →  domain, shared-types          # PostHog browser SDK (posthog-js); default subpath, for web-pwa
observability/server       →  domain, shared-types          # posthog-node + native OTel; ships CF spans/events server-side, exposes a span-processor registration hook for CF-local concerns
ui-components              →  (external only — shadcn/tailwind)
testing-utils              →  shared-types, domain, firebase-sync
web-pwa                    →  shared-types, domain, firebase-sync, observability, ui-components
cloud-functions            →  shared-types, domain, observability/server
```

`firebase-sync` and `observability` are **siblings** — they must not import each other. `@salt/observability` ships two subpath entrypoints from a single package: the default subpath wraps the PostHog browser SDK (`posthog-js`) and is for `web-pwa`; `@salt/observability/server` wraps `posthog-node` + native OpenTelemetry and is for `cloud-functions`. The two subpaths share a runtime-neutral schema mapper (`src/shared/`) so the `canon.match` wire schema cannot drift between fast-path and CF emissions. Cross-runtime imports are forbidden: `web-pwa` must not import `/server`, and `cloud-functions` must not import the default subpath.

## Hard rules

1. **Domain is pure.** `packages/domain` must not import Firebase, Node.js built-ins, browser APIs, or any I/O. No side effects. Pure functions and types only. Conflict resolution policy lives here.
2. **Firebase SDK only in `firebase-sync`.** The only place `firebase` or `firebase-admin` may be imported is `packages/adapters/firebase-sync`.
3. **No IndexedDB / browser storage.** No package may import `idb`, `idb-keyval`, or touch `window.indexedDB` / `localStorage` / `sessionStorage` / `caches` directly. Offline reads and writes are handled by Firestore's `persistentLocalCache`. **Narrow exception:** `apps/web-pwa` may use `window.localStorage` for pre-authentication ephemeral state that has no Firestore-backed alternative — specifically the magic-link pending email in `apps/web-pwa/src/lib/auth.svelte.ts`, which must persist before any user is signed in (email clients open the link in a fresh tab/window, so `sessionStorage` is unavailable). This exception is scoped to `apps/web-pwa` only and explicitly excludes all adapters; everything else stays forbidden.
4. **Adapters do not import each other.** `firebase-sync` ↔ `observability` is forbidden in both directions.
5. **Cloud Functions do not import the default `@salt/observability` subpath.** That subpath wraps the browser-only PostHog SDK (`posthog-js`) and cannot run in Node. Server-side observability uses `@salt/observability/server` (`posthog-node` + native OpenTelemetry). `firebase-functions/logger` continues to be used additively for CF-side match logs.
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
- **Server-side trace propagation is env-gated.** Each CF invocation renders as one coherent trace: in production the canon-matching callables run the Genkit flow within a W3C trace context so the flow span nests under the request trace instead of re-rooting. There are two context sources, applied with a fixed precedence: (1) a real inbound W3C trace **header** off `request.rawRequest.headers` (what the platform/GCP injects), extracted via `runWithExtractedTraceContext`; else (2) a browser-**supplied** `traceparent` carried as a NAMED, TYPED, OPTIONAL input field on the callable WIRE input, run via `runWithSuppliedTraceContext` (both in `@salt/observability/server`; both degrade to a plain call and never throw — Rule 10). The W3C header is preferred for callables in principle, but **the Firebase callable SDK cannot carry a custom per-call HTTP header** (`HttpsCallableOptions` is only `{ timeout?, limitedUseAppCheckTokens? }` and the `@firebase/functions` transport sets its own fixed headers — Content-Type, Authorization, App Check, Instance-ID), so the browser→CF channel is the field. The field is schema-validated by a wire-envelope schema (`<Name>WireInputSchema = <Name>InputSchema.extend({ traceparent: z.string().optional() })` in `@salt/domain/schemas`) and **stripped at the entrypoint** so the domain flow receives the PURE domain input (domain purity) — flows never consume `traceparent`. This is applied to the four canon-matching callables: `matchOrCreateCanon`, `canonicaliseRecipeIngredients`, `extractRecipeFromUrl`, `authorRecipe`. A malformed/absent `traceparent` must NOT fail the call — it is optional/best-effort; only a malformed wire envelope (bad domain input) is rejected with `HttpsError('invalid-argument', …)`. The whole thing is SUPPRESSED when `GENKIT_TELEMETRY_SERVER` is set (local `pnpm dev:emulators`) so flows stay root-listed in the Genkit Dev UI — the env-gate is what resolved the 2026-05-11 regression that originally parked propagation. New callable flows that don't need this nesting can use `onCallGenkit`. This SUPERSEDES the prior "do not re-add a `_trace` wire field / browser→CF unification deferred" stance: the new field is named + typed + schema-validated (NOT the magic `_trace`, which was named/untyped payload plumbing). The browser still mints a synthetic/test trace id at this stage; a real browser tracer is a later phase. Firestore triggers have no inbound headers and will use a Firestore correlation field (Phase 5, upcoming).

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

## Observability / error-reporting conventions

- **Report the unexpected, suppress the expected.** Caught errors reach PostHog error tracking only via `ErrorReportingPort`, gated on the `DomainError` category — not by which call site happens to have a `catch`/`onError`. Reporting exists to surface failures the friendly-message path would otherwise hide; it is not a mirror of every `Failure`. Full policy: [docs/salt-architecture.md §7.6](docs/salt-architecture.md).
- **Report:** `StorageError`, `SyncError`, uncategorised/unknown errors, and (server-side) unhandled CF exceptions + AI/Genkit flow failures. `AuthError` is reported **except** the sign-out / token-refresh `permission-denied` race on in-flight listeners.
- **Do not report:** `NetworkError`/offline, `ValidationError`, `NotFound`, `ConflictError`, and the sign-out auth race.
- **Coverage is uniform** across write/command failures, realtime `onError`, and server CF — gated by category, not by call-site shape.
- **Best-effort, never throws** (Rule 10). Scrub raw user input (e.g. canon match text) from reported context — data is family-shared, but free-form user content must not be attached. Server PostHog reporting is additive to `firebase-functions/logger`.
- **Not lint-enforceable.** This is a runtime convention checked by review + the gating helper + unit tests, not `eslint-plugin-boundaries`.

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
| `packages/adapters/observability`  | `@salt/observability`  |
| `packages/ui-components`           | `@salt/ui-components`  |
| `packages/testing-utils`          | `@salt/testing-utils`  |
| `apps/web-pwa`                    | `@salt/web-pwa`        |
| `apps/cloud-functions`            | `@salt/cloud-functions`|

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
